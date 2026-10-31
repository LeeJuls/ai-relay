import test from 'node:test';
import assert from 'node:assert/strict';
import {mockConfig} from '../tools/discord-mock/policy.mjs';
import {fakeDiscord} from '../tools/discord-mock/fakes.mjs';
import {fakeClock,fakeSession,fakePublisher} from '../tools/discord-mock/fakes.mjs';
import {sandbox} from './fixture.mjs';
import {openMockStore} from '../tools/discord-mock/store.mjs';
import {openMockBridge} from '../tools/discord-mock/bridge.mjs';
const now=Date.parse('2026-10-31T00:00:00.000Z');
const route=agent=>mockConfig({route_id:'mock-'+agent,session_address:'mock-'+agent});
const routes=()=>({claude:route('claude'),codex:route('codex')});
const assignment=changes=>({mode:'offline',agent:'claude',event:fakeDiscord(),...changes});
const load=()=>import('../tools/discord-mock/connection-contract.mjs');

test('explicit human assignment selects only the pinned Claude or Codex route',async()=>{
 const {planAssignment}=await load();for(const agent of ['claude','codex']){
  const out=planAssignment(assignment({agent}),routes(),now);assert.equal(out.accepted,true);assert.equal(out.mode,'offline');assert.equal(out.agent,agent);assert.equal(out.request.session_address,'mock-'+agent);assert.equal(out.request.route_id,'mock-'+agent);assert.equal(out.request.envelope.to,'mock-'+agent);assert.equal(out.request.envelope.body,'mock question');
 }
});
test('missing unknown live or unconfigured targets are not guessed or rerouted',async()=>{
 const {planAssignment}=await load();for(const change of [{agent:undefined},{agent:'other'},{agent:'CLAUDE'},{agent:['claude']},{mode:'live'}])assert.equal(planAssignment(assignment(change),routes(),now).accepted,false);
 assert.equal(planAssignment(assignment({agent:'codex'}),{claude:route('claude')},now).accepted,false);
});
test('credential raw interaction and additional-action fields are refused without echo',async()=>{
 const {planAssignment}=await load();for(const change of [{token:'fake-private-fixture'},{endpoint:'fake-endpoint'},{action:'send'},{verified:true}]){
  const out=planAssignment(assignment(change),routes(),now);assert.equal(out.accepted,false);assert.equal(JSON.stringify(out).includes('fake-private-fixture'),false);
 }
});
test('existing owner channel bot webhook size and time policy stays intact',async()=>{
 const {planAssignment}=await load();for(const change of [{channel_id:'human'},{owner_id:'other'},{author_bot:true},{webhook_id:'hook'},{thread_id:'thread'},{mentions:['u']},{attachments:['a']},{text:'x'.repeat(4097)},{created_at:'2026-10-30T00:00:00.000Z'},{token:'fake'}])assert.equal(planAssignment(assignment({event:fakeDiscord(change)}),routes(),now).accepted,false);
});
test('routes cannot disagree on PC owner channel command or quotas',async()=>{
 const {planAssignment}=await load();for(const change of [{pc_id:'other-pc'},{guild_id:'other'},{channel_id:'human'},{owner_id:'other'},{command:'other'},{hourlyDispatches:1}]){
  const r=routes();r.codex=mockConfig({...r.codex,...change});assert.equal(planAssignment(assignment(),r,now).accepted,false);
 }
});
test('route IDs addresses and aliases are unique and bounded',async()=>{
 const {planAssignment}=await load();for(const r of [{claude:route('claude'),extra:route('codex')},{claude:route('claude'),codex:route('claude')},{claude:route('claude'),codex:mockConfig({...route('codex'),session_address:'mock-claude'})},{claude:mockConfig({route_id:'x'.repeat(49)})},{},[]])assert.equal(planAssignment(assignment(),r,now).accepted,false);
});
test('planning returns independent data and does not mutate caller routes or event',async()=>{
 const {planAssignment}=await load(),r=routes(),snapshot=assignment(),before=structuredClone(snapshot),out=planAssignment(snapshot,r,now);
 out.event.text='changed';out.request.envelope.body='changed';assert.deepEqual(snapshot,before);assert.equal(r.claude.session_address,'mock-claude');
 assert.equal(planAssignment(snapshot,r,now).request.envelope.body,'mock question');
});
test('accessor-backed input is refused without invoking arbitrary getters',async()=>{
 const {planAssignment}=await load();let reads=0;const input=assignment();Object.defineProperty(input,'agent',{get(){reads++;return 'claude';},enumerable:true});
 assert.equal(planAssignment(input,routes(),now).accepted,false);assert.equal(reads,0);
});
test('pinned route ID and session address are required rather than filled from defaults',async()=>{
 const {planAssignment}=await load();for(const config of [{},{route_id:'mock-claude'},{session_address:'mock-claude'}])assert.equal(planAssignment(assignment(),{claude:config},now).accepted,false);
});
test('empty attachment or mention arrays cannot smuggle additional secret or action properties',async()=>{
 const {planAssignment}=await load();for(const key of ['attachments','mentions']){
  const event=fakeDiscord();event[key].token='fake-private-fixture';const out=planAssignment(assignment({event}),routes(),now);assert.equal(out.accepted,false);assert.equal(JSON.stringify(out).includes('fake-private-fixture'),false);
 }
});
test('nested array getters are refused before cloning',async()=>{
 const {planAssignment}=await load();let calls=0;const event=fakeDiscord();Object.defineProperty(event.attachments,'extra',{get(){calls++;return 'fake';},enumerable:true});assert.equal(planAssignment(assignment({event}),routes(),now).accepted,false);assert.equal(calls,0);
});
test('timestamp objects are refused before Date.parse can coerce them',async()=>{
 const {planAssignment}=await load();let calls=0;const event=fakeDiscord({created_at:{toString(){calls++;return '2026-10-31T00:00:00.000Z';}}});assert.equal(planAssignment(assignment({event}),routes(),now).accepted,false);assert.equal(calls,0);
});
for(const agent of ['claude','codex'])test(`${agent} assignment draft matches one original mock dispatch and explicit result; no automatic followup`,async t=>{
 const {planAssignment}=await load(),box=await sandbox(t),clock=fakeClock(now),draft=planAssignment(assignment({agent}),routes(),clock.now());
 assert.equal(draft.accepted,true);const config=draft.config,store=await openMockStore({root:box.root,config,now:clock.now}),session=fakeSession(),publisher=fakePublisher();
 const bridge=await openMockBridge({store,config,session,publisher,now:clock.now});assert.equal(session.calls.length,0);
 const task=await bridge.ingest(draft.event);await bridge.tick();assert.equal(session.calls.length,1);assert.deepEqual(session.calls[0],draft.request);assert.equal(publisher.calls.length,0);
 await bridge.submitResult({task_id:task.task_id,result_text:'explicit '+agent+' answer'});await bridge.tick();
 await bridge.ingest(draft.event);for(let n=0;n<5;n++)await bridge.tick();assert.equal(session.calls.length,1);assert.equal(publisher.calls.length,1);assert.equal((await bridge.status()).completed,1);
});
