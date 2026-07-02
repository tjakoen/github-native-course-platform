# Rubric template (for AI-graded activities only)

Copy this to `grader/<id>/RUBRIC.md` for each activity that has `"ai-grading":
true`, and place the same file in the activity's template repo (so students see
it and it lands in their submission). Plain activities do NOT get a rubric -
they are judged by the automated tests alone; the rubric exists only where a
deeper look at design/craft is needed.

The AI reads this file to ground its feedback and its proposed score, so keep
the criteria, the point maxima, and the total accurate. The total here must
match the activity's `totalPoints` in `grader/assignments.json` (and Canvas).

---

# Rubric - <id> <short activity name>

This activity is worth **<totalPoints> points**, split into an automated half
and a design half. Show BOTH halves so the rubric is the complete grading
reference (`<objective N>` + `<design M>` = `totalPoints`).

## Automated checks (<objective N> pts, scored from the tests/CI - not by hand)

| Check | Points |
| --- | --- |
| Builds and runs | 0 |
| Uses a real styling approach | 0 |
| Required behavior / structure (the contract) | 0 |
| Responsive (no horizontal scroll at 375px) | 0 |
| **Automated subtotal** | **<objective N>** |

## Design rubric (<design M> pts, scored from the running app, screenshots, and code)

The AI scores ONLY this table (the automated half is scored deterministically by
the tests).

| Criterion | Max | Excellent (full marks) | Satisfactory (~60-80%) | Needs work (~0-40%) |
| --- | --- | --- | --- | --- |
| Visual design & hierarchy | 0 | <what excellent looks like> | <satisfactory> | <needs work> |
| Responsive quality | 0 | ... | ... | ... |
| Consistency / design system | 0 | ... | ... | ... |
| Accessibility | 0 | ... | ... | ... |
| Code organization | 0 | ... | ... | ... |
| Completeness / UX | 0 | <activity-specific finished state> | ... | ... |

Design rubric total: `<design M>` points.

Notes for feedback: name the concept to revisit or ask a guiding question;
never hand over corrected code. Comment on both the code (structure, naming,
organization) and, where the screenshots show a styled page, the visual design.
