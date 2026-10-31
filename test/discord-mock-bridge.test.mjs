import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {sandbox} from './fixture.mjs';
import {mockConfig} from '../tools/discord-mock/policy.mjs';
import {openMockStore} from '../tools/discord-mock/store.mjs';
const start=Date.parse('2026-10-31T00:00:00.000Z');
async function setup(t,options={}){
 const {openMockBridge}=await import('../tools/discord-mock/bridge.mjs'),{fakeSession,fakePublisher,fakeDiscord,fakeClock}=await import('../tools/discord-mock/fakes.mjs');
 const b=await sandbox(t),clock=fakeClock(start),config=mockConfig(options.config),io=options.io??Object.create(fs);
 const store=await openMockStore({root:b.root,config,io,now:clock.now}),session=fakeSession(options.sessionOutcomes),publisher=fakePublisher(options.publisherOutcomes);
 const open=()=>openMockBridge({store,config,session,publisher,now:clock.now}),bridge=await open();
 const event=(id='e1',extra={})=>fakeDiscord({event_id:id,created_at:new Date(clock.now()).toISOString(),...extra});
 return {...b,clock,config,io,store,session,publisher,bridge,open,event};
}
const accept={state:'accepted',code:'FAKE_ACCEPTED'},notSent={state:'not_sent',code:'FAKE_NOT_SENT'},uncertain={state:'uncertain',code:'FAKE_TIMEOUT'};
async function finish(b,id){await b.bridge.submitResult({task_id:id,result_text:'answer'});await b.bridge.tick();}

test('idle and rejected origins cause no session or publisher effect and save no body',async t=>{
 const b=await setup(t);for(let i=0;i<100;i++)await b.bridge.tick();
 for(const e of [{owner_id:'other'},{guild_id:'other'},{channel_id:'human'},{command:'chat'},{author_bot:true},{webhook_id:'hook'},{thread_id:'thread'},{attachments:['file']},{mentions:['user']},{text:'x'.repeat(4097)}])assert.equal((await b.bridge.ingest(b.event('bad',e))).state,'rejected');
 assert.equal(b.session.calls.length,0);assert.equal(b.publisher.calls.length,0);assert.deepEqual((await b.store.read()).tasks,{});
});
test('claim is durable before each effect and explicit result alone enables original-target publishing',async t=>{
 const b=await setup(t);const saved=await b.bridge.ingest(b.event());
 b.session.dispatch=async req=>{assert.equal((await b.store.read()).tasks[saved.task_id].state,'dispatch_claimed');b.session.calls.push(req);return accept;};
 b.publisher.publish=async req=>{assert.equal((await b.store.read()).tasks[saved.task_id].state,'discord_publish_claimed');b.publisher.calls.push(req);return accept;};
 await b.bridge.tick();assert.equal((await b.bridge.status()).completed,0);assert.equal(b.publisher.calls.length,0);
 await b.bridge.submitResult({task_id:saved.task_id,result_text:'@everyone hello'});await b.bridge.tick();
 assert.equal(b.session.calls.length,1);assert.equal(b.publisher.calls.length,1);assert.equal((await b.bridge.status()).completed,1);
 assert.deepEqual(b.publisher.calls[0].target,{guild_id:'mock-guild',channel_id:'mock-ai',event_id:'e1'});assert.deepEqual(b.publisher.calls[0].allowed_mentions,{parse:[],replied_user:false});assert.equal(b.publisher.calls[0].text.includes('@everyone'),false);
});
test('event replay changed content and completed replay never create a second execution',async t=>{
 const b=await setup(t),event=b.event(),a=await b.bridge.ingest(event);
 assert.equal((await b.bridge.ingest(event)).state,'duplicate');assert.equal((await b.bridge.ingest({...event,text:'changed'})).code,'EVENT_CONFLICT');
 await Promise.all([b.bridge.tick(),b.bridge.tick()]);await finish(b,a.task_id);
 const next=await b.open();assert.equal((await next.ingest(event)).task_id,a.task_id);await next.tick();assert.equal(b.session.calls.length,1);assert.equal(b.publisher.calls.length,1);
});
test('accepted state and queued mail survive reopen without resend or parallel inflight',async t=>{
 const b=await setup(t),a=await b.bridge.ingest(b.event());await b.bridge.tick();await b.bridge.ingest(b.event('e2'));
 const next=await b.open();await next.tick();assert.equal(b.session.calls.length,1);assert.equal((await next.status()).queued,1);
 await next.submitResult({task_id:a.task_id,result_text:'answer'});const again=await b.open();await again.tick();assert.equal(b.publisher.calls.length,1);await again.tick();assert.equal(b.session.calls.length,2);
});
for(const effect of ['dispatch','publish']){
 test(`${effect} only proven not_sent retries with same ID at 1000ms boundary`,async t=>{
  const b=await setup(t,effect==='dispatch'?{sessionOutcomes:[notSent,accept]}:{publisherOutcomes:[notSent,accept]}),a=await b.bridge.ingest(b.event());await b.bridge.tick();
  const target=effect==='dispatch'?b.session:b.publisher;
  if(effect==='publish'){await b.bridge.submitResult({task_id:a.task_id,result_text:'answer'});await b.bridge.tick();}
  b.clock.advance(999);await b.bridge.tick();assert.equal(target.calls.length,1);b.clock.advance(1);await b.bridge.tick();assert.equal(target.calls.length,2);
  const ids=target.calls.map(x=>effect==='dispatch'?x.envelope.id:x.task_id);assert.equal(ids[0],ids[1]);
 });
 test(`${effect} exhausted certain failures hold the route and survive restart`,async t=>{
  const b=await setup(t,effect==='dispatch'?{sessionOutcomes:[notSent,notSent]}:{publisherOutcomes:[notSent,notSent]}),a=await b.bridge.ingest(b.event());await b.bridge.tick();
  if(effect==='publish'){await b.bridge.submitResult({task_id:a.task_id,result_text:'answer'});await b.bridge.tick();}
  b.clock.advance(1000);await b.bridge.tick();const n=await b.open();await n.ingest(b.event('e2'));b.clock.advance(5000);await n.tick();assert.equal((await n.status()).held,1);assert.equal((effect==='dispatch'?b.session:b.publisher).calls.length,2);
 });
 for(const outcome of [uncertain,new Error('simulated fault'),{state:'bad'}])test(`${effect} ambiguous ${outcome instanceof Error?'exception':outcome.state} is held across reopen`,async t=>{
  const b=await setup(t,effect==='dispatch'?{sessionOutcomes:[outcome]}:{publisherOutcomes:[outcome]}),a=await b.bridge.ingest(b.event());await b.bridge.tick();
  if(effect==='publish'){await b.bridge.submitResult({task_id:a.task_id,result_text:'answer'});await b.bridge.tick();}
  const n=await b.open();await n.ingest(b.event('e2'));await n.tick();assert.equal((await n.status()).held,1);assert.equal((effect==='dispatch'?b.session:b.publisher).calls.length,1);
  const held=(await b.store.read()).tasks[a.task_id];assert.equal(held.held_effect,effect);assert.equal(held.last_outcome,'uncertain');
 });
 test(`${effect} claim-save failure cannot call the effect`,async t=>{
  const b=await setup(t),a=await b.bridge.ingest(b.event());if(effect==='publish'){await b.bridge.tick();await b.bridge.submitResult({task_id:a.task_id,result_text:'answer'});}
  b.io.rename=async()=>{throw Object.assign(Error(),{code:'EACCES'});};await assert.rejects(b.bridge.tick());assert.equal((effect==='dispatch'?b.session:b.publisher).calls.length,0);
 });
 test(`${effect} effect succeeded but receipt-save failed is held not replayed`,async t=>{
  const b=await setup(t),a=await b.bridge.ingest(b.event());if(effect==='publish'){await b.bridge.tick();await b.bridge.submitResult({task_id:a.task_id,result_text:'answer'});}
  const target=effect==='dispatch'?b.session:b.publisher,key=effect==='dispatch'?'dispatch':'publish';
  target[key]=async req=>{target.calls.push(req);b.io.rename=async()=>{throw Object.assign(Error(),{code:'EACCES'});};return accept;};
  await assert.rejects(b.bridge.tick());delete b.io.rename;const next=await b.open();await next.tick();assert.equal((await next.status()).held,1);assert.equal(target.calls.length,1);
 });
}
test('second bridge holds outstanding claim and ignores old delayed successful return',async t=>{
 const b=await setup(t);await b.bridge.ingest(b.event());let release,entered;const ready=new Promise(r=>entered=r);
 b.session.dispatch=async req=>{b.session.calls.push(req);entered();return new Promise(r=>release=r);};
 const pending=b.bridge.tick();await ready;const next=await b.open();release(accept);await pending;await next.tick();assert.equal((await next.status()).held,1);assert.equal(b.session.calls.length,1);
});
test('single inflight finite queue and cap fail closed',async t=>{
 const b=await setup(t,{config:{maxQueue:2,maxRecords:4}});const a=await b.bridge.ingest(b.event());await b.bridge.tick();
 await b.bridge.ingest(b.event('e2'));await b.bridge.ingest(b.event('e3'));assert.equal((await b.bridge.ingest(b.event('e4'))).code,'QUEUE_FULL');
 await b.bridge.tick();assert.equal(b.session.calls.length,1);await finish(b,a.task_id);await b.bridge.tick();await b.bridge.ingest(b.event('e4'));assert.equal((await b.bridge.ingest(b.event('e5'))).code,'RECORD_LIMIT');
});
test('unknown premature conflicting or destination-bearing results are rejected; same result is idempotent',async t=>{
 const b=await setup(t),a=await b.bridge.ingest(b.event());
 await assert.rejects(b.bridge.submitResult({task_id:a.task_id,result_text:'early'}));await assert.rejects(b.bridge.submitResult({task_id:'mock-task-'+'a'.repeat(32),result_text:'unknown'}));
 await b.bridge.tick();await assert.rejects(b.bridge.submitResult({task_id:a.task_id,result_text:'ok',channel_id:'human'}));
 await b.bridge.submitResult({task_id:a.task_id,result_text:'answer'});await b.bridge.submitResult({task_id:a.task_id,result_text:'answer'});await assert.rejects(b.bridge.submitResult({task_id:a.task_id,result_text:'different'}));await b.bridge.tick();await b.bridge.submitResult({task_id:a.task_id,result_text:'answer'});await b.bridge.tick();assert.equal(b.publisher.calls.length,1);
});
test('stop is persistent new-dispatch suppression while running result and publish can finish',async t=>{
 const b=await setup(t),a=await b.bridge.ingest(b.event());await b.bridge.tick();await b.bridge.stop();await b.bridge.ingest(b.event('e2'));await finish(b,a.task_id);
 const n=await b.open();await n.tick();assert.equal(b.session.calls.length,1);assert.equal(b.publisher.calls.length,1);assert.equal((await n.status()).stopped,true);assert.equal((await n.status()).queued,1);
});
test('hourly and UTC-daily dispatch quotas persist through restart',async t=>{
 const b=await setup(t,{config:{hourlyDispatches:2,dailyDispatches:3}});
 for(let i=1;i<=2;i++){const a=await b.bridge.ingest(b.event('e'+i));await b.bridge.tick();await finish(b,a.task_id);}
 const third=await b.bridge.ingest(b.event('e3'));await b.bridge.tick();assert.equal(b.session.calls.length,2);b.clock.advance(3600000);const n=await b.open();await n.tick();assert.equal(b.session.calls.length,3);await n.submitResult({task_id:third.task_id,result_text:'answer'});await n.tick();
 await n.ingest(b.event('e4'));b.clock.advance(3600000);await n.tick();assert.equal(b.session.calls.length,3);b.clock.advance(86400000);await n.tick();assert.equal(b.session.calls.length,4);
});
test('expired input cannot be replayed after completed body and tombstone cleanup',async t=>{
 const b=await setup(t),event=b.event(),a=await b.bridge.ingest(event);await b.bridge.tick();await finish(b,a.task_id);b.clock.advance(604800001);await b.bridge.tick();assert.equal((await b.bridge.ingest(event)).state,'rejected');assert.equal(Object.keys((await b.store.read()).tasks).length,0);
});
test('bridge refuses quota or session config mismatch before any ledger mutation',async t=>{
 const b=await setup(t,{config:{hourlyDispatches:1}}),{openMockBridge}=await import('../tools/discord-mock/bridge.mjs'),before=await b.store.read();
 for(const config of [mockConfig(),mockConfig({hourlyDispatches:1,session_address:'other-session'})])await assert.rejects(openMockBridge({store:b.store,config,session:b.session,publisher:b.publisher,now:b.clock.now}),{code:'MOCK_CONFIG_MISMATCH'});
 assert.deepEqual(await b.store.read(),before);assert.equal(b.session.calls.length,0);
});
test('maximum age inclusive replay keeps its tombstone until it is no longer admissible',async t=>{
 const b=await setup(t,{config:{maxEventAgeMs:1000,futureSkewMs:1000,bodyRetentionMs:1000,dedupRetentionMs:2001}}),event=b.event('future',{created_at:new Date(start+1000).toISOString()}),a=await b.bridge.ingest(event);
 await b.bridge.tick();await finish(b,a.task_id);b.clock.advance(2000);assert.equal((await b.bridge.ingest(event)).state,'duplicate');await b.bridge.tick();assert.equal(b.session.calls.length,1);
 b.clock.advance(1);await b.bridge.tick();assert.equal((await b.bridge.ingest(event)).state,'rejected');assert.equal(b.session.calls.length,1);
});
test('one-character output policy can ingest dispatch and publish a one-character result',async t=>{
 const b=await setup(t,{config:{maxOutputUnits:1,maxOutputBytes:1}}),a=await b.bridge.ingest(b.event());await b.bridge.tick();await b.bridge.submitResult({task_id:a.task_id,result_text:'x'});await b.bridge.tick();assert.equal((await b.bridge.status()).completed,1);assert.equal(b.publisher.calls[0].text,'x');
});
test('overdue incomplete tasks are marked for inspection without exposing their bodies',async t=>{
 const b=await setup(t);await b.bridge.ingest(b.event());await b.bridge.tick();b.clock.advance(86400000);const status=await b.bridge.status();assert.equal(status.inspection_required,1);assert.equal(JSON.stringify(status).includes('mock question'),false);
});
test('concurrent identical ingestion saves a single task and dispatch',async t=>{
 const b=await setup(t),e=b.event(),out=await Promise.all([b.bridge.ingest(e),b.bridge.ingest(e)]);assert.deepEqual(out.map(r=>r.state).sort(),['duplicate','queued']);await Promise.all([b.bridge.tick(),b.bridge.tick()]);assert.equal(Object.keys((await b.store.read()).tasks).length,1);assert.equal(b.session.calls.length,1);
});
test('second bridge holds an outstanding publish claim and ignores late publish success',async t=>{
 const b=await setup(t),a=await b.bridge.ingest(b.event());await b.bridge.tick();await b.bridge.submitResult({task_id:a.task_id,result_text:'answer'});let release,entered;const ready=new Promise(r=>entered=r);
 b.publisher.publish=async req=>{b.publisher.calls.push(req);entered();return new Promise(r=>release=r);};const pending=b.bridge.tick();await ready;const next=await b.open();release(accept);await pending;await next.tick();assert.equal((await next.status()).held,1);assert.equal(b.publisher.calls.length,1);
});
test('stop during pending dispatch preserves its late result but blocks the next queued dispatch',async t=>{
 const b=await setup(t),a=await b.bridge.ingest(b.event());let release,entered;const ready=new Promise(r=>entered=r);
 b.session.dispatch=async req=>{b.session.calls.push(req);entered();return new Promise(r=>release=r);};const pending=b.bridge.tick();await ready;await b.bridge.stop();await b.bridge.ingest(b.event('e2'));release(accept);await pending;
 await Promise.all([b.bridge.submitResult({task_id:a.task_id,result_text:'answer'}),b.bridge.stop()]);await b.bridge.tick();await b.bridge.tick();assert.equal(b.session.calls.length,1);assert.equal(b.publisher.calls.length,1);assert.equal((await b.bridge.status()).queued,1);
});
test('separate stores opened concurrently fail closed or share one initialized ledger',async t=>{
 const b=await sandbox(t),config=mockConfig();const results=await Promise.allSettled([openMockStore({root:b.root,config}),openMockStore({root:b.root,config})]);
 assert.ok(results.some(r=>r.status==='fulfilled'));for(const r of results)if(r.status==='rejected')assert.equal(r.reason.code,'WRITER_BUSY');
 for(const r of results)if(r.status==='fulfilled')assert.deepEqual((await r.value.read()).tasks,{});
});
