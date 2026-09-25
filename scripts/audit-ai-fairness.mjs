#!/usr/bin/env node
// Is the AI grading balanced between students, and consistent between sections?
//
// Written after a real failure: on 2240 m5a2 the AI wrote two specific criticisms
// about a student's code and then awarded full marks on the criterion those
// criticisms belonged to, for 19 of 20 students, every one recording 50/50. The
// prose was useful and the number was meaningless. Nothing in the pipeline noticed.
//
// Four checks, each aimed at a way that failure shows up:
//
//   FLAT        scores cluster on one value, or barely discriminate at all
//   CEILING     nearly everyone in the top band
//   UNDEDUCTED  the note names a weakness and still awards the criterion full marks
//   DRIFT       the same activity scored differently in different sections
//
// Read-only. Run from the umbrella repo. Exits non-zero if anything is flagged, so
// it can gate a generation pass.
import { readFileSync, readdirSync, existsSync } from "node:fs";

const Q = String.fromCharCode(34);
function parseCsv(t) {
  const r = []; let f = "", row = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === Q) { if (t[i + 1] === Q) { f += Q; i++; } else q = false; } else f += c; }
    else if (c === Q) q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); r.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f || row.length) { row.push(f); r.push(row); }
  return r;
}
const base = "console/classes";
const dirs = readdirSync(base).filter((d) => d.startsWith("teacher-"));
const findings = [];
const byActivity = {};   // activity -> [{sec, mean, n}] for the drift check

for (const dir of dirs) {
  const sec = dir.replace("teacher-", "").replace("-tjakoen", "");
  const asg = JSON.parse(readFileSync(`${base}/${dir}/grader/assignments.json`, "utf8"));
  const aiIds = new Set(asg.filter((a) => a["ai-grading"]).map((a) => a.id));
  const maxOf = Object.fromEntries(asg.map((a) => [a.id, a.totalPoints ?? a.autoPoints ?? null]));
  const rows = parseCsv(readFileSync(`${base}/${dir}/gradebook/grades.csv`, "utf8"));
  const H = rows.shift(); const I = (n) => H.indexOf(n);

  for (const act of aiIds) {
    const scored = rows.filter((r) => r[I("assignment")] === act && r[I("aiScore")] !== "");
    if (scored.length < 8) continue;                       // too few to say anything
    const v = scored.map((r) => Number(r[I("aiScore")])).sort((a, b) => a - b);
    const max = maxOf[act];
    const mean = v.reduce((s, x) => s + x, 0) / v.length;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
    const distinct = new Set(v).size;
    (byActivity[act] ??= []).push({ sec, mean, n: v.length });

    if (sd < 0.5 || distinct <= 2)
      findings.push({ kind: "FLAT", sec, act, detail: `n=${v.length} sd=${sd.toFixed(2)} distinct=${distinct} (min ${v[0]}, max ${v[v.length - 1]})` });
    if (max && v.filter((x) => x >= max * 0.98).length / v.length > 0.8)
      findings.push({ kind: "CEILING", sec, act, detail: `${v.filter((x) => x >= max * 0.98).length} of ${v.length} at or within 2% of ${max}` });
  }

  // UNDEDUCTED: the student-facing half names something to fix, yet every
  // instructor-scored criterion is at full marks.
  const notesRoot = `${base}/${dir}/gradebook/notes`;
  if (!existsSync(notesRoot)) continue;
  for (const act of readdirSync(notesRoot)) {
    if (!aiIds.has(act)) continue;
    const files = readdirSync(`${notesRoot}/${act}`).filter((f) => f.endsWith(".md"));
    let hits = 0;
    for (const f of files) {
      const t = readFileSync(`${notesRoot}/${act}/${f}`, "utf8");
      const split = t.split(/For the instructor/i);
      if (split.length < 2) continue;
      const student = split[0], instructor = split[1];
      const crit = [...instructor.matchAll(/^-\s+[^:\n]+:\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/gm)]
        .map((m) => [Number(m[1]), Number(m[2])]);
      if (!crit.length) continue;
      const allFull = crit.every(([a, b]) => a >= b);
      const namesAProblem = /^-\s/m.test(student) && /\b(think|consider|what happens|try|revisit|missing|instead|should|could)\b/i.test(student);
      if (allFull && namesAProblem) hits++;
    }
    if (hits) findings.push({ kind: "UNDEDUCTED", sec, act, detail: `${hits} of ${files.length} notes name something to fix while every criterion sits at full marks` });
  }
}

// DRIFT: same activity, different sections, means far apart.
for (const [act, list] of Object.entries(byActivity)) {
  if (list.length < 2) continue;
  const means = list.map((x) => x.mean);
  const lo = Math.min(...means), hi = Math.max(...means);
  if (hi - lo > Math.max(8, hi * 0.15))
    findings.push({ kind: "DRIFT", sec: "-", act, detail: list.map((x) => `${x.sec} ${x.mean.toFixed(1)} (n=${x.n})`).join("  vs  ") });
}

const order = { UNDEDUCTED: 0, FLAT: 1, CEILING: 2, DRIFT: 3 };
findings.sort((a, b) => order[a.kind] - order[b.kind] || a.act.localeCompare(b.act));
if (!findings.length) { console.log("AI grading balance: nothing flagged."); process.exit(0); }
console.log(`AI grading balance: ${findings.length} finding(s)\n`);
for (const f of findings) console.log(`${f.kind.padEnd(11)} ${f.sec.padEnd(15)} ${f.act.padEnd(7)} ${f.detail}`);
process.exit(1);
