# Overview

A university coursework, quiz, and grading system that runs **entirely on
GitHub**. There is no hosted app and no third-party LMS in the daily loop. The
instructor drives everything from a private teacher repo's Actions tab; each
student lives in their own repo. Grades sync out to Canvas as a single CSV at the
very end.

It has been built and run in production across several live university courses
(front-end JS/React, Dart/Flutter, and HTML/CSS/JS), covering hundreds of student
repositories per term.

## The problem

Running a programming course usually means stitching together an LMS, a grading
tool, a plagiarism checker, and a pile of spreadsheets, none of which live where
the code lives. Students submit through a portal; feedback comes back somewhere
else; the instructor reconciles it all by hand.

This platform collapses that into one place developers already are: **GitHub**.
Coursework is a repo. Submitting is a push. Grading is a GitHub Action. Feedback
is a Markdown file in your repo. The only time another system appears is the final
grade export to Canvas.

## Guiding principles

- **GitHub is the LMS; Canvas is just the export target.** Materials, quizzes,
  grading, and each student's personal workspace all live in Git. Canvas receives
  one gradebook CSV at the end.
- **Native over hosted.** No servers to run. The instructor's UI is
  `workflow_dispatch` forms in the Actions tab plus committed Markdown/CSV. The
  student's UI is their repo's file view and the green check marks.
- **Source-of-truth split.** The student repo owns *submissions*. The teacher
  repo owns *grades*. Nothing official is ever read back from a student repo, so
  there is nothing for a student to tamper with.
- **Grade off-repo.** Grades are computed in the teacher repo from canonical tests
  against a snapshot commit, never from code running inside the student's repo.
- **Honest about integrity.** Take-home work cannot be proctored. The design
  deters the honest majority (per-student variants, deadline snapshots, viva
  spot-checks) rather than pretending to prevent the determined.

See [Core concepts](concepts.md) for how these principles turn into a concrete
repository layout.

## What runs it

- **GitHub Actions** - the entire control plane (`workflow_dispatch` forms plus a
  scheduled grade sweep).
- **Node.js** - the shared tooling (grade sweep, publish, roster reconciliation,
  Canvas sync, repo-hygiene audits).
- **GitHub Codespaces** - every repo ships a `.devcontainer/`, so any course opens
  as a zero-setup cloud dev environment.
- **Canvas API** - the reference LMS integration and the system's one external
  coupling, isolated so another LMS is an adapter swap. See [LMS and
  Canvas](lms-canvas.md).
- **An LLM** - for rubric-grounded, held-for-review feedback. See [Grading and
  feedback](grading-and-feedback.md).

Free-tier friendly by design: unlimited private repos and the monthly Actions
quota cover the core system, and course material renders in the native repo file
view, so no hosting or Pages plan is required.

## Using it yourself

Both templates are real GitHub **templates**. Click **Use this template** on
either repo:

- **Teacher control center** - `teacher-subjectcode-classcode-name`
- **Student workspace** - `student-subjectcode-classcode-name`

Then follow [Getting started](getting-started.md). Prefer to see it before you
build it? [Live examples](examples.md) has three public example activities, one
per stack, each with a green autograder run to watch.

## Status

Live and in production across multiple courses and sections. The public artifacts
are a sanitized snapshot; the running instances, course content, and gradebooks
stay private because they contain student data.
