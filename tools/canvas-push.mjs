#!/usr/bin/env node
// Push gradebook scores straight into Canvas over the REST API.
//
// Closes the loop the CSV export leaves open: instead of you pasting a Canvas
// export and re-importing a file, this pulls the roster + assignments live, maps
// our grades onto them, and (on a real run) writes the grades directly.
//
// DRY RUN BY DEFAULT. It prints/records exactly what it WOULD write and never
// touches Canvas until you pass --execute. --check goes further and only
// reconciles the roster (no grade plan at all).
//
// Auth (never commit these):
//   CANVAS_BASE_URL   e.g. https://your-school.instructure.com
//   CANVAS_TOKEN      a Canvas access token with grade-write rights
//
// Usage:
//   node tools/canvas-push.mjs [--course=<id>] [--section=<code>] [--check]
//                              [--execute] [--comment] [--report=<path>]
//   (course defaults to the CANVAS_COURSE_ID env baked into the workflow)
//
// Behaviour vs grader/assignments.json:
//   * manual: true       -> never pushed (don't overwrite a hand-entered grade).
//   * autoPoints: <n>     -> only the objective n points are pushed; the rubric
//                            remainder stays a manual top-up.
//   * locked: true        -> a first grade is sent, but an existing Canvas grade
//                            is NEVER overwritten (unlocked grades always are).

import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import {
  tokenToId, loadPolicy, loadGradebook, consolidate, matchGroups, pointsFor,
} from "./lib/gradebook.mjs";

// ---- args / env ----------------------------------------------------------
const arg = (name, def = null) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : def;
};
const flag = (name) => process.argv.includes(`--${name}`);
// Course is constant per section, so it's normally baked into the workflow's
// CANVAS_COURSE_ID env; --course is an optional override.
const courseId = arg("course") || process.env.CANVAS_COURSE_ID || "";
const sectionArg = arg("section");
const reportPath = arg("report", "gradebook/canvas-push-report.md");
const checkOnly = flag("check");
const execute = flag("execute");
const withComment = flag("comment");

const BASE = (process.env.CANVAS_BASE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.CANVAS_TOKEN || "";
const OWNER = process.env.GRADE_OWNER || "";   // org, for the commit reference URL
if (!courseId) { console.error("no course: set CANVAS_COURSE_ID in the env or pass --course=<id>"); process.exit(1); }
if (!BASE || !TOKEN) { console.error("set CANVAS_BASE_URL and CANVAS_TOKEN in the environment"); process.exit(1); }

// An informational submission comment a student (or you) can use as a reference.
const fmtDate = (iso) => {
  const m = String(iso || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]} UTC` : (iso || "unknown");
};
// Informational comment, formatted as a plain-text bullet list (Canvas keeps
// line breaks in submission comments, so a "- " list reads cleanly).
const buildComment = (t, score, pts) => {
  const sha7 = (score.sha || "").slice(0, 7);
  const url = OWNER && score.repo && score.sha ? `https://github.com/${OWNER}/${score.repo}/commit/${score.sha}` : "";
  const lines = [`- Graded on: ${fmtDate(score.gradedAt)}`];
  if (score.repo) lines.push(`- Submission: ${score.repo}${sha7 ? `@${sha7}` : ""}${score.late ? "  (submitted late)" : ""}`);
  if (t.autoPoints != null) {
    const rubric = t.pointsPossible != null ? t.pointsPossible - t.autoPoints : null;
    lines.push(`- Score: ${pts}/${t.autoPoints} on the automated portion. The remaining ${rubric ?? "rubric"} point(s) are graded by hand against the design rubric.`);
  } else {
    lines.push(`- Score: ${score.passed}/${score.total} automated test case(s) passed (test cases map 1:1 to points).`);
  }
  if (url) lines.push(`- Reference: ${url}`);
  return lines.join("\n");
};

// ---- Canvas REST client --------------------------------------------------
const api = async (path, init = {}) => {
  const url = path.startsWith("http") ? path : `${BASE}/api/v1${path}`;
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(30000),   // never let a single request hang the run
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${url}: ${(await res.text()).slice(0, 300)}`);
  return res;
};
// GET every page (Canvas paginates via the Link header's rel="next").
const apiGetAll = async (path) => {
  let url = `${BASE}/api/v1${path}${path.includes("?") ? "&" : "?"}per_page=100`;
  const out = [];
  while (url) {
    const res = await api(url);
    out.push(...(await res.json()));
    const next = (res.headers.get("link") || "").split(",").find((s) => s.includes('rel="next"'));
    url = next ? next.slice(next.indexOf("<") + 1, next.indexOf(">")) : null;
  }
  return out;
};

// ---- our gradebook -------------------------------------------------------
const { rows, section } = loadGradebook("gradebook/grades.csv", sectionArg);
const policy = loadPolicy();
const groups = consolidate(rows, section);

// ---- pull roster + assignments live --------------------------------------
console.log(`canvas-push: course ${courseId} on ${BASE} (${checkOnly ? "check only" : execute ? "EXECUTE" : "dry run"})`);
const students = await apiGetAll(`/courses/${courseId}/users?enrollment_type[]=student&include[]=enrollments&include[]=email`);
// Canvas exposes sis_user_id / login_id only when the token has SIS-data rights;
// fall back to email so matching still works without that permission.
const sisOf = (s) => s.sis_user_id || "";
const loginOf = (s) => s.login_id || s.email || "";
const { pairs, unmatched, groupOf } = matchGroups(groups, students, { sisOf, loginOf, nameOf: (s) => s.name });
const matchedCount = students.filter((s) => groupOf.has(s)).length;

const md = [
  `# Canvas push report - section ${section ?? "?"} (course ${courseId})`,
  "",
  `- Mode: **${checkOnly ? "check only (no grades)" : execute ? "EXECUTE (grades written)" : "dry run (nothing written)"}**`,
  `- Students in Canvas: **${students.length}**`,
  `- Matched to a grade group: **${matchedCount}**`,
  "",
];
if (unmatched.length) {
  md.push("## Grade groups NOT matched to a Canvas student (fix the student.json)", "");
  md.push("| Student (as graded) | Reason |", "| --- | --- |");
  md.push(...unmatched.map((u) => `| ${u.group.name || u.group.rows[0]?.repo || "?"} | ${u.reason} |`), "");
}

// ---- check-only stops here -----------------------------------------------
if (checkOnly) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, md.join("\n") + "\n");
  console.log(`  matched ${matchedCount}/${students.length}; ${unmatched.length} unmatched`);
  console.log(`  report: ${reportPath}`);
  process.exit(0);
}

// ---- map our assignments onto Canvas assignments -------------------------
const assignments = await apiGetAll(`/courses/${courseId}/assignments`);
const targets = [];           // { ourId, canvasId, name, pointsPossible, autoPoints, locked }
const skippedManual = [];
const heldForReview = [];     // AI-graded: proposed grade awaits your review
const pointsMismatch = [];    // declared totalPoints != Canvas points_possible
for (const a of assignments) {
  const ourId = tokenToId(a.name);
  if (!ourId) continue;
  const pol = policy.get(ourId) || {};
  // Reconcile what assignments.json says the activity is worth against Canvas's
  // live value (covers held/manual activities too, before they are skipped).
  if (pol.totalPoints != null && a.points_possible != null && +a.points_possible !== pol.totalPoints) {
    pointsMismatch.push({ ourId, name: a.name, declared: pol.totalPoints, canvas: a.points_possible });
  }
  if (pol.manual) { skippedManual.push({ ourId, name: a.name }); continue; }
  // AI-graded rubric activities are NOT pushed with the raw test score - their
  // grade is the objective score plus a reviewed design score. Until that
  // review-then-publish path is wired, hold them out of the auto-push.
  if (pol.aiGraded) { heldForReview.push({ ourId, name: a.name }); continue; }
  targets.push({ ourId, canvasId: a.id, name: a.name, pointsPossible: a.points_possible ?? null, autoPoints: pol.autoPoints ?? null, locked: !!pol.locked });
}

// A points mismatch is a setup error (assignments.json and Canvas disagree on
// what an activity is worth), so flag it loudly in its own document for you to
// fix - the AI rubric and the grade total both depend on getting this right.
const FLAG_PATH = "gradebook/points-mismatch.md";
if (pointsMismatch.length) {
  mkdirSync(dirname(FLAG_PATH), { recursive: true });
  writeFileSync(FLAG_PATH, [
    "# Points mismatch - fix before grading",
    "",
    "`totalPoints` in `grader/assignments.json` disagrees with the activity's",
    "**Points Possible** in Canvas. Make them match (usually edit Canvas, or the",
    "JSON), then re-run. The objective/rubric split itself lives in `RUBRIC.md`.",
    "",
    "| Activity | Canvas name | assignments.json | Canvas |",
    "| --- | --- | --- | --- |",
    ...pointsMismatch.map((m) => `| \`${m.ourId}\` | ${m.name} | ${m.declared} | ${m.canvas} |`),
    "",
  ].join("\n"));
  console.log(`  ⚠ points mismatch on ${pointsMismatch.length} activity(ies) -> ${FLAG_PATH}`);
  md.push("", `## ⚠ Points mismatch (${pointsMismatch.length})`, "", `See \`${FLAG_PATH}\` - \`totalPoints\` disagrees with Canvas Points Possible.`, "");
} else {
  rmSync(FLAG_PATH, { force: true });
}

// Fetch existing submissions when we need them: for locked activities (to know
// who Canvas already graded, so we never overwrite) and/or when posting comments
// (to know which comments already exist, so we don't stack duplicates). Each
// assignment is fetched at most once.
const alreadyGraded = new Map();      // canvasId -> Set(userId)             [locked]
const existingComments = new Map();   // canvasId -> Map(userId -> Set(text)) [comments]
for (const t of targets.filter((x) => x.locked || withComment)) {
  let subs = [];
  try {
    subs = await apiGetAll(`/courses/${courseId}/assignments/${t.canvasId}/submissions${withComment ? "?include[]=submission_comments" : ""}`);
  } catch { subs = []; }   // a fetch hiccup must not block grades; treat as "none known"
  if (t.locked) {
    alreadyGraded.set(t.canvasId, new Set(
      subs.filter((s) => s.score != null || (s.grade != null && s.grade !== "")).map((s) => s.user_id),
    ));
  }
  if (withComment) {
    const byUser = new Map();
    for (const s of subs) byUser.set(s.user_id, new Set((s.submission_comments || []).map((c) => c.comment)));
    existingComments.set(t.canvasId, byUser);
  }
}
let skippedLocked = 0, skippedComment = 0;

// ---- build the grade plan ------------------------------------------------
// gradeData[canvasId] = { [userId]: { posted_grade, text_comment? } }
const plan = new Map();
const planRows = [];          // for the report
for (const { student, group } of pairs) {
  for (const t of targets) {
    const score = group.scores.get(t.ourId);
    const pts = pointsFor(score, t);
    if (pts == null) continue;
    // Locked + already graded in Canvas -> leave it; never overwrite.
    if (t.locked && alreadyGraded.get(t.canvasId)?.has(student.id)) { skippedLocked++; continue; }
    if (!plan.has(t.canvasId)) plan.set(t.canvasId, {});
    const entry = { posted_grade: pts };
    if (withComment) {
      const text = buildComment(t, score, pts);
      const seen = existingComments.get(t.canvasId)?.get(student.id);
      if (seen && seen.has(text)) skippedComment++;   // identical comment already there -> don't stack
      else entry.text_comment = text;
    }
    plan.get(t.canvasId)[student.id] = entry;
    planRows.push({ name: student.name, ourId: t.ourId, pts, possible: t.pointsPossible, sub: t.autoPoints != null });
  }
}
const totalCells = planRows.length;

md.push("## Grade plan", "", `Cells to write: **${totalCells}** across **${plan.size}** assignment(s).`, "");
if (skippedLocked) md.push("", `_Left untouched: **${skippedLocked}** locked grade(s) already present in Canvas (not overwritten)._`, "");
if (withComment && skippedComment) md.push("", `_Comments: **${skippedComment}** identical comment(s) already on Canvas, not re-posted (no stacking)._`, "");
md.push("| Student | Assignment | Points | Out of | Note |", "| --- | --- | --- | --- | --- |");
md.push(...planRows
  .sort((a, b) => a.name.localeCompare(b.name) || a.ourId.localeCompare(b.ourId))
  .map((p) => `| ${p.name} | ${p.ourId} | ${p.pts} | ${p.possible ?? "?"} | ${p.sub ? "objective only - add subjective by hand" : ""} |`));
md.push("");
const subjectiveTargets = targets.filter((t) => t.autoPoints != null && plan.has(t.canvasId));
if (subjectiveTargets.length) {
  md.push("## ⚠ Add subjective points manually in Canvas", "");
  md.push(...subjectiveTargets.map((t) => `- \`${t.ourId}\` -> ${t.name}: pushed objective ${t.autoPoints}, add the remaining ${t.pointsPossible != null ? t.pointsPossible - t.autoPoints : "?"} by hand`), "");
}
if (heldForReview.length) {
  md.push("## Held for AI review (not pushed)", "");
  md.push("Review the AI-proposed feedback/score in `gradebook/`, edit as needed, then publish these.", "");
  md.push(...heldForReview.map((s) => `- \`${s.ourId}\` -> ${s.name}`), "");
}
if (skippedManual.length) {
  md.push("## Skipped - manual (graded by hand in Canvas)", "");
  md.push(...skippedManual.map((s) => `- \`${s.ourId}\` -> ${s.name}`), "");
}

// ---- execute (or stop at the dry run) ------------------------------------
if (!execute) {
  md.unshift("> Dry run - nothing was written. Re-run with --execute to push.", "");
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, md.join("\n") + "\n");
  console.log(`  DRY RUN: would write ${totalCells} grade(s) across ${plan.size} assignment(s); ${unmatched.length} unmatched`);
  if (withComment) console.log(`  comments: ${skippedComment} already present (skipped), rest would post`);
  console.log(`  report: ${reportPath}  (re-run with --execute to push)`);
  process.exit(0);
}

// Fire every assignment's bulk update first (each returns a Progress almost
// immediately), THEN poll all the Progress objects in parallel. Canvas applies
// the grades server-side, so polling serially just wastes runner minutes - this
// collapses the wait from the sum of all batches to roughly the slowest one.
const posted = [];
for (const [canvasId, gradeData] of plan) {
  const res = await api(`/courses/${courseId}/assignments/${canvasId}/submissions/update_grades`, {
    method: "POST",
    body: JSON.stringify({ grade_data: gradeData }),
  });
  posted.push({ canvasId, n: Object.keys(gradeData).length, progress: await res.json() });
}
let wrote = 0;
await Promise.all(posted.map(async ({ canvasId, n, progress }) => {
  // Poll this Progress to completion, capped so a slow one can't hang the run.
  for (let p = 0; p < 40 && progress.url && progress.workflow_state
       && !["completed", "failed"].includes(progress.workflow_state); p++) {
    await new Promise((r) => setTimeout(r, 1500));
    try { progress = await (await api(progress.url)).json(); } catch { break; }
  }
  const state = progress.workflow_state || "unknown";
  if (state === "failed") console.log(`  assignment ${canvasId}: FAILED (${n} grades)`);
  else { wrote += n; console.log(`  assignment ${canvasId}: ${n} grade(s) [${state}]`); }
}));
md.unshift(`> EXECUTED - wrote ${wrote} grade(s) to Canvas.`, "");
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, md.join("\n") + "\n");
console.log(`  EXECUTED: wrote ${wrote} grade(s); ${unmatched.length} unmatched - see ${reportPath}`);
