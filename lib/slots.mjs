import fs from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {createClient,readConfiguration} from './core.mjs';
import {address} from './message.mjs';
import {absoluteRoot,ownedPath,readJson,atomicJson,withWriter,directory} from './storage.mjs';
import {RelayError} from './errors.mjs';
const strings=JSON.parse(await fs.readFile(new URL('../locales/en.json',import.meta.url),'utf8'));
const render=(key,values)=>strings[key].replace(/\{(\w+)\}/g,(_,key)=>values[key]??'');

function slotName(name){if(typeof name!=='string'||!/^[a-z][a-z0-9-]{0,47}$/.test(name))throw new RelayError('INVALID_SLOT');address(name);return name;}
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
async function configuration(root,io){return readConfiguration({root,io});}
async function state(root,name,io){
 const s=await readJson(root,['slots',name+'.json'],{io,corrupt:'CORRUPT_SLOT'})??{schemaVersion:1,name,holder:null,queue:[],notices:[],revision:0,updatedAt:null};
 try{
  if(s.schemaVersion!==1||s.name!==name||!Array.isArray(s.queue)||!Array.isArray(s.notices)||!Number.isSafeInteger(s.revision)||s.revision<0)throw Error();
  if(s.updatedAt!==null&&!Number.isFinite(Date.parse(s.updatedAt)))throw Error();
  if(s.holder){address(s.holder.as);if(!Number.isFinite(Date.parse(s.holder.since)))throw Error();}
  for(const x of s.queue){address(x.as);if(!Number.isInteger(x.pid)||x.pid<1||x.pid>2147483647||x.waitId!==undefined&&!/^[a-f0-9]{32}$/.test(x.waitId))throw Error();}
  if(new Set(s.queue.map(x=>x.as)).size!==s.queue.length)throw Error();
  for(const n of s.notices){address(n.to);if(!/^[a-f0-9]{32}$/.test(n.id)||typeof n.body!=='string')throw Error();}
 }catch(e){throw new RelayError('CORRUPT_SLOT',{cause:e});}return s;
}
export async function list({root,io=fs,now=Date.now()}){
 root=absoluteRoot(root);const dir=await ownedPath(root,['slots'],io);let files=[];try{files=await io.readdir(dir);}catch(e){if(e.code!=='ENOENT')throw e;}
 const all=[];for(const f of files.filter(f=>/^[a-z][a-z0-9-]{0,47}\.json$/.test(f))){const s=await state(root,f.slice(0,-5),io);all.push({name:s.name,holder:s.holder?{as:s.holder.as,since:s.holder.since}:null,queue:s.queue.map(x=>({as:x.as,pid:x.pid})),notices:s.notices.map(n=>({id:n.id,to:n.to})),updatedAt:s.updatedAt,revision:s.revision,holderAgeMs:s.holder?Math.max(0,now-Date.parse(s.holder.since)):null,inactiveMs:s.updatedAt?Math.max(0,now-Date.parse(s.updatedAt)):null,staleInferred:!!s.holder&&now-Date.parse(s.updatedAt)>=900000});}return all.sort((a,b)=>a.name.localeCompare(b.name));
}
async function flush(root,name,io){
 const cfg=await configuration(root,io),s=await state(root,name,io);
 for(const n of s.notices){
  if(!cfg.addresses[n.to])throw new RelayError('CORRUPT_SLOT');
  try{await createClient({root,address:cfg.addresses[n.to].peer,io}).send({id:n.id,body:n.body,task:'slot-'+name,type:'fyi'});
   await withWriter(root,async()=>{const current=await state(root,name,io);current.notices=current.notices.filter(x=>x.id!==n.id);await atomicJson(await ownedPath(root,['slots',name+'.json'],io),current,{io});},io);
  }catch{return {notificationPending:true};}
 }return {notificationPending:false};
}
async function once({root,name,as,action,to,force=false,reason,pid=process.pid,waitId,cancelled=false,io=fs}){
 root=absoluteRoot(root);slotName(name);address(as);if(to!==undefined)address(to);
 if(!['take','enqueue','give','leave','finish'].includes(action)||typeof force!=='boolean'||!Number.isInteger(pid)||pid<1||pid>2147483647)throw new RelayError('INVALID_ARGS');
 if(waitId!==undefined&&!/^[a-f0-9]{32}$/.test(waitId)||action==='finish'&&!waitId)throw new RelayError('INVALID_ARGS');
 if(force&&(action!=='take'||typeof reason!=='string'||!reason.trim()||reason.length>1000))throw new RelayError('FORCE_REASON_REQUIRED');
 const result=await withWriter(root,async()=>{
  const cfg=await configuration(root,io);if(!cfg.addresses[as]||(to&&!cfg.addresses[to]))throw new RelayError('UNKNOWN_ADDRESS');
  const s=await state(root,name,io);let ok=true,changed=false;
  const notice=(receiver,text)=>s.notices.push({id:randomBytes(16).toString('hex'),to:receiver,body:strings.SLOT_NOTICE_PREFIX+text});
  const grant=receiver=>{const waiter=s.queue.find(x=>x.as===receiver);s.holder=receiver?{as:receiver,since:new Date().toISOString(),waitId:waiter?.waitId??null}:null;s.queue=s.queue.filter(x=>x.as!==receiver);changed=true;};
  if(action==='take'){
   if(s.holder?.as===as){}else if(force){if(s.holder)notice(s.holder.as,render('SLOT_TAKE_NOTICE',{actor:as,name,reason}));grant(as);}
   else if(s.holder||s.queue.length&&s.queue[0].as!==as)ok=false;else grant(as);
  }else if(action==='enqueue'){
   if(s.holder?.as===as){}else if(!s.holder&&(!s.queue.length||s.queue[0].as===as))grant(as);
   else {ok=false;const existing=s.queue.find(x=>x.as===as);if(existing){if(existing.pid!==pid||waitId&&existing.waitId!==waitId)throw new RelayError('SLOT_WAITER_BUSY');}else{s.queue.push({as,pid,waitId:waitId??randomBytes(16).toString('hex')});changed=true;}}
  }else if(action==='give'){
   if(s.holder?.as!==as)ok=false;else{
    const receiver=to??s.queue[0]?.as??null;const waiter=s.queue.find(x=>x.as===receiver);
    if(receiver&&receiver!==as&&(!waiter||!alive(waiter.pid)))notice(receiver,render('SLOT_GIVE_NOTICE',{actor:as,name,recipient:receiver}));
    grant(receiver);
   }
  }else if(action==='finish'){
   const mine=s.holder?.as===as&&s.holder.waitId===waitId;ok=mine&&!cancelled;
   if(mine&&cancelled){const next=s.queue[0]??null;if(next&&!alive(next.pid))notice(next.as,render('SLOT_GIVE_NOTICE',{actor:as,name,recipient:next.as}));grant(next?.as??null);}
   const remaining=s.queue.filter(x=>!(x.as===as&&x.waitId===waitId));if(remaining.length!==s.queue.length)changed=true;s.queue=remaining;
  }else {const remaining=s.queue.filter(x=>x.as!==as);changed=remaining.length!==s.queue.length;s.queue=remaining;}
  let historyWarning=false;
  if(changed){const displaced=action==='take'&&force?(await state(root,name,io)).holder?.as:null;s.revision++;s.updatedAt=new Date().toISOString();await directory(root,['slots'],io);await atomicJson(await ownedPath(root,['slots',name+'.json'],io),s,{io});
   let h;try{h=await io.open(await ownedPath(root,['slots',name+'.log'],io),'a',0o600);await h.writeFile(JSON.stringify({at:s.updatedAt,revision:s.revision,action,as,to:to??s.holder?.as??null,force,displaced,reason:force?reason:undefined})+'\n');await h.sync();}catch{historyWarning=true;}finally{if(h)await h.close();}
  }return {ok,action,name,historyWarning};
 },io);
 const notices=await flush(root,name,io);return {...result,...notices,now:await list({root,io})};
}
export async function act(input){for(let i=0;;i++){try{return await once(input);}catch(e){if(e.code!=='WRITER_BUSY'||i>=15)throw e;await new Promise(r=>setTimeout(r,10));}}}
export async function history({root,name,lines=20,io=fs}){
 root=absoluteRoot(root);slotName(name);if(!Number.isInteger(lines)||lines<1||lines>1000)throw new RelayError('INVALID_ARGS');
 try{return (await io.readFile(await ownedPath(root,['slots',name+'.log'],io),'utf8')).trim().split('\n').filter(Boolean).slice(-lines);}catch(e){if(e.code==='ENOENT')return [];throw e;}
}
export async function wait({root,name,as,timeoutMs=240*60000,intervalMs=1000,signal,io=fs}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<0||!Number.isInteger(intervalMs)||intervalMs<1)throw new RelayError('INVALID_ARGS');
 const deadline=Date.now()+timeoutMs,waitId=randomBytes(16).toString('hex');let acquired=false,result;
 try{while(true){
  if(signal?.aborted||Date.now()>=deadline){result={ok:false,timeout:!signal?.aborted,cancelled:!!signal?.aborted};break;}
  try{result=await act({root,name,as,action:'enqueue',waitId,io});}catch(e){if(e.code!=='WRITER_BUSY')throw e;}
  if(result?.ok&&!signal?.aborted){acquired=true;break;}
  await new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};timer=setTimeout(done,Math.min(intervalMs,Math.max(1,deadline-Date.now())));signal?.addEventListener('abort',done,{once:true});if(signal?.aborted)done();});
 }}finally{if(!acquired){const finished=await act({root,name,as,action:'finish',waitId,cancelled:!!signal?.aborted,io});result={...finished,timeout:!finished.ok&&!signal?.aborted,cancelled:!!signal?.aborted};}}
 return {...result,now:await list({root,io})};
}
