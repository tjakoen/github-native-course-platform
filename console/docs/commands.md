# Command vocabulary (the AI's action contract)

GRAIN's principle is one vocabulary for human and AI. In this tool the human
operates the console; the AI operates the repos. The console never writes a
grade, feedback note, or delivery itself: it emits a **prompt (an Intent)**
that a Claude Code session executes as `git`/`gh` operations ("run pending
intents"). Every Intent is human-reviewed before it is even filed, and again
before the AI dispatches anything from it.

## Getting the data (the hosted shell does this for you)

There are no local build/fetch commands for review. The console at
**https://tjakoen.github.io/github-native-course-platform/** pulls everything
live from the GitHub API in your browser: class discovery on boot, a class's
gradebook when you open it, and screenshots / submission code on demand as
you open each review. The topbar **↻** button re-fetches the current view;
**Cmd/Ctrl-K** is the global search. See [usage.md](usage.md) for the
Settings (repo URLs + PAT) that authorize those reads.

The only build step in this repo is `npm run bake`, which bakes the GRAIN
theme + component CSS from `@tjakoen/grain` into `site/theme.css` (run
automatically by the Pages deploy). The `src/` CLIs (`npm run audit` / `fix`
/ `blanks`) are local data-hygiene tools, not part of the review flow.

## Intents (the console generates these; the AI executes them)

Six of the seven intent kinds are **byte-guarded**: `scripts/check-intents.mjs`
runs each builder in `site/lib/intents.mjs` against a frozen synthetic
section and byte-compares the output to a golden fixture under
`scripts/fixtures/intents/` (`npm run check:intents`; the same check also
runs as a tripwire in the Pages deploy workflow). That guard exists because
the `apply-reviewed-grades` and `finalize-grades` skills **parse** these
prompt formats - a deliberate format change must update the fixtures
(`--update`) **and** the skills together in the same commit, never one alone.

- **Apply-grades prompt** (`apply-grades`, Gradebook tab). Emits the
  reviewed grades for a section and instructs the assistant to push the
  deterministic (non-AI) activities to Canvas in check-then-execute order.
  Canvas-only. Works from the teacher repo path.
- **Deliver to Canvas + workspaces** (`deliver`, Gradebook tab). The
  all-activities delivery intent for a section's DETERMINISTIC activities
  (auto-graded tests + quizzes): student publish (`publish.yml` /
  `publish-grades.mjs`, only the `publish: true` ones) plus a Canvas push,
  both dry-run first and gated on the instructor's go. It has NO `aiScore`
  gating because these scores are final, not held. AI-graded / held
  activities and manual ones are excluded on purpose (held flows through
  the AI Review tab's Finalize; manual is entered in Canvas by hand). Each
  activity column in the Gradebook matrix carries a **kind chip** (push /
  held / quiz / manual) so every activity is visibly part of the review
  surface.
- **Generate feedback prompt** (`gen-feedback`, AI Review tab). Turns each
  grade sweep's `gradebook/notes-input/<id>/<repo>.md` into a reviewable
  draft note at `gradebook/notes/<id>/<repo>.md` (student-facing prose half,
  then the instructor-only rubric breakdown, proposed score, and
  AI-authored-likelihood line). Drafts only - it never writes grades.csv,
  flips `publish`, publishes, or pushes Canvas, and it skips any submission
  that already has a note.
- **Apply reviewed AI grades** (`apply-ai`, AI Review tab). Emits each
  reviewed decision (final score + edited student-facing / instructor-only
  text), instructs the assistant to write back the correct half of
  `gradebook/notes/<id>/<repo>.md` and blank any flagged or unreviewed
  `aiScore`. A blank `aiScore` holds a student out of the Canvas push
  (`canvas-push` skips it) and marks them not-cleared for delivery. This
  intent writes grades only; it does not publish or push. Delivery is the
  separate Finalize intent below.
- **Finalize and deliver** (`finalize`, AI Review tab, per activity). Emits
  the delivery prompt: student publish plus Canvas push, for the cleared
  (approved + override) students only, dry-run first and gated on the
  instructor's go. It lists the cleared repos and the held-out ones
  explicitly. `publish-grades.mjs` gates on `aiScore` (a blank `aiScore`
  holds a student out of BOTH the student publish and the Canvas push), so
  an activity-wide `publish only=<id>` delivers exactly the cleared students
  and finalize is effectively one-shot.
- **Manual attendance** (`manual-attendance`, Attendance tab). Pick students
  + a date; the intent tells the assistant to append teacher-attested rows
  (signature column = the literal word `manual`) to
  `attendance/sessions/<date>/manual.csv`, merge-never-overwrite, and push -
  the verify + receipts pipeline then runs on its own. `verify-attendance`
  counts these rows as present (MANUAL), never FLAGGED.

### New: `new-activity` (not yet byte-guarded)

Filed from the Activities tab's **+ New activity** wizard, step 2, after the
`grader/assignments.json` entry is already committed (step 1, a direct
diff-confirmed commit - see below). The intent hands the AI the exact
committed JSON entry and asks it to build the authoring scaffolds around it:
`grader/<id>/CANVAS.md` (the Canvas description body), `grader/<id>/RUBRIC.md`
for AI-graded activities (following `grader/RUBRIC-TEMPLATE.md`), and the
public activity template repo scaffold (starter, student-facing tests,
README, `student.json`, Autograde workflow) for non-manual activities. It
explicitly forbids flipping `publish` or creating the Canvas assignment by
hand - that stays the job of the `canvas-sync-assignments` workflow, run
separately from the console.

This format is **not** under the golden-fixture byte-compat gate: no skill
parses it yet, so it can change without a fixture update. If a skill is
later built to consume it, byte-guard it the same way as the other six and
note that here.

## Direct writes (the non-intent mutations)

- **Assignment flag flips**: the Activities tab's lock/publish toggles, and
  step 1 of the New activity wizard (adding the entry), are sha-guarded
  direct commits to `grader/assignments.json` - the diff is shown before you
  confirm. Nothing else about grades or delivery is ever written this way.
- **Engine workflows**: grade sweep, publish, Canvas push/sync/export,
  publish material, provisioning, prune, audits, and the attendance set all
  run via `workflow_dispatch` on the repo's own dry-run-gated workflows
  (Ops tab, or the per-activity buttons on Activities). A real write
  requires typing the class's section code back into a confirm.
- **Attendance scan CSVs**: the standalone scanner page (`scanner/`, not
  part of the console shell) commits scan batch CSVs
  (`attendance/sessions/<date>/<HHMM>-<label>.csv`) straight to the teacher
  repo with the same per-repo PAT, and its "Add manually" field records a
  teacher-attested `manual` row without a QR. Both are validated
  server-side by the repo's `verify-attendance` workflow.

Grades and feedback never have a direct write path - only the Intent path
above.

## The review gate (invariant)

Instructor-only scores and the AI likelihood / "vibecode" flag never reach
students. The student-facing text is prose only. An AI grade reaches a
student only through a deliberate human review here, then a generated Intent
that the human dispatches. The AI acts; the human decides.
