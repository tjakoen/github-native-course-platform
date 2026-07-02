#!/usr/bin/env node
// Build a Canvas grade-import CSV from our gradebook.
//
// Canvas exports a wide gradebook: one row per student, identity columns
// (Student, ID, SIS User ID, SIS Login ID, Section) then one column per
// assignment headed "Assignment Name (<canvasAssignmentId>)", with a second
// "Points Possible" row. Our gradebook/grades.csv is the opposite shape: one
// row per (repo, assignment) with a passed/total score. This script pivots ours
// into Canvas's shape so the result can be re-imported.
//
// What it guarantees:
//   * Every emitted assignment column keeps the exact "(id)" from the export, so
//     a re-import UPDATES that assignment instead of creating a duplicate.
//   * Only assignments we actually have grades for are emitted; everything else
//     in the Canvas gradebook is left untouched on import.
//   * Identity columns are echoed VERBATIM from the export, so Canvas matches
//     each row back to the right enrollment by its own ID.
//   * Activities flagged "manual" in grader/assignments.json are skipped, so a
//     hand-entered (subjective) Canvas grade is never overwritten.
//
// Usage:
//   node tools/canvas-export.mjs --canvas=<canvas-export.csv> [--out=<path>]
//                                [--report=<path>] [--section=<code>]
//
// Defaults: --out=gradebook/canvas-import.csv, --report=gradebook/canvas-import-report.md
//
// The student-matching logic (normalize -> consolidate -> join) lives in
// tools/lib/gradebook.mjs and is shared with tools/canvas-push.mjs.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  parseCsv, csvField, tokenToId, loadPolicy, loadGradebook, consolidate,
  matchGroups, pointsFor, normNum, normEmail,
} from "./lib/gradebook.mjs";

// ---- args ----------------------------------------------------------------
const arg = (name, def = null) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : def;
};
const canvasPath = arg("canvas");
const outPath = arg("out", "gradebook/canvas-import.csv");
const reportPath = arg("report", "gradebook/canvas-import-report.md");
const sectionArg = arg("section");
if (!canvasPath) {
  console.error("usage: canvas-export.mjs --canvas=<canvas-export.csv> [--out=] [--report=] [--section=]");
  process.exit(1);
}

// ---- our gradebook -------------------------------------------------------
const { rows, section } = loadGradebook("gradebook/grades.csv", sectionArg);
const policy = loadPolicy();
const groups = consolidate(rows, section);

// ---- read the Canvas export ----------------------------------------------
const canvasRows = parseCsv(readFileSync(canvasPath, "utf8"));
if (canvasRows.length < 2) { console.error("canvas export looks empty"); process.exit(1); }
const cHeader = canvasRows[0];
const cIdx = (name) => cHeader.findIndex((h) => h.trim() === name);
const idxStudent = cIdx("Student"), idxId = cIdx("ID");
const idxSis = cIdx("SIS User ID"), idxLogin = cIdx("SIS Login ID"), idxSection = cIdx("Section");
if (idxId < 0 || idxSis < 0) { console.error("canvas export missing ID / SIS User ID columns"); process.exit(1); }
// "Points Possible" is the row whose first cell is exactly that.
const ppRow = canvasRows.find((r) => (r[0] || "").trim() === "Points Possible") || [];

// Assignment columns we can target: header ends in "(digits)" AND its leading
// token maps to one of our assignment ids that is NOT manual.
const assignmentCols = [];
const skippedManual = [];
const unmappedHeaders = [];
cHeader.forEach((h, idx) => {
  const m = String(h).match(/\((\d+)\)\s*$/);
  if (!m) return;                                  // not a gradable assignment column
  const ourId = tokenToId(h);
  if (!ourId) { unmappedHeaders.push(h.trim()); return; }
  const pol = policy.get(ourId) || {};
  // manual = hand-graded in Canvas; aiGraded = held for review-then-publish.
  // Neither is exported with the raw test score.
  if (pol.manual || pol.aiGraded) { skippedManual.push({ ourId, header: h.trim() }); return; }
  const pp = parseFloat(ppRow[idx]);
  assignmentCols.push({
    idx, header: h.trim(), ourId, canvasId: m[1],
    pointsPossible: Number.isFinite(pp) ? pp : null,
    autoPoints: pol.autoPoints ?? null,
  });
});

// Student rows = rows that carry a numeric Canvas ID (skips the Points Possible row).
const students = canvasRows.slice(1).filter((r) => /^\d+$/.test((r[idxId] || "").trim()));
const { groupOf, unmatched } = matchGroups(groups, students, {
  sisOf: (r) => r[idxSis],
  loginOf: (r) => (idxLogin >= 0 ? r[idxLogin] : ""),
  nameOf: (r) => r[idxStudent],
});
const matchedCount = students.filter((r) => groupOf.has(r)).length;

// ---- write the import CSV ------------------------------------------------
const cell = (g, ac) => {
  const v = pointsFor(g?.scores.get(ac.ourId), ac);
  return v == null ? "" : String(v);
};
mkdirSync(dirname(outPath), { recursive: true });
const idCols = [idxStudent, idxId, idxSis, idxLogin, idxSection].filter((i) => i >= 0);
const headerOut = [...idCols.map((i) => cHeader[i]), ...assignmentCols.map((a) => a.header)];
const ppOut = [...idCols.map((i) => (i === idxStudent ? "Points Possible" : "")), ...assignmentCols.map((a) => (a.pointsPossible ?? ""))];
const lines = [headerOut, ppOut];
let filledCells = 0;
const perAssignment = new Map(assignmentCols.map((a) => [a.ourId, 0]));
for (const r of students) {
  const g = groupOf.get(r);
  const cells = assignmentCols.map((ac) => {
    const v = g ? cell(g, ac) : "";
    if (v !== "") { filledCells++; perAssignment.set(ac.ourId, perAssignment.get(ac.ourId) + 1); }
    return v;
  });
  lines.push([...idCols.map((i) => r[i]), ...cells]);
}
writeFileSync(outPath, lines.map((row) => row.map(csvField).join(",")).join("\n") + "\n");

// ---- report --------------------------------------------------------------
const noGrades = students.filter((r) => !groupOf.has(r));
const ourAssignmentIds = new Set();
for (const g of groups) for (const id of g.scores.keys()) ourAssignmentIds.add(id);
const mappedIds = new Set(assignmentCols.map((a) => a.ourId));
const noCanvasColumn = [...ourAssignmentIds].filter((id) => !mappedIds.has(id) && !(policy.get(id)?.manual)).sort();

const md = [
  `# Canvas import report${section ? ` - section ${section}` : ""}`,
  "",
  `- Canvas export: \`${canvasPath}\``,
  `- Output: \`${outPath}\``,
  `- Canvas students in export: **${students.length}**`,
  `- Matched to a grade group: **${matchedCount}**`,
  `- Assignment columns emitted: **${assignmentCols.length}** (${assignmentCols.map((a) => a.ourId).join(", ") || "none"})`,
  `- Cells filled: **${filledCells}**`,
  "",
  "Every emitted column carries its Canvas `(id)`, so re-importing this file",
  "updates those assignments in place - it does not create duplicates, and any",
  "assignment or student not in this file is left untouched.",
  "",
  "## Cells filled per assignment",
  "",
  "| Assignment | Canvas column | Points possible | Students filled | Note |",
  "| --- | --- | --- | --- | --- |",
  ...assignmentCols.map((a) => `| ${a.ourId} | ${a.header} | ${a.pointsPossible ?? "?"} | ${perAssignment.get(a.ourId)} | ${a.autoPoints != null ? `**objective ${a.autoPoints}pt only - add subjective by hand**` : ""} |`),
  "",
];
const subjectiveCols = assignmentCols.filter((a) => a.autoPoints != null);
if (subjectiveCols.length) {
  md.push("## ⚠ Go back and add subjective points manually in Canvas", "");
  md.push("These activities have a subjective rubric the autograder can't score.",
    "The cells below hold only the **objective** portion; open each in Canvas and",
    "add the rubric points on top of what's imported.", "");
  md.push("| Assignment | Canvas column | Objective (auto) | Subjective to add by hand |", "| --- | --- | --- | --- |");
  md.push(...subjectiveCols.map((a) => `| ${a.ourId} | ${a.header} | ${a.autoPoints} | ${a.pointsPossible != null ? a.pointsPossible - a.autoPoints : "?"} |`), "");
}
if (skippedManual.length) {
  md.push("## Skipped - graded entirely by hand in Canvas (manual)", "");
  md.push(...skippedManual.map((s) => `- \`${s.ourId}\` -> ${s.header}`), "");
}
if (unmatched.length) {
  md.push("## Grade groups NOT matched to a Canvas student (fix the student.json)", "");
  md.push("| Student (as graded) | Reason |", "| --- | --- |");
  md.push(...unmatched.map((u) => `| ${u.group.name || u.group.rows[0]?.repo || "?"} | ${u.reason} |`), "");
}
if (noCanvasColumn.length) {
  md.push("## Graded assignments with no matching Canvas column (map manually)", "");
  md.push(...noCanvasColumn.map((id) => `- \`${id}\``), "");
}
if (unmappedHeaders.length) {
  md.push("## Canvas assignment columns we did not target", "");
  md.push("_Left untouched on import (no matching activity, or flagged manual)._", "");
  md.push(...unmappedHeaders.map((h) => `- ${h}`), "");
}
if (noGrades.length) {
  md.push(`## Canvas students with no grades yet (${noGrades.length})`, "");
  md.push(...noGrades.map((r) => `- ${r[idxStudent]} (${r[idxSis]})`), "");
}
writeFileSync(reportPath, md.join("\n") + "\n");

// ---- console summary -----------------------------------------------------
console.log(`canvas-export: ${matchedCount}/${students.length} students matched, ${filledCells} cells filled`);
console.log(`  out:    ${outPath}`);
console.log(`  report: ${reportPath}`);
if (unmatched.length) console.log(`  WARNING: ${unmatched.length} grade group(s) did not match a Canvas student - see report`);
if (noCanvasColumn.length) console.log(`  note: ${noCanvasColumn.length} graded assignment(s) had no Canvas column - see report`);
if (subjectiveCols.length) console.log(`  ACTION: ${subjectiveCols.length} subjective activity(ies) need a manual top-up in Canvas - see report (${subjectiveCols.map((a) => a.ourId).join(", ")})`);
if (skippedManual.length) console.log(`  note: ${skippedManual.length} fully-manual assignment(s) skipped - see report`);
