# AI Feedback in Grading: Implementation Plan

Status: planning only, not yet implemented.

## Goal

Add automated, formative AI notes to the grading sweep. After a submission is
graded against the canonical tests, the AI looks at the submission (code plus,
for web work, the rendered pages) and writes short feedback the student can act
on. The notes ride along in the receipts the sweep already pushes, and a copy is
kept for the teacher.

The feedback never hands over the fix. It names the concept to revisit or asks a
guiding question, in line with the course's self-research principle.

## Decisions locked in

- **Audience:** both. A teacher copy (for triage) and a student-facing copy.
- **Provider:** GitHub Models (free), `gpt-4o-mini`. Chosen because the sweep
  runs in GitHub Actions, where the runner's built-in `GITHUB_TOKEN` already
  carries the `models: read` scope, so there is no API key to create, store, or
  rotate, and no cost. `gpt-4o-mini` is multimodal, so the screenshot/design half
  of the feedback still works. See the Provider section for limits and the paid
  scale-up path.
- **Trigger:** generated only for submissions that are actually (re)graded in a
  run, using the same skip/lock logic grading already uses. Unchanged
  submissions keep their previous notes for free.

## Feedback tiers

Two signals decide what the AI is asked for: how heavy the assignment is
(declared, not guessed) and whether the score is perfect.

### Declaring assignment weight and opting in

Each entry in `grader/assignments.json` takes two optional fields:

- `"ai-grading": true` turns AI feedback on for that activity. It is off unless
  set, so AI feedback is strictly opt-in per activity. No key is ever sent and no
  notes are generated for an assignment that has not opted in.
- `"feedback": "activity"` (simple, the default) or `"feedback": "project"`
  (complex) selects the tier, as below.

The teacher already curates this file per assignment, so it is the natural place
to both enable the feature and declare weight, and far more reliable than
inferring complexity from file counts.

```jsonc
{ "id": "m1a1", "type": "vitest", "namePrefix": "m1a1-" }                                            // activity, AI off (default)
{ "id": "m1a2", "type": "vitest", "namePrefix": "m1a2-", "ai-grading": true }                        // activity, AI on
{ "id": "proj1", "type": "vitest", "namePrefix": "proj1-", "feedback": "project", "ai-grading": true } // complex, AI on
```

`ai-grading` is the outermost gate: a row is only ever sent to the model when its
assignment has `"ai-grading": true` **and** the row warrants feedback per the
tiers below.

### The branch

Computed in the notes pass, with `perfect = total > 0 && passed === total`:

| Assignment | Score | What happens |
| --- | --- | --- |
| Activity | Perfect | No feedback. No API call, no entry, and it does not contribute a `FEEDBACK.md`. The passing score in `GRADES.md` already says everything. |
| Activity | Not perfect | One short paragraph: where they went wrong and which concepts to look into. No fixes, no code. |
| Project | Perfect | Full feedback anyway: code quality plus, where there is a UI, design. Framed as positives and gentle suggestions. |
| Project | Not perfect | The above, plus why the failing parts fell short and what to revisit. |

A row "warrants feedback" when its assignment has `"ai-grading": true` and it is
either a project (either score) or an activity that did not score perfectly.
Define `warrantsFeedback(row)` once and use it as the single gate: only warranted
rows call the model, only warranted rows produce a notes entry, and `FEEDBACK.md`
is written only for students who have at least one.

The activity-perfect short-circuit also means the screenshot/design analysis only
runs where it is wanted (projects, and imperfect web activities), so we are not
paying to analyze every passing one-pager.

## What the AI inspects

The generator sends three kinds of input and the prompt asks about whichever is
present. Frontend versus backend is a property of what is in the repo, not
something hardcoded per assignment.

- **Source code:** a `collectSourceFiles(clone)` helper walks the whole
  submission, so backend and logic files (route handlers, data access, business
  logic, Dart logic, and so on) are included alongside any markup. This is the
  basis for code-quality feedback regardless of whether the assignment has a UI.
  The helper keeps source files (`.js`, `.ts`, `.dart`, `.py`, server files, and
  similar), skips `node_modules`, `.git`, and binaries, and is size-capped to
  bound token usage.
- **Test results (the failing checks):** the list of checks that did not pass,
  so the feedback explains the *actual* failures instead of guessing them from
  the source. Without this the AI is told a submission is imperfect, handed the
  code, and asked to infer which checks failed and why; on a multi-test activity
  that is guesswork. The data already exists and is currently discarded: the
  sweep runs vitest with `--reporter=json` (and Dart with `--reporter json`) and
  keeps only `numPassedTests`/`numTotalTests`. The same JSON report carries each
  test's **title and failure/assertion message**. We capture the failed entries
  and pass them through (see the sweep change below). This input is the basis for
  the "why the failing checks did not pass" half of the feedback.

  **Answer-leak guard:** vitest/Dart failure messages can embed the expected
  value (`expected "x" to equal "y"`), which for some checks hands over the
  answer and violates the self-research principle. So the generator sends the
  failed-check **titles only by default**, and a message only when a per-class
  knob opts in (it never sends full messages for activities). Even then the
  system-prompt guardrail (never give the corrected code or the exact fix)
  still applies; the titles tell the AI *what* failed so it can name the concept
  to revisit, without dictating the fix.
- **Rendered screenshots:** only for web submissions that have `pages`, and only
  the basis for the visual-design half of the feedback.

### Where the screenshots live (this runs in the teacher repo)

The sweep runs from the teacher repo checkout, and that is where the generator
reads from. There is no need to fetch screenshots from anywhere else.

- Clones of each student submission live under `.grade-work/<repo>/` during the
  run. `collectSourceFiles` reads code from there.
- `renderPreviews` writes screenshots into the teacher repo at
  `gradebook/previews/<assignment>/<repo>/<page>.png`, one PNG per HTML page.
  The exact directory is given by the existing `previewDir(row)` helper
  (`gradebook/previews/${row.assignment}/${row.repo}`), and each page filename is
  on `row.pages[i].img`.
- So the generator builds each image path as
  `` `${previewDir(row)}/${page.img}` ``, reads the PNG with `readFileSync`, and
  sends it as a base64 image block. It should reuse `previewDir` rather than
  rebuild the path, so the two stay in sync.
- These are the same files `pushWorkspaceGrades` later copies into the student
  repo, so the AI sees exactly the images the student will see.

| Submission has | Feedback can cover |
| --- | --- |
| Failing checks (any imperfect submission) | why those specific checks fell short and which concepts to revisit |
| Backend or logic code (any assignment) | structure, naming, error handling, data flow, separation of concerns, edge cases |
| A rendered UI (web) | layout, hierarchy, spacing, visual design (from the screenshots) |
| Both | both halves |

## One ordering constraint that drives the design

Screenshots do not exist during the grade loop. `renderPreviews` runs after the
loop and is what populates each row's `pages` and writes the PNG files. So the
notes step cannot live inside the grade loop. It must be a separate pass that
runs after `renderPreviews`, so the rendered page is available to send to the AI.

## Integration points in `tools/grade-sweep.mjs`

Line references are against the current introweb sweep.

1. **Track regraded rows.** The skip and lock branches `continue` before the row
   is built, so anything reaching the row build (around line 441) is genuinely
   (re)graded. Add `const gradedThisRun = new Set()` and record
   `` `${repo}|${a.id}` `` there. This set is the trigger gate.
2. **Capture failing checks.** The runners already parse the full JSON report but
   return only counts (`runVitest` around line 117-124, the Dart runner around
   line 138-155). Extend each to also return
   `failures: [{ title, message }]` for the tests that did not pass, pulled from
   the same parsed JSON (no extra test runs). Carry it on the row as
   `row.failures` in memory only; it does not need to persist to the CSV since
   notes are only generated on rows regraded this run, which always re-derive it.
   `aiNotes` sends the titles (and messages only when the leak knob opts in).
3. **New `aiNotes(row)` generator.** Returns a short markdown string, or an empty
   string. No-ops to empty if no token is available (`GITHUB_TOKEN`), so grading
   never depends on AI being available. Assembles inputs per the tiers above and
   calls the GitHub Models inference endpoint with `model: "gpt-4o-mini"`. The
   provider lives entirely inside this one function, so switching to Claude or a
   BYOK endpoint later is an isolated change. Runs with a small concurrency pool
   (about 4 to 5 at a time), not all students at once, and treats a rate-limit
   (429) the same as any failure: skip this row's notes for the run, never block
   grading.
4. **Notes pass after `renderPreviews`.** Iterate rows whose key is in
   `gradedThisRun`, call `aiNotes`, and store the result on `row.notes`.
5. **Persist notes.** Add a `notes` column to the gradebook CSV header and to the
   read and write paths so notes survive across runs, the same way grades do.

## Output locations

Feedback is generated per activity per student (one set of notes per
`(repo, assignment)`), but only for rows that warrant it (see the tiers table).
The warranted notes are then assembled into a single consolidated file per
student each grading run. This mirrors how `GRADES.md` works: one file per
student, rebuilt every run, with one entry per activity, except that activities
which do not warrant feedback are left out entirely.

- **`row.notes`** holds the per-activity text, persisted in the gradebook CSV per
  `(repo, assignment)` so it survives across runs. Empty for rows that do not
  warrant feedback (a perfectly-scored activity).
- **Student-facing: `FEEDBACK.md` at the student repo root** (sibling of
  `GRADES.md`), written only when the student has at least one warranted entry.
  If a student only submitted activities and passed them all, no `FEEDBACK.md` is
  created. Built fresh in `pushWorkspaceGrades` from that student's warranted
  rows, sorted by assignment, one section per activity:

  ```markdown
  # Your feedback

  _Generated by the course assistant. Not a grade; see GRADES.md for scores._

  ## proj1 (8/10)
  <the AI notes for this activity>
  ```

  A perfectly-scored activity contributes no section. Add a Feedback link to the
  student `GRADES.md` table only on rows that have notes, the same way the
  Preview link is surfaced today.
- **Teacher-facing:** write `gradebook/notes/<assignment>/<repo>.md` only for
  warranted rows, and add a Notes link column to `GRADEBOOK.md` next to the
  existing Preview column, so you can triage by activity. Blank where there is no
  feedback.

## Prompt design

One system prompt sets the persona and the hard guardrails. A small per-row
preamble selects the tier.

**System prompt (constant):**

> You are a teaching assistant for an intro course. Write feedback the student
> can act on. Use plain language at a beginner student's level, with no jargon
> they would not have been taught yet. Comment on code quality across both the
> logic/backend and any frontend: structure, naming, error handling, and
> clarity. Where screenshots are provided, also comment on the visual design.
> Never give corrected code or the exact fix. Name the concept to revisit and,
> where useful, ask a guiding question. Be encouraging.

The failing checks (titles, and messages only when the leak knob is on) are
appended to the preamble as a short list, so the model grounds the "why" in the
real failures rather than inferring them from the source.

**Per-row preamble (varies by tier):**

- Activity, not perfect: "This is a short exercise. The checks that failed are
  listed below. In one short paragraph, explain why those checks did not pass and
  what topics to review. Keep it brief."
- Project, either score: "This is a larger project. Comment on code quality
  across the logic/backend and any frontend, and on the visual design where
  screenshots are provided. Call out what works and offer a couple of concrete
  suggestions. Even if every check passed, still give constructive feedback."
- Activity, perfect: never reaches the model. No notes, no entry, no file.

The guardrail applies to backend just as much as frontend: name the concept or
ask a guiding question, never hand over the corrected code.

## Provider: GitHub Models

GitHub Models is a free, OpenAI-compatible inference API available to any GitHub
account. It is the default for this feature because the sweep runs inside GitHub
Actions, where the runner's `GITHUB_TOKEN` already carries the `models: read`
scope. There is no API key to create, store as a secret, or rotate, and no cost.

- **Endpoint / call:** OpenAI-compatible chat completions against the GitHub
  Models inference endpoint, authenticated with the Actions `GITHUB_TOKEN`. Use
  the OpenAI SDK pointed at that base URL, or a plain `fetch`. `gpt-4o-mini` is
  multimodal, so screenshots are sent as image inputs exactly as planned.
- **Workflow permission:** add `models: read` to the `permissions:` block in the
  class's `.github/workflows/grade.yml` (alongside the existing `contents: write`)
  and pass `GITHUB_TOKEN` to the script as an env var. No new secret.
- **Local runs:** outside Actions there is no automatic token, so a local
  `node tools/grade-sweep.mjs` will simply skip notes (the no-op path) unless a
  `GITHUB_TOKEN` with `models: read` is exported. Grading still works.
- **Dependency:** add the OpenAI SDK (`openai`) to the teacher repo's
  `package.json`, or use `fetch` and add nothing. The workflow already runs
  `npm ci`.

### Limits and the paid scale-up path

The free tier is rate limited per minute, per day, per model, and per request
(for `gpt-4o-mini`, roughly 8k tokens in and 4k out per request). For a
whole-section sweep the daily quota is the thing to watch. Three design choices
keep it manageable:

- Feedback only runs on **warranted rows**, not every passing activity.
- The **per-run skip logic** means a re-run only re-notes changed submissions.
- A 429 is non-fatal: that student's notes are skipped this run and picked up on
  the next sweep.

If the class outgrows the free tier, GitHub Models supports pay-as-you-go and
bring-your-own-key without code changes. Because the provider is isolated inside
`aiNotes(row)`, switching to Claude (`claude-haiku-4-5` via `@anthropic-ai/sdk`
and an `ANTHROPIC_API_KEY` secret) or any other endpoint is a contained edit to
that one function plus the workflow auth.

## Open decisions

1. **Dry-run behavior.** On the free tier the concern is rate-limit quota, not
   dollars. Current intent is "compute but do not push", so a dry run would still
   call the model and let you preview notes in the Actions summary before a real
   push, at the cost of consuming daily quota. Alternative: gate generation
   behind a real run so dry runs never touch the quota.
2. **Where to build first.** Build in the introweb sweep first, since it has the
   screenshot machinery the vision feedback needs, then backport to the template
   sweep so future classes inherit it. The template sweep is currently behind (no
   previews), so without also porting previews it would get a text-only variant.
3. **Language level per class.** Default is "intro student." A class such as the
   ADET section may want the level dialed up. Easiest knob is an optional
   `FEEDBACK_LEVEL` env var per class (for example "absolute beginner" versus
   "intermediate") dropped into the system prompt.
4. **Failure-message leak knob.** Default sends failed-check **titles only**, so
   no expected/actual value reaches the student. An optional per-class flag (for
   example `FEEDBACK_FAIL_DETAIL=messages`) would also send the assertion
   messages, useful for a more advanced section where seeing the diff is fair.
   Recommendation: keep it titles-only by default, given the self-research
   principle, and never send messages for activities even when the flag is on.

## Rough effort

About 120 to 150 lines net in one file (the generator, a post-render pass, and
CSV and markdown column plumbing), plus a one-line `models: read` permission in
the workflow and an optional `package.json` dependency. No new secret. No change
to how grades are computed, matched, or pushed. The feature is purely additive.
