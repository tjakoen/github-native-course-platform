// Student-profile data: missing-work (pure, from the loaded section) and the
// on-demand workspace read (identity cross-check + delivery status). The
// workspace fetch happens only when a profile is opened, and is cached - it is
// the only per-student API spend in the app.
import { ghJSON, ghText } from "./gh.mjs";

// Activities this student was expected to submit but has no gradebook row for:
// the activity clones submissions by namePrefix (so manual/url and Canvas-quiz
// activities never count as "missing" here).
export function missingWork(s, st) {
  return s.assignments.filter(a => a.namePrefix && !a.manual && !a.quiz && !st.activities[a.id]);
}

export function workspaceRepo(s, st) {
  if (!st.github) return null;
  const subj = (s.key.split("-")[0] || "").toLowerCase();
  return `student-${subj}-${s.section}-${st.github}`;
}

const CACHE = new Map(); // org/repo -> { at, value }
const TTL = 10 * 60 * 1000;

// One tree call on the workspace + student.json fetch. Returns null when the
// workspace is unreachable (missing repo, or a per-repo PAT without org read).
export async function workspaceInfo(s, st) {
  const repo = workspaceRepo(s, st);
  if (!repo) return null;
  const key = s.org + "/" + repo;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const info = await ghJSON(`/repos/${s.org}/${repo}`);
  if (!info) { const v = { repo, exists: false }; CACHE.set(key, { at: Date.now(), value: v }); return v; }
  const tree = await ghJSON(`/repos/${s.org}/${repo}/git/trees/${info.default_branch || "main"}?recursive=1`);
  const paths = new Set((tree?.tree || []).filter(x => x.type === "blob").map(x => x.path));
  let studentJson = null;
  if (paths.has("student.json")) {
    try { studentJson = JSON.parse(await ghText(`/repos/${s.org}/${repo}/contents/student.json`) || "null"); } catch { studentJson = null; }
  }
  const endsWith = suffix => [...paths].some(p => p.endsWith(suffix));
  const value = {
    repo, exists: true,
    url: `https://github.com/${s.org}/${repo}`,
    studentJson,
    gradesDelivered: endsWith("GRADES.md"),
    feedbackDelivered: endsWith("FEEDBACK.md"),
    attendanceReceipt: paths.has("attendance/MY-ATTENDANCE.md"),
  };
  CACHE.set(key, { at: Date.now(), value });
  return value;
}
