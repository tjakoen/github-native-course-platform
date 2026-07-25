# Grading guide: how the AI should grade for these courses

This is the standing brief for any AI that grades or reviews grades in this
platform. It captures two things:

1. **Fairness method** the AI must follow every time it assigns or revises a
   design or code score (chiefly: weigh sibling submissions, do not grade in a
   vacuum).
2. **A calibration ledger** of what the instructor actually wants, learned from
   each round of reviewed grades. This grows over time. Whenever the instructor
   makes an adjustment (an override, a "too high / too low", a "reward this"),
   add the lesson here so the next round starts closer to his taste.

It is consumed in two places, and both must stay in sync with it:

- The initial grade sweep's AI feedback (grounded in each activity's
  `RUBRIC.md` plus `grader/class-prompt.md`). When a lesson here is general, fold
  it into that class prompt so the first pass is already fairer.
- The reviewed-grade application flow (the `apply-reviewed-grades` skill), which
  applies the instructor's decisions and does the deep second pass on flagged
  students.

No student PII in this file. It is committed. Refer to activities by id and to
lessons in the abstract, never by student name, number, or email.

## The core problem this fixes

The first-pass AI compresses almost everyone into a narrow high band (mid 80s to
mid 90s) regardless of real quality gaps, and now and then it over-penalizes one
rubric miss. The instructor's corrections are overwhelmingly "spread these out":
mark plain or minimal work down, push genuinely polished work up, and do not let
a single automated deduction tank an otherwise solid submission. The fix is
relative, sibling-aware grading with an honest spread.

## Fairness method (do this every time)

1. **Load the whole cohort for the activity before scoring any single one.**
   Read every sibling submission for the same activity id and section (the
   gradebook rows, the notes, the screenshots or previews, and the code). Never
   score one submission in isolation.
2. **Rank before you number.** Order the submissions from weakest to strongest
   on the rubric's design and code criteria. Assign points to the ranking, then
   sanity-check each number against its neighbours.
3. **Enforce monotonicity.** A submission that is clearly better than another on
   every criterion must not score lower or equal. If the numbers invert the
   ranking, the numbers are wrong.
4. **Use the full range.** If real quality differs, the scores must differ.
   Resist clustering everyone at 88 to 93. Reserve the top of the band for work
   that is genuinely polished and complete, not merely passing.
5. **Grade what is actually there.** Open the screenshots and read the code at
   the graded SHA. If there is little or no UI, the design half cannot earn high
   marks no matter how clean the code reads. If a preview is blank, find out
   whether the app crashed or the render failed before trusting a low score.
6. **Automated vs design are separate.** The objective test score column is the
   tests; never move it by hand. The reviewed 0 to 100 lives in `aiScore`. A
   single failed automated check should not collapse the design judgement.
7. **Keep the review wall.** Student-facing prose and the Canvas comment carry no
   scores-as-AI language, no mention of AI, and never the instructor-only
   likelihood or vibecode line. That half stays in `gradebook/notes/` only.

## Calibration ledger (append every round)

Each entry is a durable lesson, not a one-off. Newest rounds at the top.

### m3a3 (6APSI section 2240) - proctored quiz, design half

- **A blank preview is not proof of zero design.** For an activity with a real
  automated suite, read the tests and the code before trusting a blank
  screenshot. All-tests-passing plus a blank render is a boot or render failure,
  not absent work. Real causes seen this round: an empty entry file
  (`src/main.jsx`) so nothing mounts, and a CSS-module import whose filename or
  casing does not match the file (fails on the case-sensitive Linux runner).
  Assess design from the code, and treat the render bug as a finish/UX deduction,
  not a wipeout.
- **The automated score is a hard floor; design only adds.** Compute
  automated = round(automated_points x pass-ratio) and never let the reviewed
  total land below it. The first pass twice scored a submission below its own
  automated floor (a 53/55 given 54; a 20/47 given 14). When you see a reviewed
  number under the floor, it is wrong low: correct up to floor plus whatever
  design is actually there.
- **All tests passing plus default-browser HTML is still a low design half.**
  Full automated credit with unstyled or near-default styling lands at roughly
  automated + low-single-digit design (about 74 on a 100-point quiz), not the
  90s. "No design at all", "No css", and "too high" corrections all pointed the
  same way: do not reward a passing test suite as if it were a finished UI.
- **A themed look with one obvious rough edge is high-80s, not 100.** For
  example a coherent palette undercut by stark unstyled inputs. Reserve the mid-
  to-high 90s for genuinely polished, consistent systems (a dashboard layout, a
  distinctive minimalist aesthetic), and give strong but unscored designs a real
  number instead of leaving them blank.
- **Incomplete or crashing apps sit near their automated floor, but the feedback
  stays constructive and the number stays honest.** An app that returns null or
  crashes on a router typo scores low correctly; do not inflate it (an 18 for a
  3/58 crashing app was too high). Name the specific crash or omission so the
  student knows the next concrete step.

### m3a2 (6APSI section 2240) - portfolio, second reviewed round

- **Low outliers on an otherwise-passing submission are usually first-pass
  mis-scores, not weak work.** Two of this round's flags were badly under-scored
  by the sweep: a complete, polished multi-section page scored 50 and a clean,
  personable tabbed hero scored 77, both while passing 9/9 automated. Always open
  the rendered page for any design score that sits well below its neighbours
  before trusting it; the number is often the AI mis-reading a full page.
- **Push genuinely unique work into the 93 to 100 band.** A distinctive point of
  view (custom display type, texture, deliberate layout personality, real project
  imagery) is the strongest signal that a portfolio belongs at the top, above the
  merely clean-and-correct. Reward identity, not just tidiness.
- **Plain or generic work belongs in the high-70s to mid-80s, clearly below the
  polished cohort.** Near-default styling, system fonts, plain cards, and
  text-only project lists with thin content should not cluster at 88 to 92 with
  the crafted submissions. "Clean but simple compared to peers" is a markdown, not
  a 92.
- **Check the mobile (375px) screenshot, not just desktop.** Real overflow or
  overlap bugs at phone width (clipped hero text, headings colliding with body
  copy, links running off-screen) should dock Responsive quality even when the
  desktop view looks finished.
- **Let Completeness / UX actually vary.** Reserve the full 7 for pages with real
  content and imagery; dock hard (around 3/7) for sparse, text-only pages. It is
  one of the best levers for separating thin work from finished work.
- **When re-summing criteria for a reviewed score, move only the design half.**
  The automated 50 comes from the tests and stays fixed; adjust the design
  criteria so the bullets sum to the final grade (the Canvas comment shows them).

### m3a1 (6APSI section 2240) - first reviewed round

- **The first pass over-scored simple and minimal designs.** Many "too high for
  a simple design / no UI / too simple" corrections. Calibrate plain or minimal
  design work downward and keep the high band for genuinely polished work.
- **Reward real, consistent design upward.** Work with a coherent, consistent
  visual system deserves to sit above the plain submissions, not beside them.
- **Do not let one automated miss over-penalize.** A styling-approach fail that
  dragged a score into the low 50s was judged too harsh; the design work still
  counts.
- **When there is no meaningful UI, cap the design half and judge on the code.**
  Do not award design polish points to a project that has no polished surface.
- **Reward style effort explicitly** when the instructor calls it out.
- **Trust the instructor's holistic "vibe."** When he says a submission is
  perfect, it is 100, even if the AI's criterion sum came out lower. His
  judgement is the ground truth; the rubric sum is the AI's estimate of it.
- **Verify blank or missing previews before trusting a low score.** A missing
  screenshot can mean a failed render, not a bad submission.

## How to add a lesson

When the instructor reviews a round, read every override and every flag note,
generalize each into a durable rule (not a per-student note), and append it under
a new dated round heading here. If the lesson is broad enough to help the first
pass, also reflect it into `grader/class-prompt.md` in the teacher repos so the
sweep starts fairer next time.
