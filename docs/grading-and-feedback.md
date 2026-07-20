# Grading and feedback

How scores are produced, how they reach students, and how the optional AI feedback
works. The one rule that governs all of it: **grading and publishing are
separate**, and grading never writes to a student repo. See
[Core concepts](concepts.md) for why.

## The grading model

- **Off-repo canonical grading.** The teacher repo checks out each student's
  submission at its snapshot commit and runs the canonical tests from `grader/` on
  its own side. The tests are overlaid onto the clone, so editing the tests or
  workflows inside a student repo changes nothing.
- **Incremental and idempotent, keyed on the submission commit SHA.** Each run
  skips repos whose latest graded commit is unchanged and grades only new or
  changed submissions, so the sweep can run anytime, as often as you like. It only
  does new work, and an interrupted run resumes on the next run. A `force` input
  re-grades everyone (use after changing a key or test).
- **Per-assignment policy.** Activities re-grade on a new push; quizzes lock after
  the first graded submission (see [Architecture](architecture.md) for the quiz
  flow).

The gradebook it writes is the source of truth:

- `gradebook/grades.csv` - the machine-readable gradebook.
- `GRADEBOOK.md` - a human-readable table, with each commit linked to its GitHub
  commit page.
- `gradebook/notes/` - instructor-only AI feedback notes (see below).

## Receipts (what students get)

Receipts are a student-facing record, not the authority. On **publish** (never on
grade), the platform writes into each student repo:

- `grades/<assignment>.json` - `{ assignment, gradedCommit, submittedAt, gradedAt,
  score }`.
- `GRADES.md` - a human-readable table with the commit linked to its GitHub commit
  page.

Receipts are a plain display copy. They are not signed and not read back: the
gradebook in the teacher repo is the source of truth, so a student editing their
own receipt changes nothing official.

## Delivery: the publish step

Nothing reaches a student until you publish, and only for activities flagged
`"publish": true`. The publish workflow is **dry-run by default**; it acts only on
an explicit `publish=true`. The flow is:

1. Grade freely (teacher-side, no student impact).
2. Read the results in `GRADEBOOK.md` and the AI drafts in `gradebook/notes/`.
3. Flip `"publish": true` on the activities that are ready.
4. Run the publish workflow: dry run first, read the plan, then `publish=true`.

For a plain activity the proposed grade reaches Canvas only when you enter or push
it yourself. For an **AI-graded** activity, flipping `"publish": true` also
unblocks the Canvas push: its reviewed final score is sent with a rubric-breakdown
comment (no scores-or-AI leak). See [LMS and Canvas](lms-canvas.md).

## AI-assisted feedback

Feedback is generated during the grade sweep using an LLM, grounded in each
activity's `RUBRIC.md` and the class's `grader/class-prompt.md`. It is **opt-in
per activity** (`"ai-grading": true`) and comes in two halves.

- **Student-facing:** prose only - encouraging, specific, actionable. No scores,
  no mention of AI. It reads as the instructor's own notes and is only delivered on
  explicit publish, as `FEEDBACK.md` at the student repo root, linked from their
  `GRADES.md`.
- **Instructor-only:** a proposed grade plus an authenticity signal (an AI-authored
  likelihood flag for suspected "vibe-coded" submissions). This lives only in
  `gradebook/notes/<activity>/<repo>.md` and a Feedback column in `GRADEBOOK.md`,
  and never leaves the teacher repo.

**Nothing AI-generated reaches a student automatically.** It is always staged for
you to review, edit, and approve first.

### What the AI reads

The student's source, the failing automated checks, the activity's `RUBRIC.md`,
the class's `grader/class-prompt.md`, and, for web projects, the rendered
screenshots. It never receives `student.json` (no PII leaves the repo) and is told
never to hand over the fix, only to name the concept or ask a guiding question, in
line with the course's self-research principle.

### The two flavors

Selected by the `feedback` flag:

- `"feedback": "project"` - a design project. The subjective half is visual design,
  judged from screenshots. Use for front-end and UI work.
- `"feedback": "code"` - a code-quality project. The subjective half is code craft
  (structure, naming, error handling, abstractions, edge cases), judged from the
  code, no screenshots. Use for back-end or non-front-end work.
- Omit `feedback` for a plain activity: feedback is generated only when it did not
  score perfectly.

### Cost and safety properties

- **Bounded and idempotent.** Feedback is generated only for submissions actually
  (re)graded that run; the same commit hash is never sent twice, so re-running the
  sweep re-bills nothing for unchanged work. It is skipped for locked activities,
  perfectly scored plain activities, and unbuildable submissions.
- **Held for review.** Instructor-only scores and likelihood flags never reach
  students; the student `FEEDBACK.md` reads as the instructor's own notes.
- **Styling guard.** If a web preview rendered as unstyled default HTML (usually a
  student's CSS not wired up), the AI gives code-only feedback and the teacher note
  carries a flag; it never invents design praise from a blank page.
- **Provider.** The reference setup uses GitHub Models (`gpt-4o-mini`), which is
  free inside GitHub Actions via the runner's built-in token. The provider is
  isolated in one function, so switching to another model is a contained change.
  For the full design, see [Design notes: AI feedback
  plan](design/ai-grading-feedback-plan.md).

## Related

- [Authoring activities](authoring-activities.md) - how to set the flags and write
  a `RUBRIC.md`.
- [Operating with an AI assistant](operating-with-ai.md) - running grade and
  publish day to day, with guardrails.
- [Reference](reference.md) - every flag in one table.
