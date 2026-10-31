import test from 'node:test';
import assert from 'node:assert/strict';
import {createAcknowledger} from '../tools/discord-adapter/ack.mjs';
const input=()=>({interaction_id:'777777777777777777',token:'FAKE_OFFLINE_INTERACTION',deadline:3500});
test('ACK uses fixed ephemeral receipt with deadline, no bot credentials or retries',async()=>{
 let count=0;const ack=createAcknowledger({now:()=>1000,fetchImpl:async(url,options)=>{count++;assert.equal(url,'https://discord.com/api/v10/interactions/777777777777777777/FAKE_OFFLINE_INTERACTION/callback');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);assert.ok(options.signal instanceof AbortSignal);assert.deepEqual(JSON.parse(options.body),{type:4,data:{content:'Request queued.',flags:64,allowed_mentions:{parse:[]}}});return new Response(null,{status:204});}});
 assert.deepEqual(await ack(input()),{state:'accepted',code:'ACK_ACCEPTED'});assert.equal(count,1);
});
test('expired/malformed ACK rejected before fetch and secrets never echoed',async()=>{
 let calls=0;const ack=createAcknowledger({now:()=>1000,fetchImpl:async()=>{calls++;throw Error('SECRET');}});
 for(const mutate of [i=>i.deadline=1000,i=>i.deadline=10000,i=>i.token='../other',i=>i.interaction_id='bad',i=>i.channel_id='bad']){const i=input();mutate(i);assert.equal((await ack(i)).state,'not_sent');}assert.equal(calls,0);assert.deepEqual(await ack(input()),{state:'uncertain',code:'ACK_UNCERTAIN'});assert.equal(calls,1);
});
test('ACK late response uncertain, 4xx not_sent, other response uncertain without retry',async()=>{
 for(const [status,state]of [[400,'not_sent'],[401,'not_sent'],[403,'not_sent'],[404,'not_sent'],[429,'not_sent'],[500,'uncertain'],[200,'uncertain']]){let calls=0;const ack=createAcknowledger({now:()=>1000,fetchImpl:async()=>{calls++;return new Response('{}',{status});}});assert.equal((await ack(input())).state,state);assert.equal(calls,1);}
 let now=1000;const ack=createAcknowledger({now:()=>now,fetchImpl:async()=>{now=3500;return new Response(null,{status:204});}});assert.equal((await ack(input())).state,'uncertain');
});
test('ACK snapshots mutable input before await, and requires explicit fetch',async()=>{
 assert.throws(()=>createAcknowledger({}));let done;const ack=createAcknowledger({now:()=>1000,fetchImpl:()=>new Promise(resolve=>{done=()=>resolve(new Response(null,{status:204}));})});const i=input(),pending=ack(i);i.deadline=0;i.token='changed';done();assert.equal((await pending).state,'accepted');
});
test('fixed ACK message comes from en/ko/ja locale catalogs',async()=>{
 const expected={en:'Request queued.',ko:'요청을 대기열에 넣었습니다.',ja:'リクエストをキューに追加しました。'};
 for(const [locale,message]of Object.entries(expected)){const ack=createAcknowledger({locale,now:()=>1000,fetchImpl:async(_,options)=>{assert.equal(JSON.parse(options.body).data.content,message);return new Response(null,{status:204});}});assert.equal((await ack(input())).state,'accepted');}
 assert.throws(()=>createAcknowledger({locale:'xx',fetchImpl:async()=>{}}));
});
