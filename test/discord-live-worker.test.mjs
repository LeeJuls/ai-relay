import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
const mod=await import('../tools/discord-adapter/worker.mjs').catch(()=>({}));
test('worker implementation exists',()=>assert.equal(typeof mod.workerArgs,'function'));
test('explicit empty tools strict MCP no persistence without resume',()=>{
 const a=mod.workerArgs(); assert.equal(a[a.indexOf('--tools')+1],'');assert.ok(a.includes('--restricted'));assert.ok(a.includes('--safe-mode'));assert.ok(a.includes('--no-session-persistence'));assert.ok(!a.includes('--resume'));
});
test('worker refuses nonempty startup tools and MCP before results',()=>{
 assert.throws(()=>mod.validateInit({type:'system',subtype:'init',tools:['Read'],mcp_servers:[]}));
 assert.throws(()=>mod.validateInit({type:'system',subtype:'init',tools:[],mcp_servers:[{name:'mail'}]}));
 assert.equal(mod.validateInit({type:'system',subtype:'init',tools:[],mcp_servers:[]}),true);
});
test('final result cannot substitute for missing tool manifest',()=>assert.throws(()=>mod.parseWorkerEvents([{type:'result',subtype:'success',result:'ok',is_error:false}],0)));
test('worker rejects tool calls and oversize results',()=>{
 const init={type:'system',subtype:'init',tools:[],mcp_servers:[]};
 assert.throws(()=>mod.parseWorkerEvents([init,{type:'assistant',message:{content:[{type:'tool_use',name:'Read'}]}},{type:'result',subtype:'success',result:'ok'}],0));
 assert.throws(()=>mod.parseWorkerEvents([init,{type:'result',subtype:'success',is_error:false,result:'x'.repeat(1801)}],0));
 assert.equal(mod.parseWorkerEvents([init,{type:'result',subtype:'success',is_error:false,result:'ok'}],0).text,'ok');
});
test('API provider environment is refused, Discord token is not inherited',()=>{
 assert.throws(()=>mod.workerEnvironment({ANTHROPIC_API_KEY:'fake'}));
 const env=mod.workerEnvironment({PATH:'x',SystemRoot:'x',DISCORD_BOT_TOKEN:'FAKE_SECRET',CLAUDECODE:'1'}); assert.equal(env.DISCORD_BOT_TOKEN,undefined);assert.equal(env.CLAUDECODE,undefined);
});
test('caller boolean cannot grant worker authorization',async()=>{
 await assert.rejects(async()=>mod.createWorkerBroker({cwd:'.',verified:true}));
});
test('capability probe names only a harmless nonexistent fixture and command',()=>{
 assert.match(mod.probePrompt,/nonexistent-safe-probe\.txt/);assert.match(mod.probePrompt,/echo SAFE_PROBE/);assert.match(mod.probePrompt,/Do not read any other/);
});
function childFixture(){return Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),pid:123,unref(){}});}
test('worker preserves a Korean result split across UTF8 bytes',async()=>{
 const child=childFixture();const bytes=Buffer.from(JSON.stringify({type:'system',subtype:'init',tools:[],mcp_servers:[]})+'\n'+JSON.stringify({type:'result',subtype:'success',is_error:false,result:'한글'})+'\n');const split=bytes.indexOf(Buffer.from('한'))+1;
 const result=await mod.runWorker({cli:'C:/approved/claude.exe',cwd:'.',prompt:'test',env:{},spawnProcess:()=>{setImmediate(()=>{child.stdout.write(bytes.subarray(0,split));child.stdout.write(bytes.subarray(split));child.emit('close',0);});return child;}});assert.equal(result.text,'한글');
});
test('worker termination uncertainty is bounded and never called success',async()=>{
 let kills=0;await assert.rejects(mod.runWorker({cli:'C:/approved/claude.exe',cwd:'.',prompt:'test',env:{},timeoutMs:10,terminationWaitMs:10,spawnProcess:childFixture,terminate:async()=>{kills++;}}),{code:'WORKER_PROCESS_UNCERTAIN'});assert.equal(kills,1);
});
test('timeout diagnosis exposes only counters and fixed event facts',async()=>{
 const facts=[];const child=childFixture();await assert.rejects(mod.runWorker({cli:'C:/approved/claude.exe',cwd:'.',prompt:'test',env:{},timeoutMs:10,spawnProcess:()=>{setImmediate(()=>child.stderr.write('FAKE_SECRET'));return child;},terminate:async()=>child.emit('close',1),onDiagnostic:f=>facts.push(f)}),{code:'WORKER_TIMEOUT'});assert.ok(facts.length);assert.equal(JSON.stringify(facts).includes('FAKE_SECRET'),false);assert.equal(facts.at(-1).stderr_bytes,11);assert.equal(facts.at(-1).process_ended,true);
});
test('missing machine executable is refused before spawning any process',async()=>{
 let spawns=0;await assert.rejects(mod.runWorker({cwd:'.',prompt:'test',env:{},timeoutMs:10,terminationWaitMs:10,spawnProcess:()=>{spawns++;return childFixture();},terminate:async()=>{}}),{code:'WORKER_BINDING_REQUIRED'});assert.equal(spawns,0);
});
