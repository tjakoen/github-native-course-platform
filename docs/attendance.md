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
2. **Scan.** The instructor opens the scanner (a GitHub Pages page), which reads
   the roster and turns the phone camera into a QR reader. Each scan is recorded
   with a timestamp.
3. **Commit batches.** Scans are grouped into a *batch* (one scanning period).
   The instructor commits a batch at any time - safe against a dead phone - and
   starts a new batch for latecomers or a second class the same day. Each batch
   is its own CSV.
4. **Verify + summarize.** The `Verify attendance` workflow fires on each batch
   commit: it recomputes the signature on every scan, flags any forgery, writes a
   per-batch summary, and rebuilds the roll-up `attendance/ATTENDANCE.md`.

## What the QR contains

The QR encodes `<studentNumber>.<signature>`, where the signature is
`HMAC-SHA256(ATTENDANCE_HMAC_SECRET, "<section>:<studentNumber>")` (first 12
base64url chars). The student number is in the clear so the scanner can show a
name; the signature is what a forger cannot mint without the secret. A
hand-made or edited QR fails verification and is marked **FLAGGED** in the batch
summary (and the workflow run reds).

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

## Files and layout (in the teacher repo)

```
attendance/
  scanner.html                         the Pages scanner app (no secret in it)
  roster.json                          studentNumber -> name (names only)
  ATTENDANCE.md                        auto-built roll-up (sessions + per-student tally)
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

## One-time setup

1. **Add the signing secret.** In each teacher repo: Settings -> Secrets and
   variables -> Actions -> New repository secret, named `ATTENDANCE_HMAC_SECRET`,
   value = any random string (e.g. `openssl rand -hex 32`). It signs and verifies
   within the one repo; it need not match across repos. Rotating it invalidates
   existing QRs (re-run generate with `force`).
2. **Enable the scanner site.** The `Deploy attendance scanner` workflow enables
   Pages itself on its first run and publishes *only* `scanner.html` (as
   `index.html`) - the gradebook and its PII are never in the Pages artifact, so
   the public site exposes nothing sensitive. The scanner reaches the repo only
   through the token you paste at runtime. Site URL after the first deploy:
   `https://<owner>.github.io/<repo>/`. (If your org disables Pages by default,
   turn it on once in Settings -> Pages, Source = GitHub Actions, then re-run.)
3. **Make a scanner token.** A fine-grained PAT scoped to the one teacher repo,
   Contents: read + write. You paste it into the scanner once; it is kept only in
   that browser's localStorage.

## Day to day

- **New/updated roster** (new students joined): run `Generate attendance QRs`
  (dry-run first, then `execute=true`). It only adds QRs to workspaces missing
  one; use `force=true` to regenerate all.
- **Take attendance:** open the scanner on your phone, paste the token the first
  time (org/repo/section auto-fill from the URL), scan students in, tap
  **Commit batch**. Start a **New batch** for a late group or a different class.
  The scanner remembers its settings **per repo**, so one phone handles several
  sections without re-entering anything (the token is remembered per host, so a
  token covering all of an org's sections is pasted only once).
- **Review:** open `attendance/ATTENDANCE.md` for the roll-up, or a batch's `.md`
  for one session. A red `Verify attendance` run means a scan was flagged - open
  the annotation.

## Guardrails

- Grading and attendance never touch each other; attendance is its own folder and
  its own workflows.
- The generate step never deletes or renames anything and is dry-run by default.
- No student PII leaves the teacher repo: names live in `roster.json` and the
  summaries inside the private repo; the scanner fetches them only with your
  token; the Pages site publishes only the scanner.
