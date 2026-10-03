---
id: 001-sunset
status: todo
track: lifecycle
depends: []
touches: [README.md, CLAUDE.md, docs, console, plans]
owner: human
---

# Sunset this repository in favor of Course Platform

This platform is being succeeded by [Course Platform](https://github.com/tjakoen/course-platform), which carries the same ideas (Canvas as the official record, GitHub for the code, held AI review, receipts for every delivered grade) into one app for teachers and students. The decision to archive this repository was made by the instructor on October 3, 2026. This plan prepares that archive so it lands cleanly, without stranding a live class, a student, or a reader who arrives from an old link.

Nothing here happens during a live term. The current classes run on this platform until their grades are final, and Course Console stays the instructor's tool until the new app has graded at least one complete activity end to end.

## Preconditions (all must hold before archiving)

- [ ] Every live section's finals are reviewed, delivered, and confirmed in Canvas, and the term is closed.
- [ ] The instructor has decided which engine runs the next term. If this platform still runs any live class, it is not archived.
- [ ] Course Platform has run one complete activity end to end: package, repository, chosen commit, confirmed Canvas submission, trusted tests and screenshots, review, and a verified Canvas grade.
- [ ] Course Platform is public, or at least has a public page to point readers at. Until then the README notice below would link to a private repository and show readers a 404.
- [ ] The evolution note on the portfolio is published, so the notice can link to the story as well as the code.

## Before the archive

- [ ] Add the README notice below, directly under the badge row, and add an "archived" status badge in place of a live one.
- [ ] Add a closing section to CLAUDE.md saying the repository is archived and where work continues, so a session that lands here cold does not start changing it.
- [ ] Ship any last Course Console fixes first. Archiving freezes the repository, so the Pages deploy can no longer be updated afterwards without unarchiving.
- [ ] Check that the Course Console demo mode still works, since it is the most-linked surface, and confirm whether GitHub Pages keeps serving an archived repository's site. Record the answer here.
- [ ] Decide what happens to the two template repositories used as submodules (teacher-subjectcode-classcode-name and student-subjectcode-classcode-name): archive them with this one, or leave them as templates. Confirm whether an archived repository can still be used as a template before deciding.
- [ ] Decide what happens to the live teacher and student repositories in the course organizations. They hold academic records and student work, so retention follows the university's policy rather than this plan. Archiving this public repository does not touch them.
- [ ] Run the public hygiene check one last time, so the archived copy is clean forever.
- [ ] Close or answer open issues and pull requests with a pointer to Course Platform.
- [ ] Tag the final commit (for example v-final) so the version that ran real classes is easy to cite.

## The archive

- [ ] Archive the repository on GitHub. This is reversible by the owner, but it makes the repository read-only for everyone, so it is a human action, not an automated one.
- [ ] Update the portfolio's project entry to say archived, with links to this repository, Course Platform, and the evolution note.

## README notice (draft, apply only when the preconditions hold)

```markdown
> [!NOTE]
> **This project is archived.** It ran real university courses out of GitHub and its Actions, and it taught me what the next version had to be. Its successor is [Course Platform](https://github.com/tjakoen/course-platform): one app for teachers and students, with Canvas as the official record and GitHub for the code. The story of how one became the other is in [this note](https://tjakoen.github.io/notes/i-said-it-wasnt-a-product). Everything here still works as a reference, and the Course Console demo still runs.
```
