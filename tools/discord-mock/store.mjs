import fs from 'node:fs/promises';
import { absoluteRoot,ownedPath,readJson,atomicJson,withWriter } from '../../lib/storage.mjs';
import { validateMessage } from '../../lib/message.mjs';
import { RelayError } from '../../lib/errors.mjs';
import { mockConfig,digest,formatPublish,validateTarget } from './policy.mjs';

const states=new Set(['queued','dispatch_claimed','transport_accepted','agent_reply_received','discord_publish_claimed','completed','held']);
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
export async function openMockStore({root,config,io=fs,now=Date.now}) {
  root=absoluteRoot(root);config=mockConfig(config);const config_digest=digest(config);
  for(const name of ['config.json','inbox','runtime']) {
    const file=await ownedPath(root,[name],io);
    try {await io.lstat(file);throw new RelayError('NOT_MOCK_ROOT');} catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const filename=()=>ownedPath(root,['mock-bridge.json'],io);
  function validate(l) {
    try {
      if(!record(l)||l.schemaVersion!==1||l.mode!=='mock'||l.config_digest!==config_digest||l.root!==root||typeof l.stopped!=='boolean'||!record(l.events)||!record(l.tasks)||!Array.isArray(l.dispatch_attempts)||l.dispatch_attempts.some(n=>!integer(n)))throw Error();
      if(Object.keys(l.tasks).length>config.maxRecords||Object.keys(l.events).length!==Object.keys(l.tasks).length||l.dispatch_attempts.length>config.dailyDispatches+config.hourlyDispatches)throw Error();
      let active=0,queued=0;const relays=new Set();
      for(const [key,t] of Object.entries(l.tasks)) {
        if(!record(t)||key!==t.task_id||!/^mock-task-[a-f0-9]{32}$/.test(key)||!states.has(t.state)||typeof t.inflight!=='boolean'||!record(t.attempts)||!integer(t.attempts.dispatch)||!integer(t.attempts.publish)||t.attempts.dispatch>config.maxAttempts||t.attempts.publish>config.maxAttempts||!integer(t.created_at)||!integer(t.updated_at)||!integer(t.next_attempt_at)||typeof t.body_pruned!=='boolean')throw Error();
        if(t.inflight)active++;if(t.state==='queued'&&!t.inflight)queued++;
        if(t.state!=='queued'&&t.state!=='completed'&&!t.inflight||t.state==='completed'&&t.inflight)throw Error();
        if(!record(t.envelope)||t.relay_id!==t.envelope.id||t.envelope.task!==key||t.envelope.from!=='discord-owner'||t.envelope.to!==config.session_address||t.envelope.type!=='question'||t.envelope.wake!==true)throw Error();
        validateMessage(t.body_pruned?{...t.envelope,body:'[pruned]'}:t.envelope);
        if(relays.has(t.relay_id))throw Error();relays.add(t.relay_id);
        const ek=JSON.stringify([config.route_id,t.target?.guild_id,t.target?.channel_id,t.target?.event_id]);
        if(t.event_key!==ek||t.task_id!=='mock-task-'+digest('task:'+ek).slice(0,32)||t.relay_id!==digest('relay:'+ek).slice(0,32))throw Error();
        const e=l.events[ek];if(!record(e)||e.task_id!==key||e.digest!==t.digest||!integer(e.expires_at))throw Error();
        if(!t.body_pruned&&t.digest!==digest([config.owner_id,config.command,t.envelope.body,t.target,t.envelope.createdAt]))throw Error();
        validateTarget(t.target,config);
        if(t.body_pruned&&(t.state!=='completed'||Object.hasOwn(t.envelope,'body')||t.result!==null))throw Error();
        if(t.result!==null) {if(t.result_digest!==digest(t.result))throw Error();formatPublish(t,t.result,config);}
        for(const [effect,claim] of [['dispatch',t.dispatch_claim],['publish',t.publish_claim]])if(claim!==null&&(!record(claim)||typeof claim.generation!=='string'||!claim.generation||!integer(claim.at)||!integer(claim.attempt)||claim.attempt!==t.attempts[effect]))throw Error();
        if(t.state==='dispatch_claimed'&&!t.dispatch_claim||t.state==='discord_publish_claimed'&&!t.publish_claim)throw Error();
      }
      if(active>1||queued>config.maxQueue)throw Error();
      return l;
    }catch(error){throw new RelayError('CORRUPT_MOCK_LEDGER',{cause:error});}
  }
  async function read(){const l=await readJson(root,['mock-bridge.json'],{io,corrupt:'CORRUPT_MOCK_LEDGER'});if(l===null)throw new RelayError('MISSING_MOCK_LEDGER');return structuredClone(validate(l));}
  function maintain(l) {
    const time=now();if(!integer(time))throw new RelayError('MOCK_CLOCK');
    const day=Date.parse(new Date(time).toISOString().slice(0,10)+'T00:00:00.000Z');
    l.dispatch_attempts=l.dispatch_attempts.filter(at=>at>=Math.min(day,time-3600000));
    for(const [id,t]of Object.entries(l.tasks))if(t.state==='completed'){
      if(time-t.updated_at>=config.bodyRetentionMs){delete t.envelope.body;t.result=null;t.body_pruned=true;}
      if(time>=l.events[t.event_key].expires_at&&time-t.updated_at>=config.bodyRetentionMs){delete l.events[t.event_key];delete l.tasks[id];}
    }
  }
  if(await readJson(root,['mock-bridge.json'],{io,corrupt:'CORRUPT_MOCK_LEDGER'})===null)await withWriter(root,async()=>{
    if(await readJson(root,['mock-bridge.json'],{io,corrupt:'CORRUPT_MOCK_LEDGER'})!==null)return;
    const initial={schemaVersion:1,mode:'mock',config_digest,root,stopped:false,events:{},tasks:{},dispatch_attempts:[]};
    await atomicJson(await filename(),initial,{io});
  },io);
  await read();let queue=Promise.resolve();
  return Object.freeze({read,transact(update){
    const run=()=>withWriter(root,async()=>{
      const l=await read();maintain(l);const result=update(l);
      if(result&&typeof result.then==='function')throw new RelayError('ASYNC_TRANSACTION');
      validate(l);await atomicJson(await filename(),l,{io});return structuredClone(result);
    },io);
    const next=queue.then(run);queue=next.catch(()=>{});return next;
  }});
}
