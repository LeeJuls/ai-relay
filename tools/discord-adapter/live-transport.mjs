import fs from 'node:fs/promises';
import {RelayError} from '../../lib/errors.mjs';
import {adapterConfig} from './interaction.mjs';
export function credentialFromText(input){
 try{const lines=input.replace(/^\uFEFF/,'').split(/\r?\n/).filter(s=>s.trim()&&!s.trim().startsWith('#'));if(lines.length!==1)throw Error();const match=/^DISCORD_BOT_TOKEN=([-A-Za-z0-9._]{20,256})$/.exec(lines[0].trim());if(!match||match[1].includes('PLACEHOLDER'))throw Error();const value='Bot '+match[1];return ()=>value;}catch{throw new RelayError('LIVE_CREDENTIAL_INVALID');}
}
export async function loadCredential(filename){try{return credentialFromText(await fs.readFile(filename,'utf8'));}catch{throw new RelayError('LIVE_CREDENTIAL_INVALID');}}
export function safeLogger(write){return (event,meta={})=>{const output={event:['auth','worker','gateway','command','closed','status','failed'].includes(event)?event:'unknown'};for(const key of ['ok','calls','tools','mcp','completed','held','inflight','stopped','connected','requests','process_ended','failed']){const v=meta[key];if(typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))output[key]=v;}if(typeof meta.command_id==='string'&&/^[1-9][0-9]{16,19}$/.test(meta.command_id))output.command_id=meta.command_id;write(output);};}
export function createControlRequest({config,authorization,fetchImpl}){
 const target=adapterConfig(config),commands=`/api/v10/applications/${target.application_id}/guilds/${target.guild_id}/commands`;
 return async(method,path,body)=>{
  if(!(method==='GET'&&['/api/v10/users/@me',commands].includes(path)||method==='POST'&&path===commands))throw new RelayError('LIVE_PATH_DENIED');
  if(method==='POST'&&JSON.stringify(body)!==JSON.stringify(commandDefinitionFor(target)))throw new RelayError('LIVE_COMMAND_DENIED');
  try{const r=await fetchImpl('https://discord.com'+path,{method,headers:{Authorization:await authorization(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});if(r.redirected||r.status<200||r.status>=300)throw Error();const reader=r.body.getReader();let size=0;const chunks=[];try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>65536)throw Error();chunks.push(Buffer.from(p.value));}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new RelayError('LIVE_REQUEST_UNCERTAIN');}
 };
}
export function commandDefinitionFor(config){const cfg=adapterConfig(config);return {name:cfg.command,description:'Short owner-only AI channel test',type:1,default_member_permissions:'0',options:[{name:'text',description:'A short non-sensitive question',type:3,required:true,max_length:800}]};}
