# Core concepts

The platform is small once you hold three ideas: the **four repositories**, the
**ownership boundary** inside a student repo, and the two **separations** that
keep grades safe (grade vs publish, and submission vs grade as sources of truth).
Everything else is machinery around these.

## The four repositories

| Repo | Lives in | Visibility | Role |
| --- | --- | --- | --- |
| **teacher template** (`teacher-subjectcode-classcode-name`) | instructor personal account | private | Reusable control-center skeleton. The placeholder words in the name show the pattern to fill in. |
| **student template** (`student-subjectcode-classcode-name`) | instructor personal account | public | Reusable workspace skeleton. Holds no secrets or PII. |
| **teacher repo** | the course org | private | The live control-center instance for one course: keys, roster, gradebook, and the workflows that run everything. |
| **student repos** | the course org | private | One per student, created from the student template. Where a student reads material, submits, and sees grades. |

**Templates live in the instructor's personal account** because there are
multiple courses: one shared pair of templates seeds instances into every course
org. The **live instances** (teacher repo, student repos) live in the relevant
course org, and every instantiated student repo is private, even though the
student *template* is public.

### Org and section model

- **One org per course** keeps access, Teams, and repo names clean.
- **Within an org, sections are divided by a class code** encoded in the repo
  title (for example `student-6xxx-0000-juandelacruz`) and mirrored as an org
  **Team** per section. Publishing, grading, and export target a section by the
  class-code substring in the title, restricted to the `student-` prefix, with the
  Team as a backstop for malformed titles.

## The ownership boundary

A student repo has two zones, and automation only ever writes to one of them.

```
student-<subject>-<class>-<handle>  (PRIVATE, one per student)
├── content/   ┐ instructor zone - synced in by automation; may be overwritten
├── quizzes/   │   (quiz questions land here at release; keys never do)
├── grades/    ┘   display-only receipts pushed back after grading
├── notes/     ┐
├── journal/   ├ student zone - automation NEVER writes here
├── project/   ┘
└── student.json   identity: class code, name, number, emails, github handle
```

**Automation only writes to the instructor zone** (`content/`, `quizzes/`,
`grades/`). The **student zone** (`notes/`, `journal/`, `project/`) is never
touched, so re-publishing course material can never clobber a student's own work.
This is what lets one repo be both a managed course and a personal learning space
at once.

## Separation 1: grade vs publish

Grading and publishing are separate on purpose. This split is load-bearing.

| Step | What it does | Touches student repos? |
| --- | --- | --- |
| **Grade sweep** | Clones each submission at its snapshot commit, runs the canonical tests in `grader/`, writes the gradebook (`grades.csv`, `GRADEBOOK.md`) and AI feedback notes. | **Never.** Teacher-side only. |
| **Publish grades** | The *only* step that writes to student repos. Delivers `GRADES.md`, receipts, and `FEEDBACK.md`, and only for activities explicitly flagged for release. | Yes. Dry-run by default; acts only on an explicit `publish=true`. |
| **Publish material** | Copies a unit of course `content/` into every workspace in a section. | Instructor zone only. |

Because grading writes nothing to students, you can run it as often as you like.
The grade sweep is **incremental and idempotent**, keyed on each submission's
commit SHA: it re-grades only what changed and safely resumes if interrupted. A
`force` input re-grades everyone after a test or key changes. Delivery is a
separate, deliberate switch. See [Grading and feedback](grading-and-feedback.md).

## Separation 2: submission vs grade as source of truth

- The **student repo is the source of truth for submissions** (their answers,
  code, notes). Theirs to own and edit.
- The **teacher repo is the source of truth for grades** (the evaluation, the
  gradebook, the export). Nothing official is ever read back from a student repo.

Grades are computed **off-repo**: the teacher repo checks out the student's
submission at the snapshot commit and runs the canonical tests on its own side.
Editing the tests or workflows inside a student repo changes nothing. The receipts
pushed back to a student (`GRADES.md`, `grades/*.json`) are a display copy, not the
authority, so a student editing their own receipt changes nothing official.

## Integrity, honestly

Client-side lockdown on a student's own machine is a nudge, not a lock. Integrity
comes instead from mechanisms students cannot control:

- **Per-student quiz variants** so copied answers are worthless.
- **Deadline snapshots** via commit timestamps, an un-fakeable submission window
  with no real-time proctoring.
- **Commit-history signals**, since organic work reads differently from a single
  paste.
- **Viva spot-checks** on a random sample, which deter hired-gun cheating across a
  cohort.
- **Private repos** so students cannot browse each other's work.

Anything high-stakes runs in person, not on the pure-GitHub path. This is stated
as a limitation, not hidden. More detail lives in the
[Architecture](architecture.md) anti-cheat section.

## The core invariant

**The engine is identical across all teacher repos; only the `grader/` tests and
each repo's `course.config.json` differ.** Nothing class-specific is hardcoded in
the tooling: orgs, section, workspace prefix, template owner, and LMS settings all
come from config or workflow env. This is what lets one set of shared tools run
every course. If you change the engine, you change it once and copy it to every
teacher repo. See [Reference](reference.md) for the config surface.
