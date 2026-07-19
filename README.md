# 🎓 GitHub-Native Course Platform

[![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97757?logo=anthropic&logoColor=white)](https://tjakoen.github.io/notes/ten-times-zero)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-2ea44f)](LICENSE)
![Architecture: GitHub-native](https://img.shields.io/badge/architecture-GitHub--native-2ea44f)
![Hosted server: none](https://img.shields.io/badge/hosted_server-none-2ea44f)
![LMS: Canvas](https://img.shields.io/badge/LMS-Canvas-E13223)

> A university coursework, quiz, and grading system that runs **entirely on GitHub** - no hosted app, no third-party LMS. The instructor drives everything from an Actions tab; students live in their own repo. Grades sync out to Canvas as a single CSV at the very end.

Built and run in production across several live university courses (front-end JS/React, Dart/Flutter, and HTML/CSS/JS), covering hundreds of student repositories per term.

## 📖 Documentation

Full documentation lives in **[docs/](docs/)**. Good places to start:

- **[Overview](docs/overview.md)** - what it is and the problem it solves.
- **[Core concepts](docs/concepts.md)** - the three splits that make it safe.
- **[Getting started](docs/getting-started.md)** - set up your own course.
- **[Live examples](docs/examples.md)** - one activity in three real, public orgs.
- **[Architecture](docs/architecture.md)** - the full technical design.

The [docs index](docs/README.md) has reading paths for evaluating, setting up,
authoring, and student use.

## The pieces

This repo is the **overview**. The two working pieces live in their own repositories, included here as submodules:

| Folder | Repository | What it is |
| --- | --- | --- |
| teacher-template/ | **[teacher-subjectcode-classcode-name](https://github.com/tjakoen/teacher-subjectcode-classcode-name)** | The instructor control center: Actions workflows + Node tooling + grader. Generic and config-driven - a real GitHub template. |
| student-template/ | **[student-subjectcode-classcode-name](https://github.com/tjakoen/student-subjectcode-classcode-name)** | The student workspace: where a student reads material, submits, and sees grades. |

~~~bash
# clone with both templates included
git clone --recurse-submodules https://github.com/tjakoen/github-native-course-platform.git
~~~

Also here: a synthetic [demo/](demo/) of the output (fictional students, no real data). Live course content and gradebooks stay private because they hold student data.

## Why it is different

- **GitHub is the LMS; Canvas is just the export target.** Materials, quizzes, grading, and each student's personal workspace all live in Git. Canvas receives one gradebook CSV at the end.
- **Native over hosted.** No servers to run. The instructor's UI is workflow forms in the Actions tab; the student's UI is their repo's file view and the green check marks.
- **Source-of-truth split.** The student repo owns submissions; the teacher repo owns grades. Nothing official is ever read back from a student repo, so there is nothing to tamper with.
- **Grade off-repo.** Grades are computed in the teacher repo from canonical tests against a snapshot commit, never from code running inside the student's repo.
- **Honest about integrity.** Take-home work cannot be proctored. The design deters the honest majority (per-student variants, deadline snapshots, viva spot-checks) rather than pretending to prevent the determined.
- **Even attendance is native.** Each student carries a signed QR in their workspace; the instructor scans it with a phone (a Pages page), and scans commit as CSV batches that a workflow verifies and summarizes. See [Attendance](docs/attendance.md).

See [Core concepts](docs/concepts.md) for how these turn into a concrete repository layout.

## Using this yourself

Both templates are real GitHub **templates** - click **Use this template** on either repo, then follow **[Getting started](docs/getting-started.md)**. Prefer to see it first? **[Live examples](docs/examples.md)** has three public example activities, one per stack, each with a green autograder run to watch.

## Status

Live and in production across multiple courses and sections. This is a sanitized public snapshot - the running instances, course content, and gradebooks stay private because they contain student data.

---
🤖 **Built by [tjakoen](https://github.com/tjakoen) with Claude - I don't prompt and pray, I prompt and prove.** Every commit here is co-authored with an AI, on purpose. [How I actually work with AI, receipts and all →](https://tjakoen.github.io/notes/ten-times-zero)
