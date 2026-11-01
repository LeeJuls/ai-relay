import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {absoluteRoot,directory,ownedPath,readJson,atomicJson,withWriter} from '../../lib/storage.mjs';
import {digest,snapshot,freeze,validateApproval,fail} from './policy.mjs';

// Unforgeable process-local capability, issued only after durable claim save.
// Restart loses this authority; the on-disk claim stays blocked for inspection.
const capabilities=new WeakMap();
export async function consumeSummaryClaim(claim){const capability=capabilities.get(claim);if(!capability||capability.used)return false;capability.used=true;try{return await capability.verify();}catch{return false;}}

export async function openSummaryStore({root,approvedBatch,io=fs}){
 root=absoluteRoot(root);
 const batch=validateApproval({expectedManifest:approvedBatch.manifest,bindings:approvedBatch.bindings,summaries:approvedBatch.summaries,now:Date.parse(approvedBatch.manifest.approved_at)});
 const binding=digest(batch),file='summary-ledger.json';let closed=false,ownedRun=null;
 const initial={schema:1,binding,trial_id:batch.bindings.trial_id,state:'prepared',run:null,rows:batch.summaries.map(s=>({slot:s.slot,summary_id:s.summary_id,dedup_key:s.dedup_key,state:'pending',quota:0,generation:null,code:null,message_id:null}))};
 const exact=(v,fields)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===fields.split(',').sort().join(',');
 function validate(s){
  if(!exact(s,'schema,binding,trial_id,state,run,rows')||s.run!==null&&(!exact(s.run,'id,started_at,deadline_at')||typeof s.run.id!=='string'||!Number.isFinite(s.run.started_at)||!Number.isFinite(s.run.deadline_at)))fail('SUMMARY_LEDGER_CORRUPT');
  if(!s||s.schema!==1||s.binding!==binding||s.trial_id!==initial.trial_id||!['prepared','active','finished','stopped','held'].includes(s.state)||!Array.isArray(s.rows)||s.rows.length!==2)fail('SUMMARY_LEDGER_CONFLICT');
  for(let i=0;i<2;i++){
   const row=s.rows[i],expected=initial.rows[i];
   if(!exact(row,'slot,summary_id,dedup_key,state,quota,generation,code,message_id')||row.slot!==expected.slot||row.summary_id!==expected.summary_id||row.dedup_key!==expected.dedup_key||!['pending','claimed','accepted','not_sent','held'].includes(row.state)||row.quota!==(row.state==='pending'?0:1))fail('SUMMARY_LEDGER_CORRUPT');
   if(row.state!=='pending'&&(typeof row.generation!=='string'||!/^[a-f0-9-]{36}$/.test(row.generation))||row.code!==null&&!['POSTED','REJECTED','IDENTITY_FAILED','UNCERTAIN','STOPPED','DEADLINE'].includes(row.code))fail('SUMMARY_LEDGER_CORRUPT');
   if(row.state==='accepted'?!/^\d{17,20}$/.test(row.message_id??''):row.message_id!==null)fail('SUMMARY_LEDGER_CORRUPT');
  }
  if(s.rows.filter(r=>r.state==='claimed').length>1||s.rows[1].state!=='pending'&&s.rows[0].state!=='accepted')fail('SUMMARY_LEDGER_CORRUPT');
  if(s.state==='active'&&(!s.run||typeof s.run.id!=='string'||!Number.isFinite(s.run.started_at)||!Number.isFinite(s.run.deadline_at)))fail('SUMMARY_LEDGER_CORRUPT');
  return s;
 }
 async function read(){return validate(await readJson(root,[file],{io,corrupt:'SUMMARY_LEDGER_CORRUPT'}));}
 async function transaction(action){if(closed)fail('SUMMARY_STORE_CLOSED');return withWriter(root,async()=>{const state=await read(),result=action(state);await atomicJson(await ownedPath(root,[file],io),state,{io});return freeze(snapshot(result));},io);}
 await directory(root,[],io);
 await withWriter(root,async()=>{const existing=await readJson(root,[file],{io,corrupt:'SUMMARY_LEDGER_CORRUPT'});if(existing)validate(existing);else{if((await io.readdir(root)).some(name=>name!=='.writer.lock'))fail('SUMMARY_FOREIGN_ROOT');await atomicJson(await ownedPath(root,[file],io),initial,{io});}},io);
 const requireRun=(s,id)=>{if(s.state!=='active'||s.run.id!==id||ownedRun!==id)fail('SUMMARY_INSPECTION_REQUIRED');};
 return {
  async beginRun({run_id,started_at,deadline_at}){
   if(typeof run_id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(run_id)||!Number.isFinite(started_at)||!Number.isFinite(deadline_at)||started_at<Date.parse(batch.manifest.approved_at)||deadline_at<=started_at||deadline_at>started_at+180000||deadline_at>Date.parse(batch.manifest.expires_at))fail('SUMMARY_RUN_INVALID');
   const result=await transaction(s=>{if(s.state!=='prepared')fail('SUMMARY_INSPECTION_REQUIRED');s.state='active';s.run={id:run_id,started_at,deadline_at};return {state:s.state};});ownedRun=run_id;return result;
  },
  async claimNext(run_id){const claim=await transaction(s=>{requireRun(s,run_id);if(s.rows.some(r=>r.state==='claimed'))fail('SUMMARY_INFLIGHT');const row=s.rows.find(r=>r.state==='pending');if(!row)fail('SUMMARY_FINISHED');row.state='claimed';row.quota=1;row.generation=randomUUID();return {run_id,summary_id:row.summary_id,generation:row.generation,summary:batch.summaries.find(x=>x.summary_id===row.summary_id)};});capabilities.set(claim,{used:false,verify:async()=>{if(closed||ownedRun!==run_id)return false;const s=await read();requireRun(s,run_id);const r=s.rows.find(r=>r.summary_id===claim.summary_id);return r?.state==='claimed'&&r.generation===claim.generation;}});return claim;},
  async recordOutcome(input){const c=snapshot(input);return transaction(s=>{requireRun(s,c.run_id);const row=s.rows.find(r=>r.summary_id===c.summary_id);if(!row||row.state!=='claimed'||row.generation!==c.generation)fail('SUMMARY_STALE_CLAIM');const o=c.outcome;if(!o||!['accepted','not_sent','held'].includes(o.state)||!['POSTED','REJECTED','IDENTITY_FAILED','UNCERTAIN','STOPPED','DEADLINE'].includes(o.code)||o.state==='accepted'&&!/^[0-9]{17,20}$/.test(o.message_id))fail('SUMMARY_OUTCOME_INVALID');row.state=o.state;row.code=o.code;row.message_id=o.state==='accepted'?o.message_id:null;if(o.state!=='accepted')s.state=o.state==='held'?'held':'stopped';else if(s.rows.every(r=>r.state==='accepted'))s.state='finished';return {state:s.state};});},
  async stop({run_id,reason}){if(!['STOPPED','DEADLINE','UNCERTAIN'].includes(reason))fail('SUMMARY_STOP_INVALID');return transaction(s=>{if(s.state==='active'){requireRun(s,run_id);for(const r of s.rows)if(r.state==='claimed'){r.state='held';r.code=reason;}s.state=s.rows.some(r=>r.state==='held')?'held':'stopped';}else if(s.state==='prepared')s.state='stopped';return {state:s.state};});},
  async status(){if(closed)fail('SUMMARY_STORE_CLOSED');const s=await read();return freeze({...snapshot(s),inspection_required:s.state==='active'&&ownedRun!==s.run.id||s.rows.some(r=>r.state==='held'),counts:{accepted:s.rows.filter(r=>r.state==='accepted').length,held:s.rows.filter(r=>['held','claimed'].includes(r.state)).length,not_sent:s.rows.filter(r=>r.state==='not_sent').length,not_attempted:s.rows.filter(r=>r.state==='pending').length}});},
  async close(){closed=true;ownedRun=null;}
 };
}
