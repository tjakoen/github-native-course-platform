# Grader

Canonical tests + grade logic. **Grading runs here, off the student repo:**
`tools/grade-sweep.mjs` clones each student submission, grades it against the
canonical tests/keys kept here (so a student editing their own tests changes
nothing), records the score in `gradebook/`, and pushes a receipt into the
student repo.

## How to set up an assignment

Edit [`assignments.json`](assignments.json). Each entry:

```jsonc
{ "id": "m1a1", "type": "vitest", "namePrefix": "m1a1-" }   // code activity
{ "id": "q1", "type": "quiz", "namePrefix": "q1-", "key": "grader/q1/key.json" } // quiz
```

- `id` - the assignment id (also the receipt filename).
- `type` - `vitest` or `dart` (run tests) or `quiz` (match answers to a key).
- `namePrefix` - student repos for this assignment start with this
  (e.g. `m1a1-` matches `m1a1-<classcode>-<student>`).
- `key` (quiz only) - path to the answer key here.

**For a `vitest` assignment:** put the canonical test files under
`grader/<id>/` mirroring the repo layout (e.g. `grader/m1a1/hello.test.js`,
`grader/m1a2/test/*.test.js`). The sweep overlays them onto each clone before
running, so the tests cannot be tampered with.

**For a `dart` assignment:** same idea, with the Dart layout - put the canonical
test under `grader/<id>/test/<name>_test.dart`. The sweep overlays it, runs
`dart pub get` + `dart test --reporter json`, and counts passing tests. Requires
Dart (use the `dart-lang/setup-dart` step in Actions, or install the SDK for
local runs).

**For a `quiz` assignment:** put the answer key at `grader/<id>/key.json`
(`{ "q1": "answer", ... }`). The student's `answers.json` is matched against it
(case-insensitive, trimmed).

## Running

```bash
node tools/grade-sweep.mjs <classcode> [--force] [--only=<id>]
```

- Idempotent: skips a repo whose latest non-receipt commit is already graded.
- `--force` re-grades everyone (use after changing a test/key).
- Writes `gradebook/GRADEBOOK.md` + `gradebook/grades.csv` (the source of truth)
  and pushes a receipt (`grades/<id>.json` + `GRADES.md`) into each student repo.
- Runs against your local `gh`/`git` auth. The Actions version wraps this script
  with the `ORG_PAT` secret.
