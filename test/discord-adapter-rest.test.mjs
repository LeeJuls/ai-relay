import test from 'node:test';
import assert from 'node:assert/strict';
import {createRestRequest} from '../tools/discord-adapter/rest.mjs';
const channel='444444444444444444';
const input=()=>({method:'POST',path:`/api/v10/channels/${channel}/messages`,body:{content:'answer',nonce:'a'.repeat(24),enforce_nonce:true,allowed_mentions:{parse:[],replied_user:false}},timeout_ms:10000,max_response_bytes:65536,redirect:'error',automatic_retries:0});
test('REST client only calls injected fetch at fixed HTTPS Discord host with deadline and no redirects',async()=>{
 let calls=0;const request=createRestRequest({channel_id:channel,authorization:async()=> 'Bot OFFLINE_ONLY',fetchImpl:async(url,options)=>{calls++;assert.equal(url,`https://discord.com/api/v10/channels/${channel}/messages`);assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);assert.equal(options.headers.Authorization,'Bot OFFLINE_ONLY');return new Response(JSON.stringify({id:'777777777777777777'}),{status:200});}});
 assert.equal(calls,0);assert.deepEqual(await request(input()),{status:200,body:{id:'777777777777777777'}});assert.equal(calls,1);
});
test('REST refuses alternative targets, unsafe mentions, retry/timeout overrides before credential callback',async()=>{
 let calls=0;const request=createRestRequest({channel_id:channel,authorization:async()=>{calls++;return 'Bot OFFLINE_ONLY';},fetchImpl:async()=>{throw Error();}});
 for(const mutate of [r=>r.path='https://evil.invalid',r=>r.path='/api/v10/channels/666666666666666666/messages',r=>r.method='GET',r=>r.body.allowed_mentions.parse=['everyone'],r=>r.timeout_ms=0,r=>r.automatic_retries=1,r=>r.body.attachments=[],r=>r.body.content='x'.repeat(1801)]){const r=input();mutate(r);await assert.rejects(request(r),e=>e.code==='INVALID_REST_REQUEST');}assert.equal(calls,0);
});
test('REST errors never expose credential/provider/fetch error and no automatic retries',async()=>{
 for(const auth of [async()=>{throw Error('SECRET');},async()=> 'Bearer SECRET']){const request=createRestRequest({channel_id:channel,authorization:auth,fetchImpl:async()=>{throw Error();}});await assert.rejects(request(input()),e=>e.code==='DISCORD_REQUEST_UNCERTAIN'&&!e.message.includes('SECRET')&&!e.cause);}
 let calls=0;const request=createRestRequest({channel_id:channel,authorization:async()=> 'Bot OFFLINE_ONLY',fetchImpl:async()=>{calls++;throw Error('SECRET');}});await assert.rejects(request(input()),e=>e.code==='DISCORD_REQUEST_UNCERTAIN'&&!e.message.includes('SECRET'));assert.equal(calls,1);
});
test('response bytes, malformed JSON and redirects fail closed without leaking body',async()=>{
 for(const response of [new Response('x'.repeat(65537)),new Response('SECRET'),new Response('{}',{status:302,headers:{location:'https://evil.invalid'}})]){const request=createRestRequest({channel_id:channel,authorization:async()=> 'Bot OFFLINE_ONLY',fetchImpl:async()=>response});await assert.rejects(request(input()),e=>e.code==='DISCORD_REQUEST_UNCERTAIN'&&!e.message.includes('SECRET'));}
});
test('429 is returned without retry; fetch and authorization are required injection',async()=>{
 const request=createRestRequest({channel_id:channel,authorization:async()=> 'Bot OFFLINE_ONLY',fetchImpl:async()=>new Response('{"retry_after":2}',{status:429})});assert.deepEqual(await request(input()),{status:429,body:{retry_after:2}});
 assert.throws(()=>createRestRequest({channel_id:channel}));
});
