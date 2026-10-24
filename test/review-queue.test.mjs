import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { paired } from './fixture.mjs';
import { configureReview, runReview } from '../lib/review.mjs';
import { createReviewQueue } from '../lib/review-queue.mjs';
import { RelayError } from '../lib/errors.mjs';
const result = { conclusion: 'Agree', evidence: [], nextAction: 'Owner decides' };
async function setup(t) {
  const b = await paired(t), config = { cli: process.execPath, model: 'fixture', jobRoot: path.join(b.container, 'jobs'), evidenceDirs: [], deadlineMs: 1000 };
  await configureReview({ root: b.root, address: 'claude-demo', config }); return { ...b, config };
}
test('restart queue reconciles saved exact replies even after the request was archived', async t => {
  const b = await setup(t), id = (await b.cx.send({ body: 'Review', review: { mode: 'review' } })).id;
  await runReview({ root: b.root, address: 'claude-demo', id, runner: async () => ({ result }) });
  const f = path.join(b.root, 'reviews', 'claude-demo', id + '.json'), state = JSON.parse(await fs.readFile(f));
  await fs.writeFile(f, JSON.stringify({ ...state, state: 'publishing' }));
  await fs.writeFile(path.join(b.root, 'reviews', 'claude-demo', 'execution.json'), JSON.stringify({schemaVersion:1,id,hash:state.hash,jobDir:state.jobDir,ownerPid:process.pid}));
  let executions = 0;
  const queue = createReviewQueue({ root: b.root, address: 'claude-demo', run: args => runReview({ ...args, runner: async () => { executions++; return { result }; } }) });
  await queue.scan(); await queue.idle();
  assert.equal(JSON.parse(await fs.readFile(f)).state, 'replied'); assert.equal(executions, 0);
  await assert.rejects(fs.stat(path.join(b.root,'reviews','claude-demo','execution.json')), {code:'ENOENT'});
});
test('disabling before admission does not permanently consume a queued ID', async t => {
  const b = await setup(t);
  const one = await b.cx.send({ body: 'A', review: { mode: 'review' } });
  const two = await b.cx.send({ body: 'B', review: { mode: 'review' } });
  let finish, calls = [];
  const queue = createReviewQueue({ root: b.root, address: 'claude-demo', run: async args => {
    const enabled = (await b.cl.received(args.id))?.message;
    return runReview({ ...args, runner: async () => {
      calls.push(enabled.body);
      if (args.id === one.id) await new Promise(resolve => { finish = resolve; });
      return { result };
    } });
  } });
  await queue.scan(); while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
  await configureReview({ root: b.root, address: 'claude-demo', config: false }); finish(); await queue.idle();
  assert.deepEqual(calls, ['A']);
  await configureReview({ root: b.root, address: 'claude-demo', config: b.config }); await queue.scan(); await queue.idle();
  assert.deepEqual(calls, ['A', 'B']); assert.ok((await b.cx.inbox()).some(x => x.replyTo === two.id));
});
test('uncertain child termination retains the address gate across queue restart', async t => {
  const b = await setup(t); let calls = 0, errors = 0;
  const first = await b.cx.send({ body: 'A', review: { mode: 'review' } });
  await b.cx.send({ body: 'B', review: { mode: 'review' } });
  const run = args => runReview({ ...args, runner: async () => { calls++; throw new RelayError('REVIEW_PROCESS_UNCERTAIN'); } });
  const q = createReviewQueue({ root: b.root, address: 'claude-demo', run, onError: () => { errors++; } });
  await q.scan(); await q.idle(); await q.scan(); await q.idle();
  assert.equal(calls, 1); assert.equal(errors, 1);
  assert.match((await b.cx.inbox()).find(x => x.replyTo === first.id).body, /REVIEW_PROCESS_UNCERTAIN/);
  const restarted = createReviewQueue({ root: b.root, address: 'claude-demo', run });
  await restarted.scan(); await restarted.idle(); assert.equal(calls, 1);
  assert.ok(await fs.stat(path.join(b.root, 'reviews', 'claude-demo', 'execution.json')));
});
