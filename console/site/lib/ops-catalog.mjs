// Static registry of the teacher-repo workflows the console can run or watch.
// Input shapes verified against the live repos 2026-07-25 (the engine keeps
// these identical across sections). `gate` names the input that flips a run
// from dry-run to a real write - the UI locks it behind a typed confirm.
// `danger` is the confirm phrasing. Workflows with dispatch:false are
// status-only rows (they trigger on push/schedule).
export const OPS = [
  { file: "grade.yml", label: "Grade sweep", group: "Grading",
    desc: "Clone + grade submissions against the canonical tests; writes the gradebook (teacher-side only).",
    inputs: [
      { name: "dry_run", type: "bool", def: "true", gate: true, invert: true, danger: "write the gradebook" },
      { name: "only", type: "string", def: "", hint: "one activity id (e.g. m1a2)" },
      { name: "repo", type: "string", def: "", hint: "one exact repo name" },
      { name: "force", type: "bool", def: "false" },
    ] },
  { file: "publish.yml", label: "Publish grades", group: "Delivery",
    desc: "THE ONLY writer of student repos: delivers GRADES.md + FEEDBACK.md for publish:true activities.",
    inputs: [
      { name: "publish", type: "bool", def: "false", gate: true, danger: "push grades into student repos" },
      { name: "only", type: "string", def: "", hint: "one activity id" },
      { name: "repo", type: "string", def: "", hint: "one source repo" },
    ] },
  { file: "canvas-push.yml", label: "Canvas push", group: "Canvas",
    desc: "Push gradebook scores into Canvas (check -> dry-run -> execute).",
    inputs: [
      { name: "mode", type: "choice", options: ["check", "dry-run", "execute"], def: "dry-run", gate: "execute", danger: "write grades to Canvas" },
      { name: "course_id", type: "string", def: "", hint: "override CANVAS_COURSE_ID" },
      { name: "comment", type: "bool", def: "false" },
    ] },
  { file: "canvas-sync-assignments.yml", label: "Canvas assignment sync", group: "Canvas",
    desc: "Author/update the Canvas assignment shells from grader/assignments.json (SUBMISSIONS module).",
    inputs: [
      { name: "mode", type: "choice", options: ["dry-run", "execute"], def: "dry-run", gate: "execute", danger: "write assignments to Canvas" },
      { name: "only", type: "string", def: "", hint: "one activity id" },
      { name: "desc", type: "bool", def: "false" }, { name: "submit", type: "bool", def: "false" }, { name: "rename", type: "bool", def: "false" },
    ] },
  { file: "canvas-export.yml", label: "Canvas grade export", group: "Canvas",
    desc: "Build a Canvas-import CSV from the gradebook (paste the Canvas export in).",
    inputs: [ { name: "canvas_csv", type: "text", def: "" }, { name: "section", type: "string", def: "" } ] },
  { file: "publish-material.yml", label: "Publish material", group: "Content",
    desc: "Push one content/ unit into every student workspace (direct course-bot commits). Run units one at a time.",
    inputs: [ { name: "unit", type: "string", def: "", required: true, gateAlways: true, danger: "push this unit to every workspace" } ] },
  { file: "provision-workspaces.yml", label: "Provision workspaces", group: "Hygiene",
    desc: "Create missing student workspaces + backfill blank student.json from submissions.",
    inputs: [ { name: "execute", type: "bool", def: "false", gate: true, danger: "create/modify workspace repos" }, { name: "only", type: "string", def: "" } ] },
  { file: "prune-gradebook.yml", label: "Prune gradebook", group: "Hygiene",
    desc: "Drop gradebook rows whose submission repo 404s (deleted/renamed).",
    inputs: [ { name: "execute", type: "bool", def: "false", gate: true, danger: "rewrite grades.csv" } ] },
  { file: "audit-names.yml", label: "Audit repo names", group: "Hygiene",
    desc: "Weekly naming/identity audit. A RED run means it FOUND problems (by design).",
    dispatch: false },
  { file: "generate-attendance-qrs.yml", label: "Generate attendance QRs", group: "Attendance",
    desc: "Sign + commit each student's QR into their workspace; refresh roster.json.",
    inputs: [ { name: "execute", type: "bool", def: "false", gate: true, danger: "write QRs into workspaces" }, { name: "force", type: "bool", def: "false" }, { name: "only", type: "string", def: "" } ] },
  { file: "verify-attendance.yml", label: "Verify attendance", group: "Attendance",
    desc: "Runs on every scan-batch push: verifies signatures, rebuilds summaries. RED = flagged scan.",
    dispatch: false },
  { file: "publish-attendance.yml", label: "Publish attendance receipts", group: "Attendance",
    desc: "Deliver each student their own MY-ATTENDANCE.md (auto after verify; manual re-run here).",
    inputs: [ { name: "execute", type: "bool", def: "false", gate: true, danger: "write receipts into workspaces" }, { name: "only", type: "string", def: "" } ] },
];
