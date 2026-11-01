// Read-only, one-shot diagnostic. No ambient credential, network or logger.
import {diagnosticError,knownFailure} from './diagnostic-errors.mjs';
const id=x=>typeof x==='string'&&/^[1-9][0-9]{16,19}$/.test(x);
const bits=x=>{if(typeof x!=='string'||!/^\d{1,24}$/.test(x))throw Error();return BigInt(x);};
const array=x=>{if(!Array.isArray(x)||x.length>1000)throw Error();return x;};
export async function diagnoseBot({guild_id,bot_id,channel_id,required_denied_ids=[],authorization,fetchImpl,timeout_ms=10000}){
 let credential,stage='validation';
 try{
  if(![guild_id,bot_id,channel_id].every(id)||!array(required_denied_ids).every(x=>id(x)&&x!==channel_id)||typeof authorization!=='function'||typeof fetchImpl!=='function'||!Number.isInteger(timeout_ms)||timeout_ms<1||timeout_ms>10000)throw Error();
  async function get(path,nextStage){
   stage=nextStage;
   const abort=new AbortController();let reader,timer;
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();try{void Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}reject(diagnosticError('TIMEOUT',stage));},timeout_ms);});
   const work=Promise.resolve().then(async()=>{
    if(!credential){const value=await authorization();if(abort.signal.aborted||typeof value!=='string'||!/^Bot [A-Za-z0-9._-]{1,256}$/.test(value))throw Error();credential=value;}
    if(abort.signal.aborted)throw Error();
    let response;try{response=await fetchImpl('https://discord.com/api/v10'+path,{method:'GET',headers:{Authorization:credential},redirect:'error',signal:abort.signal});}catch(e){throw diagnosticError('NETWORK_ERROR',stage,{network_code:e?.cause?.code??e?.code??'OTHER'});}
    if(abort.signal.aborted){try{await response.body?.cancel();}catch{}throw Error();}
    if(response.redirected){try{await response.body?.cancel();}catch{}throw diagnosticError('REDIRECT',stage);}
    reader=response.body.getReader();let size=0;const chunks=[];
    try{for(;;){const {done,value}=await reader.read();if(abort.signal.aborted)throw Error();if(done)break;size+=value.byteLength;if(size>1048576)throw diagnosticError('RESPONSE_TOO_LARGE',stage);chunks.push(Buffer.from(value));}let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{if(response.status!==200)throw diagnosticError('HTTP_ERROR',stage,{http_status:response.status});throw diagnosticError('RESPONSE_INVALID',stage);}if(response.status!==200)throw diagnosticError('HTTP_ERROR',stage,{http_status:response.status,discord_code:body?.code});return body;}
    finally{try{await reader.cancel();}catch{}reader.releaseLock();}
   });
   try{return await Promise.race([work,timeout]);}finally{clearTimeout(timer);abort.abort();}
  }
  const me=await get('/users/@me','identity');if(me?.id!==bot_id||me.bot!==true)throw diagnosticError('IDENTITY_MISMATCH',stage);
  const guild=await get(`/guilds/${guild_id}`,'guild');if(guild?.id!==guild_id||!id(guild.owner_id))throw Error();
  const member=await get(`/guilds/${guild_id}/members/${bot_id}`,'member');if(member?.user?.id!==bot_id)throw Error();
  const roles=new Map();for(const r of array(guild.roles)){if(!id(r.id)||roles.has(r.id))throw Error();roles.set(r.id,bits(r.permissions));}
  if(!roles.has(guild_id))throw Error();let base=roles.get(guild_id);
  const assigned=new Set(array(member.roles));for(const role of assigned){if(!id(role)||!roles.has(role))throw Error();base|=roles.get(role);}
  const administrator=guild.owner_id===bot_id||(base&8n)!==0n;
  const channels=array(await get(`/guilds/${guild_id}/channels`,'channels')),seen=new Set();let ai,other_visible=0,checked_channels=0;
  for(const channel of channels){
   if(!id(channel.id)||seen.has(channel.id)||!Number.isInteger(channel.type))throw Error();seen.add(channel.id);
   if(channel.type===4)continue; // Category visibility alone is not child access.
   let p=base,everyone,memberOverwrite;let deny=0n,allow=0n;const keys=new Set();
   for(const raw of array(channel.permission_overwrites)){
    if(!id(raw.id)||![0,1].includes(raw.type)||keys.has(`${raw.type}:${raw.id}`))throw Error();keys.add(`${raw.type}:${raw.id}`);
    const overwrite={deny:bits(raw.deny),allow:bits(raw.allow)};
    if(raw.type===0&&raw.id===guild_id)everyone=overwrite;
    else if(raw.type===0&&assigned.has(raw.id)){deny|=overwrite.deny;allow|=overwrite.allow;}
    else if(raw.type===1&&raw.id===bot_id)memberOverwrite=overwrite;
   }
   if(everyone)p=(p&~everyone.deny)|everyone.allow;p=(p&~deny)|allow;
   if(memberOverwrite)p=(p&~memberOverwrite.deny)|memberOverwrite.allow;
   const view=administrator||(p&1024n)!==0n,send=view&&(administrator||(p&2048n)!==0n),history=view&&(administrator||(p&65536n)!==0n);
   checked_channels++;
   if(channel.id===channel_id){if(channel.type!==0)throw Error();ai={view,send,history};}
   else if(view)other_visible++;
  }
  if(!ai||required_denied_ids.some(x=>!seen.has(x)))throw Error();
  return {bot_id,guild_id,channel_id,administrator,ai,checked_channels,other_visible,isolated:!administrator&&ai.view&&ai.send&&other_visible===0,coverage:'CURRENT_GUILD_CHANNEL_METADATA_ONLY'};
 }catch(e){throw knownFailure(e)?e:diagnosticError('METADATA_INVALID',stage);}finally{credential=undefined;}
}
