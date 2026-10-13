import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {paired} from './fixture.mjs';
import {runReceiver} from '../lib/service.mjs';
import {deliveryStatus} from '../lib/receiver.mjs';

test('idle service stops after its Claude socket disappears; no injected bytes',async t=>{
 const b=await paired(t),endpoint=process.platform==='win32'?'\\\\.\\pipe\\relay-dead-'+process.pid+'-'+Date.now():path.join(b.container,'idle.sock');
 let bytes=0;const server=net.createServer(s=>s.on('data',d=>bytes+=d.length));await new Promise(r=>server.listen(endpoint,r));t.after(()=>new Promise(r=>server.listening?server.close(r):r()));
 let ready;const started=new Promise(r=>ready=r);
 const running=runReceiver({root:b.root,address:'claude-demo',batchMs:0,probeMs:20,env:{CLAUDE_CODE_MESSAGING_SOCKET:endpoint,CLAUDE_CODE_MESSAGING_TOKEN:'fake'},ready});
 await started;await new Promise(r=>server.close(r));
 const timeout=setTimeout(()=>{},1000);const code=await running;clearTimeout(timeout);assert.equal(code,'SESSION_INBOX_GONE');assert.equal(bytes,0);
 const status=await deliveryStatus({root:b.root,address:'claude-demo'});assert.equal(status.processAlive,false);assert.equal(status.phase,'disconnected');
});
test('public CLI slot timeout returns now and clears its waiter, send-only refuses final',async t=>{
 const b=await paired(t),script=new URL('../bin/relay.mjs',import.meta.url);
 const run=args=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,[fileURLToPath(script),...args],{windowsHide:true});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',code=>resolve({code,out,err}));});
 const base=['slot','--root',b.root,'--name','unity'];
 assert.equal((await run([...base,'--action','take','--as','codex-demo'])).code,0);
 const timeout=await run([...base,'--action','wait','--as','claude-demo','--timeout-ms','30','--interval-ms','5']);
 assert.equal(timeout.code,3);const result=JSON.parse(timeout.out);assert.equal(result.now[0].queue.length,0);
 const marker=await run(['send-only','--root',b.root,'--as','claude-demo']);assert.equal(marker.code,0);
 await assert.rejects(b.cx.send({body:'cannot proceed'}),{code:'SEND_ONLY'});
});
