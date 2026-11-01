import {digest,snapshot,freeze,validateApproval,fail} from './policy.mjs';
import {consumeSummaryClaim} from './store.mjs';
import {isDefinitelyUnsent} from './client.mjs';

const held=()=>({state:'held',code:'UNCERTAIN'});
const notSent=(code='REJECTED')=>({state:'not_sent',code});
export function createSummaryPublisher({expectedManifest,bindings,summaries,botClients,now}){
 if(typeof now!=='function')fail('SUMMARY_CLOCK_REQUIRED');
 const batch=validateApproval({expectedManifest,bindings,summaries,now:now()});
 // Keep only the two explicitly supplied capabilities, never a token or loader.
 const clients={};for(const slot of ['claude','codex']){const c=botClients?.[slot];if(!c||!['verifyIdentity','request','close'].every(k=>typeof c[k]==='function'))fail('SUMMARY_CLIENT_REQUIRED');clients[slot]={verifyIdentity:c.verifyIdentity.bind(c),request:c.request.bind(c),close:c.close.bind(c)};}
 const outcomes=new Map(),busy=new Set(),controllers=new Set();let closed=false;
 return {
  async publish(input){
   let c,s;
   try{
    c=snapshot(input);s=batch.summaries.find(x=>x.summary_id===c.summary_id);
    if(!s||digest(s)!==digest(c.summary)||typeof c.run_id!=='string'||!c.run_id||typeof c.generation!=='string'||!c.generation)fail();
   }catch{return freeze(notSent());}
   if(outcomes.has(s.summary_id))return outcomes.get(s.summary_id);
   if(busy.has(s.summary_id))return freeze(held());
   if(closed||now()>=Date.parse(batch.manifest.expires_at))return freeze(notSent('STOPPED'));
   busy.add(s.summary_id);const controller=new AbortController();controllers.add(controller);
   let sent=false,result;
   try{
    if(!await consumeSummaryClaim(input)){result=notSent();return freeze(result);}
    const identity=snapshot(await clients[s.slot].verifyIdentity({signal:controller.signal}));
    if(identity.id!==s.bot_id||identity.bot!==true){result=notSent('IDENTITY_FAILED');return freeze(result);}
    if(closed||controller.signal.aborted||now()>=Date.parse(batch.manifest.expires_at)){result=notSent('STOPPED');return freeze(result);}
    const request={method:'POST',path:`/api/v10/channels/${s.channel_id}/messages`,timeout_ms:10000,max_response_bytes:65536,redirect:'error',automatic_retries:0,body:{content:s.content,nonce:s.nonce,enforce_nonce:true,allowed_mentions:{parse:[],replied_user:false}}};
    sent=true;
    const response=snapshot(await clients[s.slot].request(request,{signal:controller.signal}));
    if(closed||controller.signal.aborted){result=held();return freeze(result);}
    if(Number.isInteger(response.status)&&response.status>=400&&response.status<500){result=notSent();return freeze(result);}
    const b=response.body;
    if(response.status<200||response.status>=300||!Number.isInteger(response.status)||!b||typeof b.id!=='string'||!/^\d{17,20}$/.test(b.id)||b.channel_id!==s.channel_id||b.nonce!==s.nonce){result=held();return freeze(result);}
    result={state:'accepted',code:'POSTED',message_id:b.id};return freeze(result);
   }catch(error){result=sent&&!isDefinitelyUnsent(error)?held():notSent(sent?'REJECTED':'IDENTITY_FAILED');return freeze(result);}
   finally{busy.delete(s.summary_id);controllers.delete(controller);outcomes.set(s.summary_id,freeze(result??held()));}
  },
  async close(){if(closed)return;closed=true;for(const c of controllers)c.abort();await Promise.allSettled(Object.values(clients).map(c=>c.close()));}
 };
}
