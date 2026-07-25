// Tiny self-contained syntax highlighter (no external lib; local file:// safe).
// Moved verbatim out of app.mjs - the review Code pane's only styling source.
import { esc } from "./ui.mjs";
const HLKW=new Set("await async break case catch class const continue debugger default delete do else export extends false finally for from function if implements import in instanceof interface let new null of return super switch this throw true try typeof var void while with yield static get set public private protected abstract final dynamic bool int double num String List Map Widget build override late required as is enum mixin extension typedef on part show hide library".split(/\s+/));
export function hlCode(s){
 const re=/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\[\s\S]|[^`\\])*`|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)/g;
 let out="",last=0,m;
 while((m=re.exec(s))){ out+=esc(s.slice(last,m.index)); last=re.lastIndex;
  if(m[1])out+="<span class=tc>"+esc(m[1])+"</span>";
  else if(m[2])out+="<span class=ts>"+esc(m[2])+"</span>";
  else if(m[3])out+="<span class=tn>"+esc(m[3])+"</span>";
  else out+=(HLKW.has(m[4])?"<span class=tk>"+esc(m[4])+"</span>":esc(m[4])); }
 return out+esc(s.slice(last));
}
export function hlMarkup(s){
 const re=/(<!--[\s\S]*?-->)|(<\/?[A-Za-z][^>]*>)/g;
 let out="",last=0,m;
 while((m=re.exec(s))){ out+=esc(s.slice(last,m.index)); last=re.lastIndex;
  if(m[1])out+="<span class=tc>"+esc(m[1])+"</span>";
  else out+="<span class=tg>"+esc(m[2]).replace(/("[^"]*"|'[^']*')/g,x=>"<span class=ts>"+x+"</span>")+"</span>"; }
 return out+esc(s.slice(last));
}
export function hl(code,lang){ return /^(html?|xml|vue|svelte)$/.test(lang||"")?hlMarkup(String(code)):hlCode(String(code)); }
