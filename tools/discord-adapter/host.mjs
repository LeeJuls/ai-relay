import {adapterConfig,parseCommand,hash,text} from './interaction.mjs';
import {openAdapterRuntime} from './runtime.mjs';
import {createPublisher} from './publisher.mjs';
import {createGateway,createGatewayDiscovery} from './gateway.mjs';
import {createRestRequest} from './rest.mjs';
import {createAcknowledger} from './ack.mjs';
import {RelayError} from '../../lib/errors.mjs';

export function openDiscordHostWithTransport({root,config,fetchImpl,socketFactory,authorization,sessionBroker,timers,now=Date.now,jitter=Math.random,locale='en',onGatewayReady=()=>{},resumePreparationId}){
 const cfg=adapterConfig(config);
 return openDiscordHost({root,config:cfg,sessionBroker,now,onGatewayReady,resumePreparationId,request:createRestRequest({channel_id:cfg.channel_id,fetchImpl,authorization}),acknowledge:createAcknowledger({fetchImpl,now,locale}),gatewayDeps:{socketFactory,authorization,discover:createGatewayDiscovery({fetchImpl,authorization}),timers,jitter}});
}

// Broker authorization is an integration trust boundary, not a readonly proof.
// A real broker MUST obtain a platform-enforced question/result-only capability.
// There is no private-pipe, environment discovery or prompt-only fallback here.
export async function openDiscordHost({root,config,request,acknowledge,sessionBroker,gatewayDeps,now=Date.now,onGatewayReady=()=>{},resumePreparationId}){
 const cfg=adapterConfig(config),timers=gatewayDeps?.timers;
 if([request,acknowledge,sessionBroker?.authorize,now,timers?.set,timers?.clear].some(f=>typeof f!=='function'))throw new RelayError('HOST_BINDING_REQUIRED');
 let runtime,closing=false,closed=false,fatal=false,pumping=Promise.resolve(),wake=null;const active=new Set();
 function bounded(action,ms,fallback){
  return new Promise(resolve=>{let settled=false;const finish=value=>{if(settled)return;settled=true;timers.clear(timer);resolve(value);};const timer=timers.set(()=>finish(fallback),ms);Promise.resolve().then(action).then(finish,()=>finish(fallback));});
 }
 function settle(record,result){if(record.resolve){record.resolve(result);record.resolve=null;}record.last=result;}
 async function flush(){
  for(const record of active){
   if(record.state!=='accepted'||!record.payload)continue;
   try{await runtime.submitResult({task_id:record.task_id,result_text:record.payload});record.state='saved';settle(record,{state:'accepted',code:'RESULT_SAVED'});active.delete(record);}
   catch{record.state='failed';settle(record,{state:'uncertain',code:'RESULT_STORAGE_UNCERTAIN'});active.delete(record);fatal=true;}
  }
 }
 async function scheduleNext(){
  if(wake!==null){timers.clear(wake);wake=null;}
  if(closing||closed||fatal)return;
  const due=await runtime.nextActionAt();if(due===null||closing||closed||fatal)return;
  wake=timers.set(()=>{wake=null;pump();},Math.max(1,due-now()));
 }
 function pump(){
  const run=async()=>{if(closing||closed||fatal)return;await runtime.tick();await flush();if(!fatal)await runtime.tick();await scheduleNext();};
  const next=pumping.then(run);pumping=next.catch(()=>{fatal=true;for(const record of active){record.state='failed';settle(record,{state:'uncertain',code:'HOST_UNCERTAIN'});}active.clear();});return pumping;
 }
 const session={async dispatch(request){
  if(closing||closed||fatal)return {state:'not_sent',code:'HOST_UNAVAILABLE'};
  const binding=await bounded(async()=>{const raw=await sessionBroker.authorize({route_id:cfg.route_id,session_address:cfg.session_address,scope:'readonly-question-result'});return raw?{route_id:raw.route_id,session_address:raw.session_address,dispatch:raw.dispatch}:null;},5000,null);
  if(closing||closed||!binding||binding.route_id!==cfg.route_id||binding.session_address!==cfg.session_address||typeof binding.dispatch!=='function')return {state:'not_sent',code:'ACCESS_UNVERIFIED'};
  const record={task_id:request.envelope.task,state:'dispatching',payload:null,digest:null,promise:null,resolve:null,last:null};active.add(record);
  function submitResult(input){
   if(closing||closed)return Promise.resolve({state:'not_sent',code:'RESULT_CHANNEL_CLOSED'});
   if(!input||Object.keys(input).join(',')!=='result_text'||!text(input.result_text)||input.result_text.replaceAll('@','@\u200b').length>1800||Buffer.byteLength(input.result_text.replaceAll('@','@\u200b'),'utf8')>4096)return Promise.resolve({state:'rejected',code:'INVALID_RESULT'});
   if(record.state==='failed')return Promise.resolve(record.last??{state:'uncertain',code:'DISPATCH_UNCERTAIN'});
   const digest=hash(input.result_text);if(record.digest!==null){if(record.digest!==digest)return Promise.resolve({state:'rejected',code:'RESULT_CONFLICT'});return record.promise;}
   record.payload=input.result_text;record.digest=digest;record.promise=new Promise(resolve=>{record.resolve=resolve;});pump();return record.promise;
  }
  const dispatch=binding.dispatch;
  const returned=await bounded(async()=>{const raw=await dispatch(structuredClone(request),{submitResult});return {state:raw?.state};},10000,{state:'uncertain'});
  const state=['accepted','not_sent','uncertain'].includes(returned?.state)?returned.state:'uncertain';
  if(state==='accepted'&&!closing&&!closed)record.state='accepted';
  else{record.state='failed';settle(record,{state:state==='not_sent'?'not_sent':'uncertain',code:'DISPATCH_UNCERTAIN'});active.delete(record);}
  return {state};
 }};
 runtime=await openAdapterRuntime({root,config:cfg,session,publisher:createPublisher({config:cfg,request,now}),now,recover:resumePreparationId===undefined});
 if(resumePreparationId!==undefined)try{await runtime.assertPreparedTrial(resumePreparationId);}catch(e){await runtime.close();throw e;}
 async function interaction(dispatch){
  if(closing||closed||fatal)return;
  const received=now(),parsed=parseCommand(dispatch,cfg,received);if(!parsed.accepted)return;
  const token=dispatch.d.token,id=dispatch.d.id;
  if(typeof token!=='string'||!/^[-A-Za-z0-9._]{1,512}$/.test(token))return;
  // Strip every other field, including the short-lived token, before storage.
  const sanitized={op:0,t:'INTERACTION_CREATE',d:{id,application_id:cfg.application_id,type:2,guild_id:cfg.guild_id,channel_id:cfg.channel_id,channel:{id:cfg.channel_id,type:0},member:{user:{id:cfg.owner_id}},data:{id:cfg.command_id,name:cfg.command,type:1,options:[{name:'text',type:3,value:parsed.request.envelope.body}]}}};
  const claimed=await runtime.receiveForAck(sanitized);if(claimed.state!=='ack_claimed')return;
  const deadline=Math.min(received+2500,Date.parse(parsed.request.envelope.createdAt)+2500),remaining=deadline-now();
  let state='not_sent';
  if(!closing&&remaining>0){const response=await bounded(async()=>{const raw=await acknowledge({interaction_id:id,token,deadline});return {state:raw?.state};},remaining,{state:'uncertain'});state=['accepted','not_sent','uncertain'].includes(response?.state)?response.state:'uncertain';if(now()>=deadline)state='uncertain';}
  await runtime.finishAcknowledgement({task_id:claimed.task_id,generation:claimed.generation,state});
  if(state==='accepted')await pump();
 }
 let resumed=false;
 const gateway=createGateway({...gatewayDeps,config:cfg,now,onInteraction:interaction,onReady:async()=>{if(resumePreparationId!==undefined&&!resumed){await runtime.resumePreparedTrial(resumePreparationId);resumed=true;}onGatewayReady();return pump();}});
 return Object.freeze({
  start:()=>gateway.start(),reconnect:()=>gateway.reconnect(),
  async stop(){await runtime.stop();await scheduleNext();},
  async drain(){await gateway.drain();await pumping;},
  async status(){return {gateway:gateway.status(),runtime:await runtime.status(),fatal,session_enforcement:'external-broker-unverified'};},
  async close(){if(closed)return;closing=true;if(wake!==null){timers.clear(wake);wake=null;}await gateway.close();for(const record of active){record.state='failed';settle(record,{state:'uncertain',code:'RESULT_CHANNEL_CLOSED'});}await gateway.drain();await pumping;await runtime.close();active.clear();closed=true;},
 });
}
