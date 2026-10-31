import {snowflake,text} from './interaction.mjs';
import {RelayError} from '../../lib/errors.mjs';

// Explicit injected transport and credential callback; no ambient token lookup.
// Nothing is sent until the returned function is called by an approved host.
export function createRestRequest({channel_id,fetchImpl,authorization}){
 if(!snowflake(channel_id)||typeof fetchImpl!=='function'||typeof authorization!=='function')throw new RelayError('REST_BINDING_REQUIRED');
 const path=`/api/v10/channels/${channel_id}/messages`;
 return async function request(input){
  let snapshot;
  try{
   snapshot=structuredClone(input);const r=snapshot,b=r.body,m=b.allowed_mentions;
   if(Object.keys(r).sort().join(',')!=='automatic_retries,body,max_response_bytes,method,path,redirect,timeout_ms'||r.method!=='POST'||r.path!==path||r.timeout_ms!==10000||r.max_response_bytes!==65536||r.redirect!=='error'||r.automatic_retries!==0||Object.keys(b).sort().join(',')!=='allowed_mentions,content,enforce_nonce,nonce'||!text(b.content)||b.content.length>1800||Buffer.byteLength(b.content,'utf8')>4096||!/^[a-f0-9]{24}$/.test(b.nonce)||b.enforce_nonce!==true||Object.keys(m).sort().join(',')!=='parse,replied_user'||!Array.isArray(m.parse)||m.parse.length!==0||m.replied_user!==false)throw Error();
  }catch{throw new RelayError('INVALID_REST_REQUEST');}
  try{
   const auth=await authorization();if(typeof auth!=='string'||!/^Bot [A-Za-z0-9._-]{1,256}$/.test(auth))throw Error();
   const response=await fetchImpl('https://discord.com'+path,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(snapshot.body),redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!response||!Number.isInteger(response.status)||response.status<200||response.status>=600||response.status>=300&&response.status<400||response.redirected)throw Error();
   const reader=response.body?.getReader();if(!reader)throw Error();let length=0;const chunks=[];
   try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>65536)throw Error();chunks.push(Buffer.from(value));}}
   catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
   return {status:response.status,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))};
  }catch{throw new RelayError('DISCORD_REQUEST_UNCERTAIN');}
 };
}
