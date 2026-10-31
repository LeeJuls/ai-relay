import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {sandbox} from './fixture.mjs';
import {mockConfig,validateEvent,digest} from '../tools/discord-mock/policy.mjs';
const load=()=>import('../tools/discord-mock/store.mjs');
const start=Date.parse('2026-10-31T00:00:00.000Z');
function task(n=1){const v=validateEvent({event_id:'e'+n,guild_id:'mock-guild',channel_id:'mock-ai',owner_id:'mock-owner',command:'ask',text:'question',created_at:new Date(start).toISOString(),author_bot:false,webhook_id:null,thread_id:null,attachments:[],mentions:[]},mockConfig(),start);return {...v.ids,envelope:v.envelope,target:v.target,digest:v.digest,state:'queued',inflight:false,attempts:{dispatch:0,publish:0},dispatch_claim:null,publish_claim:null,result:null,result_digest:null,held_effect:null,code:null,next_attempt_at:0,created_at:start,updated_at:start,body_pruned:false};}
function add(l,t){l.tasks[t.task_id]=t;l.events[t.event_key]={task_id:t.task_id,digest:t.digest,expires_at:start+604800000};}
test('store binds explicit mock root and policy and refuses a normal mail root',async t=>{
 const b=await sandbox(t),{openMockStore}=await load(),config=mockConfig();
 const s=await openMockStore({root:b.root,config});assert.equal((await s.read()).mode,'mock');
 await assert.rejects(openMockStore({root:b.root,config:mockConfig({maxQueue:1})}));
 const other=path.join(b.container,'mail');await fs.mkdir(other);await fs.writeFile(path.join(other,'config.json'),'{}');
 await assert.rejects(openMockStore({root:other,config}));await assert.rejects(openMockStore({root:'relative',config}));
});
test('atomic transaction serializes changes and refuses ID mismatch queue overflow and two inflight tasks',async t=>{
 const b=await sandbox(t),{openMockStore}=await load(),s=await openMockStore({root:b.root,config:mockConfig({maxQueue:1})});
 await s.transact(l=>{add(l,task());});
 await assert.rejects(s.transact(l=>{add(l,task(2));}));assert.equal(Object.keys((await s.read()).tasks).length,1);
 await s.transact(l=>{l.tasks[task().task_id].inflight=true;});
 await s.transact(l=>add(l,task(2)));
 await assert.rejects(s.transact(l=>{l.tasks[task(2).task_id].inflight=true;}));
 await assert.rejects(s.transact(l=>{l.tasks[task().task_id].relay_id='a'.repeat(32);}));
 await assert.rejects(s.transact(async()=>{}));
});
test('corrupt null invalid schema and changed envelope are never overwritten',async t=>{
 const b=await sandbox(t),{openMockStore}=await load(),config=mockConfig(),s=await openMockStore({root:b.root,config});
 await s.transact(l=>add(l,task()));const f=path.join(b.root,'mock-bridge.json'),good=await fs.readFile(f,'utf8');
 for(const bytes of ['null','{','{}',good.replace('question','tampered')]){await fs.writeFile(f,bytes);await assert.rejects(s.read());await assert.rejects(s.transact(l=>{l.stopped=true;}));assert.equal(await fs.readFile(f,'utf8'),bytes);}
});
test('permanent atomic-save denial preserves old ledger bytes',async t=>{
 const b=await sandbox(t),{openMockStore}=await load(),config=mockConfig();await openMockStore({root:b.root,config});
 const f=path.join(b.root,'mock-bridge.json'),before=await fs.readFile(f,'utf8'),io=Object.create(fs);
 io.rename=async()=>{throw Object.assign(Error(),{code:'EACCES'});};
 const s=await openMockStore({root:b.root,config,io});await assert.rejects(s.transact(l=>{l.stopped=true;}));assert.equal(await fs.readFile(f,'utf8'),before);
});
test('retention removes terminal bodies before IDs and preserves uncertain holds',async t=>{
 const b=await sandbox(t),{openMockStore}=await load();let now=start;const s=await openMockStore({root:b.root,config:mockConfig(),now:()=>now});
 await s.transact(l=>{const a=task();a.state='completed';a.result='answer';a.result_digest=digest('answer');add(l,a);const h=task(2);h.state='held';h.inflight=true;h.held_effect='dispatch';h.code='uncertain';add(l,h);});
 now+=86400001;await s.transact(()=>{});let l=await s.read();assert.equal(l.tasks[task().task_id].envelope.body,undefined);assert.equal(l.tasks[task().task_id].result,null);assert.equal(l.tasks[task(2).task_id].envelope.body,'question');
 now=start+604800001;await s.transact(()=>{});l=await s.read();assert.equal(l.tasks[task().task_id],undefined);assert.ok(l.tasks[task(2).task_id]);
});
test('record cap and writer lock refuse further changes without evicting held data',async t=>{
 const b=await sandbox(t),{openMockStore}=await load(),s=await openMockStore({root:b.root,config:mockConfig({maxRecords:1})});
 await s.transact(l=>add(l,task()));await assert.rejects(s.transact(l=>add(l,task(2))));
 const lock=path.join(b.root,'.writer.lock');await fs.writeFile(lock,'owner');await assert.rejects(s.transact(l=>{l.stopped=true;}),{code:'WRITER_BUSY'});assert.equal(await fs.readFile(lock,'utf8'),'owner');await fs.unlink(lock);
});
test('internal junction cannot redirect the ledger outside its root',async t=>{
 const b=await sandbox(t),{openMockStore}=await load(),outside=path.join(b.container,'outside');await fs.mkdir(outside);await fs.mkdir(path.dirname(b.root),{recursive:true});await fs.symlink(outside,b.root,'junction');
 await assert.rejects(openMockStore({root:b.root,config:mockConfig()}),{code:'UNSAFE_PATH'});assert.deepEqual(await fs.readdir(outside),[]);
});
