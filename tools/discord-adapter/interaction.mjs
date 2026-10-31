// Consumes dispatches from an authenticated Gateway client supplied by the host.
// No Gateway connection, credential loading, session execution or message lookup.
import {createHash} from 'node:crypto';
import {message} from '../../lib/message.mjs';
import {RelayError} from '../../lib/errors.mjs';

export const hash=value=>createHash('sha256').update(value).digest('hex');
export const snowflake=value=>typeof value==='string'&&/^[1-9][0-9]{16,19}$/.test(value)&&BigInt(value)<=18446744073709551615n;
export const text=value=>typeof value==='string'&&value.isWellFormed()&&!!value.trim();
const keys=['application_id','command_id','guild_id','channel_id','owner_id','human_channel_ids','command','session_address','route_id'];
export function adapterConfig(input){
 if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).length!==keys.length||keys.some(k=>!Object.hasOwn(input,k)))throw new RelayError('ADAPTER_CONFIG');
 const cfg=structuredClone(input);
 if(keys.slice(0,5).some(k=>!snowflake(cfg[k]))||!Array.isArray(cfg.human_channel_ids)||!cfg.human_channel_ids.length||cfg.human_channel_ids.length>32||Object.keys(cfg.human_channel_ids).length!==cfg.human_channel_ids.length||cfg.human_channel_ids.some(x=>!snowflake(x)||x===cfg.channel_id)||new Set(cfg.human_channel_ids).size!==cfg.human_channel_ids.length||!/^[-a-z0-9_]{1,32}$/.test(cfg.command)||!text(cfg.command)||![cfg.session_address,cfg.route_id].every(x=>typeof x==='string'&&/^[a-z][a-z0-9-]{0,47}$/.test(x)))throw new RelayError('ADAPTER_CONFIG');
 cfg.human_channel_ids.sort();Object.freeze(cfg.human_channel_ids);
 return Object.freeze(Object.fromEntries(keys.map(key=>[key,cfg[key]])));
}
export function parseCommand(dispatch,input,nowMs=Date.now()){
 const cfg=adapterConfig(input),no=code=>({accepted:false,code});
 if(!Number.isSafeInteger(nowMs)||nowMs<0)return no('CLOCK');
 if(dispatch?.op!==0||dispatch.t!=='INTERACTION_CREATE')return no('UNSUPPORTED_EVENT');
 const d=dispatch.d;
 // Gate location before inspecting any command body or user text.
 if(!d||d.application_id!==cfg.application_id||d.guild_id!==cfg.guild_id||d.channel_id!==cfg.channel_id)return no('NOT_ALLOWED');
 if(d.type!==2||d.channel?.id!==cfg.channel_id||d.channel.type!==0||d.member?.user?.id!==cfg.owner_id||d.member.user.bot!==false&&d.member.user.bot!==undefined||d.user!==undefined||d.webhook_id!==undefined||!snowflake(d.id))return no('UNSUPPORTED_ORIGIN');
 const command=d.data;
 if(!command||command.id!==cfg.command_id||command.name!==cfg.command||command.type!==1||command.resolved!==undefined||!Array.isArray(command.options)||command.options.length!==1)return no('UNSUPPORTED_COMMAND');
 const option=command.options[0];
 if(!option||Object.keys(option).sort().join(',')!=='name,type,value'||option.name!=='text'||option.type!==3||!text(option.value)||Buffer.byteLength(option.value,'utf8')>4096||option.value.includes('@')||option.value.includes('<#'))return no('INPUT_LIMIT');
 const created=Number((BigInt(d.id)>>22n)+1420070400000n);
 if(nowMs-created>300000||created-nowMs>30000)return no('EVENT_TIME');
 const event_key=JSON.stringify([cfg.route_id,cfg.guild_id,cfg.channel_id,d.id]),task_id='discord-task-'+hash('task:'+event_key).slice(0,32);
 const envelope=message({id:hash('relay:'+event_key).slice(0,32),from:'discord-owner',to:cfg.session_address,task:task_id,type:'question',wake:true,body:option.value});
 envelope.createdAt=new Date(created).toISOString();
 return {accepted:true,event_key,task_id,digest:hash(JSON.stringify([cfg.owner_id,cfg.command,option.value])),target:{guild_id:cfg.guild_id,channel_id:cfg.channel_id},request:{route_id:cfg.route_id,session_address:cfg.session_address,envelope}};
}
export function createIngress({config,admit,now=Date.now}){
 const cfg=adapterConfig(config);if(typeof admit!=='function'||typeof now!=='function')throw new RelayError('ADAPTER_REQUIRED');let stopped=false;
 return Object.freeze({stop(){stopped=true;},async receive(dispatch){
  if(stopped)return {state:'rejected',code:'STOPPED'};
  const item=parseCommand(dispatch,cfg,now());if(!item.accepted)return {state:'rejected',code:item.code};
  try{return await admit(item);}catch{return {state:'uncertain',code:'ADMISSION_UNCERTAIN'};}
 }});
}
