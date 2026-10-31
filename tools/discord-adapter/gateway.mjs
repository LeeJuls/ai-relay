import {adapterConfig} from './interaction.mjs';
import {RelayError} from '../../lib/errors.mjs';

function gatewayUrl(value){
 const u=new URL(value);
 if(u.protocol!=='wss:'||!/^gateway(?:-[a-z0-9-]+)?\.discord\.gg$/.test(u.hostname)||u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error();
 u.search='?v=10&encoding=json';return u.href;
}

export function createGatewayDiscovery({fetchImpl,authorization}){
 if(typeof fetchImpl!=='function'||typeof authorization!=='function')throw new RelayError('GATEWAY_BINDING_REQUIRED');
 return async()=>{
  try{
   const auth=await authorization();if(typeof auth!=='string'||!/^Bot [-A-Za-z0-9._]{1,256}$/.test(auth))throw Error();
   const response=await fetchImpl('https://discord.com/api/v10/gateway/bot',{method:'GET',headers:{Authorization:auth},redirect:'error',signal:AbortSignal.timeout(10000)});
   if(response?.status!==200||response.redirected)throw Error();
   const reader=response.body?.getReader();if(!reader)throw Error();let length=0;const chunks=[];
   try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>65536)throw Error();chunks.push(Buffer.from(part.value));}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
   const d=JSON.parse(Buffer.concat(chunks).toString('utf8'));gatewayUrl(d.url);
   if(d.shards!==1||!Number.isSafeInteger(d.session_start_limit?.remaining)||!Number.isSafeInteger(d.session_start_limit.max_concurrency))throw Error();
   return {url:d.url,shards:d.shards,session_start_limit:{remaining:d.session_start_limit.remaining,max_concurrency:d.session_start_limit.max_concurrency,reset_after:d.session_start_limit.reset_after}};
  }catch{throw new RelayError('GATEWAY_DISCOVERY_FAILED');}
 };
}

// No default socket, discovery, credential source or timer implementation.
// Reconnect is explicit and bounded; no background reconnect/identify loop.
export function createGateway({config,socketFactory,discover,authorization,timers,now=Date.now,jitter=Math.random,onInteraction,onReady=()=>{}}){
 const cfg=adapterConfig(config);
 if([socketFactory,discover,authorization,now,jitter,onInteraction,onReady,timers?.set,timers?.clear].some(f=>typeof f!=='function'))throw new RelayError('GATEWAY_BINDING_REQUIRED');
 let phase='idle',code=null,socket=null,generation=0,connections=0,seq=null,resume=null,initial=null,helloSeen=false,awaitingAck=false,interval=0,heartbeatTimer=null,deadlineTimer=null,queue=Promise.resolve(),frames=0,identifyAfter=0,reconnectAfter=0;
 const jobs=new Set(),readyJobs=new Set(),sent=[];
 function notifyReady(gen){const job=Promise.resolve().then(onReady).catch(()=>{if(gen===generation)halt('blocked','READY_HANDLER_FAILED');});readyJobs.add(job);job.finally(()=>readyJobs.delete(job));}
 const clock=()=>{const at=now();if(!Number.isSafeInteger(at)||at<0)throw Error();return at;};
 function clearTimers(){for(const id of [heartbeatTimer,deadlineTimer])if(id!==null)timers.clear(id);heartbeatTimer=deadlineTimer=null;}
 function halt(next,reason,clearResume=false){generation++;clearTimers();phase=next;code=reason;if(clearResume)resume=null;const old=socket;socket=null;try{old?.close(next==='closed'?1000:4000);}catch{}}
 function send(packet){
  const at=clock();while(sent.length&&sent[0]<=at-60000)sent.shift();
  if(sent.length>=90){halt('reconnect_required','GATEWAY_SEND_LIMIT');return false;}
  try{socket.send(JSON.stringify(packet));sent.push(at);return true;}catch{halt('reconnect_required','GATEWAY_SEND_UNCERTAIN');return false;}
 }
 function heartbeat(gen){
  if(gen!==generation)return;
  if(awaitingAck){halt('reconnect_required','HEARTBEAT_ACK_MISSING');return;}
  if(send({op:1,d:seq})){awaitingAck=true;heartbeatTimer=timers.set(()=>heartbeat(gen),interval);}
 }
 function watchdog(gen){deadlineTimer=timers.set(()=>{if(gen===generation)halt('reconnect_required','GATEWAY_HANDSHAKE_TIMEOUT');},10000);}
 async function packet(p,gen,resuming){
  if(gen!==generation)return;
  if(!p||typeof p!=='object'||!Number.isInteger(p.op)){halt('blocked','INVALID_GATEWAY_PACKET');return;}
  if(p.op===10){
   if(helloSeen||!Number.isSafeInteger(p.d?.heartbeat_interval)||p.d.heartbeat_interval<1000||p.d.heartbeat_interval>120000){halt('blocked','INVALID_HELLO');return;}
   helloSeen=true;interval=p.d.heartbeat_interval;const offset=jitter();if(typeof offset!=='number'||offset<0||offset>1){halt('blocked','INVALID_JITTER');return;}
   heartbeatTimer=timers.set(()=>heartbeat(gen),Math.floor(interval*offset));
   let auth;try{auth=await authorization();}catch{if(gen===generation)halt('blocked','GATEWAY_AUTH_UNAVAILABLE',true);return;}
   if(gen!==generation)return;
   if(typeof auth!=='string'||!/^Bot [-A-Za-z0-9._]{1,256}$/.test(auth)){halt('blocked','GATEWAY_AUTH_INVALID',true);return;}
   phase=resuming?'resuming':'identifying';
   if(!resuming)identifyAfter=clock()+5000;
   send(resuming?{op:6,d:{token:auth.slice(4),session_id:resume.session_id,seq}}:{op:2,d:{token:auth.slice(4),intents:0,properties:{os:'windows',browser:'ai-relay',device:'ai-relay'}}});
   return;
  }
  if(!helloSeen)return;
  if(p.op===11){awaitingAck=false;return;}
  if(p.op===1){if(send({op:1,d:seq}))awaitingAck=true;return;}
  if(p.op===7){halt('reconnect_required','GATEWAY_RECONNECT');return;}
  if(p.op===9){reconnectAfter=clock()+5000;halt('reconnect_required','INVALID_SESSION',p.d!==true);return;}
  if(p.op!==0)return;
  if(!Number.isSafeInteger(p.s)||p.s<0){halt('blocked','INVALID_SEQUENCE');return;}
  if(seq!==null&&p.s<=seq)return;
  seq=p.s;
  if(p.t==='READY'){
   if(phase!=='identifying'||p.d?.v!==10||p.d?.application?.id!==cfg.application_id||p.d.user?.bot!==true||typeof p.d.session_id!=='string'||!/^[-A-Za-z0-9_]{1,256}$/.test(p.d.session_id)){halt('blocked','GATEWAY_IDENTITY_MISMATCH',true);return;}
   let url;try{url=gatewayUrl(p.d.resume_gateway_url);}catch{halt('blocked','INVALID_RESUME_URL',true);return;}
   resume={session_id:p.d.session_id,url};phase='ready';if(deadlineTimer!==null)timers.clear(deadlineTimer);deadlineTimer=null;notifyReady(gen);return;
  }
  if(p.t==='RESUMED'&&phase==='resuming'){phase='ready';if(deadlineTimer!==null)timers.clear(deadlineTimer);deadlineTimer=null;notifyReady(gen);return;}
  if(p.t!=='INTERACTION_CREATE'||!['ready','resuming'].includes(phase))return;
  if(jobs.size>=8){halt('blocked','INTERACTION_OVERFLOW');return;}
  const job=Promise.resolve().then(()=>onInteraction(p)).catch(()=>{if(gen===generation)halt('blocked','INTERACTION_HANDLER_FAILED');});
  jobs.add(job);job.finally(()=>jobs.delete(job));
 }
 async function connect(resuming){
  if(connections>=3||phase==='closed'||phase==='blocked')throw new RelayError('GATEWAY_START_REFUSED');
  const at=clock();if(at<reconnectAfter||!resuming&&at<identifyAfter)throw new RelayError('GATEWAY_COOLDOWN');
  phase='connecting';code=null;const gen=++generation;helloSeen=false;awaitingAck=false;clearTimers();
  let url;
  try{
   if(resuming)url=resume.url;
   else{const d=await discover();if(gen!==generation)return;if(d?.shards!==1||!Number.isSafeInteger(d.session_start_limit?.remaining)||d.session_start_limit.remaining<1||!Number.isSafeInteger(d.session_start_limit.max_concurrency)||d.session_start_limit.max_concurrency<1)throw Error();initial=gatewayUrl(d.url);url=initial;seq=null;}
   if(gen!==generation)return;
   const s=socketFactory(url);if(!s||typeof s.addEventListener!=='function'||typeof s.send!=='function'||typeof s.close!=='function')throw Error();socket=s;connections++;watchdog(gen);
   s.addEventListener('message',event=>{
    if(gen!==generation)return;
    if(typeof event.data!=='string'||Buffer.byteLength(event.data,'utf8')>65536||frames>=16){halt('blocked','INVALID_GATEWAY_FRAME');return;}
    const raw=event.data;frames++;
    const next=queue.then(async()=>{if(gen!==generation)return;let p;try{p=JSON.parse(raw);}catch{halt('blocked','INVALID_GATEWAY_FRAME');return;}await packet(p,gen,resuming);});
    queue=next.catch(()=>{if(gen===generation)halt('blocked','GATEWAY_PROTOCOL_ERROR');}).finally(()=>{frames--;});return queue;
   });
   s.addEventListener('close',event=>{if(gen!==generation)return;const fatal=[4004,4010,4011,4012,4013,4014].includes(event.code);halt(fatal?'blocked':'reconnect_required',fatal?'GATEWAY_AUTH_OR_CONFIG':'GATEWAY_DISCONNECTED',fatal||[1000,1001,4007,4009].includes(event.code));});
   s.addEventListener('error',()=>{if(gen===generation)halt('reconnect_required','GATEWAY_SOCKET_ERROR');});
  }catch{if(gen===generation)halt('blocked','GATEWAY_CONNECT_FAILED');throw new RelayError('GATEWAY_CONNECT_FAILED');}
 }
 return Object.freeze({
  start(){if(phase!=='idle')return Promise.reject(new RelayError('GATEWAY_ALREADY_STARTED'));return connect(false);},
  reconnect(){if(phase!=='reconnect_required')return Promise.reject(new RelayError('GATEWAY_RECONNECT_REFUSED'));return connect(!!resume);},
  async close(){halt('closed','CLOSED',true);},
  async drain(){await queue;await Promise.all([...readyJobs,...jobs]);},
  status(){return {phase,code,connections,pending_callbacks:jobs.size};},
 });
}
