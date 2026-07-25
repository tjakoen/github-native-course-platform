// Golden-fixture byte check for the intent prompt builders (site/lib/intents.mjs).
// The apply-reviewed-grades / finalize-grades skills PARSE these prompt formats,
// so any drift in the builders is a breaking change. This script runs the six
// builders against a fixed synthetic section (zero PII) and byte-compares each
// output to the committed fixture under scripts/fixtures/intents/.
//
//   node scripts/check-intents.mjs            -> exit 1 on any mismatch
//   node scripts/check-intents.mjs --update   -> rewrite the fixtures (do this
//     ONLY for a deliberate format change, in the same commit that updates the
//     skills that parse the format)
//
// Note: apply-grades + deliver embed new Date(...).toLocaleDateString(), which
// is locale-dependent. Fixtures are generated on the instructor's machine; if a
// fixture ever mismatches ONLY on that date token, it is locale drift, not a
// format change.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildGenFeedback, buildApplyAI, buildFinalize,
  buildApplyGrades, buildDeliver, buildManualAttendance,
} from "../site/lib/intents.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "intents");
const UPDATE = process.argv.includes("--update");

// ---- synthetic section (frozen; NEVER real students) ----
const S = {
  key: "6DEMO-0000", org: "HAU-6DEMO", repo: "teacher-6demo-0000-tjakoen",
  subject: "6DEMO", section: "0000",
  assignments: [
    { id: "m1a1", kind: "push", totalPoints: 7, publish: true },
    { id: "m2a1", kind: "push", publish: false },
    { id: "m3a1", kind: "held", aiGraded: true, totalPoints: 100, feedback: "project" },
    { id: "q1", kind: "quiz", quiz: true, totalPoints: 10, publish: false },
    { id: "m6a3", kind: "manual", manual: true, totalPoints: 20 },
  ],
  students: [
    { name: "Dela Cruz, Juan", number: "20260001", github: "juandc",
      activities: { m1a1: { repo: "m1a1-0000-juandc", raw: "7/7", canvasPts: 7 },
                    m3a1: { repo: "m3a1-0000-juandc", raw: "58/58", proposed: 92, proposedMax: 100, sha: "aaaa111", aiFlag: "Low - consistent style" } } },
    { name: "Santos, Maria", number: "20260002", github: "msantos",
      activities: { m1a1: { repo: "m1a1-0000-msantos", raw: "6/7", canvasPts: 6 },
                    m3a1: { repo: "m3a1-0000-msantos", raw: "40/58", proposed: 71, proposedMax: 100, sha: "bbbb222", aiFlag: "Medium - some generated patterns" } } },
    { name: "Reyes, Pedro", number: "20260003", github: "preyes",
      activities: { m3a1: { repo: "m3a1-0000-preyes", raw: "51/58", proposed: 85, proposedMax: 100, sha: "cccc333", aiFlag: "High - large uniform commits" } } },
    { name: "Garcia, Ana", number: "20260004", github: "agarcia",
      activities: { m3a1: { repo: "m3a1-0000-agarcia", raw: "20/58", proposed: null, proposedMax: 100, sha: "dddd444" },
                    q1: { repo: "q1-0000-agarcia", raw: "8/10", canvasPts: 8 } } },
  ],
  attendance: {
    sessionDates: ["2026-01-12", "2026-01-14"],
    students: { "20260001": { count: 2, present: ["2026-01-12", "2026-01-14"] },
                "20260002": { count: 1, present: ["2026-01-12"] } },
  },
};
// review rows for m3a1: one approve+edits, one override+comment, one flag, one unreviewed
const ROWS = [
  { st: S.students[0], r: S.students[0].activities.m3a1,
    dec: { status: "approve", studentText: "Great structure. Tighten the naming.", comment: "solid work" } },
  { st: S.students[1], r: S.students[1].activities.m3a1,
    dec: { status: "override", score: 65, instructorText: "Rubric row 3 was over-credited; adjusted." } },
  { st: S.students[2], r: S.students[2].activities.m3a1,
    dec: { status: "flag", comment: "code does not match the commit history" } },
  { st: S.students[3], r: S.students[3].activities.m3a1, dec: null },
];
const GENERATED_AT = "2026-01-15T02:00:00.000Z";
const PICKED = [{ num: "20260003", name: "Reyes, Pedro" }, { num: "20260002", name: "Santos, Maria" }];
const DATE = "2026-01-14";   // 20260002 is already present that day -> exercises the NOTE line

const CASES = {
  "gen-feedback.md": () => buildGenFeedback(S, "m3a1"),
  "apply-ai.md": () => buildApplyAI(S, "m3a1", ROWS).txt,
  "finalize.md": () => buildFinalize(S, "m3a1", ROWS).txt,
  "apply-grades.md": () => buildApplyGrades(S, GENERATED_AT),
  "deliver.md": () => buildDeliver(S, GENERATED_AT).txt,
  "manual-attendance.md": () => buildManualAttendance(S, PICKED, DATE),
};

let fail = 0;
mkdirSync(DIR, { recursive: true });
for (const [file, fn] of Object.entries(CASES)) {
  const got = fn();
  const path = join(DIR, file);
  if (UPDATE) { writeFileSync(path, got); console.log("wrote", file, got.length + "B"); continue; }
  let want;
  try { want = readFileSync(path, "utf8"); }
  catch { console.error("MISSING fixture " + file + " (run with --update once)"); fail++; continue; }
  if (got === want) { console.log("ok  " + file); continue; }
  fail++;
  const gl = got.split("\n"), wl = want.split("\n");
  for (let i = 0; i < Math.max(gl.length, wl.length); i++) {
    if (gl[i] !== wl[i]) {
      console.error("DRIFT " + file + " at line " + (i + 1) + ":\n  fixture: " + JSON.stringify(wl[i]) + "\n  builder: " + JSON.stringify(gl[i]));
      break;
    }
  }
}
if (!UPDATE && fail) {
  console.error("\n" + fail + " builder(s) drifted from the golden fixtures. If the change is deliberate, update the parsing skills too, then re-run with --update.");
  process.exit(1);
}
if (!UPDATE) console.log("intent builders byte-match the golden fixtures.");
