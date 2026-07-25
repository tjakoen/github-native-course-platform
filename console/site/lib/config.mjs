// Browser twin of the retired lib/config.mjs: discovers sections from the
// configured teacher-repo URLs instead of scanning classes/. Everything still
// derives from ground truth: the repo NAME (same teacher-<subject>-<section>-<name>
// convention the folder scan used) and the repo's grader/assignments.json.
import { ghJSON, setRepoTokens } from "./gh.mjs";

const NAME = /^teacher-([a-z0-9]+)-([a-z0-9]+)-/i; // teacher-<subjectcode>-<section>-<name>

export function parseRepoURL(u) {
  const m = String(u).trim().match(/(?:github\.com[:/]+)?([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
  return m ? { org: m[1], repo: m[2] } : null;
}

// Normalize a config repo entry (string | {url, token}) to { url, token }.
const asEntry = r => typeof r === "string" ? { url: r, token: "" } : { url: String(r && r.url || ""), token: String(r && r.token || "") };

// -> [{ key, section, repo, org, subject, acts, pol }] sorted by key; skips
// anything that isn't a reachable teacher repo (returned separately as errors).
// Accepts per-repo entries ({url, token}) and registers each repo's own token
// with the API layer BEFORE discovering, so every fetch below uses the right PAT.
export async function discoverSections(repos, labels = {}) {
  const entries = (repos || []).map(asEntry).filter(e => e.url.trim());
  setRepoTokens(entries.map(e => { const p = parseRepoURL(e.url); return p ? { org: p.org, repo: p.repo, token: e.token } : null; }).filter(Boolean));
  const sections = [], errors = [];
  for (const e of entries) {
    const line = e.url.trim();
    if (!line) continue;
    const p = parseRepoURL(line);
    if (!p) { errors.push({ url: line, err: "not a repo URL" }); continue; }
    const m = p.repo.match(NAME);
    if (!m) { errors.push({ url: line, err: "name doesn't match teacher-<subject>-<section>-<name>" }); continue; }
    const pol = await ghJSON(`/repos/${p.org}/${p.repo}/contents/grader/assignments.json`)
      .then(j => j && j.content ? JSON.parse(atob(j.content.replace(/\n/g, ""))) : null)
      .catch(e => { errors.push({ url: line, err: e.message }); return null; });
    if (!pol) { if (!errors.find(e => e.url === line)) errors.push({ url: line, err: "grader/assignments.json not found (not a teacher repo, or token lacks access)" }); continue; }
    const code = m[1].toUpperCase(), section = m[2];
    const key = code + "-" + section;
    // Optional per-repo display metadata: course.config.json may carry
    // courseName ("Application Development") and courseCode ("CS-401"). Both are
    // optional - absence falls back to the name-derived subject code. One extra
    // (ETag-cached) call per repo at discovery time.
    let ccfg = null;
    try {
      const cj = await ghJSON(`/repos/${p.org}/${p.repo}/contents/course.config.json`);
      if (cj && cj.content) ccfg = JSON.parse(atob(cj.content.replace(/\n/g, "")));
    } catch { /* optional */ }
    sections.push({
      key, section, repo: p.repo, org: p.org,
      subject: labels[key] || labels[code] || (ccfg && ccfg.courseName) || code,
      courseCode: (ccfg && ccfg.courseCode) || null,
      acts: pol.filter(x => x.feedback === "project").map(x => x.id), // design activities publish screenshots
      pol,
    });
  }
  sections.sort((a, b) => a.key.localeCompare(b.key));
  return { sections, errors };
}
