// E2E screenshot harness (dev-only, run locally: node scripts/e2e-shots.mjs).
// Serves site/ + stubs api.github.com with SYNTHETIC fixtures (zero PII) +
// seeded localStorage, walks every view, saves PNGs to /tmp/console-shots.
// Needs playwright; resolved from the batch-stack checkout (adjust the
// createRequire path if that moves). serves site/ locally, stubs
// api.github.com with synthetic fixtures (NO real data), seeds localStorage,
// walks the views, saves PNGs to the scratchpad.
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
const require = createRequire("/Users/tjakoenstolk/Local/Development/batch-stack/package.json");
const { chromium } = require("playwright");

const SITE = new URL("../site", import.meta.url).pathname;
const OUT = "/tmp/console-shots";
execSync(`mkdir -p ${OUT}`);

const server = spawn("python3", ["-m", "http.server", "8931"], { cwd: SITE, stdio: "ignore" });
await new Promise(r => setTimeout(r, 800));

const b64 = s => Buffer.from(s).toString("base64");
const REPOS = [
  { org: "HAU-6APSI", repo: "teacher-6apsi-2240-tjakoen", section: "2240" },
  { org: "HAU-6APSI", repo: "teacher-6apsi-2203-tjakoen", section: "2203" },
  { org: "HAU-6INTROWEB", repo: "teacher-6introweb-2106-tjakoen", section: "2106" },
];
const ASSIGN = JSON.stringify([
  { id: "m1a1", type: "vitest", namePrefix: "m1a1-", locked: true, publish: true },
  { id: "m2a1", type: "vitest", namePrefix: "m2a1-", totalPoints: 20, locked: true, publish: true },
  { id: "m3a1", type: "vitest", namePrefix: "m3a1-", totalPoints: 100, "ai-grading": true, feedback: "project", previews: "branch", locked: true, publish: false },
  { id: "m6a3", type: "vitest", manual: true, submit: "url", totalPoints: 20, title: "Publish Your Portfolio" },
]);
const STUDENTS = [
  ["Dela Cruz, Juan", "20250001", "juandc"], ["Santos, Maria", "20250002", "msantos"],
  ["Reyes, Pedro", "20250003", "preyes"], ["Garcia, Ana", "20250004", "agarcia"],
  ["Lim, Carlo", "20250005", "climdev"], ["Tan, Bea", "", "beatan"],
];
function gradesCsv(section) {
  const head = "repo,githubAccount,fullName,studentNumber,studentEmail,classCode,assignment,sha,passed,total,score,gradedAt,late,notes,aiScore,failures";
  const rows = [];
  for (const [name, num, gh] of STUDENTS) {
    rows.push(`m1a1-${section}-${gh},${gh},"${name}",${num},,${section},m1a1,abc1234,7,7,,2026-07-20,,,,`);
    if (gh !== "climdev") rows.push(`m2a1-${section}-${gh},${gh},"${name}",${num},,${section},m2a1,abc1234,${gh === "preyes" ? 2 : 3},3,,2026-07-21,,,,`);
    if (gh !== "beatan" && gh !== "preyes") rows.push(`m3a1-${section}-${gh},${gh},"${name}",${num},,${section},m3a1,abc1234,55,58,,2026-07-22,,,,`);
  }
  return head + "\n" + rows.join("\n") + "\n";
}
const NOTE = "# m3a1 feedback\n\nGreat structure and a clean layout; the hero section balances the imagery well. Consider tightening the color contrast on the nav.\n\n---\nProposed total: 88/100\nAI-authored likelihood: low - consistent with classwork\n";
const SUMMARY = s => JSON.stringify({ section: s, sessionDates: ["2026-07-20", "2026-07-22", "2026-07-24"], lastSession: "2026-07-24", students: { "20250001": { present: ["2026-07-20", "2026-07-22", "2026-07-24"], count: 3 }, "20250002": { present: ["2026-07-20", "2026-07-24"], count: 2 }, "20250003": { present: ["2026-07-20"], count: 1 } } });
const RUNS = { total_count: 1, workflow_runs: [{ id: 1, event: "workflow_dispatch", status: "completed", conclusion: "success", created_at: "2026-07-25T03:00:00Z", html_url: "https://github.com/x/y/actions/runs/1" }] };

async function stub(route) {
  const url = route.request().url();
  const p = new URL(url).pathname;
  const json = o => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
  const raw = t => route.fulfill({ status: 200, contentType: "text/plain", body: t });
  const accept = route.request().headers()["accept"] || "";
  const wantsRaw = accept.includes("raw");
  const m = p.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (!m) return route.fulfill({ status: 404, body: "{}" });
  const [, org, repo, rest0] = m; const rest = rest0 || "";
  const rp = REPOS.find(r => r.repo === repo);
  if (!rp) return route.fulfill({ status: 404, body: "{}" });
  const section = rp.section;
  if (rest === "" ) return json({ default_branch: "main" });
  if (rest.startsWith("/contents/grader/assignments.json")) return wantsRaw ? raw(ASSIGN) : json({ content: b64(ASSIGN), sha: "sha1" });
  if (rest.startsWith("/contents/gradebook/grades.csv")) return wantsRaw ? raw(gradesCsv(section)) : json({ content: b64(gradesCsv(section)), sha: "s" });
  if (rest.startsWith("/git/trees/")) {
    const tree = STUDENTS.filter(([, , gh]) => gh !== "beatan" && gh !== "preyes").map(([, , gh]) => ({ type: "blob", path: `gradebook/notes/m3a1/m3a1-${section}-${gh}.md` }));
    ["m1-basics", "m2-react", "m3-styling", "m4-backend"].forEach(u => tree.push({ type: "tree", path: `content/${u}` }, { type: "blob", path: `content/${u}/README.md` }));
    return json({ tree });
  }
  if (rest.startsWith("/contents/gradebook/notes/")) return wantsRaw ? raw(NOTE) : json({ content: b64(NOTE) });
  if (rest.startsWith("/contents/attendance/summary.json")) return wantsRaw ? raw(SUMMARY(section)) : json({ content: b64(SUMMARY(section)) });
  if (rest.startsWith("/contents/gradebook/FLAGS.md")) return wantsRaw ? raw("- m1a1-" + section + "-dupA and -dupB share studentNumber 20250009 - resolve by hand\n") : json({ content: b64("x") });
  if (rest === "/contents/reports") return json([
    { type: "file", name: "FLAGGED.md", size: 640, html_url: "https://github.com/x/FLAGGED.md" },
    { type: "file", name: "canvas-push-report.json", size: 2048, html_url: "https://github.com/x/report.json" },
  ]);
  if (rest.startsWith("/contents/reports/FLAGGED.md")) return wantsRaw ? raw("# Flagged for review\n\nTwo submissions share **studentNumber 20250009** - resolve by hand:\n\n- m1a1-" + section + "-dupA\n- m1a1-" + section + "-dupB\n") : json({ content: b64("x") });
  if (rest.startsWith("/contents/gradebook/GRADEBOOK.md")) return wantsRaw ? raw("# Gradebook - section " + section + "\n\n| Student | m1a1 | m2a1 |\n| --- | --- | --- |\n| Dela Cruz, Juan | 7/7 | 3/3 |\n| Santos, Maria | 7/7 | 3/3 |\n") : json({ content: b64("x") });
  // Phase D: pending-intents listing. 2240 has one filed intent so the Overview
  // strip renders; other sections have none (the strip hides itself).
  if (rest === "/contents/gradebook/intents") return json(section === "2240" ? [
    { type: "file", name: "20260725-140205-apply-ai-m3a1.md" },
    { type: "file", name: "20260725-090012-deliver.md" },
    { type: "dir", name: "done" },
  ] : []);
  if (rest.startsWith("/actions/workflows/")) return json(RUNS);
  return route.fulfill({ status: 404, body: "{}" });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
await ctx.route("https://api.github.com/**", stub);
// The shipped tour JSON pins route to the deployed subpath; locally the site is
// mounted at /, so serve the same tour with route rewritten (deploy-only field).
await ctx.route("**/crumb/tours/first-run.json", async (route) => {
  const { readFileSync } = await import("fs");
  const j = JSON.parse(readFileSync(`${SITE}/crumb/tours/first-run.json`, "utf8"));
  j.route = "/";
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
});
await ctx.addInitScript(() => {
  localStorage.setItem("hau-crumb-first-run-v1", "1");   // suppress the auto tour; shot it explicitly below
  localStorage.setItem("grader-ui-config-v1", JSON.stringify({ repos: [
    { url: "github.com/HAU-6APSI/teacher-6apsi-2240-tjakoen", token: "fake" },
    { url: "github.com/HAU-6APSI/teacher-6apsi-2203-tjakoen", token: "fake" },
    { url: "github.com/HAU-6INTROWEB/teacher-6introweb-2106-tjakoen", token: "fake" },
  ], labels: { "6APSI": "Application Development", "6INTROWEB": "Intro to Web" } }));
});
const page = await ctx.newPage();
const shot = async (name, full) => { await page.waitForTimeout(900); await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: !!full }); console.log("shot", name); };

await page.goto("http://localhost:8931/#/");
await shot("01-dashboard");
// Phase C: #/c/:key is the Overview (tiles, at-risk, Canvas preview, flags card,
// runs, Reports card); the grade matrix is one tab deeper at /gradebook.
await page.goto("http://localhost:8931/#/c/6APSI-2240"); await shot("02-overview");
// Phase D2: the pending-intents strip shows what the console filed but has not run.
console.log("overview pending-intents strip:", await page.evaluate(() => !![...document.querySelectorAll(".card h2")].find(h => h.textContent === "Pending intents")));
await page.waitForTimeout(600); await page.evaluate(() => { const m = document.getElementById("main"); m.scrollTop = m.scrollHeight; }); await shot("02a-overview-bottom");
await page.goto("http://localhost:8931/#/c/6APSI-2240/gradebook"); await shot("02-gradebook");
await page.waitForTimeout(400); await page.evaluate(() => { const m = document.getElementById("main"); m.scrollTop = m.scrollHeight; }); await shot("02b-gradebook-bottom");
// Phase D4: openNote splits the note into wrapping student/instructor halves and
// (for a held/AI cell) links into the review detail. Click the m3a1 held cell.
await page.evaluate(() => { const td = [...document.querySelectorAll("td.cell[data-a='m3a1']")].find(x => x.textContent.trim() && x.textContent.includes("/")); if (td) td.click(); });
await page.waitForTimeout(500);
console.log("openNote halves:", await page.evaluate(() => document.querySelectorAll(".drawer .notehalf").length), "· review link:", await page.evaluate(() => !!document.querySelector(".drawer .dp a[href*='/review/']")));
await shot("02d-opennote");
await page.evaluate(() => document.querySelectorAll(".drawer").forEach(d => d.remove()));
// Handoff button: open the apply-grades prompt drawer (the #prompt button lives
// on the Gradebook tab now), verify the "Open in Claude" trigger renders, its
// source resolves to the live prompt, encoding survives nasty input, and flag if
// real prompts routinely blow the URL budget.
await page.click("#prompt").catch(() => {});
await page.waitForTimeout(600);
const handoff = await page.evaluate(() => {
  const btn = document.querySelector("[data-handoff]");
  if (!btn) return { ok: false, why: "no handoff button" };
  const sel = btn.dataset.handoffSource;
  const src = document.querySelector(sel);
  const payload = src ? (src.textContent || "") : "";
  const tricky = "a & b # c\nline2 café ñ 100%";
  const composedTricky = window.grainHandoff.compose(btn.dataset.handoffUrl, tricky);
  const composedReal = window.grainHandoff.compose(btn.dataset.handoffUrl, payload);
  return {
    ok: true, url: btn.dataset.handoffUrl, sel, payloadLen: payload.length,
    sourceResolves: !!src && payload.length > 0,
    trickyRoundtrips: (() => { try { return new URL(composedTricky).searchParams.get("q") === tricky; } catch { return false; } })(),
    realUrlLen: composedReal.length,
  };
});
console.log("handoff:", JSON.stringify(handoff));
await shot("02c-handoff-drawer");
await page.evaluate(() => document.querySelectorAll(".drawer").forEach(d => d.remove()));
await page.goto("http://localhost:8931/#/c/6APSI-2240/activities"); await shot("03-activities");
await page.goto("http://localhost:8931/#/c/6APSI-2240/activities/new"); await shot("03b-activity-new");
await page.goto("http://localhost:8931/#/c/6APSI-2240/students"); await shot("04-students");
await page.goto("http://localhost:8931/#/c/6APSI-2240/students/20250001"); await shot("05-profile");
// Phase D1: AI Review stage header (stepper + one contextual primary + overflow).
await page.goto("http://localhost:8931/#/c/6APSI-2240/review"); await shot("06-review");
console.log("review stepper steps:", await page.evaluate(() => document.querySelectorAll(".stepper__step").length), "(want 4)");
console.log("review has ONE primary:", await page.evaluate(() => !!document.querySelector("#rvPrimary")), "· overflow:", await page.evaluate(() => !!document.querySelector(".ovmenu")));
// D1: overflow menu opens (native <details>)
await page.evaluate(() => { const d = document.querySelector(".ovmenu"); if (d) d.open = true; });
await shot("06d-review-overflow");
await page.evaluate(() => { const d = document.querySelector(".ovmenu"); if (d) d.open = false; });
await page.goto("http://localhost:8931/#/c/6APSI-2240/review/m3a1/20250001"); await shot("06b-review-detail");
console.log("detail kbd legend:", await page.evaluate(() => !!document.querySelector(".kbdlegend")), "· N-left counter:", await page.evaluate(() => /left|clear/.test(document.querySelector(".cnt")?.textContent || "")));
await page.keyboard.press("Meta+k"); await shot("07-cmdk");
await page.keyboard.press("Escape");
// Phase C: Ops is a per-class tab now. The old global #/ops/:key redirects here.
await page.goto("http://localhost:8931/#/c/6APSI-2240/ops"); await shot("08-ops");
// A1: after a dispatch the docked ops feed must be VISIBLE (data-console-open on
// .app-shell), not rendered into display:none. Click the first dry-run Run.
await page.locator(".opcard .opform .btn").first().click().catch(() => {});
await page.waitForTimeout(900);
console.log("app-shell data-console-open:", await page.evaluate(() => document.querySelector(".app-shell")?.hasAttribute("data-console-open")));
await shot("08b-ops-feed");
// Phase C redirects: retired global #/flags and #/reports fold into the Dashboard;
// #/ops/:key redirects into the class tab. Assert each lands where expected.
await page.goto("http://localhost:8931/#/flags"); await page.waitForTimeout(500);
console.log("#/flags redirect ->", await page.evaluate(() => location.hash), "(want #/)");
await page.goto("http://localhost:8931/#/ops/6APSI-2240"); await page.waitForTimeout(500);
console.log("#/ops/:key redirect ->", await page.evaluate(() => location.hash), "(want #/c/6APSI-2240/ops)");
// Reports viewer route still works (the standalone list is retired; card lives on Overview).
await page.goto("http://localhost:8931/#/reports/6APSI-2240/" + encodeURIComponent("reports/FLAGGED.md")); await shot("12-report-viewer");
// Real Settings page (no longer a drawer over a blank page).
await page.goto("http://localhost:8931/#/settings"); await shot("09-settings");
await page.goto("http://localhost:8931/#/"); await page.click("#loadAll").catch(() => {}); await page.waitForTimeout(1500); await shot("13-dashboard-loaded");
await page.click("[data-crumb-start]"); await page.waitForTimeout(600); await shot("14-tour-intro");
await page.click('[data-crumb="next"]'); await page.waitForTimeout(600); await shot("15-tour-step1");
await page.keyboard.press("Escape"); await page.waitForTimeout(300);
await page.goto("http://localhost:8931/scanner/"); await shot("10-scanner");

// A3: phone-width gradebook. The matrix must scroll inside its own .table-scroll
// box (with the sticky student column pinned to that scroller), not pan the
// whole page. Full-page shot so a horizontal page overflow would be obvious.
const narrow = await ctx.newPage();
await narrow.setViewportSize({ width: 390, height: 780 });
await narrow.goto("http://localhost:8931/#/c/6APSI-2240/gradebook");
await narrow.waitForTimeout(1200);
const overflow = await narrow.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
console.log("390px gradebook page-level horizontal overflow:", overflow, "(want false)");
await narrow.screenshot({ path: `${OUT}/16-gradebook-390.png`, fullPage: true });
console.log("shot 16-gradebook-390");
// B1 narrow: cmdk must be a full-width sheet, not squeezed to the trigger.
await narrow.keyboard.press("Meta+k");
await narrow.waitForTimeout(500);
const cmdk390 = await narrow.evaluate(() => { const d = document.querySelector(".cmdk"); return d ? Math.round(d.getBoundingClientRect().width) : null; });
console.log("390px cmdk width:", cmdk390, "(want ~374, near full viewport)");
await narrow.screenshot({ path: `${OUT}/17-cmdk-390.png` });
console.log("shot 17-cmdk-390");
await narrow.close();

// Dark-theme pass (B1/B2 both themes): a fresh page forced to dark scheme.
const dctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
await dctx.route("https://api.github.com/**", stub);
await dctx.addInitScript(() => {
  localStorage.setItem("grain-color-scheme", "dark");
  localStorage.setItem("hau-crumb-first-run-v1", "1");
  localStorage.setItem("grader-ui-config-v1", JSON.stringify({ repos: [
    { url: "github.com/HAU-6APSI/teacher-6apsi-2240-tjakoen", token: "fake" },
    { url: "github.com/HAU-6INTROWEB/teacher-6introweb-2106-tjakoen", token: "fake" },
  ], labels: { "6APSI": "Application Development", "6INTROWEB": "Intro to Web" } }));
});
const dpage = await dctx.newPage();
await dpage.goto("http://localhost:8931/#/c/6APSI-2240/gradebook");
await dpage.waitForTimeout(1200);
await dpage.screenshot({ path: `${OUT}/18-gradebook-dark.png` });
await dpage.keyboard.press("Meta+k");
await dpage.waitForTimeout(500);
await dpage.screenshot({ path: `${OUT}/19-cmdk-dark.png` });
console.log("shot 18-gradebook-dark + 19-cmdk-dark");
await dctx.close();

await browser.close();
server.kill();
console.log("done ->", OUT);
