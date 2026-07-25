// Course Console - hosted, data-free shell. All gradebook data is fetched
// live from api.github.com with the teacher's own token (Settings). The UI half
// is the retired local dashboard's script, ported verbatim where possible; the
// data half now lives in lib/. The app READS everything and WRITES exactly one
// thing: Intent prompt files into gradebook/intents/ (executed by Claude Code
// locally - "run pending intents").
import { putIntent, AuthError, rate } from "./lib/gh.mjs";
import { loadConfig, saveConfig } from "./lib/store.mjs";
import { discoverSections, parseRepoURL } from "./lib/config.mjs";
import { loadSection } from "./lib/gradebook.mjs";
import { shotsFor, shotsCached } from "./lib/shots.mjs";
import { codeFor, codeCached } from "./lib/code.mjs";
import { renderScanView, stopScanner } from "./lib/attendance-scan.mjs";

const $=(s,r=document)=>r.querySelector(s), el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e};
const esc=s=>String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
let cur=0, q="", mode="book", revAct=null;
let DATA=null;
const app=$("#app");

// where the prompts tell Claude Code to work from (the local clone convention)
const workFrom=s=>"classes/"+s.repo+" (the local clone of github.com/"+s.org+"/"+s.repo+")";

// "Send to repo" on every prompt drawer: files the prompt as an Intent under
// gradebook/intents/ so a local "run pending intents" picks it up - no pasting.
function wireSend(s,kind,aid,txt){
 const b=$("#send"); if(!b)return;
 b.onclick=async()=>{
  b.disabled=true; b.textContent="Sending…";
  const ts=new Date().toISOString().replace(/[-:]/g,"").replace(/\..+/,"").replace("T","-");
  const path="gradebook/intents/"+ts+"-"+kind+(aid?"-"+aid:"")+".md";
  const body=txt+"\n---\n_Filed by Course Console at "+new Date().toISOString()+". When this intent is done, move this file to gradebook/intents/done/ in the same commit as the changes._\n";
  try{ await putIntent(s.org,s.repo,path,body,":memo: console intent: "+kind+(aid?" "+aid:"")); b.textContent="Sent ✓ "+path.split("/").pop(); }
  catch(e){ b.disabled=false; b.textContent="Send to repo →"; alert("Sending failed: "+e.message); }
 };
}

function openSettings(firstRun){
 const c=loadConfig()||{repos:[],labels:{}};
 const d=el("div","drawer on"); const p=el("div","dp"); d.append(p); document.body.append(d);
 // Each teacher repo gets its OWN row: URL + its own fine-grained PAT. One
 // rejected/expired token then only takes down that one section, not all.
 const rowHTML=(r={})=>"<div class='repoRow' style='display:flex;gap:8px;margin-bottom:8px;align-items:flex-start'>"+
   "<div style='flex:1;min-width:0'>"+
    "<input class='field__input rUrl mono' type='text' value='"+esc(r.url||"")+"' placeholder='github.com/org/teacher-subject-section-name'>"+
    "<input class='field__input rTok' type='password' value='"+esc(r.token||"")+"' placeholder='github_pat_… (this repo's PAT)' style='margin-top:6px'>"+
   "</div>"+
   "<button class='btn rDel' data-size='sm' data-variant='soft' title='Remove this repo' style='flex:none'>×</button>"+
  "</div>";
 p.innerHTML="<button class='x'>×</button><h3>Settings</h3>"+
  "<div class='muted'>Stored in THIS browser's localStorage only - anyone with access to this browser profile can read the tokens. A PAT scoped to just the teacher repo loads gradebooks and lets you file Intents. To also see <b>student code and screenshots</b> (which live in the submission repos), that repo's PAT needs read access to the whole org - use a classic PAT with <code>repo</code> scope, or a fine-grained PAT with <b>All repositories</b> (Contents: Read). Short expiry recommended.</div>"+
  "<div class='field__label' style='margin-top:12px'>Teacher repos <span class='mut'>- one repo + its own PAT per row</span></div>"+
  "<div id='sRepos'>"+((c.repos.length?c.repos:[{}]).map(rowHTML).join(""))+"</div>"+
  "<button class='btn' data-size='sm' data-variant='soft' id='sAdd' style='margin-top:2px'>+ Add repo</button>"+
  "<div style='display:flex;gap:8px;align-items:center;margin-top:16px;flex-wrap:wrap'><button class='btn' data-size='sm' id='sSave'>Save & load</button> <button class='btn' data-size='sm' data-variant='soft' id='sTest'>Test connection</button> <span class='mut' id='sMsg' style='font-size:12px'></span></div>";
 const read=()=>({repos:[...p.querySelectorAll(".repoRow")].map(row=>({url:row.querySelector(".rUrl").value.trim(),token:row.querySelector(".rTok").value.trim()})).filter(r=>r.url),labels:c.labels||{}});
 const wireDel=()=>p.querySelectorAll(".rDel").forEach(b=>b.onclick=()=>{const rows=p.querySelectorAll(".repoRow");if(rows.length>1)b.closest(".repoRow").remove();else{b.closest(".repoRow").querySelector(".rUrl").value="";b.closest(".repoRow").querySelector(".rTok").value="";}});
 wireDel();
 $("#sAdd").onclick=()=>{ $("#sRepos").insertAdjacentHTML("beforeend",rowHTML()); wireDel(); };
 const close=()=>d.remove();
 p.querySelector(".x").onclick=()=>{ if(firstRun&&!loadConfig()){$("#sMsg").textContent="Add at least one repo (URL + PAT), then Save.";return;} close(); };
 d.onclick=e=>{if(e.target===d)p.querySelector(".x").onclick()};
 $("#sTest").onclick=async()=>{
  const v=read(); if(!v.repos.length){$("#sMsg").textContent="Add at least one repo URL.";return;}
  const noTok=v.repos.filter(r=>!r.token); if(noTok.length){$("#sMsg").textContent=noTok.length+" repo(s) have no PAT.";return;}
  $("#sMsg").textContent="Testing…";
  try{
   const {sections,errors}=await discoverSections(v.repos,v.labels);
   $("#sMsg").textContent="✓ "+sections.length+" section(s) reachable"+(errors.length?" · "+errors.length+" problem(s): "+errors.map(e=>(parseRepoURL(e.url)?.repo||e.url)+": "+e.err).join("; "):"");
  }catch(e){$("#sMsg").textContent="Failed: "+e.message;}
 };
 $("#sSave").onclick=()=>{
  const v=read(); if(!v.repos.length){$("#sMsg").textContent="Need at least one repo URL.";return;}
  const noTok=v.repos.filter(r=>!r.token); if(noTok.length){$("#sMsg").textContent=noTok.length+" repo(s) have no PAT. Give every repo its own token.";return;}
  saveConfig(v); close(); boot();
 };
}

async function boot(){
 const c=loadConfig();
 app.innerHTML="<div class='wrap'><h1>Course Console</h1><div class='muted' id='bootmsg'>Loading…</div></div>";
 if(!c){ $("#bootmsg").textContent="Live from GitHub - nothing loads until you connect your teacher repos and their tokens."; openSettings(true); return; }
 try{
  $("#bootmsg").textContent="Discovering sections…";
  const {sections:scs,errors}=await discoverSections(c.repos,c.labels||{});
  if(!scs.length){
   $("#bootmsg").innerHTML="No teacher repos reachable."+(errors.length?" "+esc(errors.map(e=>e.url+": "+e.err).join(" · ")):"")+" <a href='#' id='fixCfg'>Open settings</a>";
   $("#fixCfg").onclick=e=>{e.preventDefault();openSettings(false)}; return;
  }
  // Fast path for the classroom door: #/scan boots straight into the scanner
  // from the discovery list, WITHOUT loading any gradebook (quick on a phone,
  // near-zero API budget). Bookmark this hash on the phone's home screen.
  if(location.hash.startsWith("#/scan")){ renderScanPage(scs); return; }
  const sections=[];
  for(const sc of scs){ $("#bootmsg").textContent="Loading "+sc.key+"… ("+(sections.length+1)+"/"+scs.length+")"; sections.push(await loadSection(sc)); }
  DATA={generatedAt:new Date().toISOString(),sections};
  if(errors.length) console.warn("course-console: skipped repos",errors);
  cur=Math.min(cur,sections.length-1); render();
 }catch(e){
  if(e instanceof AuthError){ $("#bootmsg").textContent=e.message; openSettings(false); }
  else { $("#bootmsg").innerHTML="Load failed: "+esc(e.message)+" · <a href='#' id='fixCfg'>settings</a>"; const f=$("#fixCfg"); if(f)f.onclick=ev=>{ev.preventDefault();openSettings(false)}; }
 }
}
// The standalone scanner page (#/scan): minimal header + the scan view, fed by
// the light discovery objects. "Full console" clears the hash and boots normally.
function renderScanPage(scs){
 app.innerHTML="";
 const w=el("div","wrap");
 const head=el("div"); head.innerHTML='<div class="hdr-actions"><button class="btn" data-size="sm" data-variant="soft" id="full">Full console</button><button class="btn" data-size="sm" data-variant="soft" id="cfg">⚙ Settings</button></div><h1>Course Console · Scan</h1><div class="muted">attendance scanner · commits batch CSVs to the teacher repo · signatures verified server-side</div>';
 w.append(head);
 const mountEl=el("div"); w.append(mountEl); app.append(w);
 renderScanView(mountEl,scs,null);
 $("#full").onclick=()=>{ stopScanner(); location.hash=""; boot(); };
 $("#cfg").onclick=()=>openSettings(false);
 app.insertAdjacentHTML("beforeend",'<footer class="made-with">made with <a href="https://tjakoen.github.io/grain">GRAIN</a> by <a href="https://tjakoen.github.io">tjakoen</a></footer>');
}

function curScheme(){ return document.documentElement.getAttribute("data-color-scheme")||(matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light"); }
function cellColor(pct){ if(pct==null)return""; const g=Math.round(pct*120); const dark=curScheme()==="dark"; return "background:hsl("+g+"deg "+(dark?"30%":"55%")+" "+(dark?"24%":"90%")+")"; }
// ---- review decisions (persisted in this browser) ----
const DKEY="hau-grade-decisions-v1";
let DEC={}; try{DEC=JSON.parse(localStorage.getItem(DKEY)||"{}")}catch(e){DEC={}}
const dkey=(sec,act,skey)=>sec+"|"+act+"|"+skey;
const getDec=(sec,act,skey)=>DEC[dkey(sec,act,skey)]||null;
const setDec=(sec,act,skey,v)=>{const k=dkey(sec,act,skey);if(v)DEC[k]=v;else delete DEC[k];localStorage.setItem(DKEY,JSON.stringify(DEC));};
const skeyOf=st=>st.number||st.name;
function exportDecisions(){
  const n=Object.keys(DEC).length;
  if(!n&&!confirm("You have 0 saved decisions. Export an empty file anyway?"))return;
  const payload={_meta:{key:DKEY,exportedAt:new Date().toISOString(),count:n},decisions:DEC};
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));
  a.download="hau-grade-decisions-"+new Date().toISOString().slice(0,10)+".json";
  a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function importDecisions(file){
  const rd=new FileReader();
  rd.onload=()=>{
    let obj; try{obj=JSON.parse(rd.result)}catch(e){alert("Not valid JSON: "+e.message);return}
    const inc=obj&&obj.decisions&&typeof obj.decisions==="object"?obj.decisions:(obj&&typeof obj==="object"&&!Array.isArray(obj)?obj:null);
    if(!inc){alert("No decisions object found in that file.");return}
    const keys=Object.keys(inc);
    if(!keys.length){alert("That file has 0 decisions.");return}
    if(!confirm("Import "+keys.length+" decision(s)? This MERGES into your current "+Object.keys(DEC).length+" (imported values win on conflicts)."))return;
    keys.forEach(k=>{DEC[k]=inc[k]});
    localStorage.setItem(DKEY,JSON.stringify(DEC));
    render();
    alert("Imported "+keys.length+" decision(s). Total now "+Object.keys(DEC).length+".");
  };
  rd.readAsText(file);
}

function render(){
 stopScanner(); // leaving the Scan tab (or re-rendering) releases the camera
 const s=DATA.sections[cur];
 app.innerHTML="";
 const w=el("div","wrap");
 const head=el("div"); head.innerHTML='<div class="hdr-actions"><button class="btn" data-size="sm" data-variant="soft" id="reload" title="Re-fetch everything from GitHub">↻ Refresh</button><button class="btn" data-size="sm" data-variant="soft" id="cfg" title="Repos & token">⚙ Settings</button><button class="btn" data-size="sm" data-variant="soft" id="expDec" title="Download all review decisions as a JSON backup">⭳ Export decisions</button><button class="btn" data-size="sm" data-variant="soft" id="impDec" title="Merge decisions from a JSON backup file">⭱ Import</button><input type="file" id="impFile" accept="application/json,.json" style="display:none"><button class="btn" data-size="sm" data-variant="soft" id="theme">◐ scheme</button></div><h1>Course Console</h1><div class="muted">loaded '+new Date(DATA.generatedAt).toLocaleString()+' · live from GitHub · <b>read-only - writes go through Intents</b>'+(rate.remaining!=null?' · API '+rate.remaining+'/'+rate.limit:'')+'</div>';
 w.append(head);
 const tabs=el("nav","tab-bar");
 DATA.sections.forEach((x,i)=>{const t=el("div","tab",esc(x.subject)+" · "+x.section);if(i===cur)t.dataset.active="true";t.onclick=()=>{cur=i;q="";revAct=null;render()};tabs.append(t)});
 w.append(tabs);
 // mode toggle
 const mt=el("nav","tab-bar");
 [["book","Gradebook"],["ai","AI Review ("+s.stats.held+")"],["att","Attendance"+(s.stats.sessions?" ("+s.stats.sessions+")":"")],["scan","Scan"]].forEach(([k,l])=>{const b=el("div","tab",l);if(mode===k)b.dataset.active="true";b.onclick=()=>{mode=k;render()};mt.append(b)});
 w.append(mt);
 app.append(w);
 if(mode==="ai") renderAI(s,w); else if(mode==="att") renderAttendance(s,w); else if(mode==="scan") renderScanView(w,DATA.sections,s.key); else renderBook(s,w);
 $("#theme").onclick=toggleTheme;
 $("#reload").onclick=()=>boot();
 $("#cfg").onclick=()=>openSettings(false);
 $("#expDec").onclick=exportDecisions;
 $("#impDec").onclick=()=>$("#impFile").click();
 $("#impFile").onchange=e=>{const f=e.target.files[0];if(f)importDecisions(f);e.target.value="";};
 // the fleet byline (grain's made-with molecule). app.mjs is browser-side under a strict CSP,
 // so the markup is inlined literally rather than imported from @tjakoen/grain/scripts/made-with.js;
 // its CSS is the made-with component baked into theme.css. Keep the string in sync with that helper.
 app.insertAdjacentHTML("beforeend",'<footer class="made-with">made with <a href="https://tjakoen.github.io/grain">GRAIN</a> by <a href="https://tjakoen.github.io">tjakoen</a></footer>');
}

function renderBook(s,w){
 const tiles=el("div","stats");
 const avgP=avg(s.students.map(x=>x.tally.pushMax?x.tally.push/x.tally.pushMax:null));
 tiles.innerHTML=[
  ["Students",s.stats.students],["Activities",s.stats.activities],
  ["Held for review",s.stats.held,"AI, not auto-pushed"],
  ["Blank student.json",s.stats.blankStudentJson],
  ["Avg auto-push",avgP==null?"-":Math.round(avgP*100)+"%"],
 ].map(([l,n,sub])=>'<div class="stat"><span class="stat__value">'+n+'</span><span class="stat__label">'+l+'</span>'+(sub?'<span class="stat__sub">'+sub+'</span>':'')+'</div>').join("");
 w.append(tiles);
 const ctl=el("div","ctl");
 ctl.innerHTML='<input class="field__input search" id="q" placeholder="Filter students…" value="'+esc(q)+'"> <button class="btn" data-size="sm" data-variant="soft" id="prompt">Generate apply-grades prompt →</button> <button class="btn" data-size="sm" id="deliver">Deliver to Canvas + workspaces →</button>';
 w.append(ctl);
 w.append(matrix(s));
 w.append(canvasPanel(s));
 $("#q").oninput=e=>{q=e.target.value.toLowerCase();renderMatrixOnly(s)};
 $("#prompt").onclick=()=>showPrompt(s);
 $("#deliver").onclick=()=>showDeliver(s);
}
function renderMatrixOnly(s){ const old=$("#matrixcard"); if(old){const n=matrix(s);old.replaceWith(n);} }

// ================= ATTENDANCE =================
function renderAttendance(s,w){
 const att=s.attendance;
 if(!att||!att.sessionDates||!att.sessionDates.length){
  w.append(el("div","card","<h2>Attendance</h2><p class='mut' style='padding:0 14px 14px'>No attendance data for this section yet. It appears here once <b>verify-attendance</b> runs on committed scans.</p>"));
  return;
 }
 const dates=att.sessionDates.slice().sort();
 const rate=st=>{const a=att.students[st.number];return a?a.count/dates.length:null};
 const tiles=el("div","stats");
 const avgRate=avg(s.students.map(rate));
 const atRisk=s.students.filter(st=>{const r=rate(st);return r!=null&&r<0.5}).length;
 tiles.innerHTML=[
  ["Sessions",dates.length],["Last session",att.lastSession||dates[dates.length-1]],
  ["Students tracked",Object.keys(att.students).length],
  ["Avg attendance",avgRate==null?"-":Math.round(avgRate*100)+"%"],
  ["Below 50%",atRisk],
 ].map(([l,n])=>'<div class="stat"><span class="stat__value">'+n+'</span><span class="stat__label">'+l+'</span></div>').join("");
 w.append(tiles);
 const ctl=el("div","ctl");
 ctl.innerHTML='<input class="field__input search" id="q" placeholder="Filter students…" value="'+esc(q)+'">';
 w.append(ctl);
 w.append(attMatrix(s,dates));
 $("#q").oninput=e=>{q=e.target.value.toLowerCase();const old=$("#attmatrix");if(old)old.replaceWith(attMatrix(s,dates));};
}
function attMatrix(s,dates){
 const att=s.attendance;
 const card=el("div","card"); card.id="attmatrix";
 card.append(el("h2",null,"Attendance - students × sessions <span class='mut' style='font-weight:400'>(✓ present · absent)</span>"));
 const sc=el("div","scroll"); const t=el("table","matrix");
 // union of gradebook students + any attendance-only numbers (present in scans but no graded work)
 const gradeNums=new Set(s.students.map(st=>st.number).filter(Boolean));
 const extras=Object.keys(att.students).filter(n=>!gradeNums.has(n)).map(n=>({number:n,name:"",github:"",attOnly:true}));
 const all=s.students.concat(extras);
 const thead="<tr><th class='stu'>Student</th><th>#</th>"+dates.map(d=>"<th class='center'>"+esc(d.slice(5))+"</th>").join("")+"<th class='center'>Present</th></tr>";
 const rows=all.filter(st=>!q||(st.name||"").toLowerCase().includes(q)||(st.number||"").includes(q)||(st.github||"").toLowerCase().includes(q)).map(st=>{
  const a=att.students[st.number]; const present=new Set(a?a.present:[]);
  let tds="<td class='stu'>"+esc(st.name||(st.attOnly?"(attendance only)":"(blank)"))+(st.github?" <span class='pill'>@"+esc(st.github)+"</span>":"")+"</td><td class='mut'>"+esc(st.number||"-")+"</td>";
  dates.forEach(d=>{tds+=present.has(d)?"<td class='cell'><b>✓</b></td>":"<td class='cell mut'>·</td>";});
  const cnt=a?a.count:0, pct=Math.round((cnt/dates.length)*100);
  tds+="<td class='center"+(pct<50?" mut":"")+"'>"+cnt+"/"+dates.length+" <span class='pill'>"+pct+"%</span></td>";
  return "<tr>"+tds+"</tr>";
 }).join("");
 t.innerHTML=thead+rows; sc.append(t); card.append(sc); return card;
}

// ================= AI REVIEW =================
function heldActs(s){return s.assignments.filter(a=>a.aiGraded)}
function reviewRows(s,aid){return s.students.filter(st=>st.activities[aid]).map(st=>({st,r:st.activities[aid],dec:getDec(s.section,aid,skeyOf(st))}))}
const isDecided=d=>!!(d&&d.status);
// decision-state -> product badge tone (hue is the documented monochrome exception)
const TONE={todo:"muted",ok:"good",ov:"held",fl:"warn"};
// activity kind -> product badge tone
const KTONE={push:"good",held:"held",quiz:"quiz",manual:"muted"};
function decStatus(row){ const d=row.dec; if(!isDecided(d))return{k:"todo",l:d&&(d.studentText||d.instructorText||d.comment)?"edited":"unreviewed"}; if(d.status==="approve")return{k:"ok",l:"approved"}; if(d.status==="override")return{k:"ov",l:"override "+d.score}; return{k:"fl",l:"flagged"}; }
function finalScore(row){ const d=row.dec; if(!d)return null; if(d.status==="override")return d.score; if(d.status==="approve")return row.r.proposed; return null; }
// split an AI note into the student-facing prose and the instructor-only block
function parseNote(note){
 if(!note) return {student:"",instructor:""};
 const idx=note.indexOf("\n---");
 let head=idx>=0?note.slice(0,idx):note;
 let instructor=idx>=0?note.slice(idx).replace(/^\s*\n?-{3,}\s*/,"").trim():"";
 const lines=head.split("\n");
 while(lines.length && (/^#/.test(lines[0].trim())||/^_.*_$/.test(lines[0].trim())||lines[0].trim()==="")) lines.shift();
 return {student:lines.join("\n").trim(), instructor};
}

function renderAI(s,w){
 const acts=heldActs(s);
 if(!acts.length){const c=el("div","card",'<p class="card__body">No AI-graded activities in this section.</p>');c.dataset.pad="sm";w.append(c);return;}
 if(!revAct||!acts.find(a=>a.id===revAct)) revAct=acts[0].id;
 const sub=el("nav","tab-bar");
 acts.forEach(a=>{const rows=reviewRows(s,a.id);const done=rows.filter(x=>isDecided(x.dec)).length;const b=el("div","tab",esc(a.id)+" <span class='pill'>"+done+"/"+rows.length+"</span>");if(revAct===a.id)b.dataset.active="true";b.onclick=()=>{revAct=a.id;render()};sub.append(b)});
 w.append(sub);
 const rows=reviewRows(s,revAct);
 const done=rows.filter(x=>isDecided(x.dec)).length, appr=rows.filter(x=>x.dec&&x.dec.status==="approve").length, ov=rows.filter(x=>x.dec&&x.dec.status==="override").length, fl=rows.filter(x=>x.dec&&x.dec.status==="flag").length;
 // progress + actions
 const bar=el("div","card"); bar.dataset.pad="sm"; const pct=rows.length?Math.round(done/rows.length*100):0;
 bar.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'+
  '<div><b>'+esc(revAct)+'</b> - reviewed <b>'+done+'/'+rows.length+'</b> · <span class="badge" data-tone="good">'+appr+' approved</span> <span class="badge" data-tone="held">'+ov+' override</span> <span class="badge" data-tone="warn">'+fl+' flagged</span></div>'+
  '<div><button class="btn" data-size="sm" data-variant="soft" id="genFb">Generate feedback → prompt</button> <button class="btn" data-size="sm" data-variant="soft" id="apprAll">Approve all unreviewed</button> <button class="btn" data-size="sm" data-variant="soft" id="reset">Reset</button> <button class="btn" data-size="sm" id="applyAI">Apply reviewed → prompt</button> <button class="btn" data-size="sm" id="finalize">Finalize → publish + Canvas</button></div></div>'+
  '<div class="meter" role="meter" aria-label="Review progress" aria-valuenow="'+pct+'" aria-valuemin="0" aria-valuemax="100"><span class="meter__seg" data-tone="ok" style="--seg:'+pct+'%"></span></div>';
 w.append(bar);
 // queue table
 const card=el("div","card"); card.dataset.pad="sm"; card.append(el("h2","card__title","Review queue - click a row to read the feedback and decide"));
 const scr=el("div","table-scroll"); const t=el("table","table");
 const max=s.assignments.find(a=>a.id===revAct).totalPoints;
 t.innerHTML="<tr><th>Student</th><th>#</th><th class='center'>Proposed</th><th class='center'>AI-authored likelihood</th><th class='center'>Decision</th><th class='center'>Final</th></tr>"+
 rows.map(row=>{
   const stt=decStatus(row), fin=finalScore(row);
   const flag=row.r.aiFlag||"-"; const fl=/high/i.test(flag)?"bad":/medium/i.test(flag)?"warn":"good";
   const skey=esc(skeyOf(row.st));
   return "<tr data-s='"+skey+"'><td>"+esc(row.st.name||"(blank)")+(row.r.triage?" <span class='badge' data-tone='warn' title='"+esc(row.r.triage)+"'>flag</span>":"")+"</td><td class='mut'>"+esc(row.st.number||"-")+"</td>"+
     "<td class='center'>"+(row.r.proposed!=null?row.r.proposed+"/"+max:"<span class='badge' data-tone='warn'>no score</span>")+"</td>"+
     "<td class='center'><span class='badge' data-tone='"+fl+"'>"+esc(flag.split(" - ")[0])+"</span></td>"+
     "<td class='center'><span class='badge' data-tone='"+TONE[stt.k]+"'>"+stt.l+"</span></td>"+
     "<td class='center tot'>"+(fin!=null?fin+"/"+max:"-")+"</td></tr>";
 }).join("");
 scr.append(t); card.append(scr); w.append(card);
 setTimeout(()=>{
   t.querySelectorAll("tr[data-s]").forEach(tr=>tr.onclick=()=>openReview(s,revAct,tr.dataset.s));
   $("#apprAll").onclick=()=>{rows.forEach(row=>{if(!isDecided(row.dec)&&row.r.proposed!=null)setDec(s.section,revAct,skeyOf(row.st),Object.assign({},row.dec,{status:"approve"}))});render()};
   $("#reset").onclick=()=>{if(confirm("Clear all decisions for "+revAct+"?")){rows.forEach(row=>setDec(s.section,revAct,skeyOf(row.st),null));render()}};
   $("#genFb").onclick=()=>showGenFeedback(s,revAct);
   $("#applyAI").onclick=()=>showApplyAI(s,revAct);
   $("#finalize").onclick=()=>showFinalize(s,revAct);
 },0);
}

function shotsHTML(list){
 if(list===null) return "<div class='noshot'>Loading screenshots from the previews branch…</div>";
 if(!list.length) return "<div class='noshot'>No screenshots for this submission.<br><span style='font-size:12px'>(not a design activity, or no preview was published)</span></div>";
 return list.map(sh=>"<div class='shot'><div class='cap'>"+esc(sh.label)+"</div><a href='"+esc(sh.file)+"' target='_blank' rel='noopener'><img loading='lazy' src='"+esc(sh.file)+"' alt='"+esc(sh.label)+" screenshot'></a></div>").join("");
}
function codeHTML(files){
 if(files===undefined) return "<div class='noshot'>Loading source from GitHub…</div>";
 if(!files||!files.length) return "<div class='noshot'>No code found for this submission.</div>";
 return "<select class='field__select cfile' id='cfile'>"+files.map((f,i)=>"<option value='"+i+"'>"+esc(f.path)+"</option>").join("")+"</select>"+
   "<pre class='code-block codepre' id='cpre'>"+hl(files[0].content,files[0].lang)+"</pre>";
}
// tiny self-contained syntax highlighter (no external lib; local file:// safe)
const HLKW=new Set("await async break case catch class const continue debugger default delete do else export extends false finally for from function if implements import in instanceof interface let new null of return super switch this throw true try typeof var void while with yield static get set public private protected abstract final dynamic bool int double num String List Map Widget build override late required as is enum mixin extension typedef on part show hide library".split(/\s+/));
function hlCode(s){
 const re=/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\[\s\S]|[^`\\])*`|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)/g;
 let out="",last=0,m;
 while((m=re.exec(s))){ out+=esc(s.slice(last,m.index)); last=re.lastIndex;
  if(m[1])out+="<span class=tc>"+esc(m[1])+"</span>";
  else if(m[2])out+="<span class=ts>"+esc(m[2])+"</span>";
  else if(m[3])out+="<span class=tn>"+esc(m[3])+"</span>";
  else out+=(HLKW.has(m[4])?"<span class=tk>"+esc(m[4])+"</span>":esc(m[4])); }
 return out+esc(s.slice(last));
}
function hlMarkup(s){
 const re=/(<!--[\s\S]*?-->)|(<\/?[A-Za-z][^>]*>)/g;
 let out="",last=0,m;
 while((m=re.exec(s))){ out+=esc(s.slice(last,m.index)); last=re.lastIndex;
  if(m[1])out+="<span class=tc>"+esc(m[1])+"</span>";
  else out+="<span class=tg>"+esc(m[2]).replace(/("[^"]*"|'[^']*')/g,x=>"<span class=ts>"+x+"</span>")+"</span>"; }
 return out+esc(s.slice(last));
}
function hl(code,lang){ return /^(html?|xml|vue|svelte)$/.test(lang||"")?hlMarkup(String(code)):hlCode(String(code)); }
function openReview(s,aid,skey){
 const max=s.assignments.find(a=>a.id===aid).totalPoints;
 const order=reviewRows(s,aid).map(row=>skeyOf(row.st));
 let idx=Math.max(0,order.indexOf(skey));
 let leftView=null;   // "shots" | "code" - persists across prev/next in this drawer
 const d=el("div","drawer on"); const p=el("div","dp wide"); d.append(p); document.body.append(d);
 const close=()=>{d.remove();document.removeEventListener("keydown",onKey);render()};
 const onKey=e=>{ if(e.key==="Escape")close(); else if(e.key==="ArrowRight"&&idx<order.length-1)paint(idx+1); else if(e.key==="ArrowLeft"&&idx>0)paint(idx-1); };
 function paint(i){
  idx=i; const sk=order[i];
  const st=s.students.find(x=>skeyOf(x)===sk); const r=st.activities[aid];
  const orig=parseNote(r.note);
  // lazy media: kick off the fetch on first sight of this repo, repaint when it lands
  const shots=shotsCached(s.section,r.repo);   // null = loading, [] = none
  const files=codeCached(s.section,r.repo);    // undefined = loading, null = none
  if(shots===null||files===undefined){
   Promise.all([shotsFor(s.section,s.org,r.repo),codeFor(s.section,s.org,r.repo)])
    .then(()=>{ if(document.body.contains(d)&&order[idx]===sk) paint(idx); });
  }
  const hasShots=!!(shots&&shots.length);
  const hasCode=!!(files&&files.length);
  if(leftView===null||(leftView==="shots"&&!hasShots&&hasCode)||(leftView==="code"&&!hasCode&&hasShots)) leftView=hasShots?"shots":(hasCode?"code":"shots");
  const lv=leftView;
  const curDec=getDec(s.section,aid,sk);
  const stt=decStatus({dec:curDec});
  const chip="<span class='badge' data-tone='"+TONE[stt.k]+"'>"+stt.l+"</span>";
  const flag=r.aiFlag?r.aiFlag.split(" - ")[0]:null;
  p.innerHTML="<button class='x'>×</button>"+
   "<div class='rvhead'><h3 style='margin:0'>"+esc(st.name||"(blank)")+"</h3>"+chip+
     "<div class='rvnav'><button class='btn' data-size='sm' data-variant='soft' id='prev'"+(i<=0?" disabled":"")+">← Prev</button>"+
     "<span class='cnt'>"+(i+1)+" / "+order.length+"</span>"+
     "<button class='btn' data-size='sm' data-variant='soft' id='next'"+(i>=order.length-1?" disabled":"")+">Next →</button></div></div>"+
   "<div class='muted'>"+esc(aid)+" · "+esc(sk)+" · @"+esc(st.github||"")+" · repo "+esc(r.repo)+"</div>"+
   "<div class='legend'><span>Automated: <b>"+r.raw+"</b></span><span>AI proposed: <b data-grade='grain'>"+(r.proposed!=null?r.proposed+"/"+max:"-")+"</b></span>"+(flag?"<span>AI-authored: <b data-grade='grain'>"+esc(flag)+"</b></span>":"")+"</div>"+
   "<div class='rev2'>"+
    "<div class='rvcol'>"+
     "<nav class='tab-bar'>"+
      "<button class='tab'"+(lv==='shots'?" data-active='true'":"")+" data-lv='shots'"+(hasShots?'':' disabled')+">Screenshots</button>"+
      "<button class='tab'"+(lv==='code'?" data-active='true'":"")+" data-lv='code'"+(hasCode?'':' disabled')+">Code"+(hasCode?" <span class='pill'>"+files.length+"</span>":"")+"</button>"+
     "</nav>"+
     "<div class='shots' id='lvShots' style='display:"+(lv==='shots'?'flex':'none')+"'>"+shotsHTML(shots)+"</div>"+
     "<div id='lvCode' style='display:"+(lv==='code'?'block':'none')+"'>"+codeHTML(files)+"</div>"+
    "</div>"+
    "<div class='rvcol'>"+
     "<div class='card' data-pad='sm' style='margin:0 0 12px'>"+
      "<div class='decision'>"+
      "<button class='btn' data-size='sm' id='dApprove'>✓ Approve "+(r.proposed!=null?r.proposed+"/"+max:"")+"</button>"+
      "<span>Override <input id='dOv' class='field__input num' type='number' min='0' max='"+max+"' value='"+(curDec&&curDec.status==='override'?curDec.score:(r.proposed!=null?r.proposed:''))+"'> /"+max+" <button class='btn' data-size='sm' data-variant='soft' id='dOvBtn'>Set</button></span>"+
      "<button class='btn' data-size='sm' data-variant='soft' id='dFlag'>⚑ Flag</button>"+
      "<button class='btn' data-size='sm' data-variant='soft' id='dClear'>Clear</button></div>"+
      "<input class='field__input' id='dComment' style='width:100%;margin-top:8px' placeholder='Private note to yourself (goes to the apply prompt)…' value='"+esc(curDec&&curDec.comment||"")+"'>"+
     "</div>"+
     "<label class='field'><span class='field__label'>Student-facing feedback <span class='mut'>- delivered as FEEDBACK.md, prose only</span>"+(curDec&&curDec.studentText!=null?" <span class='badge' data-tone='held'>edited</span>":"")+"</span>"+
     "<textarea id='dStudent' class='field__input fta' data-grade='"+(curDec&&curDec.studentText!=null?"smooth":"grain")+"' rows='10'>"+esc(curDec&&curDec.studentText!=null?curDec.studentText:orig.student)+"</textarea></label>"+
     "<label class='field'><span class='field__label'>Instructor-only notes <span class='mut'>- never delivered to the student</span>"+(curDec&&curDec.instructorText!=null?" <span class='badge' data-tone='held'>edited</span>":"")+"</span>"+
     "<textarea id='dInstr' class='field__input fta mono' rows='12'>"+esc(curDec&&curDec.instructorText!=null?curDec.instructorText:orig.instructor)+"</textarea></label>"+
     "<div style='display:flex;gap:8px;align-items:center;margin-top:8px'><button class='btn' data-size='sm' id='dSave'>Save edits</button> <button class='btn' data-size='sm' data-variant='soft' id='dRevert'>Revert to AI text</button> <span class='mut' id='dSaved' style='font-size:12px'></span></div>"+
    "</div>"+
   "</div>";
  p.querySelector(".x").onclick=close;
  const prev=$("#prev"),next=$("#next");
  if(prev)prev.onclick=()=>{if(idx>0)paint(idx-1)};
  if(next)next.onclick=()=>{if(idx<order.length-1)paint(idx+1)};
  // left-pane toggle (screenshots <-> code) - no repaint, just show/hide
  p.querySelectorAll(".tab[data-lv]").forEach(b=>b.onclick=()=>{ if(b.disabled)return; leftView=b.dataset.lv;
    $("#lvShots").style.display=leftView==="shots"?"flex":"none"; $("#lvCode").style.display=leftView==="code"?"block":"none";
    p.querySelectorAll(".tab[data-lv]").forEach(x=>{if(x.dataset.lv===leftView)x.dataset.active="true";else x.removeAttribute("data-active")}); });
  const cf=$("#cfile"); if(cf){ cf.onchange=()=>{ const f=files[+cf.value]; $("#cpre").innerHTML=hl(f.content,f.lang); }; }
  // gather the current text edits + comment, keeping only what differs from the AI original
  const collect=(extra)=>{ const d=Object.assign({},getDec(s.section,aid,sk)||{},extra);
    const stv=$("#dStudent").value, inv=$("#dInstr").value, cm=$("#dComment").value;
    if(stv.trim()!==orig.student.trim())d.studentText=stv; else delete d.studentText;
    if(inv.trim()!==orig.instructor.trim())d.instructorText=inv; else delete d.instructorText;
    if(cm)d.comment=cm; else delete d.comment;
    return d; };
  const save=v=>{setDec(s.section,aid,sk,v);if(idx<order.length-1)paint(idx+1);else paint(idx);};
  $("#dApprove").onclick=()=>save(collect(r.proposed!=null?{status:"approve"}:{status:"override",score:+$("#dOv").value}));
  $("#dOvBtn").onclick=()=>save(collect({status:"override",score:+$("#dOv").value}));
  $("#dFlag").onclick=()=>save(collect({status:"flag"}));
  $("#dClear").onclick=()=>{setDec(s.section,aid,sk,null);paint(idx);};
  $("#dSave").onclick=()=>{const d=collect({});setDec(s.section,aid,sk,Object.keys(d).length?d:null);$("#dSaved").textContent="saved ✓";const stt2=decStatus({dec:getDec(s.section,aid,sk)});const c=p.querySelector(".rvhead .badge");if(c){c.dataset.tone=TONE[stt2.k];c.textContent=stt2.l;}};
  $("#dRevert").onclick=()=>{$("#dStudent").value=orig.student;$("#dInstr").value=orig.instructor;const d=collect({});setDec(s.section,aid,sk,Object.keys(d).length?d:null);paint(idx);};
 }
 d.onclick=e=>{if(e.target===d)close()};
 document.addEventListener("keydown",onKey);
 paint(idx);
}

function showGenFeedback(s,aid){
 const rows=reviewRows(s,aid); const max=s.assignments.find(a=>a.id===aid).totalPoints;
 const pending=rows.filter(x=>!x.r.note);
 const txt=
"# Generate AI feedback drafts - "+s.subject+" (section "+s.section+") - "+aid+"\n\n"+
"The grade sweep wrote a per-submission input file to gradebook/notes-input/"+aid+"/ for each submission that opted in. Turn each into a reviewable note draft I can check in this dashboard. Work from: "+workFrom(s)+" - pull it first.\n\n"+
"## What to do\n"+
"For EVERY gradebook/notes-input/"+aid+"/<repo>.md that does NOT already have a matching gradebook/notes/"+aid+"/<repo>.md:\n"+
"  1. Read the input file. It embeds the persona, the hard rules, the class context, the rubric, the automated result, the student source, and the exact output format.\n"+
"  2. If it lists screenshots, open those image files (gradebook/notes-input/"+aid+"/<repo>.shots/...) to judge the design.\n"+
"  3. Write gradebook/notes/"+aid+"/<repo>.md following that file's skeleton and output format EXACTLY: the student-facing prose half (no scores, no rubric, no \"AI\" mention), then a line with only ---, then \"**For the instructor (not shown to the student):**\", then the rubric breakdown, a \"Proposed total: N/"+max+"\" line, and the \"AI-authored likelihood\" line.\n\n"+
"## Rules (do not violate)\n"+
"- This step DRAFTS notes only. Do NOT write grades.csv, do NOT flip \"publish\": true, do NOT publish to students, do NOT push Canvas.\n"+
"- SKIP any repo that already has a note in gradebook/notes/"+aid+"/ - never overwrite a draft I may have edited.\n"+
"- The student-facing half must never mention \"AI\", scores, points, or the rubric; the likelihood/vibecode line stays in the instructor half only.\n"+
"- Only process repos that have an input file; do not invent submissions.\n\n"+
"When done, COMMIT AND PUSH the new notes to the teacher repo. The hosted dashboard reads the repo live - I'll hit Refresh, review each draft and its proposed score, then Approve/Override/Flag there.\n";
 const d=el("div","drawer on"); const p=el("div","dp");
 p.innerHTML="<button class='x'>×</button><h3>Generate AI feedback drafts - "+esc(aid)+"</h3><div class='muted'>"+pending.length+" submission(s) without a note yet · runs in a Claude Code session on your subscription (no GitHub Models)</div><div style='margin:10px 0'><button class='btn' data-size='sm' id='send'>Send to repo →</button> <button class='btn' data-size='sm' data-variant='soft' id='cp'>Copy prompt</button></div><pre class='code-block prompt' id='ptxt'>"+esc(txt)+"</pre>";
 d.append(p); document.body.append(d);
 const close=()=>d.remove(); p.querySelector(".x").onclick=close; d.onclick=e=>{if(e.target===d)close()};
 $("#cp").onclick=()=>navigator.clipboard.writeText(txt).then(()=>$("#cp").textContent="Copied ✓");
 wireSend(s,"gen-feedback",aid,txt);
}

function showApplyAI(s,aid){
 const rows=reviewRows(s,aid); const max=s.assignments.find(a=>a.id===aid).totalPoints;
 const decided=rows.filter(x=>isDecided(x.dec)&&x.dec.status!=="flag");
 const flagged=rows.filter(x=>x.dec&&x.dec.status==="flag");
 const undone=rows.filter(x=>!isDecided(x.dec));
 const edited=decided.filter(x=>x.dec.studentText!=null||x.dec.instructorText!=null);
 const lines=decided.map(x=>{const fin=finalScore(x);const tags=[x.dec.status==="override"?"OVERRIDE - was "+(x.r.proposed==null?"none":x.r.proposed):"approved"];if(x.dec.studentText!=null)tags.push("edited student feedback");if(x.dec.instructorText!=null)tags.push("edited instructor note");return "  - "+(x.st.name||x.r.repo)+" ("+(x.st.number||"?")+") · "+x.r.repo+": "+fin+"/"+max+"  ["+tags.join("; ")+"]"+(x.dec.comment?" - note: "+x.dec.comment:"");}).join("\n");
 const editBlocks=edited.map(x=>{
   let b="### "+x.r.repo+"  (final "+finalScore(x)+"/"+max+")\n";
   if(x.dec.studentText!=null)b+="STUDENT-FACING - replace the prose half of gradebook/notes/"+aid+"/"+x.r.repo+".md (between the italic disclaimer line and the '---' instructor separator):\n<<<\n"+x.dec.studentText+"\n>>>\n";
   if(x.dec.instructorText!=null)b+="INSTRUCTOR-ONLY - replace the instructor half (everything after the '---'):\n<<<\n"+x.dec.instructorText+"\n>>>\n";
   return b;
 }).join("\n");
 const txt=
"# Apply reviewed AI grades - "+s.subject+" (section "+s.section+") - "+aid+"\n\n"+
"I have reviewed the held AI grades for "+aid+". Apply my decisions below. Work from: "+workFrom(s)+" - pull it first.\n\n"+
"## Reviewed decisions (final score / "+max+")\n"+(lines||"  (none decided yet)")+"\n\n"+
(editBlocks?"## Edited feedback to write (use this EXACT text, verbatim)\n"+editBlocks+"\n":"")+
(flagged.length?"## Flagged for deeper review - do NOT apply, publish, or push; re-examine and report back to me\n"+
"For each student below, do a thorough second pass on "+aid+":\n"+
"  1. Read the current assessment in gradebook/notes/"+aid+"/<repo>.md and the rubric in grader/"+aid+"/RUBRIC.md (plus grader/class-prompt.md).\n"+
"  2. Clone the submission repo at its graded SHA and read the ACTUAL code; if it is a design activity, open its screenshots (gradebook/previews/"+aid+"/<repo>/ or the previews branch).\n"+
"  3. Produce a fresh per-criterion breakdown, a revised proposed score out of "+max+", and a revised student-facing feedback draft, explicitly addressing my flag note. Call out anything that looks off (over/under-scored, mismatch with the code, possible integrity issue).\n"+
"  4. Present it all to me in chat for a decision. Do NOT write grades.csv, notes, publish, or push Canvas for these students.\n\n"+
flagged.map(x=>"  - "+(x.st.name||x.r.repo)+" ("+(x.st.number||"?")+") · "+x.r.repo+" @"+(x.r.sha||"?")+" · current proposed "+(x.r.proposed!=null?x.r.proposed+"/"+max:"none")+(x.r.aiFlag?" · AI-likelihood "+x.r.aiFlag.split(" - ")[0]:"")+(x.dec.comment?" - my note: "+x.dec.comment:"")).join("\n")+"\n\n":"")+
(undone.length?"## Not yet reviewed ("+undone.length+") - do NOT apply\n\n":"")+
"## Steps\n"+
"1. For each OVERRIDE student, set gradebook/grades.csv aiScore to the final score I gave (do not touch the objective test score column). Approved students keep the AI's proposed aiScore.\n"+
"2. For every FLAGGED or NOT-YET-REVIEWED student on "+aid+", BLANK their aiScore cell in gradebook/grades.csv. A blank aiScore holds a student out of the Canvas push (canvas-push skips it) and marks them not-cleared for delivery.\n"+
"3. For every student under \"Edited feedback to write\", overwrite gradebook/notes/"+aid+"/<repo>.md with my exact text: replace the student-facing prose half and/or the instructor half as labelled, keeping the title line and the italic disclaimer line intact. For OVERRIDE students with no edited instructor text, still update the instructor note's proposed total to match my score, adjust the per-criterion bullets to sum to it, and record the human-review note on the proposed-total line (so it stays out of the Canvas comment).\n"+
"4. Verify the gradebook: overrides show my score, flagged/unreviewed aiScore are blank, approved are unchanged. Commit and push - the hosted dashboard reads the repo live; I'll refresh to review the applied grades before delivery.\n\n"+
"Do NOT publish or push Canvas from this prompt, and do NOT flip \"publish\": true. This prompt writes grades only. Delivery (flip publish:true, publish to students, push Canvas, verify) is the separate Finalize step (the Finalize button emits that prompt), gated on my go. The student-facing FEEDBACK.md and the Canvas comment must stay free of any \"AI\" mention and of the instructor-only likelihood/vibecode line. The <<< >>> markers are delimiters only - do not include them in the files.\n";
 const d=el("div","drawer on"); const p=el("div","dp");
 p.innerHTML="<button class='x'>×</button><h3>Apply reviewed AI grades - "+esc(aid)+"</h3><div class='muted'>"+decided.length+" to apply · "+flagged.length+" flagged · "+undone.length+" not reviewed</div><div style='margin:10px 0'><button class='btn' data-size='sm' id='send'>Send to repo →</button> <button class='btn' data-size='sm' data-variant='soft' id='cp'>Copy prompt</button> <button class='btn' data-size='sm' data-variant='soft' id='csv'>Download CSV</button></div><pre class='code-block prompt' id='ptxt'>"+esc(txt)+"</pre>";
 d.append(p); document.body.append(d);
 const close=()=>d.remove(); p.querySelector(".x").onclick=close; d.onclick=e=>{if(e.target===d)close()};
 $("#cp").onclick=()=>navigator.clipboard.writeText(txt).then(()=>$("#cp").textContent="Copied ✓");
 wireSend(s,"apply-ai",aid,txt);
 $("#csv").onclick=()=>{
   const hdr="studentNumber,name,repo,proposed,decision,finalScore,max,comment\n";
   const body=rows.map(x=>{const fin=finalScore(x);const st=isDecided(x.dec)?x.dec.status:"unreviewed";return [x.st.number||"",'"'+(x.st.name||"").replace(/"/g,'""')+'"',x.r.repo,x.r.proposed==null?"":x.r.proposed,st,fin==null?"":fin,max,'"'+((x.dec&&x.dec.comment||"")).replace(/"/g,'""')+'"'].join(",")}).join("\n");
   const blob=new Blob([hdr+body],{type:"text/csv"});const u=URL.createObjectURL(blob);const a=el("a");a.href=u;a.download="ai-review-"+s.section+"-"+aid+".csv";a.click();URL.revokeObjectURL(u);
 };
}

function showFinalize(s,aid){
 const rows=reviewRows(s,aid); const max=s.assignments.find(a=>a.id===aid).totalPoints;
 const delivered=rows.filter(x=>isDecided(x.dec)&&x.dec.status!=="flag");
 const heldOut=rows.filter(x=>!(isDecided(x.dec)&&x.dec.status!=="flag"));
 const delList=delivered.map(x=>"  - "+x.r.repo+": "+finalScore(x)+"/"+max).join("\n")||"  (none cleared yet)";
 const heldList=heldOut.map(x=>"  - "+x.r.repo+(x.dec&&x.dec.status==="flag"?" (flagged)":" (not reviewed)")).join("\n")||"  (none)";
 const txt=
"# Finalize and deliver - "+s.subject+" (section "+s.section+") - "+aid+"\n\n"+
"The reviewed grades for "+aid+" are already written to the gradebook (approved + overrides applied; held/flagged aiScore blanked). Now deliver ONLY the cleared students to their workspaces and to Canvas. Work from: "+workFrom(s)+" - pull it first.\n\n"+
"## Cleared to deliver ("+delivered.length+")\n"+delList+"\n\n"+
"## Held OUT - do NOT deliver ("+heldOut.length+")\n"+heldList+"\n\n"+
"## Rules (do not violate)\n"+
"- Dry-run first for BOTH publish and Canvas; execute only on my explicit \"go\".\n"+
"- Student FEEDBACK.md and the Canvas comment carry NO scores-as-AI, no \"AI\" mention, and never the instructor-only likelihood/vibecode line.\n"+
"- publish-grades.mjs gates on aiScore: a blank aiScore holds a student out of BOTH the student publish and the Canvas push, so a single publish only="+aid+" delivers exactly the cleared students above (held/flagged students, with blank aiScore, are skipped automatically).\n\n"+
"## Steps\n"+
"1. Flip \"publish\": true on "+aid+" in grader/assignments.json (the readiness gate; nothing delivers yet).\n"+
"2. Student publish (publish.yml), DRY RUN (publish=false), restricted to the cleared repos. Show me the plan; confirm it lists exactly the cleared repos above and no held student.\n"+
"3. On my \"go\": run publish for real (publish=true) for the cleared repos only.\n"+
"4. Canvas push in CHECK mode for "+aid+" (tools/canvas-push.mjs --section="+s.section+" --check). Show the report; confirm every cleared student maps and no held student appears (held students have blank aiScore and are skipped).\n"+
"5. On my \"go\": canvas-push --execute. Each cleared student gets their final score PLUS a rubric-breakdown comment (per-criterion points + feedback prose).\n"+
"6. VERIFY: each cleared student received FEEDBACK.md/GRADES.md and the correct Canvas grade + comment (spot-check 2-3), and NO held/flagged student got anything.\n";
 const d=el("div","drawer on"); const p=el("div","dp");
 p.innerHTML="<button class='x'>×</button><h3>Finalize and deliver - "+esc(aid)+"</h3><div class='muted'>"+delivered.length+" cleared to deliver · "+heldOut.length+" held out</div><div style='margin:10px 0'><button class='btn' data-size='sm' id='send'>Send to repo →</button> <button class='btn' data-size='sm' data-variant='soft' id='cp'>Copy prompt</button></div><pre class='code-block prompt' id='ptxt'>"+esc(txt)+"</pre>";
 d.append(p); document.body.append(d);
 const close=()=>d.remove(); p.querySelector(".x").onclick=close; d.onclick=e=>{if(e.target===d)close()};
 $("#cp").onclick=()=>navigator.clipboard.writeText(txt).then(()=>$("#cp").textContent="Copied ✓");
 wireSend(s,"finalize",aid,txt);
}

function matrix(s){
 const card=el("div","card"); card.id="matrixcard";
 card.append(el("h2",null,"Gradebook - students × activities <span class='mut' style='font-weight:400'>(click a cell for feedback)</span>"));
 const leg=el("div","legend"); leg.style.padding="0 14px";
 leg.innerHTML='<span><span class="b push">push</span> auto-pushed to Canvas</span><span><span class="b held">held</span> AI proposal, review first</span><span><span class="b quiz">quiz</span> import to Canvas</span><span><span class="b manual">manual</span> hand-entered</span><span>cell = Canvas points / max</span>';
 card.append(leg);
 const sc=el("div","scroll"); const t=el("table","matrix");
 const cols=s.assignments;
 let thead="<tr><th class='stu'>Student</th><th>#</th>"+cols.map(a=>"<th class='center'>"+esc(a.id)+"<br><span class='pill'>"+(a.totalPoints!=null?a.totalPoints+"pt":a.autoPoints!=null?a.autoPoints+"pt":"tests")+"</span><br><span class='b "+a.kind+"'>"+a.kind+"</span></th>").join("")+"<th class='center'>Push total</th><th class='center'>+Held</th></tr>";
 const rows=s.students.filter(st=>!q||(st.name||"").toLowerCase().includes(q)||(st.number||"").includes(q)||(st.github||"").toLowerCase().includes(q)).map(st=>{
   let tds="<td class='stu' title='"+esc(st.name)+"'>"+esc(st.name||"(blank)")+(st.github?" <span class='pill'>@"+esc(st.github)+"</span>":"")+"</td><td class='mut'>"+esc(st.number||"-")+"</td>";
   cols.forEach(a=>{
     const r=st.activities[a.id];
     if(!r){tds+="<td class='cell mut'>·</td>";return;}
     const max=a.totalPoints ?? a.autoPoints ?? r.total;
     let disp,pct=null,cls="";
     if(r.kind==="held"){disp=(r.proposed!=null?r.proposed:"?")+"/"+max;pct=r.proposed!=null&&max?r.proposed/max:null;cls="held";}
     else if(r.kind==="manual"){disp="-";cls="manual";}
     else {disp=(r.canvasPts!=null?r.canvasPts:"?")+"/"+max;pct=r.canvasPts!=null&&max?r.canvasPts/max:null;cls="push";}
     tds+="<td class='cell "+cls+"' style='"+cellColor(pct)+"' data-s='"+esc(st.number||st.name)+"' data-a='"+a.id+"'>"+disp+(r.late?" <span class=pill>late</span>":"")+"</td>";
   });
   tds+="<td class='center tot'>"+st.tally.push+"<span class='pill'>/"+st.tally.pushMax+"</span></td><td class='center mut'>"+(st.tally.held?"+"+st.tally.held+"/"+st.tally.heldMax:"-")+"</td>";
   return "<tr>"+tds+"</tr>";
 }).join("");
 t.innerHTML=thead+rows;
 sc.append(t); card.append(sc);
 setTimeout(()=>t.querySelectorAll("td.cell[data-a]").forEach(td=>td.onclick=()=>openNote(s,td.dataset.s,td.dataset.a)),0);
 return card;
}

function openNote(s,skey,aid){
 const st=s.students.find(x=>(x.number||x.name)===skey); if(!st)return;
 const r=st.activities[aid]; if(!r)return;
 const d=el("div","drawer on"); const p=el("div","dp");
 const a=s.assignments.find(x=>x.id===aid);
 const max=a.totalPoints ?? a.autoPoints ?? r.total;
 const val=r.kind==="held"?(r.proposed+"/"+max+" (held - review)"):r.kind==="manual"?"manual":(r.canvasPts+"/"+max);
 p.innerHTML="<button class='x'>×</button><h3>"+esc(st.name)+" - "+esc(aid)+"</h3><div class='muted'>"+esc(st.number||"")+" · @"+esc(st.github||"")+" · repo "+esc(r.repo)+" @"+esc(r.sha)+"</div>"+
  "<div class='legend'><span>Automated: <b>"+r.raw+"</b></span><span>Canvas: <b>"+val+"</b></span></div>"+
  "<pre>"+esc(r.note||"(no written feedback)")+"</pre>";
 d.append(p); document.body.append(d);
 const close=()=>d.remove(); p.querySelector(".x").onclick=close; d.onclick=e=>{if(e.target===d)close()};
}

function canvasPanel(s){
 const card=el("div","card");
 card.append(el("h2",null,"Canvas preview - what a push would do"));
 const bd=el("div","bd scroll");
 const t=el("table");
 t.innerHTML="<tr><th>Activity</th><th>Max</th><th>Graded</th><th>Status</th><th>Avg (of graded)</th></tr>"+
 s.assignments.map(a=>{
   const rs=s.students.map(st=>st.activities[a.id]).filter(Boolean);
   const max=a.totalPoints ?? a.autoPoints ?? "tests";
   let status,avgv;
   if(a.manual){status="<span class='b manual'>manual - skipped</span>";}
   else if(a.aiGraded){status="<span class='b held'>held for review</span>";}
   else{status="<span class='b push'>auto-push"+(a.locked?" · locked":"")+"</span>";}
   const vals=rs.map(r=>a.aiGraded?r.proposed:r.canvasPts).filter(v=>v!=null);
   avgv=vals.length?(Math.round(vals.reduce((x,y)=>x+y,0)/vals.length*10)/10):"-";
   return "<tr><td><b>"+esc(a.id)+"</b>"+(a.feedback?" <span class=pill>"+a.feedback+"</span>":"")+"</td><td>"+max+"</td><td>"+rs.length+"</td><td>"+status+"</td><td>"+avgv+"</td></tr>";
 }).join("");
 bd.append(t);
 const note=el("div","mut"); note.style.marginTop="10px"; note.style.fontSize="12px";
 note.innerHTML="Held (AI) activities are never auto-pushed - deliver them via publish after you review the notes. The exact push counts come from <code>canvas-push --check</code> (the prompt runs it).";
 bd.append(note); card.append(bd); return card;
}

function showPrompt(s){
 const held=s.assignments.filter(a=>a.aiGraded).map(a=>a.id);
 const push=s.assignments.filter(a=>!a.aiGraded&&!a.manual).map(a=>a.id);
 const rows=s.assignments.filter(a=>!a.aiGraded&&!a.manual).map(a=>{
   const rs=s.students.map(st=>st.activities[a.id]).filter(Boolean);
   return "  - "+a.id+": "+(a.totalPoints!=null?a.totalPoints+" pts":"raw tests")+", "+rs.length+" students graded";
 }).join("\n");
 const txt=
"# Apply grades to Canvas - "+s.subject+" (section "+s.section+")\n\n"+
"You are my grading assistant for the HAU platform. Apply the reviewed grades for this section to Canvas. Work from the teacher repo:\n"+
workFrom(s)+" - pull it first.\n\n"+
"## Rules (do not violate)\n"+
"- gradebook/grades.csv is the source of truth. Never hand-edit a grade.\n"+
"- These AI/held activities must NOT be auto-pushed - I review + publish them separately: "+(held.join(", ")||"(none)")+".\n"+
"- Dry-run first. Only execute on my explicit \"go\".\n\n"+
"## Steps\n"+
"1. Re-run a grade sweep only if submissions changed since "+new Date(DATA.generatedAt).toLocaleDateString()+"; otherwise use the current gradebook.\n"+
"2. Canvas push in CHECK mode for section "+s.section+" (tools/canvas-push.mjs --section="+s.section+" --check, or the Canvas push workflow in check mode). \n"+
"3. Show me the report: # grades, # students matched, per-activity counts, and ANY unmatched students or points-possible mismatches.\n"+
"4. Confirm it matches this expected preview (pushable activities only):\n"+rows+"\n"+
"5. On my \"go\", run the same command with --execute (workflow mode=execute).\n"+
"6. VERIFY: re-read the push report; confirm pushed count == matched students × pushable activities, no new unmatched, and spot-check 3 students' Canvas values against gradebook/grades.csv.\n\n"+
"## Reminder\nHeld activities ("+(held.join(", ")||"none")+") stay out of this push. To deliver those to students later: review gradebook/notes/, set \"publish\": true on the ready ones, and run publish.yml.\n";
 const d=el("div","drawer on"); const p=el("div","dp");
 p.innerHTML="<button class='x'>×</button><h3>Apply-grades prompt - "+esc(s.section)+"</h3><div class='muted'>Send it to the repo (run pending intents), or copy it into a Claude Code chat.</div><div style='margin:10px 0'><button class='btn' data-size='sm' id='send'>Send to repo →</button> <button class='btn' data-size='sm' data-variant='soft' id='cp'>Copy</button></div><pre class='code-block prompt' id='ptxt'>"+esc(txt)+"</pre>";
 d.append(p); document.body.append(d);
 const close=()=>d.remove(); p.querySelector(".x").onclick=close; d.onclick=e=>{if(e.target===d)close()};
 $("#cp").onclick=()=>{navigator.clipboard.writeText(txt).then(()=>{$("#cp").textContent="Copied ✓"})};
 wireSend(s,"apply-grades",null,txt);
}

// Deliver the section's DETERMINISTIC activities (auto-graded tests + quizzes) to
// student workspaces AND Canvas in one prompt. Mirrors the Finalize prompt's
// safety framing but WITHOUT aiScore gating - these scores are final, not held.
// AI/held activities are excluded on purpose (they flow through AI Review -> Finalize).
function showDeliver(s){
 const det=s.assignments.filter(a=>a.kind==="push"||a.kind==="quiz");
 const held=s.assignments.filter(a=>a.aiGraded).map(a=>a.id);
 const manual=s.assignments.filter(a=>a.manual).map(a=>a.id);
 const graded=det.map(a=>({a,n:s.students.map(st=>st.activities[a.id]).filter(Boolean).length})).filter(x=>x.n>0);
 const pub=graded.filter(x=>x.a.publish);
 const canvasRows=graded.map(x=>"  - "+x.a.id+": "+(x.a.totalPoints!=null?x.a.totalPoints+" pts":x.a.autoPoints!=null?x.a.autoPoints+" pts":x.a.quiz?"quiz (raw tests scaled to Canvas)":"raw tests scaled to Canvas")+", "+x.n+" students graded").join("\n")||"  (no deterministic activity has graded students yet)";
 const pubRows=pub.map(x=>"  - "+x.a.id+(x.a.quiz?" (quiz)":"")).join("\n")||"  (none of the deterministic activities are flagged \"publish\": true)";
 const txt=
"# Deliver reviewed grades - "+s.subject+" (section "+s.section+") - deterministic activities\n\n"+
"These are the section's DETERMINISTIC activities (auto-graded tests + quizzes). Their gradebook scores are final - no AI review needed. Deliver them to student workspaces (the \"publish\": true ones) and to Canvas. Work from: "+workFrom(s)+" - pull it first.\n\n"+
"## Push to Canvas - deterministic activities with graded students ("+graded.length+")\n"+canvasRows+"\n\n"+
"## Publish to student workspaces (only activities flagged \"publish\": true)\n"+pubRows+"\n\n"+
"## Excluded on purpose - do NOT deliver from this prompt\n"+
"- AI-graded / held (review in the AI Review tab, then use its Finalize button): "+(held.join(", ")||"(none)")+"\n"+
"- Manual (entered in Canvas by hand): "+(manual.join(", ")||"(none)")+"\n\n"+
"## Rules (do not violate)\n"+
"- gradebook/grades.csv is the source of truth. Never hand-edit a grade.\n"+
"- Dry-run BOTH the student publish and the Canvas push first; execute either only on my explicit \"go\".\n"+
"- Student FEEDBACK.md/GRADES.md and any Canvas comment carry NO \"AI\" mention.\n"+
"- Touch ONLY the deterministic activities above. The AI/held activities flow through the separate AI Review -> Finalize path; do not publish or push them here.\n\n"+
"## Steps\n"+
"1. Re-run a grade sweep only if submissions changed since "+new Date(DATA.generatedAt).toLocaleDateString()+"; otherwise use the current gradebook.\n"+
"2. Student publish - DRY RUN first: publish.yml (publish=false), or tools/publish-grades.mjs "+s.section+" (dry-run by default). publish only ever delivers \"publish\": true activities, and it skips any AI student whose aiScore is blank - so this delivers exactly the deterministic publish:true activities above (plus any already-cleared AI students, which is fine). Show me the plan; confirm it lists those activities and their graded workspaces.\n"+
"3. On my \"go\": run the student publish for real (publish=true / --execute).\n"+
"4. Canvas push in CHECK mode: tools/canvas-push.mjs --section="+s.section+" --check. Show the report: # grades, # students matched, per-activity counts, and ANY unmatched students or points-possible mismatches. Confirm it matches the Canvas preview above and that NO held or manual activity appears (canvas-push holds AI activities and skips manual automatically).\n"+
"5. On my \"go\": re-run with --execute.\n"+
"6. VERIFY: pushed count == matched students x pushed activities; spot-check 2-3 students' Canvas values and their delivered GRADES.md/FEEDBACK.md against gradebook/grades.csv; confirm no held or manual activity was delivered.\n";
 const d=el("div","drawer on"); const p=el("div","dp");
 p.innerHTML="<button class='x'>×</button><h3>Deliver to Canvas + workspaces - "+esc(s.section)+"</h3><div class='muted'>"+graded.length+" deterministic activit(y/ies) to push · "+pub.length+" to publish to workspaces · AI/held + manual excluded</div><div style='margin:10px 0'><button class='btn' data-size='sm' id='send'>Send to repo →</button> <button class='btn' data-size='sm' data-variant='soft' id='cp'>Copy prompt</button></div><pre class='code-block prompt' id='ptxt'>"+esc(txt)+"</pre>";
 d.append(p); document.body.append(d);
 const close=()=>d.remove(); p.querySelector(".x").onclick=close; d.onclick=e=>{if(e.target===d)close()};
 $("#cp").onclick=()=>navigator.clipboard.writeText(txt).then(()=>$("#cp").textContent="Copied ✓");
 wireSend(s,"deliver",null,txt);
}

function toggleTheme(){const r=document.documentElement;const cur=r.getAttribute("data-color-scheme")|| (matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light");r.setAttribute("data-color-scheme",cur==="dark"?"light":"dark");render();}
function avg(a){const v=a.filter(x=>x!=null);return v.length?v.reduce((x,y)=>x+y,0)/v.length:null}
boot();
