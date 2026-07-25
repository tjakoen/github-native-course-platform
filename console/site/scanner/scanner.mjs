// The standalone attendance scanner page (phone bookmark: …/scanner/).
// Boots from the discovery list only - no gradebook loads, near-zero API budget.
// Tokens/config come from the same-origin localStorage the console Settings
// wrote; setup happens once per device in the console, then this page just works.
import { loadConfig } from "../lib/store.mjs";
import { discoverSections } from "../lib/config.mjs";
import { renderScanView } from "../lib/attendance-scan.mjs";

const mount = document.getElementById("scanMount");
const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

(async () => {
  const c = loadConfig();
  if (!c) {
    mount.innerHTML = "<div class='boot'>Not set up yet. Open the <a href='../'>Course Console</a> on this device once and add your teacher repos + tokens in Settings - they are stored in this browser and shared with this page.</div>";
    return;
  }
  mount.innerHTML = "<div class='boot'>Finding your classes…</div>";
  try {
    const { sections, errors } = await discoverSections(c.repos, c.labels || {});
    if (!sections.length) {
      mount.innerHTML = "<div class='boot'>No teacher repos reachable." + (errors.length ? " " + esc(errors.map(e => e.err).join(" · ")) : "") + " Check Settings in the <a href='../'>console</a>.</div>";
      return;
    }
    mount.innerHTML = "";
    renderScanView(mount, sections, null);
  } catch (e) {
    mount.innerHTML = "<div class='boot'>Load failed: " + esc(e.message) + "</div>";
  }
})();
