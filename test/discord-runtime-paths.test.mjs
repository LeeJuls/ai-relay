import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const mod=await import('../tools/discord-adapter/paths.mjs').catch(()=>({}));
const root=fileURLToPath(new URL('../',import.meta.url));
test('provider runtime paths remain inside this checkout and separate worker and ledgers',()=>{assert.equal(typeof mod.runtimePaths,'function');for(const provider of ['claude','codex']){const actual=mod.runtimePaths(provider);assert.deepEqual(actual,{worker:path.join(root,'runtime','bots',provider,'worker'),relay_ledger:path.join(root,'runtime','bots',provider,'relay-ledger'),summary_ledger:path.join(root,'runtime','bots',provider,'summary-ledger')});}});
test('unrecognized or traversing providers cannot escape runtime bindings',()=>{assert.equal(typeof mod.runtimePaths,'function');for(const value of ['../claude','CLAUDE','other','',null])assert.throws(()=>mod.runtimePaths(value),{message:'RUNTIME_PROVIDER_REQUIRED'});});