// Browser port of the retired fetch-shots.mjs: lists a submission repo's
// `previews` branch and turns its screenshots into object URLs, on demand when
// the review drawer opens (instead of a bulk pre-download + manifest). Same
// latest-folder + desktop/mobile selection and label derivation as before.
import { ghJSON, ghBlobURL } from "./gh.mjs";

const cache = new Map(); // "section|repo" -> Promise<[{label,file}]>

export function shotsFor(section, org, repo) {
  const key = `${section}|${repo}`;
  if (!cache.has(key)) {
    const p = fetchShots(org, repo).catch(() => []);
    p.then(v => { p.resolved = v; });
    cache.set(key, p);
  }
  return cache.get(key);
}
export function shotsCached(section, repo) {
  // sync peek used by the drawer: null while loading, [] / [...] once resolved
  const key = `${section}|${repo}`;
  return cache.get(key)?.resolved ?? null;
}

async function fetchShots(org, repo) {
  const tree = await ghJSON(`/repos/${org}/${repo}/git/trees/previews?recursive=1`);
  const shots = [];
  if (tree && tree.tree) {
    let imgs = tree.tree.filter(x => /\.(png|jpe?g|webp)$/i.test(x.path));
    // keep only the latest timestamp folder
    const folders = [...new Set(imgs.map(x => x.path.split("/").slice(0,2).join("/")))].sort();
    const latest = folders[folders.length-1];
    if (latest) imgs = imgs.filter(x => x.path.startsWith(latest));
    // prefer desktop+mobile when width variants exist, else keep all
    const hasVariants = imgs.some(x => /desktop|mobile|tablet/i.test(x.path));
    if (hasVariants) imgs = imgs.filter(x => /desktop|mobile/i.test(x.path));
    imgs.sort((a,b)=> (/mobile/i.test(a.path)?1:0) - (/mobile/i.test(b.path)?1:0)); // desktop first
    for (const im of imgs) {
      const base = im.path.split("/").pop();
      const label = base.replace(/\.(png|jpe?g|webp)$/i,"").replace(/-?\d{3,4}$/,"").replace(/[-_]/g," ").trim() || "view";
      const mime = /\.png$/i.test(base) ? "image/png" : /\.webp$/i.test(base) ? "image/webp" : "image/jpeg";
      const url = await ghBlobURL(`/repos/${org}/${repo}/contents/${encodeURI(im.path)}?ref=previews`, mime);
      if (url) shots.push({ label, file: url });
    }
  }
  return shots;
}
