import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {paired} from './fixture.mjs';
import * as slots from '../lib/slots.mjs';
test('slots bind registered actors, grant FIFO, notify only nonwaiting recipients and log force',async t=>{
 const b=await paired(t);await assert.rejects(slots.act({root:b.root,name:'unity',as:'owner',action:'take'}),{code:'UNKNOWN_ADDRESS'});
 const first=await slots.act({root:b.root,name:'unity',as:'codex-demo',action:'take'});assert.equal(first.ok,true);
 assert.equal((await slots.act({root:b.root,name:'unity',as:'codex-demo',action:'take'})).ok,true);
 assert.equal((await slots.act({root:b.root,name:'unity',as:'claude-demo',action:'enqueue',pid:process.pid})).ok,false);
 await slots.act({root:b.root,name:'unity',as:'codex-demo',action:'give'});assert.equal((await b.cl.inbox()).length,0);
 await slots.act({root:b.root,name:'unity',as:'claude-demo',action:'give',to:'codex-demo'});assert.equal((await b.cx.inbox()).length,1);
 await assert.rejects(slots.act({root:b.root,name:'unity',as:'claude-demo',action:'take',force:true}),{code:'FORCE_REASON_REQUIRED'});
 await slots.act({root:b.root,name:'unity',as:'claude-demo',action:'take',force:true,reason:'owner requested takeover'});
 assert.equal((await b.cx.inbox()).length,2);assert.match((await slots.history({root:b.root,name:'unity'})).join('\n'),/owner requested takeover/);
 await assert.rejects(slots.act({root:b.root,name:'../escape',as:'codex-demo',action:'take'}),{code:'INVALID_SLOT'});
});
test('wait wakes after give and timeout leaves queue with an all-slot result',async t=>{
 const b=await paired(t);await slots.act({root:b.root,name:'unity',as:'codex-demo',action:'take'});
 const waiting=slots.wait({root:b.root,name:'unity',as:'claude-demo',timeoutMs:1000,intervalMs:10});
 await new Promise(r=>setTimeout(r,60));await slots.act({root:b.root,name:'unity',as:'codex-demo',action:'give'});
 assert.equal((await waiting).ok,true);
 const timeout=await slots.wait({root:b.root,name:'unity',as:'codex-demo',timeoutMs:30,intervalMs:5});assert.equal(timeout.timeout,true);assert.equal(timeout.now[0].queue.length,0);
});
test('six independent takers yield exactly one winner',async t=>{
 const b=await paired(t);const file=new URL('../lib/slots.mjs',import.meta.url).href;
 const code='import {act} from '+JSON.stringify(file)+';try{const r=await act({root:process.argv[1],name:"race",as:process.argv[2],action:"take"});console.log(JSON.stringify(r))}catch(e){console.log(JSON.stringify({ok:false,code:e.code}))}';
 // Register six distinct actors, not six idempotent calls by one actor.
 for(let i=0;i<3;i++)await b.core.registerPair({root:b.root,codexAddress:'cx-'+i,claudeAddress:'cl-'+i});
 const actors=['cx-0','cl-0','cx-1','cl-1','cx-2','cl-2'];
 const results=await Promise.all(actors.map(actor=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',code,b.root,actor],{windowsHide:true});let out='';p.stdout.on('data',d=>out+=d);p.on('error',reject);p.on('close',()=>resolve(JSON.parse(out)));})));
 assert.equal(results.filter(r=>r.ok).length,1);
});
test('dead queued recipient is notified once',async t=>{
 const b=await paired(t);await slots.act({root:b.root,name:'unity',as:'codex-demo',action:'take'});
 await slots.act({root:b.root,name:'unity',as:'claude-demo',action:'enqueue',pid:2147483647});
 await slots.act({root:b.root,name:'unity',as:'codex-demo',action:'give'});assert.equal((await b.cl.inbox()).length,1);
 await slots.act({root:b.root,name:'unity',as:'claude-demo',action:'take'});assert.equal((await b.cl.inbox()).length,1);
});
test('a rejected second waiter cannot remove the earlier process registration',async t=>{
 const b=await paired(t);await slots.act({root:b.root,name:'unity',as:'codex-demo',action:'take'});
 await slots.act({root:b.root,name:'unity',as:'claude-demo',action:'enqueue',pid:2147483647});
 await assert.rejects(slots.wait({root:b.root,name:'unity',as:'claude-demo',timeoutMs:50,intervalMs:10}),{code:'SLOT_WAITER_BUSY'});
 assert.equal((await slots.list({root:b.root}))[0].queue[0].pid,2147483647);
});
test('a grant during the final sleep wins over timeout, never leaving a silent holder',async t=>{
 const b=await paired(t);await slots.act({root:b.root,name:'unity',as:'codex-demo',action:'take'});
 const waiting=slots.wait({root:b.root,name:'unity',as:'claude-demo',timeoutMs:200,intervalMs:1000});
 await new Promise(r=>setTimeout(r,80));await slots.act({root:b.root,name:'unity',as:'codex-demo',action:'give'});
 const r=await waiting;assert.equal(r.ok,true);assert.equal(r.now[0].holder.as,'claude-demo');
});
test('abort interrupts the wait timer promptly and removes only its own registration',async t=>{
 const b=await paired(t);await slots.act({root:b.root,name:'unity',as:'codex-demo',action:'take'});
 const controller=new AbortController();const start=Date.now();const waiting=slots.wait({root:b.root,name:'unity',as:'claude-demo',timeoutMs:5000,intervalMs:4000,signal:controller.signal});
 await new Promise(r=>setTimeout(r,50));controller.abort();const result=await waiting;
 assert.equal(result.cancelled,true);assert.equal(result.now[0].queue.length,0);assert.ok(Date.now()-start<2000);
});
