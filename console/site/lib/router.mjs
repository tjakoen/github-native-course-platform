// Hash router for the shell. Routes are "#/c/:key/students/:num" patterns; a
// handler gets the extracted params. Views are URLs now: linkable, refresh-safe,
// cmdk-jumpable. No history API - hash only, so Pages hosting needs nothing.
const routes = [];
let notFound = null;
let before = null;

export function route(pattern, handler) {
  routes.push({ parts: pattern.replace(/^#/, "").split("/").filter(Boolean), handler });
}
export function fallback(handler) { notFound = handler; }
export function beforeEach(fn) { before = fn; }   // runs on every dispatch (cleanup: stop camera, clear main)

function match(hashParts, r) {
  if (hashParts.length !== r.parts.length) return null;
  const params = {};
  for (let i = 0; i < r.parts.length; i++) {
    const p = r.parts[i];
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(hashParts[i]);
    else if (p !== hashParts[i]) return null;
  }
  return params;
}

export function dispatch() {
  const parts = (location.hash || "#/").replace(/^#/, "").split("/").filter(Boolean);
  if (before) before();
  for (const r of routes) {
    const params = match(parts, r);
    if (params) { r.handler(params); return; }
  }
  if (notFound) notFound();
}

export function start() {
  window.addEventListener("hashchange", dispatch);
  dispatch();
}

// Navigate; if already on the hash, force a re-dispatch (refresh semantics).
export function go(hash) {
  if (location.hash === hash) dispatch();
  else location.hash = hash;
}
