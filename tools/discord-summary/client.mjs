import {createRestRequest} from '../discord-adapter/rest.mjs';
import {fail} from './policy.mjs';

const definitelyUnsent=new WeakSet();
function safeError(sent){const e=new Error(sent?'SUMMARY_CLIENT_UNCERTAIN':'SUMMARY_CLIENT_NOT_SENT');if(!sent)definitelyUnsent.add(e);return e;}
export const isDefinitelyUnsent=e=>!!e&&typeof e==='object'&&definitelyUnsent.has(e);

// No ambient fetch/credential source. A future explicitly approved host supplies
// official Node fetch and a publisher-owned credential callback. Tests supply fakes.
export function createSummaryClient({bot_id,channel_id,deadline_at,authorization,fetchImpl,now,timers=globalThis}){
 if(![bot_id,channel_id].every(x=>typeof x==='string'&&/^\d{17,20}$/.test(x))||![authorization,fetchImpl,now,timers.setTimeout,timers.clearTimeout].every(x=>typeof x==='function')||!Number.isFinite(deadline_at))fail('SUMMARY_CLIENT_REQUIRED');
 let closed=false,active=null,postUsed=false,credential;
 function check(ctx){const clock=now();if(closed||ctx.controller.signal.aborted||!Number.isFinite(clock)||clock>=ctx.deadline)throw safeError(ctx.sent);}
 async function perform(isPost,options,operation){
  if(closed||active||isPost&&postUsed)throw safeError(false);
  const signal=options?.signal;if(signal!==undefined&&!(signal instanceof AbortSignal))throw safeError(false);
  const ctx={controller:new AbortController(),sent:false,reader:null,deadline:Math.min(now()+10000,deadline_at)};active=ctx;
  let timer,onAbort,onExternal;const aborted=new Promise((resolve,reject)=>{onAbort=()=>{closed=true;credential=undefined;try{Promise.resolve(ctx.reader?.cancel()).catch(()=>{});}catch{}reject(safeError(ctx.sent));};});
  // Setup itself may fail before a race is attached; never leave a rejection or
  // schedule an effect until cancellation/deadline machinery is installed.
  void aborted.catch(()=>{});
  try{
   ctx.controller.signal.addEventListener('abort',onAbort,{once:true});
   onExternal=()=>ctx.controller.abort();if(signal?.aborted)ctx.controller.abort();else signal?.addEventListener('abort',onExternal,{once:true});
   // Catch the race before any authorization callback or fetch invocation.
   timer=timers.setTimeout(()=>ctx.controller.abort(),Math.max(0,ctx.deadline-now()));
   const work=Promise.resolve().then(async()=>{check(ctx);return operation(ctx);});
   return await Promise.race([work,aborted]);
  }catch{ctx.controller.abort();throw safeError(ctx.sent);}
  finally{if(timer!==undefined)timers.clearTimeout(timer);ctx.controller.signal.removeEventListener('abort',onAbort);signal?.removeEventListener('abort',onExternal);if(active===ctx)active=null;}
 }
 async function auth(ctx){check(ctx);if(credential!==undefined)return credential;const value=await authorization();check(ctx);if(typeof value!=='string'||!/^Bot [A-Za-z0-9._-]{1,256}$/.test(value))throw safeError(false);credential=value;return credential;}
 async function transport(ctx,url,options,isPost){
  check(ctx);if(isPost){ctx.sent=true;postUsed=true;}
  const signal=options.signal?AbortSignal.any([ctx.controller.signal,options.signal]):ctx.controller.signal;
  const response=await fetchImpl(url,{...options,signal});
  try{check(ctx);}catch(e){try{Promise.resolve(response?.body?.cancel()).catch(()=>{});}catch{}throw e;}
  return {status:response?.status,redirected:response?.redirected,body:{getReader(){check(ctx);const reader=response.body.getReader();ctx.reader=reader;return reader;}}};
 }
 async function identityBody(ctx,response){
  if(response.status!==200||response.redirected)throw safeError(false);
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{for(;;){check(ctx);const {done,value}=await reader.read();check(ctx);if(done)break;bytes+=value.byteLength;if(bytes>65536)throw safeError(false);chunks.push(Buffer.from(value));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}throw safeError(false);}
  finally{reader.releaseLock();}
 }
 return {
  async verifyIdentity(options={}){return perform(false,options,async ctx=>{const value=await auth(ctx),response=await transport(ctx,'https://discord.com/api/v10/users/@me',{method:'GET',headers:{Authorization:value},redirect:'error'},false),body=await identityBody(ctx,response);if(body?.id!==bot_id||body.bot!==true)throw safeError(false);return {id:bot_id,bot:true};});},
  async request(input,options={}){return perform(true,options,async ctx=>{
   const request=createRestRequest({channel_id,authorization:()=>auth(ctx),fetchImpl:(url,init)=>transport(ctx,url,init,true)});
   const response=await request(input);check(ctx);
   // Only receipt allowlist fields leave the credential-owning client.
   const b=response.body;return {status:response.status,body:response.status>=200&&response.status<300?{id:b?.id,channel_id:b?.channel_id,nonce:b?.nonce}:{}};
  });},
  async close(){closed=true;credential=undefined;active?.controller.abort();}
 };
}
