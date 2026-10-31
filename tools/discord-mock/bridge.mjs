import { randomUUID } from 'node:crypto';
import { RelayError } from '../../lib/errors.mjs';
import { mockConfig,validateEvent,validateResult,formatPublish,digest } from './policy.mjs';

export async function openMockBridge({store,config,session,publisher,now=Date.now}) {
  config=mockConfig(config);
  if(!store?.transact||!store?.read||typeof session?.dispatch!=='function'||typeof publisher?.publish!=='function')throw new RelayError('MOCK_ADAPTER_REQUIRED');
  if((await store.read()).config_digest!==digest(config))throw new RelayError('MOCK_CONFIG_MISMATCH');
  await store.transact(l=>{
    for(const t of Object.values(l.tasks))if(['dispatch_claimed','discord_publish_claimed'].includes(t.state)){
      t.held_effect=t.state==='dispatch_claimed'?'dispatch':'publish';t.state='held';t.last_outcome='uncertain';t.code='INTERRUPTED_CLAIM';t.updated_at=now();
    }
  });
  let ticking=Promise.resolve();
  async function work(){
    const action=await store.transact(l=>{
      const tasks=Object.values(l.tasks).sort((a,b)=>a.created_at-b.created_at||a.task_id.localeCompare(b.task_id));
      if(tasks.some(t=>t.state==='held'))return null;
      const active=tasks.find(t=>t.inflight),t=active??tasks.find(t=>t.state==='queued');
      if(!t||t.next_attempt_at>now())return null;
      let effect;
      if(t.state==='agent_reply_received')effect='publish';
      else if(t.state==='queued'&&!l.stopped)effect='dispatch';
      else return null;
      if(effect==='dispatch'){
        const day=Date.parse(new Date(now()).toISOString().slice(0,10)+'T00:00:00.000Z');
        if(l.dispatch_attempts.filter(at=>at>now()-3600000).length>=config.hourlyDispatches||l.dispatch_attempts.filter(at=>at>=day).length>=config.dailyDispatches)return null;
      }
      const request=effect==='dispatch'?{route_id:config.route_id,session_address:config.session_address,envelope:t.envelope}:formatPublish(t,t.result,config);
      t.inflight=true;t.state=effect==='dispatch'?'dispatch_claimed':'discord_publish_claimed';
      const generation=randomUUID();t.attempts[effect]++;t[effect+'_claim']={generation,attempt:t.attempts[effect],at:now()};t.updated_at=now();
      if(effect==='dispatch')l.dispatch_attempts.push(now());
      return {task_id:t.task_id,effect,generation,request};
    });
    if(!action)return;
    let outcome;
    try{outcome=await (action.effect==='dispatch'?session.dispatch(action.request):publisher.publish(action.request));}
    catch{outcome={state:'uncertain',code:'MOCK_EXCEPTION'};}
    if(!outcome||!['accepted','not_sent','uncertain'].includes(outcome.state))outcome={state:'uncertain',code:'INVALID_EFFECT_RESULT'};
    const state=outcome.state,code=/^[A-Z_]{1,60}$/.test(outcome.code??'')?outcome.code:'MOCK_EFFECT_RESULT';
    await store.transact(l=>{
      const t=l.tasks[action.task_id],claimed=action.effect==='dispatch'?'dispatch_claimed':'discord_publish_claimed';
      if(!t||t.state!==claimed||t[action.effect+'_claim']?.generation!==action.generation)return;
      t.last_outcome=state;t.code=code;t.updated_at=now();
      if(state==='accepted'){
        t.state=action.effect==='dispatch'?'transport_accepted':'completed';if(action.effect==='publish')t.inflight=false;
      }else if(state==='not_sent'&&t.attempts[action.effect]<config.maxAttempts){
        t.state=action.effect==='dispatch'?'queued':'agent_reply_received';t.next_attempt_at=now()+config.retryMs;
      }else{
        t.state='held';t.held_effect=action.effect;if(state==='not_sent')t.code='ATTEMPTS_EXHAUSTED';
      }
    });
  }
  return Object.freeze({
    async ingest(event){
      const v=validateEvent(event,config,now());if(!v.accepted)return {state:'rejected',code:v.code};
      return store.transact(l=>{
        const old=l.events[v.ids.event_key];
        if(old)return old.digest===v.digest?{state:'duplicate',task_id:old.task_id}:{state:'rejected',code:'EVENT_CONFLICT'};
        if(Object.keys(l.tasks).length>=config.maxRecords)return {state:'rejected',code:'RECORD_LIMIT'};
        if(Object.values(l.tasks).filter(t=>t.state==='queued'&&!t.inflight).length>=config.maxQueue)return {state:'rejected',code:'QUEUE_FULL'};
        const t={...v.ids,envelope:v.envelope,target:v.target,digest:v.digest,state:'queued',inflight:false,attempts:{dispatch:0,publish:0},dispatch_claim:null,publish_claim:null,result:null,result_digest:null,held_effect:null,code:null,next_attempt_at:0,created_at:now(),updated_at:now(),body_pruned:false};
        l.tasks[t.task_id]=t;l.events[t.event_key]={task_id:t.task_id,digest:v.digest,expires_at:now()+config.dedupRetentionMs};
        return {state:'queued',task_id:t.task_id};
      });
    },
    tick(){const next=ticking.then(work);ticking=next.catch(()=>{});return next;},
    async submitResult(input){
      const {task_id,result_text}=validateResult(input,config);
      return store.transact(l=>{
        const t=l.tasks[task_id];if(!t)throw new RelayError('UNKNOWN_TASK');formatPublish(t,result_text,config);
        const result_digest=digest(result_text);
        if(t.result_digest!==null){if(t.result_digest!==result_digest)throw new RelayError('RESULT_CONFLICT');return {state:'duplicate'};}
        if(t.state!=='transport_accepted')throw new RelayError('RESULT_NOT_EXPECTED');
        t.result=result_text;t.result_digest=result_digest;t.state='agent_reply_received';t.updated_at=now();t.next_attempt_at=0;
        return {state:t.state};
      });
    },
    stop(){return store.transact(l=>{l.stopped=true;});},
    async status(){
      const l=await store.read(),ts=Object.values(l.tasks);
      return {mode:'mock',stopped:l.stopped,queued:ts.filter(t=>t.state==='queued'&&!t.inflight).length,inflight:ts.filter(t=>t.inflight).length,
        held:ts.filter(t=>t.state==='held').length,completed:ts.filter(t=>t.state==='completed').length,
        inspection_required:ts.filter(t=>t.state!=='completed'&&now()-t.updated_at>=config.bodyRetentionMs).length,
        dispatch_claims:ts.reduce((n,t)=>n+t.attempts.dispatch,0),publish_claims:ts.reduce((n,t)=>n+t.attempts.publish,0),actual_tokens:null,usage_measured:false};
    },
  });
}
