#!/usr/bin/env node
// Audits the gradebooks for students split across multiple rows by inconsistent
// student.json (typo'd/blank studentNumber, differing name/githubAccount).
// Read-only: writes audit-report.md. Suggests a canonical value; changes nothing.
import fs from "node:fs";
import path from "node:path";

import { SECTIONS as CFG, paths } from "../lib/config.mjs";
const SECTIONS = CFG.map(s => ({ key: s.key, section: s.section, dir: s.dir, org: s.org }));
const parse = (line) => { const o=[];let c="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'&&line[i+1]==='"'){c+='"';i++;}else if(ch==='"')q=false;else c+=ch;}else if(ch==='"')q=true;else if(ch===','){o.push(c);c="";}else c+=ch;}o.push(c);return o;};
const nlogin = (s) => String(s??"").trim().toLowerCase().replace(/^@/,"").replace(/^https?:\/\/github\.com\//,"").replace(/@.*$/,"");
const nemail = (s) => String(s??"").trim().toLowerCase();
const nname = (s) => String(s??"").toLowerCase().replace(/[.,]/g,"").split(/\s+/).filter(Boolean).sort().join(" ");
const nnum  = (s) => String(s??"").replace(/\D/g,"").trim();

let md = ["# Student consistency audit", "", `Generated ${new Date().toISOString()}.`, "",
  "Each block below is ONE real student whose activity repos disagree on `studentNumber`, `fullName`, or `githubAccount` - which is what splits them into multiple gradebook rows. Fix by making `student.json` consistent (or renaming the repo).", ""];
let totalClusters = 0, totalBlank = 0;

for (const sc of SECTIONS) {
  const csv = fs.readFileSync(path.join(sc.dir, "gradebook/grades.csv"), "utf8").replace(/\n$/,"").split("\n");
  const h = parse(csv[0]); const gi = (n) => h.indexOf(n);
  const rows = csv.slice(1).map(parse).filter(f => f[gi("repo")]).map(f => ({
    repo: f[gi("repo")], gh: f[gi("githubAccount")]||"", name: f[gi("fullName")]||"",
    num: f[gi("studentNumber")]||"", email: f[gi("studentEmail")]||"", act: f[gi("assignment")],
  }));
  // union-find over rows sharing a strong key (number / github / email) or, as a
  // weak fallback, an identical normalized name (to link blank-number repos).
  const parent = rows.map((_,i)=>i); const find=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;}; const uni=(a,b)=>{parent[find(a)]=find(b);};
  // NOTE: gate the number key on the NORMALIZED value, not the raw field. Some
  // repos have an email pasted into studentNumber; that normalizes to "" and must
  // NOT become a shared "num:" key (it would merge unrelated students).
  const handle=r=>r.repo.replace(/^[a-z0-9]+-\d+-/i,"").toLowerCase();
  const strongMap = new Map();
  rows.forEach((r,i)=>{ for (const k of [nnum(r.num)&&"num:"+nnum(r.num), nlogin(r.gh)&&"gh:"+nlogin(r.gh), (nemail(r.email)&&!/^\d+$/.test(nemail(r.email)))&&"em:"+nemail(r.email), handle(r)&&"rh:"+handle(r)].filter(Boolean)) { if (strongMap.has(k)) uni(i, strongMap.get(k)); else strongMap.set(k, i); } });
  const nameMap = new Map(); const nameLinked = new Set();
  rows.forEach((r,i)=>{ const k=nname(r.name); if(!k)return; if(nameMap.has(k)){ if(find(i)!==find(nameMap.get(k))){ uni(i,nameMap.get(k)); nameLinked.add(find(i)); } } else nameMap.set(k,i); });
  const clusters = new Map();
  rows.forEach((r,i)=>{ const c=find(i); if(!clusters.has(c)) clusters.set(c,[]); clusters.get(c).push(r); });

  // A cluster SPLITS in the gradebook when its rows resolve to >1 dashboard group
  // key = studentNumber (if present) else "name:<normalized name>".
  const dkeyOf = (r) => nnum(r.num) ? "n:"+nnum(r.num) : "name:"+nname(r.name);
  const problems = [];
  for (const [cid,list] of clusters) {
    const nums = new Set(list.map(r=>nnum(r.num)).filter(Boolean));
    const names = new Set(list.map(r=>nname(r.name)).filter(Boolean));
    const ghs = new Set(list.map(r=>nlogin(r.gh)).filter(Boolean));
    const blank = list.some(r=>!nnum(r.num));
    const dkeys = new Set(list.map(dkeyOf));
    if (dkeys.size>1) problems.push({ list, nums, names, ghs, blank, byName: nameLinked.has(cid) });
  }
  // fully-blank singletons (no number, no gh) -> can't auto-link
  const orphanBlanks = [...clusters.values()].filter(l => l.every(r=>!nnum(r.num) && !nlogin(r.gh)));

  if (!problems.length && !orphanBlanks.length) continue;
  md.push(`## ${sc.key}  (${sc.org})`, "");
  for (const p of problems) {
    totalClusters++;
    // variants = distinct (num,name,gh)
    const seen = new Set(); const variants = [];
    for (const r of p.list) { const k=r.num+"|"+r.name+"|"+r.gh; if(!seen.has(k)){seen.add(k);variants.push(r);} }
    const canonNum = [...p.nums][0] || "(none - fill from roster)";
    const bestName = p.list.map(r=>r.name).filter(Boolean).sort((a,b)=>b.length-a.length)[0] || "?";
    const bestGh = [...p.ghs][0] || "?";
    md.push(`### ${bestName}  →  suggest number \`${canonNum}\`, github \`${bestGh}\``);
    const issues = [];
    if (p.nums.size>1) issues.push(`**studentNumber differs** (${[...p.nums].join(" vs ")})`);
    if (p.blank) issues.push("**blank studentNumber** on some repos");
    if (p.names.size>1) issues.push("name differs");
    if (p.ghs.size>1) issues.push("githubAccount differs");
    if (p.byName) issues.push("_linked by matching name only - verify it is the same person_");
    md.push("Issue: " + issues.join("; "));
    md.push("", "| repo | activity | studentNumber | fullName | githubAccount |", "| --- | --- | --- | --- | --- |");
    for (const r of p.list.sort((a,b)=>a.act.localeCompare(b.act))) md.push(`| \`${r.repo}\` | ${r.act} | ${r.num||"·(blank)·"} | ${r.name||"·"} | ${r.gh||"·"} |`);
    md.push("");
  }
  if (orphanBlanks.length) {
    md.push(`### Unlinkable (blank number AND blank github - need roster/manual)`);
    md.push("", "| repo | activity | fullName |", "| --- | --- | --- |");
    for (const l of orphanBlanks) for (const r of l) { totalBlank++; md.push(`| \`${r.repo}\` | ${r.act} | ${r.name||"·"} |`); }
    md.push("");
  }
}

md.splice(4, 0, `**${totalClusters} split-student clusters** and **${totalBlank} unlinkable-blank rows** found across the four sections.`, "");
fs.writeFileSync(paths.auditReport, md.join("\n"));
console.log(`audit-report.md written | ${totalClusters} split clusters | ${totalBlank} unlinkable-blank rows`);
