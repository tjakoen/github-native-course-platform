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
  "components/atoms/b-input/b-input.css",         // .field/.field__input — search, override, feedback editors
  "components/atoms/b-select/b-select.css",       // .field__select — the code-file picker
  "components/atoms/b-meter/b-meter.css",         // .meter — review progress
  "components/atoms/code-block/code-block.css",   // .code-block — prompts, notes, source viewer
  "components/molecules/card/card.css",           // .card — every panel
  "components/molecules/stat-tile/stat-tile.css", // .stat — the section KPI strip
  "components/molecules/table/table.css",         // .table/.table-scroll — matrix, queue, Canvas preview
  "components/molecules/callout/callout.css",     // .callout — the Canvas-panel aside
  "components/molecules/tab/tab.css",             // .tab — section/mode/activity switchers
  "components/molecules/made-with/made-with.css", // .made-with — the fleet byline footer
  "components/organisms/tab-bar/tab-bar.css",     // .tab-bar — the strip the tabs sit in
];

const GRAIN = [
  grainFile("styles/variables.css")
    .replace(/@import\s+"themes\/[^"]+";\s*/g, "")                                          // drop flavor imports (Baguette is applied below)
    .replace(/url\("\/fonts\/([^"]+\.woff2)"\)/g, (_m, f) => 'url("' + grainFont(f) + '")'), // embed Redaction woff2 offline
  grainFile("styles/global.css"),                                                            // base/skin (paper, type, links, .muted, focus)
  grainFile("styles/grain.css"),                                                             // the grade-as-signal mechanism (data-grade / .field)
  grainFile("styles/themes/baguette.css"),                                                   // the Baguette flavor (data-theme="baguette")
  ...GRAIN_COMPONENTS.map(grainFile),
].join("\n");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(HERE, "../site/theme.css");
fs.writeFileSync(out, GRAIN);
console.log(`theme.css baked | ${Math.round(GRAIN.length / 1024)} KB -> ${out}`);
