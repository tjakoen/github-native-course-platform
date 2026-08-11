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

_(AI feedback needs no secret: notes are drafted in a Claude Code session via the Course Console prompt, not a hosted model.)_

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
| `submit` | Canvas submission type for the sync tool: `"repo"` (default), `"url"` (manual/badge), `"canvas"` (quiz). Grading-neutral. |
| `content` | The `content/` unit folder that teaches the activity; renders the workspace-relative lesson pointer in the Canvas description. |
| `title` | Human title; the Canvas assignment name becomes `<ID>: <title>`. |
| `canvasName` | Exact name of an EXISTING Canvas assignment to adopt, when that name carries no id token (e.g. `"Final Project Proposal Submission"`). Without it the sync would create a duplicate. Case- and space-insensitive; a trailing `(12345)` in a gradebook CSV header is ignored. |

See [Authoring activities](authoring-activities.md), [Canvas
activities](canvas-activities.md) (the Canvas-shell authoring standard), and
[Grading and feedback](grading-and-feedback.md).

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
| `canvas-quiz-configure.yml` | Sets an imported quiz's window, attempts, shuffle and answer visibility, and publishes it. Dry-run by default; reads every setting back from Canvas afterwards. |
| `canvas-quiz-verify.yml` | Read-only. Compares the quiz Canvas stored against `quiz.json` item by item and fails on any mismatch. |
| `canvas-announce.yml` | Posts `announcements/<id>.md` as a course announcement. Dry-run by default. |
| `canvas-activity-status.yml` | Read-only. Per activity: does a Canvas assignment exist, is it published, its points and window, and how many students submitted or were graded. Takes a course id, so one section can survey another. |
| `canvas-assignment-dates.yml` | Sets an activity's due / available-from / available-until dates. Dry-run by default; changes dates only, never points, description or published. |
| `canvas-assignment-publish.yml` | Flips an activity's Canvas `published` flag. Dry-run by default; changes nothing else, and refuses to unpublish an assignment students have submitted to. |
| `canvas-sync-assignments.yml` | Authors Canvas assignments from `assignments.json` (name, description, points, submission type) and places them in the `SUBMISSIONS` module. Dry-run by default; creates unpublished; never sets due date or publishes. See [Canvas activities](canvas-activities.md). |
| `provision-workspaces.yml` | Creates a workspace for a student who has activities but none, adding the student as an admin collaborator on it; backfills a blank `student.json`. Never deletes or renames. |
| `prune-gradebook.yml` | Drops gradebook rows whose submission repo 404s (deleted/renamed). |
| `audit-names.yml` | Flags misnamed repos and blank `student.json`. Weekly plus manual. |
| `generate-attendance-qrs.yml` | Signs and commits a per-student attendance QR into any workspace missing one; refreshes the teacher-side roster. Dry-run by default. See [Attendance](attendance.md). |
| `verify-attendance.yml` | On each scanned batch CSV, verifies signatures, flags forgeries, and rebuilds the attendance summaries (including `summary.json`). |
| `publish-attendance.yml` | Delivers each student their own `attendance/MY-ATTENDANCE.md` receipt; runs automatically after `verify-attendance`, or manually with a dry-run. The only step that writes attendance to student repos. See [Attendance](attendance.md). |

Repo **deletes and renames stay manual**: the tools flag them, a human performs
them (they need the `delete_repo` scope).

## Tools (Node, under `tools/`)

The shared tools are **byte-identical across all teacher repos**; only
`grader/` and config differ.

| Tool | What it does |
| --- | --- |
| `grade-sweep.mjs` | The grader (per-repo; renders previews where a class needs them). Grades several submissions at once; `--jobs=<n>` overrides the default of `min(4, cores)`. |
| `publish-grades.mjs` | Delivers grades/feedback to student repos. |
| `provision-workspaces.mjs`, `prune-gradebook.mjs`, `audit-repo-names.mjs` | Roster/repo hygiene. `audit-repo-names.mjs` scopes itself to its own section (the workflow pipes the whole org listing in) and exits non-zero only for mismatches that can actually lose a delivery; pure casing drift is reported as a note. |
| `org-audit.mjs` | Read-only cross-org hygiene, a **visibility** pass, and an access audit. Reports a drifted repo name as already graded when the sweep's own matching recovers it, so the action list holds only names that actually cost a grade. **Do not rename a recovered repo:** the gradebook row is keyed on the repo name and a rename never 404s, so `prune-gradebook.mjs` can never clear the stranded row. Reads `student.json` in batched GraphQL (40 repos per request), because one REST call per repo exhausted the hourly quota mid-run and left the access pass unable to complete. |
| `canvas-push.mjs`, `canvas-export.mjs`, `canvas-pull-points.mjs` | Canvas sync and points reconcile. |
| `build-quiz-qti.mjs`, `canvas-quiz-import.mjs`, `canvas-pull-quiz-grades.mjs` | Quiz-to-Canvas: build the QTI package (offline, deterministic) from `quiz.json`, import it via Content Migrations, and pull Canvas quiz grades back into the gradebook. See [LMS and Canvas](lms-canvas.md). |
| `canvas-quiz-configure.mjs` | Finishes an imported quiz: window, attempts, time limit, answer shuffle, when correct answers appear, and publish. Reads every setting back and reports drift, because Canvas normalizes some of them. **Refuses a time of exactly 00:00**, which Canvas rewrites to 23:59:59 of the same day, moving a boundary by a whole day. |
| `canvas-quiz-verify.mjs` | Read-only. Compares Canvas against `quiz.json` per item: stem, type, points, the full choice set, which option is weighted correct, and every accepted fill-in-the-blank spelling. The import log only reports that the migration completed, which says nothing about whether the questions arrived intact. |
| `canvas-announce.mjs` | Posts `announcements/<id>.md` as a course announcement (a small deterministic Markdown subset renders to HTML), so what students were told lives in git next to the thing it was about. Dry-run by default. |
| `canvas-activity-status.mjs` | Read-only. Per activity: Canvas assignment presence, published state, points, due and available-until dates in the course offset, submitted and graded counts, and late submissions. The gradebook only knows what the sweep graded from repos, so it cannot see Canvas submissions nothing pulled back. |
| `canvas-assignment-dates.mjs` | Sets due / available-from / available-until. `canvas-sync-assignments.mjs` deliberately never touches dates or `published`; this is that half, for when the Canvas UI is unreachable. The dry run reports what reopening costs: how many late flags the new due date clears, and how many students already hold a score a fresh submission would not update until the next sweep. |
| `canvas-assignment-publish.mjs` | The third thing neither the sync nor the dates tool will do: make an assignment visible. Dry-run by default, and the dry run prints the dates alongside the flag, because publishing an assignment with no unlock date opens it instantly and publishing one whose lock date has passed shows students work they cannot submit. Refuses to unpublish anything already submitted or graded, rather than letting the API decide. |
| `canvas-sync-assignments.mjs` | Authors the Canvas assignment shell from `assignments.json` (name, description, points, submission type) and places it in the `SUBMISSIONS` module. Dry-run by default. See [Canvas activities](canvas-activities.md). |
| `canvas-pull-grades.mjs` | Pulls any activity's Canvas grades back into `gradebook/grades.csv` (the general form of `canvas-pull-quiz-grades`; use for manual/badge activities graded in Canvas). Dry-run by default. |
| `list-section-repos.mjs`, `sync-unit.mjs` | Section listing and content sync helpers. |
| `generate-attendance-qrs.mjs`, `verify-attendance.mjs`, `publish-attendance.mjs` | Attendance: sign/commit per-student QRs and refresh the roster; verify scanned batches and build the summaries; deliver each student their own receipt. See [Attendance](attendance.md). |

## Gradebook artifacts

| File | Role |
| --- | --- |
| `gradebook/grades.csv` | Machine-readable source of truth. |
| `GRADEBOOK.md` | Human-readable table, commit-linked. |
| `gradebook/notes/<id>/<repo>.md` | Instructor-only AI notes (proposed grade + likelihood flag). |
| `gradebook/grader-hashes.json` | Fingerprint per activity of the canonical tests its grades were computed against, so the sweep can tell "unchanged, safe to reuse" from "test was edited". Written by the sweep. |
| `gradebook/UNMATCHED.md` | Repos that look like submissions for the section but that no activity claimed, so they were never graded. Written every sweep. This is the only place a misnamed SUBMISSION repo is reported: `audit-repo-names.mjs` covers `student-`/`teacher-` names only. |
| `gradebook/ANOMALIES.md` | Submissions that look like a student failing but are usually the toolchain, written every sweep and never changing a grade. Two tripwires: a test TOTAL that differs from the rest of the class (the suite did not fully run, or the student's own tests pad the denominator), and the same framework exception across two or more submissions. Read it before delivering grades. |
| `gradebook/points-mismatch.md` | Written when a `totalPoints` disagrees with Canvas. |
| `gradebook/FLAGS.md` | Recorded ambiguities for the instructor to resolve. |

Student-side (delivered on publish): `GRADES.md`, `grades/<id>.json`, `FEEDBACK.md`.

## Conventions (hard rules)

- **Gitmoji** commit subject prefixes.
- **No em dashes** in prose or generated content.
- **No AI co-author trailers** in commits. AI involvement is disclosed openly in
  the README, not in git trailers.
- **No student PII** anywhere public. Enforced in the platform repo by
  `scripts/check-public-hygiene.mjs` and the **Public hygiene** workflow, which
  scan this repo and both template submodules for live org names, live class
  codes, student-number patterns, real email addresses and em dashes. It exists
  because the public teacher template once shipped real student GitHub handles
  in tool comments: the Pages tripwire only inspects the built console artifact,
  so it can never see a tool's source. When it fires on something legitimate,
  fix the text rather than widening the pattern.
- **Repo visibility is a grading-data concern.** Students are admin on their own
  repos, so they can publish one; a public workspace exposes that student's
  grades, feedback and `student.json`. Only the activity templates, the published
  solutions and the demos belong public. `org-audit.mjs` flags the rest.
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
