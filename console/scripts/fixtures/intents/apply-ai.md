# Apply reviewed AI grades - 6DEMO (section 0000) - m3a1

I have reviewed the held AI grades for m3a1. Apply my decisions below. Work from: classes/teacher-6demo-0000-tjakoen (the local clone of github.com/HAU-6DEMO/teacher-6demo-0000-tjakoen) - pull it first.

## Reviewed decisions (final score / 100)
  - Dela Cruz, Juan (20260001) · m3a1-0000-juandc: 92/100  [approved; edited student feedback] - note: solid work
  - Santos, Maria (20260002) · m3a1-0000-msantos: 65/100  [OVERRIDE - was 71; edited instructor note]

## Edited feedback to write (use this EXACT text, verbatim)
### m3a1-0000-juandc  (final 92/100)
STUDENT-FACING - replace the prose half of gradebook/notes/m3a1/m3a1-0000-juandc.md (between the italic disclaimer line and the '---' instructor separator):
<<<
Great structure. Tighten the naming.
>>>

### m3a1-0000-msantos  (final 65/100)
INSTRUCTOR-ONLY - replace the instructor half (everything after the '---'):
<<<
Rubric row 3 was over-credited; adjusted.
>>>

## Flagged for deeper review - do NOT apply, publish, or push; re-examine and report back to me
For each student below, do a thorough second pass on m3a1:
  1. Read the current assessment in gradebook/notes/m3a1/<repo>.md and the rubric in grader/m3a1/RUBRIC.md (plus grader/class-prompt.md).
  2. Clone the submission repo at its graded SHA and read the ACTUAL code; if it is a design activity, open its screenshots (gradebook/previews/m3a1/<repo>/ or the previews branch).
  3. Produce a fresh per-criterion breakdown, a revised proposed score out of 100, and a revised student-facing feedback draft, explicitly addressing my flag note. Call out anything that looks off (over/under-scored, mismatch with the code, possible integrity issue).
  4. Present it all to me in chat for a decision. Do NOT write grades.csv, notes, publish, or push Canvas for these students.

  - Reyes, Pedro (20260003) · m3a1-0000-preyes @cccc333 · current proposed 85/100 · AI-likelihood High - my note: code does not match the commit history

## Not yet reviewed (1) - do NOT apply

## Steps
1. For each OVERRIDE student, set gradebook/grades.csv aiScore to the final score I gave (do not touch the objective test score column). Approved students keep the AI's proposed aiScore.
2. For every FLAGGED or NOT-YET-REVIEWED student on m3a1, BLANK their aiScore cell in gradebook/grades.csv. A blank aiScore holds a student out of the Canvas push (canvas-push skips it) and marks them not-cleared for delivery.
3. For every student under "Edited feedback to write", overwrite gradebook/notes/m3a1/<repo>.md with my exact text: replace the student-facing prose half and/or the instructor half as labelled, keeping the title line and the italic disclaimer line intact. For OVERRIDE students with no edited instructor text, still update the instructor note's proposed total to match my score, adjust the per-criterion bullets to sum to it, and record the human-review note on the proposed-total line (so it stays out of the Canvas comment).
4. Verify the gradebook: overrides show my score, flagged/unreviewed aiScore are blank, approved are unchanged. Commit and push - the hosted dashboard reads the repo live; I'll refresh to review the applied grades before delivery.

Do NOT publish or push Canvas from this prompt, and do NOT flip "publish": true. This prompt writes grades only. Delivery (flip publish:true, publish to students, push Canvas, verify) is the separate Finalize step (the Finalize button emits that prompt), gated on my go. The student-facing FEEDBACK.md and the Canvas comment must stay free of any "AI" mention and of the instructor-only likelihood/vibecode line. The <<< >>> markers are delimiters only - do not include them in the files.
