# Usage

## Setup (one time)

1. Open the hosted dashboard: **https://tjakoen.github.io/grader-ui/**. The deployed
   page is an empty shell — it ships no student data.
2. First open lands on **Settings**. Add one row **per teacher repo**, and everything
   stays in your own browser (localStorage), never sent anywhere but `api.github.com`:
   - The **repo URL** (e.g. `github.com/HAU-6INTROWEB/teacher-6introweb-2106-tjakoen`).
   - That repo's **own fine-grained GitHub PAT**, scoped to just that one repo, with
     **Contents: Read and write** + **Metadata: Read**. (Read pulls the gradebook; write
     is only for dropping the generated prompt into `gradebook/intents/`.) Each repo
     carries its own token, so one expired or rejected PAT only affects that section.
     Use **+ Add repo** for each additional section.
3. Save. Sections are **auto-discovered** from the repos you listed: the repo name
   gives the subject and section, the remote gives the org, and each repo's
   `grader/assignments.json` says which activities have screenshots. No config file.

## Everyday flow

1. **Open** the dashboard (or hit **↻ Refresh** to re-fetch). Gradebooks, screenshots,
   and code are pulled live from the GitHub API on demand.
2. **Review:** Gradebook tab for the full matrix, AI Review tab for held AI grades.
   Approve / override / flag; edit the student-facing and instructor-only text.
   Decisions persist in the browser (localStorage) and can be backed up with
   **Export decisions** (import merges a backup back in).
3. **Act:** use a "Generate prompt" button to produce the Intent. The dashboard writes
   it to `gradebook/intents/` in the repo (or use the drawer's Copy button), then you
   run the pending intents in a Claude Code session. The AI writes the grades /
   feedback / Canvas push. See [commands.md](commands.md).

## Maintenance tools (local CLIs)

These run on your machine against a local `classes/` checkout (clone the teacher
repos flat into `classes/`, e.g. `classes/teacher-6apsi-2240-tjakoen/`). They're
occasional data-hygiene helpers, separate from the hosted review flow:

- `npm run audit`  -> `out/audit-report.md` (student.json consistency)
- `npm run fix`    -> `out/fix-plan.md` (normalize studentNumbers; dry-run; `-- --apply` to write)
- `npm run blanks` -> `out/blanks-report.md` (graded rows with blank identity)

`classes/`, `out/`, and `grader.config.json` are gitignored: they hold student PII
and must never be committed.
