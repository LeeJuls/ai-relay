import test from 'node:test';
import assert from 'node:assert/strict';
const load=()=>import('../tools/discord-mock/preflight.mjs');
const empty=()=>({mode:'offline',server_id:null,ai_channel_id:null,human_channel_ids:[],owner_id:null,pc_label:null,session_labels:{},readonly_plan:{}});
const filled=()=>({mode:'offline',server_id:'fixture-server',ai_channel_id:'fixture-ai',human_channel_ids:['fixture-human'],owner_id:'fixture-owner',pc_label:'fixture-pc',session_labels:{claude:'fixture-claude',codex:'fixture-codex'},readonly_plan:{claude:'operator must choose enforced isolation and output callback',codex:'operator must choose enforced isolation and output callback'}});
test('missing inputs are listed without attempting discovery or enabling live',async()=>{
 const {inspectOfflineSetup}=await load(),out=inspectOfflineSetup(empty());assert.equal(out.input_complete,false);assert.equal(out.live_ready,false);assert.deepEqual(out.missing_inputs,['server_id','ai_channel_id','human_channel_ids','owner_id','pc_label','session_labels']);assert.equal(out.actual_tokens,null);
});
test('complete two-agent declarations still require manual evidence and each live approval',async()=>{
 const {inspectOfflineSetup}=await load(),out=inspectOfflineSetup(filled());assert.equal(out.input_complete,true);assert.equal(out.live_ready,false);assert.deepEqual(out.missing_inputs,[]);
 assert.ok(out.unverified_checks.includes('enforced_readonly_and_result_callback'));assert.ok(out.unverified_checks.includes('effective_human_channel_view_denial'));
 assert.deepEqual(out.approvals_needed,['bot_creation','oauth_install','credential_configuration','persistent_session_registration','live_adapter_execution','live_send']);
});
test('one selected session is enough for initial preparation but its readonly plan is required',async()=>{
 const {inspectOfflineSetup}=await load(),input=filled();delete input.session_labels.codex;delete input.readonly_plan.codex;assert.equal(inspectOfflineSetup(input).input_complete,true);
 delete input.readonly_plan.claude;assert.deepEqual(inspectOfflineSetup(input).missing_inputs,['readonly_plan.claude']);
});
test('duplicate or AI-overlapping human channels and malformed values fail closed',async()=>{
 const {inspectOfflineSetup}=await load();for(const change of [{human_channel_ids:['fixture-human','fixture-human']},{human_channel_ids:['fixture-ai']},{human_channel_ids:['']},{server_id:123},{pc_label:'x'.repeat(129)},{mode:'live'},{session_labels:{unknown:'session'}},{readonly_plan:{extra:'unsupported'}}])assert.throws(()=>inspectOfflineSetup({...filled(),...change}),{code:'INVALID_PREFLIGHT'});
});
test('credentials endpoints and verified assertions cannot turn the report into authorization',async()=>{
 const {inspectOfflineSetup}=await load();for(const change of [{token:'fake-private-fixture'},{session_endpoint:'fake-endpoint'},{live_ready:true},{readonly_verified:true},{approvals:{live_send:true}}])assert.throws(()=>inspectOfflineSetup({...filled(),...change}),{code:'INVALID_PREFLIGHT'});
});
test('report never echoes IDs labels or a readonly plan and never treats auto as proof',async()=>{
 const {inspectOfflineSetup}=await load(),input=filled();input.readonly_plan.claude='auto permissions; not proof';const out=inspectOfflineSetup(input),serialized=JSON.stringify(out);
 assert.equal(out.live_ready,false);for(const value of ['fixture-server','fixture-ai','fixture-owner','fixture-pc','fixture-claude','auto permissions'])assert.equal(serialized.includes(value),false);
});
test('preflight does not mutate caller declarations and refuses accessor execution',async()=>{
 const {inspectOfflineSetup}=await load(),input=filled(),before=structuredClone(input);inspectOfflineSetup(input);assert.deepEqual(input,before);
 let reads=0;Object.defineProperty(input,'server_id',{get(){reads++;return 'fixture-server';},enumerable:true});assert.throws(()=>inspectOfflineSetup(input),{code:'INVALID_PREFLIGHT'});assert.equal(reads,0);
});
test('human-channel arrays must be dense data with no custom methods or hidden fields',async()=>{
 const {inspectOfflineSetup}=await load();const secret=['fixture-human'];secret.token='fake-private-fixture';
 for(const human_channel_ids of [new Array(1),secret])assert.throws(()=>inspectOfflineSetup({...filled(),human_channel_ids}),{code:'INVALID_PREFLIGHT'});
});
test('channel index getters or overridden array methods cannot execute during preflight',async()=>{
 const {inspectOfflineSetup}=await load();let calls=0;const getter=[];Object.defineProperty(getter,'0',{get(){calls++;return 'fixture-human';},enumerable:true});const overridden=['fixture-human'];overridden.some=()=>{calls++;return false;};
 for(const human_channel_ids of [getter,overridden])assert.throws(()=>inspectOfflineSetup({...filled(),human_channel_ids}),{code:'INVALID_PREFLIGHT'});assert.equal(calls,0);
});
