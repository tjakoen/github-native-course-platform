// E2E cache harness (dev-only, run locally: node scripts/e2e-cache.mjs).
// Proves the Phase F persistence layer: a COLD load populates IndexedDB; a WARM
// reload (same origin, same IDB, fresh page = empty in-memory cache) paints from
// the snapshot, serves immutable blobs from cache with ZERO requests, revalidates
// mutable resources with cheap 304s; and a no-IndexedDB context still loads
// (memory-only fallback, no throw). Needs playwright (batch-stack checkout).
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
const require = createRequire("/Users/tjakoenstolk/Local/Development/batch-stack/package.json");
const { chromium } = require("playwright");

const SITE = new URL("../site", import.meta.url).pathname;
execSync("mkdir -p /tmp/console-shots");
const server = spawn("python3", ["-m", "http.server", "8932"], { cwd: SITE, stdio: "ignore" });
await new Promise(r => setTimeout(r, 800));

const b64 = s => Buffer.from(s).toString("base64");
const ASSIGN = JSON.stringify([
  { id: "m1a1", type: "vitest", namePrefix: "m1a1-", locked: true, publish: true },
  { id: "m3a1", type: "vitest", namePrefix: "m3a1-", totalPoints: 100, "ai-grading": true, feedback: "project", locked: true, publish: false },
]);
const STUDENTS = [["Dela Cruz, Juan", "20250001", "juandc"], ["Santos, Maria", "20250002", "msantos"]];
function gradesCsv(section) {
  const head = "repo,githubAccount,fullName,studentNumber,studentEmail,classCode,assignment,sha,passed,total,score,gradedAt,late,notes,aiScore,failures";
  const rows = [];
  for (const [name, num, gh] of STUDENTS) {
    rows.push(`m1a1-${section}-${gh},${gh},"${name}",${num},,${section},m1a1,abc1234,7,7,,2026-07-20,,,,`);
    rows.push(`m3a1-${section}-${gh},${gh},"${name}",${num},,${section},m3a1,abc1234,55,58,,2026-07-22,,,,`);
  }
  return head + "\n" + rows.join("\n") + "\n";
}
const NOTE = "# m3a1 feedback\n\nSolid layout.\n\n---\nProposed total: 88/100\nAI-authored likelihood: low\n";

// counters, reset between phases
let COUNT = { total: 0, blob: 0, notModified: 0 };
// GitHub exposes ETag cross-origin via Access-Control-Expose-Headers; without it
// the browser hides the header from JS and gh.mjs can't capture it. Model that.
const H = etag => ({ etag, "access-control-allow-origin": "*", "access-control-expose-headers": "ETag, X-RateLimit-Remaining", "x-ratelimit-remaining": "4999", "x-ratelimit-limit": "5000" });
async function stub(route) {
  const req = route.request();
  const p = new URL(req.url()).pathname;
  COUNT.total++;
  if (/\/git\/blobs\//.test(p)) COUNT.blob++;
  const accept = req.headers()["accept"] || "";
  const wantsRaw = accept.includes("raw");
  const etag = '"' + p + '"';   // deterministic per URL -> models a conditional GET
  // honor If-None-Match: a matching etag -> 304 (the cheap-revalidation path)
  if ((req.headers()["if-none-match"] || "") === etag) { COUNT.notModified++; return route.fulfill({ status: 304, headers: H(etag) }); }
  const done = (body, ct) => route.fulfill({ status: 200, contentType: ct, headers: H(etag), body });
  const miss = () => route.fulfill({ status: 404, headers: H(etag), body: "{}" });
  const json = o => done(JSON.stringify(o), "application/json");
  const raw = t => done(t, "text/plain");
  const m = p.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (!m) return miss();
  const [, , repo, rest0] = m; const rest = rest0 || "";
  const section = (repo.match(/-(\d{4})-/) || [])[1] || "0001";
  if (rest === "") return json({ default_branch: "main" });
  if (rest.startsWith("/contents/grader/assignments.json")) return wantsRaw ? raw(ASSIGN) : json({ content: b64(ASSIGN), sha: "s" });
  if (rest.startsWith("/contents/course.config.json")) return miss();
  if (rest.startsWith("/contents/gradebook/grades.csv")) return wantsRaw ? raw(gradesCsv(section)) : json({ content: b64(gradesCsv(section)), sha: "s" });
  if (rest.startsWith("/git/trees/")) return json({ tree: STUDENTS.map(([, , gh]) => ({ type: "blob", path: `gradebook/notes/m3a1/m3a1-${section}-${gh}.md`, sha: `notesha-${section}-${gh}` })) });
  if (rest.startsWith("/git/blobs/")) return raw(NOTE);
  if (rest.startsWith("/contents/attendance/summary.json")) return miss();
  if (rest.startsWith("/contents/gradebook/FLAGS.md")) return miss();
  if (rest.startsWith("/contents/reports")) return miss();
  if (rest === "/contents/gradebook/intents") return json([]);
  if (rest.startsWith("/actions/workflows/")) return json({ total_count: 0, workflow_runs: [] });
  return miss();
}
// force every persisted section snapshot to look stale, so the next open serves
// it (instant paint) AND kicks a background revalidate (the SWR path we test)
const ageSnapshots = page => page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open("console-cache-v1");
  rq.onsuccess = () => { const db = rq.result; const s = db.transaction("sections", "readwrite").objectStore("sections"); const g = s.getAll(); g.onsuccess = () => { for (const r of g.result) { r.loadedAt = 1; s.put(r); } res(g.result.length); }; g.onerror = () => res(0); };
  rq.onerror = () => res(0);
}));

const CONFIG = { repos: [{ url: "github.com/COURSE-ORG-A/teacher-6xxx-0001-tjakoen", token: "fake" }], labels: {} };
// runs in the browser: takes the config as an arg (can't close over Node scope)
const seed = cfg => { localStorage.setItem("course-crumb-first-run-v1", "1"); localStorage.setItem("grader-ui-config-v1", JSON.stringify(cfg)); };
const gradebookRows = async page => page.evaluate(() => document.querySelectorAll("table.matrix tr").length);

const browser = await chromium.launch();
let failures = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok  " : "FAIL ") + name + (extra ? " · " + extra : "")); if (!ok) failures++; };

// ---- Phase 1: cold load, then warm reload (same IndexedDB) ----
{
  const ctx = await browser.newContext();
  await ctx.route("https://api.github.com/**", stub);
  await ctx.addInitScript(seed, CONFIG);
  const page = await ctx.newPage();

  COUNT = { total: 0, blob: 0, notModified: 0 };
  await page.goto("http://localhost:8932/#/c/6xxx-0001/gradebook");
  await page.waitForTimeout(1600);
  const cold = { ...COUNT };
  const coldRows = await gradebookRows(page);
  check("cold load paints the gradebook", coldRows > 1, coldRows + " rows");
  check("cold load fetched note blobs", cold.blob > 0, cold.blob + " blob reqs");
  await page.waitForTimeout(900);   // let fire-and-forget IDB writes flush
  const aged = await ageSnapshots(page);   // make the snapshot stale -> warm open revalidates
  check("cold load persisted a section snapshot", aged > 0, aged + " snapshot(s)");

  COUNT = { total: 0, blob: 0, notModified: 0 };
  await page.reload();              // fresh page boot; in-memory cache empty, IDB warm
  await page.waitForTimeout(2000);
  const warm = { ...COUNT };
  const warmRows = await gradebookRows(page);
  check("warm reload still paints the gradebook", warmRows > 1, warmRows + " rows");
  check("warm reload serves note blobs from cache (0 requests)", warm.blob === 0, warm.blob + " blob reqs");
  check("warm reload revalidates mutable resources via cheap 304s", warm.notModified > 0, warm.notModified + " 304s");
  check("warm reload makes no more requests than cold", warm.total <= cold.total, "cold " + cold.total + " -> warm " + warm.total);
  await ctx.close();
}

// ---- Phase 2: IndexedDB unavailable -> memory-only fallback, no throw ----
{
  const ctx = await browser.newContext();
  await ctx.route("https://api.github.com/**", stub);
  await ctx.addInitScript(() => { try { Object.defineProperty(window, "indexedDB", { get: () => undefined }); } catch {} });
  await ctx.addInitScript(seed, CONFIG);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(e.message));
  await page.goto("http://localhost:8932/#/c/6xxx-0001/gradebook");
  await page.waitForTimeout(1600);
  const rows = await gradebookRows(page);
  check("no-IndexedDB context still loads the gradebook", rows > 1, rows + " rows");
  check("no-IndexedDB context throws nothing", errs.length === 0, errs.join("; "));
  await ctx.close();
}

await browser.close();
server.kill();
console.log(failures ? `\n${failures} cache check(s) FAILED` : "\nall cache checks passed");
process.exit(failures ? 1 : 0);
