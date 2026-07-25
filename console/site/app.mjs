// Course Console - hosted, data-free shell. All gradebook data is fetched
// live from api.github.com with the teacher's own token (Settings). The UI half
// is the retired local dashboard's script, ported verbatim where possible; the
// data half now lives in lib/. The app READS everything and WRITES exactly one
// thing: Intent prompt files into gradebook/intents/ (executed by Claude Code
// locally - "run pending intents").
import { AuthError, rate, ghJSON as ghJSON2, ghText } from "./lib/gh.mjs";
import { loadConfig, saveConfig } from "./lib/store.mjs";
import { discoverSections, parseRepoURL } from "./lib/config.mjs";
import { shotsFor, shotsCached } from "./lib/shots.mjs";
import { codeFor, codeCached } from "./lib/code.mjs";
import { route, start, go, dispatch, beforeEach, fallback } from "./lib/router.mjs";
import { discover, sections, findSc, getSection, sectionCached, invalidate, ageOf, STALE_MS, getFlagsFiles } from "./lib/data.mjs";
import { missingWork, workspaceInfo } from "./lib/students.mjs";
import { initSearch } from "./lib/search-index.mjs";
import { OPS } from "./lib/ops-catalog.mjs";
import { listRuns, dispatch as dispatchWf, findDispatchedRun, pollRun } from "./lib/actions.mjs";
import { editAssignments } from "./lib/config-writes.mjs";
import { $, el, esc, confirmExecute } from "./lib/ui.mjs";
import { DEC, getDec, setDec, skeyOf, isDecided, finalScore, exportDecisions, importDecisions } from "./lib/decisions.mjs";
import { hl } from "./lib/hl.mjs";
import { wireSend, buildGenFeedback, buildApplyAI, buildFinalize, buildApplyGrades, buildDeliver, buildManualAttendance, buildNewActivity } from "./lib/intents.mjs";

let q="", revAct=null;
let DATA={generatedAt:new Date().toISOString()};   // prompt builders stamp "graded as of"
const main=$("#main");

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
  "<div style='display:flex;gap:8px;align-items:center;margin-top:16px;flex-wrap:wrap'><button class='btn' data-size='sm' id='sSave'>Save & load</button> <button class='btn' data-size='sm' data-variant='soft' id='sTest'>Test connection</button> <span class='mut' id='sMsg' style='font-size:12px'></span></div>"+
  "<div class='field__label' style='margin-top:16px'>Review decisions <span class='mut'>- browser-local; back them up</span></div>"+
  "<div style='display:flex;gap:8px;align-items:center;flex-wrap:wrap'><button class='btn' data-size='sm' data-variant='soft' id='sExpDec'>↓ Export</button> <button class='btn' data-size='sm' data-variant='soft' id='sImpDec'>↑ Import</button><input type='file' id='sImpFile' accept='application/json,.json' style='display:none'></div>";
 const read=()=>({repos:[...p.querySelectorAll(".repoRow")].map(row=>({url:row.querySelector(".rUrl").value.trim(),token:row.querySelector(".rTok").value.trim()})).filter(r=>r.url),labels:c.labels||{}});
 const wireDel=()=>p.querySelectorAll(".rDel").forEach(b=>b.onclick=()=>{const rows=p.querySelectorAll(".repoRow");if(rows.length>1)b.closest(".repoRow").remove();else{b.closest(".repoRow").querySelector(".rUrl").value="";b.closest(".repoRow").querySelector(".rTok").value="";}});
 wireDel();
 $("#sAdd").onclick=()=>{ $("#sRepos").insertAdjacentHTML("beforeend",rowHTML()); wireDel(); };
 $("#sExpDec").onclick=exportDecisions;
 $("#sImpDec").onclick=()=>$("#sImpFile").click();
 $("#sImpFile").onchange=e=>{const f=e.target.files[0];if(f)importDecisions(f,()=>render());e.target.value="";};
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

// ---- shell wiring + routes ----
const classHref=(key,sub)=>"#/c/"+encodeURIComponent(key)+(sub?"/"+sub:"");
function curKey(){ const m=(location.hash||"").match(/^#\/c\/([^/]+)/); return m?decodeURIComponent(m[1]):null; }

function setNav(){
 const h=location.hash||"#/";
 const key=curKey();
 document.querySelectorAll("#rail .nav-item[href^='#']").forEach(a=>{
  const href=a.getAttribute("href");
  let on;
  if(href.startsWith("#/c/")) on=!!key&&href===classHref(key);
  else if(href==="#/") on=(h==="#/"||h==="#"||h==="");
  else on=h.startsWith(href);
  if(on)a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current");
 });
}

function setTabs(key,mode,s){
 const t=$("#ctxTabs");
 if(!key){t.innerHTML="";return;}
 const items=[["","Gradebook","book"],["activities","Activities"+(s?" ("+s.stats.activities+")":""),"act"],["students","Students"+(s?" ("+s.stats.students+")":""),"stu"],["review","AI Review"+(s?" ("+s.stats.held+")":""),"ai"],["attendance","Attendance"+(s&&s.stats.sessions?" ("+s.stats.sessions+")":""),"att"]];
 t.innerHTML=items.map(([sub,l,m])=>{const on=m===mode||(m==="stu"&&String(mode).startsWith("profile:"))||(m==="ai"&&mode==="revdetail")||(m==="act"&&mode==="actnew");return "<a class='tab' href='"+classHref(key,sub)+"'"+(on?" aria-current='page' data-active='true'":"")+">"+l+"</a>";}).join("");
}

function statusLine(key){
 const bits=[];
 if(rate.remaining!=null) bits.push("<span"+(rate.remaining<500?" style='color:var(--color-danger,inherit);font-weight:var(--font-weight-semibold)'":"")+">API "+rate.remaining+"/"+rate.limit+"</span>");
 if(key){ const age=ageOf(key); if(age!=null) bits.push("<span>"+esc(key)+" · loaded "+(age<6e4?"just now":Math.round(age/6e4)+" min ago")+(age>STALE_MS?" · stale (↻ to refresh)":"")+"</span>"); }
 bits.push("<span>"+Object.keys(DEC).length+" decisions</span>");
 bits.push("<span>writes go through intents</span>");
 $("#statusBar").innerHTML=bits.join(" · ");
}

function fillRail(){
 const bySubject=new Map();
 sections().forEach(sc=>{ if(!bySubject.has(sc.subject))bySubject.set(sc.subject,[]); bySubject.get(sc.subject).push(sc); });
 $("#railClasses").innerHTML=[...bySubject.entries()].map(([subject,scs])=>
  "<div class='side-rail__grouplabel'>"+esc(subject)+"</div>"+
  "<div class='side-rail__sub'>"+scs.map(sc=>"<a class='nav-item' href='"+classHref(sc.key)+"' data-classnav='"+esc(sc.key)+"'>"+
   "<span class='nav-item__label'>"+esc(sc.section)+(sc.courseCode?" · "+esc(sc.courseCode):"")+"</span>"+
   "<span class='badge navheld' data-tone='held' hidden></span></a>").join("")+"</div>"
 ).join("");
}
function railHeld(key,held){
 const b=document.querySelector("[data-classnav='"+key.replace(/'/g,"")+"'] .navheld");
 if(b){ if(held>0){b.textContent=held;b.hidden=false;} else b.hidden=true; }
}

async function withSection(key,fn){
 const sc=findSc(key);
 if(!sc){ main.innerHTML="<div class='boot'>Unknown class "+esc(key)+". <a href='#/'>Dashboard</a></div>"; return; }
 if(!sectionCached(key)) main.innerHTML="<div class='boot'>Loading "+esc(sc.subject)+" · "+esc(sc.section)+"…</div>";
 try{
  const s=await getSection(key);
  if(curKey()!==key) return;   // navigated away while loading
  DATA.generatedAt=new Date(Date.now()-(ageOf(key)||0)).toISOString();
  railHeld(key,s.stats.held);
  fn(s);
 }catch(e){
  if(e instanceof AuthError){ main.innerHTML="<div class='boot'>"+esc(e.message)+"</div>"; openSettings(false); }
  else main.innerHTML="<div class='boot'>Load failed: "+esc(e.message)+" · <a href='"+classHref(key)+"'>retry</a></div>";
 }
}

function classView(key,mode,extra){
 withSection(key,s=>{
  setTabs(key,mode,s); statusLine(key);
  main.innerHTML="";
  const w=el("div","wrap");
  main.append(w);
  if(mode==="ai"){ if(extra&&extra.aid)revAct=extra.aid; renderAI(s,w); }
  else if(mode==="revdetail") renderReviewDetail(s,w,extra.aid,extra.skey);
  else if(mode==="att") renderAttendance(s,w);
  else if(mode==="act") renderActivities(s,w);
  else if(mode==="actnew") renderActivityNew(s,w);
  else if(mode==="stu") renderStudents(s,w);
  else if(mode&&mode.startsWith("profile:")) renderStudentProfile(s,w,mode.slice(8));
  else renderBook(s,w);
 });
}

const profileHref=(key,sk)=>classHref(key,"students")+"/"+encodeURIComponent(sk);

// ---- Students list ----
function renderStudents(s,w){
 const facets=el("div","ctl");
 facets.innerHTML='<input class="field__input search" id="q" placeholder="Filter students…" value="'+esc(q)+'">'+
  '<fieldset class="chips" data-select="multi" id="stuFacets" style="border:0;padding:0;margin:0">'+
   '<label class="chips__chip"><input type="checkbox" value="missing"><span>Missing work</span></label>'+
   '<label class="chips__chip"><input type="checkbox" value="blank"><span>Blank student.json</span></label>'+
   '<label class="chips__chip"><input type="checkbox" value="atrisk"><span>Attendance &lt;50%</span></label>'+
  '</fieldset>';
 w.append(facets);
 const holder=el("div"); w.append(holder);
 const dates=(s.attendance&&s.attendance.sessionDates)||[];
 const attOf=st=>{const a=s.attendance&&s.attendance.students[st.number];return a&&dates.length?a.count/dates.length:null};
 const paint=()=>{
  const on=[...w.querySelectorAll("#stuFacets input:checked")].map(c=>c.value);
  const rows=s.students.filter(st=>{
   if(q&&!((st.name||"").toLowerCase().includes(q)||(st.number||"").includes(q)||(st.github||"").toLowerCase().includes(q)))return false;
   if(on.includes("missing")&&!missingWork(s,st).length)return false;
   if(on.includes("blank")&&st.number)return false;
   if(on.includes("atrisk")){const r=attOf(st);if(!(r!=null&&r<0.5))return false;}
   return true;
  });
  holder.innerHTML="";
  const card=el("div","card"); card.append(el("h2",null,"Students <span class='mut' style='font-weight:400'>("+rows.length+" of "+s.students.length+")</span>"));
  const sc2=el("div","scroll"); const t=el("table","matrix");
  t.innerHTML="<tr><th class='stu'>Student</th><th>#</th><th>@github</th><th class='center'>Auto</th><th class='center'>Held</th><th class='center'>Attendance</th><th class='center'>Missing</th></tr>"+
   rows.map(st=>{
    const miss=missingWork(s,st).length; const r=attOf(st);
    return "<tr class='rowlink' data-sk='"+esc(skeyOf(st))+"'>"+
     "<td class='stu'>"+esc(st.name||"(blank)")+"</td><td class='mut'>"+esc(st.number||"-")+"</td><td class='mut'>"+esc(st.github||"-")+"</td>"+
     "<td class='center'>"+(st.tally.pushMax?st.tally.push+"/"+st.tally.pushMax:"-")+"</td>"+
     "<td class='center'>"+(st.tally.heldMax?st.tally.held+"/"+st.tally.heldMax:"-")+"</td>"+
     "<td class='center"+(r!=null&&r<0.5?" mut":"")+"'>"+(r==null?"-":Math.round(r*100)+"%")+"</td>"+
     "<td class='center'>"+(miss?"<span class='badge' data-tone='warn'>"+miss+"</span>":"·")+"</td></tr>";
   }).join("");
  sc2.append(t); card.append(sc2); holder.append(card);
  t.querySelectorAll(".rowlink").forEach(tr=>tr.onclick=()=>{ location.hash=profileHref(s.key,tr.dataset.sk); });
 };
 paint();
 $("#q").oninput=e=>{q=e.target.value.toLowerCase();paint();};
 w.querySelector("#stuFacets").onchange=paint;
}

// ---- Student profile ----
function renderStudentProfile(s,w,sk){
 const st=s.students.find(x=>skeyOf(x)===sk);
 if(!st){ w.append(el("div","card","<p class='card__body'>No such student in "+esc(s.key)+". <a href='"+classHref(s.key,"students")+"'>Back to students</a></p>")); return; }
 const dates=(s.attendance&&s.attendance.sessionDates)||[];
 const att=s.attendance&&s.attendance.students[st.number];
 const miss=missingWork(s,st);
 const head=el("div");
 head.innerHTML="<a class='mut' href='"+classHref(s.key,"students")+"'>← Students</a><h1 style='margin-top:4px'>"+esc(st.name||"(blank)")+"</h1>"+
  "<div class='muted'>#"+esc(st.number||"?")+" · @"+esc(st.github||"?")+" · "+esc(s.subject)+" · "+esc(s.section)+"</div>";
 w.append(head);
 // identity + delivery card (workspace half upgrades async)
 const idc=el("div","card"); idc.dataset.pad="sm";
 idc.innerHTML="<h2>Identity & workspace</h2><div id='wsInfo' class='mut'>Checking workspace…</div>";
 w.append(idc);
 workspaceInfo(s,st).then(ws=>{
  const box=idc.querySelector("#wsInfo"); if(!box)return;
  if(!ws){ box.textContent="No GitHub handle on file - workspace unknown."; return; }
  if(!ws.exists){ box.innerHTML="Workspace <code>"+esc(ws.repo)+"</code> not reachable (missing, or this repo's PAT lacks org-wide read)."; return; }
  const sj=ws.studentJson||{};
  const mismatch=st.number&&sj.studentNumber&&String(sj.studentNumber).trim()!==st.number;
  box.innerHTML=
   "<div><a href='"+esc(ws.url)+"' target='_blank' rel='noopener'>"+esc(ws.repo)+"</a></div>"+
   "<ul class='status-list' data-grade='smooth' style='margin-top:8px'>"+
    "<li class='status-list__item'><span class='status-list__mark'>"+(sj.studentNumber?"✓":"✗")+"</span><span class='status-list__title'>student.json "+(sj.studentNumber?"filled":"blank")+(mismatch?" <span class='badge' data-tone='bad'>number mismatch vs gradebook</span>":"")+"</span></li>"+
    "<li class='status-list__item'><span class='status-list__mark'>"+(ws.gradesDelivered?"✓":"·")+"</span><span class='status-list__title'>GRADES.md delivered</span></li>"+
    "<li class='status-list__item'><span class='status-list__mark'>"+(ws.feedbackDelivered?"✓":"·")+"</span><span class='status-list__title'>FEEDBACK.md delivered</span></li>"+
    "<li class='status-list__item'><span class='status-list__mark'>"+(ws.attendanceReceipt?"✓":"·")+"</span><span class='status-list__title'>Attendance receipt</span></li>"+
   "</ul>";
 }).catch(()=>{ const box=idc.querySelector("#wsInfo"); if(box)box.textContent="Workspace check failed."; });
 // activities
 const ac=el("div","card"); ac.append(el("h2",null,"Activities"));
 const asc=el("div","scroll"); const t=el("table","matrix");
 t.innerHTML="<tr><th>Activity</th><th>Kind</th><th class='center'>Score</th><th class='center'>Late</th><th>Repo</th></tr>"+
  s.assignments.map(a=>{
   const r=st.activities[a.id];
   if(!r) return (a.namePrefix&&!a.manual&&!a.quiz)?"<tr><td>"+esc(a.id)+"</td><td><span class='badge' data-tone='"+KTONE[a.kind]+"'>"+a.kind+"</span></td><td class='center'><span class='badge' data-tone='warn'>missing</span></td><td class='center'>·</td><td class='mut'>no submission</td></tr>":"";
   const score=r.kind==="held"?(r.proposed!=null?r.proposed+"/"+r.proposedMax+" (held)":"held"):(r.canvasPts!=null?r.canvasPts:r.raw);
   return "<tr><td>"+esc(a.id)+"</td><td><span class='badge' data-tone='"+KTONE[r.kind]+"'>"+r.kind+"</span></td>"+
    "<td class='center'>"+esc(String(score))+"</td><td class='center'>"+(r.late?"LATE":"·")+"</td>"+
    "<td class='mut'><a href='https://github.com/"+esc(s.org)+"/"+esc(r.repo)+"' target='_blank' rel='noopener'>"+esc(r.repo)+"</a></td></tr>";
  }).join("");
 asc.append(t); ac.append(asc); w.append(ac);
 // missing summary + attendance
 if(miss.length){
  const mc=el("div","card"); mc.dataset.pad="sm";
  mc.innerHTML="<h2>Missing work ("+miss.length+")</h2><ul class='status-list'>"+miss.map(a=>"<li class='status-list__item'><span class='status-list__mark'>✗</span><span class='status-list__title'>"+esc(a.id)+(a.title?" · "+esc(a.title):"")+"</span></li>").join("")+"</ul>";
  w.append(mc);
 }
 const atc=el("div","card"); atc.dataset.pad="sm";
 atc.innerHTML="<h2>Attendance</h2>"+(dates.length?
  "<p>Present <b>"+(att?att.count:0)+"</b> of "+dates.length+" sessions"+(att&&att.present.length?" · last: "+esc(att.present[att.present.length-1]):"")+"</p>":
  "<p class='mut'>No attendance data yet.</p>");
 w.append(atc);
}

function dashView(){
 setTabs(null); statusLine(null);
 main.innerHTML="";
 const w=el("div","wrap");
 w.innerHTML="<h1>My classes</h1><p class='lede' data-size='sm'>Live from GitHub. A class's gradebook loads when you open it; nothing is stored outside this browser.</p>";
 const ctl=el("div","ctl");
 ctl.innerHTML='<button class="btn" data-size="sm" data-variant="soft" id="loadAll">Load all classes</button>'+
  '<div class="meter" id="laMeter" style="flex:1;max-width:280px" hidden role="meter" aria-label="Load progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="meter__seg" data-tone="ok" style="--seg:0%"></span></div>'+
  '<span class="mut" id="laMsg"></span>';
 w.append(ctl);
 const grid=el("div","dashgrid");
 const cardFor=sc=>{
  const s=sectionCached(sc.key);
  const c=el("a","card dashcard"); c.href=classHref(sc.key); c.dataset.pad="sm"; c.dataset.dash=sc.key;
  c.innerHTML="<h2>"+esc(sc.subject)+" · "+esc(sc.section)+(sc.courseCode?" <span class='mut'>("+esc(sc.courseCode)+")</span>":"")+"</h2><div class='mut'>"+esc(sc.org)+"</div>"+
   (s?"<div class='stats stats--mini'>"+[["Students",s.stats.students],["Held",s.stats.held],["Activities",s.stats.activities]].map(([l,n])=>"<div class='stat'><span class='stat__value'>"+n+"</span><span class='stat__label'>"+l+"</span></div>").join("")+"</div>"
     :"<div class='mut'>"+sc.pol.length+" activities · open to load</div>");
  return c;
 };
 sections().forEach(sc=>grid.append(cardFor(sc)));
 w.append(grid);
 const alertsBox=el("div"); w.append(alertsBox);
 // cross-class alert inbox: built from whatever is LOADED (load all to fill it)
 const paintAlerts=()=>{
  const items=[];
  sections().forEach(sc=>{ const s=sectionCached(sc.key); if(!s)return;
   if(s.stats.held>0)items.push("<a href='"+classHref(sc.key,"review")+"'>"+s.stats.held+" held AI grade(s) to review</a> · "+esc(sc.key));
   if(s.stats.blankStudentJson>0)items.push("<a href='"+classHref(sc.key,"students")+"'>"+s.stats.blankStudentJson+" blank student.json</a> · "+esc(sc.key));
   const att=s.attendance;
   if(att&&att.sessionDates&&att.sessionDates.length){
    const n=s.students.filter(st=>{const a=att.students[st.number];const r=a?a.count/att.sessionDates.length:0;return st.number&&r<0.5}).length;
    if(n)items.push("<a href='"+classHref(sc.key,"attendance")+"'>"+n+" student(s) below 50% attendance</a> · "+esc(sc.key));
   }
  });
  alertsBox.innerHTML=items.length?"<div class='card' data-pad='sm'><h2>Needs a look (loaded classes)</h2><ul class='status-list'>"+items.map(h=>"<li class='status-list__item'><span class='status-list__mark'>⚑</span><span class='status-list__title'>"+h+"</span></li>").join("")+"</ul></div>":"";
 };
 paintAlerts();
 main.append(w);
 const la=$("#loadAll");
 const unloaded=()=>sections().filter(sc=>!sectionCached(sc.key));
 if(!unloaded().length) la.hidden=true;
 la.onclick=async()=>{
  if(rate.remaining!=null&&rate.remaining<500){ $("#laMsg").textContent="API budget low ("+rate.remaining+" calls left) - not loading everything."; return; }
  la.disabled=true;
  const meter=$("#laMeter"); meter.hidden=false;
  const list=unloaded(); let done=0;
  for(const sc of list){
   $("#laMsg").textContent="Loading "+sc.key+"…";
   try{ const s=await getSection(sc.key); railHeld(sc.key,s.stats.held); const old=grid.querySelector("[data-dash='"+sc.key.replace(/'/g,"")+"']"); if(old)old.replaceWith(cardFor(sc)); }
   catch(e){ $("#laMsg").textContent=sc.key+" failed: "+e.message; }
   done++;
   const pct=Math.round(done/list.length*100);
   meter.setAttribute("aria-valuenow",pct); meter.querySelector(".meter__seg").style.setProperty("--seg",pct+"%");
   if(rate.remaining!=null&&rate.remaining<300){ $("#laMsg").textContent="Stopped early: API budget down to "+rate.remaining+"."; break; }
  }
  if(done===list.length) $("#laMsg").textContent="All classes loaded.";
  la.hidden=true; paintAlerts(); statusLine(null);
 };
}

route("#/", dashView);
route("#/settings", ()=>{ setTabs(null); statusLine(null); main.innerHTML="<div class='wrap'><h1>Settings</h1><p class='lede' data-size='sm'>Repos, tokens, and your review-decision backups.</p></div>"; openSettings(false); });
route("#/scan", ()=>location.replace("./scanner/"));
route("#/flags", flagsView);
route("#/reports", ()=>reportsView());
route("#/reports/:key", p=>reportsView(p.key));
route("#/reports/:key/:file", p=>reportViewer(p.key,p.file));
route("#/ops", ()=>opsView(null));
route("#/ops/:key", p=>opsView(p.key));
route("#/c/:key", p=>classView(p.key,"book"));
route("#/c/:key/activities", p=>classView(p.key,"act"));
route("#/c/:key/activities/new", p=>classView(p.key,"actnew"));
route("#/c/:key/students", p=>classView(p.key,"stu"));
route("#/c/:key/students/:sk", p=>classView(p.key,"profile:"+p.sk));
route("#/c/:key/review", p=>classView(p.key,"ai"));
route("#/c/:key/review/:aid", p=>classView(p.key,"ai",{aid:p.aid}));
route("#/c/:key/review/:aid/:skey", p=>classView(p.key,"revdetail",{aid:p.aid,skey:p.skey}));
route("#/c/:key/attendance", p=>classView(p.key,"att"));
fallback(()=>go("#/"));
beforeEach(()=>{ setNav(); if(detailKey){document.removeEventListener("keydown",detailKey);detailKey=null;} });

let started=false;
async function boot(){
 const c=loadConfig();
 if(!c){ main.innerHTML="<div class='boot'><h1>Course Console</h1>Live from GitHub - nothing loads until you connect your teacher repos and their tokens.</div>"; openSettings(true); return; }
 main.innerHTML="<div class='boot'>Discovering classes…</div>";
 try{
  const {sections:scs,errors}=await discover(c);
  if(!scs.length){
   main.innerHTML="<div class='boot'>No teacher repos reachable."+(errors.length?" "+esc(errors.map(e=>e.url+": "+e.err).join(" · ")):"")+" <a href='#/settings'>Open settings</a></div>";
   return;
  }
  if(errors.length) console.warn("course-console: skipped repos",errors);
  fillRail();
  if(started) dispatch(); else { started=true; start(); }
  // first-run CRUMB tour: once per browser, only after a working setup exists
  // (never over the settings drawer). Replay anytime via the rail's Tour button.
  if(!localStorage.getItem("hau-crumb-first-run-v1")&&window.crumb){
   localStorage.setItem("hau-crumb-first-run-v1","1");
   window.crumb.start("first-run");
  }
 }catch(e){
  if(e instanceof AuthError){ main.innerHTML="<div class='boot'>"+esc(e.message)+"</div>"; openSettings(false); }
  else{ main.innerHTML="<div class='boot'>Discovery failed: "+esc(e.message)+" · <a href='#/settings'>settings</a></div>"; }
 }
}

// static-shell header controls
$("#reload").onclick=()=>{ const k=curKey(); invalidate(k); dispatch(); };
$("#theme").onclick=()=>toggleTheme();
initSearch(()=>dispatch());

function curScheme(){ return document.documentElement.getAttribute("data-color-scheme")||(matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light"); }
function cellColor(pct){ if(pct==null)return""; const g=Math.round(pct*120); const dark=curScheme()==="dark"; return "background:hsl("+g+"deg "+(dark?"30%":"55%")+" "+(dark?"24%":"90%")+")"; }
// review decisions now live in lib/decisions.mjs (same storage key + dkey shape)

// ---- Flags (cheap cross-class inbox: FLAGS.md + reports/FLAGGED.md per class) ----
async function flagsView(){
 setTabs(null); statusLine(null);
 main.innerHTML=""; const w=el("div","wrap"); main.append(w);
 w.innerHTML="<h1>Flags</h1><p class='lede' data-size='sm'>What the engine and audits want a human to look at, per class - from gradebook/FLAGS.md and reports/FLAGGED.md.</p>";
 for(const sc of sections()){
  const card=el("div","card"); card.dataset.pad="sm";
  card.innerHTML="<h2>"+esc(sc.subject)+" · "+esc(sc.section)+"</h2><div class='mut flagbody'>Loading…</div>";
  w.append(card);
  getFlagsFiles(sc.key).then(f=>{
   const box=card.querySelector(".flagbody"); if(!box)return;
   const both=[f.flags&&"## FLAGS.md\n"+f.flags, f.flagged&&"## reports/FLAGGED.md\n"+f.flagged].filter(Boolean).join("\n\n");
   if(!both){ box.innerHTML="<span class='mut'>Nothing flagged. ✓</span>"; return; }
   renderMd(both).then(html=>{ box.innerHTML=html; }).catch(()=>{ box.innerHTML="<pre class='code-block prompt'>"+esc(both)+"</pre>"; });
  }).catch(()=>{const box=card.querySelector(".flagbody"); if(box)box.textContent="Unreadable (token scope?).";});
 }
}

// ---- Reports (in-console reader: reports/ listing -> MILL-rendered viewer) ----
const reportHref=(key,path)=>"#/reports/"+encodeURIComponent(key)+"/"+encodeURIComponent(path);
function reportsView(key){
 setTabs(null); statusLine(null);
 main.innerHTML=""; const w=el("div","wrap"); main.append(w);
 w.innerHTML="<h1>Reports</h1><p class='lede' data-size='sm'>Each class's generated reports and gradebook summary, read right here (markdown renders in-console; other files open on GitHub).</p>";
 const scs=key&&findSc(key)?[findSc(key)]:sections();
 for(const sc of scs){
  const card=el("div","card"); card.dataset.pad="sm";
  card.innerHTML="<h2>"+esc(sc.subject)+" · "+esc(sc.section)+"</h2>"+
   "<ul class='content-index rlist'><li class='content-index__item'><span class='content-index__title'><a href='"+reportHref(sc.key,"gradebook/GRADEBOOK.md")+"'>GRADEBOOK.md</a></span><span class='content-index__meta'>the human-readable gradebook</span></li></ul>"+
   "<div class='mut rmore'>Loading reports/…</div>";
  w.append(card);
  ghJSON2("/repos/"+sc.org+"/"+sc.repo+"/contents/reports").then(list=>{
   const box=card.querySelector(".rmore"); if(!box)return;
   const files=(list||[]).filter(x=>x.type==="file");
   if(!files.length){ box.textContent="No reports/ files."; return; }
   box.classList.remove("mut");
   box.innerHTML="<ul class='content-index'>"+files.map(f=>{
    const md=/\.(md|markdown|txt|csv)$/i.test(f.name);
    const href=md?reportHref(sc.key,"reports/"+f.name):f.html_url;
    return "<li class='content-index__item'><span class='content-index__title'><a href='"+esc(href)+"'"+(md?"":" target='_blank' rel='noopener'")+">"+esc(f.name)+"</a></span><span class='content-index__meta'>"+(f.size!=null?Math.max(1,Math.round(f.size/1024))+" KB":"")+(md?"":" · on GitHub")+"</span></li>";
   }).join("")+"</ul>";
  }).catch(()=>{ const box=card.querySelector(".rmore"); if(box)box.textContent="reports/ not readable (token scope?)."; });
 }
}
function reportViewer(key,path){
 setTabs(null); statusLine(null);
 main.innerHTML=""; const w=el("div","wrap"); main.append(w);
 const sc=findSc(key);
 if(!sc){ w.innerHTML="<div class='boot'>Unknown class "+esc(key)+". <a href='#/reports'>Reports</a></div>"; return; }
 if(!/^(reports|gradebook)\/[\w][\w./ -]*$/.test(path)||path.includes("..")){ w.innerHTML="<div class='boot'>Not a report path. <a href='#/reports'>Reports</a></div>"; return; }
 w.innerHTML="<a class='mut' href='#/reports'>← Reports</a><h1 style='margin-top:4px'>"+esc(path.split("/").pop())+"</h1>"+
  "<div class='muted'>"+esc(sc.subject)+" · "+esc(sc.section)+" · <a href='https://github.com/"+esc(sc.org)+"/"+esc(sc.repo)+"/blob/main/"+esc(path)+"' target='_blank' rel='noopener'>open on GitHub</a></div>"+
  "<div class='card' data-pad='sm'><div class='rbody mut'>Loading…</div></div>";
 ghText("/repos/"+sc.org+"/"+sc.repo+"/contents/"+path.split("/").map(encodeURIComponent).join("/")).then(md=>{
  const box=w.querySelector(".rbody"); if(!box)return;
  if(md==null){ box.textContent="Not readable (missing file or token scope)."; return; }
  box.classList.remove("mut");
  if(/\.(md|markdown)$/i.test(path)) renderMd(md).then(html=>{ box.innerHTML=html; }).catch(()=>{ box.innerHTML="<pre class='code-block prompt'>"+esc(md)+"</pre>"; });
  else box.innerHTML="<pre class='code-block prompt'>"+esc(md)+"</pre>";
 }).catch(e=>{ const box=w.querySelector(".rbody"); if(box)box.textContent="Load failed: "+e.message; });
}

// Markdown -> GRAIN classes via the vendored MILL renderer (lazy ESM import;
// falls back to a <pre> when the bundle is unavailable).
let millMod=null;
async function renderMd(md){
 if(!millMod) millMod=await import("./vendor/mill.js");
 return millMod.renderGrainDocument(md).html;
}

// ---- docked op feed (grain console organism) ----
function opFeed(line, link){
 const box=$("#opConsole"); box.hidden=false;
 if(!box.firstChild){ box.innerHTML="<div class='console__box'><div class='console__bar'><span class='mut mono'>ops</span><span style='flex:1'></span><button class='btn' data-size='sm' data-variant='soft' id='opHide'>×</button></div><div class='console__feed' id='opLines'></div></div>"; $("#opHide").onclick=()=>{box.hidden=true;}; }
 const l=el("div","opline"); l.innerHTML="<span class='mut mono'>"+new Date().toLocaleTimeString()+"</span> "+line+(link?" <a href='"+esc(link)+"' target='_blank' rel='noopener'>run →</a>":"");
 $("#opLines").append(l); $("#opLines").scrollTop=1e9;
 return l;
}

// Returns the run's conclusion ("success"/"failure"/…), "dispatched" when the
// run could not be found, "cancelled" on a declined confirm, or "error".
// Wizards chain on it: never start step N+1 unless step N came back "success".
async function runOp(sc,op,inputs,executing,preConfirmed){
 if(executing&&!preConfirmed){ const okc=await confirmExecute(op.execDanger||("write for real on "+sc.key),sc.section); if(!okc)return "cancelled"; }
 const line=opFeed((executing?"EXECUTE ":"dry-run ")+esc(op.label)+" on "+esc(sc.key)+" · dispatching…");
 try{
  const {dispatchedAt}=await dispatchWf(sc.org,sc.repo,op.file,inputs);
  const run=await findDispatchedRun(sc.org,sc.repo,op.file,dispatchedAt);
  if(!run){ line.innerHTML+=" dispatched ✓ (find it in the repo's Actions tab)"; return "dispatched"; }
  line.innerHTML="<span class='mut mono'>"+new Date().toLocaleTimeString()+"</span> "+(executing?"EXECUTE ":"dry-run ")+esc(op.label)+" on "+esc(sc.key)+" · <span class='opstat'>queued</span> <a href='"+esc(run.html_url)+"' target='_blank' rel='noopener'>run →</a>";
  const stat=line.querySelector(".opstat");
  const done=await pollRun(sc.org,sc.repo,run.id,r=>{ stat.textContent=r.status==="completed"?(r.conclusion||"done"):r.status; });
  if(done) stat.innerHTML="<span class='badge' data-tone='"+(done.conclusion==="success"?"good":"bad")+"'>"+esc(done.conclusion||"done")+"</span>";
  return done?(done.conclusion||"done"):"dispatched";
 }catch(e){ line.innerHTML+=" <span class='badge' data-tone='bad'>failed</span> "+esc(e.message); return "error"; }
}

// Is this input-set an execute (real write)? Uses the catalog gate metadata.
function isExecuting(op,inputs){
 if(op.inputs&&op.inputs.some(i=>i.gateAlways)) return true;
 for(const i of (op.inputs||[])){
  if(i.gate===true){ const v=inputs[i.name]; if(i.invert?v==="false":v==="true") return true; }
  else if(typeof i.gate==="string"&&inputs[i.name]===i.gate) return true;
 }
 return false;
}
function dangerOf(op){ const g=(op.inputs||[]).find(i=>i.gate||i.gateAlways); return (g&&g.danger)||"write for real"; }

function opCard(sc,op){
 const c=el("div","card opcard"); c.dataset.pad="sm";
 c.innerHTML="<div class='ophead'><b>"+esc(op.label)+"</b> <span class='mut mono'>"+esc(op.file)+"</span> <span class='oprun mut'>checking…</span></div><p class='mut opdesc'>"+esc(op.desc)+(op.note?" <em>"+esc(op.note)+"</em>":"")+"</p>";
 listRuns(sc.org,sc.repo,op.file,1).then(runs=>{
  const slot=c.querySelector(".oprun"); if(!slot)return;
  if(runs===null){ slot.textContent="no runs (or PAT lacks Actions scope)"; return; }
  const r=runs[0]; if(!r){ slot.textContent="never run"; return; }
  slot.innerHTML="<a href='"+esc(r.html_url)+"' target='_blank' rel='noopener'><span class='badge' data-tone='"+(r.status!=="completed"?"held":r.conclusion==="success"?"good":"bad")+"'>"+esc(r.status!=="completed"?r.status:(r.conclusion||"done"))+"</span></a> <span class='mut'>"+new Date(r.created_at).toLocaleString()+"</span>";
 }).catch(()=>{});
 if(op.dispatch===false) return c;
 const form=el("div","opform");
 const idOf=n=>"op_"+op.file.replace(/\W/g,"_")+"_"+n;
 (op.inputs||[]).forEach(inp=>{
  const id=idOf(inp.name);
  let ctl;
  if(inp.type==="bool") ctl="<label class='chips__chip'><input type='checkbox' id='"+id+"'"+(inp.def==="true"?" checked":"")+"><span>"+esc(inp.name)+"</span></label>";
  else if(inp.type==="choice") ctl="<label class='field opf'><span class='field__label'>"+esc(inp.name)+"</span><select class='field__select' id='"+id+"'>"+inp.options.map(o=>"<option"+(o===inp.def?" selected":"")+">"+esc(o)+"</option>").join("")+"</select></label>";
  else if(inp.type==="text") ctl="<label class='field opf' style='width:100%'><span class='field__label'>"+esc(inp.name)+"</span><textarea class='field__input fta' rows='3' id='"+id+"'></textarea></label>";
  else if(inp.activity&&sc.pol) ctl="<label class='field opf'><span class='field__label'>only <span class='mut'>(blank = all)</span></span><select class='field__select' id='"+id+"'><option value=''></option>"+sc.pol.map(a=>"<option>"+esc(a.id)+"</option>").join("")+"</select></label>";
  else ctl="<label class='field opf'><span class='field__label'>"+esc(inp.name)+(inp.hint?" <span class='mut'>"+esc(inp.hint)+"</span>":"")+"</span><input class='field__input' id='"+id+"' value='"+esc(inp.def||"")+"'></label>";
  form.insertAdjacentHTML("beforeend",ctl);
 });
 const runBtn=el("button","btn","Run"); runBtn.dataset.size="sm";
 runBtn.onclick=()=>{
  const inputs={}; let abort=false;
  (op.inputs||[]).forEach(inp=>{
   if(abort) return;
   const n=c.querySelector("#"+idOf(inp.name));
   const v=inp.type==="bool"?(n.checked?"true":"false"):String(n.value||"").trim();
   if(inp.required&&!v){ n.focus(); abort=true; return; }
   if(v!==""||inp.type==="bool") inputs[inp.name]=v;
  });
  if(abort) return;
  runOp(sc,{...op,execDanger:dangerOf(op)+" on "+sc.key},inputs,isExecuting(op,inputs));
 };
 form.append(runBtn);
 c.append(form);
 return c;
}

function opsView(key){
 setTabs(null); statusLine(null);
 main.innerHTML=""; const w=el("div","wrap"); main.append(w);
 const scs=sections();
 if(!scs.length){ w.innerHTML="<div class='boot'>No classes discovered yet.</div>"; return; }
 const k=key&&findSc(key)?key:scs[0].key;
 const sc=findSc(k);
 w.innerHTML="<h1>Ops</h1><p class='lede' data-size='sm'>Run the engine for a class. Everything defaults to a dry run; a real write needs the class code typed back. A red audit run means the audit FOUND something.</p>";
 const picker=el("nav","tab-bar");
 scs.forEach(x=>{const a=el("a","tab",esc(x.subject)+" · "+esc(x.section));a.href="#/ops/"+encodeURIComponent(x.key);if(x.key===k)a.dataset.active="true";picker.append(a)});
 w.append(picker);
 [...new Set(OPS.map(o=>o.group))].forEach(g=>{
  w.append(el("h2","opgroup",esc(g)));
  OPS.filter(o=>o.group===g).forEach(op=>w.append(op.file==="publish-material.yml"?materialCard(sc,op):opCard(sc,op)));
 });
}

// Publish-material gets a real unit picker: the repo's content/ folders as a
// multiselect. Selected units dispatch SEQUENTIALLY (each run polled to green
// before the next starts) - the safe habit, now enforced by the UI.
function materialCard(sc,op){
 const c=el("div","card opcard"); c.dataset.pad="sm";
 c.innerHTML="<div class='ophead'><b>"+esc(op.label)+"</b> <span class='mut mono'>"+esc(op.file)+"</span> <span class='oprun mut'>checking…</span></div>"+
  "<p class='mut opdesc'>"+esc(op.desc)+" <em>"+esc(op.note||"")+"</em></p>"+
  "<div class='mut unitpick'>Loading content/ units…</div>"+
  "<div class='opform' style='margin-top:8px'><button class='btn' data-size='sm' id='pmAll' data-variant='soft'>Select all</button><button class='btn' data-size='sm' id='pmGo'>Publish selected</button><span class='mut' id='pmMsg'></span></div>";
 listRuns(sc.org,sc.repo,op.file,1).then(runs=>{
  const slot=c.querySelector(".oprun"); if(!slot)return;
  const r=runs&&runs[0]; if(!runs){slot.textContent="no runs (or PAT lacks Actions scope)";return;}
  if(!r){slot.textContent="never run";return;}
  slot.innerHTML="<a href='"+esc(r.html_url)+"' target='_blank' rel='noopener'><span class='badge' data-tone='"+(r.status!=="completed"?"held":r.conclusion==="success"?"good":"bad")+"'>"+esc(r.status!=="completed"?r.status:(r.conclusion||"done"))+"</span></a>";
 }).catch(()=>{});
 ghJSON2("/repos/"+sc.org+"/"+sc.repo+"/contents/content").then(list=>{
  const box=c.querySelector(".unitpick"); if(!box)return;
  const units=(list||[]).filter(x=>x.type==="dir").map(x=>x.name);
  if(!units.length){ box.textContent="No content/ units found."; return; }
  box.innerHTML="<fieldset class='chips' data-select='multi' style='border:0;padding:0;margin:0'>"+units.map(u=>"<label class='chips__chip'><input type='checkbox' value='"+esc(u)+"'><span>"+esc(u)+"</span></label>").join("")+"</fieldset>";
 }).catch(()=>{ const box=c.querySelector(".unitpick"); if(box)box.textContent="content/ not readable."; });
 c.querySelector("#pmAll").onclick=()=>c.querySelectorAll(".unitpick input").forEach(i=>{i.checked=true;});
 c.querySelector("#pmGo").onclick=async()=>{
  const picked=[...c.querySelectorAll(".unitpick input:checked")].map(i=>i.value);
  const msg=c.querySelector("#pmMsg");
  if(!picked.length){ msg.textContent="Pick at least one unit."; return; }
  const ok=await confirmExecute("push "+picked.length+" unit(s) ("+picked.join(", ")+") to every "+sc.key+" workspace, sequentially",sc.section);
  if(!ok)return;
  for(let i=0;i<picked.length;i++){
   msg.textContent="Unit "+(i+1)+"/"+picked.length+": "+picked[i]+"…";
   const c=await runOp(sc,{...op,execDanger:""},{unit:picked[i]},true,true);
   if(c!=="success"){ msg.textContent="Stopped at "+picked[i]+" ("+c+") - fix it, then re-run the remaining units."; return; }
  }
  msg.textContent="Done: "+picked.length+" unit(s) published sequentially.";
 };
 return c;
}

// ---- Activities management ----
function renderActivities(s,w){
 const sc=findSc(s.key)||s;
 const top=el("div","ctl");
 top.innerHTML="<span class='mut'>Toggles commit a one-line change to grader/assignments.json (diff shown first). Content and Canvas run the repo's own dry-run-gated workflows.</span><span style='flex:1'></span><a class='btn' data-size='sm' href='"+classHref(s.key,"activities/new")+"'>+ New activity</a>";
 w.append(top);
 const card=el("div","card"); card.append(el("h2",null,"Activities"));
 const scr=el("div","scroll"); const t=el("table","matrix");
 t.innerHTML="<tr><th>Activity</th><th>Kind</th><th class='center'>Points</th><th class='center'>Graded</th><th class='center'>Locked</th><th class='center'>Published to students</th><th></th></tr>"+
  s.assignments.map(a=>{
   const graded=s.students.filter(st=>st.activities[a.id]).length;
   return "<tr data-aid='"+esc(a.id)+"'>"+
    "<td><b>"+esc(a.id)+"</b>"+(a.title?" <span class='mut'>"+esc(a.title)+"</span>":"")+"</td>"+
    "<td><span class='badge' data-tone='"+KTONE[a.kind]+"'>"+a.kind+"</span></td>"+
    "<td class='center'>"+(a.totalPoints??a.autoPoints??"-")+"</td>"+
    "<td class='center'>"+graded+"</td>"+
    "<td class='center'><button class='btn tglLock' data-size='sm' data-variant='soft'>"+(a.locked?"🔒 locked":"open")+"</button></td>"+
    "<td class='center'><button class='btn tglPub' data-size='sm' data-variant='soft'>"+(a.publish?"publishing":"held back")+"</button></td>"+
    "<td><button class='btn actSweep' data-size='sm' data-variant='soft' title='Grade sweep, dry-run, just this activity'>sweep</button> <button class='btn actActivate' data-size='sm' data-variant='soft' title='Author the Canvas shell (canvas-sync execute), then publish its content unit - each step polled green'>activate</button></td></tr>";
  }).join("");
 scr.append(t); card.append(scr); w.append(card);
 t.querySelectorAll("tr[data-aid]").forEach(tr=>{
  const aid=tr.dataset.aid;
  tr.querySelector(".tglLock").onclick=async()=>{
   const a=s.assignments.find(x=>x.id===aid);
   const ok=await editAssignments(sc,es=>{const e=es.find(x=>x.id===aid);if(!e)return null;e.locked=!a.locked;return (a.locked?"Unlock ":"Lock ")+aid;},(a.locked?"Unlock ":"Lock ")+aid+" - "+s.key).catch(err=>{alert(err.message);return false;});
   if(ok){ invalidate(s.key); dispatch(); }
  };
  tr.querySelector(".tglPub").onclick=async()=>{
   const a=s.assignments.find(x=>x.id===aid);
   const warn=a.aiGraded&&!a.publish?" (AI-graded: finalize its reviews first)":"";
   const ok=await editAssignments(sc,es=>{const e=es.find(x=>x.id===aid);if(!e)return null;e.publish=!a.publish;return (a.publish?"Hold back ":"Publish ")+aid+warn;},(a.publish?"Hold back ":"Publish ")+aid+" - "+s.key).catch(err=>{alert(err.message);return false;});
   if(ok){ invalidate(s.key); dispatch(); }
  };
  tr.querySelector(".actSweep").onclick=()=>{
   const op=OPS.find(o=>o.file==="grade.yml");
   runOp(sc,{...op,execDanger:"write the gradebook"},{dry_run:"true",only:aid,force:"false"},false);
  };
  tr.querySelector(".actActivate").onclick=()=>activateActivity(s,sc,s.assignments.find(x=>x.id===aid));
 });
 const ops2=el("div","card"); ops2.dataset.pad="sm";
 ops2.innerHTML="<h2>Content & Canvas</h2><div class='opform'>"+
  "<label class='field opf'><span class='field__label'>content unit <span class='mut'>(folder under content/)</span></span><input class='field__input' id='pmUnit' placeholder='m4-backend'></label>"+
  "<button class='btn' data-size='sm' id='pmRun'>Publish material</button>"+
  "<span style='flex:1'></span>"+
  "<button class='btn' data-size='sm' data-variant='soft' id='csDry'>Canvas sync (dry-run)</button>"+
  "<button class='btn' data-size='sm' data-variant='soft' id='cpDry'>Canvas push (dry-run)</button></div>"+
  "<p class='mut' style='margin:6px 0 0'>Execute variants live in <a href='#/ops/"+encodeURIComponent(s.key)+"'>Ops</a>, behind the typed confirm.</p>";
 w.append(ops2);
 $("#pmRun").onclick=()=>{const u=$("#pmUnit").value.trim();if(!u)return $("#pmUnit").focus();const op=OPS.find(o=>o.file==="publish-material.yml");runOp(sc,{...op,execDanger:"push unit "+u+" to every workspace"},{unit:u},true);};
 $("#csDry").onclick=()=>{const op=OPS.find(o=>o.file==="canvas-sync-assignments.yml");runOp(sc,op,{mode:"dry-run",desc:"false",submit:"false",rename:"false"},false);};
 $("#cpDry").onclick=()=>{const op=OPS.find(o=>o.file==="canvas-push.yml");runOp(sc,op,{mode:"dry-run",comment:"false"},false);};
}

// ---- Activate wizard: canvas-sync (execute, only=<id>) -> poll green ->
// publish-material for the activity's content unit -> poll green. Every step
// streams to the docked console feed; a non-green step stops the chain.
async function activateActivity(s,sc,a){
 if(!a)return;
 const steps="author its Canvas assignment shell (canvas-sync execute, only="+a.id+")"+(a.content?", then publish content unit "+a.content+" to every workspace":"");
 const ok=await confirmExecute("activate "+a.id+" on "+s.key+": "+steps,s.section);
 if(!ok)return;
 const cs=OPS.find(o=>o.file==="canvas-sync-assignments.yml");
 const c1=await runOp(sc,{...cs,execDanger:""},{mode:"execute",only:a.id,desc:"false",submit:"false",rename:"false"},true,true);
 if(c1!=="success"){ opFeed("Activate "+esc(a.id)+" STOPPED: canvas-sync came back "+esc(String(c1))+"."); return; }
 if(a.content){
  const pm=OPS.find(o=>o.file==="publish-material.yml");
  const c2=await runOp(sc,{...pm,execDanger:""},{unit:a.content},true,true);
  if(c2!=="success"){ opFeed("Activate "+esc(a.id)+" STOPPED: publish-material("+esc(a.content)+") came back "+esc(String(c2))+"."); return; }
 } else opFeed("No content unit on "+esc(a.id)+" (assignments.json \"content\") - skipped publish-material.");
 opFeed("Activate "+esc(a.id)+" done ✓ - set the due date and PUBLISH it in Canvas (the sync always leaves it unpublished).");
}

// ---- New-activity wizard (#/c/:key/activities/new): entry via diff-commit,
// scaffolds via a new-activity intent, then an optional canvas-sync dry-run.
function renderActivityNew(s,w){
 const sc=findSc(s.key)||s;
 const back=classHref(s.key,"activities");
 const head=el("div");
 head.innerHTML="<a class='mut' href='"+back+"'>← Activities</a><h1 style='margin-top:4px'>New activity - "+esc(s.section)+"</h1>"+
  "<p class='lede' data-size='sm'>Three steps: commit the assignments.json entry (diff shown first), file the scaffold intent for Claude Code, then dry-run the Canvas sync. Nothing publishes to students from here.</p>";
 w.append(head);
 const card=el("div","card"); card.dataset.pad="sm";
 card.innerHTML=
  "<h2>1 · The entry</h2>"+
  "<fieldset class='chips' id='naFam' style='border:0;padding:0;margin:0 0 10px'>"+
   "<label class='chips__chip'><input type='radio' name='fam' value='tests' checked><span>Auto-graded tests</span></label>"+
   "<label class='chips__chip'><input type='radio' name='fam' value='ai'><span>AI-graded (held for review)</span></label>"+
   "<label class='chips__chip'><input type='radio' name='fam' value='manual'><span>Manual / badge (link in Canvas)</span></label>"+
  "</fieldset>"+
  "<div class='opform'>"+
   "<label class='field opf'><span class='field__label'>id <span class='mut'>(e.g. m6a4)</span></span><input class='field__input mono' id='naId' autocomplete='off'></label>"+
   "<label class='field opf'><span class='field__label'>title <span class='mut'>(Canvas name = ID: title)</span></span><input class='field__input' id='naTitle'></label>"+
   "<label class='field opf'><span class='field__label'>points <span class='mut'>(blank = raw tests)</span></span><input class='field__input num' id='naPts' type='number' min='0'></label>"+
   "<label class='field opf' data-fam='tests ai'><span class='field__label'>type</span><select class='field__select' id='naType'><option>vitest</option><option>dart</option><option>flutter</option></select></label>"+
   "<label class='field opf' data-fam='tests ai'><span class='field__label'>namePrefix</span><input class='field__input mono' id='naPrefix' placeholder='(id)-'></label>"+
   "<label class='field opf' data-fam='ai'><span class='field__label'>feedback</span><select class='field__select' id='naFb'><option>project</option><option>code</option></select></label>"+
   "<label class='chips__chip' data-fam='ai'><input type='checkbox' id='naPrev'><span>previews: branch</span></label>"+
   "<label class='field opf' data-fam='manual'><span class='field__label'>submit</span><select class='field__select' id='naSubmit'><option>url</option><option>canvas</option></select></label>"+
   "<label class='field opf' data-fam='manual tests ai'><span class='field__label'>content unit <span class='mut'>(folder under content/, optional)</span></span><input class='field__input mono' id='naContent' list='naUnits'><datalist id='naUnits'></datalist></label>"+
   "<label class='chips__chip'><input type='checkbox' id='naLocked' checked><span>locked (scores freeze once graded)</span></label>"+
  "</div>"+
  "<p class='mut' style='margin:8px 0'>\"publish\" starts false - delivery stays behind review/finalize.</p>"+
  "<div style='display:flex;gap:8px;align-items:center'><button class='btn' data-size='sm' id='naCommit'>Review diff & commit entry</button><span class='mut' id='naMsg'></span></div>"+
  "<div id='naNext'></div>";
 w.append(card);
 ghJSON2("/repos/"+sc.org+"/"+sc.repo+"/contents/content").then(list=>{
  const dl=card.querySelector("#naUnits"); if(!dl)return;
  dl.innerHTML=(list||[]).filter(x=>x.type==="dir").map(x=>"<option value='"+esc(x.name)+"'>").join("");
 }).catch(()=>{});
 const fam=()=>card.querySelector("#naFam input:checked").value;
 const showFam=()=>{ const f=fam(); card.querySelectorAll("[data-fam]").forEach(n=>{ n.style.display=n.dataset.fam.split(" ").includes(f)?"":"none"; }); };
 card.querySelector("#naFam").onchange=showFam; showFam();
 const entryFromForm=()=>{
  const f=fam(), id=card.querySelector("#naId").value.trim().toLowerCase();
  if(!/^[a-z][a-z0-9]*$/.test(id)) return {err:"id must be a short lowercase token like m6a4"};
  if(s.assignments.find(x=>x.id===id)) return {err:"id "+id+" already exists in this section"};
  const pts=card.querySelector("#naPts").value.trim();
  if((f==="ai"||f==="manual")&&!pts) return {err:(f==="ai"?"AI-graded":"manual")+" activities need points"};
  const e={id, type:f==="manual"?"manual":card.querySelector("#naType").value};
  if(f!=="manual") e.namePrefix=card.querySelector("#naPrefix").value.trim()||id+"-";
  const title=card.querySelector("#naTitle").value.trim(); if(title)e.title=title;
  if(pts)e.totalPoints=+pts;
  if(f==="ai"){ e["ai-grading"]=true; e.feedback=card.querySelector("#naFb").value; if(card.querySelector("#naPrev").checked)e.previews="branch"; }
  if(f==="manual"){ e.manual=true; e.submit=card.querySelector("#naSubmit").value; }
  const content=card.querySelector("#naContent").value.trim(); if(content)e.content=content;
  if(card.querySelector("#naLocked").checked)e.locked=true;
  return {e};
 };
 card.querySelector("#naCommit").onclick=async()=>{
  const {e,err}=entryFromForm(); const msg=card.querySelector("#naMsg");
  if(err){ msg.textContent=err; return; }
  const ok=await editAssignments(sc,es=>{ if(es.find(x=>x.id===e.id))return null; es.push(e); return "Add activity "+e.id; },"Add "+e.id+" - "+s.key).catch(x=>{msg.textContent=x.message;return false;});
  if(!ok){ if(!msg.textContent)msg.textContent="Not committed."; return; }
  invalidate(s.key);
  msg.textContent="Committed ✓";
  const nxt=card.querySelector("#naNext");
  const txt=buildNewActivity(s,e);
  nxt.innerHTML="<h2 style='margin-top:16px'>2 · Scaffolds (intent for Claude Code)</h2>"+
   "<div style='margin:10px 0'><button class='btn' data-size='sm' id='send'>Send to repo →</button> <button class='btn' data-size='sm' data-variant='soft' id='naCp'>Copy</button></div>"+
   "<pre class='code-block prompt'>"+esc(txt)+"</pre>"+
   "<h2>3 · Canvas shell</h2><p class='mut'>Author the Canvas assignment from the new entry (dry-run; execute lives behind Activate / Ops).</p>"+
   "<button class='btn' data-size='sm' data-variant='soft' id='naCs'>Canvas sync dry-run (only="+esc(e.id)+")</button>";
  nxt.querySelector("#naCp").onclick=()=>navigator.clipboard.writeText(txt).then(()=>{nxt.querySelector("#naCp").textContent="Copied ✓"});
  wireSend(s,"new-activity",e.id,txt);
  nxt.querySelector("#naCs").onclick=()=>{const op=OPS.find(o=>o.file==="canvas-sync-assignments.yml");runOp(sc,op,{mode:"dry-run",only:e.id,desc:"false",submit:"false",rename:"false"},false);};
 };
}


// Legacy shim: views call render() after a decision write or theme flip; it
// re-dispatches the current route (cached section -> instant repaint).
function render(){ if(started) dispatch(); }

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
 const risk=atRiskCard(s); if(risk)w.append(risk);
 w.append(runsCard(s));
 $("#q").oninput=e=>{q=e.target.value.toLowerCase();renderMatrixOnly(s)};
 $("#prompt").onclick=()=>showPrompt(s);
 $("#deliver").onclick=()=>showDeliver(s);
}

// At-risk strip on the class overview: low attendance and/or piling-up missing
// work, linking straight into the student profile.
function atRiskCard(s){
 const att=s.attendance, dates=(att&&att.sessionDates)||[];
 const rows=s.students.map(st=>{
  const miss=missingWork(s,st).length;
  const a=att&&att.students[st.number];
  const r=(a&&dates.length)?a.count/dates.length:null;
  const why=[];
  if(miss>=2)why.push(miss+" missing activities");
  if(r!=null&&r<0.5)why.push(Math.round(r*100)+"% attendance");
  return why.length?{st,why}:null;
 }).filter(Boolean);
 if(!rows.length)return null;
 const shown=rows.slice(0,8);
 const c=el("div","card"); c.dataset.pad="sm";
 c.innerHTML="<h2>At risk ("+rows.length+")</h2><ul class='status-list'>"+shown.map(x=>"<li class='status-list__item'><span class='status-list__mark'>⚑</span><span class='status-list__title'><a href='"+profileHref(s.key,skeyOf(x.st))+"'>"+esc(x.st.name||"(blank)")+"</a> · "+x.why.join(" · ")+"</span></li>").join("")+(rows.length>shown.length?"<li class='status-list__item'><span class='status-list__mark'>·</span><span class='status-list__title mut'>+"+(rows.length-shown.length)+" more - see <a href='"+classHref(s.key,"students")+"'>Students</a></span></li>":"")+"</ul>";
 return c;
}

// Recent engine runs (grain timeline): the last few runs of the workflows that
// matter day to day, newest first. Needs the PAT's Actions read scope.
function runsCard(s){
 const sc=findSc(s.key)||s;
 const card=el("div","card"); card.dataset.pad="sm";
 card.innerHTML="<h2>Recent engine runs</h2><div class='mut runsbox'>Loading runs…</div>";
 const FILES=[["grade.yml","Grade sweep"],["publish.yml","Publish grades"],["canvas-push.yml","Canvas push"],["publish-material.yml","Publish material"],["verify-attendance.yml","Verify attendance"]];
 Promise.all(FILES.map(([f,l])=>listRuns(sc.org,sc.repo,f,3).then(rs=>(rs||[]).map(r=>({r,label:l}))).catch(()=>[])))
 .then(all=>{
  const box=card.querySelector(".runsbox"); if(!box)return;
  const runs=all.flat().sort((a,b)=>new Date(b.r.created_at)-new Date(a.r.created_at)).slice(0,8);
  if(!runs.length){ box.textContent="No runs visible (never run, or this repo's PAT lacks Actions: Read)."; return; }
  box.classList.remove("mut");
  box.innerHTML="<div class='timeline'><div class='timeline__feed'>"+runs.map(({r,label})=>{
   const tone=r.status!=="completed"?"held":r.conclusion==="success"?"good":"bad";
   return "<div class='timeline__entry'><span class='timeline__mark'></span><div class='timeline__head'><span class='timeline__who'>"+esc(label)+"</span> <span class='badge' data-tone='"+tone+"'>"+esc(r.status!=="completed"?r.status:(r.conclusion||"done"))+"</span> <a href='"+esc(r.html_url)+"' target='_blank' rel='noopener'>run →</a></div><div class='timeline__hint'>"+new Date(r.created_at).toLocaleString()+"</div></div>";
  }).join("")+"</div></div>";
 });
 return card;
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
 ctl.innerHTML='<input class="field__input search" id="q" placeholder="Filter students…" value="'+esc(q)+'"><button class="btn" data-size="sm" id="manualAtt">Manual attendance → prompt</button>';
 w.append(ctl);
 w.append(attMatrix(s,dates));
 $("#q").oninput=e=>{q=e.target.value.toLowerCase();const old=$("#attmatrix");if(old)old.replaceWith(attMatrix(s,dates));};
 $("#manualAtt").onclick=()=>showManualAttendance(s);
}

// Manual attendance intent: like the grading prompts, the console writes
// nothing itself - it emits an intent Claude Code executes in the teacher repo.
// Manual rows carry the literal signature "manual" (teacher-attested):
// verify-attendance counts them as present (MANUAL), never FLAGGED.
function showManualAttendance(s){
 const today=new Date().toISOString().slice(0,10);
 const d=el("div","drawer on"); const p=el("div","dp");
 const stuRow=st=>'<label class="status-list__item" style="cursor:pointer"><input type="checkbox" class="mAttStu" value="'+esc(st.number)+'" data-name="'+esc(st.name||"")+'"> <span class="status-list__title">'+esc(st.name||"(blank)")+' <span class="badge" data-status="archived">'+esc(st.number||"-")+'</span></span></label>';
 const students=s.students.filter(st=>st.number);
 p.innerHTML="<button class='x'>×</button><h3>Manual attendance - "+esc(s.section)+"</h3>"+
  "<div class='muted'>Pick the students and the date; the generated intent tells the AI to record them as present with the teacher-attested \"manual\" signature. Verify + receipts run automatically on push.</div>"+
  "<div class='field' style='margin-top:10px'><span class='field__label'>Date</span><input class='field__input' id='mAttDate' type='date' value='"+today+"'></div>"+
  "<div class='field'><span class='field__label'>Filter</span><input class='field__input' id='mAttQ' placeholder='Filter students…'></div>"+
  "<ul class='status-list' id='mAttList' style='max-height:40vh;overflow:auto'>"+students.map(stuRow).join("")+"</ul>"+
  "<div style='margin:10px 0'><button class='btn' data-size='sm' id='mAttGen'>Generate prompt</button></div><div id='mAttOut'></div>";
 d.append(p); document.body.append(d);
 const close=()=>d.remove(); p.querySelector(".x").onclick=close; d.onclick=e=>{if(e.target===d)close()};
 $("#mAttQ").oninput=e=>{const f=e.target.value.toLowerCase();p.querySelectorAll("#mAttList .status-list__item").forEach(li=>{li.style.display=li.textContent.toLowerCase().includes(f)?"":"none";});};
 $("#mAttGen").onclick=()=>{
  const picked=[...p.querySelectorAll(".mAttStu:checked")].map(c=>({num:c.value,name:c.dataset.name}));
  const date=$("#mAttDate").value;
  if(!picked.length||!date){$("#mAttOut").innerHTML="<p class='mut'>Pick at least one student and a date.</p>";return;}
  const txt=buildManualAttendance(s,picked,date);
  $("#mAttOut").innerHTML="<div style='margin:10px 0'><button class='btn' data-size='sm' id='send'>Send to repo →</button> <button class='btn' data-size='sm' data-variant='soft' id='mAttCp'>Copy</button></div><pre class='code-block prompt'>"+esc(txt)+"</pre>";
  $("#mAttCp").onclick=()=>{navigator.clipboard.writeText(txt).then(()=>{$("#mAttCp").textContent="Copied ✓"})};
  wireSend(s,"manual-attendance",null,txt);
 };
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
// decision-state -> product badge tone (hue is the documented monochrome exception)
const TONE={todo:"muted",ok:"good",ov:"held",fl:"warn"};
// activity kind -> product badge tone
const KTONE={push:"good",held:"held",quiz:"quiz",manual:"muted"};
function decStatus(row){ const d=row.dec; if(!isDecided(d))return{k:"todo",l:d&&(d.studentText||d.instructorText||d.comment)?"edited":"unreviewed"}; if(d.status==="approve")return{k:"ok",l:"approved"}; if(d.status==="override")return{k:"ov",l:"override "+d.score}; return{k:"fl",l:"flagged"}; }
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
 acts.forEach(a=>{const rows=reviewRows(s,a.id);const done=rows.filter(x=>isDecided(x.dec)).length;const b=el("a","tab",esc(a.id)+" <span class='pill'>"+done+"/"+rows.length+"</span>");b.href=classHref(s.key,"review")+"/"+encodeURIComponent(a.id);if(revAct===a.id){b.dataset.active="true";b.setAttribute("aria-current","page");}sub.append(b)});
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
   t.querySelectorAll("tr[data-s]").forEach(tr=>tr.onclick=()=>go(detailHref(s.key,revAct,tr.dataset.s)));
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
 return list.map(sh=>"<div class='shot'><div class='cap'>"+esc(sh.label)+"</div><a href='"+esc(sh.file)+"' target='_blank' rel='noopener' data-lightbox data-lightbox-caption='"+esc(sh.label)+"'><img loading='lazy' src='"+esc(sh.file)+"' alt='"+esc(sh.label)+" screenshot'></a></div>").join("");
}
function codeHTML(files){
 if(files===undefined) return "<div class='noshot'>Loading source from GitHub…</div>";
 if(!files||!files.length) return "<div class='noshot'>No code found for this submission.</div>";
 return "<select class='field__select cfile' id='cfile'>"+files.map((f,i)=>"<option value='"+i+"'>"+esc(f.path)+"</option>").join("")+"</select>"+
   "<pre class='code-block codepre' id='cpre'>"+hl(files[0].content,files[0].lang)+"</pre>";
}
const detailHref=(key,aid,sk)=>classHref(key,"review")+"/"+encodeURIComponent(aid)+"/"+encodeURIComponent(sk);
let detailKey=null;      // document keydown handler for the detail route; removed in beforeEach
let leftViewPref=null;   // "shots" | "code" - persists across prev/next navigations
function renderReviewDetail(s,w,aid,skey){
 const a=s.assignments.find(x=>x.id===aid);
 const back=classHref(s.key,"review");
 if(!a||!a.aiGraded){ w.append(el("div","card","<p class='card__body'>No AI-graded activity "+esc(aid)+" here. <a href='"+back+"'>Back to AI Review</a></p>")); return; }
 const max=a.totalPoints;
 const order=reviewRows(s,aid).map(row=>skeyOf(row.st));
 const i=order.indexOf(skey);
 const st=s.students.find(x=>skeyOf(x)===skey);
 if(i<0||!st){ w.append(el("div","card","<p class='card__body'>No held "+esc(aid)+" submission for that student. <a href='"+back+"'>Back to AI Review</a></p>")); return; }
 const sk=skey, r=st.activities[aid];
 const orig=parseNote(r.note);
 const here=detailHref(s.key,aid,skey);
 const box=el("div"); w.append(box);
 detailKey=e=>{ if(e.target&&/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;
  if(e.key==="Escape")go(back);
  else if(e.key==="ArrowRight"&&i<order.length-1)go(detailHref(s.key,aid,order[i+1]));
  else if(e.key==="ArrowLeft"&&i>0)go(detailHref(s.key,aid,order[i-1])); };
 document.addEventListener("keydown",detailKey);
 function paint(){
  // lazy media, per pane: screenshots fetch on first sight (they are the default
  // pane); CODE fetches only when its tab is opened, so shots never wait on it.
  const shots=shotsCached(s.section,r.repo);   // null = loading, [] = none
  const files=codeCached(s.section,r.repo);    // undefined = not fetched, null = none
  const repaint=()=>{ if(location.hash===here&&document.body.contains(box)) paint(); };
  if(shots===null) shotsFor(s.section,s.org,r.repo).then(repaint);
  else if(shots&&!shots.length&&files===undefined) codeFor(s.section,s.org,r.repo).then(repaint); // no shots -> code becomes the default pane
  if(leftViewPref==="code"&&files===undefined) codeFor(s.section,s.org,r.repo).then(repaint);
  const hasShots=!!(shots&&shots.length);
  const hasCode=!!(files&&files.length);
  const codeUnknown=files===undefined;
  if(leftViewPref===null||(leftViewPref==="shots"&&!hasShots&&hasCode)||(leftViewPref==="code"&&!hasCode&&!codeUnknown&&hasShots)) leftViewPref=hasShots?"shots":(hasCode?"code":"shots");
  const lv=leftViewPref;
  const curDec=getDec(s.section,aid,sk);
  const stt=decStatus({dec:curDec});
  const chip="<span class='badge' data-tone='"+TONE[stt.k]+"'>"+stt.l+"</span>";
  const flag=r.aiFlag?r.aiFlag.split(" - ")[0]:null;
  box.innerHTML="<a class='mut' href='"+back+"'>← AI Review · "+esc(aid)+"</a>"+
   "<div class='rvhead' style='margin-top:4px'><h1 style='margin:0'>"+esc(st.name||"(blank)")+"</h1>"+chip+
     "<div class='rvnav'><button class='btn' data-size='sm' data-variant='soft' id='prev'"+(i<=0?" disabled":"")+">← Prev</button>"+
     "<span class='cnt'>"+(i+1)+" / "+order.length+"</span>"+
     "<button class='btn' data-size='sm' data-variant='soft' id='next'"+(i>=order.length-1?" disabled":"")+">Next →</button></div></div>"+
   "<div class='muted'>"+esc(aid)+" · "+esc(sk)+" · @"+esc(st.github||"")+" · repo "+esc(r.repo)+"</div>"+
   "<div class='legend'><span>Automated: <b>"+r.raw+"</b></span><span>AI proposed: <b data-grade='grain'>"+(r.proposed!=null?r.proposed+"/"+max:"-")+"</b></span>"+(flag?"<span>AI-authored: <b data-grade='grain'>"+esc(flag)+"</b></span>":"")+"</div>"+
   "<div class='rev2'>"+
    "<div class='rvcol'>"+
     "<nav class='tab-bar'>"+
      "<button class='tab'"+(lv==='shots'?" data-active='true'":"")+" data-lv='shots'"+(hasShots?'':' disabled')+">Screenshots</button>"+
      "<button class='tab'"+(lv==='code'?" data-active='true'":"")+" data-lv='code'"+((hasCode||codeUnknown)?'':' disabled')+">Code"+(hasCode?" <span class='pill'>"+files.length+"</span>":"")+"</button>"+
     "</nav>"+
     "<div class='shots' id='lvShots' data-lightbox-group style='display:"+(lv==='shots'?'flex':'none')+"'>"+shotsHTML(shots)+"</div>"+
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
  const prev=$("#prev"),next=$("#next");
  if(prev)prev.onclick=()=>{if(i>0)go(detailHref(s.key,aid,order[i-1]))};
  if(next)next.onclick=()=>{if(i<order.length-1)go(detailHref(s.key,aid,order[i+1]))};
  // left-pane toggle (screenshots <-> code) - no repaint, just show/hide.
  // First open of the Code tab triggers its (deferred) fetch, then repaints.
  box.querySelectorAll(".tab[data-lv]").forEach(b=>b.onclick=()=>{ if(b.disabled)return; leftViewPref=b.dataset.lv;
    if(leftViewPref==="code"&&codeCached(s.section,r.repo)===undefined){ $("#lvCode").innerHTML="<p class='mut'>Loading code…</p>"; codeFor(s.section,s.org,r.repo).then(repaint); }
    $("#lvShots").style.display=leftViewPref==="shots"?"flex":"none"; $("#lvCode").style.display=leftViewPref==="code"?"block":"none";
    box.querySelectorAll(".tab[data-lv]").forEach(x=>{if(x.dataset.lv===leftViewPref)x.dataset.active="true";else x.removeAttribute("data-active")}); });
  const cf=$("#cfile"); if(cf){ cf.onchange=()=>{ const f=files[+cf.value]; $("#cpre").innerHTML=hl(f.content,f.lang); }; }
  // gather the current text edits + comment, keeping only what differs from the AI original
  const collect=(extra)=>{ const d=Object.assign({},getDec(s.section,aid,sk)||{},extra);
    const stv=$("#dStudent").value, inv=$("#dInstr").value, cm=$("#dComment").value;
    if(stv.trim()!==orig.student.trim())d.studentText=stv; else delete d.studentText;
    if(inv.trim()!==orig.instructor.trim())d.instructorText=inv; else delete d.instructorText;
    if(cm)d.comment=cm; else delete d.comment;
    return d; };
  const save=v=>{setDec(s.section,aid,sk,v);if(i<order.length-1)go(detailHref(s.key,aid,order[i+1]));else paint();};
  $("#dApprove").onclick=()=>save(collect(r.proposed!=null?{status:"approve"}:{status:"override",score:+$("#dOv").value}));
  $("#dOvBtn").onclick=()=>save(collect({status:"override",score:+$("#dOv").value}));
  $("#dFlag").onclick=()=>save(collect({status:"flag"}));
  $("#dClear").onclick=()=>{setDec(s.section,aid,sk,null);paint();};
  $("#dSave").onclick=()=>{const d=collect({});setDec(s.section,aid,sk,Object.keys(d).length?d:null);$("#dSaved").textContent="saved ✓";const stt2=decStatus({dec:getDec(s.section,aid,sk)});const c=box.querySelector(".rvhead .badge");if(c){c.dataset.tone=TONE[stt2.k];c.textContent=stt2.l;}};
  $("#dRevert").onclick=()=>{$("#dStudent").value=orig.student;$("#dInstr").value=orig.instructor;const d=collect({});setDec(s.section,aid,sk,Object.keys(d).length?d:null);paint();};
 }
 paint();
}

function showGenFeedback(s,aid){
 const rows=reviewRows(s,aid);
 const pending=rows.filter(x=>!x.r.note);
 const txt=buildGenFeedback(s,aid);
 const d=el("div","drawer on"); const p=el("div","dp");
 p.innerHTML="<button class='x'>×</button><h3>Generate AI feedback drafts - "+esc(aid)+"</h3><div class='muted'>"+pending.length+" submission(s) without a note yet · runs in a Claude Code session on your subscription (no GitHub Models)</div><div style='margin:10px 0'><button class='btn' data-size='sm' id='send'>Send to repo →</button> <button class='btn' data-size='sm' data-variant='soft' id='cp'>Copy prompt</button></div><pre class='code-block prompt' id='ptxt'>"+esc(txt)+"</pre>";
 d.append(p); document.body.append(d);
 const close=()=>d.remove(); p.querySelector(".x").onclick=close; d.onclick=e=>{if(e.target===d)close()};
 $("#cp").onclick=()=>navigator.clipboard.writeText(txt).then(()=>$("#cp").textContent="Copied ✓");
 wireSend(s,"gen-feedback",aid,txt);
}

function showApplyAI(s,aid){
 const rows=reviewRows(s,aid); const max=s.assignments.find(a=>a.id===aid).totalPoints;
 const {txt,decided,flagged,undone}=buildApplyAI(s,aid,rows);
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
 const rows=reviewRows(s,aid);
 const {txt,delivered,heldOut}=buildFinalize(s,aid,rows);
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
 const txt=buildApplyGrades(s,DATA.generatedAt);
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
 const {txt,graded,pub}=buildDeliver(s,DATA.generatedAt);
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
