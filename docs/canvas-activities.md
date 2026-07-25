# Canvas activities: the authoring standard

GitHub is the source of truth for what an activity is. You define it once in the
teacher repo (`grader/assignments.json` plus, where they apply, `grader/<id>/RUBRIC.md`
and `grader/<id>/CANVAS.md`), and `tools/canvas-sync-assignments.mjs` projects it
onto Canvas: it creates or updates the matching Canvas assignment's name,
description, Points Possible, and submission type, and drops it into your
`SUBMISSIONS` module. On Canvas you then do exactly two things by hand: **set the
due date** and **publish**. The sync tool never touches either.

This page is the standard the tool follows, so every activity reads the same way
in Canvas whether it is authored by a person or generated.

## The three families

Every activity is one of three kinds. The kind is inferred from
`assignments.json`, and it decides the submission type and where the score comes
from.

| Family | Declared by | Student submits | Score source | Canvas submission type |
| --- | --- | --- | --- | --- |
| **Activity** (repo) | `type: vitest`/`dart`/`flutter` (+ optional `ai-grading`) | push to their GitHub repo | automated tests, or the rubric if `ai-grading` | `none` (the grade is pushed by `canvas-push`, not uploaded) |
| **Quiz** | `type: quiz` | takes it in Canvas | automated (Canvas grades) | left to the QTI import (the sync tool skips quizzes) |
| **Manual** (badge/link) | `manual: true`, `submit: "url"` | pastes a live link | the rubric (graded by hand in SpeedGrader) | `online_url` |

The one hard rule across all three: **the score comes from the automated tests,
or from the rubric if the activity has one.** Nothing is graded on vibes.

A manual activity has no submission repo, so it declares no `namePrefix`. The
grade sweep clones nothing for it (zero repos to match) and produces no gradebook
rows; it is graded entirely in Canvas. If you want that grade back in the local
record afterwards, `tools/canvas-pull-grades.mjs <id>` pulls it into
`gradebook/grades.csv`.

## The description skeleton

The generated Canvas description always has the same slots, in order. A slot that
does not apply to a family is left out.

1. **Summary** - one line: what the student does. (`title`)
2. **Repo** - "Use this template" link to the starter repo. (repo family only)
3. **Content** - where the lesson lives: `content/<slug>/` in the student's
   workspace. (`content`)
4. **Instructions** - the steps. (`grader/<id>/CANVAS.md`, else a per-family default)
5. **Submission & grading** - how to submit and where the score comes from.

The content pointer is deliberately workspace-relative ("open `content/<slug>/`
in your workspace repo"), because each student's content lives in their own
private workspace and one Canvas description cannot deep-link to all of them.

## The fields

These `assignments.json` fields drive the Canvas shell. They are grading-neutral
(the sweep and `canvas-push` ignore them); only the sync tool and the dashboard
read them.

| Field | Meaning |
| --- | --- |
| `submit` | `"repo"` (default), `"url"` (manual/badge), or `"canvas"` (quiz). Picks the Canvas submission type. |
| `content` | The `content/` unit folder that teaches the activity, e.g. `"publish-portfolio"`. Renders the workspace-relative lesson pointer. |
| `title` | Human title. The Canvas name becomes `<ID>: <title>` (id-only if absent). |
| `manual` | `true` marks a hand-graded activity: never swept, never pushed, graded in Canvas. |
| `totalPoints` | Canvas Points Possible. For manual/AI activities this equals the rubric total. |

A manual/badge activity therefore looks like:

```json
{ "id": "m6a3", "type": "manual", "manual": true, "submit": "url",
  "content": "publish-portfolio", "title": "Publish Your Portfolio", "totalPoints": 20 }
```

## Running the sync

`tools/canvas-sync-assignments.mjs` is **dry-run by default** and conservative,
so it is safe to re-run:

- It only touches Canvas assignments whose name maps to one of your activity ids
  (`tokenToId`). Your other Canvas assignments are left alone.
- **Create** builds the full standard shell for an activity Canvas does not have
  yet, as **unpublished**.
- **Update** of an existing assignment reconciles Points Possible only (and only
  when declared) - it will not rewrite an existing description or change a live
  submission type unless you pass `--desc` / `--submit`, and never renames unless
  you pass `--rename`. This keeps a re-run from clobbering assignments you built
  by hand before adopting the standard.
- It adds every managed assignment to the `SUBMISSIONS` module (create the module
  in Canvas first; if it is missing, the sync still runs and warns).
- It never sets the due date or publishes.

```bash
# dry run (nothing written): show the create/update/module plan
node tools/canvas-sync-assignments.mjs

# apply it (creates unpublished assignments, reconciles points, places in module)
node tools/canvas-sync-assignments.mjs --execute
```

Course, org, and workspace prefix come from the section workflow's
`CANVAS_COURSE_ID` / `GRADE_OWNER` / `WORKSPACE_PREFIX` env (override with
`--course` / `--org` / `--workspace-prefix`).

See also: [Authoring activities](authoring-activities.md) for the GitHub-side
activity spine, and [LMS and Canvas](lms-canvas.md) for how grades flow to Canvas.
