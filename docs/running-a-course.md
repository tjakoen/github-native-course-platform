# Running a course

This is the chronological walkthrough: the exact order you go from an empty GitHub
org to a class that is provably running, and how you know at each step that it
works. [Getting started](getting-started.md) is the reference for individual
settings and click paths; this page is the story that strings them together and
adds the validation loop that gives you confidence before real grades depend on
it.

This whole process is meant to be **AI-assisted**. Every step can be driven by an
AI coding assistant that runs `gh` and the repo's workflows for you. See
[Operating with an AI assistant](operating-with-ai.md). In practice you describe
the step, the assistant proposes the exact command or workflow, and you approve
it.

## The shape of it

You are building, in order:

1. A **course org** locked down so students see only their own repos.
2. A **teacher control center** repo inside that org, holding the engine.
3. A **section of students** who each create one workspace repo in the org.
4. A **first content push** that proves the engine can reach every student.
5. A **first assignment** (`m1a1`, hello world) that proves the grader works.

When step 5 comes back green for a real student submission, the platform is
confirmed end to end. Everything after that (more units, quizzes, AI feedback,
Canvas sync) is the same machinery repeated.

## Phase 0 - prerequisites (once per instructor)

Get a **GitHub organization** for the course, **GitHub Education** on your account
and the org (this is what makes student Codespaces free), and optionally an **AI
coding assistant** authenticated as an org-admin account. Details in [Getting
started](getting-started.md).

## Phase 1 - create and lock down the org

Goal: students can create their own repos in the org but cannot see anyone else's.

1. **Base permission = none** (Org - Settings - Member privileges). A member sees
   only repos they were explicitly added to.
2. **Allow members to create private repos** (same page). Students need this to
   create their workspace from the student template.
3. **Enable Codespaces with User ownership**, so usage bills each student's
   personal Education quota, never the org.

**How you know it works:** have a throwaway or second account join the org and
confirm it sees an empty repo list, not other repos.

## Phase 2 - create and configure the teacher repo

Goal: the control center exists inside the org and can reach student repos.

1. **Create from the teacher template**, owner the course org, named
   `teacher-<subjectcode>-<classcode>-<name>`, visibility Private.
2. **Set `course.config.json`** for this class: the org(s), the `teachers`
   accounts, and the workspace template owner.
3. **Add the `ORG_PAT` secret**, a fine-grained PAT scoped to the org with
   Contents, Pull requests, and Issues write. Org-admin status alone does not give
   a workflow cross-repo access; this token does.
4. **Add the Models and Canvas secrets when you need them.** Not needed to prove
   the core loop.

**How you know it works:** the repo lives under the org (check the owner in the
repo header) and the Actions tab lists the workflows.

## Phase 3 - add students and have them create workspaces

Goal: every student has one correctly named, org-owned, private workspace repo.

1. **Invite students to the org.** They must accept before they can create a repo
   in the org.
2. **Make a Team per section** named after the class code, and add students as
   they accept. The Team is grouping and access backstop; the class code in each
   repo title is what the workflows actually filter on.
3. **Hand students the onboarding instructions** from [Getting
   started](getting-started.md), with real subjectcode and classcode filled in.
   The critical points: owner is the course org (not their personal account), name
   exactly `student-<subjectcode>-<classcode>-<handle>` all lowercase, visibility
   Private, and every field of `student.json` filled in.

Tell students `student.json` is a per-repo, every-time habit: every repo they
create from a template starts with a blank one, and a blank one means their work
will not match to them on the roster.

**How you know it works:** run the repo-name audit (Actions - Audit repo names).
It flags wrong sections, typo'd codes, and blank `student.json` files across the
section. A clean audit means the section is correctly wired.

## Phase 4 - first content push (the first real proof)

Goal: prove the engine can write into every student repo in the section.

1. Put a small unit under `content/<unit>/` on the default branch (even a one-file
   `content/m0-welcome/README.md` is enough for the test).
2. **Actions - Publish material - Run workflow**, enter the unit folder name. It
   opens an auto-merged PR adding the folder into every `student-` repo in the
   section. Your teacher repo is never a target.

**How you know it works:** the run summary lists each student repo it pushed to;
then confirm with students that the folder appeared. If a student is missing, it
is almost always a naming or ownership mistake from Phase 3, which the audit
catches.

## Phase 5 - first assignment and the grader (end-to-end proof)

Goal: a real student submission flows through the grader and lands in the
gradebook.

1. **Have students do `m1a1`**, the hello-world activity. They create the
   submission repo from its activity template (owner the org, private, named
   `m1a1-<classcode>-<handle>`), fill `student.json`, and do the work.
2. **Run the grade sweep** (Actions - Grade sweep). It clones each `m1a1-`
   submission at its snapshot commit, grades it against the canonical tests in
   `grader/m1a1/`, and writes the gradebook (`gradebook/grades.csv`,
   `GRADEBOOK.md`). This is teacher-side only; it never writes to student repos.

**How you know it works:** open `GRADEBOOK.md` on the teacher repo. A graded row
for a real `m1a1` submission, with the score the tests produced, means the full
loop works: org, student repo, clone, canonical tests, gradebook.

At this point the platform is confirmed. Delivering those grades back to students
is a separate, deliberate step (Publish, dry-run by default, and only for
activities flagged `"publish": true`). See [Grading and
feedback](grading-and-feedback.md).

## The confirmation checklist

You have proven the platform works in class when all of these are true:

- [ ] A test account in the org sees only its own repos (base permission locked).
- [ ] The teacher repo is owned by the **org** and its workflows are listed.
- [ ] `ORG_PAT` is set; a content push reaches other repos.
- [ ] Every student's workspace is org-owned, private, correctly named, with a
      filled `student.json` (repo-name audit is clean).
- [ ] A content push shows up in students' repos and they confirm receipt.
- [ ] An `m1a1` submission produces a real graded row in `GRADEBOOK.md`.

Everything the platform does afterwards - more units, quizzes, AI feedback, Canvas
sync, provisioning, pruning - is the same verified machinery. When in doubt about
any of it, run a **dry run first** and read the plan before approving a write.

## Ongoing maintenance

Roster and repo hygiene is handled by section-locked workflows, each dry-run by
default: **Provision workspaces**, **Prune gradebook**, and **Audit repo names**.
Prefer these over doing repo surgery by hand. See [Operating with an AI
assistant](operating-with-ai.md) for the full jobs catalogue and
[Reference](reference.md) for the workflow list.
