// Intent prompt builders - the console's ONLY write vocabulary for anything
// touching grades, feedback, or delivery. Each builder returns the exact
// prompt text a Claude Code session executes in the teacher repo ("run
// pending intents"). BYTE-COMPAT CONTRACT: the apply-reviewed-grades and
// finalize-grades skills parse these formats - scripts/check-intents.mjs
// byte-compares every builder against golden fixtures, so any deliberate
// format change must update the fixtures (--update) AND the skills together.
// Extracted verbatim from app.mjs 2026-07-25; keep the text expressions as-is.
import { putIntent } from "./gh.mjs";
import { $ } from "./ui.mjs";
import { isDecided, finalScore } from "./decisions.mjs";

// where the prompts tell Claude Code to work from (the local clone convention)
export const workFrom=s=>"classes/"+s.repo+" (the local clone of github.com/"+s.org+"/"+s.repo+")";

// "Send to repo" on every prompt drawer: files the prompt as an Intent under
// gradebook/intents/ so a local "run pending intents" picks it up - no pasting.
// onSent(path, kind, aid) fires after a successful file, so the caller can record
// the pipeline step, invalidate the pending-intents cache, and show a next-step
// card. Optional - older call sites pass nothing and just see the "Sent" label.
export function wireSend(s,kind,aid,txt,onSent){
 const b=$("#send"); if(!b)return;
 b.onclick=async()=>{
  b.disabled=true; b.textContent="Sending…";
  const ts=new Date().toISOString().replace(/[-:]/g,"").replace(/\..+/,"").replace("T","-");
  const path="gradebook/intents/"+ts+"-"+kind+(aid?"-"+aid:"")+".md";
  const body=txt+"\n---\n_Filed by Course Console at "+new Date().toISOString()+". When this intent is done, move this file to gradebook/intents/done/ in the same commit as the changes._\n";
  try{ await putIntent(s.org,s.repo,path,body,":memo: console intent: "+kind+(aid?" "+aid:"")); b.textContent="Sent ✓ "+path.split("/").pop(); if(onSent)onSent(path,kind,aid); }
  catch(e){ b.disabled=false; b.textContent="Send to repo →"; alert("Sending failed: "+e.message); }
 };
}

// ---- the six builders (pure text; UI stays in the views) ----

export function buildGenFeedback(s,aid){
 const max=s.assignments.find(a=>a.id===aid).totalPoints;
 return (
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
"When done, COMMIT AND PUSH the new notes to the teacher repo. The hosted dashboard reads the repo live - I'll hit Refresh, review each draft and its proposed score, then Approve/Override/Flag there.\n");
}

export function buildApplyAI(s,aid,rows){
 const max=s.assignments.find(a=>a.id===aid).totalPoints;
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
 return {txt,decided,flagged,undone};
}

export function buildFinalize(s,aid,rows){
 const max=s.assignments.find(a=>a.id===aid).totalPoints;
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
 return {txt,delivered,heldOut};
}

export function buildApplyGrades(s,generatedAt){
 const held=s.assignments.filter(a=>a.aiGraded).map(a=>a.id);
 const rows=s.assignments.filter(a=>!a.aiGraded&&!a.manual).map(a=>{
   const rs=s.students.map(st=>st.activities[a.id]).filter(Boolean);
   return "  - "+a.id+": "+(a.totalPoints!=null?a.totalPoints+" pts":"raw tests")+", "+rs.length+" students graded";
 }).join("\n");
 return (
"# Apply grades to Canvas - "+s.subject+" (section "+s.section+")\n\n"+
"You are my grading assistant for the HAU platform. Apply the reviewed grades for this section to Canvas. Work from the teacher repo:\n"+
workFrom(s)+" - pull it first.\n\n"+
"## Rules (do not violate)\n"+
"- gradebook/grades.csv is the source of truth. Never hand-edit a grade.\n"+
"- These AI/held activities must NOT be auto-pushed - I review + publish them separately: "+(held.join(", ")||"(none)")+".\n"+
"- Dry-run first. Only execute on my explicit \"go\".\n\n"+
"## Steps\n"+
"1. Re-run a grade sweep only if submissions changed since "+new Date(generatedAt).toLocaleDateString()+"; otherwise use the current gradebook.\n"+
"2. Canvas push in CHECK mode for section "+s.section+" (tools/canvas-push.mjs --section="+s.section+" --check, or the Canvas push workflow in check mode). \n"+
"3. Show me the report: # grades, # students matched, per-activity counts, and ANY unmatched students or points-possible mismatches.\n"+
"4. Confirm it matches this expected preview (pushable activities only):\n"+rows+"\n"+
"5. On my \"go\", run the same command with --execute (workflow mode=execute).\n"+
"6. VERIFY: re-read the push report; confirm pushed count == matched students × pushable activities, no new unmatched, and spot-check 3 students' Canvas values against gradebook/grades.csv.\n\n"+
"## Reminder\nHeld activities ("+(held.join(", ")||"none")+") stay out of this push. To deliver those to students later: review gradebook/notes/, set \"publish\": true on the ready ones, and run publish.yml.\n");
}

export function buildDeliver(s,generatedAt){
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
"1. Re-run a grade sweep only if submissions changed since "+new Date(generatedAt).toLocaleDateString()+"; otherwise use the current gradebook.\n"+
"2. Student publish - DRY RUN first: publish.yml (publish=false), or tools/publish-grades.mjs "+s.section+" (dry-run by default). publish only ever delivers \"publish\": true activities, and it skips any AI student whose aiScore is blank - so this delivers exactly the deterministic publish:true activities above (plus any already-cleared AI students, which is fine). Show me the plan; confirm it lists those activities and their graded workspaces.\n"+
"3. On my \"go\": run the student publish for real (publish=true / --execute).\n"+
"4. Canvas push in CHECK mode: tools/canvas-push.mjs --section="+s.section+" --check. Show the report: # grades, # students matched, per-activity counts, and ANY unmatched students or points-possible mismatches. Confirm it matches the Canvas preview above and that NO held or manual activity appears (canvas-push holds AI activities and skips manual automatically).\n"+
"5. On my \"go\": re-run with --execute.\n"+
"6. VERIFY: pushed count == matched students x pushed activities; spot-check 2-3 students' Canvas values and their delivered GRADES.md/FEEDBACK.md against gradebook/grades.csv; confirm no held or manual activity was delivered.\n";
 return {txt,graded,pub};
}

// New-activity scaffold intent. NEW format (2026-07-25): no skill parses this
// yet, so it is NOT under the golden-fixture byte-compat gate - document
// changes in docs/commands.md instead.
export function buildNewActivity(s,a){
 const ai=!!a["ai-grading"], manual=!!a.manual;
 return (
"# New activity scaffolds - "+s.subject+" (section "+s.section+") - "+a.id+"\n\n"+
"I just added this entry to grader/assignments.json via the Course Console (already committed - pull first). Create the authoring scaffolds around it. Work from the teacher repo:\n"+
workFrom(s)+" - pull it first.\n\n"+
"## The committed entry\n```json\n"+JSON.stringify(a,null,2)+"\n```\n\n"+
"## Rules (do not violate)\n"+
"- Do NOT flip \"publish\": true and do NOT touch the gradebook - this intent only creates authoring scaffolds.\n"+
"- Do NOT create the Canvas assignment by hand: the canvas-sync-assignments workflow authors the Canvas shell FROM assignments.json (I run it from the console).\n"+
"- Follow ACTIVITY-AUTHORING.md (in this repo) and the platform standard docs/canvas-activities.md; keep the score rule \"automated tests, or the rubric if applicable\".\n\n"+
"## Steps\n"+
"1. Write grader/"+a.id+"/CANVAS.md - the Canvas assignment description body (what/why, how to submit"+(manual?" (submit:\""+(a.submit||"url")+"\" - students submit a link in Canvas, no repo)":" (students submit via the "+(a.namePrefix||a.id+"-")+"<section>-<handle> repo convention)")+", and the score rule).\n"+
(ai?"2. Write grader/"+a.id+"/RUBRIC.md following grader/RUBRIC-TEMPLATE.md, out of "+(a.totalPoints!=null?a.totalPoints:"the activity's")+" points, matching feedback flavor \""+(a.feedback||"code")+"\". Copy it into the activity template repo when that exists, and into existing student submission repos if any.\n":"")+
(manual?"":(ai?"3":"2")+". Scaffold the canonical tests in grader/"+a.id+"/ and the public activity template repo "+s.org+"/"+a.id+"-classcode-yourname per ACTIVITY-AUTHORING.md (starter + student-facing test copy + README + student.json + Autograde workflow), matching the class's existing "+String(a.type||"vitest")+" activities. Validate: the empty starter FAILS, a solution PASSES.\n")+
((manual?"2":(ai?"4":"3")))+". node --check / validate anything you wrote, commit as \":sparkles: "+a.id+" scaffolds\" and push. Report what was created and what still needs a human (e.g. Canvas due date + publish after the sync).\n");
}

export function buildManualAttendance(s,picked,date){
 const att=s.attendance||{students:{},sessionDates:[]};
 const already=picked.filter(x=>{const a=att.students[x.num];return a&&a.present&&a.present.includes(date)});
 return (
"# Manual attendance - "+s.subject+" (section "+s.section+") - "+date+"\n\n"+
"You are my course assistant for the HAU platform. Record teacher-attested manual attendance for this section. Work from the teacher repo:\n"+
workFrom(s)+" - pull it first.\n\n"+
"## Rules (do not violate)\n"+
"- Attendance session CSVs (attendance/sessions/<date>/*.csv) are the record; never edit the generated .md/summary.json by hand (verify-attendance rebuilds them).\n"+
"- Manual rows use the literal word manual in the signature column - verify-attendance counts them as present (MANUAL). Never fabricate a real HMAC signature.\n"+
"- MERGE, never overwrite: union by studentNumber; keep every existing row and timestamp.\n\n"+
"## Mark these students present on "+date+"\n"+
picked.map(x=>"- "+x.num+(x.name?" ("+x.name+")":"")).join("\n")+"\n\n"+
(already.length?"NOTE: already verified present on "+date+" per the current summary (skip them): "+already.map(x=>x.num).join(", ")+"\n\n":"")+
"## Steps\n"+
"1. In attendance/sessions/"+date+"/manual.csv (create the folder/file if needed, header timestamp,studentNumber,signature), append one row per listed student NOT already in any of that date's CSVs: \""+date+" 00:00:00,<studentNumber>,manual\".\n"+
"2. Commit as \":memo: Manual attendance "+date+" ("+picked.length+")\" and push.\n"+
"3. The push triggers the Verify attendance workflow (rebuilds the day summary, ATTENDANCE.md, summary.json; publish-attendance then delivers receipts automatically). Wait for it and confirm it is green.\n"+
"4. VERIFY: the listed students show as MANUAL in attendance/sessions/"+date+"/"+date+".md and appear with "+date+" in attendance/summary.json. Nothing may be FLAGGED by this change.\n");
}
