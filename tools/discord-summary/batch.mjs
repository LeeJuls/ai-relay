import {randomUUID} from 'node:crypto';
import {openSummaryStore} from './store.mjs';
import {validateApproval,freeze,fail} from './policy.mjs';

export async function openSummaryBatch({root,expectedManifest,bindings,summaries,publisher,now,timers=globalThis}){
 if(typeof now!=='function'||!publisher||typeof publisher.publish!=='function'||typeof publisher.close!=='function'||typeof timers.setTimeout!=='function'||typeof timers.clearTimeout!=='function')fail('SUMMARY_HOST_REQUIRED');
 const approvedBatch=validateApproval({expectedManifest,bindings,summaries,now:now()});
 const store=await openSummaryStore({root,approvedBatch}),run_id=randomUUID();
 let consumed=false,running=false,closed=false,reason=null,last=null,resolveHalt;
 const halt=new Promise(resolve=>resolveHalt=resolve);
 const requestStop=code=>{if(!reason){reason=code;resolveHalt({halt:true});}return publisher.close();};
 return {
  async run(){
   if(consumed||closed)fail('SUMMARY_RUN_CONSUMED');consumed=true;running=true;let timer;
   try{
    if(reason){await store.stop({run_id,reason});return last=await store.status();}
    const started_at=now(),deadline_at=Math.min(started_at+180000,Date.parse(approvedBatch.manifest.expires_at));
    await store.beginRun({run_id,started_at,deadline_at});
    timer=timers.setTimeout(()=>{void requestStop('DEADLINE');},Math.max(0,deadline_at-now()));
    for(let i=0;i<2;i++){
     if(reason||now()>=deadline_at){await requestStop(reason??'DEADLINE');await store.stop({run_id,reason});break;}
     const claim=await store.claimNext(run_id);
     if(reason){await store.stop({run_id,reason});break;}
     const effect=Promise.resolve().then(()=>publisher.publish(claim)).catch(()=>({state:'held',code:'UNCERTAIN'}));
     const result=await Promise.race([effect,halt]);
     if(!reason&&now()>=deadline_at)await requestStop('DEADLINE');
     if(reason||result.halt){await store.stop({run_id,reason:reason??'STOPPED'});break;}
     await store.recordOutcome({...claim,outcome:result});
     if(result.state!=='accepted')break;
    }
    last=await store.status();return last;
   }catch{
    try{await store.stop({run_id,reason:'UNCERTAIN'});last=await store.status();}catch{}
    fail('SUMMARY_RUN_FAILED');
   }finally{
    if(timer!==undefined)timers.clearTimeout(timer);
    await publisher.close().catch(()=>{});await store.close();closed=true;running=false;
   }
  },
  async stop(){await requestStop('STOPPED');},
  async status(){return last??store.status();},
  async close(){await requestStop('STOPPED');if(!running&&!closed){await store.stop({run_id,reason:'STOPPED'});last=await store.status();await store.close();closed=true;}}
 };
}
