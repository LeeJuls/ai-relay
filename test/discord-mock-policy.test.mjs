import test from 'node:test';
import assert from 'node:assert/strict';

const now = Date.parse('2026-10-31T00:00:00.000Z');
const event = changes => ({ event_id:'event-1', guild_id:'mock-guild', channel_id:'mock-ai', owner_id:'mock-owner', command:'ask', text:'질문', created_at:new Date(now).toISOString(), author_bot:false, webhook_id:null, thread_id:null, attachments:[], mentions:[], ...changes });
const policy = () => import('../tools/discord-mock/policy.mjs');

test('exact owner guild channel and command are required before routing', async () => {
  const {mockConfig,validateEvent}=await policy();
  for (const change of [{owner_id:'other'},{guild_id:'other'},{channel_id:'human'},{command:'chat'},{author_bot:true},{webhook_id:'hook'},{thread_id:'thread'},{attachments:['file']},{mentions:['user']},{action:'send'}]) {
    assert.equal(validateEvent(event(change),mockConfig(),now).accepted,false,JSON.stringify(change));
  }
  assert.equal(validateEvent(event(),mockConfig(),now).accepted,true);
});
test('malformed types timestamps and expired or future events fail closed', async () => {
  const {mockConfig,validateEvent}=await policy();
  for (const change of [{author_bot:'false'},{event_id:''},{created_at:'bad'},{created_at:new Date(now-300001).toISOString()},{created_at:new Date(now+30001).toISOString()},{webhook_id:undefined},{text:''},{text:'  '},{text:'\ud800'},{mentions:null}]) assert.equal(validateEvent(event(change),mockConfig(),now).accepted,false);
  assert.equal(validateEvent(event({created_at:new Date(now-300000).toISOString()}),mockConfig(),now).accepted,true);
});
test('input byte limit distinguishes multibyte payloads at the exact boundary', async () => {
  const {mockConfig,validateEvent}=await policy();
  assert.equal(validateEvent(event({text:'한'.repeat(1365)+'a'}),mockConfig(),now).accepted,true);
  assert.equal(validateEvent(event({text:'한'.repeat(1365)+'ab'}),mockConfig(),now).accepted,false);
});
test('IDs and envelope are stable across time and distinct across events', async () => {
  const {mockConfig,validateEvent}=await policy(), c=mockConfig();
  const a=validateEvent(event(),c,now), b=validateEvent(event(),c,now+1000), d=validateEvent(event({event_id:'event-2'}),c,now);
  assert.deepEqual(a,b); assert.notEqual(a.ids.relay_id,d.ids.relay_id); assert.notEqual(a.ids.task_id,d.ids.task_id);
  assert.match(a.ids.relay_id,/^[a-f0-9]{32}$/); assert.match(a.ids.task_id,/^mock-task-[a-f0-9]{32}$/);
  assert.equal(a.ids.relay_id,'49fde0e68c80564505adc2418f62287b');
  assert.equal(a.envelope.task,a.ids.task_id); assert.equal(a.envelope.from,'discord-owner'); assert.equal(a.envelope.to,'mock-session'); assert.equal(a.envelope.createdAt,'2026-10-31T00:00:00.000Z');
  assert.equal(a.envelope.wake,true); assert.equal(a.envelope.type,'question');
});
test('result accepts only task_id result_text and enforces both Unicode and byte limits', async () => {
  const {mockConfig,validateResult}=await policy(), c=mockConfig(), task_id='mock-task-'+'a'.repeat(32);
  for (const result_text of ['a'.repeat(1800),'한'.repeat(1365)+'a']) assert.equal(validateResult({task_id,result_text},c).result_text,result_text);
  for (const result_text of ['a'.repeat(1801),'한'.repeat(1365)+'ab','','\ud800']) assert.throws(()=>validateResult({task_id,result_text},c));
  assert.throws(()=>validateResult({task_id,result_text:'ok',channel_id:'human'},c));
  assert.throws(()=>validateResult({task_id:'unknown',result_text:'ok'},c));
});
test('publisher target is saved task target with suppressed mentions and final size check', async () => {
  const {mockConfig,formatPublish}=await policy(), c=mockConfig();
  const task={task_id:'mock-task-'+'a'.repeat(32),target:{guild_id:'mock-guild',channel_id:'mock-ai',event_id:'event-1'}};
  const out=formatPublish(task,'@everyone <@123>',c);
  assert.deepEqual(out.target,{guild_id:'mock-guild',channel_id:'mock-ai',event_id:'event-1'});
  assert.deepEqual(out.allowed_mentions,{parse:[],replied_user:false}); assert.equal(out.text.includes('@everyone'),false);
  assert.throws(()=>formatPublish(task,'@'.repeat(1000),c));
});
test('configuration rejects live mode invalid and unlimited bounds', async () => {
  const {mockConfig}=await policy();
  for (const changes of [{mode:'live'},{maxQueue:0},{maxQueue:Infinity},{maxAttempts:0},{maxRecords:0},{mystery:1}]) assert.throws(()=>mockConfig(changes));
  assert.equal(Object.isFrozen(mockConfig()),true);
});
test('dedup lifetime must exceed the entire inclusive event acceptance window',async()=>{
 const {mockConfig}=await policy();assert.throws(()=>mockConfig({maxEventAgeMs:1000,futureSkewMs:1000,bodyRetentionMs:1000,dedupRetentionMs:2000}),{code:'MOCK_CONFIG'});
});
test('result task_id must be a string rather than a coercible array',async()=>{
 const {mockConfig,validateResult}=await policy();assert.throws(()=>validateResult({task_id:['mock-task-'+'a'.repeat(32)],result_text:'ok'},mockConfig()),{code:'INVALID_RESULT'});
});
