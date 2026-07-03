# GitHub-Native Course Platform

> A university coursework, quiz, and grading system that runs **entirely on GitHub** — no hosted app, no third-party LMS. The instructor drives everything from an Actions tab; students live in their own repo. Grades sync out to Canvas as a single CSV at the very end.

Built and run in production across several live university courses (front-end JS/React, Dart/Flutter, and HTML/CSS/JS), covering hundreds of student repositories per term.

This repo is the **overview** of the platform. The two working pieces live in their own repositories, included here as submodules:

| Folder | Repository | What it is |
| --- | --- | --- |
| teacher-template/ | **[teacher-subjectcode-classcode-name](https://github.com/tjakoen/teacher-subjectcode-classcode-name)** | The instructor control center: Actions workflows + Node tooling + grader. Generic and config-driven — a real GitHub template. |
| student-template/ | **[student-subjectcode-classcode-name](https://github.com/tjakoen/student-subjectcode-classcode-name)** | The student workspace: where a student reads material, submits, and sees grades. |

~~~bash
# clone with both templates included
git clone --recurse-submodules https://github.com/tjakoen/github-native-course-platform.git
~~~

Also here: the full [ARCHITECTURE.md](ARCHITECTURE.md) and a synthetic [demo/](demo/) of the output (fictional students, no real data). Live course content and gradebooks stay private because they hold student data.

---

## The problem

Running a programming course usually means stitching together an LMS, a grading tool, a plagiarism checker, and a pile of spreadsheets — none of which live where the code lives. Students submit through a portal; feedback comes back somewhere else; the instructor reconciles it all by hand.

This platform collapses that into one place developers already are: **GitHub**. Coursework is a repo. Submitting is a push. Grading is a GitHub Action. Feedback is a Markdown file in your repo. The only time another system appears is the final grade export to Canvas.

## Guiding principles

- **GitHub is the LMS; Canvas is just the export target.** Materials, quizzes, grading, and each student's personal workspace all live in Git. Canvas receives one gradebook CSV at the end.
- **Native over hosted.** No servers to run. The instructor's UI is workflow_dispatch forms in the Actions tab plus committed Markdown/CSV. The student's UI is their repo's file view and the green checkmarks.
- **Source-of-truth split.** The **student repo** owns *submissions*. The **teacher repo** owns *grades*. Nothing official is ever read back from a student repo, so there is nothing for a student to tamper with.
- **Grade off-repo.** Grades are computed in the teacher repo from canonical tests against a snapshot commit — never from code running inside the student's repo.
- **Honest about integrity.** Take-home work can't be proctored. The design deters the honest majority (per-student variants, deadline snapshots, viva spot-checks) rather than pretending to prevent the determined.

---

## How it fits together

~~~
INSTRUCTOR PERSONAL ACCOUNT  (shared across all courses)
├── teacher template   (private)  ─┐  reusable skeletons; the placeholder words
└── student template   (public)   ─┘  in the names show the pattern to fill in

COURSE ORG  (one per course; sections identified by a class code in the repo name)
│
├── teacher repo   (PRIVATE — the instructor's single pane of glass)
│   ├── roster/       github handle → Canvas ID mapping, per section
│   ├── content/      course material, released unit by unit
│   ├── quizzes/      questions + private answer keys (keys never leave here)
│   ├── grader/       canonical tests + grade logic
│   ├── gradebook/    SOURCE OF TRUTH for grades (GRADEBOOK.md + grades.csv)
│   └── .github/      the control panel: workflow_dispatch forms + scheduled sweep
│
└── student repos   (PRIVATE, one per student, made from the student template)
    ├── content/  ┐  instructor zone — synced in by automation; may be overwritten
    ├── quizzes/  │
    ├── grades/   ┘  display-only receipts pushed back after grading
    ├── notes/    ┐
    ├── journal/  ├  student zone — automation NEVER writes here
    ├── project/  ┘
    └── student.json  identity: class code, name, number, emails, github handle
~~~

**The ownership boundary is the key idea.** Automation only ever writes to the *instructor zone* (content/, quizzes/, grades/). The *student zone* (notes/, journal/, project/) is never touched — so re-publishing course material can never clobber a student's own work. One repo is both a managed course and a personal learning space.

---

## Grading and publishing are separate

This split is deliberate and load-bearing:

| Step | What it does | Touches student repos? |
| --- | --- | --- |
| **Grade sweep** | Clones each submission at its snapshot commit, runs the canonical tests in grader/, writes the gradebook (grades.csv, GRADEBOOK.md) and AI feedback notes. | **Never.** Teacher-side only. |
| **Publish grades** | The *only* step that writes to student repos. Delivers GRADES.md, receipts, and FEEDBACK.md — and only for activities explicitly flagged for release. | Yes — dry-run by default, acts only on an explicit publish=true. |
| **Publish material** | Copies a unit of course content/ into every workspace in a section. | Instructor zone only. |

The grade sweep is **incremental and idempotent**, keyed on each submission's commit SHA: it re-grades only what changed, so it can be run as often as you like and safely resumes if interrupted. A force input re-grades everyone after a test or key changes.

Every workflow that mutates repos is **section-locked** and **defaults to a dry run**, acting only with an explicit execute / publish=true. The shared tooling is byte-identical across all teacher repos — only the per-class config and the grader/ tests differ.

---

## AI-assisted feedback (held for review)

Feedback is generated during the grade sweep using an LLM, grounded in each activity's rubric and a per-class prompt. It comes in two halves:

- **Student-facing:** prose only — encouraging, specific, actionable. No scores, no mention of AI. It reads as the instructor's own notes and is only delivered on explicit publish.
- **Instructor-only:** a proposed grade plus an authenticity signal (an AI-authored likelihood flag for suspected "vibe-coded" submissions). This never leaves the teacher repo.

Nothing AI-generated reaches a student automatically — it is always staged for the instructor to review, edit, and approve first.

---

## LMS sync (Canvas as the reference integration)

At the end of a unit, the gradebook is pushed to the LMS (honoring per-activity lock flags and reconciling point totals), or exported as an offline gradebook CSV. student.json is the bridge: it joins each GitHub repo to the LMS-exported roster on student number, resolving githubAccount ↔ LMS ID without storing that mapping by hand.

**Canvas is the reference implementation, and it's the single external coupling in the whole system.** Because grades live in GitHub as the source of truth, the LMS is only ever a *final export target*, touched at one isolated seam. Supporting another LMS (Moodle, Blackboard, Google Classroom, Brightspace) is therefore an **adapter swap, not a rewrite** — implement the same push/export/reconcile calls against that LMS's API. The CSV export path is already LMS-neutral, since most systems accept a gradebook CSV import.

---

## Integrity, honestly

Client-side lockdown on a student's own machine is a nudge, not a lock. Integrity instead comes from mechanisms students can't control:

- **Per-student quiz variants** — copied answers are worthless.
- **Deadline snapshots** via commit timestamps — an un-fakeable submission window, no real-time proctoring needed.
- **Commit-history signals** — organic work reads differently from a single paste.
- **Viva spot-checks** on a random sample — deters hired-gun cheating across a cohort.
- **Private repos** — students can't browse each other's work.

Anything high-stakes runs in person, not on the pure-GitHub path. This is stated as a limitation, not hidden.

---

## What runs it

- **GitHub Actions** — the entire control plane (workflow_dispatch forms + a scheduled grade sweep).
- **Node.js** — the shared tooling (grade sweep, publish, roster reconciliation, Canvas sync, repo-hygiene audits).
- **GitHub Codespaces** — every repo ships a .devcontainer/ so any course opens as a zero-setup cloud dev environment.
- **Canvas API** — the reference LMS integration and the system's one external coupling, isolated so another LMS is an adapter swap (see above).
- **An LLM** — for rubric-grounded, held-for-review feedback.

Free-tier friendly by design: unlimited private repos and the monthly Actions quota cover the core system, and course material renders in the native repo file view, so no hosting or Pages plan is required.

---

## Using this yourself

Both templates are real GitHub **templates** — click **Use this template** on either repo.

**Instructor:** create your control center from the **[teacher template](https://github.com/tjakoen/teacher-subjectcode-classcode-name)**, then:

1. Edit **course.config.json** with your org name(s) and workspace-template owner. Nothing class-specific is hardcoded in the tools; they read from this file (and workflow env overrides it).
2. Add the Actions secrets: ORG_PAT (cross-repo git), CANVAS_TOKEN + CANVAS_BASE_URL (grade export), and MODELS_PAT if you want AI feedback.
3. Lock each workflow to your section via its SECTION / WORKSPACE_PREFIX env.

**Students:** create a workspace from the **[student template](https://github.com/tjakoen/student-subjectcode-classcode-name)**.

## Status

Live and in production across multiple courses and sections. This is a sanitized public snapshot — the running instances, course content, and gradebooks stay private because they contain student data.

---

[![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97757)](https://claude.com/claude-code)

Built with the help of Claude (Anthropic), shared in the interest of transparency.
