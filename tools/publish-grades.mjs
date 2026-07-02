#!/usr/bin/env node
// Publish graded results into student workspace repos.
//
// SEPARATE from grading. `grade-sweep.mjs` writes the gradebook (teacher repo
// only); this script is the ONLY thing that touches student repos. It delivers
// a consolidated GRADES.md + per-activity receipts + FEEDBACK.md (+ rendered
// previews) into each student's workspace repo - but ONLY for activities flagged
// `"publish": true` in grader/assignments.json (default false). So a grade/its
// feedback reaches a student only once you've reviewed it and flipped that flag.
//
// DRY RUN BY DEFAULT: prints who/what would be published and pushes nothing
// until --execute.
//
// Usage: node tools/publish-grades.mjs <section> [--execute] [--only=<id>] [--repo=<name>]
//
// Auth/env: GH_TOKEN (cross-repo), GRADE_OWNER (org), WORKSPACE_PREFIX.

import { execSync } from "node:child_process";
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, readdirSync,
} from "node:fs";
import { loadPolicy } from "./lib/gradebook.mjs";

const section = process.argv[2];
const execute = process.argv.includes("--execute");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.split("=")[1] : null;
const repoArg = process.argv.find((a) => a.startsWith("--repo="));
const onlyRepo = repoArg ? repoArg.split("=")[1] : null;
if (!section) {
  console.error("usage: publish-grades.mjs <section> [--execute] [--only=<id>] [--repo=<name>]");
  process.exit(1);
}

const sh = (cmd, opts = {}) =>
  execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const quiet = (cmd, opts = {}) => execSync(cmd, { stdio: "ignore", ...opts });

const OWNER = process.env.GRADE_OWNER || sh("gh api user -q .login");
const WORKSPACE_PREFIX = process.env.WORKSPACE_PREFIX || "";
if (!WORKSPACE_PREFIX) { console.error("WORKSPACE_PREFIX not set - nowhere to publish to"); process.exit(1); }

const WORK = ".grade-work";
mkdirSync(WORK, { recursive: true });

// ---- which activities are cleared to publish ----------------------------
const policy = loadPolicy("grader/assignments.json");
const publishable = (id) => (!only || id === only) && policy.get(id)?.publish === true;

// ---- read the gradebook (parse by header, so column order/extras differ ok)
const decNotes = (s) => { try { return s ? Buffer.from(s, "base64").toString("utf8") : ""; } catch { return ""; } };
const parseCsvLine = (line) => {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur); return out;
};
const CSV = "gradebook/grades.csv";
if (!existsSync(CSV)) { console.error(`no ${CSV} - run the grade sweep first`); process.exit(1); }
const lines = readFileSync(CSV, "utf8").trim().split("\n");
const col = Object.fromEntries(parseCsvLine(lines[0]).map((c, i) => [c, i]));
const get = (f, name) => (col[name] != null ? f[col[name]] : "");
const allRows = lines.slice(1).filter(Boolean).map(parseCsvLine).map((f) => ({
  repo: get(f, "repo"), githubAccount: get(f, "githubAccount"), fullName: get(f, "fullName"),
  studentNumber: get(f, "studentNumber"), studentEmail: get(f, "studentEmail"), classCode: get(f, "classCode"),
  assignment: get(f, "assignment"), sha: get(f, "sha"), score: get(f, "score"), gradedAt: get(f, "gradedAt"),
  late: get(f, "late") === "true", notes: decNotes(get(f, "notes")),
}));

// Rows in this section, for published activities only.
const rows = allRows.filter((r) =>
  r.repo.includes(`-${section}-`) && publishable(r.assignment) && (!onlyRepo || r.repo === onlyRepo));
if (!rows.length) {
  const flagged = [...policy.entries()].filter(([, p]) => p.publish).map(([id]) => id);
  console.log(`Nothing to publish for section ${section}.`);
  console.log(flagged.length ? `Published activities: ${flagged.join(", ")} (no matching graded rows).`
    : `No activity has "publish": true in grader/assignments.json yet.`);
  process.exit(0);
}

// ---- match each graded repo to its student's workspace repo --------------
const wsByNumber = new Map(), wsByGithub = new Map(), wsByName = new Map();
{
  const pfx = WORKSPACE_PREFIX.toLowerCase();
  const wsRepos = JSON.parse(sh(`gh repo list ${OWNER} --limit 5000 --json name`)) // limit > org repo count, else workspaces get silently dropped
    .map((r) => r.name).filter((n) => n.toLowerCase().startsWith(pfx));
  for (const ws of wsRepos) {
    wsByName.set(ws.toLowerCase(), ws);
    try {
      const b64 = sh(`gh api repos/${OWNER}/${ws}/contents/student.json -q .content`);
      const s = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
      if (s.studentNumber) wsByNumber.set(String(s.studentNumber).trim(), ws);
      if (s.githubAccount) wsByGithub.set(String(s.githubAccount).trim().toLowerCase(), ws);
    } catch { /* blank student.json - title fallback still applies */ }
  }
}
function workspaceFor(row) {
  const byNum = row.studentNumber && wsByNumber.get(String(row.studentNumber).trim());
  if (byNum) return byNum;
  const byGh = row.githubAccount && wsByGithub.get(String(row.githubAccount).trim().toLowerCase());
  if (byGh) return byGh;
  const suffix = row.repo.split(`-${section}-`)[1];
  if (suffix) { const cand = (WORKSPACE_PREFIX + suffix).toLowerCase(); if (wsByName.has(cand)) return wsByName.get(cand); }
  return null;
}

// Previews are read from the committed gradebook (no in-memory render here).
const previewDir = (r) => `gradebook/previews/${r.assignment}/${r.repo}`;
const previewPngs = (r) => { try { return readdirSync(previewDir(r)).filter((f) => /\.png$/i.test(f)); } catch { return []; } };

// ---- push one student's published grades into their workspace ------------
function pushWorkspaceGrades(ws, studentRows) {
  const dir = `${WORK}/__ws__${ws}`;
  rmSync(dir, { recursive: true, force: true });
  // One bad/transient clone must not abort the whole publish; skip + retry next run.
  try { quiet(`gh repo clone ${OWNER}/${ws} ${dir} -- -q`); }
  catch {
    try { quiet(`gh repo clone ${OWNER}/${ws} ${dir} -- -q`); }
    catch { console.log(`  skip ${ws} - clone failed (missing or transient); retry next run`); return; }
  }
  mkdirSync(`${dir}/grades`, { recursive: true });
  const sorted = [...studentRows].sort((a, b) => a.assignment.localeCompare(b.assignment));
  for (const r of sorted) {
    writeFileSync(`${dir}/grades/${r.assignment}.json`, JSON.stringify({
      assignment: r.assignment, sourceRepo: r.repo, gradedCommit: r.sha,
      gradedAt: r.gradedAt, score: r.score, late: !!r.late,
    }, null, 2) + "\n");
    const pngs = previewPngs(r);
    if (pngs.length) {
      const destDir = `${dir}/grades/previews/${r.assignment}`;
      mkdirSync(destDir, { recursive: true });
      for (const img of pngs) cpSync(`${previewDir(r)}/${img}`, `${destDir}/${img}`);
      r._wsPreview = `./grades/previews/${r.assignment}/`;
      writeFileSync(`${destDir}/README.md`, [
        `# ${r.assignment} - ${r.score}${r.late ? " (LATE)" : ""}`, "",
        `Rendered page(s) of your submission, graded ${r.gradedAt.slice(0, 16).replace("T", " ")}.`, "",
        ...pngs.flatMap((img) => [`## ${img.replace(/\.png$/i, "")}`, "", `![${img}](./${img})`, ""]),
      ].join("\n"));
    }
  }
  // Consolidated, student-facing feedback (no scores / no tooling attribution).
  const fbRows = sorted.filter((r) => r.notes);
  if (fbRows.length) {
    writeFileSync(`${dir}/FEEDBACK.md`, [
      "# Feedback", "",
      "_Notes on your submission to help you improve. Not a grade; see GRADES.md for scores._", "",
      ...fbRows.flatMap((r) => [`## ${r.assignment}`, "", r.notes, ""]),
    ].join("\n"));
  } else { rmSync(`${dir}/FEEDBACK.md`, { force: true }); }
  const md = [
    "# Your grades", "",
    "| Assignment | Grade | Feedback | Preview | Late | Submission | Graded |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...sorted.map((r) =>
      `| ${r.assignment} | ${r.score} | ${r.notes ? "[see](./FEEDBACK.md)" : ""} | ${r._wsPreview ? `[pages](${r._wsPreview})` : ""} | ${r.late ? "LATE" : ""} | [\`${r.sha.slice(0, 7)}\`](https://github.com/${OWNER}/${r.repo}/commit/${r.sha}) | ${r.gradedAt.slice(0, 16).replace("T", " ")} |`),
    "", "_Grades issued by the instructor. Source of truth is the teacher gradebook._", "",
  ].join("\n");
  writeFileSync(`${dir}/GRADES.md`, md);
  quiet(`git -C ${dir} add -A grades GRADES.md FEEDBACK.md`);
  try {
    quiet(`git -C ${dir} -c user.name=course-bot -c user.email=course-bot@users.noreply.github.com commit -m ":memo: Update grades"`);
    quiet(`git -C ${dir} push -q`);
    console.log(`  published -> ${ws}`);
  } catch { console.log(`  no changes for ${ws}`); }
}

// ---- group by workspace + go --------------------------------------------
const byWs = new Map();
for (const r of rows) {
  const ws = workspaceFor(r);
  if (!ws) { console.log(`${r.repo} (${r.assignment}): NO WORKSPACE FOUND - skipped`); continue; }
  if (!byWs.has(ws)) byWs.set(ws, []);
  byWs.get(ws).push(r);
}
console.log(`publish: section ${section}, ${rows.length} graded row(s) across ${byWs.size} workspace(s) (${execute ? "EXECUTE" : "DRY RUN"})`);
const flagged = [...policy.entries()].filter(([, p]) => p.publish).map(([id]) => id);
console.log(`published activities: ${flagged.join(", ") || "(none)"}`);
for (const [ws, rs] of byWs) {
  if (execute) pushWorkspaceGrades(ws, rs);
  else console.log(`  [dry-run] would publish to ${ws}: ${rs.map((r) => r.assignment + (r.notes ? "+fb" : "")).join(", ")}`);
}
if (!execute) console.log("\nDRY RUN - nothing pushed. Re-run with --execute to publish.");