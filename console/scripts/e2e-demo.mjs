// Demo-mode smoke test (dev-only: node scripts/e2e-demo.mjs, or npm run test:demo).
// Serves site/ and walks every view in DEMO MODE, so unlike e2e-shots.mjs it needs
// no route stubbing and no fixtures: the app serves its own synthetic data (see
// site/lib/demo.mjs). That makes this the cheap regression gate on the demo, and a
// decent one on the app - demo mode swaps the transport only, so every parser,
// renderer and write surface below it is the real one.
//
// It fails on any page error, on a missing expected element, and on any request
// to api.github.com (demo mode must never touch the network). Screenshots land in
// /tmp/console-demo for eyeballing.
//
// Needs playwright (a devDependency) plus its browser, once:
//   npm install && npx playwright install chromium
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch {
  console.error("this harness needs playwright:\n  npm install && npx playwright install chromium");
  process.exit(1);
}

const SITE = new URL("../site", import.meta.url).pathname;
const OUT = "/tmp/console-demo";
const PORT = 8952;
execSync(`mkdir -p ${OUT}`);
const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: SITE, stdio: "ignore" });
await new Promise(r => setTimeout(r, 900));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const fail = [];
page.on("pageerror", e => fail.push("pageerror: " + e.message));
// Strict: the page must be console-error clean. This is what caught the CSP
// blocking grain's data: webfonts and the lightbox's root-absolute sprite path,
// both fixed - keep it strict so neither can come back quietly.
page.on("console", m => { if (m.type() === "error") fail.push("console: " + m.text().slice(0, 160)); });
page.on("response", r => { if (r.status() >= 400) fail.push("HTTP " + r.status() + " " + r.url()); });
page.on("request", r => { if (r.url().includes("api.github.com")) fail.push("NETWORK LEAK in demo mode: " + r.url()); });

const U = h => `http://localhost:${PORT}/?demo=1${h}`;
async function view(name, hash, expect) {
  await page.goto(U(hash), { waitUntil: "domcontentloaded" });
  try { await page.waitForSelector(expect, { timeout: 25000 }); }
  catch { fail.push(`${name}: never rendered ${expect}`); }
  await page.keyboard.press("Escape");          // dismiss the auto-started tour
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("ok  " + name);
}

await view("dashboard", "#/", ".dashcard");
await view("overview", "#/c/CS401-1101", ".stats .stat");
await view("gradebook", "#/c/CS401-1101/gradebook", "table.matrix td.cell");
await view("students", "#/c/CS401-1101/students", "table.matrix tr.rowlink");
await view("activities", "#/c/CS401-1101/activities", "table.matrix .switch__input");
await view("activity-new", "#/c/CS401-1101/activities/new", ".stepper");
await view("review", "#/c/CS401-1101/review", "table.table tr[data-s]");
await view("attendance", "#/c/CS401-1101/attendance", "#attmatrix .attcell");
await view("ops", "#/c/CS401-1101/ops", ".opcard .oprunbtn");
await view("report", "#/reports/CS401-1101/" + encodeURIComponent("reports/canvas-crosscheck.md"), ".rbody h1, .rbody h2, .rbody p");
await view("attendance-empty", "#/c/WEB101-3303/attendance", ".card");
await view("review-flutter", "#/c/MOB210-2202/review", "table.table tr[data-s]");

// The review detail is the deep one: student code + generated screenshots + the
// split note (student-facing prose vs the instructor-only block) + a decision.
// Reached by a FULL document load (about:blank first) rather than a hash-only
// goto, so the step does not depend on how the previous view left the SPA.
await page.goto(U("#/c/CS401-1101/review"), { waitUntil: "domcontentloaded" });
await page.waitForSelector("table.table tr[data-s]", { timeout: 25000 });
const href = await page.locator("table.table tr[data-s] a").first().getAttribute("href");
await page.goto("about:blank");
await page.goto(U(href), { waitUntil: "domcontentloaded" });
await page.keyboard.press("Escape");
let shots = 0, decs = 0;
try {
  await page.waitForSelector("#dApprove", { timeout: 30000 });
  await page.waitForTimeout(2500);
  shots = await page.locator(".shot img").count();
  if (!shots) fail.push("review detail: no screenshots rendered");
  // Decide first: switching to the Code pane repaints the detail (the source loads
  // on demand), and clicking Approve into that repaint is a detached-node race.
  await page.click("#dApprove");
  await page.waitForTimeout(1200);
  await page.click(".tab[data-lv='code']");        // now on the next student in the queue
  await page.waitForSelector("#cfile option", { timeout: 20000 }).catch(() => {});
  const code = await page.locator("#cfile option").count().catch(() => 0);
  if (!code) fail.push("review detail: no student code listed");
  // Read the storage key from the module instead of hardcoding it. DKEY is a
  // frozen contract with everyone's saved browser state, but it HAS been renamed
  // once, and a stale copy here would silently assert nothing.
  const store = await page.evaluate(async () => {
    const { DKEY } = await import("./lib/decisions.mjs");
    const size = k => Object.keys(JSON.parse(localStorage.getItem(k) || "{}")).length;
    return { key: DKEY, demo: size(DKEY + "-demo"), real: size(DKEY) };
  });
  decs = store.demo;
  if (!decs) fail.push(`a review decision was not recorded in ${store.key}-demo`);
  if (store.real) fail.push(`demo wrote into the REAL decisions key (${store.key})`);
  console.log(`ok  review-detail (${shots} screenshot(s), ${code} code file(s), ${decs} decision recorded)`);
} catch (e) {
  fail.push("review detail (" + href + "): " + e.message.split("\n")[0]);
}
await page.screenshot({ path: `${OUT}/review-detail.png` });

// nothing may persist: in a pristine profile demo mode must not even create the cache DB
const dbs = await page.evaluate(async () => ((await indexedDB.databases?.()) || []).map(d => d.name));
if (dbs.includes("console-cache-v1")) fail.push("demo mode created the IndexedDB cache (it must not persist)");
console.log("ok  no persisted cache");

await browser.close();
server.kill();
if (fail.length) { console.error("\nFAILED (" + fail.length + "):"); fail.forEach(f => console.error(" " + f)); process.exit(1); }
console.log("\nall demo views rendered clean. screenshots in " + OUT);
