// grain/scripts/cmdk.js — global command palette (Spotlight / Notion ⌘K style).
//
// Self-contained: one <script> tag drops it onto any page. A <link> to cmdk.css
// must precede it. Injects a native <dialog>, binds ⌘K / Ctrl+K, fetches
// /search.json once, filters, and navigates. Monochrome e-ink look via the page's
// design tokens. Today it indexes pages + components; the seam to add tasks/knowledge
// — and to let a result EMIT an intent through the one door (palette as another
// action-vocabulary client) — is marked below.
(() => {
  "use strict";
  let data = null, items = [], sel = 0, root, input, list;

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const isOpen = () => !!(root && root.open);

  function build() {
    // native modal <dialog>: focus-trap + focus-restore + Escape + ::backdrop + top-layer
    // for free — no backdrop div, no manual Escape handling, no z-index races.
    root = document.createElement("dialog");
    root.className = "cmdk";
    root.setAttribute("aria-label", "Search");
    root.innerHTML = `
      <div class="cmdk__row">
        <svg class="icon cmdk__icon" aria-hidden="true"><use href="/assets/sprite.svg#search"></use></svg>
        <input class="cmdk__input" type="text" placeholder="Search pages and components…" aria-label="Search">
      </div>
      <ul class="cmdk__list" role="listbox"></ul>
      <div class="cmdk__hint">↑↓ navigate · ↵ open · esc close</div>`;
    document.body.appendChild(root);
    input = root.querySelector(".cmdk__input");
    list = root.querySelector(".cmdk__list");
    root.addEventListener("click", (e) => { if (e.target === root) close(); });   // light-dismiss: click the backdrop
    input.addEventListener("input", render);
    input.addEventListener("keydown", onKey);
    list.addEventListener("click", (e) => { const li = e.target.closest(".cmdk__item"); if (li) { sel = +li.dataset.i; activate(); } });
    list.addEventListener("mousemove", (e) => { const li = e.target.closest(".cmdk__item"); if (li && +li.dataset.i !== sel) { sel = +li.dataset.i; paint(); } });
  }

  async function load() {
    if (data) return;
    try { data = await (await fetch("/search.json")).json(); }
    catch { data = { pages: [], components: [] }; }
  }

  const corpus = () => [
    ...(data.pages || []).map((p) => ({ ...p, kind: "Page" })),
    ...(data.components || []).map((c) => ({ ...c, kind: "Component" })),
    // SEAM: tasks/knowledge entries, and "command" entries that emit an intent
    // through /intent (palette = another client of the one door) — AI-INTERFACE §6.
  ];

  function paint() {
    [...list.children].forEach((el, i) => el.classList && el.classList.toggle("is-sel", i === sel));
    if (list.children[sel]) list.children[sel].scrollIntoView({ block: "nearest" });
  }

  function render() {
    const q = input.value.trim().toLowerCase();
    // match on the URL too — Quick Open by path ("notes/ten", "grain/docs") like an editor's ⌘P
    items = corpus().filter((e) => !q || (e.title + " " + (e.subtitle || "") + " " + (e.url || "")).toLowerCase().includes(q)).slice(0, 30);
    sel = 0;
    list.innerHTML = items.length
      ? items.map((e, i) => `<li class="cmdk__item${i === 0 ? " is-sel" : ""}" role="option" data-i="${i}">
          <span class="cmdk__title">${esc(e.title)}</span>
          ${e.subtitle ? `<span class="cmdk__sub">${esc(e.subtitle)}</span>` : ""}
          <span class="cmdk__kind">${esc(e.kind)}</span></li>`).join("")
      : `<li class="cmdk__empty">No matches</li>`;
  }

  function move(d) { if (!items.length) return; sel = (sel + d + items.length) % items.length; paint(); }
  function activate() { const e = items[sel]; if (e && e.url) location.assign(e.url); }

  function onKey(ev) {
    if (ev.key === "ArrowDown") { ev.preventDefault(); move(1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); move(-1); }
    else if (ev.key === "Enter") { ev.preventDefault(); activate(); }
    // Escape is handled natively by <dialog> (cancel → close)
  }

  // Anchor the palette directly beneath the title bar's search field (measured, not guessed —
  // grain/CLAUDE.md lesson 9: a positioning token must be mechanically consumed). Falls back to
  // the CSS-only centered position (cmdk.css defaults) if no field is on the page.
  function reposition() {
    const anchor = document.querySelector(".window-bar__search");
    if (!anchor || anchor.offsetParent === null) { root.classList.remove("cmdk--anchored"); return; }
    const r = anchor.getBoundingClientRect();
    root.style.setProperty("--cmdk-top", `${r.bottom + 4}px`);
    root.style.setProperty("--cmdk-left", `${r.left}px`);
    root.style.setProperty("--cmdk-width", `${r.width}px`);
    root.classList.add("cmdk--anchored");
  }

  function open() { root.showModal(); reposition(); input.value = ""; load().then(render); input.focus(); }
  function close() { if (root.open) root.close(); }

  function init() {
    build();
    document.addEventListener("keydown", (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); isOpen() ? close() : open(); }
    });
    // declarative trigger: any [data-cmdk-open] element opens the palette (e.g. the title
    // bar's search field — a button drawn as an input)
    document.addEventListener("click", (ev) => {
      if (ev.target.closest && ev.target.closest("[data-cmdk-open]")) { ev.preventDefault(); open(); }
    });
    window.addEventListener("resize", () => { if (isOpen()) reposition(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
