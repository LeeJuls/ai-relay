import { createHash } from 'node:crypto';
import { message, validateMessage } from '../../lib/message.mjs';
import { RelayError } from '../../lib/errors.mjs';

const defaults = Object.freeze({ mode:'mock',route_id:'mock-route',pc_id:'mock-pc',session_address:'mock-session',
  guild_id:'mock-guild',channel_id:'mock-ai',owner_id:'mock-owner',command:'ask',maxInputBytes:4096,
  maxOutputBytes:4096,maxOutputUnits:1800,maxQueue:8,maxRecords:1000,maxAttempts:2,retryMs:1000,
  hourlyDispatches:6,dailyDispatches:20,maxEventAgeMs:300000,futureSkewMs:30000,
  bodyRetentionMs:86400000,dedupRetentionMs:604800000 });
export function mockConfig(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.keys(overrides).some(k=>!Object.hasOwn(defaults,k))) throw new RelayError('MOCK_CONFIG');
  const cfg={...defaults,...overrides};
  for (const [key,value] of Object.entries(cfg)) {
    if (typeof defaults[key]==='number' ? !Number.isSafeInteger(value)||value<1 : typeof value!=='string'||!value.trim()) throw new RelayError('MOCK_CONFIG');
  }
  if (cfg.mode!=='mock' || !/^[a-z][a-z0-9-]{0,47}$/.test(cfg.session_address) || cfg.dedupRetentionMs<=cfg.maxEventAgeMs+cfg.futureSkewMs || cfg.dedupRetentionMs<cfg.bodyRetentionMs) throw new RelayError('MOCK_CONFIG');
  return Object.freeze(cfg);
}
export function digest(value) { return createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex'); }
const textOk=(value,bytes,units=Infinity)=>typeof value==='string'&&value.isWellFormed()&&!!value.trim()&&value.length<=units&&Buffer.byteLength(value,'utf8')<=bytes;
const eventKeys=['event_id','guild_id','channel_id','owner_id','command','text','created_at','author_bot','webhook_id','thread_id','attachments','mentions'];
export function validateEvent(event,config,nowMs) {
  const no=code=>({accepted:false,code});
  if (!event || typeof event!=='object' || Array.isArray(event) || Object.keys(event).length!==eventKeys.length || eventKeys.some(k=>!Object.hasOwn(event,k))) return no('INVALID_EVENT');
  if (['event_id','guild_id','channel_id','owner_id','command'].some(k=>!textOk(event[k],128,128))) return no('INVALID_EVENT');
  if (event.guild_id!==config.guild_id || event.channel_id!==config.channel_id || event.owner_id!==config.owner_id || event.command!==config.command) return no('NOT_ALLOWED');
  if (event.author_bot!==false || event.webhook_id!==null || event.thread_id!==null || !Array.isArray(event.attachments) || event.attachments.length || !Array.isArray(event.mentions) || event.mentions.length) return no('UNSUPPORTED_ORIGIN');
  if (!textOk(event.text,config.maxInputBytes)) return no('INPUT_LIMIT');
  const time=Date.parse(event.created_at);
  if (!Number.isFinite(nowMs) || typeof event.created_at!=='string' || !Number.isFinite(time) || new Date(time).toISOString()!==event.created_at || nowMs-time>config.maxEventAgeMs || time-nowMs>config.futureSkewMs) return no('EVENT_TIME');
  const event_key=JSON.stringify([config.route_id,event.guild_id,event.channel_id,event.event_id]);
  const ids={event_key,relay_id:digest('relay:'+event_key).slice(0,32),task_id:'mock-task-'+digest('task:'+event_key).slice(0,32)};
  const envelope=message({id:ids.relay_id,from:'discord-owner',to:config.session_address,task:ids.task_id,type:'question',wake:true,body:event.text});
  envelope.createdAt=event.created_at; validateMessage(envelope);
  const target={guild_id:event.guild_id,channel_id:event.channel_id,event_id:event.event_id};
  return {accepted:true,ids,envelope,target,digest:digest([event.owner_id,event.command,event.text,target,event.created_at])};
}
export function validateResult(input,config) {
  if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length!==2 || !Object.hasOwn(input,'task_id') || !Object.hasOwn(input,'result_text') || typeof input.task_id!=='string' || !/^mock-task-[a-f0-9]{32}$/.test(input.task_id) || !textOk(input.result_text,config.maxOutputBytes,config.maxOutputUnits)) throw new RelayError('INVALID_RESULT');
  return {task_id:input.task_id,result_text:input.result_text};
}
export function validateTarget(target,config) {
  if(!target||typeof target!=='object'||Array.isArray(target)||Object.keys(target).length!==3||target.guild_id!==config.guild_id||target.channel_id!==config.channel_id||!textOk(target.event_id,128,128))throw new RelayError('INVALID_TARGET');
  return {guild_id:target.guild_id,channel_id:target.channel_id,event_id:target.event_id};
}
export function formatPublish(task,result_text,config) {
  validateResult({task_id:task.task_id,result_text},config);
  const text=result_text.replaceAll('@','@\u200b');
  if (!textOk(text,config.maxOutputBytes,config.maxOutputUnits)) throw new RelayError('OUTPUT_LIMIT');
  return {task_id:task.task_id,target:validateTarget(task.target,config),text,allowed_mentions:{parse:[],replied_user:false}};
}
