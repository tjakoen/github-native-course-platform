// Tiny DOM helpers + the typed-execute confirm dialog, shared by all views.
// Kept dependency-free and Node-importable (nothing touches the DOM at load).
export const $=(s,r=document)=>r.querySelector(s), el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e};
export const esc=s=>String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

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
