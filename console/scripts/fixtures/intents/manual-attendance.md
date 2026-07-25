# Manual attendance - 6DEMO (section 0000) - 2026-01-14

You are my course assistant for the HAU platform. Record teacher-attested manual attendance for this section. Work from the teacher repo:
classes/teacher-6demo-0000-tjakoen (the local clone of github.com/HAU-6DEMO/teacher-6demo-0000-tjakoen) - pull it first.

## Rules (do not violate)
- Attendance session CSVs (attendance/sessions/<date>/*.csv) are the record; never edit the generated .md/summary.json by hand (verify-attendance rebuilds them).
- Manual rows use the literal word manual in the signature column - verify-attendance counts them as present (MANUAL). Never fabricate a real HMAC signature.
- MERGE, never overwrite: union by studentNumber; keep every existing row and timestamp.

## Mark these students present on 2026-01-14
- 20260003 (Reyes, Pedro)
- 20260002 (Santos, Maria)

## Steps
1. In attendance/sessions/2026-01-14/manual.csv (create the folder/file if needed, header timestamp,studentNumber,signature), append one row per listed student NOT already in any of that date's CSVs: "2026-01-14 00:00:00,<studentNumber>,manual".
2. Commit as ":memo: Manual attendance 2026-01-14 (2)" and push.
3. The push triggers the Verify attendance workflow (rebuilds the day summary, ATTENDANCE.md, summary.json; publish-attendance then delivers receipts automatically). Wait for it and confirm it is green.
4. VERIFY: the listed students show as MANUAL in attendance/sessions/2026-01-14/2026-01-14.md and appear with 2026-01-14 in attendance/summary.json. Nothing may be FLAGGED by this change.
