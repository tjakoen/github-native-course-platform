// Tiny DOM helpers + the typed-execute confirm dialog, shared by all views.
// Kept dependency-free and Node-importable (nothing touches the DOM at load).
export const $=(s,r=document)=>r.querySelector(s), el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e};
export const esc=s=>String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

// ---- shared side-sheet drawer (native <dialog>) ----
// The eight prompt/note drawers used to be plain <div> overlays: focus never
// entered them, Tab reached the page behind, Escape did nothing, and they
// survived route changes sitting over the wrong page. A native <dialog> opened
// with showModal() traps focus, makes Escape fire a 'cancel', and dims the rest
// via ::backdrop - the same pattern already proven in confirmExecute. innerHTML
// is everything after the close (×) button (a <h3> title + the body); the helper
// returns the inner panel (callers query it or use global $ by id) and a close().
// An optional guard() returning false blocks the close (first-run settings).
export function openDrawer(innerHTML, guard) {
  const d = document.createElement("dialog"); d.className = "drawer-modal";
  const p = document.createElement("div"); p.className = "dp";
  p.innerHTML = "<button class='x' type='button' aria-label='Close'>×</button>" + innerHTML;
  d.append(p); document.body.append(d);
  const close = () => { if (guard && guard() === false) return; try { d.close(); } catch (e) {} d.remove(); };
  p.querySelector(".x").onclick = close;
  d.addEventListener("cancel", e => { e.preventDefault(); close(); });   // Escape
  d.addEventListener("click", e => { if (e.target === d) close(); });     // click the dimmed backdrop
  d.showModal();
  return { panel: p, dialog: d, close };
}

// ---- typed execute confirm (native dialog) ----
export function confirmExecute(action, word){
 return new Promise(resolve=>{
  const d=document.createElement("dialog"); d.className="confirm-dialog";
  d.innerHTML="<h3>Execute: are you sure?</h3><p class='muted'>This will "+esc(action)+". Type <b>"+esc(word)+"</b> to confirm.</p>"+
   "<input class='field__input' id='ceWord' autocomplete='off'>"+
   "<div style='display:flex;gap:8px;margin-top:10px'><button class='btn' data-size='sm' id='ceOk' disabled>Execute</button><button class='btn' data-size='sm' data-variant='soft' id='ceNo'>Cancel</button></div>";
  document.body.append(d); d.showModal();
  const inp=d.querySelector("#ceWord"), ok=d.querySelector("#ceOk");
  inp.oninput=()=>{ ok.disabled=inp.value.trim()!==word; };
  ok.onclick=()=>{d.close();d.remove();resolve(true);};
  d.querySelector("#ceNo").onclick=()=>{d.close();d.remove();resolve(false);};
  d.addEventListener("cancel",()=>{d.remove();resolve(false);});
  inp.focus();
 });
}
