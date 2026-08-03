# Usage

Course Console is a data-free GitHub Pages app: an LMS-style shell (side-rail +
topbar + status bar) with hash routes, deployed at
**https://tjakoen.github.io/github-native-course-platform/**. Nothing about a
class loads until you connect its repo; everything you see after that is
fetched live from `api.github.com` in your browser.

## Demo mode (look before you connect)

Append **`?demo=1`** to the URL, or press **Open the demo** on the first-run
screen. The console then runs on three invented classes generated in your
browser from a fixed seed, with no GitHub connection and no token: gradebooks,
AI feedback drafts, student code and screenshots, attendance, reports, engine
runs, and every write surface (filing an intent, flipping a publish flag,
dispatching a workflow) simulated in memory.

It is the real app on fake data, not a mock-up: only the GitHub transport is
swapped, so every parser and view below it is the production one. Use it to
show the platform to someone, to try the review flow before touching a live
class, or to check a UI change without burning API budget.

- Demo mode is **loud** (a rail tag, a banner, a status-bar chip) and one click
  to leave: **Exit demo** in the rail footer.
- It never reads or writes your real setup. Your saved repos and tokens are not
  touched, review decisions go to a separate storage key, nothing is cached to
  disk, and the flag lives in sessionStorage so closing the tab ends it.
- A guided tour starts automatically on the first visit of a tab.

## Setup (one time)

1. Open the hosted console. With no repos configured yet, it shows a setup
   drawer over the boot screen - add your teacher repos there. Once repos are
   configured, the console opens on the **Dashboard**; **Settings** is also
   its own page anytime (rail footer).
2. Add one row **per teacher repo**, and everything stays in your own browser
   (localStorage), never sent anywhere but `api.github.com`:
   - The **repo URL** (e.g. `github.com/COURSE-ORG-C/teacher-6xxx-0003-tjakoen`).
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
  Overview (see below). The **Tour** button is route-aware: it hands you a
  guided tour of whichever view you are standing in (the shell, a class, the AI
  review lane, or the demo), and the shell one also runs once on your first
  visit. A tour highlights and explains, never changes anything.
- **Topbar**: per-class tabs when you're inside a class (Overview, Gradebook,
  Activities, Students, AI Review, Attendance, Ops), a global search box
  (**Cmd/Ctrl-K**), the **↻ refresh** button (drops the cached snapshot and
  re-fetches the current view from GitHub), and a light/dark toggle.
- **Status bar** (bottom): remaining GitHub API budget, how old the current
  view's data is (loaded just now / N min ago, "stale" past ~10 min, or
  "showing cached … refreshing…" while a background refresh runs), and how
  many review decisions are sitting in this browser.

Gradebooks are cached in this browser (IndexedDB) so reopening a class - or
reloading the page - paints instantly from the last snapshot, then refreshes in
the background; unchanged feedback notes never re-download (they are fetched by
immutable content hash). Nothing leaves the machine. Clear it in Settings ->
Cached data, or by removing all repos; it is also swept after 7 days.
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

A management table. **Locked** and **Delivered** are on/off switches (a state
you set, not a verb button), each flip committing a one-line diff to
`grader/assignments.json` (shown before you confirm; cancel reverts the
switch). "Delivered" is the `publish` flag's word; "held" is reserved for the
AI-review lane. A **Stage** chip shows where each activity sits (Draft ->
Graded / In review / Reviewed -> Delivered). Each row also has a dry-run grade
**sweep**, a **scaffold** button (re-file the scaffold intent - the resume
path if you committed the entry then refreshed), and **Set up in Canvas**
(canvas-sync execute for that activity, polled green, then publish-material
for its content unit, polled green - it always leaves the Canvas assignment
unpublished; due date and publish stay manual in Canvas). Below the table, the
Content & Canvas card reuses the Ops **publish-material** control (unit
multiselect, dispatched **sequentially**, each polled green before the next)
plus Canvas sync/push dry-run buttons.

**+ New activity** opens a 3-step wizard (the steps are shown up front):

1. Build the `assignments.json` entry - pick one of the three families
   (auto-graded tests, AI-graded held-for-review, manual/badge link
   submission) and fill in its fields; committed via a diff-confirm.
   `publish` always starts `false`.
2. File a **new-activity** scaffold intent: a prompt for a Claude Code
   session to write `grader/<id>/CANVAS.md`, `RUBRIC.md` (for AI-graded
   activities), and the activity template repo scaffolds.
3. Optionally dry-run the Canvas sync for the new activity.

If you refresh after step 1, the wizard would refuse the id as already
existing - resume from the **scaffold** button on that activity's row.

## Students

Facets for missing work, blank `student.json`, and sub-50% attendance, plus
a filter box. The table sorts on any column header (keyboard-operable) and
carries **At risk** (the reason: missing work and/or low attendance) and
**Delivered** (published activities this student has a grade for, from the
gradebook) columns. The student name is a real link, so the profile is
reachable by keyboard, not just a row click. The Dashboard's attendance alert
deep-links here with the sub-50% facet already applied.

The profile: an **at-risk alert strip** when the student is flagged, an
identity cross-check against the workspace's own `student.json`, delivery
checks (GRADES.md / FEEDBACK.md / attendance receipt), the missing-work list,
their attendance record, and a per-activity table where held/AI rows link
straight into the review detail (with the current decision shown).

## AI Review

A queue per AI-graded activity. The header is a **stage stepper** -
Generate -> Review -> Apply -> Deliver - with ONE contextual primary button
that follows the active stage (Generate feedback while drafts are missing,
Review next while decisions remain, Apply reviewed once everything is decided,
Finalize once the apply intent is filed). The other actions - Generate,
Apply, Finalize, Approve all, Reset - live in the **⋯ overflow menu**.

**The stepper reads the repo, not just this browser.** Decisions live in
localStorage, so on a second machine (or after clearing site data) the lane
would otherwise look untouched even for an activity that already shipped. Two
signals from the teacher repo override that: a reviewed score written into
`grades.csv` (`aiScore`) marks Apply done, and `"publish": true` in
`assignments.json` marks Deliver done and puts a **delivered** chip on the
activity tab plus a line stating how many scores are written. On a delivered
activity with nothing in dispute there is **no primary button at all** -
Finalize stays in the overflow menu, for repairs.

The queue also carries a **Gradebook** column: the score actually written to
`grades.csv`. When it disagrees with the decision saved in this browser the
cell turns amber, the stage header names the rows, and the Finalize drawer
warns before you send. That disagreement is the dangerous one - the emitted
prompt carries the browser's number, so a stale local override can otherwise
overwrite a score the instructor deliberately changed later.

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
then Refresh. Every drawer is a focus-trapped modal dialog: Tab stays inside
it, **Esc** closes it, and it closes on its own if you navigate away. See
[commands.md](commands.md) for what each prompt actually does.

## Attendance

A students x sessions matrix read from each teacher repo's
`attendance/summary.json` (produced by `verify-attendance`), with per-student
present counts and a below-50% flag; at-risk rows are emphasized (a warn
badge), not muted, and each name links into the student profile. One shared
rate policy is used everywhere the console mentions attendance (the Students
facet, this tile/matrix, the at-risk strips, the Dashboard inbox): a roster
student on record for the section but never scanned counts as a genuine 0%,
not "unknown". **Manual attendance → prompt** lets you
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
teacher repos flat into `classes/`, e.g. `classes/teacher-6xxx-0001-tjakoen/`).
They're occasional data-hygiene helpers, separate from the hosted review flow:

- `npm run audit`  -> `out/audit-report.md` (student.json consistency)
- `npm run fix`    -> `out/fix-plan.md` (normalize studentNumbers; dry-run; `-- --apply` to write)
- `npm run blanks` -> `out/blanks-report.md` (graded rows with blank identity)

`classes/`, `out/`, and `grader.config.json` are gitignored: they hold
student PII and must never be committed.
