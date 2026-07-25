# Usage

Course Console is a data-free GitHub Pages app: an LMS-style shell (side-rail +
topbar + status bar) with hash routes, deployed at
**https://tjakoen.github.io/github-native-course-platform/**. Nothing about a
class loads until you connect its repo; everything you see after that is
fetched live from `api.github.com` in your browser.

## Setup (one time)

1. Open the hosted console. With no repos configured yet, it shows a setup
   drawer over the boot screen - add your teacher repos there. Once repos are
   configured, the console opens on the **Dashboard**; **Settings** is also
   its own page anytime (rail footer).
2. Add one row **per teacher repo**, and everything stays in your own browser
   (localStorage), never sent anywhere but `api.github.com`:
   - The **repo URL** (e.g. `github.com/HAU-6INTROWEB/teacher-6introweb-2106-tjakoen`).
   - That repo's **own fine-grained GitHub PAT**. Each repo carries its own
     token, so one expired or rejected PAT only affects that section.
   - **Contents: Read and write** + **Metadata: Read** is enough to load the
     gradebook and file Intents. To also see **student code and screenshots**
     (they live in the submission repos) and the **Recent engine runs**
     timeline / Ops run status, that token needs read access to the whole org
     - a classic PAT with `repo` scope, or a fine-grained PAT with **All
     repositories** (Contents: Read, Actions: Read). Short expiry recommended.
   - Use **+ Add repo** for each additional section.
3. Save. Sections are **auto-discovered** from the repos you listed: the repo
   name gives the subject and section, the remote gives the org, and each
   repo's `grader/assignments.json` says which activities exist and how
   they're graded. No config file.

## The shell

- **Side-rail** (left): the **Dashboard**, then your classes grouped by
  subject, then a footer with **Scanner**, **Tour**, and **Settings**. Ops,
  Flags, and Reports are no longer rail items - Ops moved into each class's
  tabs, and Flags/Reports were folded into the Dashboard and each class's
  Overview (see below). A short guided tour of the shell runs once on your
  first visit; the Tour button replays it anytime.
- **Topbar**: per-class tabs when you're inside a class (Overview, Gradebook,
  Activities, Students, AI Review, Attendance, Ops), a global search box
  (**Cmd/Ctrl-K**), the **↻ refresh** button (re-fetches the current view's
  data from GitHub), and a light/dark toggle.
- **Status bar** (bottom): remaining GitHub API budget, how old the current
  view's data is (and whether it's stale enough to warrant a refresh), and
  how many review decisions are sitting in this browser.
- **Docked ops feed**: appears at the bottom whenever you dispatch a
  workflow from Activities or Ops, and streams dry-run/execute status inline
  without leaving the page.

Routing is all hash-based (`#/`, `#/c/<class>/...`), so back/forward and
bookmarks work normally. The attendance QR scanner is a separate page at
`scanner/` (a phone bookmark, not part of the app shell) - the old `#/scan`
hash just redirects there.

## Finding things fast

**Cmd/Ctrl-K** opens a global search over the static views, every discovered
class, and (for classes you've already loaded) their activities and
students. Picking a result jumps straight there.

## Dashboard

Instant cards per class (stats fill in once you open one), a **Load all
classes** button with a progress meter that refuses to start - or stops
early - when the GitHub API budget is low, and a **Needs attention** inbox
that lists every discovered class: loaded classes show their computed
alerts (held AI grades to review, blank `student.json`, sub-50% attendance)
plus any folded-in engine flag lines, and classes you haven't opened yet
show as a visible "not loaded [load]" row instead of being silently absent.

## A class: Overview

The class landing page (opens when you click into a class): stat tiles, a
**Pending intents** strip (what the console has filed into
`gradebook/intents/` but a Claude Code session has not run yet, so the trail
stays visible after a Send - run pending intents in the teacher repo, then
Refresh), an **At risk** strip (missing work and/or low attendance, linking
to each student's profile), a Canvas-push preview, an in-class **Flags** card
(only appears when the engine actually flagged something for that class), a
**Recent engine runs** timeline for the workflows that matter day to day
(needs a PAT with Actions: Read), and a **Reports** card linking to that
class's generated reports (markdown files open in the in-console reader,
everything else opens on GitHub).

## Gradebook

The full students x activities matrix, plus the **Generate apply-grades
prompt** and **Deliver to Canvas + workspaces** buttons. See
[commands.md](commands.md) for what each of those prompts does.

## Activities

A management table: lock/publish toggles that commit a one-line diff to
`grader/assignments.json` (the diff is shown before you confirm), a
per-activity dry-run grade sweep, and an **activate** button (the Activate
wizard: Canvas-sync execute for that activity, polled to green, then
publish-material for its content unit, polled to green - it always leaves
the Canvas assignment unpublished; due date and publish stay manual in
Canvas). A separate card runs publish-material with a unit multiselect
(units dispatch **sequentially**, each polled green before the next starts)
plus Canvas sync/push dry-run buttons.

**+ New activity** opens a 3-step wizard:

1. Build the `assignments.json` entry - pick one of the three families
   (auto-graded tests, AI-graded held-for-review, manual/badge link
   submission) and fill in its fields; committed via a diff-confirm.
   `publish` always starts `false`.
2. File a **new-activity** scaffold intent: a prompt for a Claude Code
   session to write `grader/<id>/CANVAS.md`, `RUBRIC.md` (for AI-graded
   activities), and the activity template repo scaffolds.
3. Optionally dry-run the Canvas sync for the new activity.

## Students

Facets for missing work, blank `student.json`, and sub-50% attendance, plus
a filter box. Click a row for the student's profile: identity cross-check
against the workspace's own `student.json`, delivery checks (GRADES.md /
FEEDBACK.md / attendance receipt), the missing-work list, and their
attendance record.

## AI Review

A queue per AI-graded activity. The header is a **stage stepper** -
Generate -> Review -> Apply -> Deliver - with ONE contextual primary button
that follows the active stage (Generate feedback while drafts are missing,
Review next while decisions remain, Apply reviewed once everything is decided,
Finalize once the apply intent is filed). The other actions - Generate,
Apply, Finalize, Approve all, Reset - live in the **⋯ overflow menu**.

Approve / override / flag from the queue, or click a row to open the
**full-page review detail**: screenshots (with lightbox zoom) or code tabs on
the left (the media pane collapses when a submission has neither), the
decision card plus editable student-facing and instructor-only text on the
right. Keyboard: **←/→** prev/next, **Enter** approve + advance, **Esc** back
(arrows and Enter are ignored while a text field or button is focused, so you
never lose an unsaved edit); a legend shows this above the panes, the counter
shows how many are still unreviewed, and each decision confirms with a brief
toast. Decisions live in this browser (Export/Import in Settings backs them
up). The pipeline actions:

- **Generate feedback → prompt** drafts AI notes for ungraded submissions
  (disabled when every submission already has a note).
- **Apply reviewed → prompt** writes your reviewed decisions into the
  gradebook (grades only - no delivery; disabled until at least one decision).
- **Finalize → deliver** delivers the cleared students only (disabled until
  at least one is cleared).

Every prompt drawer opens with a one-line **consequence** note (Send files an
intent that a Claude Code session runs; Copy pastes it into a chat; neither
writes anything until you run it), and after a successful **Send** the drawer
shows a **next-step card** naming the filed intent and reminding you to run it
then Refresh. See [commands.md](commands.md) for what each prompt actually does.

## Attendance

A students x sessions matrix read from each teacher repo's
`attendance/summary.json` (produced by `verify-attendance`), with per-student
present counts and a below-50% flag. **Manual attendance → prompt** lets you
pick students and a date and generates an intent for teacher-attested
attendance (no QR needed) - see commands.md. The tab is always available; the
summary matrix is simply empty for sections with no scans yet (Manual
attendance still works). Actually taking attendance (the phone scanner) is the
separate `scanner/` page, not this tab.

## Ops

A class tab (folded out of the global rail in the IA rework - the old
`#/ops` and `#/ops/:key` hashes still work and redirect into the class's Ops
tab): the full workflow catalog for that class, grade sweep, publish, Canvas
push/sync/export, publish material, provisioning, prune, audits, and the
attendance set. Every workflow defaults to a dry run; a real write needs you
to type the class's section code back into a confirm. A live run feed shows
dispatch and completion status inline.

## The write model (read this before you file anything)

Writes are tiered, and this doesn't change with the new shell:

- Anything touching **grades, feedback, or delivery** only ever leaves the
  console as an **Intent** - a prompt file dropped into `gradebook/intents/`
  (via "Send to repo") that a Claude Code session picks up and executes as
  `git`/`gh` operations ("run pending intents"). The console never writes a
  grade itself. Every prompt drawer also has a **Copy** button and an **Open
  in Claude** button: Open in Claude launches claude.ai with the prompt
  pre-filled in the composer (you still press send - the human gate is intact),
  so you skip the copy-paste. Copy stays as the fallback, and for an unusually
  long prompt the link is dropped in favor of Copy (it would overflow the URL).
- **Direct, sha-guarded commits** exist for exactly one thing: flipping
  `grader/assignments.json` flags (the lock/publish toggles, and the new
  activity entry). You always see the diff before it commits.
- **Engine operations** (grade sweep, publish, Canvas push, provisioning,
  attendance QR generation, and so on) run via `workflow_dispatch` on the
  repo's own dry-run-gated workflows. A real write requires typing the
  class's section code back.
- **Attendance scan CSVs** from the scanner page are the only other direct
  write - validated server-side by the repo's `verify-attendance` workflow.

## Maintenance tools (local CLIs)

These run on your machine against a local `classes/` checkout (clone the
teacher repos flat into `classes/`, e.g. `classes/teacher-6apsi-2240-tjakoen/`).
They're occasional data-hygiene helpers, separate from the hosted review flow:

- `npm run audit`  -> `out/audit-report.md` (student.json consistency)
- `npm run fix`    -> `out/fix-plan.md` (normalize studentNumbers; dry-run; `-- --apply` to write)
- `npm run blanks` -> `out/blanks-report.md` (graded rows with blank identity)

`classes/`, `out/`, and `grader.config.json` are gitignored: they hold
student PII and must never be committed.
