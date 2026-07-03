# Documentation

Everything you need to understand, adopt, and run the GitHub-Native Course
Platform: a university coursework, quiz, and grading system that runs entirely on
GitHub. The instructor drives everything from an Actions tab, students live in
their own repo, and grades sync out to an LMS (Canvas is the reference) as a
single CSV at the end. Nothing is hosted.

New here? Read [Overview](overview.md), then [Core concepts](concepts.md). Ready
to build one? Jump to [Getting started](getting-started.md).

## Reading paths by role

**I want to evaluate whether this fits my course**
1. [Overview](overview.md) - what it is and the problem it solves.
2. [Core concepts](concepts.md) - the three splits that make it safe.
3. [Live examples](examples.md) - one activity in three real, public orgs.
4. [Architecture](architecture.md) - the full technical design.

**I am setting up a new course**
1. [Getting started](getting-started.md) - the one-time setup runbook.
2. [Running a course](running-a-course.md) - the lifecycle, with a proof step at
   every phase.
3. [Operating with an AI assistant](operating-with-ai.md) - how to drive it day
   to day.

**I am authoring coursework**
1. [Authoring activities](authoring-activities.md) - add a graded activity in any
   stack.
2. [Grading and feedback](grading-and-feedback.md) - how scores and AI feedback
   are produced.
3. [Reference](reference.md) - flags, config, and workflows at a glance.

**I am a student in a course**
- [Student guide](student-guide.md) - your workspace, how to submit, where grades
  appear.

## All pages

| Page | What it covers |
| --- | --- |
| [Overview](overview.md) | What the platform is, the problem, guiding principles. |
| [Core concepts](concepts.md) | The four repositories, the ownership boundary, and the grade/publish and source-of-truth splits. |
| [Architecture](architecture.md) | The full technical design: topology, identity/roster, control panel, material and quiz flow, grading model. |
| [Getting started](getting-started.md) | One-time setup: org lockdown, teacher repo, secrets, Codespaces, onboarding students. |
| [Running a course](running-a-course.md) | The chronological lifecycle and the confirmation checklist that proves it works. |
| [Authoring activities](authoring-activities.md) | Add a graded activity across JS, Dart, and HTML/CSS/JS, from test-only to AI-enhanced. |
| [Grading and feedback](grading-and-feedback.md) | The off-repo grading model, receipts, and held-for-review AI feedback. |
| [Operating with an AI assistant](operating-with-ai.md) | The jobs catalogue and the guardrails that keep grades safe. |
| [LMS and Canvas](lms-canvas.md) | The single external coupling, and how to swap in another LMS. |
| [Student guide](student-guide.md) | The student experience: workspace zones, submitting, seeing grades. |
| [Reference](reference.md) | Naming, `course.config.json`, `assignments.json` flags, workflows, conventions. |
| [Live examples](examples.md) | Three public example activities, one per stack. |
| [Design notes](design/) | Deeper design and roadmap: the AI-feedback plan and the grading-dashboard UI plan. |

## Conventions in this documentation

- Naming uses **literal lowercase values, no angle brackets**:
  `teacher-6xxx-0000-instructor`, `student-6xxx-0000-juandelacruz`. Here `6xxx` is
  a subject code, `0000` a class/section code, and the last part a GitHub handle.
- The platform is stack-agnostic; examples span JavaScript (Vitest), Dart
  (`dart test`), and HTML/CSS/JS (Vitest + jsdom).
