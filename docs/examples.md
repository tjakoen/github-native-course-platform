# Live examples: one activity, three stacks

The platform is abstract until you see a real activity in an org. These are
illustrative example activities running in three example course
orgs, one per stack. Each is the same "hello world" activity (`m1a1`, the
standard starter every class begins with), so you can compare how the identical
engine adapts to JavaScript, Dart, and plain HTML/CSS/JS.

If you are a teacher who wants to build your own course, start here: open the
template, click **Use this template**, and read
[Authoring activities](authoring-activities.md) for how to author more.

## The three example activities

| Stack | Course org | Activity template (copy this) | Reference solution (answer key) | Autograder run |
| --- | --- | --- | --- | --- |
| JavaScript / Vitest | [COURSE-ORG-A](https://github.com/COURSE-ORG-A) | [`m1a1-classcode-yourname`](https://github.com/COURSE-ORG-A/m1a1-classcode-yourname) | [`m1a1-solution`](https://github.com/COURSE-ORG-A/m1a1-solution) | [Actions](https://github.com/COURSE-ORG-A/m1a1-solution/actions) |
| Dart | [COURSE-ORG-B](https://github.com/COURSE-ORG-B) | [`m1a1-classcode-yourname`](https://github.com/COURSE-ORG-B/m1a1-classcode-yourname) | [`m1a1-solution`](https://github.com/COURSE-ORG-B/m1a1-solution) | [Actions](https://github.com/COURSE-ORG-B/m1a1-solution/actions) |
| HTML / CSS / JS | [COURSE-ORG-C](https://github.com/COURSE-ORG-C) | [`m1a1-classcode-yourname`](https://github.com/COURSE-ORG-C/m1a1-classcode-yourname) | [`m1a1-solution`](https://github.com/COURSE-ORG-C/m1a1-solution) | [Actions](https://github.com/COURSE-ORG-C/m1a1-solution/actions) |

> The org names above (`COURSE-ORG-A/B/C`) are placeholders. Point them at your own public course orgs to make these links resolve.

**Every activity in these orgs is itself a template repo**, not just `m1a1`. So a
teacher can copy any activity directly with **Use this template**, or browse an
org to see a whole course's worth of activities.

## What each part shows

- **The template repo** is what a student copies to start. It holds the starter
  stub, a student-facing copy of the tests, a blank `student.json`, the brief in
  `README.md`, and a `.devcontainer/` so it opens in Codespaces with one click.
  Nothing here is the answer.
- **The solution repo** is the instructor's completed reference (the answer key),
  kept out of students' hands. Because it is a finished, passing submission, its
  **Actions tab shows the autograder running green end to end** - the clearest
  way to see the grading engine actually work without setting anything up.
- **The Actions run** is the autograder (`test.yml` / Autograde). Push a
  submission and GitHub Actions runs the canonical tests and reports pass/fail.
  In the live course the teacher-side grade sweep runs the same tests off-repo
  and records the score in the gradebook; the per-repo Action is the fast
  feedback loop students see.

## The same shape everywhere

Open any two side by side and you will see the invariant the platform is built
on. The activity is always:

- a small **stub** the student completes (`hello.js` / `bin/hello.dart` /
  `src/index.html`),
- a **canonical test** that scores it (Vitest, `dart test`, or Vitest + jsdom),
- the standard **`student.json`** identity check (the same six fields in every
  activity, every class),
- and a **README** brief that names the concept to research rather than handing
  over the answer.

Only the language and the test runner change. That is the whole idea: one
engine, per-class tests and config. To build your own, copy a template and
follow [Authoring activities](authoring-activities.md).
