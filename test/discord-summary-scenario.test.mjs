import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {sandbox} from './fixture.mjs';
const exec=promisify(execFile);
test('fake scenario posts two summaries without external or AI calls',async t=>{const {root}=await sandbox(t);const {stdout}=await exec(process.execPath,['tools/discord-summary/scenario.mjs','--root',root],{env:{SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP},windowsHide:true});const result=JSON.parse(stdout);assert.equal(result.state,'finished');assert.equal(result.counts.accepted,2);assert.equal(result.transport,'fake_only');const second=await exec(process.execPath,['tools/discord-summary/scenario.mjs','--root',root],{env:{SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP},windowsHide:true}).catch(e=>e);assert.notEqual(second.code,0);});
test('import has no effects and unknown live flag is refused',async()=>{const {stdout}=await exec(process.execPath,['--input-type=module','-e',"globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN')};await import('./tools/discord-summary/scenario.mjs');console.log('import-only');"],{env:{SystemRoot:process.env.SystemRoot},windowsHide:true});assert.equal(stdout.trim(),'import-only');const bad=await exec(process.execPath,['tools/discord-summary/scenario.mjs','--live'],{env:{SystemRoot:process.env.SystemRoot},windowsHide:true}).catch(e=>e);assert.notEqual(bad.code,0);assert.match(bad.stderr,/SUMMARY_SCENARIO_FAILED/);});
