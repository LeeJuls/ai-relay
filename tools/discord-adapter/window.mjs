export function trialWindow(startedAt){
 let readyAt=null;
 return {observe(phase,now){
  let announce=false;if(phase==='ready'&&readyAt===null){readyAt=now;announce=true;}
  return {done:readyAt===null?now>=startedAt+15000:now>=readyAt+180000,announce,remaining_ms:readyAt===null?null:Math.max(0,readyAt+180000-now)};
 }};
}
export function trialDeadline({set,clear,expire}){
 let phase='starting';const expired=()=>{if(phase==='stopped'||phase==='expired')return;phase='expired';expire();};let timer=set(expired,15000);
 return {ready(){if(phase!=='starting')return false;clear(timer);phase='ready';timer=set(expired,180000);return true;},cancel(){clear(timer);phase='stopped';}};
}
export async function closeTrial({host,broker,abort}){
 broker.stop();abort();const stopping=host.stop(),closing=host.close();const results=await Promise.allSettled([stopping,closing]);await broker.drain();if(results.some(r=>r.status==='rejected'))throw Error('TRIAL_CLOSE_UNCERTAIN');
}
