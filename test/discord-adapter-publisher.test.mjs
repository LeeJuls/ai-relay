import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublisher} from '../tools/discord-adapter/publisher.mjs';
const config={application_id:'111111111111111111',command_id:'222222222222222222',guild_id:'333333333333333333',channel_id:'444444444444444444',owner_id:'555555555555555555',human_channel_ids:['666666666666666666'],command:'ask',session_address:'readonly-claude',route_id:'discord-test'};
function task(){return {task_id:'discord-task-'+'a'.repeat(32),route_id:config.route_id,session_address:config.session_address,state:'discord_publish_claimed',publish_claim:{generation:'claim-1'},target:{guild_id:config.guild_id,channel_id:config.channel_id},result_text:'hello @everyone'};}
function receipt(req){return {status:200,body:{id:'777777777777777777',channel_id:config.channel_id,nonce:req.body.nonce}};}
test('pinned POST with stable nonce, mention suppression and valid receipt',async()=>{
 const calls=[],p=createPublisher({config,request:async r=>{calls.push(r);return receipt(r);}});
 const r=await p.publish(task());assert.equal(r.state,'accepted');assert.equal(r.message_id,'777777777777777777');assert.equal(calls.length,1);assert.equal(calls[0].method,'POST');assert.equal(calls[0].path,`/api/v10/channels/${config.channel_id}/messages`);
 assert.deepEqual(calls[0].body.allowed_mentions,{parse:[],replied_user:false});assert.equal(calls[0].body.enforce_nonce,true);assert.ok(calls[0].body.nonce.length<=25);assert.equal(calls[0].body.content,'hello @\u200beveryone');
 const d=await p.publish(task());assert.equal(d.state,'uncertain');assert.equal(calls.length,1);
});
test('rejects unclaimed, wrong destination/route/session, extra fields, bad claim, long output without effects',async()=>{
 let n=0;const p=createPublisher({config,request:async r=>{n++;return receipt(r);}});
 const mutations=[t=>t.state='agent_reply_received',t=>t.target.channel_id=config.human_channel_ids[0],t=>t.target.guild_id='999999999999999999',t=>t.route_id='other',t=>t.session_address='other',t=>t.publish_claim=null,t=>t.result_text='x'.repeat(1801),t=>t.token='fake',t=>t.result_text=''];
 for(const mutate of mutations){const t=task();mutate(t);assert.equal((await p.publish(t)).state,'not_sent');}assert.equal(n,0);
});
test('uncertain outcomes hold instance; no same or new task resend',async()=>{
 for(const response of [null,{status:500,body:{}},{status:200,body:{}},{status:200,body:{id:'777777777777777777',channel_id:config.human_channel_ids[0]}}]){
 let n=0;const p=createPublisher({config,request:async()=>{n++;return response;}});assert.equal((await p.publish(task())).state,'uncertain');const other=task();other.task_id='discord-task-'+'b'.repeat(32);assert.equal((await p.publish(other)).code,'PUBLISH_HELD');assert.equal(n,1);
 }
 const p=createPublisher({config,request:async()=>{throw Error('TOKEN=SECRET');}});assert.deepEqual(await p.publish(task()),{state:'uncertain',code:'TRANSPORT_UNCERTAIN'});
});
test('429 bounded retry_after cooldown has no automatic retries and permits later explicit attempt',async()=>{
 let at=1000,n=0;const p=createPublisher({config,now:()=>at,request:async r=>{n++;return n===1?{status:429,body:{retry_after:2,global:true}}:receipt(r);}});
 assert.deepEqual(await p.publish(task()),{state:'not_sent',code:'RATE_LIMITED',retry_at:3000});assert.equal((await p.publish(task())).code,'COOLDOWN');assert.equal(n,1);at=3000;assert.equal((await p.publish(task())).state,'accepted');assert.equal(n,2);
});
test('401/403 disable instance, malformed429 holds, other 4xx are certain not_sent',async()=>{
 for(const status of [401,403]){let n=0;const p=createPublisher({config,request:async()=>{n++;return {status,body:{}};}});assert.equal((await p.publish(task())).state,'not_sent');assert.equal((await p.publish(task())).code,'AUTH_BLOCKED');assert.equal(n,1);}
 const p=createPublisher({config,request:async()=>({status:400,body:{token:'fake'}})});assert.deepEqual(await p.publish(task()),{state:'not_sent',code:'HTTP_REJECTED'});
 const q=createPublisher({config,request:async()=>({status:429,body:{retry_after:-1}})});assert.equal((await q.publish(task())).state,'uncertain');
});
test('single in-flight protects concurrent sends and snapshot detached before asynchronous request',async()=>{
 let finish,calls=0;const p=createPublisher({config,request:r=>{calls++;return new Promise(resolve=>{finish=()=>resolve(receipt(r));});}}),t=task();
 const first=p.publish(t);t.target.channel_id=config.human_channel_ids[0];assert.equal((await p.publish(task())).code,'PUBLISH_BUSY');finish();assert.equal((await first).state,'accepted');assert.equal(calls,1);
});
test('known replay uncertainty latches standalone publisher hold for other tasks',async()=>{
 let calls=0;const p=createPublisher({config,request:async r=>{calls++;return receipt(r);}});await p.publish(task());assert.equal((await p.publish(task())).code,'ALREADY_PUBLISHED');const other=task();other.task_id='discord-task-'+'b'.repeat(32);assert.equal((await p.publish(other)).code,'PUBLISH_HELD');assert.equal(calls,1);
});
