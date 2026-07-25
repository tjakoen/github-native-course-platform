// grain/scripts/theme-boot.js — the theming FOUC guard (GRAIN). Loaded render-BLOCKING in
// <head> (no defer, before the stylesheets apply) so the saved color-scheme/flavor attributes
// are on <html> before first paint — without it, every navigation flashes the default theme
// until the deferred theme.js runs. READ-ONLY: it mirrors the storage keys + attribute names
// whose single source is theme.js (the writer); keep the two files in sync.
(() => {
  "use strict";
  try {
    var html = document.documentElement;
    var s = localStorage.getItem("grain-color-scheme");
    if (s) html.setAttribute("data-color-scheme", s);
    var t = localStorage.getItem("grain-theme");
    if (t) html.setAttribute("data-theme", t);
  } catch (e) { /* no storage (privacy mode) → defaults render, theme.js stays the fallback */ }
})();
