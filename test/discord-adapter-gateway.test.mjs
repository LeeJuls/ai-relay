import test from 'node:test';
import assert from 'node:assert/strict';
import {createGateway,createGatewayDiscovery} from '../tools/discord-adapter/gateway.mjs';
import {config,command,hello,ready,harness} from './discord-host-fixture.mjs';
function setup(extra={}){const h=harness(),seen=[],g=createGateway({...h,config,onInteraction:async x=>{seen.push(x);},...extra});return {h,g,seen};}
test('explicit start discovers fixed Gateway then HELLO identifies intents0; only authenticated READY dispatch',async()=>{
 const {h,g,seen}=setup();assert.equal(h.sockets.length,0);await g.start();const s=h.sockets[0];assert.equal(s.url,'wss://gateway.discord.gg/?v=10&encoding=json');await s.emit(command());assert.equal(seen.length,0);await s.emit(hello());assert.equal(s.sent[0].op,2);assert.equal(s.sent[0].d.intents,0);await s.emit(ready());await s.emit(command());await g.drain();assert.equal(seen.length,1);assert.equal(g.status().phase,'ready');assert.equal(JSON.stringify(g.status()).includes('FAKE_SESSION'),false);await g.close();assert.equal(h.tasks.size,0);
});
test('heartbeat jitter/sequence/ACK and server heartbeat use no command callback; missed ACK closes',async()=>{
 const {h,g,seen}=setup();await g.start();const s=h.sockets[0];await s.emit(hello());await s.emit(ready());await h.advance(499);assert.equal(s.sent.length,1);await h.advance(1);assert.deepEqual(s.sent[1],{op:1,d:1});await s.emit({op:11});await s.emit({op:1});assert.equal(s.sent.at(-1).op,1);await h.advance(1000);assert.equal(g.status().phase,'reconnect_required');assert.equal(seen.length,0);await g.close();
});
test('resumption uses previous session/sequence, handles replay and limits total connections',async()=>{
 const {h,g,seen}=setup();await g.start();const first=h.sockets[0];await first.emit(hello());await first.emit(ready());await first.emit(command());await g.drain();await first.emit({op:7});await g.reconnect();const second=h.sockets[1];await second.emit(hello());assert.deepEqual(second.sent[0],{op:6,d:{token:'OFFLINE_ONLY',session_id:'FAKE_SESSION',seq:2}});await second.emit({...command(),s:3});await second.emit({op:0,t:'RESUMED',s:4,d:{}});await g.drain();assert.equal(seen.length,2);await second.disconnect();await g.reconnect();await h.sockets[2].disconnect();await assert.rejects(g.reconnect());assert.equal(h.sockets.length,3);await g.close();
});
test('fatal auth/identity errors block reconnect; stale sockets cannot dispatch',async()=>{
 for(const mode of ['auth','identity']){const {h,g,seen}=setup();await g.start();const s=h.sockets[0];await s.emit(hello());if(mode==='auth')await s.disconnect(4004);else{const r=ready();r.d.application.id='999999999999999999';await s.emit(r);}assert.equal(g.status().phase,'blocked');await assert.rejects(g.reconnect());await s.emit(command());assert.equal(seen.length,0);await g.close();}
});
test('invalid session cooldown, fresh identify budget, socket generations and non-command events',async()=>{
 const {h,g,seen}=setup();await g.start();const first=h.sockets[0];await first.emit(hello());await first.emit(ready());await first.emit({op:9,d:false});await assert.rejects(g.reconnect());await h.advance(5000);await g.reconnect();const second=h.sockets[1];await second.emit(hello());assert.equal(second.sent[0].op,2);await first.emit(command());await second.emit(ready());await second.emit({op:0,t:'MESSAGE_CREATE',s:2,d:{content:'PRIVATE'}});await g.drain();assert.equal(seen.length,0);await g.close();
});
test('malformed/oversized frame, HELLO timeout, gateway URL and session budget refuse safely',async()=>{
 for(const raw of ['bad','x'.repeat(65537)]){const {h,g}=setup();await g.start();await h.sockets[0].emit(raw);assert.equal(g.status().phase,'blocked');await g.close();}
 const {h,g}=setup();await g.start();await h.advance(10000);assert.equal(g.status().phase,'reconnect_required');await g.close();
 for(const discover of [async()=>({url:'wss://evil.invalid',shards:1,session_start_limit:{remaining:10,max_concurrency:1}}),async()=>({url:'wss://gateway.discord.gg',shards:1,session_start_limit:{remaining:0,max_concurrency:1}})]){const b=setup({discover});await assert.rejects(b.g.start());assert.equal(b.h.sockets.length,0);await b.g.close();}
});
test('pending commands are bounded and heartbeat flood cannot exceed outbound budget',async()=>{
 const releases=[];const {h,g}=setup({onInteraction:()=>new Promise(resolve=>releases.push(resolve))});await g.start();const s=h.sockets[0];await s.emit(hello());await s.emit(ready());for(let i=0;i<9;i++)await s.emit(command(h.now(),i));assert.equal(g.status().phase,'blocked');assert.equal(releases.length,8);for(const release of releases)release();await g.drain();await g.close();
 const b=setup();await b.g.start();const sock=b.h.sockets[0];await sock.emit(hello());for(let i=0;i<121;i++)await sock.emit({op:1});assert.ok(sock.sent.length<=90);assert.equal(b.g.status().phase,'reconnect_required');await b.g.close();
});
test('Gateway discovery uses fixed bot endpoint, injected credential/fetch, bounded JSON and sanitized failure',async()=>{
 let calls=0;const discover=createGatewayDiscovery({authorization:async()=> 'Bot OFFLINE_ONLY',fetchImpl:async(url,options)=>{calls++;assert.equal(url,'https://discord.com/api/v10/gateway/bot');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);return new Response(JSON.stringify({url:'wss://gateway.discord.gg',shards:1,session_start_limit:{remaining:1,max_concurrency:1,reset_after:1000}}));}});
 assert.equal((await discover()).shards,1);assert.equal(calls,1);
 for(const response of [new Response('{}',{status:401}),new Response('SECRET'),new Response('x'.repeat(65537))]){const get=createGatewayDiscovery({authorization:async()=> 'Bot OFFLINE_ONLY',fetchImpl:async()=>response});await assert.rejects(get(),e=>e.code==='GATEWAY_DISCOVERY_FAILED'&&!e.cause&&!e.message.includes('SECRET'));}
});
