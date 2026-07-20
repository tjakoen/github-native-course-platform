# LMS and Canvas

Canvas is the **reference LMS integration and the single external coupling** in
the whole system. Because grades live in GitHub as the source of truth, the LMS is
only ever a final export target, touched at one isolated seam.

## The model

At the end of a unit, the gradebook is pushed to the LMS (honoring per-activity
lock flags and reconciling point totals) or exported as an offline CSV.
`student.json` is the bridge: it joins each GitHub repo to the LMS-exported roster
on student number, resolving the GitHub account to the LMS ID without storing that
mapping by hand.

- `roster/<classCode>.csv` is the **Canvas-exported CSV** (Student, ID, SIS User
  ID, SIS Login ID, Section).
- `githubAccount` is resolved by joining `student.json` to that CSV, on student
  number and then email, not stored as a column.
- Matching order is **student number, then email, then GitHub handle**. Anyone
  unmatched is reported; the fix is almost always their `student.json`.

## The workflows

| Workflow / tool | What it does |
| --- | --- |
| `canvas-push.yml` | Pushes gradebook scores to Canvas via the API. Honors `locked`, reconciles points. Modes: `check` (read-only roster reconcile), `dry-run` (shows the plan, writes nothing), `execute` (idempotent, overwrites unlocked grades). |
| `canvas-export.yml` | Emits an offline Canvas-format gradebook CSV as an artifact plus a step summary. |
| `tools/canvas-pull-points.mjs` | Reads each activity's Canvas Points Possible; writes `totalPoints` back only with `--execute`. |

The `check` and `dry-run` modes already include the roster reconciliation, so a
single `dry-run` is usually all you need before an `execute`.

## Point reconciliation

Each activity can declare `"totalPoints"` in `assignments.json`. This is stored to
be **reconciled** against Canvas's live Points Possible. On a mismatch, the push
writes `gradebook/points-mismatch.md` for you to fix, rather than silently pushing
a wrong denominator. How those points split (objective vs design) lives in the
activity's `RUBRIC.md`, not in `assignments.json`.

## Lock behavior

`"locked": true` on an activity means a grade Canvas already has is never
overwritten. Use it once a grade is final so a later re-push cannot disturb it.

## AI-graded activities

An AI-graded activity is **held out of the push until you review it** and set
`"publish": true`. Until then the push reports it as held and writes nothing for
it. Once published, its reviewed final score (the `aiScore` column in
`grades.csv`, filled when you approve the grade) is the grade that is sent -
always with a submission comment carrying the rubric breakdown plus the
student-facing feedback prose. That comment deliberately excludes the
instructor-only header, the proposed-total restatement, and the AI-authored
likelihood line, and never mentions AI, the same wall the published `FEEDBACK.md`
keeps. A published AI activity whose `aiScore` is still blank (unreviewed or
flagged) is skipped, so nothing ungraded leaks out. Setting `"publish": true`
therefore delivers an AI-graded activity to **both** the student repo (via the
publish workflow) and Canvas (grade + breakdown comment), so flip it only once the
activity is fully reviewed.

## Swapping in another LMS

Because grades live in GitHub and the LMS is only a final export target, supporting
another LMS (Moodle, Blackboard, Google Classroom, Brightspace) is an **adapter
swap, not a rewrite**: implement the same push, export, and reconcile calls against
that LMS's API at the one isolated seam. The CSV export path is already
LMS-neutral, since most systems accept a gradebook CSV import.

## Related

- [Grading and feedback](grading-and-feedback.md) - where the grades come from.
- [Operating with an AI assistant](operating-with-ai.md) - running the Canvas jobs.
- [Reference](reference.md) - the `locked` and `totalPoints` flags in context.
