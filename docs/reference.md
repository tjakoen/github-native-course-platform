# Reference

A one-page lookup for naming, configuration, activity flags, workflows, tools, and
conventions. For the narrative behind any of it, follow the links.

## Naming

Literal lowercase values, no angle brackets. `6xxx` is a subject code, `0000` a
class/section code, and the last segment a GitHub handle.

| Repo | Pattern | Example |
| --- | --- | --- |
| Teacher control center | `teacher-<subjectcode>-<classcode>-<name>` | `teacher-6xxx-0000-instructor` |
| Student workspace | `student-<subjectcode>-<classcode>-<handle>` | `student-6xxx-0000-juandelacruz` |
| Activity submission | `<id>-<classcode>-<handle>` | `m1a1-0000-juandelacruz` |

Publishing and grading target the `student-` prefix (and activity prefixes) filtered
by the class-code substring, so the teacher repo is never a target. The per-section
org Team is the backstop for malformed titles.

## `course.config.json`

Per-deployment config in the teacher repo. Nothing class-specific is hardcoded in
the tools; they read from here, and workflow env overrides it.

```jsonc
{
  "orgs": ["COURSE-ORG-A", "COURSE-ORG-B"],
  "teachers": ["your-github-login"],
  "workspaceTemplate": "your-account/student-subjectcode-classcode-name"
}
```

| Field | Meaning |
| --- | --- |
| `orgs` | The course org(s) the tools operate on. |
| `teachers` | Teacher accounts, used by the access audit to recognize legitimate owners/admins. |
| `workspaceTemplate` | The student template repo new workspaces are provisioned from. |

Per-workflow env pins each teacher repo to one section via `SECTION` and
`WORKSPACE_PREFIX`.

## Secrets

| Secret | Used for |
| --- | --- |
| `ORG_PAT` | Cross-repo git (fine-grained PAT, org-scoped, Contents + Pull requests + Issues write). Required. |
| `CANVAS_TOKEN`, `CANVAS_BASE_URL` | Canvas grade sync. |
| `ATTENDANCE_HMAC_SECRET` | Signs and verifies attendance QRs (any random string, per teacher repo). See [Attendance](attendance.md). |

_(AI feedback needs no secret: notes are drafted in a Claude Code session via the grader-ui prompt, not a hosted model.)_

## `assignments.json` flags

Each activity is one object in `grader/assignments.json`. Only `id`, `type`, and
`namePrefix` are required.

| Field | Meaning |
| --- | --- |
| `id` | Unique activity id; also the receipt filename. |
| `type` | `vitest`, `dart`, `flutter`, or `quiz`. (`flutter` grades widget tests and captures a mobile screenshot in the test.) |
| `namePrefix` | Submission-repo prefix (`m1a1-`). |
| `key` | Quiz only: path to the answer key. |
| `totalPoints` | Canvas point value; reconciled vs Canvas into `gradebook/points-mismatch.md`. |
| `ai-grading` | `true` turns on AI feedback (requires a `RUBRIC.md`). |
| `feedback` | `"project"` (design, screenshots) or `"code"` (code quality, no screenshots). |
| `previews` | `"branch"` reuses the project CI's published screenshots. |
| `publish` | `true` delivers grades/feedback to students (default false). |
| `locked` | Prevents overwriting an already-synced Canvas grade. |
| `manual` | Never auto-pushed/exported; you enter it by hand (AI rubric projects use this). |
| `autoPoints` | Legacy split (push only the objective part); superseded by `totalPoints` + `manual`. |

See [Authoring activities](authoring-activities.md) and [Grading and
feedback](grading-and-feedback.md).

## Workflows (the Actions tab)

Every repo-mutating workflow is section-locked and **defaults to a dry run**,
acting only on an explicit `execute` / `publish=true`.

| Workflow | Purpose |
| --- | --- |
| `grade.yml` | Grade sweep. Clones submissions, runs canonical tests, writes the gradebook and AI notes. Teacher-side only. |
| `publish.yml` | The only workflow that writes to student repos. Delivers `GRADES.md`, receipts, `FEEDBACK.md` for `publish:true` activities. |
| `publish-material.yml` | Copies a unit's `content/` into every workspace in the section. |
| `canvas-push.yml` | Pushes gradebook scores to Canvas (modes: `check`, `dry-run`, `execute`, `comment`). |
| `canvas-export.yml` | Emits an offline Canvas-import CSV. |
| `canvas-quiz-import.yml` | Builds a quiz's QTI package from `quiz.json` and imports it into Canvas via Content Migrations. Dry-run by default; imports unpublished. See [LMS and Canvas](lms-canvas.md). |
| `provision-workspaces.yml` | Creates a workspace for a student who has activities but none, adding the student as an admin collaborator on it; backfills a blank `student.json`. Never deletes or renames. |
| `prune-gradebook.yml` | Drops gradebook rows whose submission repo 404s (deleted/renamed). |
| `audit-names.yml` | Flags misnamed repos and blank `student.json`. Weekly plus manual. |
| `generate-attendance-qrs.yml` | Signs and commits a per-student attendance QR into any workspace missing one; refreshes the teacher-side roster. Dry-run by default. See [Attendance](attendance.md). |
| `verify-attendance.yml` | On each scanned batch CSV, verifies signatures, flags forgeries, and rebuilds the attendance summaries (including `summary.json`). |
| `publish-attendance.yml` | Delivers each student their own `attendance/MY-ATTENDANCE.md` receipt; runs automatically after `verify-attendance`, or manually with a dry-run. The only step that writes attendance to student repos. See [Attendance](attendance.md). |
| `deploy-scanner.yml` | Publishes only `attendance/scanner.html` to GitHub Pages (nothing else is served). |

Repo **deletes and renames stay manual**: the tools flag them, a human performs
them (they need the `delete_repo` scope).

## Tools (Node, under `tools/`)

The shared tools are **byte-identical across all teacher repos**; only
`grader/` and config differ.

| Tool | What it does |
| --- | --- |
| `grade-sweep.mjs` | The grader (per-repo; renders previews where a class needs them). |
| `publish-grades.mjs` | Delivers grades/feedback to student repos. |
| `provision-workspaces.mjs`, `prune-gradebook.mjs`, `audit-repo-names.mjs` | Roster/repo hygiene. |
| `org-audit.mjs` | Read-only cross-org hygiene plus an access audit. |
| `canvas-push.mjs`, `canvas-export.mjs`, `canvas-pull-points.mjs` | Canvas sync and points reconcile. |
| `build-quiz-qti.mjs`, `canvas-quiz-import.mjs`, `canvas-pull-quiz-grades.mjs` | Quiz-to-Canvas: build the QTI package (offline, deterministic) from `quiz.json`, import it via Content Migrations, and pull Canvas quiz grades back into the gradebook. See [LMS and Canvas](lms-canvas.md). |
| `list-section-repos.mjs`, `sync-unit.mjs` | Section listing and content sync helpers. |
| `generate-attendance-qrs.mjs`, `verify-attendance.mjs`, `publish-attendance.mjs` | Attendance: sign/commit per-student QRs and refresh the roster; verify scanned batches and build the summaries; deliver each student their own receipt. See [Attendance](attendance.md). |

## Gradebook artifacts

| File | Role |
| --- | --- |
| `gradebook/grades.csv` | Machine-readable source of truth. |
| `GRADEBOOK.md` | Human-readable table, commit-linked. |
| `gradebook/notes/<id>/<repo>.md` | Instructor-only AI notes (proposed grade + likelihood flag). |
| `gradebook/points-mismatch.md` | Written when a `totalPoints` disagrees with Canvas. |
| `gradebook/FLAGS.md` | Recorded ambiguities for the instructor to resolve. |

Student-side (delivered on publish): `GRADES.md`, `grades/<id>.json`, `FEEDBACK.md`.

## Conventions (hard rules)

- **Gitmoji** commit subject prefixes.
- **No em dashes** in prose or generated content.
- **No AI co-author trailers** in commits. AI involvement is disclosed openly in
  the README, not in git trailers.
- **No student PII** anywhere public.
- Always `node --check` a changed `.mjs`; prefer a dry run before any write to a
  live gradebook or student repo.
- `gh repo list` calls must use a `--limit` larger than the org's repo count, or
  repos get silently dropped from a sweep.

## Dependencies and constraints

- **Free org is enough for the core system.** Unlimited private repos and the
  monthly Actions quota cover grading; course material renders in the native file
  view, so Pages is not required.
- **GitHub Education** unlocks free student Codespaces (each student's own quota,
  via User ownership) and Pages on private repos (optional).
- **Cross-repo credential required.** A fine-grained PAT is sufficient for a solo
  admin; the built-in `GITHUB_TOKEN` is repo-scoped only, and org-admin status does
  not change that.
- **Static Pages cannot write**, which is why a repo-graded quiz is answered by
  editing `answers.json` in the repo rather than through a hosted form. A quiz can
  instead be hosted and auto-graded in Canvas by importing its QTI package (see
  [LMS and Canvas](lms-canvas.md)); then students answer it in Canvas.
