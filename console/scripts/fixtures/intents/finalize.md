# Finalize and deliver - 6DEMO (section 0000) - m3a1

The reviewed grades for m3a1 are already written to the gradebook (approved + overrides applied; held/flagged aiScore blanked). Now deliver ONLY the cleared students to their workspaces and to Canvas. Work from: classes/teacher-6demo-0000-tjakoen (the local clone of github.com/HAU-6DEMO/teacher-6demo-0000-tjakoen) - pull it first.

## Cleared to deliver (2)
  - m3a1-0000-juandc: 92/100
  - m3a1-0000-msantos: 65/100

## Held OUT - do NOT deliver (2)
  - m3a1-0000-preyes (flagged)
  - m3a1-0000-agarcia (not reviewed)

## Rules (do not violate)
- Dry-run first for BOTH publish and Canvas; execute only on my explicit "go".
- Student FEEDBACK.md and the Canvas comment carry NO scores-as-AI, no "AI" mention, and never the instructor-only likelihood/vibecode line.
- publish-grades.mjs gates on aiScore: a blank aiScore holds a student out of BOTH the student publish and the Canvas push, so a single publish only=m3a1 delivers exactly the cleared students above (held/flagged students, with blank aiScore, are skipped automatically).

## Steps
1. Flip "publish": true on m3a1 in grader/assignments.json (the readiness gate; nothing delivers yet).
2. Student publish (publish.yml), DRY RUN (publish=false), restricted to the cleared repos. Show me the plan; confirm it lists exactly the cleared repos above and no held student.
3. On my "go": run publish for real (publish=true) for the cleared repos only.
4. Canvas push in CHECK mode for m3a1 (tools/canvas-push.mjs --section=0000 --check). Show the report; confirm every cleared student maps and no held student appears (held students have blank aiScore and are skipped).
5. On my "go": canvas-push --execute. Each cleared student gets their final score PLUS a rubric-breakdown comment (per-criterion points + feedback prose).
6. VERIFY: each cleared student received FEEDBACK.md/GRADES.md and the correct Canvas grade + comment (spot-check 2-3), and NO held/flagged student got anything.
