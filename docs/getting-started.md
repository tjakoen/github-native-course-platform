# Getting started

The one-time setup for a new course, in order. When you finish, you have a locked
down course org, a teacher control center that can reach student repos, and
students who each own one correctly named workspace. Student repos need nothing
but a filled-in `student.json`.

This is the settings reference. For the chronological "run it in a real class and
prove each step works" story, read [Running a course](running-a-course.md).

Naming everywhere uses **literal lowercase values, no angle brackets**:
`teacher-6xxx-0000-instructor`, `student-6xxx-0000-juandelacruz`.

## Prerequisites

- **A GitHub organization** for the course. One org per course keeps access,
  Teams, and repo names clean.
- **GitHub Education** on your account and the org. This makes student Codespaces
  free (each student's own quota) and unlocks the education tooling. Apply early;
  verification can take a few days.
- Optionally, **an AI coding assistant** that can run shell commands and `gh`,
  authenticated as an org-admin account. Much of the work below can be driven in
  plain language. See [Operating with an AI assistant](operating-with-ai.md).

This platform deliberately does **not** depend on GitHub Classroom. Everything
runs on plain org repos plus GitHub Actions.

## 1. Create the teacher repo in the course org

1. On the **teacher template** repo, click **Use this template - Create a new
   repository**.
2. **Owner:** the **course org**, not your personal account. This is required, or
   the workflows cannot reach the student repos and nothing works.
3. **Name:** `teacher-<subjectcode>-<classcode>-<name>` with real values, for
   example `teacher-6xxx-0000-instructor`.
4. **Visibility:** Private.

The org is now the `repository_owner` the workflows act on automatically.

## 2. Configure `course.config.json`

Set this file for the class: the org(s), the `teachers` accounts (used by the
access audit), and the workspace-template owner. Nothing class-specific is
hardcoded in the tooling; it reads from this file, and workflow env overrides it.
See [Reference](reference.md) for the full config surface.

## 3. Add the cross-repo token (`ORG_PAT`)

Workflows act on *other* repos, so the built-in `GITHUB_TOKEN` (this repo only) is
not enough. Org-admin status does **not** give a workflow cross-repo access; this
token does.

1. **github.com - Settings - Developer settings - Personal access tokens -
   Fine-grained tokens - Generate new token.**
2. **Resource owner:** the course org.
3. **Repository access:** All repositories (or all `student-*` repos).
4. **Repository permissions:** Contents: Read and write; Pull requests: Read and
   write; Issues: Read and write.
5. Generate and copy the token.
6. In **this repo - Settings - Secrets and variables - Actions - New repository
   secret**, name it **`ORG_PAT`** and paste the token.

Add the other secrets when you need them: `CANVAS_TOKEN` and `CANVAS_BASE_URL`
for grade sync. AI feedback needs no secret (notes are drafted in a Claude Code
session via the grader-ui prompt). None are needed to prove the core loop.

## 4. Lock down the org

Goal: students can create their own repos in the org but cannot see anyone else's.

1. **Base permission = none.** Org - Settings - Member privileges - Base
   permissions - **No permission**. This makes the org private-by-default: a
   member sees only repos they were explicitly added to.
2. **Allow members to create private repos.** Same page - Repository creation -
   enable **Private**. Students need this to create their workspace into the org.

## 5. Enable Codespaces for the class (free via Education)

So students get a zero-setup dev environment without the org being billed:

1. **Org - Settings - Codespaces - enable for members** (all members, or the
   section Teams).
2. **Org - Settings - Codespaces - Codespace ownership - User ownership - Save.**
   This bills Codespaces to each student's personal account, where their GitHub
   Education quota applies. The org is never charged.
3. **Leave the org's $0 Codespaces budget in place** as a backstop. With User
   ownership it will not block anyone.

Every activity repo and the student workspace already include a `.devcontainer/`,
so "Create codespace on main" just works.

## 6. Create a Team per section and add students

1. **Org - Teams - New team**, named after the section, for example `0000`
   (matching the class code in repo titles).
2. As students accept their org invite, add them: **Team - Add a member.**
3. Keep one Team per section. This is your access-control and grouping; the class
   code in repo titles is what the workflows filter on, and the Team is the
   backstop.

Invite students to the org first (Org - People - Invite member). They must accept
before they can create a repo in the org.

## 7. Onboard students

Give students these instructions (paste into your LMS or first lesson).

> **Before you paste:** replace the course org, subjectcode, and classcode below
> with your class's real values, and update the example name to match. If you
> leave the placeholders, students copy the wrong values and their repos end up
> misnamed. The repo-name audit catches this after the fact, but filling in real
> values here prevents it.

> **Set up your course workspace**
> 1. Accept the email invite to the **course org**.
> 2. Go to the **student template** repo - **Use this template - Create a new
>    repository**.
> 3. **Owner:** select the **course org**, not your personal account. (Accept your
>    org invite first so the org appears in the Owner list.)
> 4. **Name it exactly** - copy the prefix verbatim, then add only your username:
>    `student-<subjectcode>-<classcode>-<your-github-username>`. The prefix is
>    fixed for your class; replace only your username. All lowercase, no spaces, no
>    angle brackets.
> 5. **Visibility:** Private.
> 6. Open **`student.json`** and fill in every field. Your **classCode** is the
>    number in your repo name. Use your real student number and school email; that
>    is how your work is matched to the class roster.
> 7. Edit files in the browser (press `.` in the repo to open the web editor) or
>    `git clone` your repo to work locally.

Tell students that filling in `student.json` is a per-repo, every-time habit:
every activity submission repo they create later starts with a blank one. See the
[Student guide](student-guide.md) for the full student view.

## 8. Publish the first course material

1. Put a unit's Markdown (plus images or PDFs) under `content/<unit>/` on the
   default branch.
2. **Actions tab - Publish material - Run workflow**, and enter the unit folder
   name (for example `m1-intro`).
3. It opens an auto-merged PR adding `content/<unit>/` into every `student-` repo
   in that section. Re-running with the same unit just updates the folder.

Your teacher repo is never a target: publishing matches the `student-` prefix
only.

## Optional: attendance QR scanning

Paperless attendance runs on the same repo. Two credentials, not to be confused:

- **`ATTENDANCE_HMAC_SECRET`** - a repo secret (any random string, e.g.
  `openssl rand -hex 32`). GitHub Actions uses it automatically to sign and
  verify QRs; you never type it anywhere else.
- **A fine-grained PAT** (Contents: read + write on this teacher repo) - you paste
  this into the scanner page once; it is what actually records attendance, so
  only you hold it.

The `Deploy attendance scanner` workflow enables Pages itself and serves only
`scanner.html` (never the gradebook). Full walkthrough: [Attendance](attendance.md).

## Later, when you have real students

- **Canvas roster:** export the section's gradebook CSV from Canvas and drop it in
  as `roster/<classCode>.csv`. It is used to map students and produce the import
  CSV. See [LMS and Canvas](lms-canvas.md).
- **Quizzes and grading:** covered in [Authoring activities](authoring-activities.md)
  and [Grading and feedback](grading-and-feedback.md).

Next: walk the whole lifecycle with a proof at each phase in [Running a
course](running-a-course.md).
