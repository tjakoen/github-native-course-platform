// The console's live cmdk source. Registered once at boot via the grain 0.1.10
// palette hook (window.cmdk.register). Everything is built in memory from the
// current session's state: static routes always; classes after discovery;
// activities + students only for sections the teacher's token has actually
// loaded in this browser. Nothing is ever written to disk - the PII stays as
// transient as the page itself (the Pages artifact ships NO search.json).
import { sections, sectionCached, invalidate } from "./data.mjs";

const norm = s => String(s || "").toLowerCase();

export function initSearch(refreshView) {
  if (!window.cmdk || !window.cmdk.register) return;
  window.cmdk.register(q => {
    const items = [];
    const hit = (...hay) => !q || hay.some(h => norm(h).includes(q));
    const push = (title, subtitle, kind, urlOrAction) => {
      if (!hit(title, subtitle)) return;
      const e = { title, subtitle, kind };
      if (typeof urlOrAction === "function") e.action = urlOrAction; else e.url = urlOrAction;
      items.push(e);
    };

    push("Dashboard", "all classes", "View", "#/");
    push("Settings", "repos, tokens, decision backups", "View", "#/settings");
    push("Attendance scanner", "QR scanner (phone)", "View", "scanner/");

    for (const sc of sections()) {
      const label = sc.subject + " · " + sc.section;
      const base = "#/c/" + encodeURIComponent(sc.key);
      push(label, "overview", "Class", base);
      push(label + " gradebook", "the grade matrix", "Class", base + "/gradebook");
      push(label + " students", "roster + profiles", "Class", base + "/students");
      push(label + " review", "held AI grades", "Class", base + "/review");
      push(label + " attendance", "", "Class", base + "/attendance");
      push(label + " ops", "run engine workflows", "Class", base + "/ops");
      push("Refresh " + label, "re-fetch from GitHub", "Action", () => { invalidate(sc.key); location.hash = base; refreshView(); });

      const s = sectionCached(sc.key);
      if (!s) continue;
      for (const a of s.assignments) {
        // deep-link to where the activity actually lives: AI activities open the
        // review detail for that id (not the bare /review), others the gradebook.
        push(a.id + (a.title ? " · " + a.title : ""), label + (a.aiGraded ? " · AI review" : ""), "Activity",
          "#/c/" + encodeURIComponent(sc.key) + (a.aiGraded ? "/review/" + encodeURIComponent(a.id) : "/gradebook"));
      }
      for (const st of s.students) {
        const sk = st.number || st.name;
        push(st.name || "(blank)", "#" + (st.number || "?") + " · " + label, "Student",
          "#/c/" + encodeURIComponent(sc.key) + "/students/" + encodeURIComponent(sk));
      }
    }
    // activities + students only exist for LOADED classes; without a hint, an
    // unloaded class's roster is silently absent from search. Surface a visible row.
    if (q) {
      const unloaded = sections().filter(sc => !sectionCached(sc.key)).length;
      if (unloaded) items.push({ title: "Load classes to search activities & students", subtitle: unloaded + " class(es) not loaded yet", kind: "Hint", url: "#/" });
    }
    return items.slice(0, 20);
  });
}
