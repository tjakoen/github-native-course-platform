// GitHub REST adapter for the browser. The ONLY remote the app talks to (see
// the CSP in index.html). Same header set the retired local fetchers used.
// Reads everything; writes exactly ONE kind of file: Intent prompts into
// gradebook/intents/ (putIntent below). Grades, notes, publish flags and
// everything else are still only ever written by Claude Code executing those
// intents locally - keep it that way.
// Per-repo tokens: each teacher repo carries its own fine-grained PAT (see
// Settings), so one repo's rejected/expired token never blocks the others. The
// registry is keyed by "org/repo" (lowercased); every request path here is
// /repos/<org>/<repo>/... so the right token is picked by parsing that out.
// DEFAULT_TOKEN is only a fallback for a repo line that omits its own token.
let DEFAULT_TOKEN = "";
const TOKENS = new Map(); // "org/repo" (lowercase) -> token
export const setToken = t => { DEFAULT_TOKEN = t || ""; };
export function setRepoTokens(entries) {
  TOKENS.clear();
  for (const e of entries || []) {
    if (e && e.org && e.repo && e.token) TOKENS.set((e.org + "/" + e.repo).toLowerCase(), e.token);
  }
}
export const tokenForRepo = (org, repo) => {
  const exact = TOKENS.get((org + "/" + repo).toLowerCase());
  if (exact) return exact;
  // Submission repos (code + screenshots) aren't in the Settings repo list, only
  // the teacher repos are. Reuse a token registered for the SAME ORG (the teacher
  // repo's PAT) so those fetches are authenticated - a per-repo-scoped PAT still
  // won't read them, but an org-wide one will. Falls back to DEFAULT_TOKEN.
  const pfx = org.toLowerCase() + "/";
  for (const [k, t] of TOKENS) if (k.startsWith(pfx)) return t;
  return DEFAULT_TOKEN;
};
function tokenForURL(url) {
  const m = String(url).match(/^\/repos\/([^/]+)\/([^/?#]+)/);
  return m ? tokenForRepo(m[1], m[2]) : DEFAULT_TOKEN;
}

export class AuthError extends Error {}

// in-memory ETag cache: a conditional GET (If-None-Match) that comes back 304
// Not Modified does not count against the primary REST rate limit
const CACHE = new Map(); // url|accept -> { etag, body }
export const rate = { remaining: null, limit: null };

async function req(url, accept, parse) {
  const key = url + "|" + accept;
  const hit = CACHE.get(key);
  const headers = {
    Authorization: "Bearer " + tokenForURL(url),
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (hit && hit.etag) headers["If-None-Match"] = hit.etag;
  const r = await fetch("https://api.github.com" + url, { headers });
  if (r.headers.has("x-ratelimit-remaining")) {
    rate.remaining = +r.headers.get("x-ratelimit-remaining");
    rate.limit = +r.headers.get("x-ratelimit-limit");
  }
  if (r.status === 304 && hit) return hit.body;
  if (r.status === 401) throw new AuthError("GitHub rejected the token (401). Check it in Settings.");
  if (!r.ok) return null;
  const body = await parse(r);
  const etag = r.headers.get("etag");
  if (etag) CACHE.set(key, { etag, body });
  return body;
}

export const ghJSON = url => req(url, "application/vnd.github+json", r => r.json());
export const ghText = url => req(url, "application/vnd.github.raw", r => r.text());
export const ghBuf  = url => req(url, "application/vnd.github.raw", r => r.arrayBuffer());

// authenticated image fetch -> object URL (a bare <img src> can't send the token)
const BLOBURLS = new Map();
export async function ghBlobURL(url, mime) {
  if (BLOBURLS.has(url)) return BLOBURLS.get(url);
  const buf = await ghBuf(url);
  if (!buf) return null;
  const u = URL.createObjectURL(new Blob([buf], mime ? { type: mime } : undefined));
  BLOBURLS.set(url, u);
  return u;
}

// UTF-8 -> base64 (btoa alone chokes on non-latin1)
function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// The single write path: file an Intent prompt under gradebook/intents/ on the
// teacher repo. New files only (no sha handling on purpose - an intent is never
// edited, only executed + archived by Claude Code).
export async function putIntent(org, repo, path, content, message) {
  const r = await fetch(`https://api.github.com/repos/${org}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + tokenForRepo(org, repo),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, content: b64(content) }),
  });
  if (r.status === 401) throw new AuthError("GitHub rejected the token (401). Check it in Settings.");
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`GitHub ${r.status}: ${j.message || "write failed"}${r.status === 403 ? " (does the token have Contents: Read and write?)" : ""}`);
  }
  return r.json();
}

// General contents write with optional sha (update-in-place). Used ONLY by the
// tiered direct-write surfaces: attendance scan batch CSVs (which the per-repo
// verify-attendance workflow validates server-side) and single-flag toggles of
// grader/assignments.json (locked / publish, via config-writes.mjs, shown as a
// diff and confirmed). Grades, notes, and delivery still flow through intents -
// keep it that way.
export async function putFile(org, repo, path, content, message, sha) {
  const body = { message, content: b64(content) };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${org}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + tokenForRepo(org, repo),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (r.status === 401) throw new AuthError("GitHub rejected the token (401). Check it in Settings.");
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`GitHub ${r.status}: ${j.message || "write failed"}${r.status === 403 ? " (does the token have Contents: Read and write?)" : ""}`);
  }
  return r.json();
}

// concurrency pool (same shape as the retired local fetchers)
export async function pool(items, n, fn) {
  const q = items.slice();
  const runners = Array.from({ length: n }, async () => { while (q.length) { await fn(q.shift()); } });
  await Promise.all(runners);
}
