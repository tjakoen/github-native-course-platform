#!/usr/bin/env node
// Double-checks gradebook rows that have a GRADE but a blank/unusable identity
// (blank studentNumber). Fetches the LIVE student.json to see if the student has
// since filled it in. Read-only. Writes blanks-report.md.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const TOKEN = execSync("gh auth token", { encoding: "utf8" }).trim();
import { SECTIONS as CFG, paths } from "../lib/config.mjs";
const SECTIONS = CFG.map(s => ({ key: s.section, org: s.org, dir: s.dir }));
const parse=(l)=>{const o=[];let c="",q=false;for(let i=0;i<l.length;i++){const ch=l[i];if(q){if(ch==='"'&&l[i+1]==='"'){c+='"';i++;}else if(ch==='"')q=false;else c+=ch;}else if(ch==='"')q=true;else if(ch===','){o.push(c);c="";}else c+=ch;}o.push(c);return o;};
const nnum=s=>String(s??"").replace(/\D/g,"").trim();
async function ghJson(url){const r=await fetch("https://api.github.com"+url,{headers:{Authorization:"Bearer "+TOKEN,Accept:"application/vnd.github+json"}});return r.ok?r.json():null;}

const blanks=[];
for(const sc of SECTIONS){
  const csv=fs.readFileSync(path.join(sc.dir,"gradebook/grades.csv"),"utf8").replace(/\n$/,"").split("\n");
  const h=parse(csv[0]); const gi=n=>h.indexOf(n);
  for(let i=1;i<csv.length;i++){const f=parse(csv[i]); if(!f[gi("repo")])continue;
    const num=f[gi("studentNumber")]||""; if(nnum(num).length>=6) continue; // has a real number -> fine
    const passed=+f[gi("passed")]||0, total=+f[gi("total")]||0;
    blanks.push({org:sc.org,section:sc.key,repo:f[gi("repo")],act:f[gi("assignment")],
      num, name:f[gi("fullName")]||"", gh:f[gi("githubAccount")]||"", passed, total, ai:f[gi("aiScore")]||""});
  }
}
console.log("rows with blank/invalid studentNumber:",blanks.length,"— fetching live student.json…");

// fetch live student.json per unique repo
const uniq=[...new Map(blanks.map(b=>[b.org+"/"+b.repo,b])).values()];
const live=new Map();
async function pool(items,n,fn){const q=items.slice();await Promise.all(Array.from({length:n},async()=>{while(q.length)await fn(q.shift())}));}
await pool(uniq,8,async b=>{
  const j=await ghJson(`/repos/${b.org}/${b.repo}/contents/student.json`);
  if(j&&j.content){try{const o=JSON.parse(Buffer.from(j.content,"base64").toString("utf8"));live.set(b.org+"/"+b.repo,o);}catch{}}
});

let md=["# Blank-identity rows that carry a grade","",`Generated ${new Date().toISOString()}.`,"",
 "Rows whose gradebook identity is blank/invalid but that have a score. 'Live student.json' = the repo's CURRENT file (a student may have filled it in after grading; a re-sweep would then pick it up).","",
 "| section | repo | activity | score | gradebook num | live num | live name | resolves? |","| --- | --- | --- | --- | --- | --- | --- | --- |"];
let nowFilled=0, stillBlank=0, hasScore=0;
for(const b of blanks.sort((a,b)=>a.section.localeCompare(b.section)||a.repo.localeCompare(b.repo))){
  const o=live.get(b.org+"/"+b.repo)||{};
  const liveNum=nnum(o.studentNumber||"");
  const scored=b.passed>0; if(scored)hasScore++;
  const resolves= liveNum.length>=6 ? "✅ re-sweep fixes" : (o.githubAccount||o.fullName ? "⚠ partial (name/gh only)" : "❌ needs roster");
  if(liveNum.length>=6)nowFilled++; else stillBlank++;
  md.push(`| ${b.section} | \`${b.repo}\` | ${b.act} | ${b.passed}/${b.total}${b.ai?" (ai "+b.ai+")":""} | ${b.num||"·"} | ${o.studentNumber||"·"} | ${o.fullName||"·"} | ${resolves} |`);
}
md.splice(4,0,`**${blanks.length}** blank/invalid-identity rows, **${hasScore}** with a nonzero score. Live check: **${nowFilled}** now have a valid number (a re-sweep would attach the grade), **${stillBlank}** still lack one.`,"");
fs.writeFileSync(paths.blanksReport,md.join("\n"));
console.log(`blanks-report.md written | ${blanks.length} rows | ${hasScore} scored | ${nowFilled} now-fillable | ${stillBlank} still blank`);
