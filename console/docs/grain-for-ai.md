# GRAIN for AI

How this dashboard uses the GRAIN design system. The short version: it does not
re-implement the look, it **consumes the real package**. `@tjakoen/grain` is a
dependency, and its CSS and fonts are inlined into the dashboard at build time.
GRAIN's home and full docs live in the BREAD stack (`/grain`); this file is the
working spec a coding agent reads before touching the theme.

## The one law: provenance is shown in the type

- **Grain type** = the AI is acting, or a value is in transit, proposed, a draft.
  Use it for any model-generated grade or feedback that has **not** been
  human-confirmed.
- **Clean type** = a human wrote it, or it has committed. Use it the moment the
  teacher approves or edits a value.

No badges, no "AI" labels: switching provenance is a font-family swap. In this
dashboard the AI-proposed score renders in grain type; approving or editing flips
it to clean type.

## Where the theme comes from (do not fork it)

`scripts/bake-theme.mjs` (`npm run bake`) resolves grain's CSS from the installed
package with `import.meta.resolve('@tjakoen/grain/styles/...')`, reads it, and
concatenates it into `site/theme.css`, which the Pages shell links:

- `styles/variables.css` - the Sourdough tokens (paper, ink, the `--font-smooth`
  / `--font-grain` / `--font-accent` grade families, spacing, radius) and the
  light/dark scheme. Its optional flavor `@import`s are stripped and its
  `@font-face` `url("/fonts/*.woff2")` are rewritten to embedded `data:` URIs, so
  the baked stylesheet is self-contained (no CDN or node_modules at view time — the
  deployed page is a static shell).
- `styles/grain.css` - the grade-as-signal MECHANISM: `[data-grade="grain"]`,
  `.field` (grain at rest, clean on focus), `[data-commit="pending"]`.
- `styles/global.css` - grain's base/skin: the paper background and grain overlay,
  base typography, links, `.muted`, the focus ring.
- `styles/themes/baguette.css` - the active flavor (crisp near-white / near-black
  with a soft-blue accent), applied via `data-theme="baguette"` on the root.
  Sourdough is grain's hueless default; grader-ui opts into Baguette. Light and dark
  still follow grain's `data-color-scheme` axis.
- `components/**/*.css` - the REAL component CSS for every grain component the
  dashboard composes (the `GRAIN_COMPONENTS` list in `scripts/bake-theme.mjs`).
  The dashboard does not mimic grain's components with lookalike CSS; it ships
  grain's own stylesheets and uses grain's own classes: `.card`, `.stat`,
  `.table`/`.table-scroll`, `.badge`, `.btn`, `.field`/`.field__input`/`.field__select`,
  `.meter`, `.tab`/`.tab-bar`, `.callout`, `.code-block`, `.made-with`. Variants ride
  data-attributes, per grain's conventions.

The fleet byline (`made with GRAIN by tjakoen`) is mounted last in `<body>` via the
`madeWith()` string helper from `@tjakoen/grain/scripts/made-with.js`, with
`made-with.css` in the shipped set, so provenance reads the same as every other
GRAIN app.

The grade cells (green pass to red fail) are grader-ui's own, not grain's, since
grain is monochrome by doctrine. Their tint is scheme-aware (`curScheme()` reads
the live `data-color-scheme`, so a manual theme toggle recolors them, and dark uses
a softer hsl so the colors do not go muddy).

grader-ui's own CSS (the block after `${GRAIN}` in `CSS()`) is limited to two things:
layout/composition grain leaves to the parent (the wide page column, the stats grid,
the review drawer, the matrix's sticky column) and the few things grain is monochrome
about on purpose but a grading matrix genuinely needs (status hues on `.badge` via a
product `data-tone` attribute, heat cells, syntax colors). Tokens only - it reads
`var(--color-*)` / `--space-*` / `--text-*` and never re-declares grain's values. Dark
mode follows grain's `data-color-scheme` axis.

## Rules for the agent

1. **Never re-fork the theme.** Tokens, fonts, and the grade mechanism come from
   `@tjakoen/grain`. If the look needs to change, change it in grain and bump the
   dependency, do not hardcode values back into the dashboard.
2. **Use grain's mechanism for provenance,** not a bespoke class: mark un-reviewed
   model output with `data-grade="grain"` (or `.field` for an editable value); it
   settles to clean type when a human commits.
3. **Keep the offline guarantee.** Anything grain references externally (fonts)
   must be embedded at build time. No CDN or node_modules reference may survive
   into the generated HTML.
4. **Only grain.** grader-ui needs `@tjakoen/grain`, not batch/mill/proof.
