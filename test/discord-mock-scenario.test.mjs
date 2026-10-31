import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {sandbox} from './fixture.mjs';
const exec=promisify(execFile);
test('one-shot scenario shows no idle or blocked effects and one explicit exchange without token claims',async t=>{
 const {runMockScenario}=await import('../tools/discord-mock/scenario.mjs'),b=await sandbox(t),r=await runMockScenario({root:b.root});
 assert.equal(r.mode,'mock');assert.equal(r.idle_dispatches,0);assert.equal(r.blocked_dispatches,0);assert.equal(r.fake_dispatches,1);assert.equal(r.fake_publishes,1);assert.equal(r.completed,1);assert.equal(r.actual_tokens,null);assert.equal(r.usage_measured,false);
 assert.equal(JSON.stringify(r).includes('mock question'),false);assert.equal(Object.hasOwn(r,'task_id'),false);
});
test('CLI exits with counts only and never needs a token or ambient app environment',async t=>{
 const b=await sandbox(t),script=fileURLToPath(new URL('../tools/discord-mock/scenario.mjs',import.meta.url));
 const {stdout,stderr}=await exec(process.execPath,[script,'--root',b.root],{windowsHide:true,env:{SystemRoot:process.env.SystemRoot},timeout:10000});
 const r=JSON.parse(stdout);assert.equal(stderr,'');assert.equal(r.completed,1);assert.equal(r.fake_dispatches,1);assert.equal(r.fake_publishes,1);assert.equal(r.actual_tokens,null);
 await assert.rejects(exec(process.execPath,[script],{windowsHide:true,env:{SystemRoot:process.env.SystemRoot}}));
});
test('mock entrypoint dependency boundary excludes credential discovery and live transport or network APIs',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),folder=path.join(root,'tools','discord-mock');
 const allowed=new Set(['./policy.mjs','./store.mjs','./bridge.mjs','./fakes.mjs','../../lib/message.mjs','../../lib/storage.mjs','../../lib/errors.mjs','node:fs/promises','node:path','node:crypto','node:url']);
 for(const name of await fs.readdir(folder))if(name.endsWith('.mjs')){
  const source=await fs.readFile(path.join(folder,name),'utf8');
  for(const m of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g))assert.ok(allowed.has(m[1]),`${name}: disallowed import ${m[1]}`);
  assert.doesNotMatch(source,/\bimport\s*\(|\beval\s*\(|\bFunction\s*\(|\brequire\s*\(|\bfetch\s*\(|\bWebSocket\b|process\s*\.\s*env|\bsetInterval\s*\(|\bsetTimeout\s*\(/,name);
  assert.doesNotMatch(source,/import\s*['"]/,`${name}: side-effect import`);
 }
});
