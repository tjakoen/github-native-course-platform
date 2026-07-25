#!/usr/bin/env node
// Bakes the GRAIN theme (tokens + base/skin + grade mechanism + Baguette flavor +
// embedded Redaction fonts) AND the REAL component CSS for every grain component the
// app composes, from the installed @tjakoen/grain package into site/theme.css, so the
// Pages site stays self-contained (no CDN, no node_modules at view time).
// grain stays the source of truth: never hardcode its tokens/classes back into the
// app — change the look in grain and bump the dep. This is the repo's only build step.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const grainFile = p => fs.readFileSync(fileURLToPath(import.meta.resolve("@tjakoen/grain/" + p)), "utf8");
const grainFont = f => "data:font/woff2;base64," + fs.readFileSync(fileURLToPath(import.meta.resolve("@tjakoen/grain/fonts/" + f))).toString("base64");

// The REAL component CSS for every grain component the app composes. Loaded from the
// installed package and inlined so the hosted shell carries every component class the
// app uses, self-contained. Keep this list in sync with the classes site/app.mjs emits.
const GRAIN_COMPONENTS = [
  "components/atoms/b-badge/b-badge.css",         // .badge — kind/status/decision tags
  "components/atoms/b-button/b-button.css",       // .btn — every action
  "components/atoms/b-icon/b-icon.css",           // .icon — rail/nav glyphs
  "components/atoms/b-input/b-input.css",         // .field/.field__input — search, override, feedback editors
  "components/atoms/b-kbd/b-kbd.css",             // .kbd — the ⌘K hint
  "components/atoms/b-list/b-list.css",           // .list — md-lite lists
  "components/atoms/b-select/b-select.css",       // .field__select — the code-file picker
  "components/atoms/b-meter/b-meter.css",         // .meter — review progress
  "components/atoms/action-badge/action-badge.css", // .action-badge — op step lines
  "components/atoms/code-block/code-block.css",   // .code-block — prompts, notes, source viewer
  "components/molecules/card/card.css",           // .card — every panel
  "components/molecules/stat-tile/stat-tile.css", // .stat — the section KPI strip
  "components/molecules/table/table.css",         // .table/.table-scroll — matrix, queue, Canvas preview
  "components/molecules/callout/callout.css",     // .callout — the Canvas-panel aside
  "components/molecules/tab/tab.css",             // .tab — section/mode/activity switchers
  "components/molecules/made-with/made-with.css", // .made-with — the fleet byline footer
  "components/molecules/status-list/status-list.css", // .status-list — the scanner's scanned-names list
  "components/molecules/nav-item/nav-item.css",   // .nav-item — the side-rail entries
  "components/molecules/chip-group/chip-group.css", // .chips — facet filters
  "components/molecules/content-index/content-index.css", // .content-index — listings
  "components/molecules/lede/lede.css",           // .lede — view intros
  "components/organisms/tab-bar/tab-bar.css",     // .tab-bar — the strip the tabs sit in
  "components/organisms/app-shell/app-shell.css", // .app-shell — the LMS shell grid
  "components/organisms/side-rail/side-rail.css", // .side-rail — the left nav rail
  "components/organisms/topbar/topbar.css",       // .topbar-* — topbar control cluster
  "components/organisms/status-bar/status-bar.css", // .status-bar — bottom status row
  "components/organisms/sidebar-panel/sidebar-panel.css", // .assistant — reserved aside
  "components/organisms/timeline/timeline.css",   // .timeline — run history feeds
  "components/organisms/console/console.css",     // .console__* — docked op feed
  "components/organisms/file-tree/file-tree.css", // .file-tree — code browsing
  "components/organisms/code-editor/code-editor.css", // .code-editor — code viewer chrome
  "components/organisms/note/note.css",           // .note — rendered markdown articles
  "components/organisms/app-window/app-window.css", // .window-bar__search — the cmdk anchor
];

// Grain's runnable islands + icon sprite, copied from the installed package into
// site/vendor/grain/ so the Pages artifact is self-contained (no node_modules at
// view time). Committed like jsQR; `npm run bake` refreshes them on a grain bump.
const GRAIN_SCRIPTS = ["cmdk.js", "shell.js", "tabs.js", "theme.js", "theme-boot.js", "lightbox.js"];

const GRAIN = [
  grainFile("styles/variables.css")
    .replace(/@import\s+"themes\/[^"]+";\s*/g, "")                                          // drop flavor imports (Baguette is applied below)
    .replace(/url\("\/fonts\/([^"]+\.woff2)"\)/g, (_m, f) => 'url("' + grainFont(f) + '")'), // embed Redaction woff2 offline
  grainFile("styles/global.css"),                                                            // base/skin (paper, type, links, .muted, focus)
  grainFile("styles/grain.css"),                                                             // the grade-as-signal mechanism (data-grade / .field)
  grainFile("styles/themes/brioche.css"),                                                    // the Brioche flavor (data-theme="brioche") - warm cream + honey gold, distinct from the portfolio's look
  ...GRAIN_COMPONENTS.map(grainFile),
].join("\n");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(HERE, "../site/theme.css");
const GRAIN_ALL = GRAIN + "\n" + grainFile("styles/cmdk.css") + "\n" + grainFile("styles/lightbox.css") + "\n" + grainFile("ai/ai.css");   // ai.css styles the spotlight lamp the CRUMB tour drives
fs.writeFileSync(out, GRAIN_ALL);
console.log(`theme.css baked | ${Math.round(GRAIN_ALL.length / 1024)} KB -> ${out}`);

const vendorDir = path.resolve(HERE, "../site/vendor/grain");
fs.mkdirSync(vendorDir, { recursive: true });
for (const f of GRAIN_SCRIPTS) {
  fs.copyFileSync(fileURLToPath(import.meta.resolve("@tjakoen/grain/scripts/" + f)), path.join(vendorDir, f));
}
fs.copyFileSync(fileURLToPath(import.meta.resolve("@tjakoen/grain/assets/sprite.svg")), path.join(vendorDir, "sprite.svg"));
console.log(`vendored ${GRAIN_SCRIPTS.length} grain scripts + sprite -> ${vendorDir}`);

// MILL: bundle the markdown -> GRAIN-classes renderer (server-side TS in the
// package) into a browser ESM the console imports at runtime. Build-time only -
// the served page stays no-build, no-CDN.
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [fileURLToPath(import.meta.resolve("@tjakoen/mill/adapters/grain/grain-adapter.ts"))],
  bundle: true, format: "esm", platform: "browser", minify: true,
  outfile: path.resolve(HERE, "../site/vendor/mill.js"),
});
console.log("vendored mill renderer -> site/vendor/mill.js");

// CRUMB: bundle the tour client. crumb-live.js imports grain's ai-spotlight by
// the host-absolute path "/scripts/ai-spotlight.js" (fine on a root-mounted
// grain app, a 404 under this project-page subpath), so the bundle resolves
// that specifier to the installed grain package instead. Tour DATA stays in
// site/crumb/tours/ (host-authored JSON, fetched at runtime via
// data-crumb-prefix). crumb.css ships alongside.
const grainSpotlight = fileURLToPath(import.meta.resolve("@tjakoen/grain/scripts/ai-spotlight.js"));
await esbuild.build({
  entryPoints: [fileURLToPath(import.meta.resolve("@tjakoen/crumb/crumb-live.js"))],
  bundle: true, format: "esm", platform: "browser", minify: true,
  outfile: path.resolve(HERE, "../site/vendor/crumb.js"),
  plugins: [{ name: "grain-spotlight", setup(b) {
    b.onResolve({ filter: /^\/scripts\/ai-spotlight\.js$/ }, () => ({ path: grainSpotlight }));
  } }],
});
fs.copyFileSync(fileURLToPath(import.meta.resolve("@tjakoen/crumb/crumb.css")), path.resolve(HERE, "../site/vendor/crumb.css"));
console.log("vendored crumb tour client -> site/vendor/crumb.js + crumb.css");
