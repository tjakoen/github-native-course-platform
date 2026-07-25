// grain/scripts/cmdk.js — global command palette (Spotlight / Notion ⌘K style).
//
// Self-contained: one <script> tag drops it onto any page. A <link> to cmdk.css
// must precede it. Injects a native <dialog>, binds ⌘K / Ctrl+K, fetches
// the search index once, filters, and navigates. Monochrome e-ink look via the
// page's design tokens. Today it indexes pages + components; live sources plug in
// through window.cmdk.register (the seam below made real): a provider is a sync
// (query) => item[] the host app registers, its items pre-filtered by the app,
// and an item may carry an action() instead of a url — Enter runs it (palette as
// another action-vocabulary client).
//
// Host config (optional, via <html data-*>; defaults keep old pages working):
//   data-cmdk-src     URL of the static index (default "/search.json"; set EMPTY
//                     to skip the fetch entirely — provider-only palettes, or
//                     project pages served under a subpath where "/" is wrong)
//   data-cmdk-sprite  base path of the icon sprite (default "/assets/sprite.svg")
(() => {
  "use strict";
  let data = null, items = [], sel = 0, root, input, list;
  const providers = [];
  const CFG = document.documentElement.dataset;
  const SRC = CFG.cmdkSrc !== undefined ? CFG.cmdkSrc : "/search.json";
  const SPRITE = CFG.cmdkSprite || "/assets/sprite.svg";

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
        <svg class="icon cmdk__icon" aria-hidden="true"><use href="${SPRITE}#search"></use></svg>
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
    if (!SRC) { data = { pages: [], components: [] }; return; }   // provider-only palette
    try { data = await (await fetch(SRC)).json(); }
    catch { data = { pages: [], components: [] }; }
  }

  const corpus = () => [
    ...(data.pages || []).map((p) => ({ ...p, kind: "Page" })),
    ...(data.components || []).map((c) => ({ ...c, kind: "Component" })),
  ];

  // Registered live sources (the seam, made real): each provider returns its own
  // already-filtered items for the query. A throwing provider yields nothing —
  // the palette never breaks on a bad source.
  const fromProviders = (q) => providers.flatMap((p) => { try { return p(q) || []; } catch { return []; } });

  function paint() {
    [...list.children].forEach((el, i) => el.classList && el.classList.toggle("is-sel", i === sel));
    if (list.children[sel]) list.children[sel].scrollIntoView({ block: "nearest" });
  }

  function render() {
    const q = input.value.trim().toLowerCase();
    // match on the URL too — Quick Open by path ("notes/ten", "grain/docs") like an editor's ⌘P
    items = [
      ...fromProviders(q),
      ...corpus().filter((e) => !q || (e.title + " " + (e.subtitle || "") + " " + (e.url || "")).toLowerCase().includes(q)),
    ].slice(0, 30);
    sel = 0;
    list.innerHTML = items.length
      ? items.map((e, i) => `<li class="cmdk__item${i === 0 ? " is-sel" : ""}" role="option" data-i="${i}">
          <span class="cmdk__title">${esc(e.title)}</span>
          ${e.subtitle ? `<span class="cmdk__sub">${esc(e.subtitle)}</span>` : ""}
          <span class="cmdk__kind">${esc(e.kind)}</span></li>`).join("")
      : `<li class="cmdk__empty">No matches</li>`;
  }

  function move(d) { if (!items.length) return; sel = (sel + d + items.length) % items.length; paint(); }
  function activate() {
    const e = items[sel];
    if (!e) return;
    if (e.action) { close(); e.action(); }         // command entry: run it (door stays the app's)
    else if (e.url) location.assign(e.url);
  }

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
  // Public surface: hosts register live sources and can drive the palette.
  window.cmdk = {
    register(provider) { if (typeof provider === "function") providers.push(provider); },
    open: () => open(),
    close: () => close(),
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
