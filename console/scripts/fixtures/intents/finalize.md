# Finalize and deliver - 6xxx (section 0000) - m3a1

The reviewed grades for m3a1 are already written to the gradebook (approved + overrides applied; held/flagged aiScore blanked). Now deliver ONLY the cleared students to their workspaces and to Canvas. Work from: classes/teacher-6xxx-0000-tjakoen (the local clone of github.com/COURSE-ORG-DEMO/teacher-6xxx-0000-tjakoen) - pull it first.

## Cleared to deliver (0)
  (none cleared yet)

## Held OUT - do NOT deliver (4)
  - m3a1-0000-juandc (not reviewed)
  - m3a1-0000-msantos (not reviewed)
  - m3a1-0000-preyes (flagged)
  - m3a1-0000-agarcia (not reviewed)

## Rules (do not violate)
- Dry-run first for BOTH publish and Canvas; execute only on my explicit "go".
- Student FEEDBACK.md and the Canvas comment carry NO scores-as-AI, no "AI" mention, and never the instructor-only likelihood/vibecode line.
- publish-grades.mjs gates on aiScore: a blank aiScore holds a student out of BOTH the student publish and the Canvas push, so never scope a real student publish with --only or --repo: it rebuilds each whole GRADES.md. Dry-run the full section, compare every already-delivered row to current gradebook values, and stop if unrelated grades would change.

## Steps
1. Flip "publish": true on m3a1 in grader/assignments.json (the readiness gate; nothing delivers yet).
2. Student publish (publish.yml), DRY RUN (publish=false), for the full section. Show the complete plan and verify this activity reaches only cleared students while existing published activities remain intact.
3. On my "go": run the full-section publish for real (publish=true), with no --only or --repo filter.
4. Canvas push in CHECK mode for m3a1 (tools/canvas-push.mjs --section=0000 --only=m3a1 --check). Show the report; confirm every cleared student maps and no held student appears (held students have blank aiScore and are skipped).
5. On my "go": canvas-push --only=m3a1 --execute. Each cleared student gets their final score PLUS a rubric-breakdown comment (per-criterion points + feedback prose).
6. VERIFY: each cleared student received FEEDBACK.md/GRADES.md and the correct Canvas grade + comment (spot-check 2-3), and NO held/flagged student got anything.
