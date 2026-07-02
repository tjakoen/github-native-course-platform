#!/usr/bin/env node
// Off-repo grade sweep (proof of concept).
//
// For each assignment in grader/assignments.json, finds the matching student
// repos for a section, clones each, grades it against the CANONICAL tests/keys
// kept here in the teacher repo (so a student editing their own tests changes
// nothing), records the score in gradebook/, and pushes a receipt into the
// student repo. Idempotent: a repo whose latest commit is already graded is
// skipped unless --force.
//
// Usage: node tools/grade-sweep.mjs <section> [--force] [--only=<assignmentId>]
//
// Auth: uses your local `gh`/`git` credentials (run from a machine logged in
// with access to the repos). The GitHub Actions version wraps this same script.

import { execSync } from "node:child_process";
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync,
} from "node:fs";
import { runNotesPass } from "./lib/ai-feedback.mjs";

const section = process.argv[2];
const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.split("=")[1] : null;
const repoArg = process.argv.find((a) => a.startsWith("--repo="));
const onlyRepo = repoArg ? repoArg.split("=")[1] : null; // grade just this one repo
if (!section) {
  console.error("usage: grade-sweep.mjs <section> [--force] [--dry-run] [--only=<id>]");
  process.exit(1);
}

const sh = (cmd, opts = {}) =>
  execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const quiet = (cmd, opts = {}) => execSync(cmd, { stdio: "ignore", ...opts });

// In Actions, set GRADE_OWNER to the org (github.repository_owner); locally it
// falls back to the authenticated gh user.
const OWNER = process.env.GRADE_OWNER || sh("gh api user -q .login");
const assignments = JSON.parse(readFileSync("grader/assignments.json", "utf8"))
  .filter((a) => !only || a.id === only);

const WORK = ".grade-work";
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

// ---- CSV helpers ---------------------------------------------------------
const HEADER =
  "repo,githubAccount,fullName,studentNumber,studentEmail,classCode,assignment,sha,passed,total,score,gradedAt,late,notes,aiScore,failures";
// Notes are markdown (commas + newlines) and failures is a JSON array, so both
// are stored base64 in the CSV to stay on one field/line; the rest is plain.
const encNotes = (s) => (s ? Buffer.from(String(s), "utf8").toString("base64") : "");
const decNotes = (s) => { try { return s ? Buffer.from(s, "base64").toString("utf8") : ""; } catch { return ""; } };
const encFails = (a) => (a && a.length ? Buffer.from(JSON.stringify(a), "utf8").toString("base64") : "");
const decFails = (s) => { try { return s ? JSON.parse(Buffer.from(s, "base64").toString("utf8")) : []; } catch { return []; } };
const csvField = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; // quote only when needed
};
const parseCsvLine = (line) => {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
};

// ---- gradebook (source of truth) ----------------------------------------
const CSV = "gradebook/grades.csv";
const rows = [];
const seen = new Map(); // `${repo}|${assignment}` -> graded sha
const gradedThisRun = new Set(); // `${repo}|${assignment}` actually (re)graded now -> AI feedback gate
if (existsSync(CSV)) {
  const lines = readFileSync(CSV, "utf8").trim().split("\n");
  if (lines[0] === HEADER) { // ignore an old/foreign format and start fresh
    for (const ln of lines.slice(1).filter(Boolean)) {
      const f = parseCsvLine(ln);
      const row = {
        repo: f[0], githubAccount: f[1], fullName: f[2], studentNumber: f[3],
        studentEmail: f[4], classCode: f[5], assignment: f[6], sha: f[7],
        passed: +f[8], total: +f[9], score: f[10], gradedAt: f[11],
        late: f[12] === "true", notes: decNotes(f[13]),
        aiScore: f[14] === "" || f[14] == null ? null : +f[14],
        failures: decFails(f[15]),
      };
      rows.push(row);
      seen.set(`${row.repo}|${row.assignment}`, row.sha);
    }
  }
}

// ---- helpers -------------------------------------------------------------
const listRepos = (prefix) =>
  JSON.parse(sh(`gh repo list ${OWNER} --limit 5000 --json name`))
    .map((r) => r.name)
    .filter((n) => n.startsWith(prefix) && n.includes(`-${section}-`))
    .filter((n) => !onlyRepo || n === onlyRepo);

function gradeVitest(dir, id) {
  cpSync(`grader/${id}`, dir, { recursive: true }); // overlay canonical tests
  try {
    quiet("npm install --no-audit --no-fund --silent", { cwd: dir });
  } catch {
    // No/broken package.json (e.g. a repo made from the wrong template) -> it
    // can't build, so it earns 0 rather than aborting the whole sweep.
    return { passed: 0, total: 0, malformed: true };
  }
  try {
    quiet("npx vitest run --reporter=json --outputFile=.vit.json", { cwd: dir });
  } catch {
    /* tests failing -> non-zero exit is expected; results still written */
  }
  const out = `${dir}/.vit.json`;
  if (!existsSync(out)) return { passed: 0, total: 0 };
  const r = JSON.parse(readFileSync(out, "utf8"));
  // The same report carries each test's title; keep the failed ones (titles
  // only) so AI feedback can explain the real failures. In memory only.
  const failures = [];
  for (const f of r.testResults ?? []) {
    for (const t of f.assertionResults ?? []) {
      if (t.status !== "passed") failures.push({ title: t.fullName || t.title || "(unnamed check)" });
    }
  }
  return { passed: r.numPassedTests ?? 0, total: r.numTotalTests ?? 0, failures };
}

function gradeDart(dir, id) {
  cpSync(`grader/${id}`, dir, { recursive: true }); // overlay canonical tests
  try {
    quiet("dart pub get", { cwd: dir });
  } catch {
    // No/broken pubspec (e.g. a repo made from the wrong template) -> it can't
    // build, so it earns 0 rather than aborting the whole sweep.
    return { passed: 0, total: 0, malformed: true };
  }
  let out = "";
  try {
    out = execSync("dart test --reporter json", {
      cwd: dir, encoding: "utf8", maxBuffer: 1e8, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    out = (e.stdout || "").toString(); // tests failing -> non-zero exit; stdout still has the json events
  }
  let passed = 0, total = 0;
  const names = new Map(); // testID -> name (from testStart events)
  const failures = [];
  for (const line of out.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let e;
    try { e = JSON.parse(s); } catch { continue; }
    if (e.type === "testStart" && e.test) names.set(e.test.id, e.test.name);
    if (e.type === "testDone" && e.hidden !== true) {
      total++;
      if (e.result === "success") passed++;
      else failures.push({ title: names.get(e.testID) || "(unnamed check)" });
    }
  }
  return { passed, total, failures };
}

function gradeQuiz(dir, keyPath) {
  const key = JSON.parse(readFileSync(keyPath, "utf8"));
  const ansPath = `${dir}/answers.json`;
  const ans = existsSync(ansPath) ? JSON.parse(readFileSync(ansPath, "utf8")) : {};
  const norm = (v) => String(v ?? "").trim().toLowerCase();
  const qs = Object.keys(key);
  const passed = qs.filter((q) => norm(ans[q]) === norm(key[q])).length;
  return { passed, total: qs.length };
}

// Read a student's identity from their student.json (if present in the clone).
function readStudent(dir) {
  try {
    const s = JSON.parse(readFileSync(`${dir}/student.json`, "utf8"));
    return {
      githubAccount: s.githubAccount || "",
      fullName: s.fullName || "",
      studentNumber: s.studentNumber || "",
      studentEmail: s.studentEmail || "",
      classCode: s.classCode || "",
    };
  } catch {
    return { githubAccount: "", fullName: "", studentNumber: "", studentEmail: "", classCode: "" };
  }
}

// ---- sweep ---------------------------------------------------------------
for (const a of assignments) {
  for (const repo of listRepos(a.namePrefix)) {
    const dir = `${WORK}/${repo}`;
    // A clone can fail transiently (network / secondary rate limit) or for a
    // genuinely broken repo. Don't let one bad clone abort the whole sweep -
    // skip it this run (it gets picked up next time), with one quick retry.
    try { quiet(`gh repo clone ${OWNER}/${repo} ${dir} -- -q`); }
    catch {
      try { quiet(`gh repo clone ${OWNER}/${repo} ${dir} -- -q`); }
      catch { console.log(`skip  ${repo} (${a.id}) - clone failed (transient or broken); will retry next run`); continue; }
    }
    // Submission sha = latest commit touching anything other than the receipt
    // files, so our own receipt commits never make the next run re-grade.
    const sha =
      sh(`git -C ${dir} log -1 --format=%H -- . ':!grades' ':!GRADES.md'`) ||
      sh(`git -C ${dir} rev-parse HEAD`);
    const stu = readStudent(dir);
    const alreadyGraded = seen.has(`${repo}|${a.id}`);
    // LOCKED assignment: a grade already recorded is frozen (re-submissions are
    // ignored). A student not yet graded can still be graded, but flagged late.
    if (a.locked && alreadyGraded) {
      const ex = rows.find((r) => r.repo === repo && r.assignment === a.id);
      if (ex) Object.assign(ex, stu);
      console.log(`lock  ${repo} (${a.id}) - frozen (locked, already graded)`);
      continue;
    }
    // UNLOCKED: skip if unchanged since last grade (unless --force).
    if (!a.locked && !force && seen.get(`${repo}|${a.id}`) === sha) {
      const ex = rows.find((r) => r.repo === repo && r.assignment === a.id);
      if (ex) Object.assign(ex, stu); // keep roster info fresh even when skipping
      console.log(`skip  ${repo} (${a.id}) - already graded @ ${sha.slice(0, 7)}`);
      continue;
    }
    const res =
      a.type === "quiz" ? gradeQuiz(dir, a.key)
      : a.type === "dart" ? gradeDart(dir, a.id)
      : gradeVitest(dir, a.id);
    const score = res.total ? `${res.passed}/${res.total}` : "0/0";
    const late = !!a.locked && !alreadyGraded; // first grade on a locked activity = late
    const row = { repo, ...stu, assignment: a.id, sha, passed: res.passed, total: res.total, score, late, gradedAt: new Date().toISOString(), notes: "", aiScore: null, failures: res.failures || [] };
    const idx = rows.findIndex((r) => r.repo === repo && r.assignment === a.id);
    if (idx >= 0) rows[idx] = row; else rows.push(row);
    seen.set(`${repo}|${a.id}`, sha);
    gradedThisRun.add(`${repo}|${a.id}`); // genuinely (re)graded now -> eligible for AI notes
    const flags = `${late ? " LATE" : ""}${res.malformed ? " MALFORMED(wrong-template?)" : ""}`;
    console.log(`${dryRun ? "[dry-run] " : ""}grade ${repo} (${a.id}): ${score}${flags}`);
  }
}

// ---- AI feedback notes (after grading; best-effort) ----------------------
await runNotesPass(rows, assignments, gradedThisRun, { work: WORK });

// ---- write gradebook -----------------------------------------------------
mkdirSync("gradebook", { recursive: true });
writeFileSync(
  CSV,
  HEADER + "\n" +
    rows.map((r) =>
      [
        r.repo, r.githubAccount, r.fullName, r.studentNumber, r.studentEmail,
        r.classCode, r.assignment, r.sha, r.passed, r.total, r.score, r.gradedAt,
        r.late ? "true" : "", encNotes(r.notes), r.aiScore ?? "", encFails(r.failures),
      ].map(csvField).join(",")
    ).join("\n") + "\n",
);
// Teacher copy of each fresh note (with instructor-only triage flags). Written
// only for rows regenerated this run; prior notes stay committed on disk.
const notePath = (r) => `gradebook/notes/${r.assignment}/${r.repo}.md`;
for (const r of rows) {
  if (!r.notesInstructor) continue;
  mkdirSync(`gradebook/notes/${r.assignment}`, { recursive: true });
  writeFileSync(notePath(r), `# ${r.repo} - ${r.assignment} (${r.score})\n\n_AI draft for the subjective rubric. Review before grading._\n\n${r.notesInstructor}\n`);
}
const hasNote = (r) => existsSync(notePath(r));
const totalPtsOf = new Map(assignments.map((a) => [a.id, a.totalPoints]));
// "Feedback" column shows the AI's proposed total grade (out of the activity's
// points, when it returned one) linked to the full note, for at-a-glance review.
const fbCell = (r) => {
  if (!hasNote(r)) return "";
  const pts = totalPtsOf.get(r.assignment);
  const label = r.aiScore != null ? `${r.aiScore}/${pts || 100}` : "notes";
  return `[${label}](notes/${r.assignment}/${r.repo}.md)`;
};
const md = [
  `# Gradebook - section ${section}`,
  "",
  "| Student | Number | GitHub | Assignment | Grade | Feedback | Late | Commit | Graded |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...rows.map((r) =>
    `| ${r.fullName || "?"} | ${r.studentNumber || "?"} | ${r.githubAccount || r.repo} | ${r.assignment} | ${r.score} | ${fbCell(r)} | ${r.late ? "LATE" : ""} | \`${r.sha.slice(0, 7)}\` | ${r.gradedAt.slice(0, 16).replace("T", " ")} |`
  ),
  "",
].join("\n");
writeFileSync("gradebook/GRADEBOOK.md", md);
console.log("\ngradebook written:");
console.log(md);
console.log("\n(grading only; deliver to students with: node tools/publish-grades.mjs " + section + " --execute  - after setting \"publish\": true on the ready activities)");
