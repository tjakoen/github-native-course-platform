#!/usr/bin/env node
// Prune gradebook rows whose submission repo no longer exists.
//
// grade-sweep.mjs loads the whole gradebook and writes EVERY row back, even for
// repos it no longer discovers - so when a student repo is deleted or renamed
// (e.g. an accidental `-<handle>-main` duplicate), its stale row persists through
// every future grade run and pollutes the gradebook + Canvas push. Re-running the
// sweep does not remove it; this tool does.
//
// It removes the dead rows from BOTH gradebook/grades.csv and GRADEBOOK.md,
// matching the markdown row by its short commit sha (which is present in both) -
// robust even when the md renders the row by github handle rather than repo name.
//
// DRY RUN BY DEFAULT: lists what it would drop and changes nothing until --execute.
//
// Usage: node tools/prune-gradebook.mjs [--execute]
// Auth/env: gh login (repo existence checks), GRADE_OWNER (org).

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseCsvLine } from "./lib/gradebook.mjs";

const execute = process.argv.includes("--execute");
const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const OWNER = process.env.GRADE_OWNER || sh("gh api user -q .login");

const CSV = "gradebook/grades.csv";
const MD = "gradebook/GRADEBOOK.md";
if (!existsSync(CSV)) { console.error(`no ${CSV} - nothing to prune`); process.exit(1); }

const lines = readFileSync(CSV, "utf8").replace(/\n$/, "").split("\n");
const header = lines[0];
const col = Object.fromEntries(parseCsvLine(header).map((c, i) => [c, i]));
const rows = lines.slice(1).filter(Boolean).map((ln) => {
  const f = parseCsvLine(ln);
  return { line: ln, repo: f[col.repo], sha: f[col.sha] || "", assignment: f[col.assignment] };
});

// Check each distinct repo once. CRITICAL: only a DEFINITIVE 404 counts as
// "missing". A transient error (secondary rate-limit, 5xx, network blip) during
// the many rapid checks must NEVER be mistaken for a deleted repo, or --execute
// would drop valid rows. Retry transient errors; leave anything still uncertain
// as unknown (null) so it is skipped, not pruned.
const repoExists = (repo) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { execSync(`gh api repos/${OWNER}/${repo} -q .id`, { stdio: ["ignore", "pipe", "pipe"] }); return true; }
    catch (e) {
      const msg = String(e.stderr || e.stdout || e.message || "");
      if (/HTTP 404|Not Found/.test(msg)) return false;   // definitive: repo is gone
      execSync("sleep 2");                                  // transient: back off and retry
    }
  }
  return null;   // still uncertain after retries -> do NOT prune
};
const repos = [...new Set(rows.map((r) => r.repo))];
const exists = new Map();
const uncertain = [];
for (const repo of repos) {
  const e = repoExists(repo);
  exists.set(repo, e);
  if (e === null) uncertain.push(repo);
}
if (uncertain.length) console.log(`WARN: could not confirm ${uncertain.length} repo(s) after retries - skipping (not pruning): ${uncertain.join(", ")}`);

const dead = rows.filter((r) => exists.get(r.repo) === false);
console.log(`prune-gradebook: ${rows.length} rows, ${repos.length} repos, owner ${OWNER}`);
if (!dead.length) { console.log("No rows reference a missing repo. Gradebook is clean."); process.exit(0); }

console.log(`\nStale rows (repo no longer exists):`);
for (const d of dead) console.log(`  ${d.repo} (${d.assignment})  sha ${d.sha.slice(0, 7)}`);

if (!execute) { console.log(`\nDRY RUN - nothing changed. Re-run with --execute to remove these.`); process.exit(0); }

// --- rewrite grades.csv without the dead rows ---
const deadLines = new Set(dead.map((d) => d.line));
const keptCsv = [header, ...rows.filter((r) => !deadLines.has(r.line)).map((r) => r.line)];
writeFileSync(CSV, keptCsv.join("\n") + "\n");

// --- drop the matching GRADEBOOK.md rows by short sha ---
let mdDropped = 0;
if (existsSync(MD)) {
  const deadShas = new Set(dead.map((d) => d.sha.slice(0, 7)).filter(Boolean));
  const md = readFileSync(MD, "utf8").split("\n");
  const kept = md.filter((ln) => {
    const hit = [...deadShas].some((s) => ln.includes("`" + s + "`") || ln.includes(s));
    if (hit && ln.trim().startsWith("|")) { mdDropped++; return false; }
    return true;
  });
  writeFileSync(MD, kept.join("\n"));
}
console.log(`\nRemoved ${dead.length} CSV row(s) and ${mdDropped} GRADEBOOK.md row(s). Commit the gradebook to persist.`);
