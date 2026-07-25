// Lazy section store. Boot discovers (one assignments.json call per teacher
// repo); a section's full gradebook loads only when a class route is first
// entered, then stays cached with a loadedAt stamp. Refresh is always a human
// action (invalidate + re-enter); the ETag cache in gh.mjs makes revalidation
// cheap, but the notes pool is not free, so nothing refetches on its own.
import { discoverSections } from "./config.mjs";
import { loadSection } from "./gradebook.mjs";
import { ghText } from "./gh.mjs";

let disc = null;                 // { sections: [light sc], errors }
const cache = new Map();         // key -> { promise, value, loadedAt }
const flagsCache = new Map();    // key -> { value, at }

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
  if (key) { cache.delete(key); flagsCache.delete(key); }
  else { cache.clear(); flagsCache.clear(); }
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
