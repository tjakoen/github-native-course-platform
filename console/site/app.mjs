// Course Console - hosted, data-free shell. All gradebook data is fetched
// live from api.github.com with the teacher's own token (Settings). The UI half
// is the retired local dashboard's script, ported verbatim where possible; the
// data half now lives in lib/. The app READS everything and WRITES exactly one
// thing: Intent prompt files into gradebook/intents/ (executed by Claude Code
// locally - "run pending intents").
import { AuthError, rate, ghJSON as ghJSON2, ghText } from "./lib/gh.mjs";
import { clearAll, sweep } from "./lib/cache.mjs";
import { loadConfig, saveConfig } from "./lib/store.mjs";
import { discoverSections, parseRepoURL } from "./lib/config.mjs";
import { shotsFor, shotsCached } from "./lib/shots.mjs";
import { codeFor, codeCached } from "./lib/code.mjs";
import { route, start, go, dispatch, beforeEach, fallback } from "./lib/router.mjs";
import { discover, sections, findSc, getSection, sectionCached, invalidate, ageOf, STALE_MS, getFlagsFiles, discoErrors, getPendingIntents, invalidateIntents, hydrateSnapshots, setRevalidateHook, isRevalidating } from "./lib/data.mjs";
import { missingWork, workspaceInfo } from "./lib/students.mjs";
import { initSearch } from "./lib/search-index.mjs";
import { OPS } from "./lib/ops-catalog.mjs";
import { listRuns, dispatch as dispatchWf, findDispatchedRun, pollRun } from "./lib/actions.mjs";
import { editAssignments } from "./lib/config-writes.mjs";
import { $, el, esc, confirmExecute, openDrawer } from "./lib/ui.mjs";
import { DEC, getDec, setDec, skeyOf, isDecided, finalScore, exportDecisions, importDecisions, adoptLegacy } from "./lib/decisions.mjs";
import { hl } from "./lib/hl.mjs";
import { wireSend, buildGenFeedback, buildApplyAI, buildFinalize, buildApplyGrades, buildDeliver, buildManualAttendance, buildNewActivity, fileGenFeedback, workFrom } from "./lib/intents.mjs";
import { isDemo, enterDemo, exitDemo } from "./lib/demo.mjs";

let q="", revAct=null;
// The student filter box (q) is shared state; reset it when the view SCOPE
// changes (different class or different tab) so a filter never leaks across
// views/classes or survives a reload into the wrong list. Same-view repaints
// (after a decision save) keep the signature, so typing is never wiped.
let qScope="";
function scopeQ(sig){ if(sig!==qScope){ q=""; qScope=sig; } }
let stuFacet=null;   // one-shot: a deep link (Dashboard at-risk alert) pre-applies a Students facet
let stuSort={key:"name",dir:1};   // Students table sort column + direction
let DATA={generatedAt:new Date().toISOString()};   // prompt builders stamp "graded as of"
const main=$("#main");
// Fast path beside every "Copy": grain's handoff button (0.1.11+) opens claude.ai
// with the generated prompt pre-filled, so the teacher stops copy-pasting by hand.
// Declarative - handoff.js delegates on document, reads the payload from `sel` at
// click time (works for dynamically-built drawers), URI-encodes it, opens a new
// tab (noopener). Copy stays as the fallback. sel defaults to the drawer's #ptxt.
// claude.ai/new?q= puts the text in the composer (the teacher still hits send -
// the intended human gate). Very long prompts overflow the URL budget and would
// arrive truncated, so above a conservative cap we drop the link and lean on Copy
// (a truncated prompt is worse than one honest extra paste).
const CLAUDE_URL_CAP=8000;   // prompt chars; ~11k encoded URL, the safe ceiling for the composer
const openInClaude=(sel="#ptxt",txt="")=> (txt||"").length>CLAUDE_URL_CAP
 ? " <span class='mut' data-size='sm'>(prompt too long for a link - use Copy)</span>"
 : " <button class='btn' data-size='sm' data-variant='soft' type='button' data-handoff data-handoff-url='https://claude.ai/new?q={payload}' data-handoff-source='"+sel+"'>Open in Claude →</button>";

// Settings body + wiring, shared by the real page (#/settings) and the interrupt
// drawer (first run / auth error). `scope` is the element the form lives in;
// `close` is what "done" does (remove the drawer, or nothing for the page).
// The demo pitch, shown wherever someone might be stuck at the front door: the
// first-run settings drawer, the Settings page, and (as the exit half) the
// dashboard while demo mode is on.
const DEMO_PITCH="<div class='demoOffer'><b>Not set up yet?</b> Open the <b>demo</b> instead: three synthetic classes with grades, AI feedback drafts, attendance and ops, all generated in your browser. No repo, no token, and nothing real is touched. <button class='btn demoGo' data-size='sm' type='button'>Open the demo →</button></div>";
// A class, not an id: the pitch can legitimately appear twice (the Settings page
// and an interrupt drawer over it), and duplicate ids break both the markup and
// whichever copy the user can actually reach.
function wireDemoOffer(scope){ scope.querySelectorAll(".demoGo").forEach(b=>{ b.onclick=()=>enterDemo(); }); }

function settingsFormHTML(c,firstRun){
 if(isDemo()) return "<div class='demoOffer'><b>You are in demo mode.</b> The repo list and tokens are simulated, so there is nothing to configure here and nothing was read from your saved settings. Leave the demo to connect real teacher repos. <button class='btn' data-size='sm' type='button' id='leaveDemo'>Exit demo</button></div>";
 // Each teacher repo gets its OWN row: URL + its own fine-grained PAT. One
 // rejected/expired token then only takes down that one section, not all.
 const rowHTML=(r={})=>"<div class='repoRow' style='display:flex;gap:var(--space-2);margin-bottom:var(--space-2);align-items:flex-start'>"+
   "<div style='flex:1;min-width:0'>"+
    "<input class='field__input rUrl mono' type='text' value='"+esc(r.url||"")+"' placeholder='github.com/org/teacher-subject-section-name'>"+
    "<input class='field__input rTok' type='password' value='"+esc(r.token||"")+"' placeholder='github_pat_… (this repo's PAT)' style='margin-top:6px'>"+
   "</div>"+
   "<button class='btn rDel' data-size='sm' data-variant='soft' title='Remove this repo' style='flex:none'>×</button>"+
  "</div>";
 return (firstRun?DEMO_PITCH:"")+"<div class='muted'>Stored in THIS browser's localStorage only - anyone with access to this browser profile can read the tokens. A PAT scoped to just the teacher repo loads gradebooks and lets you file Intents. To also see <b>student code and screenshots</b> (which live in the submission repos), that repo's PAT needs read access to the whole org - use a classic PAT with <code>repo</code> scope, or a fine-grained PAT with <b>All repositories</b> (Contents: Read). Short expiry recommended.</div>"+
  "<div class='field__label' style='margin-top:var(--space-3)'>Teacher repos <span class='mut'>- one repo + its own PAT per row</span></div>"+
  "<div id='sRepos'>"+((c.repos.length?c.repos:[{}]).map(rowHTML).join(""))+"</div>"+
  "<button class='btn' data-size='sm' data-variant='soft' id='sAdd' style='margin-top:2px'>+ Add repo</button>"+
  "<div style='display:flex;gap:var(--space-2);align-items:center;margin-top:var(--space-4);flex-wrap:wrap'><button class='btn' data-size='sm' id='sSave'>Save & load</button> <button class='btn' data-size='sm' data-variant='soft' id='sTest'>Test connection</button> <span class='mut' id='sMsg' style='font-size:12px'></span></div>"+
  "<div class='field__label' style='margin-top:var(--space-4)'>Review decisions <span class='mut'>- browser-local; back them up</span></div>"+
  "<div style='display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap'><button class='btn' data-size='sm' data-variant='soft' id='sExpDec'>↓ Export</button> <button class='btn' data-size='sm' data-variant='soft' id='sImpDec'>↑ Import</button><input type='file' id='sImpFile' accept='application/json,.json' style='display:none'></div>"+
  "<div class='field__label' style='margin-top:var(--space-4)'>Cached data <span class='mut'>- gradebooks kept in this browser for fast reloads</span></div>"+
  "<div class='muted' data-size='sm'>To make reloads fast, gradebook data (including student names and numbers) is cached in this browser's IndexedDB. It never leaves the machine, is swept after 7 days, and is wiped when you remove all repos. Clear it now if you are on a shared computer.</div>"+
  "<div style='display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap;margin-top:6px'><button class='btn' data-size='sm' data-variant='soft' id='sClearCache'>Clear cached data</button> <span class='mut' id='sCacheMsg' style='font-size:12px'></span></div>"+
  (firstRun?"":DEMO_PITCH);
}
function wireSettingsForm(scope,c,close,firstRun){
 // In demo mode the form is a single notice with one button, so none of the
 // real wiring below has anything to bind to.
 if(isDemo()){ const b=scope.querySelector("#leaveDemo"); if(b)b.onclick=()=>exitDemo(); return; }
 wireDemoOffer(scope);
 const rowHTML=()=>"<div class='repoRow' style='display:flex;gap:var(--space-2);margin-bottom:var(--space-2);align-items:flex-start'>"+
   "<div style='flex:1;min-width:0'>"+
    "<input class='field__input rUrl mono' type='text' value='' placeholder='github.com/org/teacher-subject-section-name'>"+
    "<input class='field__input rTok' type='password' value='' placeholder='github_pat_… (this repo's PAT)' style='margin-top:6px'>"+
   "</div>"+
   "<button class='btn rDel' data-size='sm' data-variant='soft' title='Remove this repo' style='flex:none'>×</button>"+
  "</div>";
 const read=()=>({repos:[...scope.querySelectorAll(".repoRow")].map(row=>({url:row.querySelector(".rUrl").value.trim(),token:row.querySelector(".rTok").value.trim()})).filter(r=>r.url),labels:c.labels||{}});
 const msg=t=>{const m=scope.querySelector("#sMsg");if(m)m.textContent=t;};
 const wireDel=()=>scope.querySelectorAll(".rDel").forEach(b=>b.onclick=()=>{const rows=scope.querySelectorAll(".repoRow");if(rows.length>1)b.closest(".repoRow").remove();else{b.closest(".repoRow").querySelector(".rUrl").value="";b.closest(".repoRow").querySelector(".rTok").value="";}});
 wireDel();
 scope.querySelector("#sAdd").onclick=()=>{ scope.querySelector("#sRepos").insertAdjacentHTML("beforeend",rowHTML()); wireDel(); };
 scope.querySelector("#sExpDec").onclick=exportDecisions;
 scope.querySelector("#sClearCache").onclick=async b=>{ const btn=b.currentTarget; btn.disabled=true; const m=scope.querySelector("#sCacheMsg"); if(m)m.textContent="Clearing…"; await clearAll(); invalidate(); if(m)m.textContent="Cleared ✓ - reopen a class to reload from GitHub."; btn.disabled=false; };
 scope.querySelector("#sImpDec").onclick=()=>scope.querySelector("#sImpFile").click();
 scope.querySelector("#sImpFile").onchange=e=>{const f=e.target.files[0];if(f)importDecisions(f,()=>dispatch());e.target.value="";};
 scope.querySelector("#sTest").onclick=async()=>{
  const v=read(); if(!v.repos.length){msg("Add at least one repo URL.");return;}
  const noTok=v.repos.filter(r=>!r.token); if(noTok.length){msg(noTok.length+" repo(s) have no PAT.");return;}
  msg("Testing…");
  try{
   const {sections,errors}=await discoverSections(v.repos,v.labels);
   msg("✓ "+sections.length+" section(s) reachable"+(errors.length?" · "+errors.length+" problem(s): "+errors.map(e=>(parseRepoURL(e.url)?.repo||e.url)+": "+e.err).join("; "):""));
  }catch(e){msg("Failed: "+e.message);}
 };
 scope.querySelector("#sSave").onclick=()=>{
  const v=read(); if(!v.repos.length){msg("Need at least one repo URL.");return;}
  const noTok=v.repos.filter(r=>!r.token); if(noTok.length){msg(noTok.length+" repo(s) have no PAT. Give every repo its own token.");return;}
  saveConfig(v); close(); boot();
 };
}

// Real Settings PAGE (drawer only survives for interrupts, below). Landing here
// no longer strands a blank page behind a modal.
function settingsView(){
 scopeQ("settings");
 setTabs(null); statusLine(null);
 const c=loadConfig()||{repos:[],labels:{}};
 main.innerHTML="";
 const w=el("div","wrap");
 w.innerHTML="<h1>Settings</h1><p class='lede' data-size='sm'>Repos, tokens, and your review-decision backups.</p><div class='card' data-pad='sm' id='setBody'></div>";
 main.append(w);
 w.querySelector("#setBody").innerHTML=settingsFormHTML(c);
 wireSettingsForm(w,c,()=>{},false);
}

// Interrupt drawer: only for first run (no config yet) and auth errors.
function openSettings(firstRun){
 const c=loadConfig()||{repos:[],labels:{}};
 const guard=()=>{ if(firstRun&&!loadConfig()){const m=p.querySelector("#sMsg");if(m)m.textContent="Add at least one repo (URL + PAT), then Save.";return false;} return true; };
 const {panel:p,close}=openDrawer("<h3>Settings</h3>"+settingsFormHTML(c),guard);
 wireSettingsForm(p,c,close,firstRun);
}

// ---- demo mode chrome ----
// Demo mode has to be unmissable (nobody should mistake synthetic data for a real
// class) and one click to leave: a rail badge + an Exit item, a status-bar chip,
// and a banner card at the top of the dashboard.
function demoChrome(){
 if(!isDemo())return;
 document.documentElement.setAttribute("data-demo","1");
 const brand=document.querySelector(".side-rail__brand");
 if(brand&&!brand.querySelector(".demoTag")) brand.insertAdjacentHTML("beforeend","<span class='badge demoTag' data-tone='held'>demo</span>");
 if(!$("#exitDemo")){
  const b=el("button","nav-item nav-item--btn","<svg class='icon' aria-hidden='true'><use href='vendor/grain/sprite.svg#close'></use></svg><span class='nav-item__label'>Exit demo</span>");
  b.type="button"; b.id="exitDemo"; b.title="Leave demo mode and go back to your own teacher repos";
  const set=document.querySelector("#rail [data-nav='settings']");
  if(set) set.parentNode.insertBefore(b,set); else $("#rail").append(b);
  b.onclick=()=>exitDemo();
 }
}
function demoBanner(){
 const c=el("div","card demoBanner"); c.dataset.pad="sm"; c.dataset.surface="demo:banner";
 c.innerHTML="<h2>Demo mode <span class='badge' data-tone='held'>synthetic data</span></h2>"+
  "<p class='mut' data-size='sm'>Three invented classes generated in this browser from a fixed seed: gradebooks, AI feedback drafts, attendance, reports and engine runs. There is no GitHub connection and no token. Every write (filing an intent, flipping a publish flag, dispatching a workflow) is simulated in memory and gone when you close the tab, and your own saved repos and tokens were not read.</p>"+
  "<div class='ctl'><button class='btn' data-size='sm' type='button' data-tour='demo-welcome'>Take the tour</button><button class='btn' data-size='sm' data-variant='soft' type='button' id='demoOut'>Exit demo</button></div>";
 setTimeout(()=>{ const b=$("#demoOut"); if(b)b.onclick=()=>exitDemo(); },0);
 return c;
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
 const cnt=n=>n>0?" ("+n+")":"";   // hide zero-count badges rather than showing "(0)"
 const items=[["","Overview","overview"],["gradebook","Gradebook","book"],["activities","Activities"+(s?cnt(s.stats.activities):""),"act"],["students","Students"+(s?cnt(s.stats.students):""),"stu"],["review","AI Review"+(s?cnt(heldUnreviewed(s)):""),"ai"],["attendance","Attendance"+(s?cnt(s.stats.sessions):""),"att"],["ops","Ops","ops"]];
 t.innerHTML=items.map(([sub,l,m])=>{const on=m===mode||(m==="stu"&&String(mode).startsWith("profile:"))||(m==="ai"&&mode==="revdetail")||(m==="act"&&mode==="actnew");return "<a class='tab' href='"+classHref(key,sub)+"'"+(on?" aria-current='page' data-active='true'":"")+">"+l+"</a>";}).join("");
}

function statusLine(key){
 const bits=[];
 if(isDemo()) bits.push("<span><b>DEMO</b> · synthetic data, no GitHub connection</span>");
 if(rate.remaining!=null) bits.push("<span"+(rate.remaining<500?" style='color:var(--color-danger,inherit);font-weight:var(--font-weight-semibold)'":"")+">API "+rate.remaining+"/"+rate.limit+"</span>");
 if(key){ const age=ageOf(key); if(age!=null){ const reval=isRevalidating(key); bits.push("<span>"+esc(key)+" · "+(reval?"showing cached ":"loaded ")+(age<6e4?"just now":Math.round(age/6e4)+" min ago")+(reval?" · refreshing…":(age>STALE_MS?" · stale (↻ to refresh)":""))+"</span>"); } }
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
 $("#railClasses").querySelectorAll("[data-classnav]").forEach(a=>wirePrefetch(a,a.dataset.classnav));
}
// Warm a section on intent-to-open (rail/card hover dwell or pointer-down) so the
// click paints from cache. getSection dedupes, so a hover then click is one load.
// Guarded: never for an already-cached class, never when the rate budget is low.
function prefetch(key){
 if(sectionCached(key)) return;
 if(rate.remaining!=null&&rate.remaining<1000) return;
 getSection(key).then(s=>railHeld(key,heldUnreviewed(s))).catch(()=>{});
}
function wirePrefetch(elm,key){
 let t=null;
 elm.addEventListener("pointerenter",()=>{ t=setTimeout(()=>prefetch(key),150); });   // 150ms dwell = intent, not a fly-over
 elm.addEventListener("pointerleave",()=>{ if(t){clearTimeout(t);t=null;} });
 elm.addEventListener("pointerdown",()=>prefetch(key));
}
function railHeld(key,held){
 const b=document.querySelector("[data-classnav='"+key.replace(/'/g,"")+"'] .navheld");
 if(b){ if(held>0){b.textContent=held;b.hidden=false;} else b.hidden=true; }
}
// A held row is SETTLED when either this browser decided it (approve / override /
// flagged) or the gradebook already carries a written aiScore. The second half is
// repo truth and it is the important one: an apply that ran on another machine, in
// a cleared store, or straight from a Claude Code session leaves no local decision
// at all, so a localStorage-only count kept a fully delivered section badged
// forever. Same rule the stage header uses (isApplied / isDelivered below).
const isSettled=x=>isDecided(x.dec)||x.r.aiScore!=null;
// The held badge counts UNSETTLED submissions awaiting a decision (Canvas
// "needs grading" convention), not the number of AI activities. It drains to
// zero as each one is decided or written.
function heldUnreviewed(s){
 if(!s) return 0;
 let n=0;
 const held=s.assignments.filter(a=>a.kind==="held");
 for(const st of s.students){ const sk=skeyOf(st);
  for(const a of held){ const r=st.activities[a.id];
   if(r && !isSettled({r,dec:getDec(s.section,a.id,sk)})) n++; } }
 return n;
}

// ONE attendance-rate policy, shared by every surface (Students facet, the
// Attendance tile/matrix, the at-risk strips, the Dashboard inbox, the profile)
// so "below 50%" means the same thing everywhere. A roster student (has a
// number) with sessions on record but no scan is a genuine 0% - they attended
// none of the tracked sessions - not "unknown"; a student with no number cannot
// be matched to attendance at all, so their rate is null (excluded, never
// counted as at-risk). Returns a per-student rate function bound to the section.
function attRateFn(s){
 const att=s.attendance, dates=(att&&att.sessionDates)||[];
 return st=>{ if(!dates.length||!st.number)return null; const a=att.students[st.number]; return (a?a.count:0)/dates.length; };
}
const isAtRisk=r=>r!=null&&r<0.5;

async function withSection(key,fn){
 const sc=findSc(key);
 if(!sc){ main.innerHTML="<div class='boot'>Unknown class "+esc(key)+". <a href='#/'>Dashboard</a></div>"; return; }
 if(!sectionCached(key)) main.innerHTML="<div class='boot'>Loading "+esc(sc.subject)+" · "+esc(sc.section)+"…</div>";
 try{
  const s=await getSection(key);
  if(curKey()!==key) return;   // navigated away while loading
  DATA.generatedAt=new Date(Date.now()-(ageOf(key)||0)).toISOString();
  railHeld(key,heldUnreviewed(s));
  fn(s);
 }catch(e){
  if(e instanceof AuthError){ main.innerHTML="<div class='boot'>"+esc(e.message)+"</div>"; openSettings(false); }
  // A wrong-scope PAT (403/404) is not an AuthError, so a bare "retry" can never
  // work - always offer the way to fix the token.
  else main.innerHTML="<div class='boot'>Load failed: "+esc(e.message)+" · <a href='"+classHref(key)+"'>retry</a> · <a href='#/settings'>check token scope in Settings</a></div>";
 }
}

function classView(key,mode,extra){
 scopeQ("c:"+key+":"+(String(mode).startsWith("profile:")?"profile":mode));
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
  else if(mode==="ops") renderOps(s,w);
  else if(mode==="book") renderBook(s,w);
  else renderOverview(s,w);
 });
}

const profileHref=(key,sk)=>classHref(key,"students")+"/"+encodeURIComponent(sk);

// ---- Students list ----
function renderStudents(s,w){
 const preAtrisk=stuFacet==="atrisk"; stuFacet=null;   // one-shot deep link (Dashboard alert)
 const facets=el("div","ctl");
 facets.innerHTML='<input class="field__input search" id="q" placeholder="Filter students…" value="'+esc(q)+'">'+
  '<fieldset class="chips" data-select="multi" id="stuFacets" style="border:0;padding:0;margin:0">'+
   '<label class="chips__chip"><input type="checkbox" value="missing"><span>Missing work</span></label>'+
   '<label class="chips__chip"><input type="checkbox" value="blank"><span>Blank student.json</span></label>'+
   '<label class="chips__chip"><input type="checkbox" value="atrisk"'+(preAtrisk?" checked":"")+'><span>Attendance &lt;50%</span></label>'+
  '</fieldset>';
 w.append(facets);
 const holder=el("div"); w.append(holder);
 const rate=attRateFn(s);
 const pubActs=s.assignments.filter(a=>a.publish);
 const missOf=st=>missingWork(s,st).length;
 const delivOf=st=>pubActs.filter(a=>st.activities[a.id]).length;
 // one comparable value per sort key (nulls sink so "?" attendance/no-tally rows
 // do not float to the top of a "worst first" sort)
 const sortVals={ name:st=>(st.name||"~").toLowerCase(), number:st=>st.number||"", github:st=>(st.github||"~").toLowerCase(),
  auto:st=>st.tally.pushMax?st.tally.push/st.tally.pushMax:-1, held:st=>st.tally.heldMax?st.tally.held/st.tally.heldMax:-1,
  att:st=>{const r=rate(st);return r==null?-1:r;}, missing:st=>missOf(st), delivered:st=>delivOf(st) };
 const arrow=k=>stuSort.key===k?(stuSort.dir>0?" ▲":" ▼"):"";
 const th=(k,label,cls)=>"<th"+(cls?" class='"+cls+"'":"")+" data-sort='"+k+"' tabindex='0' role='button' aria-sort='"+(stuSort.key===k?(stuSort.dir>0?"ascending":"descending"):"none")+"'>"+esc(label)+arrow(k)+"</th>";
 const paint=()=>{
  const on=[...w.querySelectorAll("#stuFacets input:checked")].map(c=>c.value);
  let rows=s.students.filter(st=>{
   if(q&&!((st.name||"").toLowerCase().includes(q)||(st.number||"").includes(q)||(st.github||"").toLowerCase().includes(q)))return false;
   if(on.includes("missing")&&!missOf(st))return false;
   if(on.includes("blank")&&st.number)return false;
   if(on.includes("atrisk")&&!isAtRisk(rate(st)))return false;
   return true;
  });
  const sv=sortVals[stuSort.key]||sortVals.name;
  rows=rows.slice().sort((a,b)=>{const va=sv(a),vb=sv(b);return va<vb?-1*stuSort.dir:va>vb?1*stuSort.dir:0;});
  holder.innerHTML="";
  const card=el("div","card"); card.append(el("h2",null,"Students <span class='mut' style='font-weight:400'>("+rows.length+" of "+s.students.length+")</span>"));
  const sc2=el("div","table-scroll"); const t=el("table","matrix");
  t.innerHTML="<tr>"+th("name","Student","stu sortable")+th("number","#","sortable")+th("github","@github","sortable")+th("auto","Auto","center sortable")+th("held","Held","center sortable")+th("att","Attendance","center sortable")+th("missing","Missing","center sortable")+"<th class='center'>At risk</th>"+th("delivered","Delivered","center sortable")+"</tr>"+
   rows.map(st=>{
    const miss=missOf(st), r=rate(st), atrisk=isAtRisk(r), why=[];
    if(miss>=2)why.push("<span class='badge' data-tone='warn'>"+miss+" missing</span>");
    if(atrisk)why.push("<span class='badge' data-tone='warn'>"+Math.round(r*100)+"% att</span>");
    return "<tr class='rowlink' data-sk='"+esc(skeyOf(st))+"'>"+
     "<td class='stu'><a href='"+profileHref(s.key,skeyOf(st))+"'>"+esc(st.name||"(blank)")+"</a></td><td class='mut'>"+esc(st.number||"-")+"</td><td class='mut'>"+esc(st.github||"-")+"</td>"+
     "<td class='center'>"+(st.tally.pushMax?st.tally.push+"/"+st.tally.pushMax:"-")+"</td>"+
     "<td class='center'>"+(st.tally.heldMax?st.tally.held+"/"+st.tally.heldMax:"-")+"</td>"+
     "<td class='center'>"+(r==null?"<span class='mut'>-</span>":atrisk?"<span class='badge' data-tone='warn'>"+Math.round(r*100)+"%</span>":Math.round(r*100)+"%")+"</td>"+
     "<td class='center'>"+(miss?"<span class='badge' data-tone='warn'>"+miss+"</span>":"·")+"</td>"+
     "<td>"+(why.length?why.join(" "):"<span class='mut'>·</span>")+"</td>"+
     "<td class='center' title='published activities this student has a grade for (from the gradebook, not a workspace check)'>"+(pubActs.length?delivOf(st)+"/"+pubActs.length:"<span class='mut'>·</span>")+"</td></tr>";
   }).join("");
  sc2.append(t); card.append(sc2); holder.append(card);
  // whole-row click for the mouse; the name is a real link so the keyboard reaches
  // the profile too. A click on the link navigates on its own (do not double-fire).
  t.querySelectorAll(".rowlink").forEach(tr=>tr.onclick=e=>{ if(e.target.closest("a"))return; location.hash=profileHref(s.key,tr.dataset.sk); });
  t.querySelectorAll("th[data-sort]").forEach(h=>{ const k=h.dataset.sort;
   const go2=()=>{ if(stuSort.key===k)stuSort.dir*=-1; else stuSort={key:k,dir:k==="name"||k==="number"||k==="github"?1:-1}; paint(); };
   h.onclick=go2; h.onkeydown=e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go2(); } }; });
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
 head.innerHTML="<a class='mut' href='"+classHref(s.key,"students")+"'>← Students</a><h1 style='margin-top:var(--space-1)'>"+esc(st.name||"(blank)")+"</h1>"+
  "<div class='muted'>#"+esc(st.number||"?")+" · @"+esc(st.github||"?")+" · "+esc(s.subject)+" · "+esc(s.section)+"</div>";
 w.append(head);
 // at-risk alert strip (same rate policy as the rest of the app)
 const r0=attRateFn(s)(st), alerts=[];
 if(miss.length>=2)alerts.push(miss.length+" missing activities");
 if(isAtRisk(r0))alerts.push(Math.round(r0*100)+"% attendance (below 50%)");
 if(alerts.length){ const al=el("div","card"); al.dataset.pad="sm"; al.setAttribute("style","border-left:3px solid var(--warn)");
  al.innerHTML="<h2>⚑ At risk</h2><ul class='status-list'>"+alerts.map(a=>"<li class='status-list__item'><span class='status-list__mark'>⚑</span><span class='status-list__title'>"+esc(a)+"</span></li>").join("")+"</ul>"; w.append(al); }
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
   "<ul class='status-list' data-grade='smooth' style='margin-top:var(--space-2)'>"+
    "<li class='status-list__item'><span class='status-list__mark'>"+(sj.studentNumber?"✓":"✗")+"</span><span class='status-list__title'>student.json "+(sj.studentNumber?"filled":"blank")+(mismatch?" <span class='badge' data-tone='bad'>number mismatch vs gradebook</span>":"")+"</span></li>"+
    "<li class='status-list__item'><span class='status-list__mark'>"+(ws.gradesDelivered?"✓":"·")+"</span><span class='status-list__title'>GRADES.md delivered</span></li>"+
    "<li class='status-list__item'><span class='status-list__mark'>"+(ws.feedbackDelivered?"✓":"·")+"</span><span class='status-list__title'>FEEDBACK.md delivered</span></li>"+
    "<li class='status-list__item'><span class='status-list__mark'>"+(ws.attendanceReceipt?"✓":"·")+"</span><span class='status-list__title'>Attendance receipt</span></li>"+
   "</ul>";
 }).catch(()=>{ const box=idc.querySelector("#wsInfo"); if(box)box.textContent="Workspace check failed."; });
 // activities
 const ac=el("div","card"); ac.append(el("h2",null,"Activities"));
 const asc=el("div","table-scroll"); const t=el("table","matrix");
 t.innerHTML="<tr><th>Activity</th><th>Kind</th><th class='center'>Score</th><th class='center'>Late</th><th>Review</th><th>Repo</th></tr>"+
  s.assignments.map(a=>{
   const r=st.activities[a.id];
   if(!r) return (a.namePrefix&&!a.manual&&!a.quiz)?"<tr><td>"+esc(a.id)+"</td><td><span class='badge' data-tone='"+KTONE[a.kind]+"'>"+a.kind+"</span></td><td class='center'><span class='badge' data-tone='warn'>missing</span></td><td class='center'>·</td><td>·</td><td class='mut'>no submission</td></tr>":"";
   const score=r.kind==="held"?(r.proposed!=null?r.proposed+"/"+r.proposedMax+" (held)":"held"):(r.canvasPts!=null?r.canvasPts:r.raw);
   // held/AI rows link into the review detail and show the decision state (no
   // longer a dead end); everything else has no review lane.
   let review="<span class='mut'>·</span>";
   if(a.aiGraded){ const stt=decStatus({dec:getDec(s.section,a.id,skeyOf(st))}); review="<a href='"+detailHref(s.key,a.id,skeyOf(st))+"'><span class='badge' data-tone='"+TONE[stt.k]+"'>"+stt.l+"</span> →</a>"; }
   return "<tr><td>"+esc(a.id)+"</td><td><span class='badge' data-tone='"+KTONE[r.kind]+"'>"+r.kind+"</span></td>"+
    "<td class='center'>"+esc(String(score))+"</td><td class='center'>"+(r.late?"LATE":"·")+"</td>"+
    "<td>"+review+"</td>"+
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
 scopeQ("dash");
 setTabs(null); statusLine(null);
 main.innerHTML="";
 const w=el("div","wrap");
 w.innerHTML="<h1>My classes</h1><p class='lede' data-size='sm'>"+(isDemo()
  ?"Everything below is generated in your browser. The views, the parsing and the write surfaces are the real ones: only the data behind them is invented."
  :"Live from GitHub. A class's gradebook loads when you open it and is cached in this browser for fast reloads; nothing leaves this machine. Clear it anytime in <a href='#/settings'>Settings</a>.")+"</p>";
 if(isDemo()) w.append(demoBanner());
 // Discovery drops a repo it cannot read (typo'd URL, expired/under-scoped PAT)
 // instead of failing the whole load; without this banner that section just is
 // not there, silently.
 const derr=discoErrors();
 if(derr.length){
  const b=el("div","card"); b.dataset.pad="sm"; b.setAttribute("style","border-left:3px solid var(--warn)");
  b.innerHTML="<h2>⚠ "+derr.length+" teacher repo(s) could not be loaded</h2><p class='mut'>A typo'd URL or an expired/under-scoped token - these sections are missing below. <a href='#/settings'>Open settings</a></p><ul class='status-list'>"+
   derr.map(e=>"<li class='status-list__item'><span class='status-list__title mono'>"+esc(e.url||"?")+"</span><span class='status-list__meta'>"+esc(e.err||"unreadable")+"</span></li>").join("")+"</ul>";
  w.append(b);
 }
 const ctl=el("div","ctl");
 ctl.innerHTML='<button class="btn" data-size="sm" data-variant="soft" id="loadAll">Load all classes</button>'+
  '<div class="meter" id="laMeter" style="flex:1;max-width:280px" hidden role="meter" aria-label="Load progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="meter__seg" data-tone="ok" style="--seg:0%"></span></div>'+
  '<span class="mut" id="laMsg"></span>';
 w.append(ctl);
 // Bulk actions: fan a common job across EVERY class so the Ops tab is not a
 // per-class errand. Only safe fan-outs live here (grade sweep is teacher-side;
 // feedback is the intent path; audits are read-only) - execute/delivery ops stay
 // per-class behind their typed confirm.
 const bulk=el("div","card"); bulk.dataset.pad="sm"; bulk.dataset.surface="dash:bulk";
 bulk.innerHTML="<h2>Bulk actions <span class='mut' style='font-weight:400'>· all classes</span></h2>"+
  "<p class='mut' data-size='sm'>Fan one job across every class. Execute + delivery ops (publish, Canvas execute, provisioning) stay per-class in each class's Ops tab.</p>"+
  "<div class='ctl'>"+
   "<button class='btn' data-size='sm' id='bulkGrade'>Grade sweep - all</button>"+
   "<button class='btn' data-size='sm' data-variant='soft' id='bulkFb'>Generate feedback - all</button>"+
   "<button class='btn' data-size='sm' data-variant='soft' id='bulkAudit'>Audit - all (read-only)</button>"+
  "</div>";
 w.append(bulk);
 const grid=el("div","dashgrid"); grid.dataset.surface="dash:cards";
 const cardFor=sc=>{
  const s=sectionCached(sc.key);
  const c=el("a","card dashcard"); c.href=classHref(sc.key); c.dataset.pad="sm"; c.dataset.dash=sc.key;
  c.innerHTML="<h2>"+esc(sc.subject)+" · "+esc(sc.section)+(sc.courseCode?" <span class='mut'>("+esc(sc.courseCode)+")</span>":"")+"</h2><div class='mut'>"+esc(sc.org)+"</div>"+
   (s?"<div class='stats stats--mini'>"+[["Students",s.stats.students],["To review",heldUnreviewed(s)],["Activities",s.stats.activities]].map(([l,n])=>"<div class='stat'><span class='stat__value'>"+n+"</span><span class='stat__label'>"+l+"</span></div>").join("")+"</div>"
     :"<div class='mut'>"+sc.pol.length+" activities · open to load</div>");
  wirePrefetch(c,sc.key);
  return c;
 };
 sections().forEach(sc=>grid.append(cardFor(sc)));
 w.append(grid);
 // ONE complete "Needs attention" inbox (Phase C: Flags folded in here). It lists
 // EVERY class: loaded classes show computed alerts + engine FLAGS/FLAGGED lines
 // (cheap 2-call cached read), and every row deep-links; unloaded classes appear
 // as visible "not loaded [load]" rows, never silently absent.
 const inbox=el("div"); inbox.dataset.surface="dash:inbox"; w.append(inbox);
 const flagsByKey={};
 const flagLines=t=>(t||"").split("\n").map(l=>l.replace(/^[-*#>\s]+/,"").trim()).filter(l=>l&&!/^_.*_$/.test(l)).slice(0,3);
 const paintInbox=()=>{
  const scs=sections();
  const rows=[];
  scs.forEach(sc=>{
   const s=sectionCached(sc.key);
   if(!s){ rows.push({mark:"·",html:"<span class='mut'>"+esc(sc.key)+" - not loaded</span> <a href='#' data-loadkey='"+esc(sc.key)+"'>load</a>"}); return; }
   const hu=heldUnreviewed(s); if(hu>0)rows.push({mark:"⚑",html:"<a href='"+classHref(sc.key,"review")+"'>"+hu+" AI grade(s) to review</a> · "+esc(sc.key)});
   if(s.stats.blankStudentJson>0)rows.push({mark:"⚑",html:"<a href='"+classHref(sc.key,"students")+"'>"+s.stats.blankStudentJson+" blank student.json</a> · "+esc(sc.key)});
   const att=s.attendance;
   if(att&&att.sessionDates&&att.sessionDates.length){
    const rate=attRateFn(s);
    const n=s.students.filter(st=>isAtRisk(rate(st))).length;
    if(n)rows.push({mark:"⚑",html:"<a href='"+classHref(sc.key,"students")+"' data-atrisk='1'>"+n+" student(s) below 50% attendance</a> · "+esc(sc.key)});
   }
   (flagsByKey[sc.key]||[]).forEach(line=>rows.push({mark:"⚑",html:esc(line)+" · <a href='"+classHref(sc.key)+"'>"+esc(sc.key)+"</a>"}));
  });
  const loaded=scs.filter(sc=>sectionCached(sc.key)).length;
  inbox.innerHTML=scs.length?"<div class='card' data-pad='sm'><h2>Needs attention <span class='mut' style='font-weight:400'>("+loaded+" of "+scs.length+" classes loaded)</span></h2><ul class='status-list'>"+rows.map(r=>"<li class='status-list__item'><span class='status-list__mark'>"+r.mark+"</span><span class='status-list__title'>"+r.html+"</span></li>").join("")+"</ul></div>":"";
  inbox.querySelectorAll("[data-loadkey]").forEach(a=>a.onclick=e=>{e.preventDefault();loadOne(a.dataset.loadkey);});
  // pre-apply the at-risk facet on the Students view the alert links to (one-shot)
  inbox.querySelectorAll("[data-atrisk]").forEach(a=>a.onclick=()=>{ stuFacet="atrisk"; });
 };
 const loadOne=async key=>{
  try{ const s=await getSection(key); railHeld(key,heldUnreviewed(s)); const sc=findSc(key); const old=grid.querySelector("[data-dash='"+key.replace(/'/g,"")+"']"); if(sc&&old)old.replaceWith(cardFor(sc)); }
  catch(e){}
  paintInbox(); statusLine(null);
 };
 paintInbox();
 // fold engine flags in (cached; two content calls per class, or a cache hit)
 sections().forEach(sc=>getFlagsFiles(sc.key).then(f=>{ const lines=[...flagLines(f.flags),...flagLines(f.flagged)].slice(0,3); if(lines.length){ flagsByKey[sc.key]=lines; paintInbox(); } }).catch(()=>{}));
 main.append(w);
 $("#bulkGrade").onclick=()=>bulkGradeSweep();
 $("#bulkFb").onclick=()=>bulkFeedbackAll();
 $("#bulkAudit").onclick=()=>bulkAudit();
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
   try{ const s=await getSection(sc.key); railHeld(sc.key,heldUnreviewed(s)); const old=grid.querySelector("[data-dash='"+sc.key.replace(/'/g,"")+"']"); if(old)old.replaceWith(cardFor(sc)); }
   catch(e){ $("#laMsg").textContent=sc.key+" failed: "+e.message; }
   done++;
   const pct=Math.round(done/list.length*100);
   meter.setAttribute("aria-valuenow",pct); meter.querySelector(".meter__seg").style.setProperty("--seg",pct+"%");
   if(rate.remaining!=null&&rate.remaining<300){ $("#laMsg").textContent="Stopped early: API budget down to "+rate.remaining+"."; break; }
  }
  if(done===list.length) $("#laMsg").textContent="All classes loaded.";
  la.hidden=true; paintInbox(); statusLine(null);
 };
}

route("#/", dashView);
route("#/settings", settingsView);
route("#/scan", ()=>location.replace("./scanner/"));
// Retired global views (IA rework Phase C): Flags folded into the Dashboard
// inbox; Reports is an Overview card; Ops is a class tab. The old hashes
// redirect so bookmarks and cmdk history keep working.
route("#/flags", ()=>go("#/"));
route("#/reports", ()=>go("#/"));
route("#/reports/:key", p=>go(classHref(p.key)));
route("#/reports/:key/:file", p=>reportViewer(p.key,p.file));   // viewer stays
route("#/ops", ()=>{ const first=sections()[0]; go(first?classHref(first.key,"ops"):"#/"); });
route("#/ops/:key", p=>go(classHref(p.key,"ops")));
route("#/c/:key", p=>classView(p.key,"overview"));
route("#/c/:key/gradebook", p=>classView(p.key,"book"));
route("#/c/:key/ops", p=>classView(p.key,"ops"));
route("#/c/:key/activities", p=>classView(p.key,"act"));
route("#/c/:key/activities/new", p=>classView(p.key,"actnew"));
route("#/c/:key/students", p=>classView(p.key,"stu"));
route("#/c/:key/students/:sk", p=>classView(p.key,"profile:"+p.sk));
route("#/c/:key/review", p=>classView(p.key,"ai"));
route("#/c/:key/review/:aid", p=>classView(p.key,"ai",{aid:p.aid}));
route("#/c/:key/review/:aid/:skey", p=>classView(p.key,"revdetail",{aid:p.aid,skey:p.skey}));
route("#/c/:key/attendance", p=>classView(p.key,"att"));
fallback(()=>go("#/"));
// ---- CRUMB tours, one per view ----
// Two things to know before touching this.
//
// 1. The host starts a tour at STEP 0, never at the intro card. CRUMB's client
//    navigates by PATHNAME for the intro (tour.route) and for any step carrying
//    an `at`, which is right for a root-mounted multi-page app and wrong for
//    this one: the console is a hash-router SPA served under a project-page
//    subpath, so that navigation walks the visitor straight out of the app (a
//    404 locally, the wrong site on a fork). Starting at the first step means a
//    tour never navigates at all. `crumb:active` is crumb-live's documented
//    sessionStorage contract, and setMode re-renders the current step in place.
// 2. Because a tour cannot cross views, each one only addresses surfaces that
//    exist where it is launched, and the rail's Tour button hands you the tour
//    for whichever view you are standing in.
function startTour(id){
 if(!window.crumb) return;
 try{
  sessionStorage.setItem("crumb:active",JSON.stringify({id,step:0,mode:"demo",frame:false}));
  window.crumb.setMode("demo");
 }catch(e){ try{ window.crumb.start(id); }catch(e2){} }
}
document.addEventListener("click",e=>{ const t=e.target.closest&&e.target.closest("[data-tour]"); if(!t)return; e.preventDefault(); startTour(t.getAttribute("data-tour")); });

function tourFor(){
 const h=location.hash||"#/";
 if(/^#\/c\/[^/]+\/review/.test(h)) return ["review-walk","Tour: the AI review lane"];
 if(/^#\/c\//.test(h)) return ["class-walk","Tour: this class"];
 if(isDemo()) return ["demo-welcome","Tour: what you are looking at"];
 return ["first-run","Tour: the console shell"];
}
function setTourButton(){
 const b=document.querySelector("#rail [data-tour]");
 if(!b) return;
 const [id,label]=tourFor();
 b.setAttribute("data-tour",id);
 b.title=label;
}

let lastFocusHash=null;
beforeEach(()=>{ setNav(); setTourButton(); if(detailKey){document.removeEventListener("keydown",detailKey);detailKey=null;} document.querySelectorAll(".drawer,.drawer-modal").forEach(d=>d.remove());
 // SPA a11y: on a real route change (not a same-route repaint after a decision
 // save, which would steal focus from an open textarea), move focus to the main
 // content region. #main is never replaced (only its innerHTML), so focusing the
 // stable container survives the async content fill.
 const h=location.hash||"#/"; if(h!==lastFocusHash){ lastFocusHash=h; const m=$("#main"); if(m){ m.setAttribute("tabindex","-1"); try{m.focus({preventScroll:true});}catch(e){} } }
});

let started=false;
async function boot(){
 sweep();   // one-shot: drop cache entries past their age budget (fire-and-forget)
 demoChrome();
 const c=loadConfig();
 // First run: the setup drawer is modal and (until a repo is saved) refuses to
 // close, so it is the only reachable surface - the demo offer rides in the form
 // itself rather than on the boot screen behind it.
 if(!c){ main.innerHTML="<div class='boot'><h1>Course Console</h1>Live from GitHub - nothing loads until you connect your teacher repos and their tokens.</div>"; openSettings(true); return; }
 main.innerHTML="<div class='boot'>Discovering classes…</div>";
 try{
  const {sections:scs,errors}=await discover(c);
  if(!scs.length){
   main.innerHTML="<div class='boot'>No teacher repos reachable."+(errors.length?" "+esc(errors.map(e=>e.url+": "+e.err).join(" · ")):"")+" <a href='#/settings'>Open settings</a></div>";
   return;
  }
  if(errors.length) console.warn("course-console: skipped repos",errors);
  // Paint a stale-while-revalidate repaint onto the current view when a background
  // refresh lands (only if we're still looking at that class or the dashboard).
  setRevalidateHook(key=>{ const k=curKey(); if(k===key||!k){ if(k===key)railHeld(key,heldUnreviewed(sectionCached(key)||undefined)); dispatch(); } });
  // Hydrate persisted snapshots so the dashboard + a first class-open paint from
  // cache instantly (each still revalidates when actually opened).
  await hydrateSnapshots().catch(()=>0);
  fillRail();
  if(started) dispatch(); else { started=true; start(); }
  // CRUMB tour on arrival. Demo mode gets its own tour (the visitor came to be
  // shown around, and it says up front that the data is invented), once per tab
  // so a reload mid-demo is not a re-tour. The real first-run tour stays once per
  // browser, only after a working setup exists, never over the settings drawer.
  // Replay either anytime via the rail's Tour button.
  setTourButton();
  if(isDemo()){
   if(!sessionStorage.getItem("console-demo-toured")&&window.crumb){
    sessionStorage.setItem("console-demo-toured","1");
    setTimeout(()=>startTour("demo-welcome"),700);   // let the dashboard paint first
   }
  }else if(!localStorage.getItem("course-crumb-first-run-v1")&&window.crumb){
   localStorage.setItem("course-crumb-first-run-v1","1");
   startTour("first-run");
  }
 }catch(e){
  if(e instanceof AuthError){ main.innerHTML="<div class='boot'>"+esc(e.message)+"</div>"; openSettings(false); }
  else{ main.innerHTML="<div class='boot'>Discovery failed: "+esc(e.message)+" · <a href='#/settings'>settings</a></div>"; }
 }
}

// static-shell header controls
$(".skip-link")?.addEventListener("click",e=>{ e.preventDefault(); const m=$("#main"); if(m){ m.setAttribute("tabindex","-1"); m.focus(); m.scrollTop=0; } });
$("#reload").onclick=()=>{ const k=curKey(); invalidate(k); dispatch(); };
$("#theme").onclick=()=>toggleTheme();
initSearch(()=>dispatch());

// Heat cell: emit the score fraction as a --pct custom property; the hsl is
// computed in CSS (.cell[style*="--pct"]) so an OS light/dark flip mid-session
// recolors every cell with no repaint. Empty when there is no score.
function cellColor(pct){ return pct==null?"":"--pct:"+ (Math.round(pct*1000)/1000); }
// Repaint the current view on an OS scheme flip so anything else that reads the
// scheme at render time (badges, tint) follows along; the heat cells recolor via
// CSS regardless. Guarded so an explicit in-app theme choice is not overridden.
try{ matchMedia("(prefers-color-scheme:dark)").addEventListener("change",()=>{ if(!localStorage.getItem("grain-color-scheme")) render(); }); }catch(e){}
// review decisions now live in lib/decisions.mjs (same storage key + dkey shape)

// ---- Flags card (in-class, on the Overview). Engine FLAGS.md + reports/FLAGGED.md,
// MILL-rendered. Returns a hidden card that reveals itself only if there is
// something flagged, and removes itself when there is nothing. (The cross-class
// roll-up of these same files now lives in the Dashboard "Needs attention" inbox.)
function flagsCard(s){
 const sc=findSc(s.key)||s;
 const card=el("div","card"); card.dataset.pad="sm"; card.hidden=true;
 card.innerHTML="<h2>Flags</h2><div class='mut flagbody'></div>";
 getFlagsFiles(sc.key).then(f=>{
  const both=[f.flags&&"## FLAGS.md\n"+f.flags, f.flagged&&"## reports/FLAGGED.md\n"+f.flagged].filter(Boolean).join("\n\n");
  if(!both){ card.remove(); return; }
  card.hidden=false;
  const box=card.querySelector(".flagbody"); if(!box)return;
  renderMd(both).then(html=>{ box.classList.remove("mut"); box.innerHTML=html; }).catch(()=>{ box.innerHTML="<pre class='code-block prompt'>"+esc(both)+"</pre>"; });
 }).catch(()=>card.remove());
 return card;
}

// ---- Reports (in-console reader: reports/ listing -> MILL-rendered viewer) ----
const reportHref=(key,path)=>"#/reports/"+encodeURIComponent(key)+"/"+encodeURIComponent(path);
// Reports card on the class Overview (the standalone global Reports list is retired;
// the viewer route #/reports/:key/:file still works).
function reportsCard(s){
 const sc=findSc(s.key)||s;
 const card=el("div","card"); card.dataset.pad="sm";
 card.innerHTML="<h2>Reports</h2>"+
  "<ul class='content-index rlist'><li class='content-index__item'><span class='content-index__title'><a href='"+reportHref(sc.key,"gradebook/GRADEBOOK.md")+"'>GRADEBOOK.md</a></span><span class='content-index__meta'>the human-readable gradebook</span></li></ul>"+
  "<div class='mut rmore'>Loading reports/…</div>";
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
 }).catch(()=>{ const box=card.querySelector(".rmore"); if(box)box.innerHTML="reports/ not readable - check this repo's token scope in <a href='#/settings'>Settings</a>."; });
 return card;
}
function reportViewer(key,path){
 scopeQ("report");
 setTabs(null); statusLine(null);
 main.innerHTML=""; const w=el("div","wrap"); main.append(w);
 const sc=findSc(key);
 if(!sc){ w.innerHTML="<div class='boot'>Unknown class "+esc(key)+". <a href='#/'>Dashboard</a></div>"; return; }
 const back=classHref(key);
 if(!/^(reports|gradebook)\/[\w][\w./ -]*$/.test(path)||path.includes("..")){ w.innerHTML="<div class='boot'>Not a report path. <a href='"+back+"'>Back to "+esc(sc.section)+"</a></div>"; return; }
 w.innerHTML="<a class='mut' href='"+back+"'>← "+esc(sc.subject)+" · "+esc(sc.section)+"</a><h1 style='margin-top:var(--space-1)'>"+esc(path.split("/").pop())+"</h1>"+
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
 // grain's console organism hides .console__feed unless the app-shell carries
 // data-console-open; without this the whole ops feed (dispatch status, dry-run
 // results, run links, and ERRORS) renders into display:none and a failed
 // execute looks like silence.
 document.querySelector(".app-shell")?.setAttribute("data-console-open","");
 if(!box.firstChild){ box.innerHTML="<div class='console__box'><div class='console__bar'><span class='mut mono'>ops</span><span style='flex:1'></span><button class='btn' data-size='sm' data-variant='soft' id='opHide'>×</button></div><div class='console__feed' id='opLines'></div></div>"; $("#opHide").onclick=()=>{box.hidden=true;document.querySelector(".app-shell")?.removeAttribute("data-console-open");}; }
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
  // A real (execute) write that finished likely changed the gradebook/attendance/
  // assignments this section reads - drop its cached snapshot so the next open is
  // fresh. Dry runs change nothing, so leave the cache alone.
  if(executing&&done&&done.conclusion==="success") invalidate(sc.key);
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
  // a bool is a STATE (the gate: dry_run / execute), so it rides the b-switch atom
  // with a real label instead of a chip that read like a button.
  if(inp.type==="bool") ctl="<label class='switch opsw'><input type='checkbox' class='switch__input' id='"+id+"'"+(inp.def==="true"?" checked":"")+"><span class='switch__track'><span class='switch__thumb'></span></span><span class='switch__label'>"+esc(inp.name)+(inp.hint?" <span class='mut'>"+esc(inp.hint)+"</span>":"")+"</span></label>";
  else if(inp.type==="choice") ctl="<label class='field opf'><span class='field__label'>"+esc(inp.name)+"</span><select class='field__select' id='"+id+"'>"+inp.options.map(o=>"<option"+(o===inp.def?" selected":"")+">"+esc(o)+"</option>").join("")+"</select></label>";
  else if(inp.type==="text") ctl="<label class='field opf' style='width:100%'><span class='field__label'>"+esc(inp.name)+"</span><textarea class='field__input fta' rows='3' id='"+id+"'></textarea></label>";
  else if(inp.activity&&sc.pol) ctl="<label class='field opf'><span class='field__label'>only <span class='mut'>(blank = all)</span></span><select class='field__select' id='"+id+"'><option value=''></option>"+sc.pol.map(a=>"<option>"+esc(a.id)+"</option>").join("")+"</select></label>";
  else ctl="<label class='field opf'><span class='field__label'>"+esc(inp.name)+(inp.hint?" <span class='mut'>"+esc(inp.hint)+"</span>":"")+"</span><input class='field__input' id='"+id+"' value='"+esc(inp.def||"")+"'></label>";
  form.insertAdjacentHTML("beforeend",ctl);
 });
 const runBtn=el("button","btn oprunbtn","Run"); runBtn.dataset.size="sm";
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

// Ops is a per-class tab now (#/c/:key/ops): the class is already named by the
// active tab, so there is no in-content class picker to scroll away. Renders into
// the class wrap; classView has already set the tabs and status line.
function renderOps(s,w){
 const sc=findSc(s.key)||s;
 w.innerHTML="<h1>Ops · "+esc(sc.subject)+" · "+esc(sc.section)+"</h1><p class='lede' data-size='sm'>Run the engine for this class. Everything defaults to a dry run; a real write needs the class code typed back. A red audit run means the audit FOUND something.</p>";
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
  "<div class='opform' style='margin-top:var(--space-2)'><button class='btn' data-size='sm' id='pmAll' data-variant='soft'>Select all</button><button class='btn' data-size='sm' id='pmGo'>Publish selected</button><span class='mut' id='pmMsg'></span></div>";
 listRuns(sc.org,sc.repo,op.file,1).then(runs=>{
  const slot=c.querySelector(".oprun"); if(!slot)return;
  const r=runs&&runs[0]; if(!runs){slot.textContent="no runs (or PAT lacks Actions scope)";return;}
  if(!r){slot.textContent="never run";return;}
  slot.innerHTML="<a href='"+esc(r.html_url)+"' target='_blank' rel='noopener'><span class='badge' data-tone='"+(r.status!=="completed"?"held":r.conclusion==="success"?"good":"bad")+"'>"+esc(r.status!=="completed"?r.status:(r.conclusion||"done"))+"</span></a> <span class='mut'>"+new Date(r.created_at).toLocaleString()+"</span>";
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
 const scr=el("div","table-scroll"); const t=el("table","matrix");
 // Lock/Deliver are STATES the teacher sets, not one-shot verbs, so they ride the
 // b-switch atom (a real focusable checkbox) instead of a button that read
 // "PUBLISHING" and un-published on click. "Delivered / Not delivered" is the
 // publish flag's product word (E4 glossary); "held" is reserved for the AI lane.
 const swi=(cls,on,onL,offL)=>"<label class='switch'><input type='checkbox' class='switch__input "+cls+"'"+(on?" checked":"")+"><span class='switch__track'><span class='switch__thumb'></span></span><span class='switch__label"+(on?"":" switch__label--off")+"'>"+esc(on?onL:offL)+"</span></label>";
 // Lifecycle stage chip: where each activity sits on the draft -> graded/review ->
 // delivered arc, from loaded data only (no extra calls).
 const stageOf=a=>{
  const graded=s.students.filter(st=>st.activities[a.id]).length;
  if(a.publish)return{l:"Delivered",t:"good"};
  if(a.aiGraded){ const pend=s.students.filter(st=>st.activities[a.id]&&!isSettled({r:st.activities[a.id],dec:getDec(s.section,a.id,skeyOf(st))})).length;
   if(pend>0)return{l:"In review",t:"held"}; if(graded>0)return{l:"Reviewed",t:"ov"}; return{l:"Draft",t:"muted"}; }
  if(graded>0)return{l:"Graded",t:"quiz"};
  return{l:"Draft",t:"muted"};
 };
 t.innerHTML="<tr><th>Activity</th><th>Kind</th><th>Stage</th><th class='center'>Points</th><th class='center'>Graded</th><th class='center'>Locked</th><th class='center'>Delivered</th><th></th></tr>"+
  s.assignments.map(a=>{
   const graded=s.students.filter(st=>st.activities[a.id]).length; const stg=stageOf(a);
   return "<tr data-aid='"+esc(a.id)+"'>"+
    "<td><b>"+esc(a.id)+"</b>"+(a.title?" <span class='mut'>"+esc(a.title)+"</span>":"")+"</td>"+
    "<td><span class='badge' data-tone='"+KTONE[a.kind]+"'>"+a.kind+"</span></td>"+
    "<td><span class='badge' data-tone='"+stg.t+"'>"+stg.l+"</span></td>"+
    "<td class='center'>"+(a.totalPoints??a.autoPoints??"-")+"</td>"+
    "<td class='center'>"+graded+"</td>"+
    "<td class='center'>"+swi("tglLock",a.locked,"Locked","Open")+"</td>"+
    "<td class='center'>"+swi("tglPub",a.publish,"Delivered","Not delivered")+"</td>"+
    "<td><button class='btn actSweep' data-size='sm' data-variant='soft' title='Grade sweep, dry-run, just this activity'>sweep</button> <button class='btn actScaffold' data-size='sm' data-variant='soft' title='Re-file the scaffold intent for this activity (resume the New-activity wizard after a refresh)'>scaffold</button> <button class='btn actActivate' data-size='sm' data-variant='soft' title='Author the Canvas shell (canvas-sync execute), then publish its content unit - each step polled green'>Set up in Canvas</button></td></tr>";
  }).join("");
 scr.append(t); card.append(scr); w.append(card);
 t.querySelectorAll("tr[data-aid]").forEach(tr=>{
  const aid=tr.dataset.aid;
  // A cancelled/failed toggle must revert the switch to the actual state (the
  // checkbox already flipped visually on click; a committed edit re-renders).
  tr.querySelector(".tglLock").onchange=async e=>{
   const inp=e.currentTarget, want=inp.checked, a=s.assignments.find(x=>x.id===aid);
   const ok=await editAssignments(sc,es=>{const en=es.find(x=>x.id===aid);if(!en)return null;en.locked=want;return (want?"Lock ":"Unlock ")+aid;},(want?"Lock ":"Unlock ")+aid+" - "+s.key).catch(err=>{alert(err.message);return false;});
   if(ok)afterAssignmentsEdit(s.key,ok); else inp.checked=!!a.locked;
  };
  tr.querySelector(".tglPub").onchange=async e=>{
   const inp=e.currentTarget, want=inp.checked, a=s.assignments.find(x=>x.id===aid);
   const warn=a.aiGraded&&want?" (AI-graded: finalize its reviews first)":"";
   const ok=await editAssignments(sc,es=>{const en=es.find(x=>x.id===aid);if(!en)return null;en.publish=want;return (want?"Deliver ":"Hold back ")+aid+warn;},(want?"Deliver ":"Hold back ")+aid+" - "+s.key).catch(err=>{alert(err.message);return false;});
   if(ok)afterAssignmentsEdit(s.key,ok); else inp.checked=!!a.publish;
  };
  tr.querySelector(".actSweep").onclick=()=>{
   const op=OPS.find(o=>o.file==="grade.yml");
   runOp(sc,{...op,execDanger:"write the gradebook"},{dry_run:"true",only:aid,force:"false"},false);
  };
  tr.querySelector(".actScaffold").onclick=()=>showScaffold(s,s.assignments.find(x=>x.id===aid));
  tr.querySelector(".actActivate").onclick=()=>activateActivity(s,sc,s.assignments.find(x=>x.id===aid));
 });
 // Content & Canvas: reuse the Ops materialCard (multi-select + SEQUENTIAL publish
 // behind the typed confirm) instead of the old free-text single-unit box that
 // dropped that safety. Canvas dry-runs sit beside it; execute lives in Ops.
 const ch=el("div"); ch.innerHTML="<h2 class='opgroup'>Content & Canvas</h2><p class='mut'>Publish content units to every workspace (multi-select, sequential - the safe path) or dry-run the Canvas tools. Execute variants live in <a href='"+classHref(s.key,"ops")+"'>Ops</a>, behind the typed confirm.</p>";
 w.append(ch);
 w.append(materialCard(sc,OPS.find(o=>o.file==="publish-material.yml")));
 const cv=el("div","card"); cv.dataset.pad="sm";
 cv.innerHTML="<div class='opform'><button class='btn' data-size='sm' data-variant='soft' id='csDry'>Canvas sync (dry-run)</button><button class='btn' data-size='sm' data-variant='soft' id='cpDry'>Canvas push (dry-run)</button></div>";
 w.append(cv);
 $("#csDry").onclick=()=>{const op=OPS.find(o=>o.file==="canvas-sync-assignments.yml");runOp(sc,op,{mode:"dry-run",desc:"false",submit:"false",rename:"false"},false);};
 $("#cpDry").onclick=()=>{const op=OPS.find(o=>o.file==="canvas-push.yml");runOp(sc,op,{mode:"dry-run",comment:"false"},false);};
}

// Re-file the scaffold intent for an EXISTING activity (the resumable path: if you
// committed the entry then refreshed, the wizard's step 2 is otherwise stranded -
// re-entering it hits "id already exists"). Reconstructs the raw assignments.json
// entry from the parsed policy so buildNewActivity emits the same prompt.
function rawEntryOf(a){
 const e={id:a.id}; if(a.type)e.type=a.type; if(a.manual)e.manual=true;
 if(a.namePrefix)e.namePrefix=a.namePrefix; if(a.title)e.title=a.title;
 if(a.totalPoints!=null)e.totalPoints=a.totalPoints; else if(a.autoPoints!=null)e.autoPoints=a.autoPoints;
 if(a.aiGraded){e["ai-grading"]=true; if(a.feedback)e.feedback=a.feedback;}
 if(a.locked)e.locked=true; if(a.publish)e.publish=true;
 return e;
}
function showScaffold(s,a){
 if(!a)return;
 const txt=buildNewActivity(s,rawEntryOf(a));
 openDrawer("<h3>Scaffold "+esc(a.id)+" - "+esc(s.section)+"</h3><div class='muted'>Files the scaffold intent (starter, tests, RUBRIC, Canvas description) for Claude Code. Use this to resume after committing the entry - it does not touch the gradebook or publish anything.</div>"+CONSEQUENCE+
  "<div id='actRow' style='margin:10px 0'><button class='btn' data-size='sm' id='send'>Send to repo →</button> <button class='btn' data-size='sm' data-variant='soft' id='cp'>Copy</button>"+openInClaude("#ptxt",txt)+"</div><pre class='code-block prompt' id='ptxt'>"+esc(txt)+"</pre>");
 $("#cp").onclick=()=>navigator.clipboard.writeText(txt).then(()=>$("#cp").textContent="Copied ✓");
 wireSend(s,"new-activity",a.id,txt,path=>drawerSent(s,path,"new-activity",a.id));
}

// ---- "Set up in Canvas" wizard: canvas-sync (execute, only=<id>) -> poll green ->
// publish-material for the activity's content unit -> poll green. Every step
// streams to the docked console feed; a non-green step stops the chain.
async function activateActivity(s,sc,a){
 if(!a)return;
 const steps="author its Canvas assignment shell (canvas-sync execute, only="+a.id+")"+(a.content?", then publish content unit "+a.content+" to every workspace":"");
 const ok=await confirmExecute("set up "+a.id+" in Canvas on "+s.key+": "+steps,s.section);
 if(!ok)return;
 const cs=OPS.find(o=>o.file==="canvas-sync-assignments.yml");
 const c1=await runOp(sc,{...cs,execDanger:""},{mode:"execute",only:a.id,desc:"false",submit:"false",rename:"false"},true,true);
 if(c1!=="success"){ opFeed("Set up "+esc(a.id)+" in Canvas STOPPED: canvas-sync came back "+esc(String(c1))+"."); return; }
 if(a.content){
  const pm=OPS.find(o=>o.file==="publish-material.yml");
  const c2=await runOp(sc,{...pm,execDanger:""},{unit:a.content},true,true);
  if(c2!=="success"){ opFeed("Set up "+esc(a.id)+" in Canvas STOPPED: publish-material("+esc(a.content)+") came back "+esc(String(c2))+"."); return; }
 } else opFeed("No content unit on "+esc(a.id)+" (assignments.json \"content\") - skipped publish-material.");
 opFeed("Set up "+esc(a.id)+" in Canvas done ✓ - set the due date and PUBLISH it in Canvas (the sync always leaves it unpublished).");
}

// ---- New-activity wizard (#/c/:key/activities/new): entry via diff-commit,
// scaffolds via a new-activity intent, then an optional canvas-sync dry-run.
function renderActivityNew(s,w){
 const sc=findSc(s.key)||s;
 const back=classHref(s.key,"activities");
 const head=el("div");
 head.innerHTML="<a class='mut' href='"+back+"'>← Activities</a><h1 style='margin-top:var(--space-1)'>New activity - "+esc(s.section)+"</h1>"+
  "<p class='lede' data-size='sm'>Nothing publishes to students from here. If you commit the entry then refresh, resume from the <b>scaffold</b> button on the activity's Activities row.</p>"+
  "<ol class='stepper' style='margin-bottom:0'>"+
   "<li class='stepper__step' data-state='active' aria-current='step'><span class='stepper__dot'>1</span><span class='stepper__label'>Commit entry</span></li>"+
   "<li class='stepper__step' data-state='todo'><span class='stepper__dot'>2</span><span class='stepper__label'>File scaffold intent</span></li>"+
   "<li class='stepper__step' data-state='todo'><span class='stepper__dot'>3</span><span class='stepper__label'>Set up in Canvas (dry-run)</span></li>"+
  "</ol>";
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
  "<p class='mut' style='margin:var(--space-2) 0'>\"publish\" starts false - delivery stays behind review/finalize.</p>"+
  "<div style='display:flex;gap:var(--space-2);align-items:center'><button class='btn' data-size='sm' id='naCommit'>Review diff & commit entry</button><span class='mut' id='naMsg'></span></div>"+
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
  const scp=findSc(s.key); if(scp&&Array.isArray(ok))scp.pol=ok;
  invalidate(s.key);
  msg.textContent="Committed ✓";
  const nxt=card.querySelector("#naNext");
  const txt=buildNewActivity(s,e);
  nxt.innerHTML="<h2 style='margin-top:var(--space-4)'>2 · Scaffolds (intent for Claude Code)</h2>"+
   "<div style='margin:10px 0'><button class='btn' data-size='sm' id='send'>Send to repo →</button> <button class='btn' data-size='sm' data-variant='soft' id='naCp'>Copy</button>"+openInClaude("#naPrompt",txt)+"</div>"+
   "<pre class='code-block prompt' id='naPrompt'>"+esc(txt)+"</pre>"+
   "<h2>3 · Set up in Canvas</h2><p class='mut'>Author the Canvas assignment from the new entry (dry-run; execute lives behind Set up in Canvas / Ops).</p>"+
   "<button class='btn' data-size='sm' data-variant='soft' id='naCs'>Canvas sync dry-run (only="+esc(e.id)+")</button>";
  nxt.querySelector("#naCp").onclick=()=>navigator.clipboard.writeText(txt).then(()=>{nxt.querySelector("#naCp").textContent="Copied ✓"});
  wireSend(s,"new-activity",e.id,txt);
  nxt.querySelector("#naCs").onclick=()=>{const op=OPS.find(o=>o.file==="canvas-sync-assignments.yml");runOp(sc,op,{mode:"dry-run",only:e.id,desc:"false",submit:"false",rename:"false"},false);};
 };
}


// Legacy shim: views call render() after a decision write or theme flip; it
// re-dispatches the current route (cached section -> instant repaint).
function render(){ if(started) dispatch(); }

// After an assignments.json commit: PATCH the discovery-cached sc.pol in memory
// (the trap - loadSection prefers sc.pol, so a stale one would mask the edit),
// invalidate the section (drops the snapshot + in-memory value), and repaint.
function afterAssignmentsEdit(key,after){ const scp=findSc(key); if(scp&&Array.isArray(after))scp.pol=after; invalidate(key); dispatch(); }

// Class OVERVIEW (the landing tab, #/c/:key): the at-a-glance read. Tiles,
// at-risk, Canvas preview, engine flags, recent runs, Reports. The full-width
// matrix and the delivery prompts live one tab deeper in Gradebook, so nothing
// pushes the overview off the first screen.
function renderOverview(s,w){
 const tiles=el("div","stats");
 const avgP=avg(s.students.map(x=>x.tally.pushMax?x.tally.push/x.tally.pushMax:null));
 tiles.innerHTML=[
  ["Students",s.stats.students],["Activities",s.stats.activities],
  ["To review",heldUnreviewed(s),"AI, awaiting your decision"],
  ["Blank student.json",s.stats.blankStudentJson],
  ["Avg auto-push",avgP==null?"-":Math.round(avgP*100)+"%"],
 ].map(([l,n,sub])=>'<div class="stat"><span class="stat__value">'+n+'</span><span class="stat__label">'+l+'</span>'+(sub?'<span class="stat__sub">'+sub+'</span>':'')+'</div>').join("");
 w.append(tiles);
 const ctl=el("div","ctl");
 ctl.innerHTML='<a class="btn" data-size="sm" href="'+classHref(s.key,"gradebook")+'">Open gradebook →</a> <button class="btn" data-size="sm" data-variant="soft" id="ovPrompt">Generate apply-grades prompt →</button> <button class="btn" data-size="sm" data-variant="soft" id="ovDeliver">Deliver to Canvas + workspaces →</button>';
 w.append(ctl);
 // Quick actions: the two common jobs without a trip to the Ops tab. Grade sweep
 // dispatches grade.yml (dry_run=false, teacher-side); Generate feedback opens the
 // per-class bulk feedback drawer over this class's un-drafted AI submissions.
 const qa=el("div","ctl"); qa.dataset.surface="class:quick";
 qa.innerHTML='<button class="btn" data-size="sm" id="ovGrade">Grade sweep →</button> <button class="btn" data-size="sm" data-variant="soft" id="ovGenFb">Generate feedback →</button> <a class="btn" data-size="sm" data-variant="soft" href="'+classHref(s.key,"ops")+'">All ops →</a>';
 w.append(qa);
 w.append(pendingIntentsCard(s));
 const risk=atRiskCard(s); if(risk)w.append(risk);
 w.append(canvasPanel(s));
 const fc=flagsCard(s); fc.dataset.surface="class:flags"; w.append(fc);
 const rc=runsCard(s); rc.dataset.surface="class:runs"; w.append(rc);
 const rp=reportsCard(s); rp.dataset.surface="class:reports"; w.append(rp);
 $("#ovPrompt").onclick=()=>showPrompt(s);
 $("#ovDeliver").onclick=()=>showDeliver(s);
 $("#ovGrade").onclick=()=>quickGradeSweep(s);
 $("#ovGenFb").onclick=()=>showBulkFeedback(pendingFeedback(s),"Generate feedback - "+s.key,0);
}

// Pending intents strip: what the console has filed into gradebook/intents/ but a
// Claude Code session has not yet run - so after a Send the trail stays visible.
// One cheap listing call (short-TTL memoized); hides itself when nothing pends.
function pendingIntentsCard(s){
 const card=el("div","card"); card.dataset.pad="sm"; card.hidden=true;
 card.innerHTML="<h2>Pending intents</h2><div class='mut pibody'>Checking gradebook/intents/…</div>";
 getPendingIntents(s.key).then(list=>{
  const box=card.querySelector(".pibody"); if(!box)return;
  if(!list.length){ card.remove(); return; }
  card.hidden=false; box.classList.remove("mut");
  box.innerHTML="<p class='mut' data-size='sm'>Filed by the console, not yet run. In a Claude Code session in the teacher repo, run pending intents, then Refresh (↻).</p>"+
   "<ul class='status-list'>"+list.map(it=>{
    const label=INTENT_LABEL[it.kind]||it.kind;
    const title=esc(label)+(it.aid?" · <a href='"+classHref(s.key,"review")+"/"+encodeURIComponent(it.aid)+"'>"+esc(it.aid)+"</a>":"");
    const age=relTime(it.at);
    return "<li class='status-list__item'><span class='status-list__mark'>◷</span><span class='status-list__title'>"+title+"</span>"+(age?"<span class='status-list__meta'>"+esc(age)+"</span>":"")+"</li>";
   }).join("")+"</ul>";
 }).catch(()=>card.remove());
 return card;
}

// GRADEBOOK tab (#/c/:key/gradebook): the full-width matrix and the delivery
// prompts, nothing stacked below it.
function renderBook(s,w){
 const ctl=el("div","ctl");
 ctl.innerHTML='<input class="field__input search" id="q" placeholder="Filter students…" value="'+esc(q)+'"> <button class="btn" data-size="sm" data-variant="soft" id="prompt">Generate apply-grades prompt →</button> <button class="btn" data-size="sm" id="deliver">Deliver to Canvas + workspaces →</button>';
 w.append(ctl);
 w.append(matrix(s));
 $("#q").oninput=e=>{q=e.target.value.toLowerCase();renderMatrixOnly(s)};
 $("#prompt").onclick=()=>showPrompt(s);
 $("#deliver").onclick=()=>showDeliver(s);
}

// At-risk strip on the class overview: low attendance and/or piling-up missing
// work, linking straight into the student profile.
function atRiskCard(s){
 const rate=attRateFn(s);
 const rows=s.students.map(st=>{
  const miss=missingWork(s,st).length;
  const r=rate(st);
  const why=[];
  if(miss>=2)why.push(miss+" missing activities");
  if(isAtRisk(r))why.push(Math.round(r*100)+"% attendance");
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
// The five Actions calls are TTL-memoized per section (RUNS_TTL) so re-entering
// the Overview - or the status bar's ↻, which re-dispatches - does not re-fire
// them on every paint. `invalidate(key)` clears the section, not this memo; the
// memo just ages out. A hard refresh of the runs list waits out RUNS_TTL.
const RUNS_TTL=90*1000;
const runsMemo=new Map();   // key -> { at, promise }
function runsFor(sc){
 const hit=runsMemo.get(sc.key);
 if(hit && Date.now()-hit.at<RUNS_TTL) return hit.promise;
 const FILES=[["grade.yml","Grade sweep"],["publish.yml","Publish grades"],["canvas-push.yml","Canvas push"],["publish-material.yml","Publish material"],["verify-attendance.yml","Verify attendance"]];
 const promise=Promise.all(FILES.map(([f,l])=>listRuns(sc.org,sc.repo,f,3).then(rs=>(rs||[]).map(r=>({r,label:l}))).catch(()=>[])))
  .then(all=>all.flat().sort((a,b)=>new Date(b.r.created_at)-new Date(a.r.created_at)).slice(0,8))
  .catch(err=>{ runsMemo.delete(sc.key); throw err; });
 runsMemo.set(sc.key,{at:Date.now(),promise});
 return promise;
}
function runsCard(s){
 const sc=findSc(s.key)||s;
 const card=el("div","card"); card.dataset.pad="sm";
 card.innerHTML="<h2>Recent engine runs</h2><div class='mut runsbox'>Loading runs…</div>";
 runsFor(sc)
 .then(runs=>{
  const box=card.querySelector(".runsbox"); if(!box)return;
  if(!runs.length){ box.textContent="No runs visible (never run, or this repo's PAT lacks Actions: Read)."; return; }
  box.classList.remove("mut");
  box.innerHTML="<div class='timeline'><div class='timeline__feed'>"+runs.map(({r,label})=>{
   const tone=r.status!=="completed"?"held":r.conclusion==="success"?"good":"bad";
   return "<div class='timeline__entry'><span class='timeline__mark'></span><div class='timeline__head'><span class='timeline__who'>"+esc(label)+"</span> <span class='badge' data-tone='"+tone+"'>"+esc(r.status!=="completed"?r.status:(r.conclusion||"done"))+"</span> <a href='"+esc(r.html_url)+"' target='_blank' rel='noopener'>run →</a></div><div class='timeline__hint'>"+new Date(r.created_at).toLocaleString()+"</div></div>";
  }).join("")+"</div></div>";
 })
 .catch(()=>{ const box=card.querySelector(".runsbox"); if(box)box.innerHTML="Runs unavailable - this repo's PAT needs Actions: Read (<a href='#/settings'>Settings</a>)."; });
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
 const rate=attRateFn(s);   // the one shared policy: a roster student never scanned = 0%
 const tiles=el("div","stats");
 const avgRate=avg(s.students.map(rate));
 const atRisk=s.students.filter(st=>isAtRisk(rate(st))).length;
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
 const stuRow=st=>'<label class="status-list__item" style="cursor:pointer"><input type="checkbox" class="mAttStu" value="'+esc(st.number)+'" data-name="'+esc(st.name||"")+'"> <span class="status-list__title">'+esc(st.name||"(blank)")+' <span class="badge" data-tone="muted">'+esc(st.number||"-")+'</span></span></label>';
 const students=s.students.filter(st=>st.number);
 const {panel:p}=openDrawer("<h3>Manual attendance - "+esc(s.section)+"</h3>"+
  "<div class='muted'>Pick the students and the date; the generated intent tells the AI to record them as present with the teacher-attested \"manual\" signature. Verify + receipts run automatically on push.</div>"+
  "<div class='field' style='margin-top:10px'><span class='field__label'>Date</span><input class='field__input' id='mAttDate' type='date' value='"+today+"'></div>"+
  "<div class='field'><span class='field__label'>Filter</span><input class='field__input' id='mAttQ' placeholder='Filter students…'></div>"+
  "<ul class='status-list' id='mAttList' style='max-height:40vh;overflow:auto'>"+students.map(stuRow).join("")+"</ul>"+
  "<div style='margin:10px 0'><button class='btn' data-size='sm' id='mAttGen'>Generate prompt</button></div><div id='mAttOut'></div>");
 $("#mAttQ").oninput=e=>{const f=e.target.value.toLowerCase();p.querySelectorAll("#mAttList .status-list__item").forEach(li=>{li.style.display=li.textContent.toLowerCase().includes(f)?"":"none";});};
 $("#mAttGen").onclick=()=>{
  const picked=[...p.querySelectorAll(".mAttStu:checked")].map(c=>({num:c.value,name:c.dataset.name}));
  const date=$("#mAttDate").value;
  if(!picked.length||!date){$("#mAttOut").innerHTML="<p class='mut'>Pick at least one student and a date.</p>";return;}
  const txt=buildManualAttendance(s,picked,date);
  $("#mAttOut").innerHTML=CONSEQUENCE+"<div id='actRow' style='margin:10px 0'><button class='btn' data-size='sm' id='send'>Send to repo →</button> <button class='btn' data-size='sm' data-variant='soft' id='mAttCp'>Copy</button>"+openInClaude("#mAttPrompt",txt)+"</div><pre class='code-block prompt' id='mAttPrompt'>"+esc(txt)+"</pre>";
  $("#mAttCp").onclick=()=>{navigator.clipboard.writeText(txt).then(()=>{$("#mAttCp").textContent="Copied ✓"})};
  wireSend(s,"manual-attendance",null,txt,path=>drawerSent(s,path,"manual-attendance",null));
 };
}
function attMatrix(s,dates){
 const att=s.attendance;
 const card=el("div","card"); card.id="attmatrix";
 card.append(el("h2",null,"Attendance - students × sessions <span class='mut' style='font-weight:400'>(✓ present · absent)</span>"));
 const sc=el("div","table-scroll"); const t=el("table","matrix");
 // union of gradebook students + any attendance-only numbers (present in scans but no graded work)
 const gradeNums=new Set(s.students.map(st=>st.number).filter(Boolean));
 const extras=Object.keys(att.students).filter(n=>!gradeNums.has(n)).map(n=>({number:n,name:"",github:"",attOnly:true}));
 const all=s.students.concat(extras);
 const thead="<tr><th class='stu'>Student</th><th>#</th>"+dates.map(d=>"<th class='center'>"+esc(d.slice(5))+"</th>").join("")+"<th class='center'>Present</th></tr>";
 const rows=all.filter(st=>!q||(st.name||"").toLowerCase().includes(q)||(st.number||"").includes(q)||(st.github||"").toLowerCase().includes(q)).map(st=>{
  const a=att.students[st.number]; const present=new Set(a?a.present:[]);
  // roster students link into their profile; attendance-only extras have no profile
  const nm=esc(st.name||(st.attOnly?"(attendance only)":"(blank)"));
  const nameCell=st.attOnly?nm:"<a href='"+profileHref(s.key,skeyOf(st))+"'>"+nm+"</a>";
  let tds="<td class='stu'>"+nameCell+(st.github?" <span class='pill'>@"+esc(st.github)+"</span>":"")+"</td><td class='mut'>"+esc(st.number||"-")+"</td>";
  dates.forEach(d=>{tds+=present.has(d)?"<td class='attcell'><b>✓</b></td>":"<td class='attcell mut'>·</td>";});
  const cnt=a?a.count:0, pct=Math.round((cnt/dates.length)*100);
  // emphasize the at-risk students (warn), do NOT mute them - the muted cell was
  // inverted emphasis, dimming exactly the rows that need a look.
  tds+="<td class='center'>"+(pct<50?"<span class='badge' data-tone='warn'>"+cnt+"/"+dates.length+" · "+pct+"%</span>":cnt+"/"+dates.length+" <span class='pill'>"+pct+"%</span>")+"</td>";
  return "<tr>"+tds+"</tr>";
 }).join("");
 t.innerHTML=thead+rows; sc.append(t); card.append(sc); return card;
}

// ---- pipeline stage memory + shared drawer helpers (Phase D) ----
// Which pipeline steps have been FILED as intents, per section+activity. The
// pending-intents listing is the real trail, but the stage header needs a
// synchronous signal to choose the ONE contextual primary, so a successful Send
// records it here immediately. Monotonic per activity; cleared only by Reset.
const SENTKEY=isDemo()?"course-intent-sent-v1-demo":"course-intent-sent-v1";   // demo pipeline state stays out of the real one
// Same 2026-07-29 rename as the decisions key: without this, a pipeline mid-flight
// forgets which intents were already filed and the stage header offers the wrong
// contextual primary.
if(!isDemo()) adoptLegacy(SENTKEY,"hau-intent-sent-v1");
function sentMap(){ try{return JSON.parse(localStorage.getItem(SENTKEY)||"{}")}catch(e){return {}} }
function markSent(section,kind,aid){ try{const m=sentMap();m[section+"|"+kind+"|"+(aid||"")]=new Date().toISOString();localStorage.setItem(SENTKEY,JSON.stringify(m));}catch(e){} }
function wasSent(section,kind,aid){ return !!sentMap()[section+"|"+kind+"|"+(aid||"")]; }
function clearSent(section,aid){ try{const m=sentMap();const sfx="|"+(aid||"");for(const k of Object.keys(m))if(k.startsWith(section+"|")&&k.endsWith(sfx))delete m[k];localStorage.setItem(SENTKEY,JSON.stringify(m));}catch(e){} }

// transient status toast (bottom-centre): used for the review detail's otherwise
// silent approve-and-advance so the reviewer gets confirmation without a popup.
let toastTimer=null;
function toast(msg){
 let t=$("#toast"); if(!t){t=el("div");t.id="toast";document.body.append(t);}
 t.textContent=msg; t.dataset.on="true";
 clearTimeout(toastTimer); toastTimer=setTimeout(()=>{t.dataset.on="false";},1800);
}

// human label + relative age for a pending-intent listing entry
const INTENT_LABEL={"gen-feedback":"Generate feedback","apply-ai":"Apply reviewed grades","finalize":"Finalize & deliver","apply-grades":"Apply grades to Canvas","deliver":"Deliver to Canvas + workspaces","new-activity":"New activity scaffolds","manual-attendance":"Manual attendance"};
function relTime(iso){ const t=Date.parse(iso); if(isNaN(t))return""; const s=(Date.now()-t)/1000; if(s<90)return"just now"; if(s<5400)return Math.round(s/60)+" min ago"; if(s<172800)return Math.round(s/3600)+" h ago"; return Math.round(s/86400)+" d ago"; }

// one plain line in every prompt drawer about what the two buttons do. The
// console never writes grades: Send files an intent that a Claude Code session
// runs; Copy drops the same text into a chat. Neither changes anything until run.
const CONSEQUENCE="<p class='mut consequence' data-size='sm'><b>Send</b> files this as an intent in the teacher repo; run it in a Claude Code session (\"run pending intents\"). <b>Copy</b> pastes the same prompt into a chat instead. Neither writes anything until you run it.</p>";

// After a successful Send, swap the drawer's action row for a next-step card so
// the trail does not go cold: name the filed intent and the two things left to do.
function nextStepCard(path){
 const host=$("#actRow"); if(!host)return;
 host.innerHTML="<div class='card nextstep' data-pad='sm'><h4 style='margin:0 0 var(--space-1)'>Filed ✓</h4>"+
  "<p class='mut' data-size='sm'>Saved as <span class='mono'>"+esc(path.split("/").pop())+"</span> in gradebook/intents/.</p>"+
  "<ol class='status-list nextstep__steps'>"+
   "<li class='status-list__item'><span class='status-list__mark'>1</span><span class='status-list__title'>In a Claude Code session in the teacher repo, <b>run pending intents</b>.</span></li>"+
   "<li class='status-list__item'><span class='status-list__mark'>2</span><span class='status-list__title'>Come back and hit <b>Refresh</b> (↻) to see the result.</span></li>"+
  "</ol></div>";
}
// standard onSent for a prompt drawer: remember the step, refresh the pending list,
// and show the next-step card in place of the Send/Copy row.
function drawerSent(s,path,kind,aid){ markSent(s.section,kind,aid); invalidateIntents(s.key); nextStepCard(path); }

// ================= AI REVIEW =================
function heldActs(s){return s.assignments.filter(a=>a.aiGraded)}
function reviewRows(s,aid){return s.students.filter(st=>st.activities[aid]).map(st=>({st,r:st.activities[aid],dec:getDec(s.section,aid,skeyOf(st))}))}
// ---- delivery state read from the REPO, not from this browser ----------------
// The stage header used to run purely off localStorage (wasSent), so a cleared
// store, a second machine, or a delivery run outside the console left every step
// looking undone - and the Finalize button happily re-filed an intent for work
// already shipped. These three read ground truth instead:
//   written   - the reviewed score is IN grades.csv (aiScore), i.e. an apply ran
//   delivered - assignments.json says publish:true AND scores are written; that
//               flag is only ever flipped by a finalize run, so it is the closest
//               proxy the browser has for "students and Canvas have this"
//   conflicts - this browser's decision disagrees with what is already written,
//               which is exactly how a stale local override (84) can overwrite a
//               deliberate redraft (92) if it gets re-filed as an intent
const writtenRows=rows=>rows.filter(x=>x.r.aiScore!=null);
function isApplied(rows){
 const w=writtenRows(rows); if(!w.length) return false;
 const cleared=rows.filter(x=>isDecided(x.dec)&&x.dec.status!=="flag");
 return cleared.length?cleared.every(x=>x.r.aiScore!=null):true;
}
const isDelivered=(a,rows)=>!!a.publish&&writtenRows(rows).length>0;
const conflictRows=rows=>rows.filter(x=>x.r.aiScore!=null&&finalScore(x)!=null&&finalScore(x)!==x.r.aiScore);
// decision-state -> product badge tone (hue is the documented monochrome exception).
// "override" gets its own tone (accent), NOT held: "held" is reserved for the AI
// lane (an activity kind), so a review decision must never wear that same purple.
const TONE={todo:"muted",ok:"good",ov:"ov",fl:"warn"};
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
 acts.forEach(a=>{const rows=reviewRows(s,a.id);const done=rows.filter(isSettled).length;
  // A delivered activity is marked from the REPO (publish:true + scores written),
  // not from this browser's decision store, so the mark survives a different
  // machine, a cleared localStorage, and a delivery run outside the console.
  const dlv=isDelivered(a,rows);
  const b=el("a","tab",esc(a.id)+" <span class='pill'>"+done+"/"+rows.length+"</span>"+(dlv?" <span class='badge' data-tone='good' title='publish:true and reviewed scores are written to grades.csv'>delivered</span>":""));
  b.href=classHref(s.key,"review")+"/"+encodeURIComponent(a.id);if(revAct===a.id){b.dataset.active="true";b.setAttribute("aria-current","page");}sub.append(b)});
 w.append(sub);
 const rows=reviewRows(s,revAct);
 // rows settled by the gradebook alone (a score is written, this browser holds no
 // decision) - the tally and meter show them separately so "reviewed" never
 // implies a decision that was actually made somewhere else.
 const wrOnly=rows.filter(x=>!isDecided(x.dec)&&x.r.aiScore!=null).length;
 const done=rows.filter(isSettled).length, appr=rows.filter(x=>x.dec&&x.dec.status==="approve").length, ov=rows.filter(x=>x.dec&&x.dec.status==="override").length, fl=rows.filter(x=>x.dec&&x.dec.status==="flag").length;
 // ---- stage header: Generate -> Review -> Apply -> Deliver (Phase D1) ----
 // The AI Review lane is a strict state machine; expose it as a stepper with ONE
 // contextual primary and everything else in an overflow menu, instead of five
 // always-enabled buttons.
 const pending=rows.filter(x=>!x.r.note).length;   // submissions with no note draft yet
 const notReviewed=rows.length-done;
 const empty=rows.length===0;
 const applySent=wasSent(s.section,"apply-ai",revAct);
 const finSent=wasSent(s.section,"finalize",revAct);
 // repo truth beats the local decision store: a step the gradebook says is done
 // stays done even in a browser that never filed it.
 const actMeta=s.assignments.find(a=>a.id===revAct);
 const written=writtenRows(rows), applied=isApplied(rows), delivered=isDelivered(actMeta,rows);
 const conflicts=conflictRows(rows);
 let gen="todo",rev="todo",app="todo",del="todo";
 if(!empty){
  gen=pending>0?"active":"done";
  rev=(delivered||applied)?"done":(pending>0?"todo":(notReviewed>0?"active":"done"));
  app=(delivered||applied)?"done":((pending===0&&notReviewed===0)?(applySent?"done":"active"):"todo");
  del=delivered?"done":((applySent||applied)?(finSent?"done":"active"):"todo");
 }
 // the single contextual primary follows the active stage
 let primary=null;
 if(empty)primary=null;
 // Already delivered and nothing disagrees: offer no primary at all. Re-filing a
 // finalize intent here is how an already-shipped activity gets re-delivered from
 // a stale local decision. Finalize stays reachable in the overflow menu.
 else if(delivered&&!conflicts.length)primary=null;
 else if(delivered)primary={label:"Resolve "+conflicts.length+" gradebook conflict"+(conflicts.length===1?"":"s"),act:()=>go(detailHref(s.key,revAct,skeyOf(conflicts[0].st))),soft:true};
 else if(pending>0)primary={label:"Generate feedback → prompt",act:()=>showGenFeedback(s,revAct)};
 else if(notReviewed>0){const un=rows.find(x=>!isSettled(x));primary={label:"Review next → "+notReviewed+" left",act:()=>go(detailHref(s.key,revAct,skeyOf(un.st)))};}
 else if(!applySent&&!applied)primary={label:"Apply reviewed → prompt",act:()=>showApplyAI(s,revAct)};
 else primary={label:"Finalize → deliver",act:()=>showFinalize(s,revAct),soft:finSent};
 const STEPS=[["Generate",gen],["Review",rev],["Apply",app],["Deliver",del]];
 const stepper="<ol class='stepper'>"+STEPS.map(([l,st],i)=>"<li class='stepper__step' data-state='"+st+"'"+(st==="active"?" aria-current='step'":"")+"><span class='stepper__dot'>"+(st==="done"?"✓":i+1)+"</span><span class='stepper__label'>"+l+"</span></li>").join("")+"</ol>";
 const badges='<span class="badge" data-tone="good">'+appr+' approved</span> <span class="badge" data-tone="held">'+ov+' override</span> <span class="badge" data-tone="warn">'+fl+' flagged</span>';
 const sentHint=applySent&&!finSent?" <span class='mut' data-size='sm'>· apply intent filed, run it then finalize</span>":"";
 // Ground-truth line: what the REPO says, next to what this browser thinks.
 const truthLine=(delivered||written.length)
  ? "<p class='mut' data-size='sm'>Gradebook: <b>"+written.length+"/"+rows.length+"</b> reviewed score"+(written.length===1?"":"s")+" written to <span class='mono'>grades.csv</span>"+
    (delivered
      ? " · <span class='badge' data-tone='good'>delivered</span> <span class='mono'>publish: true</span> in assignments.json, so students and Canvas already have this - finalize again only to repair something"
      : (actMeta.publish?" · <span class='mono'>publish: true</span>":" · not published yet"))+"</p>"
  : "";
 const conflictLine=conflicts.length
  ? "<p class='warnline'><b>"+conflicts.length+" row"+(conflicts.length===1?"":"s")+" disagree with the gradebook.</b> This browser's decision is not what is written in <span class='mono'>grades.csv</span>"+
    (delivered?" and already delivered":"")+": "+conflicts.slice(0,3).map(x=>esc(x.st.name||x.r.repo)+" local "+finalScore(x)+" vs written "+x.r.aiScore).join(", ")+(conflicts.length>3?", …":"")+
    ". Filing an intent now would push the local number over the written one - check which is right first.</p>"
  : "";
 const overflow="<details class='ovmenu'><summary class='btn' data-size='sm' data-variant='soft' aria-label='More review actions'>⋯</summary>"+
  "<div class='ovmenu__list' role='menu'>"+
   "<button class='ovmenu__item' id='genFb' role='menuitem'>Generate feedback → prompt</button>"+
   "<button class='ovmenu__item' id='applyAI' role='menuitem'>Apply reviewed → prompt</button>"+
   "<button class='ovmenu__item' id='finalize' role='menuitem'>Finalize → deliver</button>"+
   "<button class='ovmenu__item' id='apprAll' role='menuitem'>Approve all unreviewed…</button>"+
   "<button class='ovmenu__item ovmenu__item--danger' id='reset' role='menuitem'>Reset decisions…</button>"+
  "</div></details>";
 const bar=el("div","card"); bar.dataset.pad="sm"; bar.dataset.surface="review:stage"; const pct=rows.length?Math.round(done/rows.length*100):0;
 bar.innerHTML=stepper+
  "<div class='revbar'>"+
   // the tally counts saved decisions PLUS rows the gradebook already holds a score
   // for, so a delivered activity reads "reviewed 20/20" in a browser that never
   // decided one of them. Name the second source when it is carrying the count,
   // otherwise four ticked steps over "reviewed 0/20" reads as a contradiction.
   "<div class='revbar__info'><b>"+esc(revAct)+"</b> · reviewed <b>"+done+"/"+rows.length+"</b>"+(wrOnly?" <span class='mut' data-size='sm'>("+wrOnly+" from the gradebook, not this browser)</span>":"")+" · "+badges+sentHint+"</div>"+
   "<div class='revbar__act'>"+(primary?"<button class='btn' data-size='sm'"+(primary.soft?" data-variant='soft'":"")+" id='rvPrimary'>"+esc(primary.label)+"</button>":"")+overflow+"</div>"+
  "</div>"+
  truthLine+conflictLine+
  // the progress meter shows the decision MIX, not just a single reviewed bar:
  // approved / override / flagged segments, then the rows settled by the gradebook
  // alone (the rest is the unreviewed remainder).
  '<div class="meter" role="meter" aria-label="Reviewed '+done+' of '+rows.length+'" aria-valuenow="'+done+'" aria-valuemin="0" aria-valuemax="'+rows.length+'">'+
   [[appr,"good"],[ov,"ov"],[fl,"warn"],[wrOnly,"muted"]].map(([n,t])=>n>0?'<span class="meter__seg" data-tone="'+t+'" style="--seg:'+(n/rows.length*100)+'%"></span>':"").join("")+
  '</div>';
 w.append(bar);
 // queue table
 const card=el("div","card"); card.dataset.pad="sm"; card.dataset.surface="review:queue"; card.append(el("h2","card__title","Review queue - click a row to read the feedback and decide"));
 const scr=el("div","table-scroll"); const t=el("table","table");
 const max=s.assignments.find(a=>a.id===revAct).totalPoints;
 t.innerHTML="<tr><th>Student</th><th>#</th><th class='center'>Proposed</th><th class='center'>AI-authored likelihood</th><th class='center'>Decision</th><th class='center' title='The reviewed score actually written to grades.csv'>Gradebook</th><th class='center'>Final</th></tr>"+
 rows.map(row=>{
   const stt=decStatus(row), fin=finalScore(row);
   const flag=row.r.aiFlag||"-"; const fl=/high/i.test(flag)?"bad":/medium/i.test(flag)?"warn":"good";
   const skey=esc(skeyOf(row.st));
   // The written column is the anti-stale-override guard: when the gradebook holds
   // a different number than this browser decided, say so on the row instead of
   // silently preferring the local one at intent time.
   const wr=row.r.aiScore, clash=wr!=null&&fin!=null&&fin!==wr;
   const wcell=wr==null
     ? "<span class='mut'>-</span>"
     : (clash?"<span class='badge' data-tone='warn' title='local decision "+fin+", written "+wr+"'>"+wr+"/"+max+"</span>":wr+"/"+max);
   return "<tr data-s='"+skey+"'><td><a href='"+detailHref(s.key,revAct,skeyOf(row.st))+"'>"+esc(row.st.name||"(blank)")+"</a>"+(row.r.triage?" <span class='badge' data-tone='warn' title='"+esc(row.r.triage)+"'>triage</span>":"")+"</td><td class='mut'>"+esc(row.st.number||"-")+"</td>"+
     "<td class='center'>"+(row.r.proposed!=null?row.r.proposed+"/"+max:"<span class='badge' data-tone='warn'>no score</span>")+"</td>"+
     "<td class='center'><span class='badge' data-tone='"+fl+"'>"+esc(flag.split(" - ")[0])+"</span></td>"+
     "<td class='center'><span class='badge' data-tone='"+TONE[stt.k]+"'>"+stt.l+"</span></td>"+
     "<td class='center'>"+wcell+"</td>"+
     "<td class='center tot'>"+(fin!=null?fin+"/"+max:"-")+"</td></tr>";
 }).join("");
 scr.append(t); card.append(scr); w.append(card);
 setTimeout(()=>{
   t.querySelectorAll("tr[data-s]").forEach(tr=>tr.onclick=e=>{ if(e.target.closest("a"))return; go(detailHref(s.key,revAct,tr.dataset.s)); });
   if(primary)$("#rvPrimary").onclick=primary.act;
   // never sweep a row the gradebook already settled into an approve: that would
   // manufacture a local decision to disagree with a written score later
   $("#apprAll").onclick=()=>{const t=rows.filter(row=>!isSettled(row)&&row.r.proposed!=null);if(!t.length){alert("No unreviewed submissions with a proposed score to approve.");return;}if(!confirm("Approve "+t.length+" unreviewed submission(s) at the AI's proposed score for "+revAct+"? This records an approve decision for each - review them individually to catch a bad proposal."))return;t.forEach(row=>setDec(s.section,revAct,skeyOf(row.st),Object.assign({},row.dec,{status:"approve"})));render()};
   $("#reset").onclick=()=>{if(confirm("Clear all decisions for "+revAct+"? This also clears the filed-step memory so the stage header restarts at Generate.")){rows.forEach(row=>setDec(s.section,revAct,skeyOf(row.st),null));clearSent(s.section,revAct);render()}};
   $("#genFb").onclick=()=>showGenFeedback(s,revAct);
   $("#applyAI").onclick=()=>showApplyAI(s,revAct);
   $("#finalize").onclick=()=>showFinalize(s,revAct);
   // close the overflow menu after any item click
   bar.querySelectorAll(".ovmenu__item").forEach(b=>b.addEventListener("click",()=>{const d=b.closest("details");if(d)d.open=false;}));
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
 const leftN=reviewRows(s,aid).filter(x=>!isSettled(x)).length;   // unsettled still in the queue
 const box=el("div"); w.append(box);
 // Keyboard nav: skip when focus is on an interactive control (INPUT/TEXTAREA/
 // SELECT/BUTTON) so an arrow press never navigates away and discards unsaved
 // textarea edits, and Enter on a focused button does its own thing. On the page
 // body: arrows page prev/next, Enter approves + advances, Esc goes back.
 detailKey=e=>{ if(e.target&&/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName))return;
  if(e.key==="Escape")go(back);
  else if(e.key==="ArrowRight"&&i<order.length-1)go(detailHref(s.key,aid,order[i+1]));
  else if(e.key==="ArrowLeft"&&i>0)go(detailHref(s.key,aid,order[i-1]));
  else if(e.key==="Enter"){ const ap=$("#dApprove"); if(ap){ e.preventDefault(); ap.click(); } } };
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
  // Collapse the media pane once we KNOW it is empty (no shots, and code fetched
  // and empty) so it does not own half the page with a placeholder. codeUnknown
  // means code is still loading, so keep the two-column layout until it resolves.
  const mediaEmpty=!hasShots&&!hasCode&&!codeUnknown;
  const mediaCol=mediaEmpty?"":
    "<div class='rvcol'>"+
     "<nav class='tab-bar'>"+
      "<button class='tab'"+(lv==='shots'?" data-active='true'":"")+" data-lv='shots'"+(hasShots?'':' disabled')+">Screenshots</button>"+
      "<button class='tab'"+(lv==='code'?" data-active='true'":"")+" data-lv='code'"+((hasCode||codeUnknown)?'':' disabled')+">Code"+(hasCode?" <span class='pill'>"+files.length+"</span>":"")+"</button>"+
     "</nav>"+
     "<div class='shots' id='lvShots' data-lightbox-group style='display:"+(lv==='shots'?'flex':'none')+"'>"+shotsHTML(shots)+"</div>"+
     "<div id='lvCode' style='display:"+(lv==='code'?'block':'none')+"'>"+codeHTML(files)+"</div>"+
    "</div>";
  box.innerHTML="<a class='mut' href='"+back+"'>← AI Review · "+esc(aid)+"</a>"+
   "<div class='rvhead' style='margin-top:var(--space-1)'><h1 style='margin:0'>"+esc(st.name||"(blank)")+"</h1>"+chip+
     "<div class='rvnav'><button class='btn' data-size='sm' data-variant='soft' id='prev'"+(i<=0?" disabled":"")+">← Prev</button>"+
     "<span class='cnt'>"+(i+1)+" / "+order.length+(leftN?" · "+leftN+" left":" · queue clear")+"</span>"+
     "<button class='btn' data-size='sm' data-variant='soft' id='next'"+(i>=order.length-1?" disabled":"")+">Next →</button></div></div>"+
   "<div class='muted'>"+esc(aid)+" · "+esc(sk)+" · @"+esc(st.github||"")+" · repo "+esc(r.repo)+"</div>"+
   "<div class='legend'><span>Automated: <b>"+r.raw+"</b></span><span>AI proposed: <b data-grade='grain'>"+(r.proposed!=null?r.proposed+"/"+max:"-")+"</b></span>"+(flag?"<span>AI-authored: <b data-grade='grain'>"+esc(flag)+"</b></span>":"")+"</div>"+
   "<div class='kbdlegend mut' data-size='sm'><kbd>←</kbd> <kbd>→</kbd> prev / next · <kbd>Enter</kbd> approve + advance · <kbd>Esc</kbd> back</div>"+
   "<div class='rev2'"+(mediaEmpty?" data-solo='true'":"")+">"+
    mediaCol+
    "<div class='rvcol'>"+
     "<div class='card' data-pad='sm' style='margin:0 0 var(--space-3)'>"+
      "<div class='decision'>"+
      "<button class='btn' data-size='sm' id='dApprove'>✓ Approve "+(r.proposed!=null?r.proposed+"/"+max:"")+"</button>"+
      "<span>Override <input id='dOv' class='field__input num' type='number' min='0' max='"+max+"' value='"+(curDec&&curDec.status==='override'?curDec.score:(r.proposed!=null?r.proposed:''))+"'> /"+max+" <button class='btn' data-size='sm' data-variant='soft' id='dOvBtn'>Set</button></span>"+
      "<button class='btn' data-size='sm' data-variant='soft' id='dFlag'>⚑ Flag</button>"+
      "<button class='btn' data-size='sm' data-variant='soft' id='dClear'>Clear</button></div>"+
      "<input class='field__input' id='dComment' style='width:100%;margin-top:var(--space-2)' placeholder='Private note to yourself (goes to the apply prompt)…' value='"+esc(curDec&&curDec.comment||"")+"'>"+
     "</div>"+
     "<label class='field'><span class='field__label'>Student-facing feedback <span class='mut'>- delivered as FEEDBACK.md, prose only</span>"+(curDec&&curDec.studentText!=null?" <span class='badge' data-tone='held'>edited</span>":"")+"</span>"+
     "<textarea id='dStudent' class='field__input fta' data-grade='"+(curDec&&curDec.studentText!=null?"smooth":"grain")+"' rows='10'>"+esc(curDec&&curDec.studentText!=null?curDec.studentText:orig.student)+"</textarea></label>"+
     "<label class='field'><span class='field__label'>Instructor-only notes <span class='mut'>- never delivered to the student</span>"+(curDec&&curDec.instructorText!=null?" <span class='badge' data-tone='held'>edited</span>":"")+"</span>"+
     "<textarea id='dInstr' class='field__input fta mono' rows='12'>"+esc(curDec&&curDec.instructorText!=null?curDec.instructorText:orig.instructor)+"</textarea></label>"+
     "<div style='display:flex;gap:var(--space-2);align-items:center;margin-top:var(--space-2)'><button class='btn' data-size='sm' id='dSave'>Save edits</button> <button class='btn' data-size='sm' data-variant='soft' id='dRevert'>Revert to AI text</button> <span class='mut' id='dSaved' style='font-size:12px'></span></div>"+
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
  // record the decision, confirm it in a toast (the advance is otherwise silent),
  // then move to the next submission (or repaint the last one in place)
  const save=v=>{setDec(s.section,aid,sk,v);const lbl=v.status==="approve"?"Approved":v.status==="override"?("Override "+v.score):v.status==="flag"?"Flagged":"Saved";const rem=reviewRows(s,aid).filter(x=>!isSettled(x)).length;toast(lbl+(rem?" · "+rem+" left":" · queue clear"));if(i<order.length-1)go(detailHref(s.key,aid,order[i+1]));else paint();};
  $("#dApprove").onclick=()=>save(collect(r.proposed!=null?{status:"approve"}:{status:"override",score:+$("#dOv").value}));
  $("#dOvBtn").onclick=()=>save(collect({status:"override",score:+$("#dOv").value}));
  $("#dFlag").onclick=()=>save(collect({status:"flag"}));
  $("#dClear").onclick=()=>{setDec(s.section,aid,sk,null);paint();};
  $("#dSave").onclick=()=>{const d=collect({});setDec(s.section,aid,sk,Object.keys(d).length?d:null);$("#dSaved").textContent="saved ✓";toast("Edits saved");const stt2=decStatus({dec:getDec(s.section,aid,sk)});const c=box.querySelector(".rvhead .badge");if(c){c.dataset.tone=TONE[stt2.k];c.textContent=stt2.l;}};
  $("#dRevert").onclick=()=>{$("#dStudent").value=orig.student;$("#dInstr").value=orig.instructor;const d=collect({});setDec(s.section,aid,sk,Object.keys(d).length?d:null);paint();};
 }
 paint();
}

function showGenFeedback(s,aid){
 const rows=reviewRows(s,aid);
 const pending=rows.filter(x=>!x.r.note);
 const noop=pending.length===0;   // nothing to draft (the prompt skips notes that exist)
 const txt=buildGenFeedback(s,aid);
 openDrawer("<h3>Generate AI feedback drafts - "+esc(aid)+"</h3><div class='muted'>"+pending.length+" submission(s) without a note yet · runs in a Claude Code session on your subscription (no GitHub Models)</div>"+
  (noop?"<p class='warnline'>Every submission already has a note draft, so this intent would do nothing (it skips repos that already have a note). Hit Refresh, or edit a draft from the review detail.</p>":"")+
  CONSEQUENCE+
  "<div id='actRow' style='margin:10px 0'><button class='btn' data-size='sm' id='send'"+(noop?" disabled":"")+">Send to repo →</button> <button class='btn' data-size='sm' data-variant='soft' id='cp'>Copy prompt</button>"+openInClaude("#ptxt",txt)+"</div><pre class='code-block prompt' id='ptxt'>"+esc(txt)+"</pre>");
 $("#cp").onclick=()=>navigator.clipboard.writeText(txt).then(()=>$("#cp").textContent="Copied ✓");
 if(!noop)wireSend(s,"gen-feedback",aid,txt,path=>drawerSent(s,path,"gen-feedback",aid));
}

// ---- bulk / fan-out actions (dashboard "all classes" + per-class quick actions) ----
// AI activities in one LOADED section that still have submissions without a note.
function pendingFeedback(s){ return heldActs(s).map(a=>({s,aid:a.id,pending:reviewRows(s,a.id).filter(x=>!x.r.note).length})).filter(it=>it.pending>0); }

// One human-readable prompt spanning many (section,activity) pending drafts, for
// the Copy / Open-in-Claude one-shot path (Send files individual gen-feedback
// intents instead). Grouped per teacher clone. UI-only: NOT an intent format.
function batchFeedbackPrompt(items){
 const byRepo=new Map();
 items.forEach(it=>{ if(!byRepo.has(it.s.repo))byRepo.set(it.s.repo,{s:it.s,acts:[]}); byRepo.get(it.s.repo).acts.push(it); });
 const total=items.reduce((n,it)=>n+it.pending,0);
 let out="# Generate AI feedback drafts - "+total+" pending across "+byRepo.size+" class(es)\n\n"+
  "For EACH teacher clone below: pull it, then for each listed activity turn every gradebook/notes-input/<id>/<repo>.md that has NO matching gradebook/notes/<id>/<repo>.md into a draft note, following that input file's embedded skeleton and output format EXACTLY (student-facing prose; then a line with only ---; then the instructor-only rubric breakdown, a \"Proposed total: N/<max>\" line, and the \"AI-authored likelihood\" line). Open any listed screenshots to judge design. DRAFTS ONLY - never write grades.csv, flip publish, publish to students, or push Canvas; skip repos that already have a note. Commit and push the new notes to each teacher repo when done.\n\n";
 for(const {s,acts} of byRepo.values()) out+="## "+s.subject+" section "+s.section+"\nWork from: "+workFrom(s)+"\n"+acts.map(it=>"- "+it.aid+" ("+it.pending+" without a draft)").join("\n")+"\n\n";
 return out;
}

// Drawer shared by the dashboard-all and per-class "Generate feedback" buttons.
// Send files one existing gen-feedback intent per activity (loops fileGenFeedback,
// no new schema); Copy / Open in Claude carry the combined prompt.
function showBulkFeedback(items,title,unloaded){
 const total=items.reduce((n,it)=>n+it.pending,0);
 const un=unloaded?"<p class='warnline'>"+unloaded+" class(es) not loaded - not included. Load them on the dashboard for full coverage.</p>":"";
 if(!total){ openDrawer("<h3>"+esc(title)+"</h3>"+un+"<p class='warnline'>No pending drafts: every AI submission already has a note. If you just ran a sweep, hit Refresh and try again.</p>"); return; }
 const txt=batchFeedbackPrompt(items);
 openDrawer("<h3>"+esc(title)+"</h3><div class='muted'>"+total+" submission(s) without a note across "+items.length+" activity/ies · runs in a Claude Code session (no GitHub Models)</div>"+un+CONSEQUENCE+
  "<div id='actRow' style='margin:10px 0'><button class='btn' data-size='sm' id='bfFile'>Send "+items.length+" intent(s) to repo(s) →</button> <button class='btn' data-size='sm' data-variant='soft' id='cp'>Copy prompt</button>"+openInClaude("#ptxt",txt)+"</div>"+
  "<div id='bfOut' class='mut' data-size='sm' style='margin-bottom:8px'></div>"+
  "<pre class='code-block prompt' id='ptxt'>"+esc(txt)+"</pre>");
 $("#cp").onclick=()=>navigator.clipboard.writeText(txt).then(()=>$("#cp").textContent="Copied ✓");
 $("#bfFile").onclick=async()=>{
  const b=$("#bfFile"); b.disabled=true; b.textContent="Filing…"; const out=$("#bfOut"); let ok=0,err=0;
  for(const it of items){
   try{ const p=await fileGenFeedback(it.s,it.aid); markSent(it.s.section,"gen-feedback",it.aid); invalidateIntents(it.s.key); out.innerHTML+="✓ "+esc(it.s.key)+" "+esc(it.aid)+" → "+esc(p.split("/").pop())+"<br>"; ok++; }
   catch(e){ out.innerHTML+="✗ "+esc(it.s.key)+" "+esc(it.aid)+": "+esc(e.message)+"<br>"; err++; }
  }
  b.textContent="Filed "+ok+(err?" · "+err+" failed":"")+" ✓ - run pending intents in a Claude Code session";
 };
}

// Grade sweep for one section (dry_run=false writes the gradebook, teacher-side).
async function quickGradeSweep(sc){
 const ok=await confirmExecute("run the grade sweep (writes the gradebook) on "+sc.key,sc.section);
 if(ok) runOp(sc,{file:"grade.yml",label:"Grade sweep",execDanger:"write the gradebook on "+sc.key},{dry_run:"false"},true,true);
}

// ---- dashboard fan-outs (all classes) ----
async function bulkGradeSweep(){
 const scs=sections(); if(!scs.length)return;
 const ok=await confirmExecute("run the grade sweep (writes the gradebook) on ALL "+scs.length+" classes",String(scs.length));
 if(!ok)return;
 for(const sc of scs) runOp(sc,{file:"grade.yml",label:"Grade sweep",execDanger:"write the gradebook on "+sc.key},{dry_run:"false"},true,true);
}
function bulkAudit(){
 const scs=sections(); const audits=[{file:"canvas-crosscheck.yml",label:"Canvas cross-check"},{file:"repo-coverage.yml",label:"Repo coverage"}];
 for(const sc of scs)for(const a of audits) runOp(sc,a,{},false);
}
function bulkFeedbackAll(){
 const scs=sections(); const loaded=scs.filter(sc=>sectionCached(sc.key));
 let items=[]; loaded.forEach(sc=>{ items=items.concat(pendingFeedback(sectionCached(sc.key))); });
 showBulkFeedback(items,"Generate feedback - all classes",scs.length-loaded.length);
}

function showApplyAI(s,aid){
 const rows=reviewRows(s,aid); const max=s.assignments.find(a=>a.id===aid).totalPoints;
 const {txt,decided,flagged,undone}=buildApplyAI(s,aid,rows);
 const noop=decided.length===0&&flagged.length===0;   // no approve/override/flag yet
 openDrawer("<h3>Apply reviewed AI grades - "+esc(aid)+"</h3><div class='muted'>"+decided.length+" to apply · "+flagged.length+" flagged · "+undone.length+" not reviewed</div>"+
  (noop?"<p class='warnline'>No decisions recorded yet. Approve, override, or flag at least one submission before applying (an empty apply would just blank every aiScore).</p>":"")+
  CONSEQUENCE+
  "<div id='actRow' style='margin:10px 0'><button class='btn' data-size='sm' id='send'"+(noop?" disabled":"")+">Send to repo →</button> <button class='btn' data-size='sm' data-variant='soft' id='cp'>Copy prompt</button>"+openInClaude("#ptxt",txt)+" <button class='btn' data-size='sm' data-variant='soft' id='csv'>Download CSV</button></div><pre class='code-block prompt' id='ptxt'>"+esc(txt)+"</pre>");
 $("#cp").onclick=()=>navigator.clipboard.writeText(txt).then(()=>$("#cp").textContent="Copied ✓");
 if(!noop)wireSend(s,"apply-ai",aid,txt,path=>drawerSent(s,path,"apply-ai",aid));
 $("#csv").onclick=()=>{
   const hdr="studentNumber,name,repo,proposed,decision,finalScore,max,comment\n";
   const body=rows.map(x=>{const fin=finalScore(x);const st=isDecided(x.dec)?x.dec.status:"unreviewed";return [x.st.number||"",'"'+(x.st.name||"").replace(/"/g,'""')+'"',x.r.repo,x.r.proposed==null?"":x.r.proposed,st,fin==null?"":fin,max,'"'+((x.dec&&x.dec.comment||"")).replace(/"/g,'""')+'"'].join(",")}).join("\n");
   const blob=new Blob([hdr+body],{type:"text/csv"});const u=URL.createObjectURL(blob);const a=el("a");a.href=u;a.download="ai-review-"+s.section+"-"+aid+".csv";a.click();URL.revokeObjectURL(u);
 };
}

function showFinalize(s,aid){
 const rows=reviewRows(s,aid);
 const {txt,delivered,heldOut}=buildFinalize(s,aid,rows);
 const noop=delivered.length===0;   // nothing cleared to deliver
 // Two repo-truth guards before this prompt goes anywhere. Both were paid for:
 // a re-filed finalize on an already-delivered activity, carrying two stale local
 // overrides that would have LOWERED grades the instructor had deliberately raised.
 const actMeta=s.assignments.find(a=>a.id===aid);
 const already=isDelivered(actMeta,rows);
 const clash=conflictRows(rows);
 openDrawer("<h3>Finalize and deliver - "+esc(aid)+"</h3><div class='muted'>"+delivered.length+" cleared to deliver · "+heldOut.length+" held out</div>"+
  (noop?"<p class='warnline'>No cleared students yet. Approve or override at least one submission (and apply those grades) before delivering.</p>":"")+
  (already?"<p class='warnline'><b>Already delivered.</b> <span class='mono'>"+esc(aid)+"</span> is flagged <span class='mono'>publish: true</span> and "+writtenRows(rows).length+" reviewed score"+(writtenRows(rows).length===1?" is":"s are")+" written to <span class='mono'>grades.csv</span>, so students and Canvas most likely already have this. Send again only to repair something specific.</p>":"")+
  (clash.length?"<p class='warnline'><b>"+clash.length+" score"+(clash.length===1?"":"s")+" in this prompt disagree with the gradebook:</b> "+clash.slice(0,3).map(x=>esc(x.st.name||x.r.repo)+" "+finalScore(x)+" vs written "+x.r.aiScore).join(", ")+(clash.length>3?", …":"")+". The prompt carries this browser's number. Confirm which is right before sending - a stale local override silently overwrites a deliberate redraft.</p>":"")+
  CONSEQUENCE+
  "<div id='actRow' style='margin:10px 0'><button class='btn' data-size='sm' id='send'"+(noop?" disabled":"")+">Send to repo →</button> <button class='btn' data-size='sm' data-variant='soft' id='cp'>Copy prompt</button>"+openInClaude("#ptxt",txt)+"</div><pre class='code-block prompt' id='ptxt'>"+esc(txt)+"</pre>");
 $("#cp").onclick=()=>navigator.clipboard.writeText(txt).then(()=>$("#cp").textContent="Copied ✓");
 if(!noop)wireSend(s,"finalize",aid,txt,path=>drawerSent(s,path,"finalize",aid));
}

function matrix(s){
 const card=el("div","card"); card.id="matrixcard";
 card.append(el("h2",null,"Gradebook - students × activities <span class='mut' style='font-weight:400'>(click a cell for feedback)</span>"));
 const leg=el("div","legend"); leg.style.padding="0 14px";
 leg.innerHTML='<span><span class="b push">push</span> auto-pushed to Canvas</span><span><span class="b held">held</span> AI proposal, review first</span><span><span class="b quiz">quiz</span> import to Canvas</span><span><span class="b manual">manual</span> hand-entered</span><span>cell = Canvas points / max</span>';
 card.append(leg);
 const sc=el("div","table-scroll"); const t=el("table","matrix");
 const cols=s.assignments;
 let thead="<tr><th class='stu'>Student</th><th>#</th>"+cols.map(a=>"<th class='center'>"+esc(a.id)+"<br><span class='pill'>"+(a.totalPoints!=null?a.totalPoints+"pt":a.autoPoints!=null?a.autoPoints+"pt":"tests")+"</span><br><span class='b "+a.kind+"'>"+a.kind+"</span></th>").join("")+"<th class='center'>Push total</th><th class='center'>+Held</th></tr>";
 const rows=s.students.filter(st=>!q||(st.name||"").toLowerCase().includes(q)||(st.number||"").includes(q)||(st.github||"").toLowerCase().includes(q)).map(st=>{
   let tds="<td class='stu' title='"+esc(st.name)+"'><a href='"+profileHref(s.key,skeyOf(st))+"'>"+esc(st.name||"(blank)")+"</a>"+(st.github?" <span class='pill'>@"+esc(st.github)+"</span>":"")+"</td><td class='mut'>"+esc(st.number||"-")+"</td>";
   cols.forEach(a=>{
     const r=st.activities[a.id];
     if(!r){tds+="<td class='cell mut'>·</td>";return;}
     const max=a.totalPoints ?? a.autoPoints ?? r.total;
     let disp,pct=null,cls="";
     if(r.kind==="held"){disp=(r.proposed!=null?r.proposed:"?")+"/"+max;pct=r.proposed!=null&&max?r.proposed/max:null;cls="held";}
     else if(r.kind==="manual"){disp="-";cls="manual";}
     else {disp=(r.canvasPts!=null?r.canvasPts:"?")+"/"+max;pct=r.canvasPts!=null&&max?r.canvasPts/max:null;cls="push";}
     tds+="<td class='cell "+cls+"' style='"+cellColor(pct)+"' tabindex='0' role='button' aria-label='"+esc((st.name||"")+" "+a.id+" feedback")+"' data-s='"+esc(st.number||st.name)+"' data-a='"+a.id+"'>"+disp+(r.late?" <span class=pill>late</span>":"")+"</td>";
   });
   tds+="<td class='center tot'>"+st.tally.push+"<span class='pill'>/"+st.tally.pushMax+"</span></td><td class='center mut'>"+(st.tally.held?"+"+st.tally.held+"/"+st.tally.heldMax:"-")+"</td>";
   return "<tr>"+tds+"</tr>";
 }).join("");
 t.innerHTML=thead+rows;
 sc.append(t); card.append(sc);
 setTimeout(()=>t.querySelectorAll("td.cell[data-a]").forEach(td=>{ const open=()=>openNote(s,td.dataset.s,td.dataset.a); td.onclick=open; td.onkeydown=e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); open(); } }; }),0);
 return card;
}

function openNote(s,skey,aid){
 const st=s.students.find(x=>(x.number||x.name)===skey); if(!st)return;
 const r=st.activities[aid]; if(!r)return;
 const a=s.assignments.find(x=>x.id===aid);
 const max=a.totalPoints ?? a.autoPoints ?? r.total;
 const val=r.kind==="held"?(r.proposed+"/"+max+" (held - review)"):r.kind==="manual"?"manual":(r.canvasPts+"/"+max);
 // split the note into its two labelled halves (wrapping, not clipped) and, for a
 // held/AI cell, offer the way into the full review detail instead of a dead end.
 const parts=parseNote(r.note);
 const reviewLink=a.aiGraded?"<div style='margin:var(--space-2) 0'><a class='btn' data-size='sm' data-variant='soft' href='"+detailHref(s.key,aid,skeyOf(st))+"'>Open in AI Review →</a></div>":"";
 const body=r.note?
   "<div class='notewrap'>"+
    (parts.student?"<section class='notehalf'><h4>Student-facing <span class='mut'>· prose only</span></h4><div class='noteprose'>"+esc(parts.student)+"</div></section>":"")+
    (parts.instructor?"<section class='notehalf notehalf--instr'><h4>Instructor-only <span class='badge' data-tone='held'>not shown to student</span></h4><div class='noteprose'>"+esc(parts.instructor)+"</div></section>":"")+
    (!parts.student&&!parts.instructor?"<div class='noteprose'>"+esc(r.note)+"</div>":"")+
   "</div>"
   :"<p class='mut'>No written feedback for this submission"+(a.aiGraded?" yet - generate a draft from AI Review.":".")+"</p>";
 openDrawer("<h3>"+esc(st.name)+" - "+esc(aid)+"</h3><div class='muted'>"+esc(st.number||"")+" · @"+esc(st.github||"")+" · repo "+esc(r.repo)+" @"+esc(r.sha)+"</div>"+
  "<div class='legend'><span>Automated: <b>"+r.raw+"</b></span><span>Canvas: <b>"+val+"</b></span></div>"+
  reviewLink+body);
}

function canvasPanel(s){
 const card=el("div","card");
 card.append(el("h2",null,"Canvas preview - what a push would do"));
 const bd=el("div","bd table-scroll");
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
 openDrawer("<h3>Apply-grades prompt - "+esc(s.section)+"</h3>"+CONSEQUENCE+"<div id='actRow' style='margin:10px 0'><button class='btn' data-size='sm' id='send'>Send to repo →</button> <button class='btn' data-size='sm' data-variant='soft' id='cp'>Copy</button>"+openInClaude("#ptxt",txt)+"</div><pre class='code-block prompt' id='ptxt'>"+esc(txt)+"</pre>");
 $("#cp").onclick=()=>{navigator.clipboard.writeText(txt).then(()=>{$("#cp").textContent="Copied ✓"})};
 wireSend(s,"apply-grades",null,txt,path=>drawerSent(s,path,"apply-grades",null));
}

// Deliver the section's DETERMINISTIC activities (auto-graded tests + quizzes) to
// student workspaces AND Canvas in one prompt. Mirrors the Finalize prompt's
// safety framing but WITHOUT aiScore gating - these scores are final, not held.
// AI/held activities are excluded on purpose (they flow through AI Review -> Finalize).
function showDeliver(s){
 const {txt,graded,pub}=buildDeliver(s,DATA.generatedAt);
 const noop=graded.length===0;   // nothing deterministic has graded students
 openDrawer("<h3>Deliver to Canvas + workspaces - "+esc(s.section)+"</h3><div class='muted'>"+graded.length+" deterministic activit(y/ies) to push · "+pub.length+" to publish to workspaces · AI/held + manual excluded</div>"+
  (noop?"<p class='warnline'>No deterministic activity has graded students yet, so there is nothing to deliver from here. (AI/held activities flow through AI Review → Finalize.)</p>":"")+
  CONSEQUENCE+
  "<div id='actRow' style='margin:10px 0'><button class='btn' data-size='sm' id='send'"+(noop?" disabled":"")+">Send to repo →</button> <button class='btn' data-size='sm' data-variant='soft' id='cp'>Copy prompt</button>"+openInClaude("#ptxt",txt)+"</div><pre class='code-block prompt' id='ptxt'>"+esc(txt)+"</pre>");
 $("#cp").onclick=()=>navigator.clipboard.writeText(txt).then(()=>$("#cp").textContent="Copied ✓");
 if(!noop)wireSend(s,"deliver",null,txt,path=>drawerSent(s,path,"deliver",null));
}

function toggleTheme(){const r=document.documentElement;const cur=r.getAttribute("data-color-scheme")|| (matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light");const next=cur==="dark"?"light":"dark";r.setAttribute("data-color-scheme",next);try{localStorage.setItem("grain-color-scheme",next);}catch(e){}/* persist to the same key theme-boot reads, so the choice survives a reload */render();}
function avg(a){const v=a.filter(x=>x!=null);return v.length?v.reduce((x,y)=>x+y,0)/v.length:null}
boot();
