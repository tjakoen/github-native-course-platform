// App config in this browser's localStorage: one teacher repo PER ROW, each with
// its OWN fine-grained PAT (repos: [{url, token}]), so a single expired/rejected
// token can't take down every section. Review decisions live under their own
// long-standing key (course-grade-decisions-v1) in app.mjs, byte-compatible with the
// retired local dashboard so exported backups import cleanly.
import { clearAll } from "./cache.mjs";

const CKEY = "grader-ui-config-v1"; // legacy key name kept on purpose: same-origin carry-over from the old grader-ui Pages path

// Old shape was { repos: ["url", ...], githubToken: "one token for all" }.
// Migrate it to per-repo rows, seeding each row's token from the shared one.
function migrate(c) {
  if (!c || !Array.isArray(c.repos)) return null;
  const repos = c.repos.map(r =>
    typeof r === "string" ? { url: r, token: c.githubToken || "" }
    : (r && typeof r === "object" ? { url: String(r.url || "").trim(), token: String(r.token || "").trim() } : null)
  ).filter(r => r && r.url);
  if (!repos.length) return null;
  return { repos, labels: c.labels || {} };
}

export function loadConfig() {
  try { return migrate(JSON.parse(localStorage.getItem(CKEY) || "null")); }
  catch { return null; }
}

export function saveConfig(c) {
  const repos = (c.repos || []).map(r => ({ url: String(r.url || "").trim(), token: String(r.token || "").trim() }))
    .filter(r => r.url);
  localStorage.setItem(CKEY, JSON.stringify({ repos, labels: c.labels || {} }));
}

// Sign-out: drop the repos+tokens AND wipe the persistent cache, so no gradebook
// bodies (PII) linger at rest once the repos are gone.
export function clearConfig() {
  localStorage.removeItem(CKEY);
  clearAll();
}
