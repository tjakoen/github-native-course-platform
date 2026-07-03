# GitHub-Native Course Platform — project guide

What this project is, how it is organized, and the rules for changing it without
breaking the design. This is the guidance an AI assistant (or a new contributor)
should read first. Deeper design lives in [ARCHITECTURE.md](ARCHITECTURE.md),
[AI-GRADING-FEEDBACK-PLAN.md](AI-GRADING-FEEDBACK-PLAN.md), and
[UI-PLAN.md](UI-PLAN.md).

## What it is

A university coursework, quiz, and grading platform that runs entirely on GitHub
Actions. The instructor drives everything from an Actions tab; students live in
their own repo; grades sync out to an LMS (Canvas is the reference integration)
as a single CSV at the end. Nothing is hosted.

## Repository layout

This is the umbrella / overview repo. The working code lives in two template
repos, included here as **submodules**:

| Path | Repo | What it is |
| --- | --- | --- |
| `teacher-template/` | teacher control center | The engine: `tools/` (Node), `.github/workflows/`, `grader/`, and `course.config.json`. |
| `student-template/` | student workspace | The per-student skeleton: content/quizzes/grades zones plus the student's own notes/journal/project. |

To update a submodule: edit inside its folder, commit + push there, then from the
umbrella root `git add <folder>` and commit to move the pin.

## How grading works

Grading and publishing are **separate on purpose**:

- **Grade sweep** clones each submission at its snapshot commit, grades against
  the canonical tests in `grader/`, and writes the gradebook (`grades.csv`,
  `GRADEBOOK.md`) plus AI feedback notes. **Teacher-side only — never writes to
  student repos.**
- **Publish** is the only step that writes to student repos, and only for
  activities explicitly flagged for release. Dry-run by default.

The sweep is incremental and idempotent (keyed on the submission commit SHA), so
it can run as often as wanted and only does new work.

## Core invariant (do not break this)

**The engine is identical across all teacher repos; only the `grader/` tests and
each repo's `course.config.json` differ.** So:

- Shared tools (`tools/*.mjs`) stay **byte-identical** across teacher repos —
  edit once, copy to all.
- Nothing class-specific is hardcoded: orgs, section, workspace prefix, template
  owner, and Canvas settings come from `course.config.json` or workflow env.
- Everything that mutates repos defaults to a **dry run** and acts only on an
  explicit `execute` / `publish=true`.

## Access model

The **org owns every repo** so the engine can grade it and deliver results;
within that, **each student is the admin of their own repos** and no one else's.
Only teachers are org owners or hold admin on the infrastructure repos (teacher
control center, `*-solution`, templates, demos). `tools/org-audit.mjs` audits
this (rogue org owners, non-teacher access on infra repos, a student repo shared
with a second account, a workspace no student can see, and a permissive org base
permission). Its signals are collaborator-based, not name-based, because repo
name handles and `student.json` rarely equal the real GitHub login. Fixes stay
manual (demoting an org owner needs the `admin:org` scope).

## Conventions (hard rules)

- **Gitmoji** commit subject prefixes.
- **No em dashes** in prose or generated content.
- **No AI co-author trailers in commits.** AI involvement is disclosed openly in
  the README badge + footer instead, not in git trailers.
- **No student PII** (names, numbers, emails) anywhere public. This is a public,
  sanitized project; live instances with real data stay private.
- Always `node --check` a changed `.mjs`; prefer a dry run before any write to a
  live gradebook or student repo.
