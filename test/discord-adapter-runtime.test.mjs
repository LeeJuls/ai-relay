import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {sandbox} from './fixture.mjs';
import {openAdapterRuntime} from '../tools/discord-adapter/runtime.mjs';
import {createPublisher} from '../tools/discord-adapter/publisher.mjs';
const config={application_id:'111111111111111111',command_id:'222222222222222222',guild_id:'333333333333333333',channel_id:'444444444444444444',owner_id:'555555555555555555',human_channel_ids:['666666666666666666'],command:'ask',session_address:'readonly-claude',route_id:'discord-test'};
const start=Date.UTC(2026,9,30,23,50);
function event(at=start,index=0){return {op:0,t:'INTERACTION_CREATE',d:{id:(((BigInt(at)-1420070400000n)<<22n)+BigInt(index)).toString(),application_id:config.application_id,type:2,guild_id:config.guild_id,channel_id:config.channel_id,channel:{id:config.channel_id,type:0},member:{user:{id:config.owner_id}},data:{id:config.command_id,name:'ask',type:1,options:[{name:'text',type:3,value:'short question'}]},token:'FAKE_EPHEMERAL'}};}
async function setup(t,options={}){const b=await sandbox(t);let at=start;const dispatches=[],publishes=[];
 const session={dispatch:async r=>{dispatches.push(r);return {state:'accepted'};}},publisher={publish:async r=>{publishes.push(r);return {state:'accepted',message_id:'777777777777777777'};}};
 const args={root:b.root,config,session,publisher,now:()=>at,...options};const runtime=await openAdapterRuntime(args);
 return {...b,args,runtime,dispatches,publishes,setTime:n=>{at=n;}};
}
test('durable single exchange claims before effects; explicit result; replay/reopen no duplicate or token persisted',async t=>{
 const b=await setup(t);const q=await b.runtime.receive(event());assert.equal(q.state,'queued');assert.equal((await b.runtime.receive(event())).state,'duplicate');assert.equal(b.dispatches.length,0);
 await b.runtime.tick();assert.equal(b.dispatches.length,1);assert.equal((await b.runtime.status()).inflight,1);assert.equal(b.publishes.length,0);
 await b.runtime.submitResult({task_id:q.task_id,result_text:'explicit answer'});await b.runtime.tick();assert.equal(b.publishes.length,1);assert.equal((await b.runtime.status()).completed,1);
 await b.runtime.close();const reopened=await openAdapterRuntime(b.args);await reopened.tick();assert.equal((await reopened.receive(event())).state,'duplicate');assert.equal(b.dispatches.length,1);assert.equal(b.publishes.length,1);
 const ledger=await fs.readFile(path.join(b.root,'discord-adapter.json'),'utf8');assert.equal(ledger.includes('FAKE_EPHEMERAL'),false);assert.equal((await reopened.status()).actual_tokens,null);
});
test('dispatch and publish claims are on disk before external effect',async t=>{
 const b=await sandbox(t);let runtime,q;
 const read=async()=>JSON.parse(await fs.readFile(path.join(b.root,'discord-adapter.json'),'utf8'));
 runtime=await openAdapterRuntime({root:b.root,config,now:()=>start,session:{dispatch:async()=>{assert.equal((await read()).tasks[q.task_id].state,'dispatch_claimed');return {state:'accepted'};}},publisher:{publish:async()=>{assert.equal((await read()).tasks[q.task_id].state,'discord_publish_claimed');return {state:'accepted',message_id:'777777777777777777'};}}});
 q=await runtime.receive(event());await runtime.tick();await runtime.submitResult({task_id:q.task_id,result_text:'answer'});await runtime.tick();assert.equal((await runtime.status()).completed,1);
});
test('bounded queue, one inflight and concurrent ticks, stopped new dispatch but existing publish finishes',async t=>{
 const b=await setup(t);const q=await b.runtime.receive(event());await Promise.all([b.runtime.tick(),b.runtime.tick()]);assert.equal(b.dispatches.length,1);
 for(let i=1;i<=8;i++)assert.equal((await b.runtime.receive(event(start,i))).state,'queued');assert.equal((await b.runtime.receive(event(start,9))).code,'QUEUE_FULL');
 await b.runtime.stop();await b.runtime.submitResult({task_id:q.task_id,result_text:'answer'});await b.runtime.tick();await b.runtime.tick();assert.equal(b.publishes.length,1);assert.equal(b.dispatches.length,1);assert.equal((await b.runtime.status()).queued,8);
});
test('uncertain dispatch and publisher outcomes hold route without retry, including restart',async t=>{
 for(const effect of ['dispatch','publish']){const b=await setup(t,effect==='dispatch'?{session:{dispatch:async()=>({state:'uncertain'})}}:{publisher:{publish:async()=>{throw Error('secret');}}});
 const q=await b.runtime.receive(event());await b.runtime.tick();if(effect==='publish'){await b.runtime.submitResult({task_id:q.task_id,result_text:'answer'});await b.runtime.tick();}
 assert.equal((await b.runtime.status()).held,1);await b.runtime.close();const r=await openAdapterRuntime(b.args);await r.tick();assert.equal((await r.status()).held,1);
 }
});
test('interrupted claims recovered to held and different config rejected before recovery mutation',async t=>{
 const b=await setup(t);const q=await b.runtime.receive(event());await b.runtime.tick();await b.runtime.close();const file=path.join(b.root,'discord-adapter.json');const ledger=JSON.parse(await fs.readFile(file,'utf8'));ledger.tasks[q.task_id].state='dispatch_claimed';ledger.tasks[q.task_id].outcomes.dispatch=null;await fs.writeFile(file,JSON.stringify(ledger));
 const before=await fs.readFile(file,'utf8');await assert.rejects(openAdapterRuntime({...b.args,config:{...config,session_address:'other'}}));assert.equal(await fs.readFile(file,'utf8'),before);
 const r=await openAdapterRuntime(b.args);assert.equal((await r.status()).held,1);
});
test('certain not_sent retries same task once; exhausts to held and respects retry time',async t=>{
 let n=0;const b=await setup(t,{session:{dispatch:async()=>{n++;return {state:'not_sent'};}}});const q=await b.runtime.receive(event());await b.runtime.tick();await b.runtime.tick();assert.equal(n,1);b.setTime(start+1000);await b.runtime.tick();assert.equal(n,2);assert.equal((await b.runtime.status()).held,1);assert.equal(q.task_id,(await b.runtime.receive(event())).task_id);
});
test('result target override/conflict is denied, duplicate result harmless, only transport accepted may answer',async t=>{
 const b=await setup(t),q=await b.runtime.receive(event());await assert.rejects(b.runtime.submitResult({task_id:q.task_id,result_text:'answer'}));await b.runtime.tick();await assert.rejects(b.runtime.submitResult({task_id:q.task_id,result_text:'answer',channel_id:config.channel_id}));await b.runtime.submitResult({task_id:q.task_id,result_text:'answer'});assert.equal((await b.runtime.submitResult({task_id:q.task_id,result_text:'answer'})).state,'duplicate');await assert.rejects(b.runtime.submitResult({task_id:q.task_id,result_text:'different'}));
});
test('six dispatches per hour then no idle effects; next UTC day accounting and expiry prune',async t=>{
 const b=await setup(t);for(let i=0;i<6;i++){const q=await b.runtime.receive(event(start,i));await b.runtime.tick();await b.runtime.submitResult({task_id:q.task_id,result_text:'answer'});await b.runtime.tick();}
 await b.runtime.receive(event(start,7));await b.runtime.tick();assert.equal(b.dispatches.length,6);b.setTime(start+3600001);await b.runtime.tick();assert.equal(b.dispatches.length,7);
 b.setTime(start+86400001);await b.runtime.tick();const l=JSON.parse(await fs.readFile(path.join(b.root,'discord-adapter.json'),'utf8'));assert.ok(Object.values(l.tasks).some(x=>x.body_pruned));
});
test('normal relay/mock roots, corrupt ledger and closed runtime refuse effects',async t=>{
 const b=await setup(t);await b.runtime.close();await assert.rejects(b.runtime.tick());await assert.rejects(b.runtime.receive(event()));
 await fs.writeFile(path.join(b.root,'discord-adapter.json'),'null');await assert.rejects(openAdapterRuntime(b.args));
 const c=await sandbox(t);await fs.mkdir(c.root,{recursive:true});await fs.writeFile(path.join(c.root,'mock-bridge.json'),'{}');await assert.rejects(openAdapterRuntime({...b.args,root:c.root}));
});
test('fake REST integration publishes exact result only; no follow-up agent execution',async t=>{
 let sends=0;const publisher=createPublisher({config,now:()=>start,request:async r=>{sends++;return {status:200,body:{id:'777777777777777777',channel_id:config.channel_id,nonce:r.body.nonce}};}});
 const b=await setup(t,{publisher}),q=await b.runtime.receive(event());await b.runtime.tick();await b.runtime.submitResult({task_id:q.task_id,result_text:'answer'});await b.runtime.tick();for(let i=0;i<50;i++)await b.runtime.tick();assert.equal(b.dispatches.length,1);assert.equal(sends,1);assert.equal((await b.runtime.status()).completed,1);
});
test('daily dispatch budget survives reopen and renews only at next UTC day',async t=>{
 const b=await setup(t);const midnight=Date.UTC(2026,9,31);
 for(let i=0;i<20;i++){const at=midnight+i*3600001;b.setTime(at);const q=await b.runtime.receive(event(at));await b.runtime.tick();await b.runtime.submitResult({task_id:q.task_id,result_text:'answer'});await b.runtime.tick();}
 const next=midnight+20*3600001;b.setTime(next);await b.runtime.receive(event(next));await b.runtime.tick();assert.equal(b.dispatches.length,20);await b.runtime.close();const r=await openAdapterRuntime(b.args);await r.tick();assert.equal(b.dispatches.length,20);b.setTime(midnight+86400000);await r.tick();assert.equal(b.dispatches.length,21);
});
test('post-effect writer failure leaves durable claim, disables instance and recovers held',async t=>{
 const b=await sandbox(t),lock=path.join(b.root,'.writer.lock');let calls=0;
 const args={root:b.root,config,now:()=>start,session:{dispatch:async()=>{calls++;await fs.writeFile(lock,'test-only lock');return {state:'accepted'};}},publisher:{publish:async()=>assert.fail('no publication')}};
 const r=await openAdapterRuntime(args);await r.receive(event());await assert.rejects(r.tick());await assert.rejects(r.tick());assert.equal(calls,1);
 await fs.unlink(lock);const reopened=await openAdapterRuntime(args);assert.equal((await reopened.status()).held,1);await reopened.tick();assert.equal(calls,1);
});
test('interrupted publish claim never re-sends after recovery',async t=>{
 const b=await setup(t),q=await b.runtime.receive(event());await b.runtime.tick();await b.runtime.submitResult({task_id:q.task_id,result_text:'answer'});await b.runtime.close();
 const file=path.join(b.root,'discord-adapter.json'),l=JSON.parse(await fs.readFile(file,'utf8'));l.tasks[q.task_id].state='discord_publish_claimed';l.tasks[q.task_id].publish_claim={generation:'interrupted-test',at:start};l.tasks[q.task_id].attempts.publish=1;await fs.writeFile(file,JSON.stringify(l));
 const r=await openAdapterRuntime(b.args);await r.tick();assert.equal((await r.status()).held,1);assert.equal(b.publishes.length,0);
});
test('callback mutation after return cannot turn uncertain into a retry, dispatch or publish',async t=>{
 for(const effect of ['dispatch','publish']){
  let calls=0;const unstable=async()=>{calls++;const outcome={state:'uncertain'};queueMicrotask(()=>queueMicrotask(()=>{outcome.state='not_sent';}));return outcome;};
  const b=await setup(t,effect==='dispatch'?{session:{dispatch:unstable}}:{publisher:{publish:unstable}}),q=await b.runtime.receive(event());await b.runtime.tick();
  if(effect==='publish'){await b.runtime.submitResult({task_id:q.task_id,result_text:'answer'});await b.runtime.tick();}
  assert.equal((await b.runtime.status()).held,1);b.setTime(start+1000);await b.runtime.tick();assert.equal(calls,1);
 }
});
test('single-field corruption cannot requeue completed work or forge a retry without certainty evidence',async t=>{
 const b=await setup(t),q=await b.runtime.receive(event());await b.runtime.tick();await b.runtime.submitResult({task_id:q.task_id,result_text:'answer'});await b.runtime.tick();await b.runtime.close();
 const file=path.join(b.root,'discord-adapter.json'),original=await fs.readFile(file,'utf8');
 for(const mutate of [t=>t.state='queued',t=>t.attempts.dispatch=0,t=>t.result_digest=null,t=>t.publish_claim=null,t=>t.message_id='invalid']){
  const l=JSON.parse(original);mutate(l.tasks[q.task_id]);await fs.writeFile(file,JSON.stringify(l));await assert.rejects(openAdapterRuntime(b.args),e=>e.code==='CORRUPT_ADAPTER_LEDGER');
 }
 assert.equal(b.dispatches.length,1);assert.equal(b.publishes.length,1);
 const retry=await setup(t,{session:{dispatch:async()=>({state:'not_sent'})}}),queued=await retry.runtime.receive(event());await retry.runtime.tick();await retry.runtime.close();
 const retryFile=path.join(retry.root,'discord-adapter.json'),l=JSON.parse(await fs.readFile(retryFile,'utf8'));l.tasks[queued.task_id].outcomes.dispatch=null;await fs.writeFile(retryFile,JSON.stringify(l));await assert.rejects(openAdapterRuntime(retry.args),e=>e.code==='CORRUPT_ADAPTER_LEDGER');
});
test('equivalent reordered config and human-channel set reopen the same ledger',async t=>{
 const c={...config,human_channel_ids:[...config.human_channel_ids,'888888888888888888']},b=await setup(t,{config:c});await b.runtime.receive(event());await b.runtime.close();
 const reordered=Object.fromEntries(Object.entries(c).reverse());reordered.human_channel_ids.reverse();const reopened=await openAdapterRuntime({...b.args,config:reordered});assert.equal((await reopened.status()).queued,1);
});
test('durable ACK claim gates dispatch; duplicate never authorizes another ACK; generation pinned',async t=>{
 const b=await setup(t),q=await b.runtime.receiveForAck(event());assert.equal(q.state,'ack_claimed');assert.ok(q.generation);await b.runtime.tick();assert.equal(b.dispatches.length,0);assert.equal((await b.runtime.receiveForAck(event())).state,'duplicate');
 assert.equal((await b.runtime.finishAcknowledgement({...q,state:'accepted',generation:'wrong'})).state,'ignored');await b.runtime.tick();assert.equal(b.dispatches.length,0);
 await b.runtime.finishAcknowledgement({task_id:q.task_id,generation:q.generation,state:'accepted'});await b.runtime.tick();assert.equal(b.dispatches.length,1);
});
test('ACK uncertain/definite failure or interrupted claim holds route across reopen with zero dispatch',async t=>{
 for(const state of ['uncertain','not_sent','interrupted']){const b=await setup(t),q=await b.runtime.receiveForAck(event());if(state!=='interrupted')await b.runtime.finishAcknowledgement({task_id:q.task_id,generation:q.generation,state});await b.runtime.close();const r=await openAdapterRuntime(b.args);await r.tick();assert.equal(b.dispatches.length,0);assert.equal((await r.status()).held,1);assert.equal((await r.receiveForAck(event())).state,'duplicate');}
});
