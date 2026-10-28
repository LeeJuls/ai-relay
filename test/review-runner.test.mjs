import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { sandbox } from './fixture.mjs';
import { reviewArgs, reviewEnvironment, runReviewCli, validateResult } from '../lib/review-runner.mjs';
const result = { conclusion: 'Agree', evidence: ['fixture'], nextAction: 'Owner decides' };
function fakeChild() {
  const c = new EventEmitter(); c.pid = 123;
  c.stdin = new PassThrough(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); return c;
}
async function request(t, provider = 'claude') {
  const b = await sandbox(t); const jobDir = path.join(b.container, 'job'); await fs.mkdir(jobDir);
  return { provider, cli: process.execPath, model: 'test-model', jobDir, evidenceDirs: [], deadlineMs: 1000, prompt: 'Review the supplied fact' };
}
test('subscription-only environment rejects custom providers, API keys and token overrides', () => {
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_OAUTH_TOKEN']) assert.throws(() => reviewEnvironment({ [name]: 'secret' }, 'claude'), { code: 'REVIEW_AUTH' });
  for (const name of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL']) assert.throws(() => reviewEnvironment({ [name]: 'secret' }, 'codex'), { code: 'REVIEW_AUTH' });
  assert.deepEqual(reviewEnvironment({ CLAUDECODE: '1', CLAUDE_CODE_SIMPLE: '1', CODEX_THREAD_ID: 'parent', ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, 'claude'), {});
  assert.throws(() => reviewEnvironment({ ANTHROPIC_BASE_URL: 'https://apiXanthropic.com/' }, 'claude'));
});
test('both CLI commands forbid history resume and use bounded read-only output', () => {
  for (const provider of ['claude', 'codex']) {
    const args = reviewArgs({ provider, model: 'test-model', jobDir: '/job', evidenceDirs: ['/evidence'] });
    assert.ok(!args.includes('--bare')); assert.ok(!args.includes('--resume')); assert.ok(!args.includes('--dangerously-skip-permissions'));
    if (provider === 'codex') { assert.ok(args.includes('read-only')); assert.ok(args.includes('--ignore-user-config')); assert.ok(args.includes('--output-schema')); }
    else { assert.ok(args.includes('--restricted')); assert.ok(args.includes('Read,Grep,Glob')); assert.ok(args.includes('/evidence')); }
  }
  assert.throws(() => validateResult({ ...result, extra: true }), { code: 'REVIEW_OUTPUT' });
});
test('Claude success stores structured result usage without a second model call', async t => {
  const r = await request(t); let calls = 0;
  const out = await runReviewCli(r, { env: {}, authenticate: async () => {}, spawnProcess: (_, args, opt) => {
    calls++; assert.equal(opt.shell, false); const c = fakeChild();
    c.stdin.once('finish', () => { c.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', usage: { input_tokens: 5 }, structured_output: result })); c.emit('close', 0); }); return c;
  } });
  assert.equal(calls, 1); assert.deepEqual(out.result, result);
  assert.equal(JSON.parse(await fs.readFile(path.join(r.jobDir, 'process.json'))).processEnded, true);
});
test('Codex success requires a completed turn, schema output and usage', async t => {
  const r = await request(t, 'codex');
  const out = await runReviewCli(r, { env: {}, authenticate: async () => {}, spawnProcess: () => {
    const c = fakeChild(); c.stdin.once('finish', () => void (async () => {
      await fs.writeFile(path.join(r.jobDir, 'output.json'), JSON.stringify(result));
      c.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 8, cached_input_tokens: 5, output_tokens: 2 } }) + '\n'); c.emit('close', 0);
    })()); return c;
  } }); assert.deepEqual(out.result, result);
});
test('permission denials cannot be certified as a completed Claude review', async t => {
  const r = await request(t);
  await assert.rejects(runReviewCli(r, { env: {}, authenticate: async () => {}, spawnProcess: () => {
    const c = fakeChild(); c.stdin.once('finish', () => { c.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', usage: {}, permission_denials: [{}], structured_output: result })); c.emit('close', 0); }); return c;
  } }), { code: 'REVIEW_OUTPUT' });
});
test('a failed Codex evidence command cannot certify a completed review', async t => {
  const r = await request(t, 'codex');
  await assert.rejects(runReviewCli(r, { env: {}, authenticate: async () => {}, spawnProcess: () => {
    const c = fakeChild(); c.stdin.once('finish', () => void (async () => {
      await fs.writeFile(path.join(r.jobDir,'output.json'),JSON.stringify(result));
      c.stdout.write(JSON.stringify({type:'item.completed',item:{type:'command_execution',status:'failed',exit_code:1}})+'\n');
      c.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:1}})+'\n'); c.emit('close',0);
    })()); return c;
  } }), { code: 'REVIEW_OUTPUT' });
});
test('timeout preserves partial logs, kills the child tree and does not retry', async t => {
  const r = await request(t); r.deadlineMs = 10; let killed = 0, calls = 0, child;
  await assert.rejects(runReviewCli(r, { env: {}, authenticate: async () => {}, spawnProcess: () => { calls++; child = fakeChild(); child.stdout.write('partial'); return child; }, killProcessTree: async () => { killed++; child.emit('close', 1); } }), { code: 'REVIEW_TIMEOUT' });
  assert.equal(killed, 1); assert.equal(calls, 1); assert.equal(await fs.readFile(path.join(r.jobDir, 'stdout.log'), 'utf8'), 'partial');
});
test('a failed termination reports execution uncertainty rather than releasing ownership', async t => {
  const r = await request(t); r.deadlineMs = 10;
  await assert.rejects(runReviewCli(r, { env: {}, authenticate: async () => {}, spawnProcess: () => fakeChild(), killProcessTree: async () => { throw Error('EPERM'); }, terminationWaitMs: 10 }), { code: 'REVIEW_PROCESS_UNCERTAIN' });
  const state = JSON.parse(await fs.readFile(path.join(r.jobDir, 'process.json')));
  assert.equal(state.processEnded, false); assert.equal(state.code, 'REVIEW_PROCESS_UNCERTAIN');
});

test('generation receives the existing validator bounds with provider-compatible schemas', async t => {
  for (const provider of ['claude', 'codex']) {
    const r = await request(t, provider); let suppliedPrompt = '';
    await runReviewCli(r, { env: {}, authenticate: async () => {}, spawnProcess: (_, args) => {
      const c = fakeChild();
      c.stdin.on('data', b => { suppliedPrompt += b; });
      c.stdin.once('finish', () => void (async () => {
        const schema = JSON.parse(await fs.readFile(path.join(r.jobDir, 'schema.json')));
        if (provider === 'codex') {
          assert.equal(schema.properties.conclusion.maxLength, 4000);
          assert.equal(schema.properties.evidence.maxItems, 20);
          assert.equal(schema.properties.evidence.items.maxLength, 2000);
          assert.equal(schema.properties.nextAction.maxLength, 4000);
          await fs.writeFile(path.join(r.jobDir, 'output.json'), JSON.stringify(result));
          c.stdout.write(JSON.stringify({ type: 'turn.completed', usage: {} }) + '\n');
        } else {
          const cliSchema = JSON.parse(args[args.indexOf('--json-schema') + 1]);
          assert.deepEqual(cliSchema, schema);
          assert.ok(!/"(?:maxLength|minLength|maxItems)"/.test(JSON.stringify(schema)));
          assert.match(schema.properties.conclusion.description, /4000/);
          c.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', usage: {}, structured_output: result }));
        }
        c.emit('close', 0);
      })()); return c;
    } });
    assert.match(suppliedPrompt, /4000/); assert.match(suppliedPrompt, /2000/);
    assert.match(suppliedPrompt, /20/); assert.match(suppliedPrompt, /UTF-16/);
    assert.match(suppliedPrompt, /blocked/i);
    assert.equal(await fs.readFile(path.join(r.jobDir, 'prompt.txt'), 'utf8'), suppliedPrompt);
  }
  assert.equal(validateResult({ ...result, conclusion: 'x'.repeat(4000) }).conclusion.length, 4000);
  assert.throws(() => validateResult({ ...result, conclusion: 'x'.repeat(4001) }), { code: 'REVIEW_OUTPUT_LIMIT' });
});

for (const provider of ['claude', 'codex']) test(`${provider} rejected output preserves raw logs and usage without retry`, async t => {
  const r = await request(t, provider); let calls = 0;
  const usage = { input_tokens: 319910, output_tokens: 14401 };
  const oversized = { ...result, conclusion: 'x'.repeat(6798) };
  await assert.rejects(runReviewCli(r, { env: {}, authenticate: async () => {}, spawnProcess: () => {
    calls++; const c = fakeChild(); c.stdin.once('finish', () => void (async () => {
      if (provider === 'claude') c.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', usage, structured_output: oversized }));
      else {
        await fs.writeFile(path.join(r.jobDir, 'output.json'), JSON.stringify(oversized));
        c.stdout.write(JSON.stringify({ type: 'turn.completed', usage }) + '\n');
      }
      c.emit('close', 0);
    })()); return c;
  } }), { code: 'REVIEW_OUTPUT_LIMIT' });
  assert.equal(calls, 1);
  const saved = JSON.parse(await fs.readFile(path.join(r.jobDir, 'usage.json')));
  assert.deepEqual(saved.usage, provider === 'claude' ? usage : [usage]);
  const state = JSON.parse(await fs.readFile(path.join(r.jobDir, 'process.json')));
  assert.equal(state.phase, 'held'); assert.equal(state.code, 'REVIEW_OUTPUT_LIMIT');
  assert.match(await fs.readFile(path.join(r.jobDir, 'stdout.log'), 'utf8'), /319910/);
});

test('nonzero OAuth contention is diagnosed and accounted, never retried or certified', async t => {
  const r = await request(t); let calls = 0;
  const payload = { type: 'result', subtype: 'error_during_execution', is_error: true,
    result: 'another Claude Code process is refreshing it', usage: { input_tokens: 0 } };
  await assert.rejects(runReviewCli(r, { env: {}, authenticate: async () => {}, spawnProcess: () => {
    calls++; const c = fakeChild(); c.stdin.once('finish', () => { c.stdout.write(JSON.stringify(payload)); c.emit('close', 1); }); return c;
  } }), { code: 'REVIEW_AUTH_REFRESH_BUSY' });
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(r.jobDir, 'usage.json'))).usage, payload.usage);
  const state = JSON.parse(await fs.readFile(path.join(r.jobDir, 'process.json')));
  assert.equal(state.phase, 'held'); assert.equal(state.exitCode, 1);
  assert.equal(state.code, 'REVIEW_AUTH_REFRESH_BUSY');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(r.jobDir, 'stdout.log'))), payload);
});

for (const provider of ['claude', 'codex']) test(`${provider} nonzero exit rejects an otherwise valid verdict but retains usage`, async t => {
  const r = await request(t, provider);
  await assert.rejects(runReviewCli(r, { env: {}, authenticate: async () => {}, spawnProcess: () => {
    const c = fakeChild(); c.stdin.once('finish', () => void (async () => {
      if (provider === 'claude') c.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', usage: { input_tokens: 17 }, structured_output: result }));
      else {
        await fs.writeFile(path.join(r.jobDir, 'output.json'), JSON.stringify(result));
        c.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 17 } }) + '\n');
      }
      c.emit('close', 1);
    })()); return c;
  } }), { code: 'REVIEW_EXEC' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(r.jobDir, 'usage.json'))).usage,
    provider === 'claude' ? { input_tokens: 17 } : [{ input_tokens: 17 }]);
  assert.equal(JSON.parse(await fs.readFile(path.join(r.jobDir, 'process.json'))).phase, 'held');
});
