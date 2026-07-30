// Review decisions (persisted in this browser). The storage key and the
// "sec|act|skey" dkey shape are a FROZEN CONTRACT with everyone's saved
// browser state - never rename either. It happened once anyway (hau-* ->
// course-*, 2026-07-29), which is what adoptLegacy below exists to repair; if a
// rename is ever unavoidable again, ship the adoption in the SAME commit.
// Node-importable (check-intents runs under Node), so localStorage access is
// guarded at load.
import { isDemo } from "./demo.mjs";

export const DKEY="course-grade-decisions-v1";
const LEGACY_DKEY="hau-grade-decisions-v1";   // pre-2026-07-29 name, see adoptLegacy
// Demo mode gets its own bucket: clicking through a synthetic review queue must
// never mix decisions into a real class's saved state (or vice versa).
const SKEY=isDemo()?DKEY+"-demo":DKEY;

// One-time adoption of a pre-rename storage key. The console's keys were renamed
// hau-* -> course-* on 2026-07-29, and a storage key is a frozen contract with
// everyone's saved browser state: without this, every browser that had saved
// review decisions reads empty and looks like it lost them. MERGES rather than
// copies (the legacy object underneath, the current one winning on conflict), so
// a browser that already saved a decision under the new name keeps it too, and
// leaves the legacy key in place as a backup. Persists only when it actually
// adopted something. Deletable after a term, once no browser can still be on the
// old key.
export function adoptLegacy(key,legacyKey){
 const read=k=>{ try{ return JSON.parse((globalThis.localStorage&&localStorage.getItem(k))||"{}") }catch(e){ return {} } };
 const cur=read(key);
 if(!legacyKey) return cur;
 const old=read(legacyKey);
 if(!Object.keys(old).length) return cur;
 const merged={...old,...cur};
 if(Object.keys(merged).length!==Object.keys(cur).length){ try{ localStorage.setItem(key,JSON.stringify(merged)) }catch(e){} }
 return merged;
}
// Demo mode has no legacy state to inherit: its key never existed before.
export let DEC=adoptLegacy(SKEY,isDemo()?null:LEGACY_DKEY);
export const dkey=(sec,act,skey)=>sec+"|"+act+"|"+skey;
export const getDec=(sec,act,skey)=>DEC[dkey(sec,act,skey)]||null;
export const setDec=(sec,act,skey,v)=>{const k=dkey(sec,act,skey);if(v)DEC[k]=v;else delete DEC[k];localStorage.setItem(SKEY,JSON.stringify(DEC));};
export const skeyOf=st=>st.number||st.name;
export const isDecided=d=>!!(d&&d.status);
// The final score a review row resolves to: override wins, approve = the AI's
// proposed score, flagged/unreviewed resolve to null (held out of delivery).
export function finalScore(row){ const d=row.dec; if(!d)return null; if(d.status==="override")return d.score; if(d.status==="approve")return row.r.proposed; return null; }

export function exportDecisions(){
  const n=Object.keys(DEC).length;
  if(!n&&!confirm("You have 0 saved decisions. Export an empty file anyway?"))return;
  const payload={_meta:{key:SKEY,exportedAt:new Date().toISOString(),count:n},decisions:DEC};
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));
  a.download="course-grade-decisions-"+new Date().toISOString().slice(0,10)+".json";
  a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
export function importDecisions(file,onDone){
  const rd=new FileReader();
  rd.onload=()=>{
    let obj; try{obj=JSON.parse(rd.result)}catch(e){alert("Not valid JSON: "+e.message);return}
    const inc=obj&&obj.decisions&&typeof obj.decisions==="object"?obj.decisions:(obj&&typeof obj==="object"&&!Array.isArray(obj)?obj:null);
    if(!inc){alert("No decisions object found in that file.");return}
    const keys=Object.keys(inc);
    if(!keys.length){alert("That file has 0 decisions.");return}
    if(!confirm("Import "+keys.length+" decision(s)? This MERGES into your current "+Object.keys(DEC).length+" (imported values win on conflicts)."))return;
    keys.forEach(k=>{DEC[k]=inc[k]});
    localStorage.setItem(SKEY,JSON.stringify(DEC));
    if(onDone)onDone();
    alert("Imported "+keys.length+" decision(s). Total now "+Object.keys(DEC).length+".");
  };
  rd.readAsText(file);
}
