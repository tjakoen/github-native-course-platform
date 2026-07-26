// Sha-guarded edits to grader/assignments.json - the tiered write model's
// "config toggle" lane: a one-key change (locked / publish), shown as a
// before/after diff in a native <dialog>, committed only on explicit confirm,
// re-asked on a sha race. Anything richer than a flag flip stays an intent.
//
// The edit is SURGICAL: untouched activity objects keep their exact original
// bytes, so a lock/publish flip is a genuine one-line diff (not a whole-file
// reformat). The compact "one object per line" house style is preserved. A
// round-trip check (parse the result, deep-compare to the intended array)
// gates the surgical path; on any mismatch it falls back to a clean compact
// re-serialization so the committed file always parses to exactly what the
// mutator produced.
import { ghJSON, putFile } from "./gh.mjs";

const b64dec = b => new TextDecoder().decode(Uint8Array.from(atob(String(b).replace(/\n/g, "")), c => c.charCodeAt(0)));
const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One compact object line in the file's house style:
//   { "id": "m1a1", "type": "dart", "locked": true, "publish": true }
// Object.entries preserves the object's own key order, so flipping an existing
// value in place leaves every other token (and the key order) byte-identical.
const compactObj = (e, indent) => indent + "{ " + Object.entries(e).map(([k, v]) => JSON.stringify(k) + ": " + JSON.stringify(v)).join(", ") + " }";
const compactArray = (entries, indent) => entries.length ? "[\n" + entries.map(e => compactObj(e, indent)).join(",\n") + "\n]\n" : "[]\n";

// Rebuild the file reusing each unchanged object's original raw line and only
// re-serializing the changed/new one(s). Returns null (=> caller falls back) if
// the file is not the expected array-of-id-objects compact form.
function surgicalText(beforeText, before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) return null;
  const lines = beforeText.split("\n");
  const rawById = new Map();
  for (const e of before) {
    if (!e || typeof e.id !== "string") return null;
    const idTok = JSON.stringify(e.id);
    const line = lines.find(l => l.includes('"id"') && l.includes(idTok) && l.trim().startsWith("{"));
    if (line == null) return null;               // not one-object-per-line: bail to fallback
    if (rawById.has(e.id)) return null;          // duplicate id: can't safely map lines
    rawById.set(e.id, line.replace(/,\s*$/, "")); // drop the source trailing comma; join re-adds uniformly
  }
  const firstLine = rawById.get(before[0]?.id);
  const indent = firstLine ? (firstLine.match(/^(\s*)/)[1] || "  ") : "  ";
  const beforeById = new Map(before.map(e => [e.id, e]));
  const body = after.map(e => {
    const prev = beforeById.get(e.id);
    if (prev && deepEqual(prev, e)) return rawById.get(e.id);   // untouched: reuse exact bytes
    return compactObj(e, indent);                                // changed or new: reserialize
  });
  return "[\n" + body.join(",\n") + "\n]\n";
}

// mutator(entries) mutates the parsed array in place and returns a short human
// summary line, or null to abort. Resolves true if committed.
export async function editAssignments(sc, mutator, title) {
  for (;;) {
    const j = await ghJSON(`/repos/${sc.org}/${sc.repo}/contents/grader/assignments.json`);
    if (!j || !j.content) throw new Error("grader/assignments.json not readable");
    const beforeText = b64dec(j.content);
    const before = JSON.parse(beforeText);
    const after = JSON.parse(beforeText);          // separate copy the mutator edits
    const summary = mutator(after);
    if (!summary) return false;

    // Prefer the surgical rebuild; validate it round-trips to the intended
    // array, else fall back to a clean compact re-serialization.
    let afterText = surgicalText(beforeText, before, after);
    const indent = (beforeText.match(/\n(\s+)\{/) || [])[1] || "  ";
    if (afterText == null || !deepEqual(JSON.parse(afterText), after)) afterText = compactArray(after, indent);

    const beforeLines = beforeText.split("\n"), afterLines = afterText.split("\n");
    const diff = [];
    let i = 0, k = 0;
    while (i < beforeLines.length || k < afterLines.length) {
      if (beforeLines[i] === afterLines[k]) { i++; k++; continue; }
      if (i < beforeLines.length && !afterLines.includes(beforeLines[i])) { diff.push("- " + beforeLines[i++]); continue; }
      if (k < afterLines.length) { diff.push("+ " + afterLines[k++]); continue; }
      i++;
    }
    const shown = diff.length ? diff.join("\n") : "(reformat only)";

    const ok = await new Promise(resolve => {
      const d = document.createElement("dialog");
      d.className = "confirm-dialog";
      d.innerHTML = "<h3>" + esc(title) + "</h3>" +
        "<p class='muted'>" + esc(summary) + " - one commit to <code>grader/assignments.json</code> on " + esc(sc.repo) + ".</p>" +
        "<pre class='code-block prompt'>" + esc(shown) + "</pre>" +
        "<div style='display:flex;gap:var(--space-2);margin-top:10px'><button class='btn' data-size='sm' id='cwOk'>Commit</button><button class='btn' data-size='sm' data-variant='soft' id='cwNo'>Cancel</button></div>";
      document.body.append(d);
      d.showModal();
      d.querySelector("#cwOk").onclick = () => { d.close(); d.remove(); resolve(true); };
      d.querySelector("#cwNo").onclick = () => { d.close(); d.remove(); resolve(false); };
      d.addEventListener("cancel", () => { d.remove(); resolve(false); });
    });
    if (!ok) return false;

    try {
      await putFile(sc.org, sc.repo, "grader/assignments.json", afterText, ":wrench: " + summary + " (via Course Console)", j.sha);
      return after;   // the committed array (truthy) so the caller can patch the cached sc.pol
    } catch (e) {
      if (/409|does not match/i.test(e.message)) continue;   // sha race: refetch, re-diff, re-ask
      throw e;
    }
  }
}
