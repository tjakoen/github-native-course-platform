// Lazy section store. Boot discovers (one assignments.json call per teacher
// repo); a section's full gradebook loads only when a class route is first
// entered, then stays cached with a loadedAt stamp. Refresh is always a human
// action (invalidate + re-enter); the ETag cache in gh.mjs makes revalidation
// cheap, but the notes pool is not free, so nothing refetches on its own.
import { discoverSections } from "./config.mjs";
import { loadSection } from "./gradebook.mjs";
import { ghText, ghJSON } from "./gh.mjs";

let disc = null;                 // { sections: [light sc], errors }
const cache = new Map();         // key -> { promise, value, loadedAt }
const flagsCache = new Map();    // key -> { value, at }
const intentsCache = new Map();  // key -> { value, at }

export async function discover(cfg) {
  disc = await discoverSections(cfg.repos, cfg.labels || {});
  return disc;
}
export const sections = () => (disc ? disc.sections : []);
export const discoErrors = () => (disc ? disc.errors : []);
export const findSc = key => sections().find(s => s.key === key) || null;

export function sectionCached(key) {
  const e = cache.get(key);
  return e && e.value ? e.value : null;
}

export function getSection(key) {
  let e = cache.get(key);
  if (!e) {
    const sc = findSc(key);
    if (!sc) return Promise.reject(new Error("unknown section " + key));
    e = { promise: null, value: null, loadedAt: 0 };
    e.promise = loadSection(sc).then(v => { e.value = v; e.loadedAt = Date.now(); return v; })
      .catch(err => { cache.delete(key); throw err; });
    cache.set(key, e);
  }
  return e.promise;
}

export function invalidate(key) {
  if (key) { cache.delete(key); flagsCache.delete(key); intentsCache.delete(key); }
  else { cache.clear(); flagsCache.clear(); intentsCache.clear(); }
}

export function ageOf(key) {
  const e = cache.get(key);
  return e && e.loadedAt ? Date.now() - e.loadedAt : null;
}
export const STALE_MS = 10 * 60 * 1000;

// The cheap flags read (Dashboard / Flags views): FLAGS.md + reports/FLAGGED.md
// only - two raw-content calls, no gradebook load.
export async function getFlagsFiles(key) {
  const hit = flagsCache.get(key);
  if (hit && Date.now() - hit.at < STALE_MS) return hit.value;
  const sc = findSc(key);
  if (!sc) return { flags: "", flagged: "" };
  const [flags, flagged] = await Promise.all([
    ghText(`/repos/${sc.org}/${sc.repo}/contents/gradebook/FLAGS.md`).catch(() => null),
    ghText(`/repos/${sc.org}/${sc.repo}/contents/reports/FLAGGED.md`).catch(() => null),
  ]);
  const value = { flags: flags || "", flagged: flagged || "" };
  flagsCache.set(key, { value, at: Date.now() });
  return value;
}

// Pending intents: the machine-readable trail of what the console has filed but
// Claude Code has not yet run. A pending intent is a *.md file sitting in
// gradebook/intents/ (executed intents move to gradebook/intents/done/ in the
// same commit as their changes, so they drop off this list). One contents call,
// short-TTL memoized so a strip that repaints does not re-fire it; the ETag
// cache in gh.mjs keeps the revalidation a free 304. invalidateIntents(key) after
// a Send makes the newly filed intent show up immediately.
const INTENTS_TTL = 60 * 1000;
// filename shape from wireSend: <YYYYMMDD-HHMMSS>-<kind>[-<aid>].md. Kinds can
// contain hyphens, so match the longest known kind, then the rest is the aid.
export const INTENT_KINDS = ["gen-feedback", "apply-ai", "finalize", "apply-grades", "deliver", "new-activity", "manual-attendance"];
export function parseIntentName(name) {
  const m = String(name).match(/^(\d{8}-\d{6})-(.+)\.md$/);
  if (!m) return null;
  const ts = m[1], rest = m[2];
  const kind = INTENT_KINDS.find(k => rest === k || rest.startsWith(k + "-"));
  const aid = kind && rest.length > kind.length ? rest.slice(kind.length + 1) : null;
  // ts YYYYMMDD-HHMMSS -> Date (local); NaN-safe (callers guard)
  const at = ts.replace(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/, "$1-$2-$3T$4:$5:$6");
  return { name, ts, kind: kind || rest, aid, at };
}
export async function getPendingIntents(key) {
  const hit = intentsCache.get(key);
  if (hit && Date.now() - hit.at < INTENTS_TTL) return hit.value;
  const sc = findSc(key);
  if (!sc) return [];
  const list = await ghJSON(`/repos/${sc.org}/${sc.repo}/contents/gradebook/intents`).catch(() => null);
  const value = (Array.isArray(list) ? list : [])
    .filter(x => x.type === "file" && /\.md$/i.test(x.name))
    .map(x => parseIntentName(x.name)).filter(Boolean)
    .sort((a, b) => (a.ts < b.ts ? 1 : -1));
  intentsCache.set(key, { value, at: Date.now() });
  return value;
}
export function invalidateIntents(key) {
  if (key) intentsCache.delete(key); else intentsCache.clear();
}
