# Operating with an AI assistant

The teacher control center is built to be driven by an AI coding assistant (for
example Claude Code in your terminal or IDE). You describe what you want in plain
language; the assistant runs the repo's tools and GitHub Actions for you. This
page shows the common jobs and, just as important, the guardrails that keep grades
safe.

You can also run every workflow by hand from the Actions tab. The assistant is a
convenience layer over the same tools, not a separate system.

## One-time setup

1. Install an AI coding assistant that can run shell commands and `gh`.
2. `gh auth login` as an account with access to the course org.
3. Set the secrets on the teacher repo as you need them: `ORG_PAT` (cross-repo
   git), `CANVAS_TOKEN` and `CANVAS_BASE_URL` (grade sync), `MODELS_PAT` (AI
   feedback). See [Getting started](getting-started.md).

## The mental model

- **`grades.csv` is the source of truth.** The grade sweep computes it; everything
  else (Canvas, receipts) is downstream.
- **The assistant proposes, then acts.** Ask for a dry run first, read it, then
  approve the real run. Every grade-affecting tool defaults to safe.
- **Nothing is deleted for you.** The assistant can rename and edit, but deleting
  student repos is left to you; it is irreversible.
- **The org owns every repo; the student is admin of their own.** The org must own
  each repo so the engine can grade it and deliver results; within that, each
  student is the legitimate admin of their repos. Only teachers should be org
  owners or hold admin on the infrastructure repos (control center, solutions,
  templates), and no student should reach another student's repo.

## Common jobs

Ask for these in your own words; the assistant runs the workflow or tool.

| You want to... | What it runs | Notes |
| --- | --- | --- |
| Grade the latest submissions | `grade.yml` (dry run, then real) | Teacher-side only; writes the gradebook and AI notes. Never touches student repos. |
| Deliver grades/feedback to students | `publish.yml` (dry run, then publish) | Pushes `GRADES.md` and `FEEDBACK.md`, only for activities with `"publish": true`. |
| Preview Canvas grades | `canvas-push.yml` mode `dry-run` | Writes nothing; shows the plan. |
| Reconcile roster vs `student.json` | `canvas-push.yml` mode `check` | Read-only; lists who will not match. |
| Push grades to Canvas | `canvas-push.yml` mode `execute` | Idempotent; overwrites unlocked grades. |
| Audit repo hygiene and access | `tools/org-audit.mjs` | Read-only; junk/dup/misnamed repos plus an access pass. |
| Sync activity points from Canvas | `tools/canvas-pull-points.mjs` | Read-only; writes `totalPoints` only with `--execute`. |
| Make grades back into a CSV | `tools/canvas-export.mjs` | Offline alternative to the API push. |
| Publish course material to students | `publish-material.yml` | Copies a unit's `content/` into every workspace; instructor zone only. |
| Check repo names for typos / wrong section | `audit-names.yml` | Read-only; flags misnamed repos and blank `student.json`. |
| Provision missing workspaces / backfill `student.json` | `provision-workspaces.yml` (dry run, then `execute`) | Creates a workspace for a student who has activities but none; fills a blank `student.json` from their own submissions; never deletes or renames. |
| Clean stale gradebook rows | `prune-gradebook.yml` (dry run, then `execute`) | Drops rows whose submission repo was deleted or renamed (404). |

See [Reference](reference.md) for the full workflow list.

## Housekeeping jobs

Not everything is a single workflow. These are the "help me keep this tidy and
correct" jobs. Ask for a read-only check first, then approve any changes:

- **"Audit my whole org for hygiene"** - malformed names, duplicate submissions,
  studentNumber collisions, junk or sample repos, blank `student.json`. Start with
  `tools/org-audit.mjs` (read-only) before fixing anything.
- **"Audit who can access what"** - the same tool ends with an access pass: rogue
  org owners (anyone but a teacher), non-teacher access on infrastructure repos, a
  student repo shared with a second non-teacher account, a workspace with no
  student collaborator (delivered grades would be invisible), and a permissive org
  base permission. Set `teachers` in `course.config.json` so your own accounts are
  recognized. Fixes stay manual: demoting an org owner needs the `admin:org` scope
  and a human.
- **"Reorganize / rename these repos"** - the assistant proposes the renames; you
  approve. Renames are fine; deletes stay manual.
- **"Check my content for a unit"** - read `content/<unit>/` for gaps, broken
  links, inconsistent naming, or a stub that accidentally gives away the answer.
- **"Review this `RUBRIC.md` / `class-prompt.md`"** - sanity-check weights,
  clarity, and that the prompt matches the class level before a grade run uses it.
- **"Add a new activity"** - see [Authoring activities](authoring-activities.md).
- **"Confirm my engine is consistent"** - verify the shared `tools/*.mjs` are
  byte-identical across your teacher repos (nothing class-specific hardcoded;
  config lives in `course.config.json`).

## Guardrails worth knowing

- **`grades.csv` is the source of truth.** Never hand-edit a grade to fix
  something the sweep should produce.
- **Grading never touches student repos.** `grade.yml` is teacher-side only; the
  only thing that writes to student repos is `publish.yml`, and only for activities
  flagged `"publish": true`.
- **Dry run first, always.** Every repo-mutating tool defaults to safe. Show the
  dry-run plan, read it, then run for real on approval.
- **Never delete or rename student repos automatically.** Flag them; deletion is
  irreversible and needs a human plus the `delete_repo` scope.
- **No student PII in chat responses.** Names, numbers, and emails stay in the
  repo, not in conversation.
- **When data is ambiguous** (for example two repos with the same student number),
  record it in `gradebook/FLAGS.md` for the instructor to resolve. Do not guess; a
  wrong guess misattributes a grade.
- **Idempotency.** Re-pushing writes the same grade for an unchanged gradebook, and
  comments are de-duplicated, so a repeated push is safe.

## Matching students

Students are joined to the roster by student number, then email, then their repo's
GitHub handle. The pushes and audits report anyone unmatched; the fix is almost
always their `student.json`.

## Tips for asking

- Be specific about scope ("section 0000", "only m2a1") and safety ("dry run
  first", "don't push yet").
- Ask the assistant to explain the plan before a write to a live gradebook.
- It costs Actions minutes: prefer one `dry-run` (which already includes the roster
  check) over running `check` and `dry-run` separately, and reserve `execute` for
  grading milestones.
- If something looks off, ask for the run's report artifact; every push and sweep
  writes a human-readable report.
