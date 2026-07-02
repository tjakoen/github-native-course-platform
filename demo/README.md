# Demo output (synthetic)

Everything in this folder is **fabricated sample data** — every "student" is a
famous computing figure, every number/email/commit is made up. It exists so you
can see what the system *produces* without any real student data.

| File | What it shows |
| --- | --- |
| `gradebook/grades.csv` | The machine record the grade sweep writes (one row per repo + assignment). This is what the Canvas export pivots into an import CSV. |
| `gradebook/GRADEBOOK.md` | The human-readable gradebook rendered in the teacher repo. |
| `gradebook/notes/m2a1/ghopper.md` | An **instructor-only** AI note: a proposed grade plus an authenticity ("vibe-code") signal. This never leaves the teacher repo. |
| `student-repo/GRADES.md` | A **receipt** delivered into a student's workspace — display-only, with the graded commit linked. |
| `student-repo/FEEDBACK.md` | The **student-facing** feedback: prose only, no scores, no mention of AI. It reads as the instructor's own notes. |

The split between the last two files is the whole point of the held-for-review
model: the scores and authenticity flags stay with the instructor; the student
sees only reviewed, encouraging prose.
