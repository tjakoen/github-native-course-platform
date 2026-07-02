#!/usr/bin/env node
// Populate `totalPoints` in grader/assignments.json from Canvas.
//
// Canvas is the source of truth for what an activity is worth. This reads each
// assignment's Points Possible live and writes it back as `totalPoints`, so the
// JSON documents the real value and the grade sweep / canvas-push can reconcile
// against it (a later mismatch is flagged, not silently wrong).
//
// READ-ONLY BY DEFAULT: prints the plan and writes nothing until --execute. Even
// with --execute it only ever edits grader/assignments.json (never Canvas).
//
// Auth (same as canvas-push):
//   CANVAS_BASE_URL, CANVAS_TOKEN, and CANVAS_COURSE_ID (or --course=<id>).
//
// Usage: node tools/canvas-pull-points.mjs [--course=<id>] [--execute]

import { readFileSync, writeFileSync } from "node:fs";
import { tokenToId } from "./lib/gradebook.mjs";

const arg = (n, d = null) => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.split("=").slice(1).join("=") : d;
};
const execute = process.argv.includes("--execute");
const courseId = arg("course") || process.env.CANVAS_COURSE_ID || "";
const BASE = (process.env.CANVAS_BASE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.CANVAS_TOKEN || "";
const PATH = "grader/assignments.json";
if (!courseId) { console.error("no course: set CANVAS_COURSE_ID or pass --course=<id>"); process.exit(1); }
if (!BASE || !TOKEN) { console.error("set CANVAS_BASE_URL and CANVAS_TOKEN in the environment"); process.exit(1); }

const api = async (path) => {
  const url = path.startsWith("http") ? path : `${BASE}/api/v1${path}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${url}`);
  return res;
};
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

// Re-serialize one assignment object on a single line, in its existing key order,
// matching the file's `{ "k": v, ... }` style. totalPoints is inserted right
// after namePrefix when it is new, so diffs stay minimal and readable.
const lineFor = (obj) => {
  // Existing keys minus totalPoints (re-placed below) and any undefined values.
  const keys = Object.keys(obj).filter((k) => k !== "totalPoints" && obj[k] !== undefined);
  if (obj.totalPoints !== undefined) {
    const at = keys.indexOf("namePrefix"); // place it right after namePrefix for tidy diffs
    keys.splice(at >= 0 ? at + 1 : keys.length, 0, "totalPoints");
  }
  return "  { " + keys.map((k) => `"${k}": ${JSON.stringify(obj[k])}`).join(", ") + " }";
};

// ---- pull + plan ---------------------------------------------------------
console.log(`canvas-pull-points: course ${courseId} on ${BASE} (${execute ? "EXECUTE" : "dry run"})`);
const canvasPts = new Map(); // ourId -> points_possible
for (const a of await apiGetAll(`/courses/${courseId}/assignments`)) {
  const ourId = tokenToId(a.name);
  if (ourId && a.points_possible != null) canvasPts.set(ourId, a.points_possible);
}

const list = JSON.parse(readFileSync(PATH, "utf8"));
const changes = [], unmapped = [];
for (const obj of list) {
  const pts = canvasPts.get(obj.id);
  if (pts == null) { unmapped.push(obj.id); continue; }
  if (obj.totalPoints !== pts) {
    changes.push({ id: obj.id, from: obj.totalPoints ?? "(none)", to: pts });
    obj.totalPoints = pts;
  }
}

console.log(`\n${changes.length} change(s):`);
for (const c of changes) console.log(`  ${c.id}: ${c.from} -> ${c.to}`);
if (unmapped.length) console.log(`\nno Canvas match (left as-is): ${unmapped.join(", ")}`);

if (!execute) {
  console.log(`\nDRY RUN: nothing written. Re-run with --execute to update ${PATH}.`);
  process.exit(0);
}
if (!changes.length) { console.log(`\n${PATH} already matches Canvas; nothing to write.`); process.exit(0); }
writeFileSync(PATH, "[\n" + list.map(lineFor).join(",\n") + "\n]\n");
console.log(`\nwrote ${PATH} (${changes.length} updated).`);
