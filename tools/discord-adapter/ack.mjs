import {snowflake} from './interaction.mjs';
import {RelayError} from '../../lib/errors.mjs';
import en from '../../locales/en.json' with {type:'json'};
import ko from '../../locales/ko.json' with {type:'json'};
import ja from '../../locales/ja.json' with {type:'json'};

// Short-lived interaction credential is used only in this request; never saved.
export function createAcknowledger({fetchImpl,now=Date.now,locale='en'}){
 const catalogs={en,ko,ja};
 if(typeof fetchImpl!=='function'||typeof now!=='function'||!Object.hasOwn(catalogs,locale))throw new RelayError('ACK_BINDING_REQUIRED');
 return async input=>{
  const at=now();let id,token,deadline;
  try{
   if(!input||Object.keys(input).sort().join(',')!=='deadline,interaction_id,token')throw Error();
   ({interaction_id:id,token,deadline}=input);
   if(!snowflake(id)||typeof token!=='string'||!/^[-A-Za-z0-9._]{1,512}$/.test(token)||!Number.isSafeInteger(at)||!Number.isSafeInteger(deadline)||deadline<=at||deadline-at>2500)throw Error();
  }catch{return {state:'not_sent',code:'ACK_INVALID_OR_EXPIRED'};}
  try{
   const response=await fetchImpl(`https://discord.com/api/v10/interactions/${id}/${token}/callback`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:4,data:{content:catalogs[locale].DISCORD_REQUEST_QUEUED,flags:64,allowed_mentions:{parse:[]}}}),redirect:'error',signal:AbortSignal.timeout(deadline-at)});
   const ended=now();if(!Number.isSafeInteger(ended)||ended<at||ended>=deadline||response?.redirected)return {state:'uncertain',code:'ACK_UNCERTAIN'};
   if(response.status===204)return {state:'accepted',code:'ACK_ACCEPTED'};
   // No retry, even for definite rejection: the deadline and receipt may be lost.
   if(response.status>=400&&response.status<500)return {state:'not_sent',code:'ACK_REJECTED'};
  }catch{}
  return {state:'uncertain',code:'ACK_UNCERTAIN'};
 };
}
