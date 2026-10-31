// Source-only REST boundary. request is supplied by the host; no default transport.
import {adapterConfig,hash,snowflake,text} from './interaction.mjs';
import {RelayError} from '../../lib/errors.mjs';

function build(task,cfg){
 if(!task||Object.keys(task).sort().join(',')!=='publish_claim,result_text,route_id,session_address,state,target,task_id'||!/^discord-task-[a-f0-9]{32}$/.test(task.task_id)||task.route_id!==cfg.route_id||task.session_address!==cfg.session_address||task.state!=='discord_publish_claimed'||!task.publish_claim||Object.keys(task.publish_claim).join(',')!=='generation'||typeof task.publish_claim.generation!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(task.publish_claim.generation)||!task.target||Object.keys(task.target).sort().join(',')!=='channel_id,guild_id'||task.target.guild_id!==cfg.guild_id||task.target.channel_id!==cfg.channel_id||!text(task.result_text))throw new RelayError('INVALID_PUBLISH');
 const content=task.result_text.replaceAll('@','@\u200b');
 if(content.length>1800||Buffer.byteLength(content,'utf8')>4096)throw new RelayError('OUTPUT_LIMIT');
 return {method:'POST',path:`/api/v10/channels/${cfg.channel_id}/messages`,body:{content,nonce:hash(task.task_id).slice(0,24),enforce_nonce:true,allowed_mentions:{parse:[],replied_user:false}},timeout_ms:10000,max_response_bytes:65536,redirect:'error',automatic_retries:0};
}
export function createPublisher({config,request,now=Date.now}){
 const cfg=adapterConfig(config);if(typeof request!=='function'||typeof now!=='function')throw new RelayError('ADAPTER_REQUIRED');
 let busy=false,held=false,blocked=false,cooldown=0;const accepted=new Set();
 return Object.freeze({async publish(task){
  if(held)return {state:'uncertain',code:'PUBLISH_HELD'};
  if(blocked)return {state:'not_sent',code:'AUTH_BLOCKED'};
  if(busy)return {state:'not_sent',code:'PUBLISH_BUSY'};
  const at=now();if(!Number.isSafeInteger(at)||at<0)return {state:'not_sent',code:'CLOCK'};
  if(at<cooldown)return {state:'not_sent',code:'COOLDOWN',retry_at:cooldown};
  let req;try{req=build(task,cfg);}catch{return {state:'not_sent',code:'INVALID_PUBLISH'};}
  if(accepted.has(task.task_id)){held=true;return {state:'uncertain',code:'ALREADY_PUBLISHED'};}
  const taskId=task.task_id;busy=true;
  const uncertain=code=>{held=true;return {state:'uncertain',code};};
  try{
   let response;try{response=await request(req);}catch{return uncertain('TRANSPORT_UNCERTAIN');}
   if(!response||!Number.isInteger(response.status))return uncertain('INVALID_RESPONSE');
   if(response.status===429){
    const seconds=response.body?.retry_after;
    if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<=0||seconds>86400)return uncertain('INVALID_RATE_LIMIT');
    const ended=now();if(!Number.isSafeInteger(ended)||ended<at)return uncertain('CLOCK');
    cooldown=ended+Math.ceil(seconds*1000);return {state:'not_sent',code:'RATE_LIMITED',retry_at:cooldown};
   }
   if(response.status===401||response.status===403){blocked=true;return {state:'not_sent',code:'AUTH_BLOCKED'};}
   if(response.status>=400&&response.status<500)return {state:'not_sent',code:'HTTP_REJECTED'};
   if(response.status<200||response.status>=300)return uncertain('HTTP_UNCERTAIN');
   const receipt=response.body;
   if(!receipt||!snowflake(receipt.id)||receipt.channel_id!==cfg.channel_id||receipt.nonce!==req.body.nonce)return uncertain('INVALID_RECEIPT');
   accepted.add(taskId);return {state:'accepted',code:'MESSAGE_CREATED',message_id:receipt.id};
  }finally{busy=false;}
 }});
}
