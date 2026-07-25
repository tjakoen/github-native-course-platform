# Generate AI feedback drafts - 6DEMO (section 0000) - m3a1

The grade sweep wrote a per-submission input file to gradebook/notes-input/m3a1/ for each submission that opted in. Turn each into a reviewable note draft I can check in this dashboard. Work from: classes/teacher-6demo-0000-tjakoen (the local clone of github.com/HAU-6DEMO/teacher-6demo-0000-tjakoen) - pull it first.

## What to do
For EVERY gradebook/notes-input/m3a1/<repo>.md that does NOT already have a matching gradebook/notes/m3a1/<repo>.md:
  1. Read the input file. It embeds the persona, the hard rules, the class context, the rubric, the automated result, the student source, and the exact output format.
  2. If it lists screenshots, open those image files (gradebook/notes-input/m3a1/<repo>.shots/...) to judge the design.
  3. Write gradebook/notes/m3a1/<repo>.md following that file's skeleton and output format EXACTLY: the student-facing prose half (no scores, no rubric, no "AI" mention), then a line with only ---, then "**For the instructor (not shown to the student):**", then the rubric breakdown, a "Proposed total: N/100" line, and the "AI-authored likelihood" line.

## Rules (do not violate)
- This step DRAFTS notes only. Do NOT write grades.csv, do NOT flip "publish": true, do NOT publish to students, do NOT push Canvas.
- SKIP any repo that already has a note in gradebook/notes/m3a1/ - never overwrite a draft I may have edited.
- The student-facing half must never mention "AI", scores, points, or the rubric; the likelihood/vibecode line stays in the instructor half only.
- Only process repos that have an input file; do not invent submissions.

When done, COMMIT AND PUSH the new notes to the teacher repo. The hosted dashboard reads the repo live - I'll hit Refresh, review each draft and its proposed score, then Approve/Override/Flag there.
