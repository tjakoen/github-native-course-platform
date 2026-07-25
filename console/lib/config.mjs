// Single source of paths + sections. Zero-config by design: it DISCOVERS sections
// by scanning classes/ for teacher repos, deriving everything from ground truth
// (the folder name, the git remote, and each repo's grader/assignments.json). Drop
// a teacher clone into classes/ and it shows up. grader.config.json is OPTIONAL and
// only carries overrides (pretty labels, a different classes/out dir, an exclude list).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // grader-ui/lib
export const REPO = path.resolve(HERE, "..");              // grader-ui

const cfgPath = path.join(REPO, "grader.config.json");
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};

export const CLASSES = path.resolve(REPO, cfg.classesDir || "classes");
export const OUT = path.resolve(REPO, cfg.outDir || "out");
fs.mkdirSync(OUT, { recursive: true });

const LABELS = cfg.labels || {};             // optional: { "6APSI": "6APSI JavaScript / React" }
const EXCLUDE = new Set(cfg.exclude || []);  // optional: repo folder names to skip

// org owner parsed from the clone's origin remote (works for any org, no hardcoding)
function orgFromRemote(dir) {
  try {
    const url = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
    const m = url.match(/[:/]([^/]+)\/[^/]+?(?:\.git)?$/);
    return m ? m[1] : null;
  } catch { return null; }
}
// design activities publish screenshots; feedback:"project" is the marker (vs "code")
function shotActs(dir) {
  try {
    const a = JSON.parse(fs.readFileSync(path.join(dir, "grader", "assignments.json"), "utf8"));
    return a.filter(x => x.feedback === "project").map(x => x.id);
  } catch { return []; }
}

const NAME = /^teacher-([a-z0-9]+)-([a-z0-9]+)-/i; // teacher-<subjectcode>-<section>-<name>

export const SECTIONS = (fs.existsSync(CLASSES) ? fs.readdirSync(CLASSES) : [])
  .filter(name => NAME.test(name) && !EXCLUDE.has(name))
  .map(name => ({ name, dir: path.join(CLASSES, name) }))
  .filter(s => fs.existsSync(path.join(s.dir, "grader", "assignments.json"))) // a real teacher repo
  .map(({ name, dir }) => {
    const [, rawCode, section] = name.match(NAME);
    const code = rawCode.toUpperCase();
    const key = code + "-" + section;
    return {
      key, section, repo: name, dir,
      org: orgFromRemote(dir),
      subject: LABELS[key] || LABELS[code] || code,
      acts: shotActs(dir),
    };
  })
  .sort((a, b) => a.key.localeCompare(b.key));

export const paths = {
  auditReport:   path.join(OUT, "audit-report.md"),
  blanksReport:  path.join(OUT, "blanks-report.md"),
  fixPlan:       path.join(OUT, "fix-plan.md"),
};
