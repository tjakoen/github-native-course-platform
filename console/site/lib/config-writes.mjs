// Sha-guarded edits to grader/assignments.json - the tiered write model's
// "config toggle" lane: a one-key change (locked / publish), shown as a
// before/after diff in a native <dialog>, committed only on explicit confirm,
// re-asked on a sha race. Anything richer than a flag flip stays an intent.
import { ghJSON, putFile } from "./gh.mjs";

const b64dec = b => new TextDecoder().decode(Uint8Array.from(atob(String(b).replace(/\n/g, "")), c => c.charCodeAt(0)));
const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function detectIndent(text) {
  const m = text.match(/^\n?(\s+)"/m) || text.match(/\n(\s+)\{/);
  return m ? m[1].replace(/\n/g, "") : "  ";
}

// mutator(entries) mutates the parsed array in place and returns a short human
// summary line, or null to abort. Resolves true if committed.
export async function editAssignments(sc, mutator, title) {
  for (;;) {
    const j = await ghJSON(`/repos/${sc.org}/${sc.repo}/contents/grader/assignments.json`);
    if (!j || !j.content) throw new Error("grader/assignments.json not readable");
    const beforeText = b64dec(j.content);
    const entries = JSON.parse(beforeText);
    const summary = mutator(entries);
    if (!summary) return false;
    const afterText = JSON.stringify(entries, null, detectIndent(beforeText)) + "\n";

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
        "<div style='display:flex;gap:8px;margin-top:10px'><button class='btn' data-size='sm' id='cwOk'>Commit</button><button class='btn' data-size='sm' data-variant='soft' id='cwNo'>Cancel</button></div>";
      document.body.append(d);
      d.showModal();
      d.querySelector("#cwOk").onclick = () => { d.close(); d.remove(); resolve(true); };
      d.querySelector("#cwNo").onclick = () => { d.close(); d.remove(); resolve(false); };
      d.addEventListener("cancel", () => { d.remove(); resolve(false); });
    });
    if (!ok) return false;

    try {
      await putFile(sc.org, sc.repo, "grader/assignments.json", afterText, ":wrench: " + summary + " (via Course Console)", j.sha);
      return true;
    } catch (e) {
      if (/409|does not match/i.test(e.message)) continue;   // sha race: refetch, re-diff, re-ask
      throw e;
    }
  }
}
