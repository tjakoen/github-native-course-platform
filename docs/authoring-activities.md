# Authoring activities

How to add a new graded activity to a course. This is the canonical reference for
every stack (JS/Vitest, Dart, HTML/CSS/JS, quizzes). The **m1a1 ("hello world")
activity is the standard template** every class copies from: it is the smallest
complete activity, and it exists live and public in three example orgs so you can
see one end to end and watch its autograder run. See [Live
examples](examples.md).

## The mental model

An activity is four things, only the first two of which are required:

1. **A registry entry** in `grader/assignments.json` - declares the activity
   exists, its type, and its flags.
2. **Canonical tests** under `grader/<id>/` - the source of truth for the score.
   The sweep overlays these onto each student clone before running, so a student
   editing their own copy of the tests changes nothing.
3. **A student scaffold** (the activity template repo) - the starter files a
   student works in: a stub to fill in, `student.json`, `README.md`, the dev
   container, and a student-facing copy of the tests.
4. **A rubric** at `grader/<id>/RUBRIC.md` - **only for activities that cannot be
   judged by tests alone** (design, front-end craft, code quality). This is what
   turns an activity into an AI-enhanced one. Plain test-only activities do not get
   a rubric.

Remember the platform's hard split: **grading never touches student repos.** The
grade sweep scores into the gradebook; publishing is the only thing that delivers
to students, and only when an activity is flagged `"publish": true`. Authoring an
activity is steps 1 to 4; delivery is a separate switch you flip later. See
[Grading and feedback](grading-and-feedback.md).

## The spine: from simplest to richest

Every activity sits somewhere on this line. Build up only as far as you need.

```
test-only  ->  + Canvas points  ->  + AI feedback (RUBRIC)  ->  publish
  m1a1            totalPoints         ai-grading + feedback     publish:true
(hello world)                         + grader/<id>/RUBRIC.md
```

- **Test-only** (m1a1 and most m1/m2 activities): objective, pass/fail against
  canonical tests. No rubric, no AI. This is the default, and most activities never
  leave here.
- **Plus Canvas points:** add `"totalPoints"` so the score reconciles against
  Canvas (mismatches land in `gradebook/points-mismatch.md`).
- **Plus AI feedback:** add `"ai-grading": true`, `"feedback"`, and a
  `grader/<id>/RUBRIC.md`. Use this when the interesting part of the work is not
  test-checkable (visual design, responsiveness, code craft).
- **Plus publish:** set `"publish": true` and run the publish workflow to deliver.

## Anatomy of an activity (files)

```
teacher repo/
  grader/
    assignments.json          <- add your entry here
    class-prompt.md           <- class context for AI feedback (edit once per class)
    RUBRIC-TEMPLATE.md        <- copy this to make a RUBRIC.md
    <id>/                     <- canonical tests (overlaid onto each clone)
      ...test files...
      RUBRIC.md               <- ONLY if AI-graded
  content/
    <module>/
      <id>-<short-name>.md    <- the human-readable brief (optional but recommended)

activity template repo (what students copy):
  <stub the student edits>
  <student-facing copy of the tests>
  student.json                <- the identity fields, blank
  README.md                   <- the brief + how to submit
  .devcontainer/              <- Codespaces config
```

## `assignments.json` field reference

Each entry is one object in the array. Only `id`, `type`, and `namePrefix` are
required.

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique activity id; also the receipt filename (for example `m1a1`). |
| `type` | yes | `vitest` (Node tests), `dart` (`dart test`), `flutter` (`flutter test`, front-end with screenshots), or `quiz` (match answers to a key). |
| `namePrefix` | yes | Student repos for this activity start with this (`m1a1-` matches `m1a1-<classcode>-<handle>`). |
| `key` | quiz only | Path to the answer key, for example `grader/q1/key.json`. |
| `totalPoints` | no | Canvas point value; reconciled vs Canvas into `gradebook/points-mismatch.md`. |
| `ai-grading` | no | `true` turns on AI feedback for this activity (requires a `RUBRIC.md`). |
| `feedback` | no | `"project"` (design/front-end, uses screenshots) or `"code"` (code quality, no screenshots). |
| `previews` | no | `"branch"` reuses the project CI's published screenshots instead of rendering fresh. |
| `publish` | no | `true` delivers `GRADES.md` / `FEEDBACK.md` to students (default false). |
| `locked` | no | Prevents overwriting an already-synced Canvas grade. |
| `autoPoints` / `manual` | no | Legacy grade-split flags; avoid in new activities. |

See [Reference](reference.md) for the full flag list in one place.

## Step 1 - author a test-only activity

Use a live m1a1 repo (see [Live examples](examples.md)) as the model and copy the
one for your stack. The example below adds a hypothetical new activity `m2a4`.

1. **Add the registry entry** to `grader/assignments.json`:
   ```jsonc
   { "id": "m2a4", "type": "vitest", "namePrefix": "m2a4-" }
   ```
2. **Write the canonical tests** under `grader/m2a4/`, mirroring the student repo
   layout so the overlay lands correctly. Every activity's tests should include the
   standard **`student.json` check** (the identity fields), which is worth 1 point
   and appears in every activity across all classes.
3. **Build the student scaffold** in the activity template repo: a stub for the
   student to complete, a student-facing copy of the tests, a blank `student.json`,
   a `README.md` (the brief, how to submit, a Codespaces note), and the
   `.devcontainer/`.
4. **Write the brief** (recommended) in `content/<module>/<id>-<short-name>.md`:
   the goal, what to build, the required contract (the exact markers or structure
   the tests look for), and a minimal shape example. Never the solution. Activity
   stubs name the concept to research; they never hand over the answer.
5. **Grade it locally** to confirm:
   ```bash
   node tools/grade-sweep.mjs <classcode> --only=m2a4
   ```

That is a complete activity. Stop here unless it needs points, AI feedback, or
delivery.

## Step 2 - add Canvas points

Add `"totalPoints": <n>` to the entry. The sweep reconciles this against Canvas
and reports any mismatch in `gradebook/points-mismatch.md`.

## Step 3 - make it AI-enhanced (add a RUBRIC)

Do this **only when the work cannot be fully judged by tests**: visual design,
responsive or layout craft, accessibility, or code quality. The tests still score
the objective half; the AI scores the subjective half and drafts feedback,
grounded in the rubric and `grader/class-prompt.md`.

1. Flag the entry:
   ```jsonc
   { "id": "m3a1", "type": "vitest", "namePrefix": "m3a1-",
     "totalPoints": 100, "ai-grading": true, "feedback": "project",
     "previews": "branch" }
   ```
   - `feedback: "project"` - design/front-end; uses screenshots.
   - `feedback: "code"` - code quality; no screenshots.
2. **Create `grader/<id>/RUBRIC.md`** from `grader/RUBRIC-TEMPLATE.md`. The rubric
   has two halves, an automated half (scored by the tests) and a subjective half
   (scored by the AI), and the total **must** equal `totalPoints` and Canvas.
3. **Distribute the rubric to all three places** (this is the rule that keeps AI
   grading grounded everywhere):
   - the teacher-canonical `grader/<id>/RUBRIC.md`,
   - the activity template repo,
   - every existing student submission repo (via `gh api` contents, committed as
     the course bot).

The student-facing feedback is prose only: no scores, no mention of AI. The
proposed grade and the AI-authored likelihood flag stay instructor-only in
`gradebook/notes/`. Feedback is held for review until you publish.

## Step 4 - deliver

Set `"publish": true` and run the publish workflow (dry-run by default;
`publish=true` to actually push). Nothing reaches students until you do this.

## Stack specifics

The engine is identical; only the test layout and runner differ.

| Stack | `type` | Tests live at | Runner | Notes |
| --- | --- | --- | --- | --- |
| JS / React | `vitest` | `grader/<id>/hello.test.js` or `grader/<id>/test/*.test.jsx` | Vitest + `@testing-library/react` | Design activities use `previews: "branch"`. |
| HTML/CSS/JS | `vitest` | `grader/<id>/test/*.test.js` | Vitest + `jsdom` (parses `src/index.html`) | Grades DOM structure. Previews rendered locally by its grade sweep, not from a branch. |
| Dart (logic) | `dart` | `grader/<id>/test/<name>_test.dart` | `dart pub get` + `dart test --reporter json` | Pure-Dart logic; student code in `bin/`/`lib/`; needs the Dart SDK (CI uses `setup-dart`). |
| Flutter (front-end) | `flutter` | `grader/<id>/test/<name>_test.dart` (+ a `capture:` golden test) | `flutter pub get` + `flutter test --update-goldens --reporter json` | Widget tests score behaviour; a `capture:`-named golden test renders the screen in a `device_frame` phone at a mobile size and writes a PNG (the sweep excludes `capture:` tests from the score, copies the PNG into `previewDir`, and hands it to AI feedback exactly like the web local-render path). Needs Flutter (CI uses `subosito/flutter-action`). No `previews: "branch"` - the screenshot is produced in the test. |
| Quiz (any) | `quiz` | `grader/<id>/key.json` | Answer match (case-insensitive, trimmed) | Student answers in `quizzes/<id>/answers.json`. |

Two grading paths, one shape: JS and HTML both run under Vitest (HTML via jsdom
against `src/index.html`); Dart runs under `dart test`. In all three, the
canonical test is overlaid onto the clone so students cannot tamper with it, and
every activity carries the standard `student.json` check.

## The one-shot way (ask the assistant)

You do not have to do this by hand. Ask an AI assistant, for example:

> "Add a new test-only activity `m2a4` to the intro-web course: a page that
> includes a nav and a footer. Follow the existing m2 activities."

It will read the neighboring activities, follow the conventions above, and produce
the registry entry, canonical tests, scaffold, and brief. This guide is what keeps
that output consistent and what to check its work against. See [Operating with an
AI assistant](operating-with-ai.md).

## Checklist

- [ ] Entry added to `grader/assignments.json` (`id`, `type`, `namePrefix`).
- [ ] Canonical tests under `grader/<id>/`, including the `student.json` check.
- [ ] Student scaffold: stub, student-facing tests, blank `student.json`,
      `README.md`, `.devcontainer/`.
- [ ] Brief in `content/<module>/` naming the concept, not the answer.
- [ ] If AI-enhanced: `totalPoints`, `ai-grading`, and `feedback` set, and a
      `RUBRIC.md` whose total matches `totalPoints`, distributed to
      teacher-canonical, template, and student repos.
- [ ] `node --check` any changed `.mjs`; `grade-sweep --only=<id>` runs clean.
- [ ] To deliver: `publish: true`, then run the publish workflow.
