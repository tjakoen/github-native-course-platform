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
await view("templates", "#/templates", "table.matrix tr[data-row]");

// The Templates board has to separate two policies: a private TEMPLATE is just an
// unreleased activity, while a public SOLUTION is the worked answer leaking - with
// m1a1 the documented exception. The fixture plants exactly one accidental leak,
// so a board that reports none is not reading, and one that reports m1a1 is not
// thinking.
try {
  await page.goto(U("#/templates"), { waitUntil: "domcontentloaded" });
  await page.waitForSelector("table.matrix tr[data-row]", { timeout: 25000 });
  await page.keyboard.press("Escape");
  const t = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tr[data-row]")];
    const tone = (r, cell) => { const b = r.querySelector("[data-cell='" + cell + "'] .badge"); return b ? b.dataset.tone + ":" + b.textContent : "none"; };
    return {
      rows: rows.length,
      exposedBanner: [...document.querySelectorAll("p")].filter(p => /worked solution\(s\) are public/.test(p.textContent)).length,
      badSolutions: rows.filter(r => tone(r, "solution").startsWith("bad")).map(r => r.dataset.row),
      m1a1Solution: tone(rows.find(r => r.dataset.row === "m1a1") || document.createElement("tr"), "solution"),
      unreleased: rows.filter(r => tone(r, "template").startsWith("held")).length,
    };
  });
  if (!t.rows) fail.push("templates: no rows");
  if (t.exposedBanner < 1) fail.push("templates: the planted public solution was not reported");
  if (t.badSolutions.includes("m1a1")) fail.push("templates: m1a1-solution flagged, but it is the documented public example");
  if (!t.unreleased) fail.push("templates: no unreleased template detected");
  await page.screenshot({ path: `${OUT}/templates-verdicts.png` });
  console.log(`ok  templates-verdicts (${t.rows} rows, exposed ${JSON.stringify(t.badSolutions)}, m1a1 solution ${t.m1a1Solution}, ${t.unreleased} unreleased)`);
} catch (e) { fail.push("templates-verdicts: " + e.message); }

// Content coverage: compares each workspace's content/<unit> tree sha against the
// teacher repo's. The fixture drifts some workspaces on purpose, so a run that
// finds everything current is a broken comparison, not a tidy class - which is
// exactly what a path-derived demo sha used to produce (nothing could ever match).
try {
  await page.goto(U("#/c/CS401-1101/activities"), { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#pmCheck", { timeout: 25000 });
  await page.keyboard.press("Escape");
  await page.click("#pmCheck");
  await page.waitForSelector(".unitpick .unitstat .badge", { timeout: 40000 });
  await page.waitForFunction(() => /workspace\(s\) checked/.test(document.querySelector(".cov")?.textContent || ""), { timeout: 40000 });
  const cov = await page.evaluate(() => {
    const badges = [...document.querySelectorAll(".unitpick .unitstat .badge")];
    return {
      units: badges.length,
      current: badges.filter(b => b.dataset.tone === "good").length,
      behind: badges.filter(b => b.dataset.tone !== "good").length,
      orphans: /Orphan units/.test(document.querySelector(".cov").textContent),
      summary: document.querySelector(".cov p").textContent.trim(),
    };
  });
  if (!cov.units) fail.push("coverage: no unit badges");
  if (!cov.current) fail.push("coverage: nothing read as current (sha comparison is broken)");
  if (!cov.behind) fail.push("coverage: the planted stale/missing units were not detected");
  if (!cov.orphans) fail.push("coverage: the planted orphan unit was not reported");
  await page.click("#pmStale");
  const picked = await page.evaluate(() => [...document.querySelectorAll(".unitpick input:checked")].length);
  if (picked !== cov.behind) fail.push(`coverage: "Select stale + missing" picked ${picked}, expected ${cov.behind}`);
  await page.screenshot({ path: `${OUT}/content-coverage.png` });
  console.log(`ok  content-coverage (${cov.units} units, ${cov.current} current, ${cov.behind} behind, orphans reported, select picked ${picked})`);
} catch (e) { fail.push("content-coverage: " + e.message); }

// A DELIVERED activity must be recognized from the repo alone. MOB210's m3a6 is
// publish:true with every aiScore written, and this profile has no saved
// decisions, so the lane is reading ground truth or nothing. Guards the exact
// failure this replaced: the stage header ran off localStorage, showed Deliver as
// still pending, and re-armed Finalize on an activity students already had.
try {
  await page.goto(U("#/c/MOB210-2202/review/m3a6"), { waitUntil: "domcontentloaded" });
  await page.waitForSelector("table.table tr[data-s]", { timeout: 25000 });
  const st = await page.evaluate(() => {
    const steps = [...document.querySelectorAll(".stepper__step")].map(s => s.dataset.state);
    return {
      steps,
      // the activity tabs are the SECOND .tab-bar on the route (the first is the
      // class nav), so read them all rather than guessing an index
      delivered: [...document.querySelectorAll(".tab-bar")].some(b => /delivered/i.test(b.textContent || "")),
      truth: /written to/i.test(document.body.textContent || ""),
      primary: document.querySelector("#rvPrimary")?.textContent || "",
      // the m3a6 activity tab's own pill, e.g. "22/22" once the gradebook settles it
      pill: [...document.querySelectorAll(".tab")].find(t => /^m3a6/.test(t.textContent || ""))?.querySelector(".pill")?.textContent || "",
      // the class nav's "AI Review (n)" count
      navReview: [...document.querySelectorAll("#ctxTabs .tab")].find(t => /AI Review/.test(t.textContent || ""))?.textContent || "",
      rows: document.querySelectorAll("table.table tr[data-s]").length,
    };
  });
  if (!st.delivered) fail.push("delivered activity: no delivered mark in the activity tabs");
  // The counts must drain from the GRADEBOOK, not from saved decisions - this
  // profile has none. A delivered activity that still reads "0/22" and keeps its
  // rows in the AI Review badge is the stale-badge bug this guards.
  const [pillDone, pillAll] = st.pill.split("/").map(Number);
  if (!(pillDone > 0 && pillDone === pillAll)) fail.push(`delivered activity: tab pill is '${st.pill}', expected every row settled`);
  const navN = Number((st.navReview.match(/\((\d+)\)/) || [])[1] || 0);
  if (navN >= st.rows) fail.push(`delivered activity: AI Review badge is ${navN}, still counting the ${st.rows} delivered row(s)`);
  if (st.steps[3] !== "done") fail.push(`delivered activity: Deliver step is '${st.steps[3]}', expected 'done'`);
  if (!st.truth) fail.push("delivered activity: no gradebook truth line rendered");
  if (/finalize/i.test(st.primary)) fail.push("delivered activity: Finalize is still the armed primary action");
  console.log("ok  review-delivered (steps " + st.steps.join(",") + ", primary " + JSON.stringify(st.primary) + ")");
} catch (e) {
  fail.push("review-delivered: " + e.message.split("\n")[0]);
}
await page.screenshot({ path: `${OUT}/review-delivered.png` });

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
