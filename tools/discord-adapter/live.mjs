import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {loadCredential,createControlRequest,safeLogger} from './live-transport.mjs';
import {verifyWorker,createWorkerBroker} from './worker.mjs';
import {openDiscordHostWithTransport} from './host.mjs';
import {trialWindow,trialDeadline,closeTrial} from './window.mjs';
import {parseLaunchArgs,prepareLiveTrial,inspectLivePreparation,validateRegisteredCommand} from './preparation.mjs';
import {loadLocalConfig} from './local-config.mjs';
const log=safeLogger(value=>console.log(JSON.stringify(value)));
let host,broker,boundary,shutdown,processUncertain=false;
const cwd=fileURLToPath(new URL('../../../.discord-worker/',import.meta.url));
const root=fileURLToPath(new URL('../../../.discord-live-ledger/',import.meta.url));
try{
 const launch=parseLaunchArgs(process.argv.slice(2));
 const local=await loadLocalConfig(new URL('../../.discord.local.json',import.meta.url)),config=local.adapter;
 if(launch.mode==='--prepare'){
  // This branch never reads credentials, launches a worker or binds a transport.
  console.log(JSON.stringify(await prepareLiveTrial({root,config})));
 }else{
  let proof;
  if(launch.mode==='--start'){
   // Fail before any credential or model use if no valid, unchanged preparation.
   await inspectLivePreparation({root,config,trial_id:launch.trial_id});
   await fs.mkdir(cwd,{recursive:true});proof=await verifyWorker({cli:local.claude_executable,cwd});log('worker',{ok:true,tools:proof.tools,mcp:proof.mcp});
  }
  const authorization=await loadCredential(new URL('../../.env.discord.local',import.meta.url));
  const request=createControlRequest({config,authorization,fetchImpl:fetch});
  const me=await request('GET','/api/v10/users/@me');
  if(me.id!==config.application_id||me.bot!==true)throw Error();log('auth',{ok:true});
  if(launch.mode==='--start'){
   const commandPath=`/api/v10/applications/${config.application_id}/guilds/${config.guild_id}/commands`;
   const existing=await request('GET',commandPath);if(!Array.isArray(existing))throw Error();
   const matches=existing.filter(c=>c.name===config.command);if(matches.length!==1)throw Error();
   const command_id=validateRegisteredCommand(matches[0],config);log('command',{ok:true,command_id});
   broker=createWorkerBroker({capability:proof.capability,onResult:meta=>log('worker',meta)});
   const abort=new AbortController();let shutdownPromise=null,expired=false;
   shutdown=()=>shutdownPromise??=(expired=true,closeTrial({host,broker,abort:()=>abort.abort()}));
   const trialFetch=(url,options)=>fetch(url,{...options,signal:AbortSignal.any([options.signal,abort.signal])});
   host=await openDiscordHostWithTransport({root,config,resumePreparationId:launch.trial_id,fetchImpl:trialFetch,socketFactory:url=>new WebSocket(url),authorization,sessionBroker:broker,timers:{set:(callback,ms)=>setTimeout(callback,ms),clear:clearTimeout},locale:'ko',onGatewayReady:()=>{if(boundary.ready())log('gateway',{connected:true});}});
   boundary=trialDeadline({set:setTimeout,clear:clearTimeout,expire:()=>{void shutdown().catch(()=>{processUncertain=true;});}});
   await host.start();
   const trial=trialWindow(Date.now());
   for(;;){await new Promise(resolve=>setTimeout(resolve,1000));const s=await host.status(),window=trial.observe(s.gateway.phase,Date.now());
    if(window.done||expired)break;
    if(['blocked','reconnect_required'].includes(s.gateway.phase)||s.runtime.held||s.runtime.trial?.completed>=2)break;
   }
   await shutdown();boundary.cancel();const s=await host.status();log('status',{completed:s.runtime.trial?.completed??0,held:s.runtime.held,inflight:s.runtime.inflight,stopped:s.runtime.stopped,calls:broker.counts().calls});
  }
 }
}catch(e){processUncertain ||= e.code==='WORKER_PROCESS_UNCERTAIN'||e.message==='TRIAL_CLOSE_UNCERTAIN';log('failed',{ok:false});process.exitCode=1;}
finally{
 boundary?.cancel();if(host){if(shutdown)await shutdown().catch(()=>{processUncertain=true;});else await host.close().catch(()=>{processUncertain=true;});}
 if(broker){broker.stop();await broker.drain();processUncertain ||= broker.counts().processUncertain;}
 log('closed',{process_ended:!processUncertain});
}
