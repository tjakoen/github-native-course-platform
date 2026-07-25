# CLAUDE.md: grader-ui

> Wires this repo into Tjakoen's personal standards (how I build with AI, voice, badges, AI-use
> posture). The standards live publicly at `https://tjakoen.github.io/standards` (source: the
> [`standards/`](https://github.com/tjakoen/tjakoen.github.io/tree/main/standards) dir in the
> portfolio repo) - **reference them, don't fork them.** `AGENTS.md` is a symlink to this file, so any
> tool that reads the cross-tool `AGENTS.md` convention gets the same instructions.

## What this is

grader-ui is a hosted review surface for the [GitHub-Native Course Platform](https://github.com/tjakoen/github-native-course-platform).
It is a **data-free GitHub Pages shell** (`site/`) that reads the teacher repos' gradebooks live from
the GitHub API in the browser, shows one grading-review dashboard, and generates the prompts an AI
runs to apply grading decisions (write grades, publish feedback, push to Canvas). The human reviews
and decides; the AI does the writing. The single most important thing to know before touching it:
**it never writes to a repo itself.** It emits a prompt (an intent) that a human runs in a Claude
Code session. That review gate is the whole design, so keep the mutation on the AI's side of a human
decision. (The local static build was retired 2026-07-24 in favor of the hosted shell; the
maintenance CLIs under `src/` — audit/fix/blanks — stay.)

## How I work here (non-negotiables)

The full rulebook is **[AI-DEVELOPMENT.md](https://tjakoen.github.io/standards/ai-development)** +
**[SESSION-LOOP.md](https://tjakoen.github.io/standards/session-loop)**. The short version:

- **I build with AI, out loud, on purpose.** Co-authored with Claude as a practice, not a git
  trailer. The receipt is the README badge + footer, not commit metadata.
- **AI multiplies, it doesn't add.** The AI types; I keep the judgment, the architecture, the final
  call. If I can't explain it, I didn't build it.
- **Definition of done = code + docs synced + green gate.** For this repo the gate is `npm install`
  (it imports `@tjakoen/grain`), `node --check lib/config.mjs src/*.mjs site/*.mjs site/lib/*.mjs`,
  and a clean `npm run bake` (the theme must build from the installed grain package into
  `site/theme.css`). Not one of these, all of them.
- **Write the decision down.** Keep a short record of *why* non-obvious choices were made so the next
  session inherits the reasoning.
- **Hand off when a task finishes.** Gate green, committed, decisions recorded, then emit a compact
  handoff.

## Voice (for any prose in my name)

Follow **[VOICE.md](https://tjakoen.github.io/standards/voice)**. The short version: honest, quirky,
self-deprecating, concrete, opinionated-with-the-why; **no backticks in prose** (fenced code blocks
and this kind of reference doc are exempt, where a literal token has to be exact); **no em-dashes**;
contractions in casual writing, expanded in formal docs. Never claim a benefit I haven't shown.

## README presentation

Follow **[README-STANDARD.md](https://tjakoen.github.io/standards/readme-standard)**: one title emoji,
a curated honest badge row led by the Made with Claude badge, and the text footer. Done at repo start;
re-run the standard's prompt if the stack changes.

## Commit convention

Gitmoji subject prefix. **No AI attribution trailers** (`Co-Authored-By: Claude` etc.). The receipt
behind the "built with Claude" claim is the README badge + footer and the flagship note.

## Repo-specific rules

- **Sections are auto-discovered, not hardcoded.** `lib/config.mjs` scans `classes/` and derives each
  section from ground truth (folder name, git remote, `grader/assignments.json`). `grader.config.json`
  is optional overrides only. Never reintroduce absolute paths or a per-tool section array.
- **No student PII in the repo, ever.** `classes/`, `out/`, and `grader.config.json` are gitignored
  because they hold student data. Confirm nothing under those is staged before any commit.
- **GRAIN is a real dependency, not a fork.** The theme (tokens, fonts, grade mechanism) is inlined
  from `@tjakoen/grain` at build time and embedded offline (no CDN/node_modules in the generated HTML).
  Never hardcode grain's tokens back into the dashboard; change the look in grain and bump the dep.
  Provenance uses grain's `data-grade` (AI-proposed = grain type, flips to clean on human edit). See
  [docs/grain-for-ai.md](docs/grain-for-ai.md); don't collapse the two.

## Docs / structure

- `README.md` - what it is + quickstart.
- `docs/usage.md` - setup and the everyday review flow.
- `docs/commands.md` - the AI action vocabulary (the generated prompts).
- `docs/grain-for-ai.md` - how the GRAIN design system applies here.
- `src/` tools, `lib/config.mjs` the single config source. Deeper platform design lives in the
  [umbrella repo](https://github.com/tjakoen/github-native-course-platform).
