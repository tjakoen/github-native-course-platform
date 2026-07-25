// grain/scripts/tabs.js — OPEN TABS: the tab-bar becomes the editor's open-pages strip.
//
// The shell is an MPA — every navigation is a real page load — so "open tabs" is a client-side
// PROJECTION of where you've been (localStorage), never an SPA router. On load the island reads
// the stored list, appends the current path if it's new, and renders the strip; each tab is a
// real <a>, so navigation stays plain hypermedia. Zero-JS the strip shows only its server-rendered
// PINNED tabs (the markup's static <a data-pinned> children — never closable, never stored) and
// the page navigates by its other nav (e.g. a file-tree rail).
//
// OPT-IN: mark the strip `data-open-tabs` (on the .tab-bar nav). Labels come from a
// `data-tab-source` container elsewhere on the page (e.g. the explorer file-tree): the anchor
// there whose href matches the path lends its text — or its `data-tab-label` if set; a path with
// no source entry falls back to its last segment. The × (`.tab__close`, presentational in the
// molecule) is wired here as a REAL control: closing the active tab navigates to the neighbor
// (falling back to the first pinned tab); closing a background tab just drops it from the list.
// Pure UI chrome — it knows nothing about the AI door (like shell.js).
(() => {
  "use strict";
  if (window.grain && window.grain.tabs) return;   // idempotent
  const KEY = "grain.tabs.open";
  const CAP = 20;                                   // storage sanity; the strip itself scrolls

  const norm = (p) => { try { p = new URL(p, location.origin).pathname; } catch { /* keep as-is */ }
    return p.replace(/\/+$/, "") || "/"; };
  const load = () => { try { return (JSON.parse(localStorage.getItem(KEY) || "[]") || []).map(norm); } catch { return []; } };
  const save = (l) => { try { localStorage.setItem(KEY, JSON.stringify(l.slice(-CAP))); } catch { /* private mode */ } };

  function init() {
    const strip = document.querySelector("[data-open-tabs]");
    if (!strip) return;
    const here = norm(location.pathname);
    const pinned = new Set([...strip.querySelectorAll("a[data-pinned]")].map((a) => norm(a.getAttribute("href") || "/")));

    // the label source: the explorer tree (or any nav) marked data-tab-source
    const source = document.querySelector("[data-tab-source]");
    const labelOf = (path) => {
      for (const a of source ? source.querySelectorAll("a[href]") : []) {
        if (norm(a.getAttribute("href")) !== path) continue;
        return a.getAttribute("data-tab-label") || a.textContent.trim() || path;
      }
      return path === "/" ? "/" : path.split("/").filter(Boolean).pop();
    };

    let list = load().filter((p) => !pinned.has(p));
    if (!pinned.has(here) && !list.includes(here)) list.push(here);
    save(list);

    const render = () => {
      for (const el of strip.querySelectorAll("a:not([data-pinned])")) el.remove();
      for (const path of list) {
        const a = document.createElement("a");
        a.className = "tab";
        a.href = path;
        const label = document.createElement("span");
        label.textContent = labelOf(path);
        const close = document.createElement("span");
        close.className = "tab__close";
        close.setAttribute("role", "button");
        close.setAttribute("tabindex", "0");
        close.setAttribute("aria-label", `Close ${label.textContent}`);
        close.style.pointerEvents = "auto";          // the molecule ships it presentational; this strip wires it live
        close.textContent = "×";
        const onClose = (e) => { e.preventDefault(); e.stopPropagation(); closeTab(path); };
        close.addEventListener("click", onClose);
        close.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") onClose(e); });
        a.append(label, close);
        if (path === here) a.setAttribute("aria-current", "page");
        strip.appendChild(a);
      }
      // pinned tabs get their current-mark here too (shell.js may have run before we rendered)
      for (const a of strip.querySelectorAll("a[data-pinned]"))
        if (norm(a.getAttribute("href") || "/") === here) a.setAttribute("aria-current", "page");

      // the explorer (data-tab-source) gets a close × on any file that's an open tab too —
      // closing from the sidebar without switching to the page first. Idempotent: adds/removes
      // the span to match `list` on every render, never duplicates.
      for (const a of source ? source.querySelectorAll("a[href]") : []) {
        const path = norm(a.getAttribute("href"));
        const existing = a.querySelector(":scope > .file-tree__close");
        if (!list.includes(path)) { existing?.remove(); continue; }
        if (existing) continue;
        const close = document.createElement("span");
        close.className = "file-tree__close";
        close.setAttribute("role", "button");
        close.setAttribute("tabindex", "0");
        close.setAttribute("aria-label", `Close ${a.textContent.trim()}`);
        close.style.pointerEvents = "auto";     // the molecule ships it presentational; wire it live
        close.textContent = "×";
        const onClose = (e) => { e.preventDefault(); e.stopPropagation(); closeTab(path); };
        close.addEventListener("click", onClose);
        close.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") onClose(e); });
        a.appendChild(close);
      }

      // "close all": only meaningful once something closable is actually open
      for (const b of allBtns) b.hidden = list.length === 0;
    };

    const closeTab = (path) => {
      const i = list.indexOf(path);
      list = list.filter((p) => p !== path);
      save(list);
      if (path !== here) return render();
      // closing the page you're ON: go to the neighbor tab, else the first pinned tab, else home
      const next = list[Math.min(i, list.length - 1)]
        || (strip.querySelector("a[data-pinned]") || {}).getAttribute?.("href") || "/";
      location.assign(next);
    };

    const closeAll = () => {
      const wasHere = list.includes(here);
      list = [];
      save(list);
      if (!wasHere) return render();
      location.assign((strip.querySelector("a[data-pinned]") || {}).getAttribute?.("href") || "/");
    };

    const allBtns = document.querySelectorAll('[data-shell="tabs-close-all"]');
    for (const b of allBtns) b.addEventListener("click", closeAll);

    render();
    window.grain = window.grain || {};
    // refresh: re-resolve labels (e.g. after an island fills the data-tab-source tree lazily)
    window.grain.tabs = { open: () => [...list], close: closeTab, closeAll, refresh: render };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
