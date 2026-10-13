import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize} from '../tools/turn-cost/reader.mjs';
const since='2026-10-06T00:00:00Z',until='2026-10-07T00:00:00Z';
const row=(type,content,timestamp='2026-10-06T01:00:00Z',more={})=>({type,timestamp,message:{role:type,content,...more}});
test('mail batch is one turn, assistant IDs deduplicate and cached input stays separate',()=>{
 const call=row('assistant','PRIVATE_SECRET',undefined,{id:'msg-1',usage:{input_tokens:5,cache_read_input_tokens:50,cache_creation_input_tokens:2,output_tokens:8}});
 const rows=[row('user','[peer codex-demo #abc not-owner]\nnotice\n[peer codex-demo #def not-owner]\nnotice2'),call,call,row('assistant','x',undefined,{id:'msg-2',usage:{input_tokens:3,cache_read_input_tokens:30}}),row('user','owner next')];
 const r=summarize(rows,{since,until});assert.equal(r.turns.length,2);assert.equal(r.turns[0].trigger,'codex_mail');assert.equal(r.turns[0].mailCount,2);assert.equal(r.turns[0].calls,2);assert.equal(r.totals.cacheRead,80);assert.equal(r.totals.input,8);assert.equal(r.totals.cacheWrite,2);assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);
});
test('window is required, out-of-window usage excluded, handover remains only a candidate',()=>{
 assert.throws(()=>summarize([],{}));assert.throws(()=>summarize([],{since:until,until:since}));
 const rows=[row('user','[cl #abc] give unity'),row('assistant','', '2026-10-08T00:00:00Z',{id:'out',usage:{input_tokens:900}})];
 const r=summarize(rows,{since,until});assert.equal(r.turns[0].handoverCandidate,true);assert.equal(r.totals.input,0);
});
test('Codex task_complete closes a task, token count rows are calls not task totals',()=>{
 const ev=(type,extra)=>({type:'event_msg',timestamp:'2026-10-06T02:00:00Z',payload:{type,...extra}});
 const r=summarize([ev('task_started',{}),ev('user_message',{message:'[cl #abcdef] result'}),ev('token_count',{info:{last_token_usage:{input_tokens:100,cached_input_tokens:90,output_tokens:4}}}),ev('task_complete',{}),ev('token_count',{info:{last_token_usage:{input_tokens:999}}})],{since,until,provider:'codex'});
 assert.equal(r.turns.length,1);assert.equal(r.totals.input,10);assert.equal(r.totals.cacheRead,90);assert.equal(r.turns[0].trigger,'claude_mail');
});
test('Claude tool-result user rows continue their existing turn',()=>{
 const rows=[row('user','owner request'),row('assistant','',undefined,{id:'a',usage:{input_tokens:1}}),row('user',[{type:'tool_result',tool_use_id:'t',content:'done'}]),row('assistant','',undefined,{id:'b',usage:{input_tokens:2}})];
 const r=summarize(rows,{since,until});assert.equal(r.turns.length,1);assert.equal(r.turns[0].calls,2);
});
