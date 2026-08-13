// Demo mode: the console running against a virtual GitHub, so it can be shown
// off (or evaluated by another teacher) with no repos, no token, and no real
// student data anywhere near it.
//
// The design decision worth knowing: demo mode is NOT a parallel set of views or
// a pile of if-demo branches through the UI. It replaces exactly one thing - the
// GitHub REST transport - with an in-memory implementation that answers the same
// endpoints with synthetic data (demo-fixture.mjs). Everything above it is the
// real code path: the same CSV parsing, the same note precedence, the same
// intent builders, the same Actions polling. So a demo that renders correctly is
// evidence the real thing renders correctly, and a shape drift in the fixture
// breaks the demo the same way bad real data would.
//
// Guardrails:
//  - Nothing persists. The transport + snapshot caches are bypassed (cache.mjs),
//    review decisions go to their own storage key (decisions.mjs), and the real
//    Settings config is never read or written while demo mode is on.
//  - Writes (intents, assignments.json toggles, scan CSVs) mutate the in-memory
//    fixture only, so the write surfaces are demonstrable and still harmless.
//  - The flag lives in sessionStorage: it survives reloads in this tab, and dies
//    with the tab. A visitor can never get stuck in demo mode.
import { demoRepos, resolveRepo, classByOrg, seedRuns, infraRepos, setInfraVisibility, DEMO_TOKEN } from "./demo-fixture.mjs";

const KEY = "console-demo-v1";
const ss = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };

// Resolved once at module load (before any importer reads it), from ?demo=1 or a
// flag already set in this tab. Node-safe: no window, no throw.
let ON = false;
try {
  const loc = globalThis.location;
  const fromURL = !!loc && /(?:^|[?&])demo=1(?:&|$)/.test(loc.search || "");
  if (fromURL) { ss()?.setItem(KEY, "1"); ON = true; }
  else ON = ss()?.getItem(KEY) === "1";
} catch { ON = false; }

export const isDemo = () => ON;
export const demoConfig = () => ({ repos: demoRepos(), labels: {} });

export function enterDemo() {
  ss()?.setItem(KEY, "1");
  const l = globalThis.location;
  l.replace(l.pathname + "?demo=1#/");
}
export function exitDemo() {
  ss()?.removeItem(KEY);
  const l = globalThis.location;
  l.replace(l.pathname);
}

// ---- transport plumbing --------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const enc = new TextEncoder();
function b64(s) {
  const bytes = enc.encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
// Content-addressable sha, the way git actually is: the hash comes from the
// CONTENT, so the same file in two different repos carries the same sha and a
// folder's sha changes only when something inside it changes.
//
// This used to hash org/repo/path instead, which looked equivalent and was not:
// nothing could ever compare two repos. The moment the content-coverage check
// arrived (is this workspace's content/<unit> the same as the teacher repo's?)
// the demo would have answered "everything is stale, everywhere" while the real
// API answered correctly. Fixture wrong, code right - the usual way round.
const SHA = new Map();
function hash(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0; h2 = Math.imul(h2 + s.charCodeAt(i) * (i + 7), 2246822519) >>> 0; }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).repeat(2) + h1.toString(16).padStart(8, "0").slice(0, 4);
}
// A blob: hashed on its bytes, then registered so a later /git/blobs/<sha> can
// find a copy. Two identical files resolve to the same blob, which is correct.
function shaOf(org, repo, ref, path) {
  const e = filesAt(repoAt(org, repo) || { files: {} }, ref).get(path);
  const sha = hash("blob\0" + (e ? (e.text ?? ("shot:" + e.shot.w + "x" + e.shot.h)) : ""));
  SHA.set(sha, { org, repo, ref, path });
  return sha;
}
// A tree: hashed on every descendant's relative path and content, so it matches
// across repos exactly when the folder does. `prefix` ends with "/" ("" = root).
function treeShaOf(files, prefix) {
  const parts = [];
  for (const [p, e] of files) {
    if (prefix && !p.startsWith(prefix)) continue;
    parts.push(p.slice(prefix.length) + "\0" + (e.text ?? ("shot:" + e.shot.w + "x" + e.shot.h)));
  }
  return hash("tree\0" + parts.sort().join("\n"));
}
const sizeOf = e => e.text != null ? enc.encode(e.text).length : (e.shot ? e.shot.w * e.shot.h / 12 | 0 : 0);

// In-memory overlay for demo writes (intents, flag toggles, scan CSVs). Keyed
// "org/repo" -> Map(path -> {text}); read before the fixture, so an edit wins.
const WRITES = new Map();
const overlay = (org, repo) => { const k = org + "/" + repo; if (!WRITES.has(k)) WRITES.set(k, new Map()); return WRITES.get(k); };

function repoAt(org, repo) {
  const r = resolveRepo(org, repo);
  if (!r) return null;
  const ov = WRITES.get(org + "/" + repo);
  if (ov && ov.size) {
    const main = new Map(r.files.main);
    for (const [p, v] of ov) main.set(p, v);
    return { ...r, files: { ...r.files, main } };
  }
  return r;
}
const filesAt = (r, ref) => (ref === "previews" ? r.files.previews : r.files.main) || new Map();

// ---- fake screenshots ---------------------------------------------------
// Real PNG bytes drawn on a canvas, so the review drawer's screenshot pane,
// lightbox and lazy loading all behave exactly as with published previews.
const SHOTS = new Map();
async function shotBytes(key, spec) {
  if (SHOTS.has(key)) return SHOTS.get(key);
  const p = drawShot(spec).catch(() => new ArrayBuffer(0));
  SHOTS.set(key, p);
  return p;
}
async function drawShot({ w, h, st, cls, label }) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const c = cv.getContext("2d");
  // roundRect is recent (Safari 16, Firefox 112); fall back to square corners
  // rather than throwing and losing the whole screenshot.
  const box = (x, y, bw, bh, rad) => { c.beginPath(); if (c.roundRect) c.roundRect(x, y, bw, bh, rad); else c.rect(x, y, bw, bh); };
  const hue = st.seed % 320 + 10, narrow = w < 700;
  const accent = `hsl(${hue} 62% 46%)`, accentSoft = `hsl(${hue} 70% 92%)`;
  c.fillStyle = "#fbfaf7"; c.fillRect(0, 0, w, h);
  // nav
  c.fillStyle = "#fff"; c.fillRect(0, 0, w, 64);
  c.fillStyle = accent; c.fillRect(28, 24, 16, 16);
  c.fillStyle = "#1b1b1f"; c.font = "600 17px system-ui, sans-serif";
  c.fillText(st.first.toLowerCase() + ".dev", 54, 37);
  if (!narrow) { c.fillStyle = "#c9c6bd"; [0, 1, 2].forEach(i => c.fillRect(w - 260 + i * 80, 28, 56, 8)); }
  else { c.fillStyle = "#c9c6bd"; [0, 1, 2].forEach(i => c.fillRect(w - 60, 24 + i * 6, 26, 3)); }
  // hero
  const heroH = narrow ? 240 : 300;
  const g = c.createLinearGradient(0, 64, w * 0.8, 64 + heroH);
  g.addColorStop(0, accentSoft); g.addColorStop(1, "#fbfaf7");
  c.fillStyle = g; c.fillRect(0, 64, w, heroH);
  c.fillStyle = "#1b1b1f";
  c.font = `700 ${narrow ? 34 : 54}px system-ui, sans-serif`;
  c.fillText(st.first + "'s picks", 28, 64 + (narrow ? 96 : 130));
  c.fillStyle = "#57565e"; c.font = `${narrow ? 15 : 19}px system-ui, sans-serif`;
  c.fillText("A few places worth the walk.", 28, 64 + (narrow ? 130 : 172));
  c.fillStyle = accent; c.fillRect(28, 64 + (narrow ? 158 : 206), narrow ? 132 : 158, narrow ? 40 : 46);
  c.fillStyle = "#fff"; c.font = "600 15px system-ui, sans-serif";
  c.fillText("See the list", 48, 64 + (narrow ? 183 : 234));
  // cards
  const top = 64 + heroH + (narrow ? 28 : 44);
  const cols = narrow ? 1 : 3, gap = 24, pad = 28;
  const cw = (w - pad * 2 - gap * (cols - 1)) / cols, ch = narrow ? 168 : 260;
  for (let i = 0; i < 3; i++) {
    const x = narrow ? pad : pad + i * (cw + gap);
    const y = narrow ? top + i * (ch + gap) : top;
    if (y + ch > h - 40) break;
    c.fillStyle = "#fff"; c.strokeStyle = "#e5e2da"; c.lineWidth = 1;
    box(x, y, cw, ch, 12); c.fill(); c.stroke();
    c.fillStyle = `hsl(${(hue + i * 24) % 360} 45% 82%)`;
    box(x + 12, y + 12, cw - 24, ch * 0.48, 8); c.fill();
    c.fillStyle = "#1b1b1f"; c.font = "600 17px system-ui, sans-serif";
    c.fillText(["Night Market", "Old Harbour", "Rooftop Set"][i], x + 14, y + ch * 0.48 + 42);
    c.fillStyle = "#6b6b73"; c.font = "13px system-ui, sans-serif";
    c.fillText(["4.5 · food / walk", "4.1 · quiet", "3.8 · music / late"][i], x + 14, y + ch * 0.48 + 66);
  }
  // footer
  c.fillStyle = "#f1efe9"; c.fillRect(0, h - 56, w, 56);
  c.fillStyle = "#8a8892"; c.font = "13px system-ui, sans-serif";
  c.fillText("Built for " + cls.courseName + ". " + label, 28, h - 24);
  const blob = await new Promise(res => cv.toBlob(res, "image/png"));
  return blob ? blob.arrayBuffer() : new ArrayBuffer(0);
}

// ---- workflow runs -----------------------------------------------------
// Dispatches create a real-feeling run that walks queued -> in_progress ->
// completed, so the Ops feed, the run poller and the wizards all animate.
const DISPATCHED = new Map();   // "org/repo/file" -> [run]
let runSeq = 500000;
const QUEUED_MS = 3500, DONE_MS = 9000;
function runState(run) {
  const age = Date.now() - run._at;
  if (age < QUEUED_MS) return { status: "queued", conclusion: null };
  if (age < DONE_MS) return { status: "in_progress", conclusion: null };
  return { status: "completed", conclusion: "success" };
}
const asRun = run => ({ ...run, ...runState(run) });

export function demoDispatch(org, repo, file, inputs) {
  if (!classByOrg(org)) throw new Error("GitHub 404: no such repo in demo mode");
  // The visibility flip is the one dispatch whose EFFECT the console reads back
  // (it re-reads the repo once the run is green), so the virtual org has to
  // actually change. Same tier as the in-memory intent and flag writes: real
  // surface, no bytes leaving the browser. Dry runs change nothing, as in life.
  if (file === "template-visibility.yml" && inputs && inputs.mode === "execute") {
    for (const name of String(inputs.repo || "").split(",").map(s => s.trim()).filter(Boolean)) {
      setInfraVisibility(org, name, inputs.visibility === "private");
    }
  }
  const k = org + "/" + repo + "/" + file;
  const run = {
    id: ++runSeq, name: file, event: "workflow_dispatch", _at: Date.now(),
    created_at: new Date().toISOString(),
    html_url: "https://github.com/" + org + "/" + repo + "/actions",
    _demo: true,
  };
  DISPATCHED.set(k, [run, ...(DISPATCHED.get(k) || [])].slice(0, 5));
  return { dispatchedAt: run._at };
}

// ---- the virtual API ---------------------------------------------------
// One handler per endpoint the app actually calls (see lib/gh.mjs and the
// callers listed in its header). Returns the same body shape the real API does,
// or null for a 404 - the app already treats null as "not readable".
export async function demoAPI(url, accept, wantsBuffer) {
  const [pathPart, queryPart] = String(url).split("?");
  const qs = new URLSearchParams(queryPart || "");
  const raw = accept.includes("raw");

  // GET /search/repositories?q=org:<org> <term> in:name
  // The Templates board asks by name instead of listing an org (the live orgs
  // hold thousands of repos), so the virtual API answers the same way.
  if (pathPart === "/search/repositories") {
    await sleep(120);
    const q = qs.get("q") || "";
    const org = (q.match(/org:(\S+)/) || [])[1] || "";
    const term = q.replace(/org:\S+/, "").replace(/in:name/, "").trim().toLowerCase();
    if (!classByOrg(org)) return { total_count: 0, items: [] };
    const items = infraRepos(org)
      .filter(r => r.name.toLowerCase().includes(term))
      .map(r => ({ name: r.name, private: r.private, is_template: r.isTemplate, pushed_at: r.pushedAt, html_url: "https://github.com/" + org + "/" + r.name }));
    return { total_count: items.length, items };
  }

  const m = pathPart.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (!m) return null;
  const [, org, repo, rest = ""] = m;

  // Actions endpoints do not need the repo's file tree.
  let a = rest.match(/^\/actions\/workflows\/([^/]+)\/runs$/);
  if (a) {
    await sleep(90);
    if (!classByOrg(org)) return null;
    const file = decodeURIComponent(a[1]);
    const live = (DISPATCHED.get(org + "/" + repo + "/" + file) || []).map(asRun);
    const runs = [...live, ...seedRuns(org, repo, file)].slice(0, +(qs.get("per_page") || 5));
    return { total_count: runs.length, workflow_runs: runs };
  }
  a = rest.match(/^\/actions\/runs\/(\d+)$/);
  if (a) {
    await sleep(70);
    const id = +a[1];
    // only dispatched runs are ever polled by id (runOp -> pollRun)
    for (const list of DISPATCHED.values()) { const hit = list.find(x => x.id === id); if (hit) return asRun(hit); }
    return null;
  }

  // A template/solution repo has no file tree in the fixture, but the Templates
  // board reads its metadata back after a flip - so answer that before the
  // tree-backed lookup turns it into a 404.
  if (rest === "") {
    const infra = infraRepos(org).find(x => x.name.toLowerCase() === repo.toLowerCase());
    if (infra) {
      await sleep(60);
      return { name: infra.name, full_name: org + "/" + infra.name, default_branch: "main", private: infra.private, is_template: infra.isTemplate, pushed_at: infra.pushedAt, html_url: "https://github.com/" + org + "/" + infra.name };
    }
  }

  const r = repoAt(org, repo);
  if (!r) return null;

  if (rest === "") { await sleep(60); return { name: repo, full_name: org + "/" + repo, default_branch: "main", private: true, html_url: "https://github.com/" + org + "/" + repo }; }

  // GET /git/trees/<ref>?recursive=1
  a = rest.match(/^\/git\/trees\/([^/?]+)$/);
  if (a) {
    await sleep(110);
    const ref = decodeURIComponent(a[1]) === "previews" ? "previews" : "main";
    const files = filesAt(r, ref);
    if (!files.size) return ref === "previews" ? null : { tree: [] };
    const dirs = new Set(), tree = [];
    for (const [p, e] of files) {
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
      tree.push({ path: p, type: "blob", sha: shaOf(org, repo, ref, p), size: sizeOf(e), mode: "100644" });
    }
    for (const d of dirs) tree.push({ path: d, type: "tree", sha: treeShaOf(files, d + "/"), mode: "040000" });
    return { tree, truncated: false };
  }

  // GET /git/blobs/<sha>
  a = rest.match(/^\/git\/blobs\/([0-9a-f]+)$/i);
  if (a) {
    await sleep(35);
    const loc = SHA.get(a[1]);
    if (!loc) return null;
    const rr = repoAt(loc.org, loc.repo);
    const e = rr && filesAt(rr, loc.ref).get(loc.path);
    if (!e) return null;
    if (raw) return e.text ?? "";
    return { sha: a[1], size: sizeOf(e), encoding: "base64", content: b64(e.text ?? "") };
  }

  // GET /contents/<path>[?ref=previews]
  a = rest.match(/^\/contents\/(.*)$/);
  if (a) {
    const ref = qs.get("ref") === "previews" ? "previews" : "main";
    const path = decodeURIComponent(a[1]).replace(/\/+$/, "");
    const files = filesAt(r, ref);
    const e = files.get(path);
    if (e) {
      await sleep(e.shot ? 140 : 70);
      if (e.shot) {
        const buf = await shotBytes(org + "/" + repo + "@" + ref + ":" + path, e.shot);
        return wantsBuffer ? buf : "";   // screenshots are only ever read as bytes
      }
      if (raw && !wantsBuffer) return e.text;
      if (wantsBuffer) return enc.encode(e.text).buffer;
      return { name: path.split("/").pop(), path, type: "file", size: sizeOf(e), sha: shaOf(org, repo, ref, path), encoding: "base64", content: b64(e.text), html_url: "https://github.com/" + org + "/" + repo + "/blob/main/" + path };
    }
    // directory listing
    const pfx = path ? path + "/" : "";
    const kids = new Map();
    for (const [p, v] of files) {
      if (path && !p.startsWith(pfx)) continue;
      const rel = p.slice(pfx.length);
      if (!rel) continue;
      const cut = rel.indexOf("/");
      const name = cut < 0 ? rel : rel.slice(0, cut);
      if (kids.has(name)) continue;
      kids.set(name, cut < 0
        ? { name, path: pfx + name, type: "file", size: sizeOf(v), sha: shaOf(org, repo, ref, pfx + name), html_url: "https://github.com/" + org + "/" + repo + "/blob/main/" + pfx + name }
        : { name, path: pfx + name, type: "dir", size: 0, sha: treeShaOf(files, pfx + name + "/"), html_url: "https://github.com/" + org + "/" + repo + "/tree/main/" + pfx + name });
    }
    if (!kids.size) return null;
    await sleep(80);
    return [...kids.values()].sort((x, y) => x.name.localeCompare(y.name));
  }

  return null;
}

// The write path: intents, assignments.json flag toggles, attendance scan CSVs.
// In demo these land in the in-memory overlay, so the surfaces are fully
// clickable (and the filed intent shows up in Pending intents on refresh)
// without a byte leaving the browser.
export async function demoPut(org, repo, path, content) {
  await sleep(280);
  if (!resolveRepo(org, repo)) throw new Error("GitHub 404: demo mode only knows its three demo classes");
  overlay(org, repo).set(path, { text: content });
  return { content: { path, sha: shaOf(org, repo, "main", path) }, commit: { sha: shaOf(org, repo, "main", path + "#c") } };
}

export { DEMO_TOKEN };
