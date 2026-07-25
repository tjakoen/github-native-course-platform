// Browser port of the retired build-dashboard.mjs data half: loads one section's
// gradebook live from the GitHub API instead of a local clone. The parsing,
// note-precedence, proposed-score extraction and tally logic are kept verbatim -
// the numbers here must match what the local dashboard produced.
import { ghJSON, ghText, pool } from "./gh.mjs";

export const parse = (line) => { const o=[];let c="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'&&line[i+1]==='"'){c+='"';i++;}else if(ch==='"')q=false;else c+=ch;}else if(ch==='"')q=true;else if(ch===','){o.push(c);c="";}else c+=ch;}o.push(c);return o;};
const dec = (s) => { try { if(!s) return ""; const bin = atob(s); const bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); return new TextDecoder().decode(bytes); } catch { return ""; } };
const pointsFor = (passed, total, pp) => (!total ? null : Math.round((passed/total)*pp));

export async function loadSection(sc) {
  const base = `/repos/${sc.org}/${sc.repo}`;
  const pol = sc.pol || await ghText(`${base}/contents/grader/assignments.json`).then(t => t ? JSON.parse(t) : null);
  if (!pol) throw new Error(`${sc.repo}: grader/assignments.json not readable`);
  const policy = new Map(pol.map(a => [a.id, a]));
  const assignments = pol.map(a => {
    const aiGraded = !!a["ai-grading"], manual = !!a.manual, quiz = a.type === "quiz";
    // activity-level kind, lifted from the per-row kind so the matrix header + deliver
    // prompt can reason about the whole column: manual > held (AI) > quiz > push.
    const kind = manual ? "manual" : aiGraded ? "held" : quiz ? "quiz" : "push";
    return {
      id: a.id, totalPoints: a.totalPoints ?? null, autoPoints: a.autoPoints ?? null,
      aiGraded, manual, quiz, kind, type: a.type || null,
      locked: !!a.locked, publish: !!a.publish, feedback: a.feedback || null,
      namePrefix: a.namePrefix ?? null, title: a.title ?? null,   // additive: missing-work + display
    };
  });
  const csvText = await ghText(`${base}/contents/gradebook/grades.csv`);
  if (csvText == null) throw new Error(`${sc.repo}: gradebook/grades.csv not readable`);
  const csv = csvText.replace(/\n$/,"").split("\n");
  const h = parse(csv[0]); const gi = (n) => h.indexOf(n);

  // One recursive tree call lists every note that exists (the fs.existsSync of
  // the local build); then pool-fetch only the notes actually present.
  const repoInfo = await ghJSON(base);
  const branch = repoInfo?.default_branch || "main";
  const tree = await ghJSON(`${base}/git/trees/${branch}?recursive=1`);
  const noteSet = new Set((tree?.tree || []).filter(x => x.type === "blob" && x.path.startsWith("gradebook/notes/")).map(x => x.path));
  const notePath = (id, repo) => `gradebook/notes/${id}/${repo}.md`;

  const wanted = [];
  for (let i=1;i<csv.length;i++) {
    const f = parse(csv[i]); if (!f[gi("repo")]) continue;
    const id = f[gi("assignment")]; if (!policy.get(id)) continue;
    const np = notePath(id, f[gi("repo")]);
    if (noteSet.has(np)) wanted.push(np);
  }
  const noteContents = new Map();
  await pool([...new Set(wanted)], 8, async np => {
    const t = await ghText(`${base}/contents/${encodeURI(np)}`);
    if (t != null) noteContents.set(np, t);
  });

  const byStudent = new Map();
  for (let i=1;i<csv.length;i++) {
    const f = parse(csv[i]); if (!f[gi("repo")]) continue;
    const id = f[gi("assignment")]; const a = policy.get(id); if (!a) continue;
    const num = (f[gi("studentNumber")]||"").trim();
    const key = num || `norepo:${f[gi("fullName")]||f[gi("repo")]}`;
    if (!byStudent.has(key)) byStudent.set(key, {
      number: num, name: f[gi("fullName")]||"", github: f[gi("githubAccount")]||"", activities: {},
    });
    const st = byStudent.get(key);
    if (!st.name && f[gi("fullName")]) st.name = f[gi("fullName")];
    if (!st.github && f[gi("githubAccount")]) st.github = f[gi("githubAccount")];
    const passed = +f[gi("passed")]||0, total = +f[gi("total")]||0;
    const aiScore = f[gi("aiScore")]==="" ? null : +f[gi("aiScore")];
    const held = a["ai-grading"] ? true : false;
    const pp = a.totalPoints ?? a.autoPoints ?? null;
    let canvasPts = null, kind = "push";
    if (a.manual) { kind = "manual"; }
    else if (held) { kind = "held"; }
    else if (pp != null) canvasPts = pointsFor(passed, total, a.autoPoints ?? a.totalPoints);
    else canvasPts = passed; // no declared points -> raw test count, scaled to Canvas on push
    let note = noteContents.get(notePath(id, f[gi("repo")])) ?? "";
    if (!note) note = dec(f[gi("notes")]);
    // pull the AI-authored likelihood ("vibecode") flag + any triage flag from the note
    let aiFlag = null, triage = null;
    if (note) {
      const m = note.match(/AI-authored likelihood:\s*([^\n]+)/i); if (m) aiFlag = m[1].trim();
      const t = note.match(/\nFlag:\s*([^\n]+)/i); if (t) triage = t[1].trim();
    }
    // The CSV aiScore is the reviewed FINAL score, present only once a student is
    // cleared. Before that it is blank, so surface the AI's PROPOSED total parsed
    // from the note (the notes-input flow leaves aiScore blank until you clear it).
    let proposed = aiScore;
    if (proposed == null && note) {
      const pm = note.match(/Proposed total:\s*([0-9]{1,3})\s*\/\s*[0-9]{1,3}/i);
      if (pm) { const pmax = a.totalPoints ?? a.autoPoints ?? +pm[1]; proposed = Math.min(pmax, +pm[1]); }
    }
    st.activities[id] = {
      repo: f[gi("repo")], passed, total, raw: `${passed}/${total}`,
      canvasPts, proposed, proposedMax: (a.totalPoints ?? a.autoPoints ?? total),
      held, kind, note: note || null, aiFlag, triage,
      sha: (f[gi("sha")]||"").slice(0,7), late: f[gi("late")]==="true",
    };
  }

  // tallies
  const students = [...byStudent.values()].map(st => {
    let push = 0, heldSum = 0, pushMax = 0, heldMax = 0;
    for (const a of assignments) {
      const r = st.activities[a.id]; if (!r) continue;
      const max = a.totalPoints ?? a.autoPoints ?? (r.total || 0);
      if (r.kind === "held") { heldSum += (r.proposed ?? 0); heldMax += max; }
      else if (r.kind === "push") { push += (r.canvasPts ?? 0); pushMax += max; }
    }
    return { ...st, tally: { push, pushMax, held: heldSum, heldMax } };
  }).sort((x,y)=> (x.name||"").localeCompare(y.name||""));

  const heldCount = assignments.filter(a=>a.aiGraded).length;
  const blank = students.filter(s=>!s.number).length;

  // Attendance: verify-attendance writes attendance/summary.json (keyed by
  // studentNumber). Optional - absent for sections with no scans yet.
  let attendance = null;
  const attTxt = await ghText(`${base}/contents/attendance/summary.json`);
  if (attTxt) { try { attendance = JSON.parse(attTxt); } catch { attendance = null; } }

  return { ...sc, assignments, students, attendance,
    stats: { students: students.length, activities: assignments.length, held: heldCount, blankStudentJson: blank, sessions: attendance?.sessionDates?.length || 0 } };
}
