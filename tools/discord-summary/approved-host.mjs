import {createHash} from 'node:crypto';
import {snapshot,digest,validateApproval,fail} from './policy.mjs';
import {createSummaryClient} from './client.mjs';
import {createSummaryPublisher} from './publisher.mjs';
import {openSummaryBatch} from './batch.mjs';
export async function runApprovedSummaries({root,approved,expectedBindings,authorizations,permissionCheck,fetchImpl,now}){
 const a=snapshot(approved),binding=snapshot(expectedBindings);
 if(typeof now!=='function'||typeof permissionCheck!=='function'||typeof fetchImpl!=='function'||digest(a.bindings)!==digest(binding))fail('SUMMARY_APPROVAL_MISMATCH');
 const batch=validateApproval({expectedManifest:a.expectedManifest,bindings:a.bindings,summaries:a.summaries,now:now()});
 if(!a.body_sha256||Object.keys(a.body_sha256).sort().join(',')!=='claude,codex')fail('SUMMARY_APPROVAL_MISMATCH');
 for(const s of batch.summaries)if(a.body_sha256[s.slot]!==createHash('sha256').update(s.content,'utf8').digest('hex'))fail('SUMMARY_APPROVAL_MISMATCH');
 const deadline=Math.min(now()+180000,Date.parse(batch.manifest.expires_at));let runtime,publisher;
 const clients={},cached={},abort=new AbortController();let expired=false,timer;
 const expiration=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;abort.abort();reject(new Error('SUMMARY_DEADLINE'));},Math.max(0,deadline-now()));});void expiration.catch(()=>{});
 const guardedFetch=(url,options)=>{if(expired||abort.signal.aborted||now()>=deadline)fail('SUMMARY_DEADLINE');return fetchImpl(url,{...options,signal:options?.signal?AbortSignal.any([abort.signal,options.signal]):abort.signal});};
 try{
  for(const slot of ['claude','codex']){
   if(typeof authorizations?.[slot]!=='function')fail('SUMMARY_CLIENT_REQUIRED');
   const authorization=async()=>{if(expired||abort.signal.aborted||now()>=deadline)fail('SUMMARY_DEADLINE');if(cached[slot]===undefined){const value=await authorizations[slot]();if(expired||abort.signal.aborted||now()>=deadline)fail('SUMMARY_DEADLINE');cached[slot]=value;}return cached[slot];};
   const source=binding.sources[slot];
   const proof=await Promise.race([permissionCheck({guild_id:binding.guild_id,channel_id:binding.channel_id,required_denied_ids:binding.denied_channels,bot_id:source.bot_id,authorization,fetchImpl:guardedFetch,signal:abort.signal,timeout_ms:Math.max(1,Math.min(10000,deadline-now()))}),expiration]);
   if(proof?.isolated!==true||now()>=deadline)fail('SUMMARY_PERMISSION_REQUIRED');
   clients[slot]=createSummaryClient({bot_id:source.bot_id,channel_id:binding.channel_id,deadline_at:deadline,authorization,fetchImpl:guardedFetch,now});
  }
  publisher=createSummaryPublisher({expectedManifest:batch.manifest,bindings:binding,summaries:batch.summaries,botClients:clients,now});
  runtime=await openSummaryBatch({root,expectedManifest:batch.manifest,bindings:binding,summaries:batch.summaries,publisher,now,timers:{setTimeout:(fn,ms)=>setTimeout(fn,Math.max(0,Math.min(ms,deadline-now()))),clearTimeout}});
  return await runtime.run();
 }finally{clearTimeout(timer);abort.abort();await runtime?.close().catch(()=>{});await publisher?.close().catch(()=>{});await Promise.allSettled(Object.values(clients).map(c=>c.close()));for(const slot of Object.keys(cached))cached[slot]=undefined;}
}