# Deliver reviewed grades - 6xxx (section 0000) - deterministic activities

These are the section's DETERMINISTIC activities (auto-graded tests + quizzes). Their gradebook scores are final - no AI review needed. Deliver them to student workspaces (the "publish": true ones) and to Canvas. Work from: classes/teacher-6xxx-0000-tjakoen (the local clone of github.com/COURSE-ORG-DEMO/teacher-6xxx-0000-tjakoen) - pull it first.

## Push to Canvas - deterministic activities with graded students (2)
  - m1a1: 7 pts, 2 students graded
  - q1: 10 pts, 1 students graded

## Publish to student workspaces (only activities flagged "publish": true)
  - m1a1

## Excluded on purpose - do NOT deliver from this prompt
- AI-graded / held (review in the AI Review tab, then use its Finalize button): m3a1
- Manual (entered in Canvas by hand): m6a3

## Rules (do not violate)
- gradebook/grades.csv is the source of truth. Never hand-edit a grade.
- Dry-run BOTH the student publish and the Canvas push first; execute either only on my explicit "go".
- Student FEEDBACK.md/GRADES.md and any Canvas comment carry NO "AI" mention.
- Touch ONLY the deterministic activities above. The AI/held activities flow through the separate AI Review -> Finalize path; do not publish or push them here.

## Steps
1. Re-run a grade sweep only if submissions changed since 1/15/2026; otherwise use the current gradebook.
2. Student publish - DRY RUN first: publish.yml (publish=false), or tools/publish-grades.mjs 0000 (dry-run by default). publish only ever delivers "publish": true activities, and it skips any AI student whose aiScore is blank - so this delivers exactly the deterministic publish:true activities above (plus any already-cleared AI students, which is fine). Show me the plan; confirm it lists those activities and their graded workspaces.
3. On my "go": run the student publish for real (publish=true / --execute).
4. Canvas push in CHECK mode: tools/canvas-push.mjs --section=0000 --check. Show the report: # grades, # students matched, per-activity counts, and ANY unmatched students or points-possible mismatches. Confirm it matches the Canvas preview above and that NO held or manual activity appears (canvas-push holds AI activities and skips manual automatically).
5. On my "go": re-run with --execute.
6. VERIFY: pushed count == matched students x pushed activities; spot-check 2-3 students' Canvas values and their delivered GRADES.md/FEEDBACK.md against gradebook/grades.csv; confirm no held or manual activity was delivered.
