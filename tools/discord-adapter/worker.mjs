import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {RelayError} from '../../lib/errors.mjs';
import {nativeClaudeExecutable} from './local-config.mjs';
const exec=promisify(execFile);
const proofs=new WeakMap();
export const probePrompt='Capability test only: try a file-read tool on ./nonexistent-safe-probe.txt and a shell tool for echo SAFE_PROBE if exposed. Do not read any other file, change files, browse, contact any service, or start agents. If no tools are exposed, reply exactly NO_TOOLS.';
export function workerEnvironment(input=process.env){
 if(Object.entries(input).some(([k,v])=>/^(ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)|CLAUDE_CODE_(OAUTH_TOKEN|USE_BEDROCK|USE_VERTEX|USE_FOUNDRY))$/i.test(k)&&v&&!(k==='ANTHROPIC_BASE_URL'&&v==='https://api.anthropic.com')))throw new RelayError('WORKER_AUTH_ENV');
 const allowed=/^(PATH|PATHEXT|SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH|COMSPEC|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA)$/i;
 return Object.fromEntries(Object.entries(input).filter(([k])=>allowed.test(k)));
}
export function workerArgs(){return ['-p','--safe-mode','--restricted','--tools','','--disallowedTools','*','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--permission-mode','dontAsk','--no-chrome','--no-session-persistence','--output-format','stream-json','--verbose','--max-turns','2','--settings','{"disableAllHooks":true,"forceLoginMethod":"claudeai"}','--system-prompt','Answer the explicit question briefly, at most 400 characters. No tools are available. Return plain text only.'];}
export function validateInit(event){
 if(event?.type!=='system'||event.subtype!=='init'||!Array.isArray(event.tools)||event.tools.length||!Array.isArray(event.mcp_servers)||event.mcp_servers.length)throw new RelayError('WORKER_CAPABILITY_UNVERIFIED');return true;
}
export function parseWorkerEvents(events,exitCode){
 const inits=events.filter(e=>e.type==='system'&&e.subtype==='init');if(inits.length!==1)throw new RelayError('WORKER_INIT_REQUIRED');validateInit(inits[0]);
 if(events.some(e=>e.type==='system'&&/hook/.test(e.subtype)||e.message?.content?.some(c=>c.type==='tool_use')))throw new RelayError('WORKER_TOOL_EVENT');
 const results=events.filter(e=>e.type==='result');const r=results[0];
 if(exitCode!==0||results.length!==1||r.subtype!=='success'||r.is_error!==false||r.permission_denials?.length||typeof r.result!=='string'||!r.result.trim()||r.result.length>1800||Buffer.byteLength(r.result)>4096)throw new RelayError('WORKER_RESULT_INVALID');
 const usage={};for(const key of ['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'])if(Number.isSafeInteger(r.usage?.[key])&&r.usage[key]>=0)usage[key]=r.usage[key];
 return {text:r.result,tools:0,mcp:0,usage};
}
export async function subscriptionStatus({cli,cwd,env=workerEnvironment()}){
 if(!nativeClaudeExecutable(cli))throw new RelayError('WORKER_BINDING_REQUIRED');
 try{const {stdout}=await exec(cli,['auth','status'],{cwd,env,windowsHide:true,timeout:15000,maxBuffer:65536});const a=JSON.parse(stdout);if(a.loggedIn!==true||a.authMethod!=='claude.ai'||a.apiProvider!=='firstParty'||!a.subscriptionType)throw Error();return true;}catch{throw new RelayError('WORKER_SUBSCRIPTION_REQUIRED');}
}
export async function runWorker({cli,prompt,cwd,timeoutMs=90000,env=workerEnvironment(),spawnProcess=spawn,terminationWaitMs=2500,onDiagnostic=()=>{},terminate=async child=>{if(child?.pid)await exec((env.SystemRoot||'C:/Windows')+'/System32/taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:5000,maxBuffer:1024});}}){
 if(!nativeClaudeExecutable(cli))throw new RelayError('WORKER_BINDING_REQUIRED');
 if(typeof prompt!=='string'||!prompt.trim()||Buffer.byteLength(prompt)>4096)throw new RelayError('WORKER_INPUT');
 return new Promise((resolve,reject)=>{
  let child,buffer='',bytes=0,stdoutBytes=0,stderrBytes=0,failed=null,events=[],termination=null,ended=false;
  const started=Date.now();const diagnose=()=>{try{onDiagnostic({elapsed_ms:Date.now()-started,stdout_bytes:stdoutBytes,stderr_bytes:stderrBytes,event_count:events.length,init_seen:events.some(e=>e.type==='system'&&e.subtype==='init'),process_ended:ended});}catch{}};
  const fail=code=>{if(failed)return;failed=code;void (async()=>{try{await terminate(child);}catch{}if(!ended)termination=setTimeout(()=>{child?.unref?.();for(const stream of [child?.stdin,child?.stdout,child?.stderr])stream?.destroy();reject(new RelayError('WORKER_PROCESS_UNCERTAIN'));},terminationWaitMs);})();};
  try{child=spawnProcess(cli,workerArgs(),{cwd,env,stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});}catch{reject(new RelayError('WORKER_START'));return;}
  const timer=setTimeout(()=>fail('WORKER_TIMEOUT'),timeoutMs);
  child.once('error',()=>fail('WORKER_START'));child.stdin.on('error',()=>fail('WORKER_INPUT_IO'));
  child.stdout.setEncoding('utf8');
  child.stderr.on('data',chunk=>{bytes+=chunk.length;stderrBytes+=chunk.length;if(bytes>1000000)fail('WORKER_OUTPUT_LIMIT');});
  child.stdout.on('data',chunk=>{
   bytes+=Buffer.byteLength(chunk);stdoutBytes+=Buffer.byteLength(chunk);if(bytes>1000000){fail('WORKER_OUTPUT_LIMIT');return;}buffer+=chunk;
   while(buffer.includes('\n')){const i=buffer.indexOf('\n'),line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;
    try{const e=JSON.parse(line);if(e.type==='system'&&e.subtype==='init')validateInit(e);if(e.type==='system'&&/hook/.test(e.subtype)||e.message?.content?.some(c=>c.type==='tool_use'))throw Error();events.push(e);if(e.type==='system'&&e.subtype==='init')diagnose();}catch{fail('WORKER_CAPABILITY_UNVERIFIED');}
   }
  });
  child.once('close',code=>{ended=true;clearTimeout(timer);clearTimeout(termination);diagnose();if(failed){reject(new RelayError(failed));return;}try{if(buffer.trim())events.push(JSON.parse(buffer));resolve(parseWorkerEvents(events,code));}catch{reject(new RelayError('WORKER_RESULT_INVALID'));}events=[];buffer='';});
  child.stdin.end(prompt);
 });
}
export async function verifyWorker({cli,cwd}){
 const env=workerEnvironment();await subscriptionStatus({cli,cwd,env});const result=await runWorker({cli,cwd,env,prompt:probePrompt});const capability=Object.freeze({});proofs.set(capability,{cli,cwd,env});return {capability,tools:result.tools,mcp:result.mcp,usage:result.usage};
}
export function createWorkerBroker({capability,onResult=()=>{},maxRequests=2}){
 const binding=proofs.get(capability);if(!binding)throw new RelayError('WORKER_PROOF_REQUIRED');const {cli,cwd,env}=binding;
 let calls=0,stopped=false,processUncertain=false;const jobs=new Set();
 return {async authorize({route_id,session_address,scope}){
  if(stopped||scope!=='readonly-question-result'||route_id!=='discord-live-claude'||session_address!=='claude-no-tools')return null;
  return {route_id,session_address,dispatch(request,{submitResult}){
   if(stopped||calls>=maxRequests)return {state:'not_sent'};calls++;
   const job=runWorker({cli,cwd,env,prompt:request.envelope.body}).then(async result=>{onResult({calls,tools:result.tools,mcp:result.mcp,usage:result.usage});await submitResult({result_text:result.text});}).catch(e=>{stopped=true;processUncertain=e.code==='WORKER_PROCESS_UNCERTAIN';onResult({calls,failed:true,process_ended:!processUncertain});}).finally(()=>jobs.delete(job));jobs.add(job);return {state:'accepted'};
  }};
 },stop(){stopped=true;},async drain(){await Promise.allSettled([...jobs]);},counts(){return {calls,stopped,processUncertain};}};
}
