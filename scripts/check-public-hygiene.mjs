#!/usr/bin/env node
// Public-hygiene tripwire for this repo and the two template submodules.
//
// This project is the sanitized, public face of a platform that also runs live
// classes with real students in it. Sanitization has failed silently before: the
// public teacher template shipped real student GitHub handles and real class
// section codes inside code comments for months, because the only automated
// check we had (the Pages deploy tripwire) looks at the built console artifact
// and can therefore never see a tool's source.
//
// So this scans the working tree instead, and fails the build on anything that
// identifies a real course, a real student, or violates the house prose rule.
//
// Usage: node scripts/check-public-hygiene.mjs
//
// When a rule fires on something legitimate, fix the text - do not widen the
// pattern. The deliberate exemptions are the invented-data fixtures: `demo/`
// (section 0000, "Ada Lovelace") that the console demo mode reads, the console's
// own test harness under `console/scripts/`, and `demo-fixture.mjs`. Their
// numbers are made up; exempting them is what keeps the rule strict everywhere
// a real number could actually appear.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// Directories that are never ours to police: third-party code we vendor
// verbatim, installed dependencies, build output, and git internals.
const SKIP_DIR = new Set([".git", "node_modules", "dist", "out", "classes", "vendor"]);
// Live-instance data is gitignored, but a local checkout has it on disk.
const SKIP_PATH = [/^console\/(classes|out|dist)\//, /^console\/site\/theme\.css$/];
const TEXT = /\.(md|mjs|js|css|html|json|yml|yaml|txt|csv|gitignore)$/i;

// Invented data: the demo fixture set and the console's own test harness.
const SYNTHETIC = (p) =>
  p.startsWith("demo/") ||
  p.startsWith("console/scripts/") ||
  p === "console/site/lib/demo-fixture.mjs";

const RULES = [
  {
    id: "em-dash",
    why: "house rule: no em dashes in prose or generated content",
    re: /—/g,
    // Invented-data fixtures and this file's own documentation of the rule.
    exempt: (p) => p.startsWith("demo/") || p === "scripts/check-public-hygiene.mjs",
  },
  {
    id: "real-org",
    why: "names a live course org",
    re: /HAU-6[A-Z]+/g,
    exempt: () => false,
  },
  {
    id: "real-section",
    why: "names a live class section",
    re: /-(?:2106|2125|2134|2203|2209|2215|2240)(?=[-.]|$)/gm,
    exempt: () => false,
  },
  {
    id: "student-number",
    why: "looks like a real student number",
    re: /\b20\d{6}\b/g,
    exempt: SYNTHETIC,
  },
  {
    id: "personal-email",
    why: "a real personal email address",
    re: /\b[\w.+-]+@(?!example\.(?:com|edu)\b|users\.noreply\.github\.com\b)[\w-]+\.[\w.]+\b/g,
    exempt: SYNTHETIC,
  },
];

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (TEXT.test(name) || name.startsWith(".git")) out.push(full);
  }
  return out;
};

const hits = [];
for (const full of walk(ROOT)) {
  const path = relative(ROOT, full);
  if (SKIP_PATH.some((re) => re.test(path))) continue;
  let text;
  try { text = readFileSync(full, "utf8"); } catch { continue; }
  for (const rule of RULES) {
    if (rule.exempt(path)) continue;
    rule.re.lastIndex = 0;
    for (const m of text.matchAll(rule.re)) {
      const line = text.slice(0, m.index).split("\n").length;
      hits.push({ path, line, rule: rule.id, why: rule.why, text: m[0] });
    }
  }
}

if (!hits.length) {
  console.log("public hygiene: clean (no live identifiers, no em dashes).");
  process.exit(0);
}
console.error(`public hygiene: ${hits.length} problem(s)\n`);
for (const h of hits.slice(0, 60)) {
  console.error(`  ${h.path}:${h.line}  [${h.rule}] ${JSON.stringify(h.text)} - ${h.why}`);
}
if (hits.length > 60) console.error(`  ... and ${hits.length - 60} more`);
process.exit(1);
