# Grading Dashboard — UI plan

A teacher-facing web dashboard layered on top of the existing GitHub-native
grading platform. It **reads** committed gradebook artifacts and GitHub run
status, and performs only two **write** actions: dispatch a workflow, and edit a
flag in `assignments.json`. The grading engine is never bypassed and student
repos are never touched directly (publishing still goes only through
`publish.yml`).

Design context lives in `ARCHITECTURE.md`, `AI-GRADING-FEEDBACK-PLAN.md`, and
`CLAUDE.md`. This file is the source of truth for the UI.

## Decisions (locked)

- **Full dashboard** (not a single-purpose tool): Overview, Review Queue,
  Activities, Students, Runs, Canvas Sync, Flags.
- **Hosting:** GitHub Pages, **deployed inside each teacher repo** (5 sites, one
  shared static build).
- **Auth:** **fine-grained PAT**, pasted per session, held in browser memory
  only. No backend, no OAuth app.

## The governing constraint: Pages is public on this plan

The teacher repos are **private** and the orgs are on the **Team** plan.
Access-controlled (private) Pages is an **Enterprise Cloud-only** feature, so a
Pages site published here is served on the **public internet**. Therefore:

> **No raw private data may ever be baked into the Pages build.** The published
> artifact contains only the static app (HTML/JS/CSS) with zero data. Student PII
> (`grades.csv`) and instructor-only AI notes (`gradebook/notes/`: proposed
> scores + vibecode/likelihood flags) are fetched **at runtime** by the
> authenticated teacher and live only in that browser session. Client-side
> masking is a UX nicety, not the security boundary; the security boundary is
> "the bytes are never in the public artifact, and the API refuses anyone who is
> not the token holder."

The app renders nothing before login. The public URL exposes an empty shell.

## Architecture: public shell + runtime private fetch

1. **Pages hosts the static app only.** No gradebook data, no secrets.
2. **Login gate:** teacher pastes a fine-grained PAT (memory/sessionStorage
   only; cleared on tab close; never localStorage, never committed).
3. **Runtime data access** via `api.github.com` (CORS-enabled for browsers):
   - read private repo contents: `grades.csv`, `gradebook/notes/`,
     `grader/assignments.json`, `points-mismatch.md`, `reports/`, roster
   - list and dispatch workflow runs: `grade.yml`, `publish.yml`,
     `canvas-push.yml`
   - commit flag edits back to `assignments.json`

### Fine-grained PAT scopes

Per org (one token per org; owner approval may be required if the org restricts
fine-grained tokens):

- **Contents:** Read (view gradebook) and Write (commit flag edits)
- **Actions:** Read and Write (list runs + `workflow_dispatch`)
- **Metadata:** Read (mandatory)
- Resource owner = the course org; repository access = the teacher repo (plus
  student/workspace repos in that org if the Students/publish-status views need
  them)

### Scope of each deployed site

Because a fine-grained PAT is single-org and each site lives in one teacher repo,
**each dashboard is per-course**. The Overview aggregates that course's sections
only. 6YYY has two teacher repos (0000, 0000) in one org, so one token serves
both of that org's dashboards. There is no single global cross-course view under
this model (acceptable tradeoff of the per-repo + FG-PAT choices).

## Views

Scope hierarchy: Course/Section -> Activity -> Student, plus the cross-cutting
Review Queue, Runs, and Canvas tabs.

**A. Overview (home).** Cards per section: students, activities, % graded,
# awaiting review, last grade run (status + time), points-mismatch count. Alert
strip: failed runs, points mismatches, unmatched students (workspace-linking
issue), stale gradebooks.
Sources: `grades.csv`, `assignments.json`, Actions runs API, `points-mismatch.md`.

**B. Review Queue (highest value).** Inbox of AI drafts in `gradebook/notes/`
not yet published. Split detail pane: **student-facing prose** (what would land
in `FEEDBACK.md`: no scores, no "AI") vs **instructor-only** (proposed grade +
vibecode/likelihood flag), visually walled apart. Actions: approve, add note,
re-run AI for one submission; when an activity is fully cleared, prompt to set
`publish:true`.
Sources: `gradebook/notes/`, `grades.csv`, `assignments.json`.

**Editing the prose (verified against the code 2026-07-01):** feedback is stored
in TWO places, and only one of them is what students receive:

- Instructor-only half (score + vibecode flag): readable markdown at
  `gradebook/notes/<id>/<repo>.md` (grade-sweep.mjs:274-278). "Edit on
  GitHub"-able, but `publish` never reads it, so editing it changes nothing for
  students.
- Student-facing prose (becomes `FEEDBACK.md`): **base64-encoded in a single cell
  of `grades.csv`** (grade-sweep.mjs:268, `encNotes`). `publish` decodes that cell
  and delivers it (publish-grades.mjs:147-153). It is NOT a markdown file, so the
  "Edit on GitHub" deep-link does NOT work for the delivered prose.

To make the queue editable, pick one:

- **Option A (no engine change):** dashboard decodes the `notes` cell, edits it,
  re-encodes, and commits the rewritten `grades.csv` (whole-file rewrite via
  Contents API + sha, careful CSV escaping). UI-only, but a real write flow.
- **Option B (recommended if prose editing matters):** `grade-sweep` also emits
  the student prose as a readable file (e.g. `gradebook/feedback/<id>/<repo>.md`)
  and `publish` reads that file (fallback to the CSV cell). Then "Edit on GitHub"
  works directly and the review queue stays UI-light. Cost: a change to the
  shared/careful engine files, sequenced and copied to all 5 repos.
- Option C (edit the CSV in GitHub) is a dead end: base64, not human-editable.

The instructor-only notes (`gradebook/notes/`) remain "Edit on GitHub"-able for
adding triage remarks; only the student-facing prose needs Option A or B.

**C. Activities.** Table of activities: id, type, totalPoints, flags
(locked / ai-grading / feedback / previews / publish), graded count, avg,
published?. Row opens an activity detail with the submission roster (score, late,
sha, preview screenshots when `previews:"branch"`, link to the student's note).
Sources: `assignments.json`, `grades.csv`, `reports/`, published previews.

**D. Students.** Per-student view across all activities: scores, late history,
workspace-repo link status, delivered-vs-held state. Surfaces unmatched /
undelivered cases (blank `student.json` or handle/title mismatch) with the
reason.
Sources: `grades.csv`, roster, workspace repo existence via API.

**E. Runs.** Dispatch and observe. Buttons for `grade.yml`, `publish.yml`
(**dry-run ON by default**, explicit toggle to real-run), `canvas-push.yml`.
Live table of recent runs (status, duration, trigger, logs link). Publish
dry-run previews what would change before going live.
Sources: Actions runs + dispatch API.

**F. Canvas Sync.** Points-mismatch table (Canvas vs `totalPoints`), last
export/push time, per-activity sync state. Action: dispatch canvas export/push.
Sources: `points-mismatch.md`, canvas workflow runs.

**G. Flags.** Visual `assignments.json` editor: grid of activities x flags with
toggles/inputs, staged changes, single "commit" (gitmoji subject, no AI
co-author trailer). Guardrails: warn when enabling `ai-grading` without
`feedback`/`totalPoints`, or `publish:true` while drafts are unreviewed.

## Data model (fetched per session, per repo)

- `activities[]` <- `assignments.json` (+ derived: graded count, avg, published)
- `grades[]` <- `grades.csv` (PII fields flagged for on-screen masking)
- `notes[]` <- `gradebook/notes/` (split into studentProse / instructorOnly)
- `runs[]` <- Actions API
- `mismatches[]` <- `points-mismatch.md`
- `students[]` <- roster + workspace-repo link status

## Cross-cutting rules

- **PII masking:** names/numbers/emails masked by default; reveal is
  session-only, never persisted or logged. (Masking is UX; the real protection
  is that no PII is in the public build.)
- **Held-for-review wall:** student-facing vs instructor-only halves are
  visually unmistakable everywhere notes appear.
- **Dry-run default:** any publish action defaults to dry-run with a deliberate
  confirm to go live.
- **Freshness:** data is **always live from GitHub** (no local clones); every
  view reads the current committed state via the API. That state is only as fresh
  as the last committed grade run, so show "graded at" prominently and nudge to
  re-run when stale.

## Student-facing view (decided: polished markdown, no hosted app)

The teacher dashboard is a hosted app because it aggregates across students and
performs actions. The student side needs none of that: everything a student
should see is **read-only, self-only, and already delivered** to their own
private workspace repo (`GRADES.md`, `grades/*.json` receipts,
`grades/previews/`, `FEEDBACK.md` when published, plus their own
content/journal/project/quizzes).

**Approach:** make the delivered markdown the UI. No Pages, no auth, no app.

- **Do not enable Pages on student repos.** Workspace repos are private; Pages on
  Team is public, so a student site would expose one student's grades. GitHub's
  own repo access control is the privacy boundary: only the student (and staff)
  can read their private repo, and GitHub renders `GRADES.md` / `FEEDBACK.md` for
  them natively.
- **Ship a clean `README.md` landing page in the student template**
  (`student-subjectcode-classcode-name`) so it propagates to every new workspace
  repo for free. It links to: grades (`GRADES.md`), feedback (`FEEDBACK.md`),
  previews (`grades/previews/`), and the student's own work folders. Keep it
  generic (no per-student data).
- The dynamic files (`GRADES.md`, receipts, `FEEDBACK.md`, previews) are already
  written by `publish-grades.mjs`; the landing README is static template content.
- **Confirm `publish-grades.mjs` does not overwrite the template `README.md`** (or
  make the landing page a separate file it never touches), so the polished
  landing page survives grade delivery.

Scales trivially to ~1100 repos because it is just template markdown. If a real
student app is ever wanted, prefer a single shared "Sign in with GitHub" portal
over per-repo Pages (avoids 1100 public sites and student PAT friction).

## Deployment

- Static app source kept in one canonical location, then copied into each
  teacher repo (mirror the existing engine-sync discipline: edit once, copy to
  all, commit/push each). It is a new UI, so it is not bound by the
  byte-identical engine rule, but keeping the copies identical is the sane
  default.
- Publish via a Pages deploy workflow (e.g. `actions/deploy-pages`) from a
  `ui/` source or a `gh-pages` branch. Confirm Pages is enabled per repo.

## Security notes (PAT model)

- Token in memory / sessionStorage only; cleared on tab close; never localStorage
  or committed.
- Recommend minimal scopes and short expiry; one token per org.
- The app JS is public (it is on public Pages); it holds no secrets. The token
  is supplied by the teacher at runtime and only ever hits `api.github.com`.

## Open items / next steps

1. Pick the framework/build (deferred by user).
2. Confirm org policy allows fine-grained PATs (owner approval) for each org.
3. Decide whether the Students view needs read access to student/workspace repos
   (widens token repo scope) or can rely on `grades.csv` + roster alone.
4. Decide Review Queue editing: **Option A** (in-app CSV edit, no engine change)
   vs **Option B** (engine emits a readable feedback file publish reads). See
   Review Queue section. Verified: prose lives base64 in `grades.csv`, not in a
   markdown file, so a plain "Edit on GitHub" link does not work for it.
5. Build a static mockup of Overview + Review Queue to validate layout before
   choosing a stack.

Resolved by verification (2026-07-01):
- `publish-grades.mjs` does NOT overwrite the student `README.md`; it only writes
  `grades/`, `GRADES.md`, `FEEDBACK.md`. The polished landing page is safe.
- `publish` delivers the prose from the `grades.csv` `notes` cell, not a
  regeneration, so an edit to that cell (Option A/B) does reach students.
