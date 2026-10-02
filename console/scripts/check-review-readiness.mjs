// Synthetic grading regressions. No live grades, repositories or tokens are used.
import assert from 'node:assert/strict';
import {loadSection} from '../site/lib/gradebook.mjs';
import {buildApplyAI,buildFinalize} from '../site/lib/intents.mjs';
import {skeyOf} from '../site/lib/decisions.mjs';
const savedFetch=globalThis.fetch;
let seq=0;
async function fixture({collision=false,identity=true,proposal='14.5/20',receipt='8/8',truncated=false}={}){
 const org='SYNTHETIC',repo='teacher-demo-'+(++seq)+'-teacher',base='/repos/'+org+'/'+repo;
 const workspace='student-demo-0000-example';
 const policy=[{id:'m1a1',totalPoints:8,publish:true},{id:'m8a1','ai-grading':true,totalPoints:20,sourceSubpath:'project'}];
 const h='repo,assignment,studentNumber,fullName,githubAccount,passed,total,aiScore,notes,sha,gradedAt';
 const csv=h+'\nm1a1-0000-example,m1a1,10000001,Example Student,example,8,8,,,abcdef,2026-10-01\n';
 const entries=[{type:'blob',path:'gradebook/notes/m8a1/'+workspace+'.md',sha:'draft-'+seq},{type:'blob',path:'gradebook/notes-input/m8a1/'+workspace+'.md',sha:'input-'+seq}];
 if(collision)entries.push({type:'blob',path:'gradebook/notes-input/m8a1/student-demo-0000-second.md',sha:'input2-'+seq});
 const bodies=new Map([[base+'/contents/gradebook/grades.csv',csv],[base,JSON.stringify({default_branch:'main'})],[base+'/git/trees/main?recursive=1',JSON.stringify({tree:entries,truncated})],[base+'/git/blobs/draft-'+seq,'# Feedback\nUseful work.\n\n---\n**For the instructor:**\nProposed total: '+proposal+'\n'],[base+'/git/blobs/input-'+seq,'Deadline snapshot source'],['/repos/'+org+'/'+workspace+'/contents/student.json',identity?JSON.stringify({studentNumber:'10000001',fullName:'Example Student',githubAccount:'example'}):'{}'],['/repos/'+org+'/'+workspace+'/contents/GRADES.md','| m1a1 | '+receipt+' | |'],['/repos/'+org+'/student-demo-0000-second/contents/student.json',JSON.stringify({studentNumber:'10000001',fullName:'Second Workspace'})]]);
 globalThis.fetch=async url=>{const key=String(url).replace('https://api.github.com','');return new Response(bodies.get(key)??'',{status:bodies.has(key)?200:404});};
 return loadSection({org,repo,section:'0000',subject:'Demo',pol:policy});
}
try{
 let s=await fixture();let st=s.students[0],r=st.activities.m8a1;
 assert.equal(s.students.length,1);assert.equal(r.proposed,14.5);assert.equal(r.aiScore,null);assert.equal(r.graded,false);assert.equal(r.reviewOnly,true);assert.equal(r.inputAvailable,true);assert.equal(st.activities.m1a1.workspaceDelivered,true);
 console.log('ok finals drafts without CSV rows are visible, fractional, held, and joined by explicit identity');
 s=await fixture({receipt:'4/8'});assert.equal(s.students[0].activities.m1a1.workspaceDelivered,false);console.log('ok delivery compares current scores with workspace receipts');
 s=await fixture({identity:false});st=s.students.find(st=>st.activities.m8a1);assert.equal(st.activities.m8a1.proposed,null);assert.equal(st.activities.m8a1.identityUnresolved,true);assert.match(skeyOf(st),/^norepo:/);console.log('ok unresolved identities stay held with distinct review keys');
 s=await fixture({collision:true});const held=s.students.filter(st=>st.activities.m8a1);assert.equal(held.length,2);assert.equal(new Set(held.map(skeyOf)).size,2);assert(held.every(st=>st.activities.m8a1.identityUnresolved));console.log('ok duplicate workspaces cannot silently merge finals decisions');
 s=await fixture({proposal:'25/20'});r=s.students[0].activities.m8a1;assert.equal(r.proposed,null);assert(r.proposalIssue);s=await fixture({proposal:'15/100'});assert.equal(s.students[0].activities.m8a1.proposed,null);console.log('ok invalid proposals are held, never silently clamped or rescaled');
 await assert.rejects(fixture({truncated:true}),/truncated/);console.log('ok incomplete repository evidence fails visibly');
 s=await fixture();st=s.students[0];r=st.activities.m8a1;const applied=buildApplyAI(s,'m8a1',[{st,r,dec:{status:'approve'}}]);assert.equal(applied.decided.length,1);assert.match(applied.txt,/EVERY listed approved/);assert.match(applied.txt,/Preserve previously reviewed scores/);assert.match(applied.txt,/base64 notes/);assert.equal(buildApplyAI(s,'m8a1',[{st,r:{...r,identityUnresolved:true},dec:{status:'override',score:20}}]).decided.length,0);console.log('ok approved finals are written explicitly and earlier reviews are preserved');
 const finalize=buildFinalize(s,'m8a1',[{st,r:{...r,aiScore:14.5},dec:null}]);assert.equal(finalize.delivered.length,1);assert.match(finalize.txt,/no --only or --repo/);assert.match(finalize.txt,/--only=m8a1 --check/);assert.equal(buildFinalize(s,'m8a1',[{st,r,dec:{status:'approve'}}]).delivered.length,0);console.log('ok finalize requires recorded scores and preserves whole workspace grade tables');
}finally{globalThis.fetch=savedFetch;}
