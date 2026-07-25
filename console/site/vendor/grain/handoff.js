// grain/scripts/handoff.js — hand page content off to an external service via a URL template.
//
// The generic shape behind "open this in <service>" buttons: a page composes some text (a
// prompt, a draft, a query), and instead of the visitor copy-pasting it into another tab, one
// click opens the target service with the text already in place. GRAIN stays vendor-neutral:
// the service lives entirely in the host's URL template — an AI chat, a search engine, a
// translator, an issue tracker are all the same one attribute.
//
// Self-contained: one <script> tag drops it onto any page. Declarative contract:
//
//   [data-handoff]          a trigger. Clicking it composes the URL and opens it in a new tab.
//   data-handoff-url        REQUIRED on the trigger. The URL template; `{payload}` marks where
//                           the (URI-encoded) payload goes. https:// or http:// only — every
//                           other scheme is refused at click time, never opened.
//                           e.g. https://claude.ai/new?q={payload}
//                                https://www.google.com/search?q={payload}
//   data-handoff-source     CSS selector for the payload element. A form control contributes
//                           its live .value; anything else its trimmed textContent. Falls back
//                           to data-handoff-payload (a literal) when absent; no source and no
//                           literal ⇒ empty payload (the template may be self-sufficient).
//
// The payload is encodeURIComponent'd BEFORE substitution, so template query strings stay
// well-formed whatever the text contains. No length cap here: very long payloads can exceed a
// target's URL limit — that's the target's error to surface, not this file's to silently trim.
// New tab opens with noopener: the target page must never get a handle back onto this one.
(() => {
  "use strict";
  if (window.grainHandoff) return;               // idempotent

  const SAFE_HANDOFF_URL = /^https?:\/\//i;

  const payloadOf = (trigger) => {
    const sel = trigger.dataset.handoffSource;
    const src = sel ? document.querySelector(sel) : null;
    if (src) return "value" in src && typeof src.value === "string" ? src.value : (src.textContent || "").trim();
    return trigger.dataset.handoffPayload || "";
  };

  /** Resolve a trigger's template + payload into the final URL, or "" when the template is
   *  missing, has an unsafe scheme, or doesn't parse. Pure over its inputs — exposed on
   *  window.grainHandoff for hosts that want to compose without a click (e.g. a preview). */
  const compose = (template, payload) => {
    if (!template || !SAFE_HANDOFF_URL.test(template)) return "";
    const url = template.replaceAll("{payload}", encodeURIComponent(payload ?? ""));
    try { new URL(url); } catch { return ""; }
    return url;
  };

  function init() {
    document.addEventListener("click", (e) => {
      // leave modified clicks alone — same courtesy as lightbox.js: cmd/ctrl/shift/middle-click
      // keeps its native meaning on an <a> trigger.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const trigger = e.target.closest && e.target.closest("[data-handoff]");
      if (!trigger) return;
      const url = compose(trigger.dataset.handoffUrl, payloadOf(trigger));
      if (!url) return;                          // unsafe or unparseable: refuse quietly, no navigation
      e.preventDefault();
      window.open(url, "_blank", "noopener");
    });
  }
  window.grainHandoff = { compose };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
