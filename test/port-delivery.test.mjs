import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { paired } from './fixture.mjs';
import { openReceiver } from '../lib/receiver.mjs';
import { createAdapter } from '../lib/transport.mjs';
import * as core from '../lib/core.mjs';

const adapter = posts => ({ identity: { provider: 'claude' }, post: async body => { posts.push(body); return { state:'accepted' }; } });
test('saved-time batch deadline, zero window, accepted archive and first idempotent reply', async t => {
 const b=await paired(t), posts=[];
 const q=await b.cx.send({body:'old result',type:'result'});
 const r=await openReceiver({root:b.root,address:'claude-demo',adapter:adapter(posts),now:()=>Date.now()+200000});
 b.beforeCleanup(()=>r.close());await r.tick();assert.equal(posts.length,1);assert.deepEqual(await b.cl.inbox(),[]);
 const reply=await b.cl.reply({id:q.id.slice(-6),body:'verdict',type:'result'});
 assert.equal(reply.replyTo,q.id);assert.equal((await b.cl.reply({id:q.id,body:'verdict',type:'result'})).id,reply.id);
 await assert.rejects(b.cl.reply({id:q.id,body:'changed'}),{code:'REPLY_CONFLICT'});
});
test('keep-pending retains accepted original; manual done remains final', async t => {
 const b=await paired(t),posts=[],q=await b.cx.send({body:'inline'});
 const r=await openReceiver({root:b.root,address:'claude-demo',adapter:adapter(posts),batchMs:0,keepPending:true});
 b.beforeCleanup(()=>r.close());await r.tick();assert.equal((await b.cl.inbox()).length,1);
 await b.cl.done(q.id);await assert.rejects(b.cl.reply({id:q.id,body:'late'}),{code:'MESSAGE_DONE'});
});
test('two FYIs wait from saved time, flush together in created order with per-ID receipts',async t=>{
 const b=await paired(t),posts=[];const older=await b.cx.send({id:'f'.repeat(32),body:'OLDER',type:'fyi'}),newer=await b.cx.send({id:'0'.repeat(32),body:'NEWER',type:'fyi'});
 const created=Date.now();for(const [m,at] of [[older,created],[newer,created+1]])await fs.writeFile(path.join(b.root,'inbox','claude-demo',m.id+'.json'),JSON.stringify({...m,createdAt:new Date(at).toISOString()}));
 let clock=created+2;const r=await openReceiver({root:b.root,address:'claude-demo',adapter:adapter(posts),now:()=>clock,batchMs:100});b.beforeCleanup(()=>r.close());
 await r.tick();assert.equal(posts.length,0);clock+=100;await r.tick();assert.equal(posts.length,1);assert.ok(posts[0].indexOf('OLDER')<posts[0].indexOf('NEWER'));
 for(const m of [older,newer]){const receipt=JSON.parse(await fs.readFile(path.join(b.root,'delivery','claude-demo',m.id+'.json')));assert.equal(receipt.state,'accepted');}
});
test('archive failure after accepted send reconciles on restart without a second post', async t => {
 const b=await paired(t),posts=[],q=await b.cx.send({body:'once'});
 const io={...fs,rename:async(a,z)=>{if(a.endsWith(q.id+'.json')&&a.includes(path.sep+'inbox'+path.sep))throw Object.assign(Error(),{code:'EIO'});return fs.rename(a,z);}};
 const r=await openReceiver({root:b.root,address:'claude-demo',adapter:adapter(posts),io});
 b.beforeCleanup(()=>r.close());
 await assert.rejects(r.tick());await r.close();assert.equal(posts.length,1);
 const next=await openReceiver({root:b.root,address:'claude-demo',adapter:adapter(posts)});b.beforeCleanup(()=>next.close());
 await next.tick();assert.equal(posts.length,1);assert.deepEqual(await b.cl.inbox(),[]);
});
test('send-only refuses questions and wake without publication; record mail and off work',async t=>{
 const b=await paired(t);assert.equal(typeof core.setSendOnly,'function');
 await core.setSendOnly({root:b.root,address:'claude-demo',enabled:true});
 await assert.rejects(b.cx.send({body:'blocked'}),{code:'SEND_ONLY'});
 await assert.rejects(b.cx.send({body:'urgent verdict',type:'result',wake:true}),{code:'SEND_ONLY'});
 assert.deepEqual(await b.cl.inbox(),[]);await b.cx.send({body:'record',type:'result'});
 await core.setSendOnly({root:b.root,address:'claude-demo',enabled:false});await b.cx.send({body:'question'});assert.equal((await b.cl.inbox()).length,2);
});
test('Claude probe connects and writes zero bytes, missing endpoint is proven gone',async t=>{
 const b=await paired(t);const endpoint=process.platform==='win32'?'\\\\.\\pipe\\relay-probe-'+process.pid+'-'+Date.now():path.join(b.container,'probe.sock');
 let bytes=0;const server=net.createServer(s=>s.on('data',data=>bytes+=data.length));await new Promise(r=>server.listen(endpoint,r));
 t.after(()=>new Promise(r=>server.listening?server.close(r):r()));
 const a=createAdapter({provider:'claude',env:{CLAUDE_CODE_MESSAGING_SOCKET:endpoint,CLAUDE_CODE_MESSAGING_TOKEN:'secret'}});
 assert.equal((await a.probe()).state,'accepted');await new Promise(r=>setTimeout(r,20));assert.equal(bytes,0);
 await new Promise(r=>server.close(r));const gone=await a.probe();assert.equal(gone.state,'not_sent');assert.equal(gone.code,'SESSION_INBOX_GONE');
});

test('manual done during an in-flight accepted post cannot regain first-reply permission',async t=>{
 const b=await paired(t),m=await b.cx.send({body:'in-flight'});let accept,entered;
 const started=new Promise(r=>entered=r),outcome=new Promise(r=>accept=r);
 const r=await openReceiver({root:b.root,address:'claude-demo',adapter:{identity:{provider:'claude'},post:async()=>{entered();return outcome;}}});b.beforeCleanup(()=>r.close());
 const pending=r.tick();await started;await b.cl.done(m.id);accept({state:'accepted'});await pending;
 await assert.rejects(b.cl.reply({id:m.id,body:'must not reply'}),{code:'MESSAGE_DONE'});
});

test('enabling send-only stops new work on an existing receiver',async t=>{
 const b=await paired(t),posts=[];const r=await openReceiver({root:b.root,address:'claude-demo',adapter:adapter(posts)});b.beforeCleanup(()=>r.close());
 await core.setSendOnly({root:b.root,address:'claude-demo',enabled:true});await b.cx.send({body:'record only',type:'result'});
 await assert.rejects(r.tick(),{code:'SEND_ONLY'});assert.equal(posts.length,0);assert.equal((await b.cl.inbox()).length,1);
});
test('ambiguous short reply refuses without a new mail; unique short done keeps full IDs',async t=>{
 const b=await paired(t);const one=await b.cx.send({id:'abcdef'+'1'.repeat(26),body:'one'});await b.cx.send({id:'abcdef'+'2'.repeat(26),body:'two'});
 await assert.rejects(b.cl.reply({id:'abcdef',body:'ambiguous'}),{code:'AMBIGUOUS_ID'});assert.equal((await b.cx.inbox()).length,0);
 assert.equal((await b.cl.done(one.id.slice(-6))).id,one.id);
});
test('foreground lock-contention retry is bounded and never retries an IO/uncertain error',async()=>{
 const storage=await import('../lib/storage.mjs');assert.equal(typeof storage.retryWriterBusy,'function');let calls=0;
 const result=await storage.retryWriterBusy(async()=>{if(++calls<3)throw Object.assign(Error(),{code:'WRITER_BUSY'});return 'saved';},{pause:async()=>{}});assert.equal(result,'saved');assert.equal(calls,3);
 calls=0;await assert.rejects(storage.retryWriterBusy(async()=>{calls++;throw Object.assign(Error(),{code:'IO_ERROR'});},{pause:async()=>{}}),{code:'IO_ERROR'});assert.equal(calls,1);
 calls=0;await assert.rejects(storage.retryWriterBusy(async()=>{calls++;throw Object.assign(Error(),{code:'WRITER_BUSY'});},{attempts:3,pause:async()=>{}}),{code:'WRITER_BUSY'});assert.equal(calls,3);
});
