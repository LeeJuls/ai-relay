import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCommand,createIngress,adapterConfig} from '../tools/discord-adapter/interaction.mjs';

export const nowMs=Date.UTC(2026,9,30,23,50);
export const config={application_id:'111111111111111111',command_id:'222222222222222222',guild_id:'333333333333333333',channel_id:'444444444444444444',owner_id:'555555555555555555',human_channel_ids:['666666666666666666'],command:'ask',session_address:'readonly-claude',route_id:'discord-test'};
export function event(){return {op:0,t:'INTERACTION_CREATE',d:{id:((BigInt(nowMs)-1420070400000n)<<22n).toString(),application_id:config.application_id,type:2,guild_id:config.guild_id,channel_id:config.channel_id,channel:{id:config.channel_id,type:0},member:{user:{id:config.owner_id,bot:false}},data:{id:config.command_id,name:'ask',type:1,options:[{name:'text',type:3,value:'short question'}]},token:'FAKE_DO_NOT_PERSIST'}};}
test('command yields deterministic pinned provider-neutral question without interaction credential',()=>{
 const a=parseCommand(event(),config,nowMs),b=parseCommand(event(),config,nowMs);
 assert.equal(a.accepted,true);assert.deepEqual(a,b);assert.equal(a.request.session_address,config.session_address);assert.equal(a.request.envelope.body,'short question');assert.equal(a.request.envelope.type,'question');
 assert.ok(a.task_id.startsWith('discord-task-'));assert.equal(JSON.stringify(a).includes('FAKE_DO_NOT_PERSIST'),false);
});
test('config requires every exact target and refuses human overlap, unknown secret and malformed snowflakes',()=>{
 for(const k of Object.keys(config)){const c={...config};delete c[k];assert.throws(()=>adapterConfig(c));}
 assert.throws(()=>adapterConfig({...config,human_channel_ids:[config.channel_id]}));assert.throws(()=>adapterConfig({...config,token:'fake'}));assert.throws(()=>adapterConfig({...config,owner_id:'01'}));
 const humans=[...config.human_channel_ids],c=adapterConfig({...config,human_channel_ids:humans});humans[0]=config.channel_id;assert.notEqual(c.human_channel_ids[0],config.channel_id);
});
test('human channel denied before command text inspection',()=>{
 const e=event();e.d.channel_id=config.human_channel_ids[0];Object.defineProperty(e.d,'data',{get(){throw Error('must not inspect');}});
 assert.equal(parseCommand(e,config,nowMs).accepted,false);
});
test('rejects wrong app, owner, command, guild, DM, thread, bot, webhook, attachments and extra options',()=>{
 const mutate=[e=>e.t='MESSAGE_CREATE',e=>e.d.application_id='777777777777777777',e=>e.d.member.user.id='777777777777777777',e=>e.d.guild_id=null,e=>e.d.channel.type=11,e=>e.d.member.user.bot=true,e=>e.d.webhook_id='777777777777777777',e=>e.d.data.resolved={attachments:{x:{}}},e=>e.d.data.options.push({name:'other',type:3,value:'x'}),e=>e.d.data.id='777777777777777777',e=>e.d.type=3,e=>e.d.user={id:config.owner_id},e=>e.d.data.type=2];
 for(const f of mutate){const e=event();f(e);assert.equal(parseCommand(e,config,nowMs).accepted,false);}
});
test('size, stale/future snowflake, malformed event, mention text and clock are refused',()=>{
 for(const value of ['', 'a'.repeat(4097),'@everyone do it','<@555555555555555555>']){const e=event();e.d.data.options[0].value=value;assert.equal(parseCommand(e,config,nowMs).accepted,false);}
 assert.equal(parseCommand(event(),config,nowMs+300001).accepted,false);assert.equal(parseCommand(event(),config,nowMs-30001).accepted,false);assert.equal(parseCommand(event(),config,NaN).accepted,false);
 for(const e of [null,{},[],{op:0,t:'INTERACTION_CREATE',d:null}])assert.equal(parseCommand(e,config,nowMs).accepted,false);
});
test('ingress no idle effects, stop blocks new admission, duplicate maps once through durable admission contract',async()=>{
 const seen=new Map();let effects=0;const ingress=createIngress({config,now:()=>nowMs,admit:async item=>{if(seen.has(item.event_key))return {state:'duplicate',task_id:item.task_id};seen.set(item.event_key,item.task_id);effects++;return {state:'queued',task_id:item.task_id};}});
 assert.equal(effects,0);assert.equal((await ingress.receive(event())).state,'queued');assert.equal((await ingress.receive(event())).state,'duplicate');assert.equal(effects,1);ingress.stop();assert.equal((await ingress.receive(event())).code,'STOPPED');assert.equal(effects,1);
});
test('admission exception is uncertain and never retried or echoed',async()=>{
 let calls=0;const ingress=createIngress({config,now:()=>nowMs,admit:async()=>{calls++;throw Error('SECRET');}});
 assert.deepEqual(await ingress.receive(event()),{state:'uncertain',code:'ADMISSION_UNCERTAIN'});assert.equal(calls,1);
});
