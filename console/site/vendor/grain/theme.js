// grain/scripts/theme.js — the theming controls (GRAIN). Sets the two ORTHOGONAL token axes on
// <html>: data-color-scheme (light | dark, or unset = follow the OS) and data-theme (the flavor;
// unset = the default). Both are pure TOKEN re-skins (grain/styles/variables.css) — a client-side
// VIEW PREFERENCE: static-safe, no deps, NOT the AI door. Persists to localStorage.
//
// The theming VOCABULARY (attribute + value + control names + storage keys) is defined ONCE in the
// constant block below — no raw strings scattered through the logic (CONVENTIONS §3: browser-JS
// literals kept to a single source). Those attribute names are mirrored in CSS selectors
// (variables.css) and in the control markup; keep the three in sync.
// NOTE (FOUC): saved prefs apply when this deferred module runs; theme-boot.js (loaded
// render-BLOCKING in <head> by the composition root) pre-sets the attributes before first
// paint so navigation never flashes the default. It mirrors the KEY/ATTR strings below —
// change them here, change them there.
(() => {
  "use strict";
  if (window.grain && window.grain.theme) return;   // idempotent: safe if loaded per-page AND globally

  // ---- theming vocabulary (single source of these strings) ---------------------------------
  const ATTR    = { scheme: "data-color-scheme", theme: "data-theme", list: "data-themes" };
  const SCHEME  = { light: "light", dark: "dark", auto: "auto" };
  const CTRL    = { toggleScheme: "data-toggle-scheme", cycleTheme: "data-cycle-theme",
                    setScheme: "data-set-scheme", setTheme: "data-set-theme" };
  const LABEL   = "data-theme-name";   // any element carrying it shows the current flavor name
  const KEY     = { scheme: "grain-color-scheme", theme: "grain-theme" };
  const MQ_DARK = "(prefers-color-scheme: dark)";

  const html = document.documentElement;
  const store = (() => { try { return window.localStorage; } catch { return null; } })();
  const get = (k) => { try { return store && store.getItem(k); } catch { return null; } };
  const put = (k, v) => { try { if (store) v == null ? store.removeItem(k) : store.setItem(k, v); } catch {} };

  // ---- color scheme (light | dark | auto; auto drops the attr → follow the OS) --------------
  function setScheme(s) {
    if (!s || s === SCHEME.auto) { html.removeAttribute(ATTR.scheme); put(KEY.scheme, null); }
    else { html.setAttribute(ATTR.scheme, s); put(KEY.scheme, s); }
  }
  const scheme = () => html.getAttribute(ATTR.scheme) || SCHEME.auto;
  function toggleScheme() {
    const eff = scheme() === SCHEME.auto
      ? (matchMedia(MQ_DARK).matches ? SCHEME.dark : SCHEME.light)
      : scheme();
    setScheme(eff === SCHEME.dark ? SCHEME.light : SCHEME.dark);
  }

  // ---- flavor (data-theme). The ordered list is CONSUMER-DECLARED on <html data-themes="…"> —
  // GRAIN hardcodes no theme names. list[0] is the DEFAULT (rendered by the bare :root, so
  // selecting it just drops the attribute). Add/rename/reorder purely in the markup + CSS. -------
  const themes = () => (html.getAttribute(ATTR.list) || "").split(/\s+/).filter(Boolean);
  const defaultTheme = () => themes()[0] || "";
  function setTheme(t) {
    if (!t || t === defaultTheme()) { html.removeAttribute(ATTR.theme); put(KEY.theme, null); }
    else { html.setAttribute(ATTR.theme, t); put(KEY.theme, t); }
    syncLabels();
  }
  const theme = () => html.getAttribute(ATTR.theme) || defaultTheme();
  function cycleTheme() {
    const list = themes(); if (list.length < 2) return;
    setTheme(list[(list.indexOf(theme()) + 1) % list.length]);
  }

  // flavor-name labels (e.g. the status bar's "◆ sourdough"): kept in sync on every change
  const syncLabels = () => {
    for (const el of document.querySelectorAll(`[${LABEL}]`)) el.textContent = theme();
  };

  // ---- apply saved prefs (no saved scheme → stay auto, so the OS wins, no forced-override flash) --
  const savedScheme = get(KEY.scheme); if (savedScheme) html.setAttribute(ATTR.scheme, savedScheme);
  const savedTheme  = get(KEY.theme);  if (savedTheme)  html.setAttribute(ATTR.theme,  savedTheme);
  syncLabels();   // deferred script: the DOM is parsed by now

  // ---- declarative controls (any element drives theming; no per-page handlers) ---------------
  const HANDLERS = {
    [CTRL.toggleScheme]: ()   => toggleScheme(),
    [CTRL.cycleTheme]:   ()   => cycleTheme(),
    [CTRL.setScheme]:    (el) => setScheme(el.getAttribute(CTRL.setScheme)),
    [CTRL.setTheme]:     (el) => setTheme(el.getAttribute(CTRL.setTheme)),
  };
  const SELECTOR = Object.keys(HANDLERS).map((a) => `[${a}]`).join(",");
  document.addEventListener("click", (e) => {
    const el = e.target.closest(SELECTOR);
    if (!el) return;
    for (const attr of Object.keys(HANDLERS)) if (el.hasAttribute(attr)) { HANDLERS[attr](el); break; }
  });

  window.grain = window.grain || {};
  window.grain.theme = { setScheme, setTheme, toggleScheme, cycleTheme, scheme, theme, themes };
})();
