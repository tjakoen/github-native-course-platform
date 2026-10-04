// Load recorded grades and pending review evidence for one section from GitHub.
// Finals inputs are visible before a CSV score exists. Proposals remain distinct
// from reviewed scores, and delivery is checked against workspace receipts.
import { ghJSON, ghText, pool } from "./gh.mjs";

export const parse = (line) => { const o=[];let c="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'&&line[i+1]==='"'){c+='"';i++;}else if(ch==='"')q=false;else c+=ch;}else if(ch==='"')q=true;else if(ch===','){o.push(c);c="";}else c+=ch;}o.push(c);return o;};
const dec = (s) => { try { if(!s) return ""; const bin = atob(s); const bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); return new TextDecoder().decode(bytes); } catch { return ""; } };
const pointsFor = (passed, total, pp) => (!total ? null : Math.round((passed/total)*pp));
// Drop a "2026-" style year prefix so the same student entered as "2026-00000001"
// in one submission and "00000001" in another groups as one row (matches the
// engine's normNum in tools/lib/gradebook.mjs). Grouping only - the displayed
// number stays the raw first-seen value so attendance/roster lookups are unchanged.
const normNum = (s) => String(s ?? "").trim().replace(/^\d{4}-/, "");
const joinNum = (s) => { const n = normNum(s); return n.replace(/\D/g, "").length >= 6 ? n : ""; };

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
  // path -> blob sha for every note. Fetching a note by its blob SHA (below)
  // instead of by path is the request-count win: a /git/blobs/<sha> URL is
  // immutable, so an UNCHANGED note is served straight from cache with no network
  // call; only notes whose sha moved (edited drafts) actually refetch.
  const noteSha = new Map();
  for (const x of (tree?.tree || [])) if (x.type === "blob" && x.path.startsWith("gradebook/notes/")) noteSha.set(x.path, x.sha);
  const notePath = (id, repo) => `gradebook/notes/${id}/${repo}.md`;

  const wanted = [];
  for (let i=1;i<csv.length;i++) {
    const f = parse(csv[i]); if (!f[gi("repo")]) continue;
    const id = f[gi("assignment")]; if (!policy.get(id)) continue;
    const np = notePath(id, f[gi("repo")]);
    if (noteSha.has(np)) wanted.push(np);
  }
  const noteContents = new Map();
  await pool([...new Set(wanted)], 8, async np => {
    const sha = noteSha.get(np); if (!sha) return;
    const t = await ghText(`${base}/git/blobs/${sha}`);
    if (t != null) noteContents.set(np, t);
  });

  // Finals inputs and drafts are review evidence even before any grade is recorded.
  // Resolve identity from the workspace's student.json, never from its name suffix.
  const pending = new Map(), identities = new Map(), receipts = new Map();
  const inputSha = new Map((tree?.tree || []).filter(x => x.type === "blob" && x.path.startsWith("gradebook/notes-input/")).map(x => [x.path, x.sha]));
  if (tree?.truncated) throw new Error("Repository tree is truncated; review evidence cannot be inventoried safely.");
  for (const x of tree?.tree || []) {
    const m = x.path.match(/^gradebook\/(notes|notes-input)\/([^/]+)\/(student-[^/]+)\.md$/);
    if (x.type !== "blob" || !m || !policy.get(m[2])?.["ai-grading"]) continue;
    pending.set(m[2] + "/" + m[3], { id: m[2], repo: m[3] });
    identities.set(m[3], null);
  }
  // A candidate name locates a file; only its explicit matching identity joins it.
  const family = sc.repo.match(/^teacher-([^-]+)-([^-]+)-/i);
  const candidateNumbers = new Map();
  if (family) for (const line of csv.slice(1)) {
    const f = parse(line), handle = (f[gi("githubAccount")] || "").trim();
    const number = joinNum(f[gi("studentNumber")]);
    if (!number || !/^[a-z0-9-]+$/i.test(handle)) continue;
    const repo = `student-${family[1]}-${family[2]}-${handle}`;
    const numbers = candidateNumbers.get(repo) || new Set(); numbers.add(number);
    candidateNumbers.set(repo, numbers);
    if (!identities.has(repo)) identities.set(repo, null);
  }
  const reviewWarnings = [], deliveryWarnings = [];
  await pool([...identities.keys()], 6, async repo => {
    try {
      const text = await ghText(`/repos/${sc.org}/${repo}/contents/student.json`);
      const identity = text ? JSON.parse(text) : null;
      if (!joinNum(identity?.studentNumber)) { if ([...pending.values()].some(x => x.repo === repo)) reviewWarnings.push(repo + ": identity needs checking"); return; }
      const expected = candidateNumbers.get(repo);
      if (expected && !expected.has(normNum(identity.studentNumber))) { reviewWarnings.push(repo + ": workspace identity differs from gradebook; delivery is unverified"); return; }
      identities.set(repo, identity);
      receipts.set(repo, await ghText(`/repos/${sc.org}/${repo}/contents/GRADES.md`));
    } catch (error) { reviewWarnings.push(repo + ": workspace evidence unreadable"); }
  });
  const identityGroups = new Map();
  for (const [repo, identity] of identities) if (identity) {
    const key = normNum(identity.studentNumber);
    identityGroups.set(key, [...(identityGroups.get(key) || []), repo]);
  }
  for (const repos of identityGroups.values()) if (repos.length > 1) {
    reviewWarnings.push("Multiple workspaces share one student number; their finals rows remain held.");
    for (const repo of repos) identities.set(repo, null);
  }
  // Include standalone finals drafts in the same immutable-blob cache as CSV notes.
  await pool([...pending.values()].filter(x => noteSha.has(notePath(x.id, x.repo)) && !noteContents.has(notePath(x.id, x.repo))), 8, async x => {
    const np = notePath(x.id, x.repo);
    const text = await ghText(`${base}/git/blobs/${noteSha.get(np)}`);
    if (text != null) noteContents.set(np, text);
  });
  const csvRows = csv.slice(1).map(parse);
  const rowKeys = new Set(csvRows.map(f => f[gi("assignment")] + "/" + f[gi("repo")]));
  const workspaceByNumber = new Map([...identities].filter(([, identity]) => identity).map(([repo, identity]) => [normNum(identity.studentNumber), repo]));
  for (const x of pending.values()) {
    if (rowKeys.has(x.id + "/" + x.repo)) continue;
    const identity = identities.get(x.repo);
    const f = h.map(() => "");
    const put = (key, value) => { if (gi(key) >= 0) f[gi(key)] = String(value ?? ""); };
    put("repo", x.repo); put("assignment", x.id);
    put("studentNumber", identity?.studentNumber);
    put("fullName", identity?.fullName || "Identity needs checking");
    put("githubAccount", identity?.githubAccount);
    // Synthetic rows stay ungraded and unreviewed. No CSV is written by this view.
    f.reviewOnly = true; f.identityUnresolved = !identity;
    csvRows.push(f);
  }

  const byStudent = new Map();
  for (const f of csvRows) {
    if (!f[gi("repo")]) continue;
    const id = f[gi("assignment")]; const a = policy.get(id); if (!a) continue;
    const raw = (f[gi("studentNumber")]||"").trim();
    if (!raw || !joinNum(raw) || identities.has(f[gi("repo")]) && !identities.get(f[gi("repo")])) f.identityUnresolved = true;
    const key = (f.identityUnresolved ? "" : joinNum(raw)) || `norepo:${f[gi("repo")]}`;
    if (!byStudent.has(key)) byStudent.set(key, {
      reviewKey: f.identityUnresolved ? key : null, number: raw, name: f[gi("fullName")]||"", github: f[gi("githubAccount")]||"", activities: {},
    });
    const st = byStudent.get(key);
    const previous = st.activities[id];
    if (previous && (f.reviewOnly && previous.graded || !f.reviewOnly && !previous.reviewOnly && previous.gradedAt >= (f[gi("gradedAt")] || ""))) continue;
    if (!st.name && f[gi("fullName")]) st.name = f[gi("fullName")];
    if (!st.github && f[gi("githubAccount")]) st.github = f[gi("githubAccount")];
    const ownWorkspace = workspaceByNumber.get(key);
    if (ownWorkspace) st.workspaceRepo = ownWorkspace;
    const passed = +f[gi("passed")]||0, total = +f[gi("total")]||0;
    const recordedValue = !f[gi("aiScore")]?.trim() ? null : +f[gi("aiScore")];
    const scoreMax = a.totalPoints ?? a.autoPoints ?? null;
    const invalidRecorded = recordedValue != null && (!Number.isFinite(recordedValue) || recordedValue < 0 || scoreMax != null && recordedValue > scoreMax);
    const aiScore = invalidRecorded ? null : recordedValue;
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
    const sourceOwnerRaw = gi("sourceOwner") >= 0 ? (f[gi("sourceOwner")] || "").trim() : "";
    const sourceIssue = sourceOwnerRaw && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(sourceOwnerRaw) ? "Source owner metadata is invalid; resolve provenance before approval." : null;
    let proposed = aiScore, proposalIssue = invalidRecorded ? "Recorded score is invalid or outside the activity points; needs correction." : null;
    if (proposed == null && note && !invalidRecorded) {
      // Half points are legal in a split rubric (a 15-test proportional half at
      // 2.333 each lands on .5 often), so the proposal may be "49.5/50". Matching
      // integers only made those notes read as having no proposal at all: the row
      // showed "held" with no number and "Approve all unreviewed" skipped it.
      const pm = note.match(/Proposed total:\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)/i);
      if (pm && !f.identityUnresolved) {
        const pmax = a.totalPoints ?? a.autoPoints ?? +pm[2];
        if (+pm[2] !== pmax || +pm[1] > pmax) proposalIssue = "Proposal does not match the activity points; needs correction.";
        else proposed = +pm[1];
      }
    }
    if (sourceIssue) { proposalIssue = sourceIssue; proposed = null; }
    st.activities[id] = {
      sourceOwner: sourceIssue ? "" : sourceOwnerRaw, sourceIssue, sourceSha: f[gi("sha")] || "", repo: f[gi("repo")], passed, total, raw: `${passed}/${total}`,
      // `proposed` collapses the written aiScore and the note's proposal into one
      // display number, so keep the raw CSV aiScore too: it is the only signal that
      // says "this reviewed score is IN the gradebook", which is what the review
      // lane compares the browser's local decision against.
      aiScore,
      canvasPts, proposed, proposedMax: (a.totalPoints ?? a.autoPoints ?? total),
      held, kind, note: note || null, aiFlag, triage, proposalIssue,
      sha: (f[gi("sha")]||"").slice(0,7), late: f[gi("late")]==="true",
      gradedAt: f[gi("gradedAt")] || "",
      graded: !f.reviewOnly && !!f[gi("gradedAt")] && (held || total > 0),
      gradingIssue: !held && total === 0 ? "No valid automated result; source or build needs checking." : null, reviewOnly: !!f.reviewOnly,
      identityUnresolved: !!f.identityUnresolved,
      inputAvailable: inputSha.has(`gradebook/notes-input/${id}/${f[gi("repo")]}.md`),
      inputBlobURL: inputSha.has(`gradebook/notes-input/${id}/${f[gi("repo")]}.md`) ? `${base}/git/blobs/${inputSha.get(`gradebook/notes-input/${id}/${f[gi("repo")]}.md`)}` : null,
      workspaceDelivered: null,
    };
    const receipt = receipts.get(st.workspaceRepo);
    if (receipt != null) {
      const lines = receipt.split("\n").filter(line => line.startsWith(`| ${id} |`));
      const expected = held ? aiScore : total > 0 ? (pp != null ? canvasPts : passed) : null;
      const grades = lines.map(line => line.split("|")[2]?.trim().match(/(?:\[)?([\d.]+)\/([\d.]+)/));
      st.activities[id].workspaceDelivered = grades.length > 0 && grades.every(grade => !!grade && expected != null && +grade[1] === expected && +grade[2] === (pp ?? total));
      st.activities[id].duplicateReceipt = lines.length > 1;
      if (lines.length > 1) deliveryWarnings.push(id + ": duplicate activity rows in a workspace receipt");
    };
  }

  // Preserve alternate repository evidence instead of silently hiding it when
  // the display consolidates multiple sources for one student and activity.
  for (const [key, st] of byStudent) for (const [id, current] of Object.entries(st.activities)) {
    if (current.sourceIssue) current.workspaceDelivered = null;
    const alternatives = csvRows.filter(f => !f.reviewOnly && joinNum(f[gi("studentNumber")]) === key && f[gi("assignment")] === id && ((gi("sourceOwner") >= 0 ? f[gi("sourceOwner")] : "") || sc.org).toLowerCase() + "/" + f[gi("repo")].toLowerCase() !== (current.sourceOwner || sc.org).toLowerCase() + "/" + current.repo.toLowerCase());
    const unique = new Map();
    for (const f of alternatives) {
      const repo = f[gi("repo")], owner = gi("sourceOwner") >= 0 ? (f[gi("sourceOwner")] || "").trim() : "";
      const source = { repo, sourceOwner: owner, sourceSha: f[gi("sha")] || "", gradedAt: f[gi("gradedAt")] || "", note: repo.toLowerCase() === current.repo.toLowerCase() ? dec(f[gi("notes")]) || null : noteContents.get(notePath(id, repo)) || dec(f[gi("notes")]) || null };
      const token = owner.toLowerCase() + "/" + repo.toLowerCase();
      if (!unique.has(token) || unique.get(token).gradedAt < source.gradedAt) unique.set(token, source);
    }
    if ([...unique.values()].some(source => source.repo.toLowerCase() === current.repo.toLowerCase())) {
      const selected = csvRows.find(f => f[gi("assignment")] === id && f[gi("repo")] === current.repo && ((gi("sourceOwner") >= 0 ? f[gi("sourceOwner")] : "") || sc.org).toLowerCase() === (current.sourceOwner || sc.org).toLowerCase() && (f[gi("gradedAt")] || "") === current.gradedAt);
      // A shared path cannot establish which owner authored the note.
      current.note = selected ? dec(selected[gi("notes")]) || null : null;
      current.aiFlag = null; current.triage = null;
    }
    current.alternateSources = [...unique.values()];
    if (current.alternateSources.length) {
      current.sourceSelectionIssue = "Multiple repository sources are recorded for this student and activity. Resolve the submitted source before approval or delivery.";
      current.proposalIssue = current.sourceSelectionIssue;
      current.proposed = null;
      current.workspaceDelivered = null;
      reviewWarnings.push(id + ": alternate repository drafts need source reconciliation");
    }
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

  // "held" here counts HELD SUBMISSION ROWS awaiting review (Canvas "needs
  // grading" convention), not the number of AI activities. The UI drains it
  // further by the reviewer's local decisions (heldUnreviewed in app.mjs); this
  // data-only baseline is the count before any decision is recorded.
  let heldCount = 0;
  for (const st of students) for (const a of assignments) if (a.kind === "held" && st.activities[a.id]) heldCount++;
  const blank = students.filter(s=>!s.number).length;

  // Attendance: verify-attendance writes attendance/summary.json (keyed by
  // studentNumber). Optional - absent for sections with no scans yet.
  let attendance = null;
  const attTxt = await ghText(`${base}/contents/attendance/summary.json`);
  if (attTxt) { try { attendance = JSON.parse(attTxt); } catch { attendance = null; } }

  return { ...sc, assignments, students, attendance, reviewWarnings, deliveryWarnings,
    stats: { students: students.length, activities: assignments.length, held: heldCount, blankStudentJson: blank, sessions: attendance?.sessionDates?.length || 0 } };
}
