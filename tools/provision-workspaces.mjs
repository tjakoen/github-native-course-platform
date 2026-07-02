#!/usr/bin/env node
// Provision + repair student workspace repos for a section.
//
// This is the automation of the manual workspace cleanup we kept redoing by
// hand: every student who has graded activities should own exactly ONE workspace
// repo (`student-<subject>-<section>-<handle>`) carrying a filled student.json.
// This tool reconciles the roster (built from the gradebook, grouped by the SAME
// number/email/github/stem logic the rest of the engine uses) against the live
// workspace repos and fixes the gaps:
//
//   MISSING  student has activities but no workspace  -> create from template
//   EMPTY    workspace repo has no content            -> push template scaffold
//   BLANK    workspace student.json missing/empty     -> fill from activities
//   COLLIDE  two workspaces claim one studentNumber   -> report only (needs you)
//   OK       workspace present + identified           -> nothing
//
// It NEVER deletes or renames anything (those need a human + delete_repo scope);
// it only creates missing repos and fills identity, sourced from the student's
// own submission student.json (falling back to the gradebook identity).
//
// DRY RUN BY DEFAULT: prints the plan and touches nothing until --execute.
//
// Usage: node tools/provision-workspaces.mjs <section> [--execute] [--only=<handle>]
//
// Auth/env: GH_TOKEN or gh login (repo create + contents write), GRADE_OWNER
// (org), WORKSPACE_PREFIX (e.g. student-6xxx-0000-), WORKSPACE_TEMPLATE
// (owner/repo of the workspace template; falls back to workspaceTemplate in course.config.json).

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { loadGradebook, consolidate, normNum, normGh, repoStem } from "./lib/gradebook.mjs";

const section = process.argv[2];
const execute = process.argv.includes("--execute");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.split("=")[1].toLowerCase() : null;
if (!section) {
  console.error("usage: provision-workspaces.mjs <section> [--execute] [--only=<handle>]");
  process.exit(1);
}

const sh = (cmd, opts = {}) =>
  execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const trySh = (cmd, opts = {}) => { try { return sh(cmd, opts); } catch { return null; } };

const OWNER = process.env.GRADE_OWNER || sh("gh api user -q .login");
const WORKSPACE_PREFIX = process.env.WORKSPACE_PREFIX || "";
if (!WORKSPACE_PREFIX) { console.error("WORKSPACE_PREFIX not set - nowhere to provision"); process.exit(1); }
const loadConfig = () => {
  try { return JSON.parse(readFileSync(new URL("../course.config.json", import.meta.url), "utf8")); }
  catch { return {}; }
};
const TEMPLATE = process.env.WORKSPACE_TEMPLATE || loadConfig().workspaceTemplate || "";
if (!TEMPLATE) { console.error("No workspace template: set WORKSPACE_TEMPLATE or `workspaceTemplate` in course.config.json"); process.exit(1); }

// ---- helpers -------------------------------------------------------------
// The student's original-case handle in a repo name (student-6xxx-0000-JuanDelaCruz
// -> "JuanDelaCruz"). repoStem() lowercases; here we preserve case for a new name.
const stemOriginal = (repo) => {
  const i = repo.toLowerCase().indexOf(`-${String(section).toLowerCase()}-`);
  return i >= 0 ? repo.slice(i + String(section).length + 2) : repo.replace(/^[^-]*-/, "");
};
// Read a repo's student.json. Retry transient API errors so a rate-limit/network
// blip during the many reads is not mistaken for a blank/missing file (which
// would spuriously flag a filled workspace for re-fill or drop it from the
// number/github resolution map). Only a definitive 404 / empty repo -> null.
const readSj = (repo) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = sh(`gh api -H "Accept: application/vnd.github.raw" repos/${OWNER}/${repo}/contents/student.json`);
      try { return JSON.parse(raw); } catch { return null; }
    } catch (e) {
      const msg = String(e.stderr || e.stdout || e.message || "");
      if (/HTTP 404|Not Found|empty repository/i.test(msg)) return null;   // definitive
      execSync("sleep 2");                                                  // transient: retry
    }
  }
  return null;
};
const isFilled = (sj) => !!(sj && (String(sj.studentNumber || "").trim() || String(sj.fullName || "").trim()));

// ---- roster from the gradebook (reuses the engine's student grouping) ----
const { rows, section: gbSection } = loadGradebook("gradebook/grades.csv", section);
const groups = consolidate(rows.filter((r) => normNum(r.num) || repoStem(r.repo, section)), section)
  .filter((g) => g.rows.some((r) => r.repo && r.repo.toLowerCase().includes(`-${section.toLowerCase()}-`)));

// ---- live workspace repos + their identities -----------------------------
const allRepos = JSON.parse(sh(`gh repo list ${OWNER} --limit 5000 --json name,isEmpty`));
const pfx = WORKSPACE_PREFIX.toLowerCase();
const workspaces = allRepos.filter((r) => r.name.toLowerCase().startsWith(pfx));
const wsEmpty = new Set(workspaces.filter((r) => r.isEmpty).map((r) => r.name));
const wsByName = new Map(workspaces.map((r) => [r.name.toLowerCase(), r.name]));
const wsByNumber = new Map(), wsByGithub = new Map(), wsBlank = new Set();
const numberOwners = new Map(); // number -> [ws,...] for collision detection
for (const { name } of workspaces) {
  if (wsEmpty.has(name)) { wsBlank.add(name); continue; }
  const sj = readSj(name);
  if (!isFilled(sj)) { wsBlank.add(name); continue; }
  const n = normNum(sj.studentNumber), gh = normGh(sj.githubAccount);
  if (n) { wsByNumber.set(n, name); (numberOwners.get(n) || numberOwners.set(n, []).get(n)).push(name); }
  if (gh) wsByGithub.set(gh, name);
}

// ---- resolve each student to a workspace (mirrors publish workspaceFor) ---
const groupNum = (g) => [...g.nums][0] || null;
const groupGithub = (g) => {
  for (const r of g.rows) { const gh = normGh(r.github); if (gh) return gh; }
  for (const r of g.rows) { const s = repoStem(r.repo, section); if (s) return s; }
  return null;
};
const groupHandle = (g) => {
  // Prefer the github account, else the most common submission stem (orig case).
  for (const r of g.rows) if (String(r.github || "").trim()) return String(r.github).trim();
  const stems = g.rows.map((r) => stemOriginal(r.repo)).filter(Boolean);
  return stems.sort((a, b) =>
    stems.filter((s) => s === b).length - stems.filter((s) => s === a).length)[0] || null;
};
const workspaceFor = (g) => {
  const n = groupNum(g); if (n && wsByNumber.has(n)) return wsByNumber.get(n);
  const gh = groupGithub(g); if (gh && wsByGithub.has(gh)) return wsByGithub.get(gh);
  const h = groupHandle(g); if (h && wsByName.has((WORKSPACE_PREFIX + h).toLowerCase())) return wsByName.get((WORKSPACE_PREFIX + h).toLowerCase());
  return null;
};

// The student.json to write: prefer a filled submission student.json (their own
// activity artifact, keeps personalEmail), else synthesize from gradebook fields.
const studentJsonFor = (g) => {
  const submissionRepos = g.rows.map((r) => r.repo)
    .filter((n) => n && !n.toLowerCase().startsWith(pfx));
  // classCode is ALWAYS the section we are provisioning for - never the value
  // copied from a submission, which may carry the student's section typo.
  for (const repo of [...new Set(submissionRepos)]) {
    const sj = readSj(repo);
    if (isFilled(sj)) return {
      classCode: section,
      fullName: sj.fullName || "", studentNumber: sj.studentNumber || "",
      studentEmail: sj.studentEmail || "", personalEmail: sj.personalEmail || "",
      githubAccount: sj.githubAccount || "",
    };
  }
  const row = g.rows.find((r) => r.num || r.name) || g.rows[0];
  return {
    classCode: section, fullName: row.name || "",
    studentNumber: row.num || "", studentEmail: row.email || "",
    personalEmail: "", githubAccount: String(row.github || "").trim(),
  };
};

// ---- build the plan ------------------------------------------------------
const plan = { create: [], scaffold: [], fill: [], collide: [], needIdentity: [], ok: [] };
for (const g of groups) {
  const handle = groupHandle(g);
  if (only && !(handle && handle.toLowerCase() === only)) continue;
  const ws = workspaceFor(g);
  const sj = studentJsonFor(g);
  const hasIdentity = !!String(sj.studentNumber || sj.fullName || "").trim();
  if (ws) {
    if (wsEmpty.has(ws)) plan.scaffold.push({ ws, sj, handle });
    else if (wsBlank.has(ws)) (hasIdentity ? plan.fill : plan.needIdentity).push({ ws, sj, handle });
    else plan.ok.push({ ws, handle });
  } else {
    const name = handle ? `${WORKSPACE_PREFIX}${handle}` : null;
    if (!name) plan.needIdentity.push({ ws: "(unnamed)", sj, handle });
    else plan.create.push({ name, sj, handle, hasIdentity });
  }
}
// Collisions: any studentNumber claimed by 2+ workspaces.
for (const [n, list] of numberOwners) if (list.length > 1) plan.collide.push({ num: n, list });

// ---- report --------------------------------------------------------------
const tag = execute ? "" : "[dry-run] ";
console.log(`provision workspaces: section ${gbSection}, owner ${OWNER}, prefix ${WORKSPACE_PREFIX}`);
console.log(`  ${groups.length} students in gradebook, ${workspaces.length} workspace repos\n`);
if (plan.collide.length) {
  console.log("COLLISION (two workspaces, one studentNumber - fix by hand):");
  for (const c of plan.collide) console.log(`  #${c.num}: ${c.list.join(", ")}`);
  console.log("");
}
if (plan.create.length) {
  console.log(`CREATE (${plan.create.length}):`);
  for (const c of plan.create) console.log(`  ${tag}create ${c.name}${c.hasIdentity ? "" : "  (WARN: no identity in activities - student.json will be blank)"}`);
  console.log("");
}
if (plan.scaffold.length) { console.log(`SCAFFOLD empty (${plan.scaffold.length}):`); for (const s of plan.scaffold) console.log(`  ${tag}scaffold ${s.ws}`); console.log(""); }
if (plan.fill.length) { console.log(`FILL student.json (${plan.fill.length}):`); for (const f of plan.fill) console.log(`  ${tag}fill ${f.ws}  <- ${f.sj.fullName} (#${f.sj.studentNumber})`); console.log(""); }
if (plan.needIdentity.length) { console.log(`NEEDS IDENTITY (no student.json in their activities - skipped):`); for (const n of plan.needIdentity) console.log(`  ${n.handle || n.ws}`); console.log(""); }
console.log(`OK: ${plan.ok.length} workspace(s) already provisioned.`);

// ---- execute -------------------------------------------------------------
// FILL only updates student.json in a repo that already has content, so the
// contents API is safe (no import race).
const putStudentJson = (repo, sj) => {
  const content = Buffer.from(JSON.stringify(sj, null, 2) + "\n", "utf8").toString("base64");
  const existing = trySh(`gh api repos/${OWNER}/${repo}/contents/student.json -q .sha`);
  const shaArg = existing ? `-f sha=${existing}` : "";
  sh(`gh api -X PUT repos/${OWNER}/${repo}/contents/student.json -f message=":bust_in_silhouette: Fill student.json from student activity data" -f content=${content} ${shaArg}`);
};

// CREATE + SCAFFOLD push the scaffold via git, NOT `gh repo create --template`:
// template import is async and races the student.json write (some repos ended up
// with the template's blank student.json, others with no scaffold). Cloning the
// template working tree and pushing it in one deterministic commit avoids that.
const WORK = ".provision-work";
let tplDir = null;
const ensureTemplate = () => {
  if (tplDir) return tplDir;
  mkdirSync(WORK, { recursive: true });
  tplDir = `${WORK}/_tpl`;
  rmSync(tplDir, { recursive: true, force: true });
  sh(`gh repo clone ${TEMPLATE} ${tplDir} -- -q`);
  return tplDir;
};
// Push the template scaffold + a filled student.json into `repo` (which must
// already exist; create it first for the CREATE case).
const pushWorkspace = (repo, sj) => {
  const tpl = ensureTemplate();
  const dir = `${WORK}/${repo}`;
  rmSync(dir, { recursive: true, force: true });
  sh(`gh repo clone ${OWNER}/${repo} ${dir} -- -q`);
  execSync(`git -C ${dir} symbolic-ref HEAD refs/heads/main`, { stdio: "ignore" }); // in case the repo is empty
  // overlay the template working tree (never its .git or its placeholder student.json)
  execSync(`( cd ${tpl} && tar --exclude=./.git --exclude=./student.json -cf - . ) | ( cd ${dir} && tar -xf - )`, { stdio: "ignore" });
  writeFileSync(`${dir}/student.json`, JSON.stringify(sj, null, 2) + "\n");
  execSync(`git -C ${dir} add -A`, { stdio: "ignore" });
  trySh(`git -C ${dir} commit -q -m ":seedling: Provision workspace: template scaffold + student.json"`);
  sh(`git -C ${dir} push -q origin HEAD:main`);
};

if (!execute) { console.log(`\nDRY RUN - nothing changed. Re-run with --execute to apply.`); process.exit(0); }

sh(`gh auth setup-git`);
let done = 0;
for (const c of plan.create) {
  console.log(`create ${c.name} ...`);
  trySh(`gh repo create ${OWNER}/${c.name} --private -d "Course workspace"`);
  pushWorkspace(c.name, c.sj); done++;
}
for (const s of plan.scaffold) { console.log(`scaffold ${s.ws} (empty) ...`); pushWorkspace(s.ws, s.sj); done++; }
for (const f of plan.fill) { console.log(`fill ${f.ws} ...`); putStudentJson(f.ws, f.sj); done++; }
rmSync(WORK, { recursive: true, force: true });
console.log(`\ndone: ${done} workspace(s) provisioned. Run publish-material.yml then publish.yml to deliver content + grades.`);
