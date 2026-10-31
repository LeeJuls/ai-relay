import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {absoluteRoot,ownedPath,readJson,atomicJson,withWriter} from '../../lib/storage.mjs';
import {validateMessage} from '../../lib/message.mjs';
import {RelayError} from '../../lib/errors.mjs';
import {adapterConfig,parseCommand,hash,text,snowflake} from './interaction.mjs';

const states=new Set(['queued','dispatch_claimed','transport_accepted','agent_reply_received','discord_publish_claimed','completed','held']);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const trialId=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
const checkpoint=l=>hash(JSON.stringify([l.tasks,l.dispatch_times]));
const terminal=l=>Object.values(l.tasks).every(t=>t.state==='completed'&&!t.inflight&&t.ack_state!=='held');
const resultOk=x=>text(x)&&x.replaceAll('@','@\u200b').length<=1800&&Buffer.byteLength(x.replaceAll('@','@\u200b'),'utf8')<=4096;
const fail=code=>{throw new RelayError(code);};

// One configured route, explicit ticks only. Real session enforcement belongs to
// the approved host binding; injection is never evidence of enforced readonly.
export async function openAdapterRuntime({root,config,session,publisher,now=Date.now,recover=true}){
 root=absoluteRoot(root);const cfg=adapterConfig(config),binding=hash(JSON.stringify(cfg));
 if(typeof session?.dispatch!=='function'||typeof publisher?.publish!=='function'||typeof now!=='function')fail('ADAPTER_REQUIRED');
 const clock=()=>{const at=now();if(!integer(at))fail('CLOCK');return at;};
 for(const name of ['config.json','inbox','runtime','mock-bridge.json']){
  try{await fs.lstat(await ownedPath(root,[name]));fail('NOT_ADAPTER_ROOT');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 const filename=()=>ownedPath(root,['discord-adapter.json']);
 function validate(l){
  try{
   if(!l||l.version!==1||l.mode!=='discord-adapter'||l.binding!==binding||l.root!==root||typeof l.stopped!=='boolean'||!integer(l.last_time)||!Array.isArray(l.dispatch_times)||l.dispatch_times.length>26||l.dispatch_times.some(n=>!integer(n))||!l.tasks||typeof l.tasks!=='object'||Array.isArray(l.tasks)||Object.keys(l.tasks).length>1000)throw Error();
   if(l.trials!==undefined){
    if(!Array.isArray(l.trials)||l.trials.length>32||new Set(l.trials.map(t=>t?.id)).size!==l.trials.length)throw Error();
    for(const [index,t]of l.trials.entries()){
     if(!t||!trialId(t.id)||!['prepared','active','closed'].includes(t.phase)||!integer(t.prepared_at)||t.prepared_at>l.last_time||t.expires_at!==t.prepared_at+900000||!/^([a-f0-9]{64})$/.test(t.checkpoint)||!integer(t.baseline_completed)||!integer(t.accepted)||t.accepted>2||t.max_requests!==2||t.window_ms!==180000)throw Error();
     if(index<l.trials.length-1&&t.phase!=='closed')throw Error();
     if(t.phase==='prepared'&&(t.started_at!==null||t.deadline_at!==null||t.closed_at!==null||t.accepted!==0||!l.stopped))throw Error();
     if(t.started_at!==null&&(!integer(t.started_at)||t.started_at<t.prepared_at||t.started_at>=t.expires_at||t.deadline_at!==t.started_at+180000))throw Error();
     if(t.started_at===null&&t.deadline_at!==null)throw Error();
     if(t.phase==='active'&&(t.started_at===null||t.closed_at!==null||l.stopped))throw Error();
     if(t.phase==='closed'&&(!integer(t.closed_at)||t.closed_at<Math.max(t.prepared_at,t.started_at??0)||t.closed_at>l.last_time))throw Error();
    }
   }
   let active=0,queued=0;
   for(const [id,t]of Object.entries(l.tasks)){
    if(!t||t.task_id!==id||!/^discord-task-[a-f0-9]{32}$/.test(id)||!states.has(t.state)||typeof t.inflight!=='boolean'||typeof t.body_pruned!=='boolean'||!integer(t.created_at)||!integer(t.updated_at)||t.created_at>t.updated_at||t.updated_at>l.last_time||!integer(t.retry_at)||!t.attempts||!t.outcomes||['dispatch','publish'].some(k=>!integer(t.attempts[k])||t.attempts[k]>2||![null,'accepted','not_sent','uncertain'].includes(t.outcomes[k])))throw Error();
    if(t.inflight)active++;if(t.state==='queued'&&!t.inflight)queued++;
    if(t.trial_id!==undefined&&(!trialId(t.trial_id)||!l.trials?.some(trial=>trial.id===t.trial_id)))throw Error();
    if(t.state!=='queued'&&t.state!=='completed'&&!t.inflight||t.state==='completed'&&t.inflight)throw Error();
    const key=JSON.parse(t.event_key);if(!Array.isArray(key)||key.length!==4||key[0]!==cfg.route_id||key[1]!==cfg.guild_id||key[2]!==cfg.channel_id||!snowflake(key[3])||id!=='discord-task-'+hash('task:'+t.event_key).slice(0,32))throw Error();
    if(t.target?.guild_id!==cfg.guild_id||t.target.channel_id!==cfg.channel_id||t.request?.route_id!==cfg.route_id||t.request.session_address!==cfg.session_address)throw Error();
    const env=t.request.envelope;
    if(!env||env.task!==id||env.id!==hash('relay:'+t.event_key).slice(0,32)||env.to!==cfg.session_address||env.from!=='discord-owner'||env.type!=='question'||env.wake!==true)throw Error();
    validateMessage(t.body_pruned?{...env,body:'[pruned]'}:env);
    if(!t.body_pruned&&(Buffer.byteLength(env.body,'utf8')>4096||t.digest!==hash(JSON.stringify([cfg.owner_id,cfg.command,env.body]))))throw Error();
    if(t.body_pruned&&(t.state!=='completed'||Object.hasOwn(env,'body')||t.result_text!==null))throw Error();
    if(t.result_text!==null&&(!resultOk(t.result_text)||hash(t.result_text)!==t.result_digest))throw Error();
    for(const effect of ['dispatch','publish']){const c=t[effect+'_claim'];if((c===null)!==(t.attempts[effect]===0)||c!==null&&(!c||typeof c.generation!=='string'||!c.generation||!integer(c.at)||c.at>t.updated_at))throw Error();}
    const hasResult=/^[a-f0-9]{64}$/.test(t.result_digest??'');
    if(![null,'claimed','accepted','held'].includes(t.ack_state)||(t.ack_state===null)!==(t.ack_claim===null)||t.ack_claim!==null&&(!t.ack_claim||typeof t.ack_claim.generation!=='string'||!t.ack_claim.generation||!integer(t.ack_claim.at)||t.ack_claim.at>t.updated_at)||['claimed','held'].includes(t.ack_state)&&(t.state!=='queued'||t.attempts.dispatch!==0))throw Error();
    if(!hasResult&&(t.result_digest!==null||t.result_text!==null)||hasResult&&t.result_text===null&&!t.body_pruned)throw Error();
    const dispatchOnly=()=>{if(hasResult||t.result_text!==null||t.attempts.publish!==0||t.outcomes.publish!==null||Object.hasOwn(t,'message_id'))throw Error();};
    switch(t.state){
     case 'queued':
      dispatchOnly();if(t.inflight!==(t.attempts.dispatch>0)||(t.attempts.dispatch===0?t.outcomes.dispatch!==null:t.attempts.dispatch!==1||t.outcomes.dispatch!=='not_sent'))throw Error();break;
     case 'dispatch_claimed':
      dispatchOnly();if(!t.dispatch_claim||t.outcomes.dispatch!==null)throw Error();break;
     case 'transport_accepted':
      dispatchOnly();if(!t.dispatch_claim||t.outcomes.dispatch!=='accepted')throw Error();break;
     case 'agent_reply_received':
      if(!hasResult||t.outcomes.dispatch!=='accepted'||!t.dispatch_claim||Object.hasOwn(t,'message_id')||t.attempts.publish>1||t.outcomes.publish!==(t.attempts.publish===0?null:'not_sent'))throw Error();break;
     case 'discord_publish_claimed':
      if(!hasResult||t.outcomes.dispatch!=='accepted'||!t.dispatch_claim||!t.publish_claim||t.outcomes.publish!==null||Object.hasOwn(t,'message_id'))throw Error();break;
     case 'completed':
      if(!hasResult||t.outcomes.dispatch!=='accepted'||t.outcomes.publish!=='accepted'||!t.dispatch_claim||!t.publish_claim||!snowflake(t.message_id))throw Error();break;
     case 'held':
      if(!['dispatch','publish'].includes(t.held_effect)||!t.dispatch_claim||Object.hasOwn(t,'message_id'))throw Error();
      if(t.held_effect==='dispatch')dispatchOnly();else if(!hasResult||t.outcomes.dispatch!=='accepted'||!t.publish_claim)throw Error();
      if(![null,'not_sent','uncertain'].includes(t.outcomes[t.held_effect])||t.outcomes[t.held_effect]==='not_sent'&&t.attempts[t.held_effect]!==2)throw Error();break;
    }
   }
   if(active>1||queued>8)throw Error();return l;
  }catch(e){throw new RelayError('CORRUPT_ADAPTER_LEDGER',{cause:e});}
 }
 const read=async()=>validate(await readJson(root,['discord-adapter.json'],{corrupt:'CORRUPT_ADAPTER_LEDGER'}));
 await withWriter(root,async()=>{
  const l=await readJson(root,['discord-adapter.json'],{corrupt:'CORRUPT_ADAPTER_LEDGER'});
  if(l===null)await atomicJson(await filename(),{version:1,mode:'discord-adapter',binding,root,stopped:false,last_time:clock(),dispatch_times:[],tasks:{}});
  else validate(l); // Reject binding mismatch before mutating interrupted claims.
 });
 let closed=false,fatal=false,transactions=Promise.resolve(),ticking=Promise.resolve();
 function transact(update,{maintain=true}={}){
  if(closed||fatal)return Promise.reject(new RelayError('ADAPTER_CLOSED'));
  const run=()=>withWriter(root,async()=>{
   const l=await read(),at=clock();if(at<l.last_time)fail('CLOCK');l.last_time=at;
   const day=Date.parse(new Date(at).toISOString().slice(0,10)+'T00:00:00.000Z');
   if(maintain)l.dispatch_times=l.dispatch_times.filter(n=>n>=Math.min(day,at-3600000));
   for(const [id,t]of Object.entries(l.tasks))if(maintain&&t.state==='completed'){
    if(at-t.updated_at>=86400000){delete t.request.envelope.body;t.result_text=null;t.body_pruned=true;}
    if(at-t.created_at>=604800000&&at-t.updated_at>=86400000)delete l.tasks[id];
   }
   const out=update(l,at);if(out?.then)fail('ASYNC_TRANSACTION');validate(l);await atomicJson(await filename(),l);return structuredClone(out);
  });
  const next=transactions.then(run);transactions=next.catch(()=>{});return next;
 }
 if(recover)await transact((l,at)=>{const trial=l.trials?.at(-1);if(trial?.phase==='active'){trial.phase='closed';trial.closed_at=at;l.stopped=true;}for(const t of Object.values(l.tasks)){if(t.ack_state==='claimed'){t.ack_state='held';t.updated_at=at;t.code='INTERRUPTED_ACK';}if(t.state==='dispatch_claimed'||t.state==='discord_publish_claimed'){t.held_effect=t.state==='dispatch_claimed'?'dispatch':'publish';t.state='held';t.updated_at=at;t.code='INTERRUPTED_CLAIM';}}},{maintain:false});
 function planAction(l,at){
  const tasks=Object.values(l.tasks).sort((a,b)=>a.created_at-b.created_at||a.task_id.localeCompare(b.task_id));
  if(tasks.some(t=>t.state==='held'||t.ack_state==='held'))return null;
  const t=tasks.find(t=>t.inflight)??tasks.find(t=>t.state==='queued'&&t.ack_state!=='claimed');if(!t)return null;
  const effect=t.state==='agent_reply_received'?'publish':t.state==='queued'&&!l.stopped?'dispatch':null;if(!effect)return null;
  const trial=l.trials?.at(-1);if(trial&&(trial.phase!=='active'||at>=trial.deadline_at||t.trial_id!==trial.id))return null;
  let due=Math.max(at,t.retry_at);
  if(effect==='dispatch'){
   const day=Date.parse(new Date(at).toISOString().slice(0,10)+'T00:00:00.000Z'),hour=l.dispatch_times.filter(n=>n>at-3600000).sort((a,b)=>a-b);
   if(hour.length>=6)due=Math.max(due,hour[hour.length-6]+3600000);
   if(l.dispatch_times.filter(n=>n>=day).length>=20)due=Math.max(due,day+86400000);
  }
  return {t,effect,due};
 }
 async function work(){
  const action=await transact((l,at)=>{
   const planned=planAction(l,at);if(!planned||planned.due>at)return null;const {t,effect}=planned;
   const generation=randomUUID();t.inflight=true;t.state=effect==='dispatch'?'dispatch_claimed':'discord_publish_claimed';t.attempts[effect]++;t[effect+'_claim']={generation,at};t.outcomes[effect]=null;t.updated_at=at;
   if(effect==='dispatch')l.dispatch_times.push(at);
   const request=effect==='dispatch'?t.request:{task_id:t.task_id,route_id:cfg.route_id,session_address:cfg.session_address,state:t.state,publish_claim:{generation},target:t.target,result_text:t.result_text};
   return {task_id:t.task_id,effect,generation,request};
  });
  if(!action)return;
  let outcome;try{const returned=await (action.effect==='dispatch'?session.dispatch(action.request):publisher.publish(action.request));outcome=returned?{state:returned.state,retry_at:returned.retry_at,message_id:returned.message_id}:null;}catch{outcome={state:'uncertain'};}
  if(!outcome||!['accepted','not_sent','uncertain'].includes(outcome.state)||action.effect==='publish'&&outcome.state==='accepted'&&!snowflake(outcome.message_id))outcome={state:'uncertain'};
  try{await transact((l,at)=>{
   const t=l.tasks[action.task_id];if(!t||t.state!==(action.effect==='dispatch'?'dispatch_claimed':'discord_publish_claimed')||t[action.effect+'_claim']?.generation!==action.generation)return;
   t.updated_at=at;t.outcomes[action.effect]=outcome.state;
   if(outcome.state==='accepted'){t.state=action.effect==='dispatch'?'transport_accepted':'completed';if(action.effect==='publish'){t.inflight=false;t.message_id=outcome.message_id;}}
   else if(outcome.state==='not_sent'&&t.attempts[action.effect]<2){t.state=action.effect==='dispatch'?'queued':'agent_reply_received';t.retry_at=Math.max(at+1000,integer(outcome.retry_at)?outcome.retry_at:0);}
   else{t.state='held';t.held_effect=action.effect;t.code=outcome.state==='not_sent'?'ATTEMPTS_EXHAUSTED':'EFFECT_UNCERTAIN';}
  });}catch(e){fatal=true;throw e;} // Claim remains durable: never act again after failed effect bookkeeping.
 }
 async function receive(dispatch,requireAck){
   if(closed||fatal)fail('ADAPTER_CLOSED');const item=parseCommand(dispatch,cfg,clock());if(!item.accepted)return {state:'rejected',code:item.code};
   return transact((l,at)=>{
    const old=l.tasks[item.task_id];if(old)return old.digest===item.digest?{state:'duplicate',task_id:item.task_id}:{state:'rejected',code:'EVENT_CONFLICT'};
    const trial=l.trials?.at(-1);
    if(trial){if(trial.phase!=='active'||l.stopped)return {state:'rejected',code:'TRIAL_NOT_ACTIVE'};if(at>=trial.deadline_at)return {state:'rejected',code:'TRIAL_WINDOW_CLOSED'};if(Date.parse(item.request.envelope.createdAt)<trial.started_at)return {state:'rejected',code:'TRIAL_OLD_EVENT'};if(trial.accepted>=2)return {state:'rejected',code:'TRIAL_REQUEST_LIMIT'};}
    if(Object.keys(l.tasks).length>=1000)return {state:'rejected',code:'RECORD_LIMIT'};
    if(Object.values(l.tasks).filter(t=>t.state==='queued'&&!t.inflight).length>=8)return {state:'rejected',code:'QUEUE_FULL'};
    const generation=requireAck?randomUUID():null;
    const {accepted,...entry}=item;l.tasks[item.task_id]={...entry,state:'queued',inflight:false,body_pruned:false,attempts:{dispatch:0,publish:0},outcomes:{dispatch:null,publish:null},ack_state:requireAck?'claimed':null,ack_claim:requireAck?{generation,at}:null,dispatch_claim:null,publish_claim:null,result_text:null,result_digest:null,created_at:at,updated_at:at,retry_at:0};
    if(trial){l.tasks[item.task_id].trial_id=trial.id;trial.accepted++;}
    return requireAck?{state:'ack_claimed',task_id:item.task_id,generation}:{state:'queued',task_id:item.task_id};
   });
 }
 function prepared(l,id,at){
  const trial=l.trials?.at(-1);if(!trial||trial.id!==id||trial.phase!=='prepared'||!l.stopped)fail('TRIAL_PREPARATION_REQUIRED');if(at>=trial.expires_at)fail('TRIAL_PREPARATION_EXPIRED');if(!terminal(l))fail('TRIAL_UNRESOLVED_WORK');if(checkpoint(l)!==trial.checkpoint)fail('TRIAL_CHECKPOINT_CHANGED');return trial;
 }
 return Object.freeze({
  prepareBoundedTrial(){return transact((l,at)=>{
   if(!l.stopped)fail('TRIAL_MUST_BE_STOPPED');if(!terminal(l))fail('TRIAL_UNRESOLVED_WORK');const previous=l.trials?.at(-1);
   if(previous?.phase==='active')fail('TRIAL_ALREADY_ACTIVE');if(previous?.phase==='prepared'&&at<previous.expires_at)return prepared(l,previous.id,at);
   if(previous?.phase==='prepared'){previous.phase='closed';previous.closed_at=at;}
   l.trials??=[];if(l.trials.length>=32)fail('TRIAL_RECORD_LIMIT');const trial={id:randomUUID(),phase:'prepared',prepared_at:at,expires_at:at+900000,checkpoint:checkpoint(l),baseline_completed:Object.values(l.tasks).filter(t=>t.state==='completed').length,accepted:0,max_requests:2,window_ms:180000,started_at:null,deadline_at:null,closed_at:null};l.trials.push(trial);return trial;
  },{maintain:false});},
  async assertPreparedTrial(id){await transactions;const l=await read();return structuredClone(prepared(l,id,clock()));},
  resumePreparedTrial(id){return transact((l,at)=>{const trial=prepared(l,id,at);trial.phase='active';trial.started_at=at;trial.deadline_at=at+180000;l.stopped=false;return trial;},{maintain:false});},
  receive:dispatch=>receive(dispatch,false),
  receiveForAck:dispatch=>receive(dispatch,true),
  finishAcknowledgement({task_id,generation,state}){
   if(!['accepted','not_sent','uncertain'].includes(state))return Promise.reject(new RelayError('INVALID_ACK'));
   return transact((l,at)=>{const t=l.tasks[task_id];if(!t||t.ack_state!=='claimed'||t.ack_claim.generation!==generation)return {state:'ignored'};t.ack_state=state==='accepted'?'accepted':'held';t.updated_at=at;return {state:t.ack_state};});
  },
  tick(){if(closed||fatal)return Promise.reject(new RelayError('ADAPTER_CLOSED'));const next=ticking.then(work);ticking=next.catch(()=>{});return next;},
  async nextActionAt(){if(closed||fatal)fail('ADAPTER_CLOSED');await transactions;const l=await read(),at=clock();if(at<l.last_time)fail('CLOCK');return planAction(l,at)?.due??null;},
  async submitResult(input){
   if(!input||Object.keys(input).sort().join(',')!=='result_text,task_id'||!/^discord-task-[a-f0-9]{32}$/.test(input.task_id)||!resultOk(input.result_text))fail('INVALID_RESULT');
   const {task_id,result_text}=input;
   return transact((l,at)=>{const t=l.tasks[task_id];if(!t)fail('UNKNOWN_TASK');const digest=hash(result_text);
    if(t.result_digest!==null){if(t.result_digest!==digest)fail('RESULT_CONFLICT');return {state:'duplicate'};}
    const trial=l.trials?.at(-1);if(t.trial_id!==undefined&&(!trial||trial.id!==t.trial_id||trial.phase!=='active'||at>=trial.deadline_at))fail('TRIAL_WINDOW_CLOSED');
    if(t.state!=='transport_accepted')fail('RESULT_NOT_EXPECTED');t.result_text=result_text;t.result_digest=digest;t.state='agent_reply_received';t.updated_at=at;t.retry_at=0;return {state:t.state};
   });
  },
  stop(){return transact((l,at)=>{l.stopped=true;const trial=l.trials?.at(-1);if(trial?.phase==='active'){trial.phase='closed';trial.closed_at=at;}},{maintain:false});},
  async status(){const l=await read(),tasks=Object.values(l.tasks),trial=l.trials?.at(-1);return {mode:'discord-adapter',stopped:l.stopped,queued:tasks.filter(t=>t.state==='queued'&&!t.inflight).length,inflight:tasks.filter(t=>t.inflight).length,held:tasks.filter(t=>t.state==='held'||t.ack_state==='held').length,completed:tasks.filter(t=>t.state==='completed').length,trial:trial?{...trial,completed:tasks.filter(t=>t.state==='completed'&&t.trial_id===trial.id).length}:null,actual_tokens:null,usage_measured:false};},
  async close(){await ticking;await transactions;closed=true;},
 });
}
