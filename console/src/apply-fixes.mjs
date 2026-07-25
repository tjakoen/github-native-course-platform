#!/usr/bin/env node
// Normalizes studentNumber in submission student.json so split gradebook rows
// merge. DRY RUN by default; pass --apply to write (as course-bot via gh API).
// Only edits the outlier field; leaves everything else. Skips name-only links.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const TOKEN = execSync("gh auth token", { encoding: "utf8" }).trim();
import { SECTIONS as CFG, paths } from "../lib/config.mjs";
const SECTIONS = CFG.map(s => ({ key: s.section, org: s.org, dir: s.dir }));
const parse = (l)=>{const o=[];let c="",q=false;for(let i=0;i<l.length;i++){const ch=l[i];if(q){if(ch==='"'&&l[i+1]==='"'){c+='"';i++;}else if(ch==='"')q=false;else c+=ch;}else if(ch==='"')q=true;else if(ch===','){o.push(c);c="";}else c+=ch;}o.push(c);return o;};
const nlogin=s=>String(s??"").trim().toLowerCase().replace(/^@/,"").replace(/^https?:\/\/github\.com\//,"").replace(/@.*$/,"");
const nemail=s=>String(s??"").trim().toLowerCase();
const nname=s=>String(s??"").toLowerCase().replace(/[.,]/g,"").split(/\s+/).filter(Boolean).sort().join(" ");
const nnum=s=>String(s??"").replace(/\D/g,"").trim();

async function gh(url, opts){ const r=await fetch("https://api.github.com"+url,{...opts,headers:{Authorization:"Bearer "+TOKEN,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",...(opts&&opts.headers)}}); return r; }

const changes = [];
for (const sc of SECTIONS) {
  const csv = fs.readFileSync(path.join(sc.dir,"gradebook/grades.csv"),"utf8").replace(/\n$/,"").split("\n");
  const h=parse(csv[0]); const gi=n=>h.indexOf(n);
  const rows=csv.slice(1).map(parse).filter(f=>f[gi("repo")]).map(f=>({repo:f[gi("repo")],gh:f[gi("githubAccount")]||"",name:f[gi("fullName")]||"",num:f[gi("studentNumber")]||"",email:f[gi("studentEmail")]||""}));
  const parent=rows.map((_,i)=>i);const find=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};const uni=(a,b)=>{parent[find(a)]=find(b);};
  // gate number key on the NORMALIZED value (an email in studentNumber -> "" must
  // not create a shared empty key); ignore numeric-looking email fields too.
  // Also link by REPO HANDLE (the name after "<act>-<section>-") so a blank
  // student.json on one activity links to the student's other repos.
  const handle=r=>r.repo.replace(/^[a-z0-9]+-\d+-/i,"").toLowerCase();
  // STRONG keys only for the apply (number / github / non-numeric email / repo
  // handle). Name is deliberately NOT a linking key here - it is too weak and can
  // fuse different people. So every merge rests on a shared hard identifier.
  const sm=new Map(); rows.forEach((r,i)=>{for(const k of [nnum(r.num)&&"num:"+nnum(r.num),nlogin(r.gh)&&"gh:"+nlogin(r.gh),(nemail(r.email)&&!/^\d+$/.test(nemail(r.email)))&&"em:"+nemail(r.email),handle(r)&&"rh:"+handle(r)].filter(Boolean)){if(sm.has(k))uni(i,sm.get(k));else sm.set(k,i);}});
  const cl=new Map(); rows.forEach((r,i)=>{const c=find(i);(cl.get(c)||cl.set(c,[]).get(c)).push(r);});
  const dkey=r=>nnum(r.num)?"n:"+nnum(r.num):"name:"+nname(r.name);
  const toks=s=>nname(s).split(" ").filter(t=>t.length>=3);
  const sameStudent=(a,b)=>{const A=toks(a),B=toks(b);return A.some(t=>B.includes(t));};
  for(const [cid,list] of cl){
    if(new Set(list.map(dkey)).size<=1) continue; // not split
    const distinctNums=[...new Set(list.map(r=>nnum(r.num)).filter(Boolean))];
    if(distinctNums.length===0) continue; // no number anywhere -> leave for roster
    // GUARD 1: one real student = one identity. Two names with no shared word.
    const sigs=[...new Set(list.map(r=>r.name).filter(Boolean))];
    const nameConflict=sigs.some((a,i)=>sigs.some((b,j)=>j>i && !sameStudent(a,b)));
    // Determine the canonical number.
    const cnt=new Map(); for(const r of list){const n=nnum(r.num);if(n)cnt.set(n,(cnt.get(n)||0)+1);}
    const sorted=[...cnt.entries()].sort((a,b)=>b[1]-a[1]);
    const [domN,domC]=sorted[0]; const runC=sorted[1]?sorted[1][1]:0;
    // A number conflict is an OBVIOUS typo only when a single 8-digit number
    // clearly dominates (>=2x the runner-up). Otherwise (near-even like 5v4, or a
    // non-8-digit "winner" like a 7-digit truncation) it is ambiguous -> hold.
    const obvious = distinctNums.length>1 && !nameConflict && domC>=2 && domC>=2*runC && domN.length===8;
    if(nameConflict){
      for(const r of list) changes.push({ org:sc.org, section:sc.key, repo:r.repo, name:r.name, oldNum:r.num||"(blank)", newNum:distinctNums.join(" | "), reason:"conflict", skip:"MULTI-IDENTITY (collision — verify whose)" });
      continue;
    }
    if(distinctNums.length>1 && !obvious){
      for(const r of list) changes.push({ org:sc.org, section:sc.key, repo:r.repo, name:r.name, oldNum:r.num||"(blank)", newNum:distinctNums.join(" | "), reason:"conflict", skip:"NUMBER CONFLICT (pick the right one)" });
      continue;
    }
    // UNANIMOUS (single identity) OR OBVIOUS single-outlier typo -> apply to canonical.
    const canonN=obvious?domN:distinctNums[0]; const canonStr=list.find(r=>nnum(r.num)===canonN).num;
    for(const r of list){
      if(nnum(r.num)===canonN) continue;
      changes.push({ org:sc.org, section:sc.key, repo:r.repo, name:r.name,
        oldNum:r.num||"(blank)", newNum:canonStr, reason:(nnum(r.num)?"typo->consensus":"blank->fill"), skip:null });
    }
  }
}

// report
const doIt = changes.filter(c=>!c.skip);
const skipped = changes.filter(c=>c.skip);
let rep=["# studentNumber normalization plan",`Generated ${new Date().toISOString()} — mode: ${APPLY?"APPLY":"DRY RUN"}`,"",
 `${doIt.length} repos to fix, ${skipped.length} skipped (needs manual review).`,"",
 "| section | repo | field: studentNumber | new value | reason |","| --- | --- | --- | --- | --- |",
 ...doIt.map(c=>`| ${c.section} | \`${c.repo}\` | ${c.oldNum} | ${c.newNum} | ${c.reason} |`)];
if(skipped.length){rep.push("","## Skipped (manual)","","| section | repo | old | reason |","| --- | --- | --- | --- |",
 ...skipped.map(c=>`| ${c.section} | \`${c.repo}\` | ${c.oldNum} | ${c.skip} |`));}
fs.writeFileSync(paths.fixPlan, rep.join("\n"));
console.log(`fix-plan.md written | ${doIt.length} to fix | ${skipped.length} skipped | mode=${APPLY?"APPLY":"DRY"}`);

if(!APPLY){ process.exit(0); }

// apply
const sectionsTouched = new Set();
for(const c of doIt){
  const g=await gh(`/repos/${c.org}/${c.repo}/contents/student.json`);
  if(!g.ok){ console.log("  GET fail",c.repo,g.status); continue; }
  const meta=await g.json(); const raw=Buffer.from(meta.content,"base64").toString("utf8");
  let out;
  if(/"studentNumber"\s*:\s*"/.test(raw)) out=raw.replace(/("studentNumber"\s*:\s*")[^"]*(")/, `$1${c.newNum}$2`);
  else if(/"studentNumber"\s*:\s*[0-9]+/.test(raw)) out=raw.replace(/("studentNumber"\s*:\s*)[0-9]+/, `$1"${c.newNum}"`);
  else { console.log("  no studentNumber field, skip",c.repo); continue; }
  if(out===raw){ console.log("  already correct",c.repo); continue; }
  const put=await gh(`/repos/${c.org}/${c.repo}/contents/student.json`,{method:"PUT",body:JSON.stringify({
    message:"🔧 Normalize studentNumber for consistent gradebook grouping",
    content:Buffer.from(out,"utf8").toString("base64"), sha:meta.sha,
    author:{name:"course-bot",email:"course-bot@users.noreply.github.com"},
    committer:{name:"course-bot",email:"course-bot@users.noreply.github.com"},
  })});
  console.log(put.ok?"  fixed "+c.repo:"  PUT FAIL "+c.repo+" "+put.status);
  if(put.ok) sectionsTouched.add(c.section);
}
console.log("sections needing a re-sweep:", [...sectionsTouched].join(", ")||"(none)");
