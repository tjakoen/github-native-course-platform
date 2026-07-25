// The Scan tab: the per-teacher-repo attendance QR scanner, absorbed into the
// console. Ported from the retired attendance/scanner.html - the DATA CONTRACT
// IS FROZEN so the per-repo workflows need zero changes:
//   path    attendance/sessions/<date>/<HHMM>-<label>.csv
//   header  timestamp,studentNumber,signature
//   stamp   YYYY-MM-DD HH:MM:SS (local)
//   message ":memo: Attendance <date> <HHMM>-<label> (<n>)"
//   merge   union by studentNumber, earliest timestamp wins, sha-guarded PUT
//   QR      <section>.<studentNumber>.<sig> (current) or <studentNumber>.<sig>
//           (legacy); wrong-section 3-field codes are rejected at scan time.
// Signatures are verified server-side by verify-attendance (the HMAC secret
// never lives here); roster.json is names-only. The repo PAT from Settings is
// the only credential (Contents RW - the same scope intents already need).
import { ghJSON, putFile } from "./gh.mjs";
import { startScan } from "./scan.mjs";

const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const unb64 = b => new TextDecoder().decode(Uint8Array.from(atob(String(b).replace(/\n/g, "")), c => c.charCodeAt(0)));
const sanitize = s => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "batch";
const pad = n => String(n).padStart(2, "0");
const localStamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

let ctl = null;          // active camera controller
export function stopScanner() { if (ctl) { try { ctl.stop(); } catch { /* already stopped */ } ctl = null; } }

// Renders the Scan tab into `mount`. `sections` needs only {key, org, repo,
// section, subject} per entry (both discovery objects and fully loaded sections
// qualify), so this view also works on the fast #/scan boot path that skips
// gradebook loading entirely.
export function renderScanView(mount, sections, initialKey) {
  stopScanner();
  let sec = sections.find(s => s.key === initialKey) || sections[0];
  let roster = {};        // number -> name
  let batch = null;       // { date, hhmm, label, rows: Map(num -> {num,name,ts,sig}) }

  const box = document.createElement("div");
  box.className = "scanview";
  box.innerHTML =
    '<div class="card" data-pad="sm" style="display:flex;flex-direction:column;gap:10px">' +
      '<div class="row" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">' +
        '<label class="field" style="flex:1;min-width:180px"><span class="field__label">Section</span>' +
          '<select class="field__select" id="scSec">' +
          sections.map(s => `<option value="${esc(s.key)}"${s === sec ? " selected" : ""}>${esc(s.subject)} · ${esc(s.section)} (${esc(s.org)})</option>`).join("") +
          "</select></label>" +
        '<button class="btn" id="scStart" type="button">Start camera</button>' +
      "</div>" +
      '<p class="muted" id="scRoster" style="margin:0"></p>' +
    "</div>" +
    '<div class="card hide" data-pad="sm" id="scBatchBox" style="display:none;flex-direction:column;gap:10px">' +
      '<div class="field"><span class="field__label">Batch label (e.g. on-time, late, class-A)</span>' +
        '<div style="display:flex;gap:8px"><input class="field__input" id="scLabel" value="on-time" style="flex:1;min-width:0">' +
        '<button class="btn" data-variant="soft" id="scNew" type="button" style="flex:0 0 auto">New batch</button></div></div>' +
      '<p class="muted" id="scBatchInfo" style="margin:0"></p>' +
    "</div>" +
    '<div class="card" data-pad="sm" id="scCamBox" style="display:none;flex-direction:column;gap:10px">' +
      '<video id="scVideo" class="scan-video"></video>' +
      '<div id="scStatus" class="scan-status" style="display:none"></div>' +
    "</div>" +
    '<div class="card" data-pad="sm" id="scListBox" style="display:none;flex-direction:column;gap:10px">' +
      '<p style="margin:0">Scanned this batch: <span class="badge" data-status="active" id="scCount">0</span></p>' +
      '<ul class="status-list" id="scList" data-grade="smooth"></ul>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<button class="btn" id="scCommit" type="button">Commit batch</button>' +
        '<span class="muted" id="scMsg"></span></div>' +
    "</div>";
  mount.append(box);
  const $ = id => box.querySelector("#" + id);

  async function loadRoster() {
    $("scRoster").textContent = "Loading roster…";
    roster = {};
    try {
      const j = await ghJSON(`/repos/${sec.org}/${sec.repo}/contents/attendance/roster.json`);
      if (j && j.content) roster = JSON.parse(unb64(j.content));
      const n = Object.keys(roster).length;
      $("scRoster").textContent = n ? `Roster loaded (${n} students).` : "No roster.json yet - scanning still works, names blank.";
    } catch (e) { $("scRoster").textContent = "Roster load failed: " + e.message; }
  }

  function startBatch() {
    const d = new Date();
    batch = {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      hhmm: `${pad(d.getHours())}${pad(d.getMinutes())}`,
      label: sanitize($("scLabel").value), rows: new Map(),
    };
    renderList();
    $("scBatchInfo").textContent = `Batch: ${batch.date} ${batch.hhmm} / ${batch.label}  ->  attendance/sessions/${batch.date}/${batch.hhmm}-${batch.label}.csv`;
  }

  function showStatus(cls, text) {
    const s = $("scStatus");
    s.className = "scan-status " + cls; s.textContent = text; s.style.display = "";
    if (navigator.vibrate) navigator.vibrate(cls === "ok" ? 60 : 30);
  }

  function onScan(text) {
    const parts = String(text).split(".");
    let qrSection = null, num, sig;
    if (parts.length >= 3) { [qrSection, num, sig] = parts; } else { [num, sig] = parts; }
    if (!num) { showStatus("bad", "Unreadable QR"); return; }
    if (qrSection && sec.section && qrSection !== sec.section) {
      showStatus("bad", `Wrong class - QR is for section ${qrSection}, not ${sec.section}`); return;
    }
    if (batch.rows.has(num)) { showStatus("dup", `Already scanned: ${roster[num] || num}`); return; }
    const name = roster[num] || "";
    batch.rows.set(num, { num, name, sig: sig || "", ts: localStamp(new Date()) });
    showStatus("ok", `${name || "#" + num} recorded`);
    renderList();
  }

  function renderList() {
    $("scCount").textContent = batch.rows.size;
    const ul = $("scList"); ul.innerHTML = "";
    [...batch.rows.values()].forEach(r => {
      const li = document.createElement("li");
      li.className = "status-list__item";
      li.innerHTML = `<span class="status-list__mark">✓</span><span class="status-list__title">${esc(r.name || "#" + r.num)} <span class="badge" data-status="archived">${esc(r.num)}</span></span><span class="status-list__meta">${esc(r.ts.slice(11))} <button class="btn" data-variant="soft" data-size="sm" data-status="danger" type="button">Remove</button></span>`;
      li.querySelector("button").onclick = () => { batch.rows.delete(r.num); renderList(); };
      ul.appendChild(li);
    });
  }

  $("scSec").onchange = () => {
    sec = sections.find(s => s.key === $("scSec").value) || sec;
    stopScanner();
    ["scBatchBox", "scCamBox", "scListBox"].forEach(id => { $(id).style.display = "none"; });
    $("scStart").disabled = false; $("scStart").textContent = "Start camera";
    loadRoster();
  };

  $("scStart").onclick = async () => {
    $("scStart").disabled = true; $("scStart").textContent = "Starting…";
    try {
      ["scBatchBox", "scCamBox", "scListBox"].forEach(id => { $(id).style.display = "flex"; });
      startBatch();
      ctl = await startScan($("scVideo"), onScan);
      $("scStart").textContent = "Camera on";
    } catch (e) {
      $("scStart").disabled = false; $("scStart").textContent = "Start camera";
      showStatus("bad", "Camera failed: " + e.message);
      $("scCamBox").style.display = "flex";
    }
  };
  $("scNew").onclick = startBatch;

  $("scCommit").onclick = async () => {
    if (!batch || !batch.rows.size) { $("scMsg").textContent = "Nothing to commit yet."; return; }
    const path = `attendance/sessions/${batch.date}/${batch.hhmm}-${batch.label}.csv`;
    $("scCommit").disabled = true; $("scMsg").textContent = "Committing…";
    try {
      // Merge with whatever is already in this batch's file (safe re-commit):
      // union by student number, keeping the earliest timestamp already recorded.
      const merged = new Map();
      let sha;
      const existing = await ghJSON(`/repos/${sec.org}/${sec.repo}/contents/${path}`);
      if (existing && existing.content) {
        sha = existing.sha;
        unb64(existing.content).split(/\r?\n/).forEach(line => {
          const [ts, num, sig] = line.split(",").map(c => (c || "").trim());
          if (num && num.toLowerCase() !== "studentnumber") merged.set(num, { ts, num, sig });
        });
      }
      batch.rows.forEach(r => { if (!merged.has(r.num)) merged.set(r.num, { ts: r.ts, num: r.num, sig: r.sig }); });
      const rows = [...merged.values()].sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
      const csv = "timestamp,studentNumber,signature\n" + rows.map(r => `${r.ts},${r.num},${r.sig}`).join("\n") + "\n";
      await putFile(sec.org, sec.repo, path, csv, `:memo: Attendance ${batch.date} ${batch.hhmm}-${batch.label} (${rows.length})`, sha);
      $("scMsg").textContent = `Committed ${rows.length} to ${path}`;
    } catch (e) { $("scMsg").textContent = "Error: " + e.message; }
    finally { $("scCommit").disabled = false; }
  };

  loadRoster();
  return { stop: stopScanner };
}
