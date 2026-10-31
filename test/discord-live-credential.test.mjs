import test from 'node:test';import assert from 'node:assert/strict';
import {config} from './discord-host-fixture.mjs';
const mod=await import('../tools/discord-adapter/live-transport.mjs').catch(()=>({}));
test('live transport implementation exists',()=>assert.equal(typeof mod.credentialFromText,'function'));
test('malformed credential never appears in errors',()=>{const secret='FAKE_SECRET_DO_NOT_LOG';try{mod.credentialFromText('wrong='+secret);assert.fail();}catch(e){assert.equal(e.message.includes(secret),false);assert.equal(e.code,'LIVE_CREDENTIAL_INVALID');}});
test('only fixed Discord origin and approved control paths can use auth',async()=>{
 const secret='fake.token.value.for.offline.test';const auth=mod.credentialFromText('DISCORD_BOT_TOKEN='+secret+'\n');let count=0;
 const request=mod.createControlRequest({config,authorization:auth,fetchImpl:async(url,opts)=>{count++;assert.equal(opts.headers.Authorization,'Bot '+secret);throw Error(secret);}});
 for(const path of ['https://evil.test/',`/api/v10/channels/${config.human_channel_ids[0]}/messages`,'/api/v10/users/@me/anything'])await assert.rejects(request('GET',path),e=>!e.message.includes(secret));assert.equal(count,0);
 await assert.rejects(request('GET','/api/v10/users/@me'),e=>e.code==='LIVE_REQUEST_UNCERTAIN'&&!e.message.includes(secret));assert.equal(count,1);
});
test('safe logger drops unknown fields and error objects',()=>{
 const logs=[];const log=mod.safeLogger(v=>logs.push(v));log('auth',{ok:true,token:'FAKE_SECRET',error:new Error('FAKE_SECRET')});assert.equal(JSON.stringify(logs).includes('FAKE_SECRET'),false);assert.deepEqual(logs,[{event:'auth',ok:true}]);
 log('FAKE_SECRET',{code:'FAKE_SECRET'});assert.equal(JSON.stringify(logs).includes('FAKE_SECRET'),false);
});
