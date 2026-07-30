// Persistent transport + snapshot cache (IndexedDB). Survives reloads and tabs so
// a boot is not cold: the ETag+body for each GET persists (conditional GETs then
// revalidate for a cheap 304), immutable sha-addressed blobs never refetch, and a
// section snapshot can paint instantly while it revalidates in the background.
//
// PRIVACY TRADEOFF, on purpose: gradebook bodies (student names/numbers) sit at
// rest in the teacher's browser profile - the same exposure the PATs and review
// decisions in localStorage already carry. Mitigated by: a Settings "Clear cached
// data" button, a wipe on sign-out (clearConfig), a 7-day http sweep (14-day for
// immutable media), a 50MB cap with LRU eviction, and a hard skip for bodies over
// 1.5MB. Degrades to memory-only (no throw) when IndexedDB is unavailable
// (private mode, disabled, quota denied). No service worker (CSP worker-src + the
// stale-shell risk make it the wrong tool).
//
// Demo mode never persists: synthetic sections must not land in the same
// IndexedDB stores as real gradebooks (nor survive an exit from the demo), so
// every read misses and every write is dropped while it is on.
import { isDemo } from "./demo.mjs";

const DB = "console-cache-v1", SCHEMA_V = 1;
export const CAP = 50 * 1024 * 1024, MAXBODY = 1.5 * 1024 * 1024;
const HTTP_TTL = 7 * 24 * 3600 * 1000, MEDIA_TTL = 14 * 24 * 3600 * 1000;
export const isMedia = key => /\/git\/blobs\//.test(key);

let dbP = null, disabled = false;
export const cacheAvailable = () => !disabled;

function open() {
  if (isDemo() || disabled) return Promise.resolve(null);
  if (dbP) return dbP;
  dbP = new Promise(res => {
    let rq;
    try { rq = indexedDB.open(DB, SCHEMA_V); }
    catch { disabled = true; return res(null); }
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains("http")) {
        const s = db.createObjectStore("http", { keyPath: "key" });
        s.createIndex("lastUsed", "lastUsed");
      }
      if (!db.objectStoreNames.contains("sections")) db.createObjectStore("sections", { keyPath: "key" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => { disabled = true; res(null); };
  });
  return dbP;
}
const store = (db, name, mode) => db.transaction(name, mode).objectStore(name);
function pget(name, key) {
  return open().then(db => db && new Promise(r => { const q = store(db, name, "readonly").get(key); q.onsuccess = () => r(q.result || null); q.onerror = () => r(null); }));
}
function pput(name, val) {
  return open().then(db => db && new Promise(r => { const q = store(db, name, "readwrite").put(val); q.onsuccess = () => r(true); q.onerror = () => r(false); }).catch(() => false));
}
function pdel(name, key) {
  return open().then(db => db && new Promise(r => { const q = store(db, name, "readwrite").delete(key); q.onsuccess = () => r(true); q.onerror = () => r(false); }));
}

// approx serialized size of a body (string | ArrayBuffer | JSON-able object)
function sizeOf(body) {
  if (typeof body === "string") return body.length;
  if (body instanceof ArrayBuffer) return body.byteLength;
  try { return JSON.stringify(body).length; } catch { return 0; }
}

// ---- HTTP transport store: {key, etag, body, storedAt, lastUsed, size, media} ----
export async function httpGet(key) {
  const rec = await pget("http", key);
  if (rec) { rec.lastUsed = Date.now(); pput("http", rec); }   // touch (fire-and-forget)
  return rec;   // {etag, body, ...} or null
}
export async function httpPut(key, etag, body) {
  const size = sizeOf(body);
  if (size > MAXBODY) return;   // never persist an oversized body
  const now = Date.now();
  await pput("http", { key, etag, body, storedAt: now, lastUsed: now, size, media: isMedia(key) });
  evictIfNeeded();
}
export function httpTouch(key) { pget("http", key).then(r => { if (r) { r.lastUsed = Date.now(); pput("http", r); } }); }

// ---- Section snapshot store: {key, v, value, loadedAt} ----
export async function snapGet(key) {
  const rec = await pget("sections", key);
  return rec && rec.v === SCHEMA_V ? rec : null;
}
export function snapPut(key, value, loadedAt) { pput("sections", { key, v: SCHEMA_V, value, loadedAt: loadedAt || Date.now() }); }
export function snapDel(key) { pdel("sections", key); }

// ---- maintenance: LRU eviction + age sweep + full wipe ----
let evicting = false;
async function evictIfNeeded() {
  if (evicting) return; evicting = true;
  try {
    const db = await open(); if (!db) return;
    const total = await new Promise(r => { let sum = 0; const c = store(db, "http", "readonly").openCursor(); c.onsuccess = e => { const cur = e.target.result; if (cur) { sum += cur.value.size || 0; cur.continue(); } else r(sum); }; c.onerror = () => r(0); });
    if (total <= CAP) return;
    // delete least-recently-used first until comfortably under the cap
    await new Promise(r => {
      let freed = 0; const need = total - CAP * 0.9;
      const c = store(db, "http", "readwrite").index("lastUsed").openCursor();
      c.onsuccess = e => { const cur = e.target.result; if (cur && freed < need) { freed += cur.value.size || 0; cur.delete(); cur.continue(); } else r(); };
      c.onerror = () => r();
    });
  } finally { evicting = false; }
}
// one-shot boot sweep: drop entries past their age budget (http 7d, media 14d)
export async function sweep() {
  const db = await open(); if (!db) return;
  const now = Date.now();
  await new Promise(r => {
    const c = store(db, "http", "readwrite").openCursor();
    c.onsuccess = e => { const cur = e.target.result; if (!cur) return r(); const v = cur.value; const ttl = v.media ? MEDIA_TTL : HTTP_TTL; if (now - (v.storedAt || 0) > ttl) cur.delete(); cur.continue(); };
    c.onerror = () => r();
  });
}
// Clear everything (sign-out via clearConfig, or the Settings "Clear cached data"
// button). Also drops the in-memory copy the caller holds; returns when done.
export async function clearAll() {
  const db = await open(); if (!db) return;
  await Promise.all(["http", "sections", "meta"].map(name => new Promise(r => { const q = store(db, name, "readwrite").clear(); q.onsuccess = () => r(); q.onerror = () => r(); })));
}
