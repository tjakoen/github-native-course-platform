# Student guide

Your course workspace is a GitHub repository that is **yours** for the whole
course. It is where you read materials, take quizzes, see your grades, and keep
your own notes, journal, and project plan. This page explains how it is laid out
and what to do.

Your instructor gives you the exact repo name and org for your class. Below,
`<subjectcode>` and `<classcode>` are placeholders; use the real values your
instructor provides.

## Creating your workspace (read first)

When you make your workspace from the template ("Use this template - Create a new
repository"):

1. **Owner: select the course organization, not your personal account.** If it is
   under your personal account, the class cannot reach it and nothing will work.
   Accept your org invite first so the org shows up in the Owner list.
2. **Name it exactly** as your instructor gave you, in the form
   `student-<subjectcode>-<classcode>-<your-github-username>` - all lowercase, no
   spaces, no angle brackets. The subjectcode and classcode are specific to your
   class; replace only your username. (Format example only, not your class:
   `student-6xxx-0000-juandelacruz`.)
3. **Visibility: Private.**

Then clone it (`git clone .../<org>/student-...`) or press `.` in the repo to edit
in the browser.

## Two zones

**Instructor zone** - kept up to date for you; do not rely on editing these, they
get refreshed:

| Folder | What it is |
| --- | --- |
| `content/` | course material - read it right here in GitHub |
| `quizzes/` | quizzes appear here when released |
| `grades/` | your grade receipts (read-only record) |

**Your zone** - yours to fill, never touched by the instructor's automation:

| Folder | What it is for |
| --- | --- |
| `notes/` | your notes per topic |
| `journal/` | reflections and learning log |
| `project/` | planning for your final project |

## First steps

1. Fill in every field in `student.json`, including your **classCode** (it is in
   your repo name, for example `...-0000-...`). This is how your work is matched to
   the class roster.
2. Read `content/` as new material appears.
3. Start a `journal/` entry using the template there.

## Submitting activities

For each activity, you create a **separate submission repo** from that activity's
template (owner the course org, private, named like `m1a1-<classcode>-<handle>`).

- Every new repo starts with a **blank `student.json`**: fill it in every time. A
  blank one means your work will not match to you.
- Do the work in the stub files, then commit and push. That push is your
  submission; the deadline is enforced from your commit timestamp.
- Each repo runs an autograder on push that shows you pass/fail quickly. Your
  official grade is computed separately by your instructor and delivered back to
  your workspace.

## Seeing your grades

Grades and feedback are delivered into your workspace when your instructor
publishes them:

- `GRADES.md` - your scores, with each graded commit linked.
- `grades/<activity>.json` - the per-activity receipt.
- `FEEDBACK.md` - written feedback, when the activity includes it.

These are a read-only record. Editing them changes nothing official; the authority
is your instructor's gradebook.

## Working in a Codespace

You can open your workspace (and every activity repo) as a cloud dev environment,
no local install. Click the green **Code** button - **Codespaces** - **Create
codespace on main**, and work in the browser or in VS Code Desktop.

To protect your free monthly hours: set a **10-minute idle timeout**
(github.com/settings/codespaces), **stop** a Codespace when you finish (do not just
close the tab: open the Command Palette with Ctrl/Cmd+Shift+P and run *Codespaces:
Stop Current Codespace*), and **delete** Codespaces you no longer need
(github.com/codespaces).
