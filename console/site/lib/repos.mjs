// Two read-only inventories the console had no way to see:
//
//   1. contentCoverage - which content/ units actually landed in the student
//      workspaces, and which are stale. publish-material copies a unit verbatim
//      (tools/sync-unit.mjs is a recursive cpSync), so the git tree SHA of
//      content/<unit> in a workspace equals the teacher repo's exactly when that
//      workspace is current. One contents/content listing per repo gives every
//      unit's dir SHA at once, so the whole check is one call per workspace.
//
//   2. orgRepoInventory - the activity template and solution repos per ORG, with
//      their visibility. Listing an org is not an option here (the live orgs hold
//      1400-1900 repos, and that listing has already 504'd once during a publish),
//      so this asks the search API by name instead: three queries per org, each
//      returning private + is_template directly.
//
// Both are on-demand: nothing here runs unless the teacher asks for it.
import { ghJSON, ghJSONForOrg, pool } from "./gh.mjs";
import { workspaceRepo } from "./students.mjs";

// ---- content coverage ----------------------------------------------------

// name -> dir SHA for every folder directly under content/. null when the repo
// or its content/ is unreadable (missing repo, never published, token scope).
async function unitShas(org, repo) {
  const list = await ghJSON(`/repos/${org}/${repo}/contents/content`).catch(() => null);
  if (!Array.isArray(list)) return null;
  const m = new Map();
  for (const e of list) if (e && e.type === "dir") m.set(e.name, e.sha);
  return m;
}

// Compare the teacher repo's content/ against every workspace in the section.
// onProgress(done, total) fires per workspace so the UI can show a meter.
//
// A unit is CURRENT in a workspace when the SHAs match, STALE when the folder is
// there with different content, MISSING when it is not there at all. Stale is the
// interesting one: sync-unit overwrites but never deletes, so a workspace can also
// hold ORPHAN units the teacher repo no longer has, and those never show up in the
// unit picker (it lists the teacher side) unless something looks for them.
export async function contentCoverage(s, onProgress) {
  const teacher = await unitShas(s.org, s.repo);
  if (!teacher) throw new Error("content/ is not readable on " + s.repo);

  const repos = [...new Set(s.students.map(st => workspaceRepo(s, st)).filter(Boolean))];
  const stat = new Map();                       // unit -> { current, stale, missing }
  for (const name of teacher.keys()) stat.set(name, { current: 0, stale: 0, missing: 0 });
  const orphans = new Map();                    // unit -> count of workspaces holding it
  let unreachable = 0, done = 0;

  await pool(repos, 6, async repo => {
    const have = await unitShas(s.org, repo);
    done++;
    if (onProgress) onProgress(done, repos.length);
    if (!have) { unreachable++; return; }       // no content/ yet, or no such repo
    for (const [name, sha] of teacher) {
      const row = stat.get(name);
      const mine = have.get(name);
      if (!mine) row.missing++;
      else if (mine === sha) row.current++;
      else row.stale++;
    }
    for (const name of have.keys()) if (!teacher.has(name)) orphans.set(name, (orphans.get(name) || 0) + 1);
  });

  return {
    workspaces: repos.length,
    unreachable,
    units: [...teacher.keys()].sort().map(name => ({ name, sha: teacher.get(name), ...stat.get(name) })),
    orphans: [...orphans.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  };
}

// A unit needs republishing when any workspace is behind. Reachable workspaces
// only: a workspace with no content/ at all counts as missing everywhere, which
// is true, and republishing is exactly the fix.
export const needsPublish = u => u.stale > 0 || u.missing > 0;

// ---- template + solution inventory ---------------------------------------

// TWO POLICIES, and conflating them is the whole reason this exists.
//
// A TEMPLATE repo is the thing students copy. Public is its released state;
// private just means the activity has not been released yet, which is a normal
// mid-term state and not a problem.
//
// A SOLUTION repo is the worked answer. Private is the expected state and public
// is a leak - with one documented exception: the m1a1 solutions are deliberately
// public as the platform's authoring examples (docs/examples.md links all three).
// tools/org-audit.mjs waves through ANY public solution repo, so nothing else in
// the estate would notice an accidentally public one.
export const PUBLIC_SOLUTION_OK = new Set(["m1a1"]);

const isTemplateName = n => /-classcode-yourname$/i.test(n) || /(^|-)template$/i.test(n);
const isSolutionName = n => /-solution$/i.test(n);
// The activity id both repos of a pair hang off: m5a5-classcode-yourname and
// m5a5-solution are one row. Anything else (final-project-template) is its own.
const idOf = n => n.replace(/-classcode-yourname$/i, "").replace(/-solution$/i, "");

async function searchByName(org, term) {
  const q = encodeURIComponent(`org:${org} ${term} in:name`);
  const r = await ghJSONForOrg(org, `/search/repositories?q=${q}&per_page=100`).catch(() => null);
  return (r && Array.isArray(r.items)) ? r.items : [];
}

// Every template/solution repo in one org, paired by activity id.
// Search, not org listing: 3 requests instead of 19 pages on the biggest org.
// The tradeoff is the search index, which lags a write by a minute or so - so a
// visibility flip re-reads that ONE repo directly (repoState below) rather than
// trusting a fresh search.
export async function orgRepoInventory(org) {
  const found = new Map();
  for (const term of ["classcode-yourname", "solution", "template"]) {
    for (const it of await searchByName(org, term)) {
      if (!it || !it.name) continue;
      found.set(it.name, {
        name: it.name,
        private: !!it.private,
        isTemplate: !!it.is_template,
        url: it.html_url || `https://github.com/${org}/${it.name}`,
        pushedAt: it.pushed_at || null,
      });
    }
  }
  // The teacher control centers and the student skeleton match "template" by name
  // but are neither an activity template nor a solution - they are the engine.
  const rows = new Map();
  for (const rec of found.values()) {
    if (/^teacher-/i.test(rec.name) || /^student-/i.test(rec.name)) continue;
    const tmpl = isTemplateName(rec.name), sol = isSolutionName(rec.name);
    if (!tmpl && !sol) continue;
    const id = idOf(rec.name);
    const row = rows.get(id) || { id, template: null, solution: null };
    if (sol) row.solution = rec; else row.template = rec;
    rows.set(id, row);
  }
  return { org, rows: [...rows.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })) };
}

// Read one repo's live visibility straight from the source, bypassing the search
// index. Used right after a flip, so the board never shows a stale answer as if
// it were the new one.
export async function repoState(org, name) {
  const r = await ghJSON(`/repos/${org}/${name}`).catch(() => null);
  if (!r) return null;
  return { name, private: !!r.private, isTemplate: !!r.is_template, url: r.html_url, pushedAt: r.pushed_at || null };
}

// What the board says about a row, and whether it is a problem.
// tone: "good" | "held" (a state, not a fault) | "bad" | "muted" (absent)
export function templateVerdict(rec) {
  if (!rec) return { tone: "muted", label: "none", note: "no template repo" };
  if (!rec.isTemplate) return { tone: "bad", label: rec.private ? "private" : "public", note: "template flag is OFF - Use this template is not offered" };
  return rec.private
    ? { tone: "held", label: "private", note: "not released yet" }
    : { tone: "good", label: "public", note: "released" };
}
export function solutionVerdict(rec, id) {
  if (!rec) return { tone: "muted", label: "none", note: "no solution repo" };
  if (rec.private) return { tone: "good", label: "private", note: "expected" };
  return PUBLIC_SOLUTION_OK.has(id)
    ? { tone: "held", label: "public", note: "documented authoring example" }
    : { tone: "bad", label: "public", note: "worked answer is world-readable" };
}
export const isExposedSolution = (rec, id) => !!rec && !rec.private && !PUBLIC_SOLUTION_OK.has(id);
