// grain/scripts/lightbox.js — a design-system image modal (full-size viewer).
//
// Self-contained: one <script> tag drops it onto any page; a <link> to lightbox.css
// must precede it. Declarative contract, no markup to author beyond two attributes:
//
//   [data-lightbox]        a trigger. Clicking it opens the viewer on that image.
//                          If the trigger is an <a href="…">, the href is the FULL image
//                          — so with no JS (or a modified click) it still navigates there,
//                          which is the no-JS-safe fallback. Otherwise a child <img>'s
//                          currentSrc is used, or data-lightbox-src if set.
//   [data-lightbox-group]  an ancestor that groups triggers into one gallery: prev/next
//                          and the dot rail walk every [data-lightbox] inside it, in DOM
//                          order (INCLUDING ones a strip hides past a cap — the viewer is
//                          how you reach the rest). No group ⇒ the single image, no rail.
//
// Caption = data-lightbox-caption on the trigger, else the child <img> alt. Uses a native
// <dialog> (showModal) for the focus-trap + focus-restore + Escape + ::backdrop + top-layer
// for free — same pattern as cmdk.js. Monochrome via the page's design tokens.
(() => {
  "use strict";
  if (window.grainLightbox) return;              // idempotent

  let root, imgEl, capEl, dotsEl, countEl, prevBtn, nextBtn;
  let group = [], index = 0;

  // the full-size source for a trigger: an <a> points at it via href (the no-JS fallback);
  // otherwise take an explicit data-lightbox-src, or the rendered <img>'s currentSrc/src.
  const srcOf = (el) => {
    if (el.dataset.lightboxSrc) return el.dataset.lightboxSrc;
    if (el.tagName === "A" && el.getAttribute("href")) return el.href;
    const img = el.matches("img") ? el : el.querySelector("img");
    return img ? (img.currentSrc || img.src) : "";
  };
  const captionOf = (el) => {
    if (el.dataset.lightboxCaption != null) return el.dataset.lightboxCaption;
    const img = el.matches("img") ? el : el.querySelector("img");
    return img ? (img.getAttribute("alt") || "") : "";
  };

  function build() {
    root = document.createElement("dialog");
    root.className = "lightbox";
    root.setAttribute("aria-label", "Image viewer");
    root.innerHTML = `
      <button class="lightbox__close" type="button" aria-label="Close">
        <svg class="icon" aria-hidden="true"><use href="/assets/sprite.svg#close"></use></svg>
      </button>
      <button class="lightbox__nav lightbox__nav--prev" type="button" aria-label="Previous image">
        <svg class="icon" aria-hidden="true"><use href="/assets/sprite.svg#chevron-left"></use></svg>
      </button>
      <figure class="lightbox__figure">
        <img class="lightbox__img" alt="">
        <figcaption class="lightbox__caption"></figcaption>
      </figure>
      <button class="lightbox__nav lightbox__nav--next" type="button" aria-label="Next image">
        <svg class="icon" aria-hidden="true"><use href="/assets/sprite.svg#chevron-right"></use></svg>
      </button>
      <div class="lightbox__dots" role="tablist" aria-label="Photos"></div>
      <p class="lightbox__count" aria-live="polite"></p>`;
    document.body.appendChild(root);
    imgEl = root.querySelector(".lightbox__img");
    capEl = root.querySelector(".lightbox__caption");
    dotsEl = root.querySelector(".lightbox__dots");
    countEl = root.querySelector(".lightbox__count");
    prevBtn = root.querySelector(".lightbox__nav--prev");
    nextBtn = root.querySelector(".lightbox__nav--next");

    // light-dismiss: a click on the backdrop (the dialog itself, or the figure's empty
    // gutter) closes; clicks on the image or a control do not.
    root.addEventListener("click", (e) => {
      if (e.target === root || e.target.classList.contains("lightbox__figure")) close();
    });
    root.querySelector(".lightbox__close").addEventListener("click", close);
    prevBtn.addEventListener("click", () => move(-1));
    nextBtn.addEventListener("click", () => move(1));
    // key handling on the document, not the dialog: after a nav-button click focus can sit outside
    // the dialog subtree, so a listener bound to <dialog> would miss the keystroke. Guard on open
    // state. Close explicitly rather than leaning on the dialog's native cancel — reliable across
    // engines and host key handlers.
    document.addEventListener("keydown", (e) => {
      if (!root.open) return;
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (group.length < 2) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
    });
  }

  function paintDots() {
    // dots are the optional gallery rail: only for a real multi-image group, and only when the
    // count is small enough to read as dots (a big set leans on the counter + arrows instead).
    const many = group.length > 1;
    const dotted = many && group.length <= 10;
    dotsEl.hidden = !dotted;
    countEl.hidden = !many;
    prevBtn.hidden = nextBtn.hidden = !many;
    if (many) countEl.textContent = `${index + 1} / ${group.length}`;
    if (!dotted) { dotsEl.replaceChildren(); return; }
    dotsEl.replaceChildren(...group.map((_, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "lightbox__dot"; b.setAttribute("role", "tab");
      b.setAttribute("aria-label", `Photo ${i + 1}`);
      if (i === index) b.setAttribute("aria-selected", "true");
      b.addEventListener("click", () => show(i));
      return b;
    }));
  }

  function show(i) {
    index = (i + group.length) % group.length;
    const trigger = group[index];
    imgEl.src = srcOf(trigger);
    const cap = captionOf(trigger);
    imgEl.alt = cap;
    capEl.textContent = cap;
    capEl.hidden = !cap;
    paintDots();
  }
  const move = (d) => show(index + d);

  function open(trigger) {
    const groupRoot = trigger.closest("[data-lightbox-group]");
    group = groupRoot ? [...groupRoot.querySelectorAll("[data-lightbox]")] : [trigger];
    if (!group.length) group = [trigger];
    show(Math.max(0, group.indexOf(trigger)));
    root.showModal();
  }
  function close() { if (root && root.open) root.close(); }

  function init() {
    build();
    document.addEventListener("click", (e) => {
      // leave modified clicks alone: cmd/ctrl/shift/middle-click on an <a> trigger should
      // still open the full image in a new tab (the href is a real, useful link).
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const trigger = e.target.closest && e.target.closest("[data-lightbox]");
      if (!trigger) return;
      e.preventDefault();
      open(trigger);
    });
  }
  window.grainLightbox = { open, close };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
