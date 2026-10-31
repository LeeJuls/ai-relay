import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {sandbox} from './fixture.mjs';
import {config,epoch,command,hello,ready,harness} from './discord-host-fixture.mjs';
import {openDiscordHost,openDiscordHostWithTransport} from '../tools/discord-adapter/host.mjs';
import {openAdapterRuntime} from '../tools/discord-adapter/runtime.mjs';
async function setup(t,extra={}){const b=await sandbox(t),h=harness(),calls={ack:0,dispatch:0,publish:0},replies=[];
 const args={root:b.root,config,now:h.now,gatewayDeps:h,acknowledge:async()=>{calls.ack++;return {state:'accepted'};},request:async r=>{calls.publish++;return {status:200,body:{id:'777777777777777777',channel_id:config.channel_id,nonce:r.body.nonce}};},sessionBroker:{authorize:async query=>{assert.equal(query.scope,'readonly-question-result');return {route_id:config.route_id,session_address:config.session_address,dispatch:async(request,{submitResult})=>{calls.dispatch++;replies.push(submitResult);return {state:'accepted'};}};}},...extra};
 const host=await openDiscordHost(args);return {b,h,calls,replies,args,host,async connect(){await host.start();const s=h.sockets.at(-1);await s.emit(hello());await s.emit(ready());return s;}};
}
test('host notifies trial boundary only after authenticated READY',async t=>{
 let observed=0;const b=await setup(t,{onGatewayReady:()=>observed++});await b.host.start();assert.equal(observed,0);const socket=b.h.sockets[0];await socket.emit(hello());assert.equal(observed,0);await socket.emit(ready());await b.host.drain();assert.equal(observed,1);await b.host.close();
});
test('prepared resume stays stopped until authenticated READY and cannot be replayed',async t=>{
 const b=await sandbox(t),h=harness();const runtime=await openAdapterRuntime({root:b.root,config,now:h.now,session:{dispatch:async()=>({state:'accepted'})},publisher:{publish:async()=>({state:'accepted',message_id:'777777777777777777'})}});await runtime.stop();const preparation=await runtime.prepareBoundedTrial();await runtime.close();let notifications=0;
 const args={root:b.root,config,now:h.now,gatewayDeps:h,resumePreparationId:preparation.id,request:async()=>{},acknowledge:async()=>({state:'accepted'}),sessionBroker:{authorize:async()=>null},onGatewayReady:()=>notifications++};const host=await openDiscordHost(args);assert.equal((await host.status()).runtime.stopped,true);await host.start();const s=h.sockets[0];await s.emit(hello());assert.equal((await host.status()).runtime.stopped,true);await s.emit(ready());await host.drain();assert.equal(notifications,1);assert.equal((await host.status()).runtime.stopped,false);assert.equal((await host.status()).runtime.trial.id,preparation.id);await host.stop();await host.close();await assert.rejects(openDiscordHost(args),{code:'TRIAL_PREPARATION_REQUIRED'});
});
test('host integrates authenticated command→durable ACK→single session→limited callback→REST result',async t=>{
 const b=await setup(t);assert.equal(b.h.sockets.length,0);const s=await b.connect();await b.h.advance(500);await s.emit({op:11});await b.host.drain();assert.equal(b.calls.dispatch,0);await s.emit(command());await b.host.drain();assert.equal(b.calls.ack,1);assert.equal(b.calls.dispatch,1);assert.equal(b.calls.publish,0);
 assert.equal((await b.replies[0]({result_text:'explicit answer'})).code,'RESULT_SAVED');await b.host.drain();assert.equal(b.calls.publish,1);assert.equal((await b.host.status()).runtime.completed,1);await s.emit({...command(),s:3});await b.host.drain();assert.equal(b.calls.ack,1);assert.equal(b.calls.dispatch,1);assert.equal(b.calls.publish,1);
 const ledger=await fs.readFile(path.join(b.b.root,'discord-adapter.json'),'utf8');assert.equal(ledger.includes('FAKE_OFFLINE_INTERACTION'),false);assert.equal(ledger.includes('OFFLINE_ONLY'),false);await b.host.close();
});
test('ACK durable claim precedes response and no session is dispatched when ACK uncertain',async t=>{
 let root;const b=await setup(t,{acknowledge:async()=>{const l=JSON.parse(await fs.readFile(path.join(root,'discord-adapter.json'),'utf8'));assert.equal(Object.values(l.tasks)[0].ack_state,'claimed');return {state:'uncertain'};}});root=b.b.root;const s=await b.connect();await s.emit(command());await b.host.drain();assert.equal(b.calls.dispatch,0);assert.equal((await b.host.status()).runtime.held,1);await b.host.close();
});
test('blocked human channel/owner/bot has no ACK, broker, model or publication',async t=>{
 const b=await setup(t),s=await b.connect();for(const mutate of [x=>x.d.channel_id=config.human_channel_ids[0],x=>x.d.member.user.id='999999999999999999',x=>x.d.member.user.bot=true]){const e=command();mutate(e);e.s+=b.h.sockets[0].sent.length;await s.emit(e);}await b.host.drain();assert.deepEqual(b.calls,{ack:0,dispatch:0,publish:0});await b.host.close();
});
test('early callback is buffered until durable transport acceptance; callback contains no task/channel override',async t=>{
 let promise,reply;const b=await setup(t,{sessionBroker:{authorize:async()=>({route_id:config.route_id,session_address:config.session_address,dispatch:async(_,{submitResult})=>{reply=submitResult;promise=submitResult({result_text:'early answer'});return {state:'accepted'};}})}}),s=await b.connect();await s.emit(command());await b.host.drain();assert.equal((await promise).code,'RESULT_SAVED');assert.equal(b.calls.publish,1);assert.equal((await reply({result_text:'early answer'})).code,'RESULT_SAVED');assert.equal((await reply({result_text:'other answer'})).code,'RESULT_CONFLICT');assert.equal((await reply({result_text:'early answer',task_id:'override'})).code,'INVALID_RESULT');await b.host.close();
});
test('missing/incorrect authoritative session capability cannot execute a session',async t=>{
 const b=await sandbox(t),h=harness();await assert.rejects(openDiscordHost({root:b.root,config,now:h.now,gatewayDeps:h,request:async()=>{},acknowledge:async()=>{}}));
 let effect=0;const c=await setup(t,{sessionBroker:{authorize:async()=>({route_id:config.route_id,session_address:'other',dispatch:async()=>{effect++;return {state:'accepted'};}})}}),s=await c.connect();await s.emit(command());await c.host.drain();assert.equal(effect,0);assert.equal(c.calls.publish,0);await c.host.close();
});
test('stop blocks new dispatch while prior delayed callback can still publish; closed callback is denied',async t=>{
 const b=await setup(t),s=await b.connect();await s.emit(command());await b.host.drain();await b.host.stop();await s.emit(command(epoch,1));await b.host.drain();assert.equal(b.calls.dispatch,1);await b.replies[0]({result_text:'after stop'});await b.host.drain();assert.equal(b.calls.publish,1);await b.host.close();assert.equal((await b.replies[0]({result_text:'after stop'})).code,'RESULT_CHANNEL_CLOSED');
});
test('restart never re-ACKs or dispatches an uncertain admission',async t=>{
 const b=await setup(t,{acknowledge:async()=>({state:'uncertain'})}),s=await b.connect();await s.emit(command());await b.host.drain();await b.host.close();const h=harness(),host=await openDiscordHost({...b.args,gatewayDeps:h,now:h.now});await host.start();await h.sockets[0].emit(hello());await h.sockets[0].emit(ready());await h.sockets[0].emit(command());await host.drain();assert.equal(b.calls.dispatch,0);assert.equal((await host.status()).runtime.held,1);await host.close();
});
test('dispatch timeout is uncertain and stale callback cannot publish',async t=>{
 let reply,started;const startSignal=new Promise(resolve=>{started=resolve;});const b=await setup(t,{sessionBroker:{authorize:async()=>({route_id:config.route_id,session_address:config.session_address,dispatch:(_,{submitResult})=>{reply=submitResult;started();return new Promise(()=>{});}})}}),s=await b.connect();await s.emit(command());await startSignal;await b.h.advance(10000);await b.host.drain();assert.equal((await b.host.status()).runtime.held,1);assert.equal((await reply({result_text:'late'})).code,'DISPATCH_UNCERTAIN');assert.equal(b.calls.publish,0);await b.host.close();
});
test('transport factory wires fake discovery, Gateway, ACK, session callback and REST without ambient credentials',async t=>{
 const b=await sandbox(t),h=harness();let ack=0,post=0,reply;
 const fetchImpl=async(url,options)=>{if(url.endsWith('/gateway/bot'))return new Response(JSON.stringify(await h.discover()));if(url.endsWith('/callback')){ack++;assert.equal(options.headers.Authorization,undefined);return new Response(null,{status:204});}post++;const body=JSON.parse(options.body);assert.equal(options.headers.Authorization,'Bot OFFLINE_ONLY');return new Response(JSON.stringify({id:'777777777777777777',channel_id:config.channel_id,nonce:body.nonce}));};
 const host=await openDiscordHostWithTransport({root:b.root,config,fetchImpl,socketFactory:h.socketFactory,authorization:h.authorization,timers:h.timers,now:h.now,jitter:h.jitter,sessionBroker:{authorize:async()=>({route_id:config.route_id,session_address:config.session_address,dispatch:async(_,{submitResult})=>{reply=submitResult;return {state:'accepted'};}})}});
 await host.start();const s=h.sockets[0];await s.emit(hello());await s.emit(ready());await s.emit(command());await host.drain();await reply({result_text:'answer'});await host.drain();assert.equal(ack,1);assert.equal(post,1);assert.equal((await host.status()).runtime.completed,1);await host.close();
});
test('host enforces ACK deadline even when injected acknowledger never resolves',async t=>{
 let began;const started=new Promise(resolve=>{began=resolve;});const b=await setup(t,{acknowledge:()=>{began();return new Promise(()=>{});}}),s=await b.connect();await s.emit(command());await started;await b.h.advance(2500);await b.host.drain();assert.equal(b.calls.dispatch,0);assert.equal(b.calls.publish,0);assert.equal((await b.host.status()).runtime.held,1);await b.host.close();
});
test('authorizer timeout never exposes question or executes a fallback session',async t=>{
 let began;const started=new Promise(resolve=>{began=resolve;});const b=await setup(t,{sessionBroker:{authorize:query=>{assert.equal(Object.hasOwn(query,'envelope'),false);began();return new Promise(()=>{});}}}),s=await b.connect();await s.emit(command());await started;await b.h.advance(5000);await b.host.drain();assert.equal(b.calls.dispatch,0);assert.equal(b.calls.publish,0);await b.host.close();
});
test('delayed result wakes an already ACKed queued task without another interaction',async t=>{
 const b=await setup(t),s=await b.connect();await s.emit(command());await b.host.drain();await s.emit(command(epoch,1));await b.host.drain();assert.equal(b.calls.dispatch,1);await b.replies[0]({result_text:'answer A'});await b.host.drain();await b.h.advance(1);await b.host.drain();assert.equal(b.calls.dispatch,2);await b.host.close();
});
test('definite dispatch and 429 publication retries wake at their persisted deadline',async t=>{
 let attempts=0,reply;const b=await setup(t,{sessionBroker:{authorize:async()=>({route_id:config.route_id,session_address:config.session_address,dispatch:async(_,{submitResult})=>{attempts++;reply=submitResult;return {state:attempts===1?'not_sent':'accepted'};}})}}),s=await b.connect();await s.emit(command());await b.host.drain();await b.h.advance(999);await b.host.drain();assert.equal(attempts,1);await b.h.advance(1);await b.host.drain();assert.equal(attempts,2);await b.host.close();
 let sends=0;const c=await setup(t,{request:async r=>{sends++;return sends===1?{status:429,body:{retry_after:2}}:{status:200,body:{id:'777777777777777777',channel_id:config.channel_id,nonce:r.body.nonce}};}}),sock=await c.connect();await sock.emit(command());await c.host.drain();await c.replies[0]({result_text:'answer'});await c.host.drain();assert.equal(sends,1);await c.h.advance(2000);await c.host.drain();assert.equal(sends,2);await c.host.close();
});
test('provider mutation cannot promote uncertain ACK to permission to dispatch',async t=>{
 const unstable=state=>async()=>{const result={state:'uncertain'};queueMicrotask(()=>queueMicrotask(()=>{result.state=state;}));return result;};
 const b=await setup(t,{acknowledge:unstable('accepted')}),s=await b.connect();await s.emit(command());await b.host.drain();assert.equal(b.calls.dispatch,0);assert.equal((await b.host.status()).runtime.held,1);await b.host.close();
});
test('direct dispatch outcome mutation cannot convert uncertainty into retry permission',async t=>{
 let calls=0;const c=await setup(t,{sessionBroker:{authorize:async()=>({route_id:config.route_id,session_address:config.session_address,dispatch:async()=>{calls++;const result={state:'uncertain'};queueMicrotask(()=>queueMicrotask(()=>{result.state='not_sent';}));return result;}})}}),sock=await c.connect();await sock.emit(command());await c.host.drain();assert.equal((await c.host.status()).runtime.held,1);await c.h.advance(1001);await c.host.drain();assert.equal(calls,1);await c.host.close();
});
test('READY wakes persisted eligible work and close removes scheduler wake',async t=>{
 const {openAdapterRuntime}=await import('../tools/discord-adapter/runtime.mjs'),root=await sandbox(t);const r=await openAdapterRuntime({root:root.root,config,now:()=>epoch,session:{dispatch:async()=>assert.fail('no model yet')},publisher:{publish:async()=>assert.fail('no publish yet')}});const q=await r.receiveForAck(command());await r.finishAcknowledgement({task_id:q.task_id,generation:q.generation,state:'accepted'});await r.close();
 const b=await setup(t,{root:root.root});await b.connect();await b.host.drain();assert.equal(b.calls.dispatch,1);await b.host.close();assert.equal(b.h.tasks.size,0);
});
test('broker capability function is captured before later mutation',async t=>{
 let good=0,bad=0;const b=await setup(t,{sessionBroker:{authorize:async()=>{const cap={route_id:config.route_id,session_address:config.session_address,dispatch:async()=>{good++;return {state:'accepted'};}};queueMicrotask(()=>queueMicrotask(()=>{cap.dispatch=async()=>{bad++;return {state:'accepted'};};}));return cap;}}}),s=await b.connect();await s.emit(command());await b.host.drain();assert.equal(good,1);assert.equal(bad,0);await b.host.close();
});
test('quota wake is scheduled once at the hour boundary with no idle model polling',async t=>{
 const b=await setup(t),s=await b.connect();for(let i=0;i<6;i++){await s.emit(command(epoch,i));await b.host.drain();await b.replies[i]({result_text:'answer'});await b.host.drain();}await s.emit(command(epoch,6));await b.host.drain();assert.equal(b.calls.dispatch,6);assert.ok([...b.h.tasks.values()].some(x=>x.at===epoch+3600000));await b.h.advance(3599999);await b.host.drain();assert.equal(b.calls.dispatch,6);await b.h.advance(1);await b.host.drain();assert.equal(b.calls.dispatch,7);await b.host.close();
});
