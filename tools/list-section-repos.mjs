#!/usr/bin/env node
// Filter repo names belonging to a section by the classCode in the title
// (e.g. m1a1-2255-yourname matches section 2255).
//
// Reads repo names on stdin - either a JSON array of {name} / strings,
// or newline-delimited names - and prints the matches, one per line.
// An optional name prefix restricts to a role (e.g. "student-") so a teacher
// repo that shares the same classCode is never matched.
//
// Usage: gh repo list ORG --json name -q '.[].name' | node list-section-repos.mjs <section> [namePrefix]
import { readFileSync } from "node:fs";

const section = process.argv[2];
const prefix = process.argv[3] ?? "";
if (!section) {
  console.error("usage: list-section-repos.mjs <section> [namePrefix]");
  process.exit(1);
}

const input = readFileSync(0, "utf8").trim();
let names;
try {
  const parsed = JSON.parse(input);
  names = Array.isArray(parsed) ? parsed.map((x) => x.name ?? x) : [];
} catch {
  names = input.split("\n").map((s) => s.trim()).filter(Boolean);
}

const pattern = new RegExp(`-${section}-`);
const matches = names.filter((n) => pattern.test(n) && n.startsWith(prefix));
for (const name of matches) console.log(name);
