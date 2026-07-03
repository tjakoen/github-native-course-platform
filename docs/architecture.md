# GitHub-Native Course Platform - Architecture

> The deep technical reference, part of the [documentation](README.md). For the
> friendlier front door, read [Overview](overview.md) then
> [Core concepts](concepts.md).

A coursework, quiz, and grading system that runs **entirely on GitHub**. Canvas
is never the workspace - it only receives a CSV at the very end. Day-to-day,
students live in their own repo and the instructor drives everything from a
private teacher repo's **Actions tab**.

---

## 1. Guiding principles

1. **GitHub is the LMS; Canvas is just the export target.** Materials, quizzes,
   grading, and the student's personal workspace all live in GitHub. The only
   moment Canvas appears is a gradebook CSV import at the end.
2. **Native over hosted.** No third-party servers. The instructor UI is the
   teacher repo's `workflow_dispatch` forms + committed Markdown/CSV. The
   student UI is their repo's file view, GitHub Issues, and the green ✅ checks.
3. **Source-of-truth split:**
   - **Student repo = source of truth for *submissions*** (their answers, code,
     notes). Theirs to own and edit.
   - **Teacher repo = source of truth for *grades*** (the evaluation, the
     gradebook, the export). Nothing official is ever read back from a student
     repo.
4. **Grade off-repo.** Grades are computed in the teacher repo from canonical
   tests/keys against a snapshot commit. Because the student repo is never an
   input to the official grade, there is nothing for a student to tamper with -
   no hashing of grades is required.
5. **Honest about integrity.** Take-home work over GitHub cannot be proctored.
   We deter the honest majority (variants, deadline snapshots, viva) rather than
   pretend to prevent the determined.

---

## 2. The four repositories

| Repo | Lives in | Visibility | Role |
| --- | --- | --- | --- |
| **`teacher-subjectcode-classcode-name`** (teacher template) | instructor **personal account** | private | Reusable control-center skeleton. The literal placeholder words in the name show the pattern to fill when creating an instance. |
| **`student-subjectcode-classcode-name`** (student template) | instructor **personal account** | public | Reusable workspace skeleton. Holds no secrets/PII. |
| **teacher repo** | the **course org** | private | The live control-center instance for that course - keys, roster, gradebook, and workflows run here. One per course org. |
| **sample-student repo** | the **course org** | private | A live student instance to test the full pipeline before rollout. |

**Naming convention** (classCode in the title drives section targeting):
- Teacher repo: `teacher-<subjectcode>-<classcode>-<teachername>` - e.g. `teacher-6xxx-0000-instructor`
- Student repo: `student-<subjectcode>-<classcode>-<studentname>` - e.g. `student-6xxx-0000-juandelacruz`

Publishing/grading target only the **`student-`** prefix for a section, so the
teacher repo (same classCode) is never a target.

> **Templates live in the instructor's personal account** because there are
> multiple courses - one shared pair of templates seeds instances into every
> course org. The **live instances** (teacher repo, student repos) live in the
> relevant **course org**. Every **instantiated student repo is private** (grades
> + personal journals), even though the student-*template* is public.

### Org & section model
- **One org per course** (e.g., a 6XXX org, a 6YYY org).
- **Within an org, classes/sections are divided by `classCode`** - encoded in
  the repo title (e.g., `student-6xxx-0000-juandelacruz`) **and** mirrored as an org **Team**
  per section. Publishing/grading/export target a section by its Team.

---

## 3. Topology

```
PERSONAL ACCOUNT  (shared across all courses)
├── teacher-subjectcode-classcode-name (private, template) ─┐ placeholder words
└── student-subjectcode-classcode-name (public, template)  ─┘ = the pattern to fill

COURSE ORG  (one per course, e.g. 6XXX; sections = classCode in repo titles + org Teams)
│
├── teacher-<subject>-<class>-<name>  (PRIVATE - the instructor's single pane of glass)
│   ├── roster/        github → Canvas mapping per section
│   ├── content/       master course material (released over time, branch per unit)
│   ├── quizzes/        questions + private answer keys + variant seeds (branch per quiz)
│   ├── grader/         canonical tests + grade logic
│   ├── gradebook/      SOURCE OF TRUTH for grades (GRADEBOOK.md + grades.csv)
│   └── .github/workflows/   the control panel (workflow_dispatch + scheduled sweep)
│
└── student-<subject>-<class>-<name>  (PRIVATE, one per student, from the student template)
    ├── content/   ┐ instructor zone - synced in by automation; may be overwritten
    ├── quizzes/   │   (quiz questions land here at release; keys never do)
    ├── grades/    ┘   display-only receipts (grades/*.json + GRADES.md)
    ├── notes/     ┐
    ├── journal/   ├ student zone - automation NEVER writes here; not published to Pages
    ├── project/   ┘
    └── student.json   identity (classCode, name, number, emails, githubAccount)
```

### Ownership boundary
Automation only ever writes to the **instructor zone** (`content/`, `quizzes/`,
`grades/`). The **student zone** (`notes/`, `journal/`, `project/`) is never
touched, so releasing/overwriting instructor content can never conflict with or
destroy a student's personal work. This boundary is what lets the repo be both a
managed course and a personal learning space at once.

---

## 4. Identity & roster

- **Students self-provision:** each student creates their repo from
  the student template into the course org ("Use this template"), **owned by the
  org** (not a personal account), names it
  `student-<subject>-<class>-<github>`, and fills `student.json`. (Requires org
  membership + "members can create private repos" enabled.)
- **The instructor adds students to the org and to a per-section Team** - this
  handles access control and section grouping.
- **Mapping uses the repo title + `student.json`, anchored to the Canvas CSV.**
  The `student-` prefix + classCode in the title select a section's repos;
  `student.json` is the **bridge** to Canvas - joined to the **Canvas-exported
  roster CSV** (`roster/<classCode>.csv`) on **student number** (`SIS User ID`),
  falling back to email, which resolves `githubAccount ↔ Canvas ID`.
- **A reconcile/validate step flags anything that doesn't line up:**
  - Canvas student with **no matching repo** (not provisioned / mistyped number
    or email),
  - **repo matching no Canvas student** (wrong section, bad data),
  - **cross-submission inconsistency** - a student's `student.json` disagrees
    across their own repos (e.g. classCode 0000 in one, 3360 in another),
  - **missing submissions** - who hasn't submitted a given activity/quiz yet,
  - classCode/section mismatches.
- `roster/<classCode>.csv` is the **Canvas-exported CSV** (Student, ID, SIS User
  ID, SIS Login ID, Section); `githubAccount` is resolved by joining
  `student.json` to it (on student number / email), not stored as a column.
- `classCode` is checked as part of grading (every activity/quiz verifies it),
  consistent with existing activities.

---

## 5. Control panel (teacher repo workflows)

The instructor's entire interface is the **Actions tab**. Each workflow is a
`workflow_dispatch` form (some also run on a schedule). Every workflow is
section-locked: its `SECTION`/`WORKSPACE_PREFIX` env is fixed to the one class
the teacher repo owns. The shared tools (`tools/*.mjs`, `tools/lib/*.mjs`) are
**byte-identical across all teacher repos**; only the workflow env and
`grader/` differ. **Anything that mutates repos defaults to a dry run** and acts
only with an explicit `execute`/`publish=true`.

**Grading & delivery (deliberately separate):**

| Workflow | File | What it does |
| --- | --- | --- |
| **Grade sweep** | `grade.yml` | Clones each submission at its snapshot commit, grades against the canonical `grader/<id>/`, writes the gradebook (`grades.csv`, `GRADEBOOK.md`, AI notes). **Teacher-side only - never touches student repos.** |
| **Publish grades** | `publish.yml` | The **ONLY** workflow that writes to student repos. Delivers `GRADES.md` + receipts + `FEEDBACK.md` (+ previews) into each workspace, and only for activities flagged `publish:true`. Dry-run unless `publish=true`. |
| **Publish material** | `publish-material.yml` | Copies course `content/` into every workspace repo in the section. No student action; never touches the submission zone. |
| **Publish quiz** | `publish-quiz.yml` | Releases a quiz's published part into student repos; the answer key stays teacher-side. *(Currently ADET-only; quizzes are moving to Canvas, so this is slated to be retired.)* |

**Canvas sync:**

| Workflow | File | What it does |
| --- | --- | --- |
| **Canvas push** | `canvas-push.yml` | Pushes gradebook scores to Canvas via API (honors `locked`, reconciles points). |
| **Canvas export** | `canvas-export.yml` | Emits an offline Canvas-format gradebook CSV (artifact + Step Summary). |

**Maintenance & cleanup** (the roster/repo hygiene that used to be manual):

| Workflow | File | What it does |
| --- | --- | --- |
| **Audit repo names** | `audit-names.yml` | Flags student/teacher repos whose names break the `<role>-<subject>-<class>-<handle>` convention (wrong section, swapped/typo'd codes, bad casing), and warns on blank `student.json`. Weekly + manual. |
| **Provision workspaces** | `provision-workspaces.yml` | Reconciles the roster (from the gradebook) against live workspaces: creates a workspace for any student who has activities but none, and fills a blank/missing `student.json` from the student's own submissions. Reports studentNumber collisions; never deletes or renames. Dry-run unless `execute=true`. |
| **Prune gradebook** | `prune-gradebook.yml` | Removes gradebook rows whose submission repo no longer exists (deleted/renamed duplicates), which the grade sweep would otherwise keep forever. Only prunes on a definitive 404. Dry-run unless `execute=true`. |

*(Every teacher repo also carries `models-check.yml`, a `workflow_dispatch`
preflight that verifies GitHub Models works before an AI-feedback grade run.)* Repo **deletes/renames stay manual** - the tools flag them
but never perform them (they need `delete_repo` scope and a human decision).

**Publishing model:** each unit/quiz lives on its **own branch** in the
teacher repo (drafts stay off `main`). Publishing = pick the branch + section.
"Q1 → release to 0000" is the whole mental model.

**Which repos belong to a section:** a workflow lists the org's repos and
**filters by the classCode substring in the repo title, restricted to the
`student-` prefix** (`student-*-0000-*` → that
section). The per-section org **Team** is the equivalent backstop (list the
Team's repos via the API). Title-matching is primary; Teams cover malformed
titles.

**Cross-repo access:** a workflow does **not** run as the instructor - it runs
as automation with its own credential, and the built-in `GITHUB_TOKEN` is scoped
to only the repo it lives in. Being the **org admin does not grant the Action
cross-repo power**; it only means the admin can *create* a credential. For a
**solo instructor-admin**, a **fine-grained Personal Access Token** (scoped to
the org; `contents` + `pull-requests` + `issues` write), stored as an Actions
secret in the teacher repo, is sufficient. A **GitHub App** is optional -
worth it only for multi-maintainer orgs, rotation, and tighter scoping.

---

## 6. Course material flow

- Authored as **Markdown + assets** (images, PDFs, attached files) in
  `content/<unit>/` on a per-unit branch.
- Rendered **natively in the student's repo file view** - no Pages required:
  Markdown renders styled, images embed inline, PDFs open in GitHub's viewer,
  other files download on click.
- **Video:** link to YouTube/Vimeo (committed `.mp4` won't play inline in the
  repo view). Large media → link out or Git LFS rather than committing.
- Publish = "Publish material" workflow → auto-merged PR drops the folder into
  the section. Re-publishing overwrites the folder (PR shows the diff).
- **Optional:** turn on Pages for `content/` for a polished site (and real video
  embeds). Requires a paid plan - see §10.

---

## 6a. Dev environment (Codespaces)

Every activity repo, the student workspace, and both templates ship a
`.devcontainer/` so any repo opens as a ready-to-run cloud dev environment (Node
for 6XXX/6ZZZ, Dart for 6YYY). No local install; students can work fully
in the browser or in VS Code Desktop.

**Billing model (free for the class):** the org's **Codespace ownership** is set
to **User ownership**, so usage bills to each member's personal account, where
their Education 180-core-hour quota applies - the org is never charged. The org's
$0 Codespaces budget is left in place as a backstop. Idle-timeout / stop / delete
guidance lives in each activity README to protect students' hours.

---

## 7. Quiz flow

A quiz lives in the teacher repo, split so the key never reaches students:

```
quizzes/q1/
├── published/              ← released into each student repo's quizzes/q1/
│   ├── README.md           (the questions)
│   ├── answers.json        (blank slots the student fills in)
│   └── student.json        (identity stub; classCode is graded)
└── key/                    ← STAYS in the teacher repo, never published
    ├── answer-key.json
    └── variant-seed.json   (optional, for per-student variants)
```

### Taking a quiz - in the student repo
- At release, `published/` lands in the student's **existing** course repo under
  `quizzes/q1/` - same publish mechanism as course material, **no new repo per
  quiz**.
- The student fills in `quizzes/q1/answers.json` (short answers - one word,
  number, or symbol), commits, and pushes. No issues, no web form, no separate
  clone.
- `classCode` is read from the repo-root `student.json`, so no per-quiz identity
  entry is needed beyond the published stub.
- It is **not** a paced/timed one-at-a-time exam - see §9 and §11.

### Grading & feedback
- Grading runs **in the teacher repo** (canonical logic + keys stay private).
  Triggered by a scheduled sweep (v1, simplest) or an event relay (upgrade).
- The grader reads the student's `answers.json` at the snapshot commit, scores
  against `key/answer-key.json`, verifies `classCode`, records to the gradebook,
  and pushes a receipt into the student's `grades/`.
- **One submission only.** The grader scores the first (earliest pre-deadline)
  pushed `answers.json` and ignores later pushes - quizzes do **not** re-grade on
  a new push the way activities do. With no issue to close, the one-submission
  rule lives entirely in the grader.

### Release timing
- Released at exam start (not in student repos before that; the key is never
  anywhere students can read).
- **Deadline snapshot:** grade the earliest submission commit at or *before* the
  deadline timestamp. Enforces a total window via commit timestamps (which
  students cannot fake) without needing real-time proctoring.

### Per-student variants - a dial
- **v1 (start here):** same questions for all; option order shuffled per student
  off their student number. Cheap; combined with the deadline snapshot + viva,
  enough for low-stakes quizzes.
- **v2 (later):** genuinely different question subsets per student seeded from
  `student.json` identity, so a copied answer set is worthless. Add only if
  cheating proves to be a real problem.

---

## 8. Grading model & receipts

- **Off-repo canonical grading.** The teacher repo checks out the student's
  submission at the snapshot commit and runs the canonical tests/key on its own
  side. Editing tests/workflows in the student repo changes nothing.
- **Incremental & idempotent, keyed on the submission commit SHA.** Each run
  skips repos whose latest graded commit is unchanged and grades only new/changed
  submissions, so the sweep can be run **anytime, as often as wanted** - it only
  does new work, and an interrupted run resumes on the next run. A **`force`**
  input re-grades everyone (use after changing a key/test). Per-assignment
  policy: activities re-grade on a new push; quizzes lock after the first graded
  submission (one-submission policy).
- **Existing activities fold in untouched.** The current per-activity repos
  (`m1a1…m1a4`) keep working; the sweep grades them off-repo using canonical
  tests kept in `grader/`. Their in-repo autograde workflow can remain for
  instant student feedback - it is just no longer the source of truth.
- **Receipts (a student-facing record, not the authority):** the sweep writes
  into each student repo:
  - `grades/<assignment>.json` -
    `{ assignment, gradedCommit, submittedAt, gradedAt, score }`
  - `GRADES.md` - a human-readable table with the **commit linked** to its
    GitHub commit page.
- Receipts are a plain display copy. They are **not** the authority and are not
  signed: the gradebook in the teacher repo is the source of truth, and nothing
  is ever read back from a student repo, so a student editing their own receipt
  changes nothing official.

---

## 9. Anti-cheat posture (honest)

Client-side lockdown on a student's own machine is a nudge, not a lock - they
control the runtime, can read bundled questions, disable timers/handlers, or skip
any app entirely and hand-write the submission the grader reads. So integrity
comes from mechanisms students can't control:

- **Per-student variants** (copied answers are useless).
- **Deadline snapshot** via commit/issue timestamps (un-fakeable total window).
- **Commit-history / timing signals** (organic work vs single paste).
- **Viva spot-checks** on a random sample (kills hired-gun cheating cohort-wide).
- **Private repos** so students can't browse each other's work.

Non-goals: real-time proctoring, per-question enforced timers, preventing a
second device. Anything high-stakes (midterm) is in-person or on a proctored/
server-enforced path, not pure GitHub.

---

## 10. Dependencies & constraints

- **Free org is enough for the core system.** Unlimited **private repos** and a
  monthly **Actions** quota (~2,000 min) come free - so student privacy and
  grading need no paid plan. Course material renders in the **native repo file
  view**, so **Pages is not required**.
- **Enrolled in GitHub Education** (verified teacher). What this changes:
  - **Pages on private repos** is now available (Team) - optional; the native
    file view still works without it.
  - **GitHub Codespaces** is available: every member gets a personal allowance
    (180 core-hours + 20 GB/month). See §6a for how the class uses it for free.
  - **GitHub Classroom is *not* used** - it is being retired Aug 28, 2026, and
    its class Codespaces allowance with it. Provisioning stays **hand-rolled**
    via a workflow (repo-from-template + Team assignment).
- **Cross-repo credential required.** A **fine-grained PAT** (org-scoped;
  `contents` + `pull-requests` + `issues` write) stored as an Actions secret is
  sufficient for a solo admin; the built-in `GITHUB_TOKEN` is repo-scoped only,
  and org-admin status does not change that. A GitHub App is optional.
- **Actions minutes** draw from the monthly private-repo quota. Prefer one
  efficient sweep over many tiny runs. (Pricing is changing March 2026.)
- **Static Pages can't write.** A write-capable web quiz UI would need a server;
  quizzes sidestep this entirely - students answer by editing `answers.json` in
  their repo, so there is nothing to host. This is the one thing pure GitHub
  cannot do.

---

## 11. Known limitations / non-goals

- No proctoring, no enforced per-question timing, no prevention of a second
  device - inherent to async take-home over GitHub.
- Quizzes are answered by editing `answers.json` (short word / number / symbol
  answers); not paced one-at-a-time and no rich question UI.
- Onboarding friction: students need GitHub accounts, must accept repo invites,
  and need minimal git literacy (clone/edit/commit/push) for both activities and
  quizzes. Budget a "module 0".

---

## 12. Build roadmap

| Step | Deliverable |
| --- | --- |
| **0 - Prereqs** | ✅ Enrolled in GitHub Education (free Team); Codespaces enabled with **User ownership**; confirm Teams per section. (Org GitHub App optional - a fine-grained PAT suffices for a solo admin.) |
| **1 - Management skeleton + Publish material** | roster format, App auth, publish-by-branch-to-section workflow; verify against the sample-student repo. |
| **2 - Grading + gradebook** | off-repo canonical grading; fold in existing `m1a1…m1a4`; commit-linked receipts; central `GRADEBOOK.md`. |
| **3 - Quizzes** | `answers.json` template in the student repo + parse-and-grade workflow + one-submission lock; private keys + v1 variants; release workflow. |
| **4 - Canvas export** | gradebook → Canvas-format CSV; `student.json` ↔ roster reconciliation. |
| **5 - Student workspace + display** | seed `notes/journal/project` templates; optional read-only Pages for materials/scores. |

---

## 13. Conventions

- **Commits use gitmoji** (prefix the subject with a gitmoji).
- **No AI attribution** in commits (no AI co-author trailers) across the class
  orgs / templates.
- **Activities encourage self-research** - stubs name the concept to research
  and never hand over the answer code.
- **`classCode` is graded** - every activity/quiz verifies `student.json`'s
  `classCode`.
- **Every repo ships a `.devcontainer/`** for zero-setup Codespaces (Node for
  6XXX/6ZZZ, Dart for 6YYY).

---

## 14. Open implementation decisions

1. **Grading trigger:** scheduled sweep (v1, simplest) vs event-driven (lower
   latency, more setup). Default: sweep.
2. **Provisioning:** **students self-provision** from the student template into
   the course org; the **instructor adds them to the org + a per-section Team**.
   Mapping is by **repo title + `student.json`** (no separate registry).
   (GitHub Classroom is unavailable - not enrolled in Education.)
3. **student template visibility:** public template (easy sharing, no secrets)
   with private instances. Default: public template.
