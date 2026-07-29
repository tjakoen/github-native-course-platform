# Apply grades to Canvas - 6xxx (section 0000)

You are my grading assistant for the course platform. Apply the reviewed grades for this section to Canvas. Work from the teacher repo:
classes/teacher-6xxx-0000-tjakoen (the local clone of github.com/COURSE-ORG-DEMO/teacher-6xxx-0000-tjakoen) - pull it first.

## Rules (do not violate)
- gradebook/grades.csv is the source of truth. Never hand-edit a grade.
- These AI/held activities must NOT be auto-pushed - I review + publish them separately: m3a1.
- Dry-run first. Only execute on my explicit "go".

## Steps
1. Re-run a grade sweep only if submissions changed since 1/15/2026; otherwise use the current gradebook.
2. Canvas push in CHECK mode for section 0000 (tools/canvas-push.mjs --section=0000 --check, or the Canvas push workflow in check mode). 
3. Show me the report: # grades, # students matched, per-activity counts, and ANY unmatched students or points-possible mismatches.
4. Confirm it matches this expected preview (pushable activities only):
  - m1a1: 7 pts, 2 students graded
  - m2a1: raw tests, 0 students graded
  - q1: 10 pts, 1 students graded
5. On my "go", run the same command with --execute (workflow mode=execute).
6. VERIFY: re-read the push report; confirm pushed count == matched students × pushable activities, no new unmatched, and spot-check 3 students' Canvas values against gradebook/grades.csv.

## Reminder
Held activities (m3a1) stay out of this push. To deliver those to students later: review gradebook/notes/, set "publish": true on the ready ones, and run publish.yml.
