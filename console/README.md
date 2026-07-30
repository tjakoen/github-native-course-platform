# 📋 Course Console

[![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97757?logo=anthropic&logoColor=white)](https://tjakoen.github.io/notes/ten-times-zero)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-2ea44f)](LICENSE)
![Hosted on GitHub Pages](https://img.shields.io/badge/hosted-GitHub_Pages-2ea44f?logo=github)
![Data: none at rest](https://img.shields.io/badge/data_at_rest-none-2ea44f)
![Design system: GRAIN](https://img.shields.io/badge/design_system-GRAIN-2ea44f)

> The hosted management and review surface of the GitHub-Native Course Platform (this repo). It reads your teacher repos' gradebooks **live from the GitHub API in your browser**, shows one review dashboard, and generates the prompts an AI runs to apply your decisions. You review and decide; the AI does the typing.

The platform grades take-home and in-lab work with an AI, then *holds every AI grade for review*. This is where that review happens. AI-proposed grades and feedback show up in *grain* type; the moment you approve or edit one, it flips to *clean* type. Provenance is visible in the page itself, which is the one idea [GRAIN](https://tjakoen.github.io/grain) exists to make real.

## Try it without connecting anything (demo mode)

Add **`?demo=1`** to the URL, or press **Open the demo** on the first-run screen:
[tjakoen.github.io/github-native-course-platform/?demo=1](https://tjakoen.github.io/github-native-course-platform/?demo=1)

Demo mode runs the whole console on three invented classes generated in your browser from a fixed seed: gradebooks, AI feedback drafts with proposed scores and vibecode flags, student code and screenshots, attendance, audit reports, engine runs. There is no GitHub connection and no token.

It is **not** a mock-up of the UI. Demo mode replaces exactly one thing, the GitHub REST transport, with an in-memory implementation that answers the same endpoints; everything above it (the CSV parsing, the note precedence, the intent builders, the Actions polling) is the real code path. So the demo renders correctly for the same reasons production does, and a fixture that drifts from the real file shapes breaks the demo the way bad real data would.

Nothing leaks in either direction: the transport and snapshot caches are bypassed (so no synthetic row is persisted), review decisions go to their own storage key, your saved repos and tokens are never read, and every write is simulated in memory and gone when you close the tab. The flag lives in sessionStorage, so you cannot get stuck in it. `npm run test:demo` walks every view in demo mode and fails on any page error or any request to `api.github.com`.

## Data-free by design

The deployed page is an empty shell. **No student data is ever baked into it or stored on any server.** When you open it, it fetches your gradebooks straight from `api.github.com` using a read-only token you paste into Settings, which lives only in your own browser's localStorage. Nothing else leaves the page: the strict Content-Security-Policy allows exactly one outbound host, `api.github.com`. A deploy-time tripwire fails the build if any gradebook data sneaks into the artifact.

## Why prompts, not an in-app grade write

The dashboard doesn't apply grades itself. It *generates a prompt* holding every decision you made, and Claude Code does the actual git and gh writes back in the repo. That review gate is the whole design: you see every intent before it runs. The one thing the browser writes is the prompt file itself, under `gradebook/intents/`, so a local "run pending intents" picks it up without any copy-paste. (Every prompt drawer still has a Copy button if you'd rather paste it yourself.)

## How to use it (you review, the AI applies)

1. **Connect.** First open shows Settings. Add a row per teacher repo: the repo URL and that repo's own fine-grained GitHub PAT (scoped to just that repo). Each section carries its own token, so one expired PAT only affects that section. Everything stays in this browser only.
2. **Review.** Open the AI Review tab. Each held grade shows the automated score, the AI-proposed score in grain type, the screenshots or code (fetched on demand), and two feedback boxes (student-facing prose and instructor-only notes). Approve, override the score, flag for a closer look, or edit the text. Editing flips it from grain to clean, because now a human wrote it. Decisions are saved in your browser and can be exported/imported as a JSON backup.
3. **Send the intent.** Hit a Generate prompt button, then **Send to repo →**. The prompt lands as `gradebook/intents/<timestamp>-<kind>.md` in the teacher repo. It holds every decision you made, and blanks anything you flagged or skipped so it stays out of both the student publish and the Canvas push.
4. **Run it locally.** In a Claude Code session opened in the teacher repo, say "run the pending intents." The AI reads the intent file, does the writing (the gradebook, the feedback files, the Canvas push), and archives the intent. You watch it happen and keep the final say. Hit **Refresh** to see the result.

Nothing reaches a student or Canvas from a grade you did not review. The exact prompts it emits are catalogued in [docs/commands.md](docs/commands.md); the full walkthrough is in [docs/usage.md](docs/usage.md).

## The Scan tab (attendance)

The per-repo attendance QR scanner now lives here as the **Scan** tab: pick a section, point the phone camera at student QRs, commit the batch. Bookmark the `#/scan` hash on a phone home screen - it boots straight into the scanner without loading any gradebook. Scans commit as CSV batches to the teacher repo (verified server-side by its verify-attendance workflow); an "Add manually" field records a teacher-attested `manual` row for a student without their QR. QR decoding is self-hosted (vendored jsQR + native BarcodeDetector when available) - the strict one-host CSP is unchanged.

## Structure

```
site/       the hosted app (static shell + ES modules)
  index.html      shell, CSP, no CDN
  app.mjs         the dashboard UI (ported from the retired local build)
  app.css         layout on top of GRAIN
  theme.css       baked from @tjakoen/grain at deploy time (gitignored)
  lib/            gh (API adapter), gradebook, config, shots, code, store
  lib/demo*.mjs   demo mode: the virtual GitHub + its synthetic dataset
  crumb/tours/    the guided tours (one per view), read by the CRUMB client
scripts/    bake-theme.mjs - inlines the GRAIN theme into site/theme.css
            e2e-demo.mjs - walks every view in demo mode (npm run test:demo)
src/        maintenance tools (audit, fix, blanks) that scan a local classes/
lib/        config.mjs - section discovery for the maintenance tools
docs/       grain-for-ai, commands, usage
```

## Run it locally

```bash
npm install          # pulls @tjakoen/grain (the theme) from GitHub Packages
npm run dev          # bakes the theme, then serves site/ on a local port
```

The look comes from the `@tjakoen/grain` design-system package. The Pages workflow bakes it into `site/theme.css` at deploy time; the committed *.npmrc* points `@tjakoen` at GitHub Packages, which needs a token even for public packages. For local dev, add one line to your own *~/.npmrc* (never committed) with a PAT or `gh auth token` that has `read:packages`:

```
//npm.pkg.github.com/:_authToken=YOUR_TOKEN
```

## Your tokens

Give **each teacher repo its own fine-grained personal access token**, scoped to only that one repo, with **Contents: Read and write** (read for the gradebook; write only so the app can file intent prompts under `gradebook/intents/`) and **Metadata: Read**. Give each a short expiry. Per-repo tokens mean one expired or rejected PAT only affects that section, not every section, and each token's blast radius is a single repo. They never leave your browser, and the only host the page can reach is `api.github.com`.

## Status

Live, used to review real course grades. The deployed shell holds no data; the gradebooks it reads and the intents it files live in your teacher repos, and the token that reaches them lives only in your browser.

---
🤖 **Built with Claude. I don't prompt and pray, I prompt and prove.** Every commit here is co-authored with an AI, on purpose. [How I actually work with AI, receipts and all →](https://tjakoen.github.io/notes/ten-times-zero)
