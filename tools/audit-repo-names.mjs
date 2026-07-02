#!/usr/bin/env node
// Audit student/teacher repo names against the course's expected naming:
//   <role>-<subjectcode>-<classcode>-<rest>   (all lowercase)
// Catches the mistakes we've actually seen students make when creating repos
// from the template: wrong subjectcode (e.g. `6xxx` copied from an example),
// swapped subject/classcode order, malformed separators (`.` instead of `-`),
// and stray casing.
//
// Reads repo names on stdin - either a JSON array of {name} / strings, or
// newline-delimited names (same input shape as list-section-repos.mjs).
//
// Usage:
//   gh repo list ORG --json name -q '.[].name' \
//     | node audit-repo-names.mjs <subjectcode> <classcode>
//
// Exit code is 1 if any repo fails the audit (so CI can flag it), else 0.
import { readFileSync } from "node:fs";

const subject = (process.argv[2] ?? "").toLowerCase();
const classCode = process.argv[3] ?? "";
if (!subject || !classCode) {
  console.error("usage: audit-repo-names.mjs <subjectcode> <classcode>");
  process.exit(2);
}

const input = readFileSync(0, "utf8").trim();
let names;
try {
  const parsed = JSON.parse(input);
  names = Array.isArray(parsed) ? parsed.map((x) => x.name ?? x) : [];
} catch {
  names = input.split("\n").map((s) => s.trim()).filter(Boolean);
}

// Only role repos are subject to this convention; activity/template repos aren't.
const roleRepos = names.filter((n) => /^(student|teacher)-/i.test(n));

const want = (role) => `${role}-${subject}-${classCode}-`;

function audit(name) {
  const role = name.toLowerCase().startsWith("teacher-") ? "teacher" : "student";
  const expected = want(role);
  if (name.startsWith(expected)) return { ok: true };

  const lower = name.toLowerCase();
  // Right shape, wrong casing somewhere in the fixed prefix.
  if (lower.startsWith(expected)) {
    return { ok: false, reason: `wrong case (should be lowercase \`${expected}…\`)` };
  }
  // Subject + classCode both present but in the wrong order.
  if (lower.includes(`-${classCode}-${subject}-`) || lower.includes(`-${classCode}-${subject}`)) {
    return { ok: false, reason: `subject/classCode swapped (want \`${expected}…\`)` };
  }
  // Correct classCode is present but the subjectcode segment is wrong.
  if (lower.includes(`-${classCode}-`) || lower.includes(`-${classCode}.`)) {
    return { ok: false, reason: `wrong subjectcode (want \`${subject}\`, fix to \`${expected}…\`)` };
  }
  // ClassCode missing/different.
  return { ok: false, reason: `does not match \`${expected}…\` (check subjectcode + classCode)` };
}

let failures = 0;
const lines = [];
for (const name of roleRepos.sort()) {
  const r = audit(name);
  if (r.ok) {
    lines.push(`  ok   ${name}`);
  } else {
    failures++;
    lines.push(`  FAIL ${name}  — ${r.reason}`);
  }
}

console.log(`Repo-name audit for ${subject}-${classCode} (${roleRepos.length} role repos):`);
console.log(lines.join("\n"));
console.log(`\n${roleRepos.length - failures} ok, ${failures} need attention.`);
process.exit(failures ? 1 : 0);
