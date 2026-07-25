# Command vocabulary (the AI's action contract)

GRAIN's principle is one vocabulary for human and AI. In this tool the human
operates the dashboard; the AI operates the repos. The dashboard never writes to
a repo itself: it emits a **prompt (an Intent)** that you paste into a Claude
Code session, and the AI performs the writes as `git`/`gh` operations
(**RenderOps**). Every Intent is human-reviewed before dispatch.

## Getting the data (the hosted shell does this for you)

There are no local build/fetch commands. The dashboard at
**https://tjakoen.github.io/grader-ui/** pulls everything live from the GitHub API
in your browser: gradebooks on load, and screenshots / submission code on demand as
you open each review. **↻ Refresh** re-fetches. See [usage.md](usage.md) for the
Settings (repo URLs + PAT) that authorize those reads.

The only build step in this repo is `npm run bake`, which bakes the GRAIN theme +
component CSS from `@tjakoen/grain` into `site/theme.css` (run automatically by the
Pages deploy). The `src/` CLIs (`npm run audit` / `fix` / `blanks`) are local
data-hygiene tools, not part of the review flow.

## Intents (the dashboard generates these; the AI executes them)

- **Apply-grades prompt** (Gradebook tab). Emits the reviewed grades for a
  section and instructs the assistant to push the deterministic (non-AI) activities
  to Canvas in check-then-execute order. Canvas-only. Works from the teacher repo path.
- **Deliver to Canvas + workspaces** (Gradebook tab). The all-activities delivery
  intent for a section's DETERMINISTIC activities (auto-graded tests + quizzes):
  student publish (`publish.yml` / `publish-grades.mjs`, only the `publish: true`
  ones) plus a Canvas push, both dry-run first and gated on the instructor's go.
  It has NO `aiScore` gating because these scores are final, not held. AI-graded /
  held activities and manual ones are excluded on purpose (held flows through the
  AI Review tab's Finalize; manual is entered in Canvas by hand). Each activity
  column in the Gradebook matrix carries a **kind chip** (push / held / quiz /
  manual) so every activity is visibly part of the review surface.
- **Apply reviewed AI grades** (AI Review tab). Emits each reviewed decision
  (final score + edited student-facing / instructor-only text), instructs the
  assistant to write back the correct half of `gradebook/notes/<id>/<repo>.md`
  and blank any flagged or unreviewed `aiScore`. A blank `aiScore` holds a
  student out of the Canvas push (`canvas-push` skips it) and marks them
  not-cleared for delivery. This intent writes grades only; it does not publish
  or push. Delivery is the separate Finalize intent below.
- **Finalize and deliver** (AI Review tab, per activity). Emits the delivery
  prompt: student publish plus Canvas push, for the cleared (approved + override)
  students only, dry-run first and gated on the instructor's go. It lists the
  cleared repos and the held-out ones explicitly. `publish-grades.mjs` now gates on
  `aiScore` (a blank `aiScore` holds a student out of BOTH the student publish and
  the Canvas push), so an activity-wide `publish only=<id>` delivers exactly the
  cleared students and finalize is effectively one-shot.

## The review gate (invariant)

Instructor-only scores and the AI likelihood / "vibecode" flag never reach
students. The student-facing text is prose only. An AI grade reaches a student
only through a deliberate human review here, then a generated Intent that the
human dispatches. The AI acts; the human decides.
