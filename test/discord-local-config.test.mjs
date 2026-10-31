import test from 'node:test';import assert from 'node:assert/strict';
import {config} from './discord-host-fixture.mjs';
const mod=await import('../tools/discord-adapter/local-config.mjs').catch(()=>({}));
test('local machine settings are explicit and secret keys are refused',()=>{
 const input={adapter:config,claude_executable:'C:/approved/claude.exe'};assert.deepEqual(mod.validateLocalConfig(input),input);assert.throws(()=>mod.validateLocalConfig({...input,token:'FAKE_SECRET'}));assert.throws(()=>mod.validateLocalConfig({...input,adapter:{...config,bot_token:'FAKE_SECRET'}}));assert.throws(()=>mod.validateLocalConfig({...input,claude_executable:'claude.exe'}));
});
