// Browser port of the retired fetch-code.mjs: fetches a submission repo's
// source files on demand when the review drawer's Code toggle is used (instead
// of a bulk window.CODE bundle). Same file filters, ordering and caps.
import { ghJSON, pool } from "./gh.mjs";

// source files worth showing; skip generated / vendored / binary / lockfiles
const SRC = /\.(jsx?|tsx?|mjs|cjs|css|scss|html?|dart|vue|svelte)$/i;
const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|\.dart_tool|\.github|previews|gradebook|coverage|\.next|out|vendor|submission|\.vscode)(\/|$)/i;
const SKIP_FILE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.min\.(js|css)|\.map)$/i;
const MAX_BYTES = 80 * 1024;   // skip a single huge/generated file
const MAX_FILES = 45;          // per submission
const NUL = String.fromCharCode(0);
const langOf = (p) => (p.match(/\.([a-z0-9]+)$/i)?.[1] || "txt").toLowerCase();

const cache = new Map(); // "section|repo" -> Promise<[{path,lang,content}]|null>

export function codeFor(section, org, repo) {
  const key = `${section}|${repo}`;
  if (!cache.has(key)) {
    const p = fetchCode(org, repo).catch(() => null);
    p.then(v => { p.resolved = v; });
    cache.set(key, p);
  }
  return cache.get(key);
}
export function codeCached(section, repo) {
  // sync peek: undefined while loading, null when nothing found, [...] otherwise
  const p = cache.get(`${section}|${repo}`);
  return p ? p.resolved : undefined;
}

async function fetchCode(org, repo) {
  const repoInfo = await ghJSON(`/repos/${org}/${repo}`);
  const branch = repoInfo?.default_branch || "main";
  const tree = await ghJSON(`/repos/${org}/${repo}/git/trees/${branch}?recursive=1`);
  if (!tree || !tree.tree) return null;
  let blobs = tree.tree.filter(x => x.type === "blob" && SRC.test(x.path) && !SKIP_DIR.test(x.path) && !SKIP_FILE.test(x.path) && (x.size ?? 0) <= MAX_BYTES);
  blobs.sort((a,b)=> a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
  blobs = blobs.slice(0, MAX_FILES);
  const out = [];
  await pool(blobs, 8, async b => {
    const buf = await ghJSON(`/repos/${org}/${repo}/git/blobs/${b.sha}`);
    if (!buf || buf.encoding !== "base64") return;
    let content;
    try {
      const bin = atob(buf.content.replace(/\n/g, ""));
      content = new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
    } catch { return; }
    if (content.includes(NUL)) return;   // binary guard
    out.push({ path: b.path, lang: langOf(b.path), content, _n: b.path });
  });
  // pool() finishes out-of-order; restore the sorted order
  out.sort((a,b)=> a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
  out.forEach(f => delete f._n);
  return out.length ? out : null;
}
