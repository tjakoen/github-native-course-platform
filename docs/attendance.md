# Attendance (QR scan)

Track class attendance without paper, entirely on GitHub. Each student carries a
personal QR in their workspace repo; the instructor scans QRs at the door with a
phone; scans are committed as CSV batches to the teacher repo and summarized
automatically. Like grading, it is teacher-side and permission-gated: only the
instructor can record attendance.

## How it works

1. **Generate QRs.** The `Generate attendance QRs` workflow signs each student's
   number and commits `attendance/attendance-qr.png` (plus a short README) into
   any student workspace that lacks one, and refreshes the teacher-side
   `attendance/roster.json` (number to name) the scanner uses to show names.
   Students save the image to their phone's Photos.
2. **Scan.** The instructor opens the scanner at
   **https://tjakoen.github.io/github-native-course-platform/scanner/** (bookmark
   that URL on a phone home screen; it boots straight into the scanner - the
   console's old `#/scan` hash just redirects there), picks the section, and the
   phone camera becomes a QR reader showing roster names. Each scan is recorded
   with a timestamp. (The old per-repo Pages scanner in each teacher repo has
   been retired - the console is the one scanner now. The CSV format is
   unchanged.)
3. **Commit batches.** Scans are grouped into a *batch* (one scanning period).
   The instructor commits a batch at any time - safe against a dead phone - and
   starts a new batch for latecomers or a second class the same day. Each batch
   is its own CSV.
4. **Verify + summarize.** The `Verify attendance` workflow fires on each batch
   commit: it recomputes the signature on every scan, flags any forgery, writes a
   per-date summary (`attendance/sessions/<date>/<date>.md` - one file per day,
   every batch of that day combined with a Session column), rebuilds the roll-up
   `attendance/ATTENDANCE.md`, and emits a
   machine-readable `attendance/summary.json` (per-student verified dates - the
   feed the next step reads).
5. **Deliver receipts.** The `Publish attendance` workflow runs automatically
   when `Verify attendance` finishes and writes each student their own
   `attendance/MY-ATTENDANCE.md` in their workspace - their dates and count only,
   never a classmate's. See *Students see their own attendance* below.

## What the QR contains

The QR encodes `<section>.<studentNumber>.<signature>`, where the signature is
`HMAC-SHA256(ATTENDANCE_HMAC_SECRET, "<section>:<studentNumber>")` (first 12
base64url chars). The section prefix lets the scanner reject a wrong-class QR at
scan time; older sectionless `<studentNumber>.<signature>` codes still verify.
The student number is in the clear so the scanner can show a name; the signature
is what a forger cannot mint without the secret. A hand-made or edited QR fails
verification and is marked **FLAGGED** in the batch summary (and the workflow
run reds).

## Manual attendance (no QR at hand)

Two teacher-attested paths, both recording the literal word `manual` in the
signature column - `Verify attendance` counts such rows as present and labels
them **MANUAL** (never FLAGGED). The trust model is the commit itself: these
CSVs live in the private teacher repo, so the ability to commit one is the
instructor's authority, the same trust the gradebook rests on.

- **At the door:** the scanner page has an "Add manually" field (with roster
  autocomplete) that drops a student into the current batch without a QR.
- **Retroactively:** the Attendance tab's **Manual attendance -> prompt** picks
  students and a date and generates an intent; the AI appends the rows to that
  date's `manual.csv`, pushes, and the usual verify + receipts pipeline runs.

Verification runs only in the `Verify attendance` workflow, which holds the
secret - never in the scanner. `roster.json` deliberately carries names only,
never signatures (a published signature would be a ready-made forgery).

## Who can scan

Only the instructor. Loading the scanner page is harmless - it is just HTML - but
**recording** attendance (reading the roster, committing a batch) requires a
personal access token with write access to the private teacher repo. Students do
not have that, cannot see the teacher repo or its secrets, and their QR is only
an ID: it records nothing until the instructor scans it into an authenticated
session. Keep the token on your own device and you are the sole recorder.

## Students see their own attendance

Each student gets an `attendance/MY-ATTENDANCE.md` in their own workspace showing
the sessions held, which they attended (Present / dash), and their count - so a
student can check their own record without asking. It is delivered by the
`Publish attendance` workflow, which is the **only** thing that writes attendance
into a student repo. Like grade publishing, delivery is a distinct step from the
teacher-side verification; here it is wired to run automatically after each
`Verify attendance`, so a fresh scan reaches students on its own.

Privacy is preserved by construction: a receipt contains only that student's own
dates (the workflow matches each workspace to its `studentNumber` and copies out
just that student's row from `summary.json`) - never the class list, never a
signature. "Present: X of N sessions" reports only how many sessions were held,
not who attended them. The receipt is derived from the recorded data (its
freshness line uses the last session date, not the clock), so re-running on an
unchanged record rewrites nothing - the auto-publish makes no needless commits.

A manual `workflow_dispatch` on `Publish attendance` offers a dry-run
(`execute=false`) to preview which workspaces would change before writing, and an
`only=<handle>` to target one student. If a student reports a wrong record, fix
the underlying batch CSV and re-run `Verify attendance`; the receipt follows.

## Files and layout (in the teacher repo)

```
attendance/
  roster.json                          studentNumber -> name (names only)
  ATTENDANCE.md                        auto-built roll-up (sessions + per-student tally)
  summary.json                         auto-built machine feed (per-student verified dates)
  sessions/
    2026-07-20/
      1430-on-time.csv                 a batch (timestamp,studentNumber,signature)
      1430-on-time.md                  its auto-built summary
      1520-late.csv                    a later batch (latecomers)
      1520-late.md
```

Because everything is scoped to one teacher repo, one repo == one class - no
"which class is this" ambiguity. Multiple classes on the same day are just
separate batches (label them, e.g. `class-a`, `class-b`).

## Look and feel

The scanner lives in the **Course Console** (a bookmarkable page at `.../scanner/`),
so there is nothing per-repo to build or deploy. It wears the console's **GRAIN
design system**: a size-capped square camera with a reticle that flashes green on
a good scan (red on a wrong-class or unreadable QR, muted on a duplicate) plus a
short success beep, so a door scanner gives an at-a-glance and at-an-earshot
signal.

## One-time setup

1. **Add the signing secret.** In each teacher repo: Settings -> Secrets and
   variables -> Actions -> New repository secret, named `ATTENDANCE_HMAC_SECRET`,
   value = any random string (e.g. `openssl rand -hex 32`). It signs and verifies
   within the one repo; it need not match across repos. Rotating it invalidates
   existing QRs (re-run generate with `force`).
2. **Open the Course Console scanner.** It is already hosted at
   `https://tjakoen.github.io/github-native-course-platform/scanner/` - nothing to
   deploy per repo. Bookmark it on your phone's home screen.
3. **Set the repo token.** In the console's Settings, add a fine-grained PAT with
   Contents: read + write for the teacher repos (the same token the console's
   grading intents already use). It is kept only in that browser's localStorage;
   the scanner records batches with it.

## Day to day

- **New/updated roster** (new students joined): run `Generate attendance QRs`
  (dry-run first, then `execute=true`). It only adds QRs to workspaces missing
  one; use `force=true` to regenerate all.
- **Take attendance:** open the Course Console scanner on your phone, pick the
  section from the dropdown, scan students in (green flash and a beep on each good
  scan), tap **Commit batch**. Start a **New batch** for a late group or a
  different class. The token is stored once in the console, so one phone handles
  every section without re-entering anything.
- **Review:** open `attendance/ATTENDANCE.md` for the roll-up, or a batch's `.md`
  for one session. A red `Verify attendance` run means a scan was flagged - open
  the annotation.

## Guardrails

- Grading and attendance never touch each other; attendance is its own folder and
  its own workflows.
- The generate step never deletes or renames anything and is dry-run by default.
- No student PII leaves the teacher repo except each student's **own** record:
  names live in `roster.json` and the summaries inside the private repo; the
  console scanner fetches them only with your token and stays data-free. The one
  thing delivered outward, `MY-ATTENDANCE.md`, holds only the recipient's own
  dates - a student never sees a classmate's attendance.
