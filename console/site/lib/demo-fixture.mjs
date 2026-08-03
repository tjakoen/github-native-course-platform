// The synthetic dataset behind Demo mode. ZERO real data: every name, number,
// handle, score and note in here is invented, and it must stay that way - this
// file ships in the public Pages artifact.
//
// Two hard rules for anyone editing it:
//  1. NEVER paste real class data in, not even "just to check a layout". Use the
//     generators below; they produce plausible rows from a fixed seed.
//  2. Keep it a .mjs module. The Pages deploy has a PII tripwire that fails the
//     build if a shipped .json/.csv carries gradebook identity columns, so a
//     fixture moved into a .json file would (correctly) break the deploy.
//
// The data is shaped exactly like the real thing: this module answers as a
// virtual GitHub repo (files, trees, blobs, Actions runs) so demo.mjs can serve
// it through the same lib/ parsers the live app uses. If a shape here is wrong,
// the demo breaks in the same way real data would - which is the point.

// ---- deterministic randomness (same demo every visit, stable screenshots) ----
const rng = seed => { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

const FIRST = ["Amara","Noel","Priya","Tomas","Ines","Kofi","Mira","Dario","Saskia","Renzo","Yuki","Elian","Nadia","Bram","Lucia","Omar","Freya","Idris","Camila","Vitto","Hana","Marek","Zara","Teo","Ilse","Rafa","Nia","Joris","Anouk","Kenji","Selma","Dante","Livia","Basil","Roos","Emeka","Nora","Sven","Alba","Tariq","Mei","Casper","Leila","Otto","Sanne","Pablo","Ivy","Milan","Farida","Bo","Anika","Ravi","Juno","Esme","Nikolai","Thandi","Gideon","Suri","Lars","Petra"];
const LAST = ["Verhoeven","Okonkwo","Iyer","Bellini","Marchetti","Adeyemi","Novak","Salcedo","De Vries","Quintero","Tanaka","Moreau","Haddad","Jansen","Ferreira","Rahman","Lindqvist","Balogun","Duarte","Rossi","Kimura","Kowalski","Aziz","Papadakis","Bakker","Ortega","Mensah","Vermeer","Smit","Sato","Ilic","Ricci","Antunes","Farouk","Hendriks","Nwosu","Berg","Larsen","Munoz","Cheng","Vos","Nakamura","Habib","Muller","Visser","Solberg","Achebe","Bianchi","Dimitrova","Osei"];

// Handles look like real student handles: mostly tidy, some noisy.
function handleFor(first, last, r) {
  const f = first.toLowerCase().replace(/[^a-z]/g, ""), l = last.toLowerCase().replace(/[^a-z]/g, "");
  const forms = [f + l, f[0] + l, l + f[0], f + "-" + l, f + l.slice(0, 3), f + "_" + l, f + l + Math.floor(r() * 90 + 10)];
  return pick(r, forms);
}

// ---- the three demo classes ----------------------------------------------
// One org per course, mirroring the real deployment (a GitHub org per subject).
// `plan` carries BOTH the engine entry (`engine`, copied verbatim into
// grader/assignments.json) and the fixture's grading behaviour (participation,
// score spread, how many notes exist). Keep the two separate: the Activities tab
// shows the raw engine entry, so a fixture-only field leaking in would be a lie.
const CLASSES = [
  {
    org: "demo-appdev", repo: "teacher-cs401-1101-instructor", code: "CS401", section: "1101",
    courseName: "Application Development", courseCode: "CS-401", nStudents: 26, seed: 1101, stack: "js",
    sessions: ["2026-06-01","2026-06-08","2026-06-15","2026-06-22","2026-06-29","2026-07-06","2026-07-13","2026-07-20"],
    units: ["start-here","m1-js-foundations","m2-react","m3-styling","m4-backend","publish-portfolio","exams"],
    plan: [
      { id: "m1a1", label: "Hello, JavaScript", tests: 7, part: 1.0, band: [0.85, 1],
        engine: { id: "m1a1", type: "vitest", namePrefix: "m1a1-", locked: true, publish: true } },
      { id: "m1a2", label: "Arrays and objects", tests: 10, part: 0.96, band: [0.6, 1],
        engine: { id: "m1a2", type: "vitest", namePrefix: "m1a2-", totalPoints: 10, locked: true, publish: true } },
      { id: "m2a1", label: "Your first React component", tests: 12, part: 0.92, band: [0.5, 1],
        engine: { id: "m2a1", type: "vitest", namePrefix: "m2a1-", totalPoints: 20, locked: true, publish: true } },
      { id: "m3a1", label: "Portfolio landing page", tests: 14, part: 0.85, band: [0.55, 1], notes: 1, cleared: 0.15, shots: true,
        engine: { id: "m3a1", type: "vitest", namePrefix: "m3a1-", totalPoints: 100, "ai-grading": true, feedback: "project", previews: "branch", locked: true, publish: false } },
      { id: "m3a2", label: "Refactor for readability", tests: 9, part: 0.73, band: [0.5, 1], notes: 0.45,
        engine: { id: "m3a2", type: "vitest", namePrefix: "m3a2-", totalPoints: 100, "ai-grading": true, feedback: "code", locked: true, publish: false } },
      { id: "q1", label: "Midterm quiz", tests: 25, part: 0.88, band: [0.4, 1], quiz: true,
        engine: { id: "q1", type: "quiz", totalPoints: 25, publish: false } },
      { id: "m6a3", label: "Publish Your Portfolio", part: 0.5, manual: true,
        engine: { id: "m6a3", manual: true, submit: "url", content: "publish-portfolio", totalPoints: 20, title: "Publish Your Portfolio" } },
    ],
  },
  {
    org: "demo-mobile", repo: "teacher-mob210-2202-instructor", code: "MOB210", section: "2202",
    courseName: "Mobile Development", courseCode: "MOB-210", nStudents: 22, seed: 2202, stack: "dart",
    sessions: ["2026-06-03","2026-06-10","2026-06-17","2026-06-24","2026-07-01"],
    units: ["start-here","m1-dart-basics","m2-collections","m3-oop","m4-flutter-ui"],
    plan: [
      { id: "m1a1", label: "Hello, Dart", tests: 5, part: 1.0, band: [0.8, 1],
        engine: { id: "m1a1", type: "dart", namePrefix: "m1a1-", locked: true, publish: true } },
      { id: "m2a1", label: "Lists and maps", tests: 8, part: 0.95, band: [0.5, 1],
        engine: { id: "m2a1", type: "dart", namePrefix: "m2a1-", totalPoints: 10, locked: true, publish: true } },
      // A FINISHED AI activity: every note cleared into aiScore and publish:true.
      // That pair is what a delivered activity looks like in a real teacher repo,
      // and it is the case the review lane has to recognize from the repo alone -
      // a browser with no saved decisions must still see this as delivered rather
      // than offering to finalize it again.
      { id: "m3a6", label: "Monster battler", tests: 11, part: 0.86, band: [0.5, 1], notes: 1, cleared: 1,
        engine: { id: "m3a6", type: "dart", namePrefix: "m3a6-", totalPoints: 100, "ai-grading": true, feedback: "code", locked: true, publish: true } },
      { id: "m4a4", label: "Monster detail screen", tests: 8, part: 0.68, band: [0.45, 1], notes: 0.8, shots: true,
        engine: { id: "m4a4", type: "flutter", namePrefix: "m4a4-", totalPoints: 100, "ai-grading": true, feedback: "project", locked: false, publish: false } },
    ],
  },
  {
    org: "demo-webdesign", repo: "teacher-web101-3303-instructor", code: "WEB101", section: "3303",
    courseName: "Intro to Web Design", courseCode: "WEB-101", nStudents: 31, seed: 3303, stack: "web",
    sessions: [],   // no scans yet: shows the honest attendance empty state
    units: ["start-here","m1-html","m2-css","m3-layout","publish-portfolio"],
    plan: [
      { id: "m1a1", label: "Your first page", tests: 6, part: 0.97, band: [0.7, 1],
        engine: { id: "m1a1", type: "vitest", namePrefix: "m1a1-", locked: true, publish: true } },
      { id: "m2a1", label: "Styling with CSS", tests: 9, part: 0.9, band: [0.5, 1],
        engine: { id: "m2a1", type: "vitest", namePrefix: "m2a1-", totalPoints: 15, locked: true, publish: true } },
      { id: "m2a4", label: "My Favourites page", tests: 10, part: 0.81, band: [0.5, 1], notes: 1, cleared: 0.1, shots: true,
        engine: { id: "m2a4", type: "vitest", namePrefix: "m2a4-", totalPoints: 20, "ai-grading": true, feedback: "project", locked: true, publish: false } },
      { id: "m6a3", label: "Publish Your Portfolio", part: 0.35, manual: true,
        engine: { id: "m6a3", manual: true, submit: "url", content: "publish-portfolio", totalPoints: 20, title: "Publish Your Portfolio" } },
    ],
  },
];

export const DEMO_TOKEN = "demo-no-token-needed";
export const demoRepos = () => CLASSES.map(c => ({ url: "github.com/" + c.org + "/" + c.repo, token: DEMO_TOKEN }));
export const classes = () => CLASSES;
export const classByOrg = org => CLASSES.find(c => c.org === org) || null;

// ---- students + gradebook rows (memoized per class) ----------------------
const memo = new Map();
const once = (k, fn) => { if (!memo.has(k)) memo.set(k, fn()); return memo.get(k); };

function studentsOf(cls) {
  return once("stu:" + cls.repo, () => {
    const r = rng(cls.seed);
    const used = new Set(), out = [];
    for (let i = 0; i < cls.nStudents; i++) {
      let first, last, gh, guard = 0;
      do { first = pick(r, FIRST); last = pick(r, LAST); gh = handleFor(first, last, r); } while (used.has(gh) && ++guard < 40);
      used.add(gh);
      // a couple of rows with no student number: the real "blank student.json"
      // hygiene case the Students facet and the dashboard inbox surface
      const blank = i === 4 || i === 17;
      out.push({
        name: last + ", " + first, first, last, github: gh,
        number: blank ? "" : String(cls.seed * 10000 + 1000 + i * 7),
        email: gh + "@demo.example",
        seed: (cls.seed * 131 + i * 977) >>> 0,
        ability: 0.45 + r() * 0.55,          // drives scores across activities
        attend: i % 9 === 3 ? 0.3 : 0.6 + r() * 0.4,   // a few genuinely at-risk
        noWorkspace: i === 9,                 // one student never got a workspace
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  });
}

// One gradebook row per (student, activity) that exists. `submitted` follows the
// activity's participation rate, so "missing work" is real, not decorative.
function rowsOf(cls) {
  return once("rows:" + cls.repo, () => {
    const rows = [];
    for (const a of cls.plan) {
      const r = rng(cls.seed + a.id.length * 7919);
      studentsOf(cls).forEach((st, i) => {
        if (r() > a.part) return;
        const row = { aid: a.id, st, act: a };
        if (a.manual) { row.passed = 0; row.total = 0; row.repo = a.id + "-" + cls.section + "-" + st.github; }
        else {
          const lo = a.band[0], hi = a.band[1];
          const frac = Math.min(1, Math.max(0, lo + (hi - lo) * (st.ability * 0.75 + r() * 0.25)));
          row.total = a.tests;
          row.passed = Math.max(0, Math.min(a.tests, Math.round(a.tests * frac)));
          row.repo = a.id + "-" + cls.section + "-" + st.github;
        }
        row.sha = (st.seed.toString(16) + "abcdef").slice(0, 7);
        row.late = !a.manual && i % 11 === 5;
        // AI activities: a note exists for `notes` fraction; a slice of those are
        // already cleared (aiScore filled) so the review queue shows a real mix.
        if (a.engine["ai-grading"]) {
          row.hasNote = r() < (a.notes ?? 1);
          const max = a.engine.totalPoints;
          const auto = Math.round((row.passed / row.total) * max * 0.7);
          const design = Math.round(max * 0.3 * Math.min(1, st.ability * 0.85 + r() * 0.3));
          row.proposed = Math.min(max, auto + design);
          row.vibe = r() < 0.12 ? "high" : r() < 0.3 ? "medium" : "low";
          row.aiScore = row.hasNote && r() < (a.cleared ?? 0) ? row.proposed : null;
        }
        rows.push(row);
      });
    }
    return rows;
  });
}

// ---- teacher-repo files --------------------------------------------------
const CSV_HEAD = "repo,githubAccount,fullName,studentNumber,studentEmail,classCode,assignment,sha,passed,total,score,gradedAt,late,notes,aiScore,failures";
const csvCell = v => { const s = String(v ?? ""); return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

function gradesCsv(cls) {
  const lines = [CSV_HEAD];
  for (const row of rowsOf(cls)) {
    lines.push([row.repo, row.st.github, row.st.name, row.st.number, row.st.email, cls.section, row.aid, row.sha,
      row.passed, row.total, "", "2026-07-27", row.late ? "true" : "", "", row.aiScore ?? "", ""].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

// AI note drafts: student-facing prose above the rule, instructor-only block
// below it (proposed score + the AI-authored likelihood call). Same contract the
// engine writes, so parseNote / the review drawer behave exactly as in real use.
const PROJECT_PROSE = [
`Your page holds together as one design rather than three stacked ideas, and that is the hardest part to get right. The hero has a clear focal point, the type scale steps down consistently, and the card grid keeps even gutters at every width I looked at.

Two things to push on. The nav sits almost flush against the hero on the narrow view, so the page opens feeling cramped: a little breathing room there buys a lot. And your body copy runs close to 95 characters per line on desktop; cap the measure around 70 and it gets noticeably easier to read.

The colour choices are deliberate and you stayed inside your own palette. Next step is contrast, specifically the muted grey on white in the footer.`,
`The layout is solid and the content is genuinely readable, which matters more than decoration. Your section rhythm is even, and reusing one card component instead of hand-styling each block is exactly the instinct this activity was after.

Where it thins out is state and detail. Links look identical whether hovered or not, so the page feels inert; a hover and focus style would fix that in a few lines. The mobile view also loses the image aspect ratio, which stretches two of the three cards.

Keep the restraint. It reads as considered rather than plain.`,
`There is real care in the small stuff here: consistent corner radii, aligned baselines, and a footer that does not fight the rest of the page. The grid holds at both widths I checked.

The weak spot is hierarchy. The section headings and the body text sit close enough in size and weight that the eye has to hunt for the structure. One more step of contrast in the heading scale would do it. The call to action also sits below the fold on mobile, which hides the one thing you most want tapped.

Semantics are clean and the markup validates.`,
];
const CODE_PROSE = [
`The refactor did the main thing it needed to do: the long function is now three named pieces, and each one is small enough to read in a single pass. Naming is honest, and I can follow the flow without holding the whole file in my head.

Two notes. There is still a piece of duplicated validation in two of the helpers, and pulling it into one place would remove the risk of them drifting apart later. Second, a few of the early returns swallow the error case silently, so a bad input looks the same as a valid one.

Tests pass and the structure is genuinely better than the starting point.`,
`Clean, readable work. Your helpers each do one thing, the loop bodies are short, and you removed the nested conditional that made the original hard to reason about.

What is missing is defensiveness at the edges. Empty input takes the happy path and returns a confusing result rather than failing clearly. There is also a magic number sitting in the middle of the calculation with no name attached to explain it.

Comments are used where the reasoning is non-obvious rather than restating the code, which is the right habit.`,
`This works, and the behaviour is correct, but it is still doing too much in one place. The main function carries three responsibilities and the reader has to keep all of them in mind at once. Splitting on those seams is the next move, and the tests you already have make that safe to do.

Variable names improved a lot from the previous activity. A couple of single-letter names survive in the inner loop where the meaning is not obvious.`,
];
const VIBE_LINE = {
  low: "low - the commit history shows incremental work and the style matches this student's earlier activities",
  medium: "medium - two large commits and a couple of idioms not covered in this module; worth a look",
  high: "high - a single large commit, patterns well beyond the module, and no intermediate history",
};

function noteFor(cls, row) {
  const a = row.act, max = a.engine.totalPoints;
  const auto = Math.round((row.passed / row.total) * max * 0.7);
  const design = row.proposed - auto;
  const prose = (a.engine.feedback === "project" ? PROJECT_PROSE : CODE_PROSE)[row.st.seed % 3];
  const flag = row.vibe === "high"
    ? "\nFlag: proposed score sits well above this student's other work - read the code before applying\n" : "";
  return "# " + row.aid + " feedback draft\n\n_Held for instructor review. The student sees the prose above the rule only._\n\n"
    + prose + "\n\n---\n"
    + "Proposed total: " + row.proposed + "/" + max + "\n"
    + "Breakdown: automated " + auto + "/" + Math.round(max * 0.7) + " · "
    + (a.engine.feedback === "project" ? "design " : "code quality ") + design + "/" + Math.round(max * 0.3) + "\n"
    + "AI-authored likelihood: " + VIBE_LINE[row.vibe] + "\n" + flag;
}

function gradebookMd(cls) {
  const acts = cls.plan.map(a => a.id);
  const head = "| Student | # | " + acts.join(" | ") + " |";
  const sep = "| --- | --- | " + acts.map(() => "---").join(" | ") + " |";
  const rows = studentsOf(cls).slice(0, 14).map(st => {
    const cells = acts.map(aid => {
      const row = rowsOf(cls).find(r => r.aid === aid && r.st.github === st.github);
      if (!row) return "-";
      if (row.act.manual) return "manual";
      return row.passed + "/" + row.total;
    });
    return "| " + st.name + " | " + (st.number || "(blank)") + " | " + cells.join(" | ") + " |";
  });
  return "# Gradebook - " + cls.courseName + " " + cls.section + "\n\n_Synthetic demo data._ Graded 2026-07-27.\n\n"
    + head + "\n" + sep + "\n" + rows.join("\n") + "\n\n(first 14 of " + cls.nStudents + " students)\n";
}

function flagsMd(cls) {
  const rows = rowsOf(cls);
  const vibe = rows.filter(r => r.vibe === "high").length;
  const blanks = studentsOf(cls).filter(s => !s.number).length;
  return "# Flags - " + cls.section + "\n\n"
    + (vibe ? "- " + vibe + " submission(s) flagged high AI-authored likelihood, awaiting a read\n" : "")
    + (blanks ? "- " + blanks + " submission(s) with a blank student.json (identity unresolved)\n" : "")
    + "- 1 workspace missing for a student with graded work (run provision-workspaces)\n";
}

function crosscheckMd(cls) {
  const n = studentsOf(cls).length;
  return "# Canvas cross-check - " + cls.courseName + " " + cls.section + "\n\n"
    + "_Read-only audit. Synthetic demo data._\n\n## Identity\n\n"
    + "- " + (n - 2) + " of " + n + " gradebook students matched a Canvas roster entry\n"
    + "- 2 unmatched (blank student.json): resolve-identities can fix these from a Canvas-verified sibling\n\n"
    + "## Score agreement\n\n- " + Math.round(n * 2.4) + " cells agree with Canvas\n"
    + "- 3 cells differ: all three are submissions pushed after the last sweep, so re-sweep before the next push\n"
    + "- 0 locked-grade conflicts\n\n## Screenshots\n\n- previews branch readable for every design submission\n";
}

function coverageMd(cls) {
  return "# Repo coverage - " + cls.section + "\n\n_Every submission repo on the org vs the gradebook._\n\n"
    + "- " + rowsOf(cls).length + " submission repos graded\n"
    + "- 1 repo on the org with no gradebook row: a mis-named copy of the activity template (delete it, then prune-gradebook)\n"
    + "- 0 activities present on the org but missing from assignments.json\n";
}

function flaggedMd(cls) {
  if (!cls.sessions.length) return null;
  return "# Flagged attendance rows - " + cls.section + "\n\n"
    + "- 1 scan row on " + cls.sessions[cls.sessions.length - 1] + " failed signature verification (QR from another section)\n"
    + "- 2 rows recorded MANUAL (teacher-attested), counted present\n";
}

function attendanceSummary(cls) {
  if (!cls.sessions.length) return null;
  const students = {};
  for (const st of studentsOf(cls)) {
    if (!st.number) continue;
    const r = rng(st.seed);
    const present = cls.sessions.filter(() => r() < st.attend);
    students[st.number] = { present, count: present.length };
  }
  return JSON.stringify({ section: cls.section, sessionDates: cls.sessions, lastSession: cls.sessions[cls.sessions.length - 1], students }, null, 2);
}

function rosterJson(cls) {
  const o = {};
  for (const st of studentsOf(cls)) if (st.number) o[st.number] = st.name;
  return JSON.stringify(o, null, 2);
}

const INTENTS = {
  "teacher-cs401-1101-instructor": ["20260728-091500-gen-feedback-m3a2.md", "20260729-143012-apply-ai-m3a1.md"],
  "teacher-mob210-2202-instructor": ["20260729-101144-finalize-m3a6.md"],
  "teacher-web101-3303-instructor": [],
};

function unitReadme(cls, unit) {
  return "# " + unit.replace(/-/g, " ") + "\n\nCourse material for " + cls.courseName + ". Published into every student workspace by publish-material.\n";
}

// Build the teacher repo's virtual file map: { path -> {text} }.
function teacherFiles(cls) {
  return once("tf:" + cls.repo, () => {
    const f = new Map();
    const put = (p, text) => f.set(p, { text });
    // The real repos keep assignments.json in a compact one-object-per-line house
    // style, and config-writes.mjs depends on it: its surgical rebuild reuses each
    // untouched line's exact bytes so a lock/publish flip is a genuine one-line
    // diff. Pretty-printing here would silently push every toggle onto the
    // whole-file fallback path and misrepresent the feature.
    put("grader/assignments.json", "[\n" + cls.plan.map(a =>
      "  { " + Object.entries(a.engine).map(([k, v]) => JSON.stringify(k) + ": " + JSON.stringify(v)).join(", ") + " }"
    ).join(",\n") + "\n]\n");
    put("course.config.json", JSON.stringify({ courseName: cls.courseName, courseCode: cls.courseCode, section: cls.section, teachers: ["instructor"] }, null, 2) + "\n");
    put("gradebook/grades.csv", gradesCsv(cls));
    put("gradebook/GRADEBOOK.md", gradebookMd(cls));
    put("gradebook/FLAGS.md", flagsMd(cls));
    put("reports/canvas-crosscheck.md", crosscheckMd(cls));
    put("reports/repo-coverage.md", coverageMd(cls));
    const fl = flaggedMd(cls); if (fl) put("reports/FLAGGED.md", fl);
    const att = attendanceSummary(cls);
    if (att) { put("attendance/summary.json", att); put("attendance/roster.json", rosterJson(cls)); }
    for (const u of cls.units) put("content/" + u + "/README.md", unitReadme(cls, u));
    for (const name of (INTENTS[cls.repo] || [])) put("gradebook/intents/" + name, "Filed by the Course Console. Run this in a Claude Code session in the teacher repo.\n");
    for (const row of rowsOf(cls)) if (row.hasNote) put("gradebook/notes/" + row.aid + "/" + row.repo + ".md", noteFor(cls, row));
    return f;
  });
}

// ---- submission repos (code + preview screenshots) ----------------------
const JS_MAIN = (st, cls) => `// ${cls.code} ${cls.section} - submitted by @${st.github}
import { formatTitle, byRating } from "./helpers.js";

const shows = [
  { title: "night market", rating: 4.5, tags: ["food", "walk"] },
  { title: "old harbour", rating: 4.1, tags: ["quiet"] },
  { title: "rooftop set", rating: 3.8, tags: ["music", "late"] },
];

function render(list) {
  const root = document.querySelector("#cards");
  root.innerHTML = "";
  for (const item of list.sort(byRating)) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = \`
      <h2 class="card__title">\${formatTitle(item.title)}</h2>
      <p class="card__meta">\${item.rating.toFixed(1)} · \${item.tags.join(" / ")}</p>\`;
    root.append(card);
  }
}

render(shows);
`;
const JS_HELPERS = st => `export function formatTitle(s) {
  // capitalise every word (my earlier version only did the first one)
  return s.split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function byRating(a, b) {
  return b.rating - a.rating;
}

// TODO: move the tag filter in here too - @${st.github}
`;
const CSS_MAIN = st => `:root {
  --ink: #1b1b1f;
  --paper: #fbfaf7;
  --accent: hsl(${(st.seed % 320) + 10} 62% 46%);
  --gap: 1.25rem;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  color: var(--ink);
  background: var(--paper);
  line-height: 1.55;
}

.hero {
  padding: 4rem 1.5rem 3rem;
  background: linear-gradient(160deg, var(--accent), transparent 70%);
}

#cards {
  display: grid;
  gap: var(--gap);
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  padding: var(--gap);
}

.card {
  border: 1px solid #e5e2da;
  border-radius: 12px;
  padding: 1rem;
  background: #fff;
}

.card__title { margin: 0 0 .35rem; font-size: 1.15rem; }
.card__meta { margin: 0; color: #6b6b73; font-size: .9rem; }
`;
const HTML_MAIN = (st, cls) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${st.first}'s picks</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="hero">
    <h1>${st.first}'s picks</h1>
    <p>A few places worth the walk. ${cls.code} ${cls.section}.</p>
  </header>
  <main id="cards"></main>
  <footer><small>Built for ${cls.courseName}.</small></footer>
  <script type="module" src="main.js"></script>
</body>
</html>
`;
const DART_MAIN = (st, cls) => `// ${cls.code} ${cls.section} - @${st.github}
import 'monster.dart';

void main() {
  final roster = <Monster>[
    Monster(name: 'Emberling', hp: 32, attack: 9, type: 'fire'),
    Monster(name: 'Tidewisp', hp: 38, attack: 7, type: 'water'),
  ];

  for (final m in roster) {
    print('\${m.name} (\${m.type}) hp=\${m.hp}');
  }

  final result = roster.first.battle(roster.last);
  print('winner: \${result.name}');
}
`;
const DART_MODEL = st => `class Monster {
  Monster({required this.name, required this.hp, required this.attack, required this.type});

  final String name;
  final String type;
  int hp;
  int attack;

  bool get fainted => hp <= 0;

  // effectiveness table - only the two types this activity needs
  double multiplierAgainst(String other) {
    if (type == 'fire' && other == 'water') return 0.5;
    if (type == 'water' && other == 'fire') return 2.0;
    return 1.0;
  }

  Monster battle(Monster other) {
    var me = hp, you = other.hp;
    while (me > 0 && you > 0) {
      you -= (attack * multiplierAgainst(other.type)).round();
      if (you <= 0) break;
      me -= (other.attack * other.multiplierAgainst(type)).round();
    }
    return me > 0 ? this : other;   // @${st.github}: ties go to the defender
  }
}
`;

function submissionFiles(cls, aid, handle) {
  const key = "sub:" + cls.repo + ":" + aid + ":" + handle;
  return once(key, () => {
    const st = studentsOf(cls).find(s => s.github === handle);
    if (!st) return null;
    const row = rowsOf(cls).find(r => r.aid === aid && r.st.github === handle);
    if (!row) return null;
    const main = new Map(), previews = new Map();
    const put = (p, text) => main.set(p, { text });
    if (cls.stack === "dart") { put("lib/main.dart", DART_MAIN(st, cls)); put("lib/monster.dart", DART_MODEL(st)); }
    else { put("index.html", HTML_MAIN(st, cls)); put("style.css", CSS_MAIN(st)); put("main.js", JS_MAIN(st, cls)); put("helpers.js", JS_HELPERS(st)); }
    if (row.act.shots) {
      // Mirrors the real previews-branch layout the project CI publishes:
      // previews/<stamp>/<page>-<width>.png. shots.mjs treats the first TWO path
      // segments as the timestamp folder and keeps only the latest, so a flatter
      // path here would silently drop all but one screenshot.
      const dir = "previews/2026-07-27T0400";
      previews.set(dir + "/home-desktop.png", { shot: { w: 1280, h: 800, st, cls, label: "home desktop" } });
      previews.set(dir + "/home-mobile.png", { shot: { w: 414, h: 820, st, cls, label: "home mobile" } });
    }
    return { main, previews };
  });
}

// ---- student workspace repos -------------------------------------------
function workspaceFiles(cls, handle) {
  return once("ws:" + cls.repo + ":" + handle, () => {
    const st = studentsOf(cls).find(s => s.github === handle);
    if (!st || st.noWorkspace) return null;
    const f = new Map();
    const put = (p, text) => f.set(p, { text });
    put("student.json", JSON.stringify({
      fullName: st.name, studentNumber: st.number, studentEmail: st.email,
      githubAccount: st.github, classCode: cls.section, subjectCode: cls.code,
      pcNumber: "", room: "",
    }, null, 2) + "\n");
    put("README.md", "# " + st.name + " - " + cls.courseName + " " + cls.section + "\n");
    const delivered = cls.plan.filter(a => a.engine.publish).map(a => a.id);
    if (delivered.length) put("grades/GRADES.md", "# Grades\n\n" + delivered.map(id => "- " + id + ": delivered\n").join(""));
    if (st.seed % 3 === 0) put("grades/FEEDBACK.md", "# Feedback\n\nInstructor notes for your submitted work.\n");
    if (cls.sessions.length && st.number) put("attendance/MY-ATTENDANCE.md", "# My attendance\n\nYour verified sessions for " + cls.section + ".\n");
    return f;
  });
}

// ---- repo resolution ---------------------------------------------------
// Order matters: the teacher repo name also matches the submission pattern.
export function resolveRepo(org, repo) {
  const cls = classByOrg(org);
  if (!cls) return null;
  if (repo === cls.repo) return { kind: "teacher", cls, files: { main: teacherFiles(cls), previews: new Map() } };
  let m = repo.match(/^student-[a-z0-9]+-[a-z0-9]+-(.+)$/i);
  if (m) { const f = workspaceFiles(cls, m[1]); return f ? { kind: "workspace", cls, files: { main: f, previews: new Map() } } : null; }
  m = repo.match(/^([a-z0-9]+)-[a-z0-9]+-(.+)$/i);
  if (m) { const f = submissionFiles(cls, m[1].toLowerCase(), m[2]); return f ? { kind: "submission", cls, files: f } : null; }
  return null;
}

// ---- Actions runs ------------------------------------------------------
// A believable history per workflow: mostly green, one red audit (which is the
// audit doing its job), one still running.
const RUN_HISTORY = {
  "grade.yml": [["success", 6], ["success", 30], ["success", 54]],
  "publish.yml": [["success", 25]],
  "canvas-push.yml": [["success", 27], ["failure", 51]],
  "canvas-sync-assignments.yml": [["success", 74]],
  "canvas-crosscheck.yml": [["success", 8]],
  "publish-material.yml": [["success", 33], ["success", 100]],
  "provision-workspaces.yml": [["success", 76]],
  "prune-gradebook.yml": [["success", 122]],
  "audit-names.yml": [["failure", 14]],
  "repo-coverage.yml": [["success", 9]],
  "verify-attendance.yml": [["success", 11], ["success", 179]],
  "publish-attendance.yml": [["success", 11]],
  "generate-attendance-qrs.yml": [["success", 320]],
  "resolve-identities.yml": [],
  "prune-phantom-activities.yml": [],
  "canvas-export.yml": [["success", 200]],
};
// Fixed "now" for run timestamps so the demo does not drift into the future.
const NOW = Date.parse("2026-07-30T09:00:00Z");
export function seedRuns(org, repo, file) {
  const hist = RUN_HISTORY[file] || [];
  const cls = classByOrg(org);
  if (!cls) return [];
  return hist.map(([conclusion, hoursAgo], i) => ({
    id: 90000 + (file.length * 100) + i,
    name: file, event: i === 0 ? "workflow_dispatch" : "schedule",
    status: "completed", conclusion,
    created_at: new Date(NOW - hoursAgo * 3600_000).toISOString(),
    html_url: "https://github.com/" + org + "/" + repo + "/actions",
  }));
}
