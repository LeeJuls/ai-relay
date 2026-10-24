import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { paired } from './fixture.mjs';
import { configureReview, runReview, reviewStatus, boundedPrevious } from '../lib/review.mjs';
import { RelayError } from '../lib/errors.mjs';
import { openReceiver, deliveryStatus } from '../lib/receiver.mjs';

const result = { conclusion: 'Agree', evidence: ['read the supplied snippet'], nextAction: 'Owner decides' };
async function configured(t) {
  const b = await paired(t);
  const evidence = path.join(b.container, 'evidence'); await fs.mkdir(evidence);
  const cfg = { cli: process.execPath, model: 'test-model', jobRoot: path.join(b.container, 'jobs'), evidenceDirs: [evidence], deadlineMs: 180000 };
  await configureReview({ root: b.root, address: 'claude-demo', config: cfg });
  return { ...b, cfg };
}
test('ordinary messages retain the old format; reviews are explicit and opt-in', async t => {
  const b = await paired(t);
  const normal = await b.cx.send({ body: 'claude-demo/review is only text' });
  assert.equal(Object.hasOwn(normal, 'review'), false);
  await assert.rejects(b.cx.send({ body: 'review', review: { mode: 'review' } }), { code: 'REVIEW_DISABLED' });
});
test('one execution saves its result and exact reply, including after archive and restart', async t => {
  const b = await configured(t); let calls = 0;
  const m = await b.cx.send({ body: 'Review only this fact', task: 'R1', review: { mode: 'review' } });
  const runner = async () => { calls++; return { result, usage: { input_tokens: 5 } }; };
  const first = await runReview({ root: b.root, address: 'claude-demo', id: m.id, runner });
  assert.equal(first.state, 'replied');
  assert.equal((await b.cl.inbox()).length, 0);
  await runReview({ root: b.root, address: 'claude-demo', id: m.id, runner });
  assert.equal(calls, 1);
  const replies = await b.cx.inbox(); assert.equal(replies.length, 1);
  assert.equal(replies[0].replyTo, m.id); assert.equal(replies[0].type, 'result');
  assert.equal((await reviewStatus({ root: b.root, address: 'claude-demo' }))[0].state, 'replied');
});
test('failures produce one blocked reply without a retry on restart', async t => {
  const b = await configured(t); let calls = 0;
  const m = await b.cx.send({ body: 'Review', review: { mode: 'review' } });
  const runner = async () => { calls++; throw new RelayError('REVIEW_AUTH'); };
  await runReview({ root: b.root, address: 'claude-demo', id: m.id, runner });
  await runReview({ root: b.root, address: 'claude-demo', id: m.id, runner });
  assert.equal(calls, 1);
  assert.match((await b.cx.inbox())[0].body, /REVIEW_AUTH/);
});
test('followup only gets a bounded result from the same pair and task', async t => {
  const b = await configured(t);
  const m = await b.cx.send({ body: 'Review', task: 'one', review: { mode: 'review' } });
  await runReview({ root: b.root, address: 'claude-demo', id: m.id, runner: async () => ({ result }) });
  const f = await b.cx.send({ body: 'Check the fix', task: 'one', review: { mode: 'followup', previousId: m.id } });
  let prompt;
  await runReview({ root: b.root, address: 'claude-demo', id: f.id, runner: async r => { prompt = r.prompt; return { result }; } });
  assert.match(prompt, /Owner decides/);
  const bad = await b.cx.send({ body: 'Other task', task: 'two', review: { mode: 'followup', previousId: m.id } });
  let calls = 0;
  await runReview({ root: b.root, address: 'claude-demo', id: bad.id, runner: async () => { calls++; return { result }; } });
  assert.equal(calls, 0);
  assert.match((await b.cx.inbox()).find(x => x.replyTo === bad.id).body, /REVIEW_SCOPE/);
  const prev = boundedPrevious({ conclusion: '\u0001'.repeat(4000), evidence: Array(20).fill('x'.repeat(2000)), nextAction: 'y'.repeat(4000) });
  assert.ok(JSON.stringify(prev.result).length <= 6000); assert.equal(prev.truncated, true);
});
test('a concurrent claim or restart never reruns an incomplete execution', async t => {
  const b = await configured(t); let finish, calls = 0;
  const m = await b.cx.send({ body: 'Review', review: { mode: 'review' } });
  const running = runReview({ root: b.root, address: 'claude-demo', id: m.id, runner: () => { calls++; return new Promise(resolve => { finish = () => resolve({ result }); }); } });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await runReview({ root: b.root, address: 'claude-demo', id: m.id, runner: async () => { calls++; return { result }; } })).state, 'held');
  finish(); await running; assert.equal(calls, 1);
});
test('saved results finish publication without re-execution; uncertain publication is held', async t => {
  const b = await configured(t);
  const m = await b.cx.send({ body: 'Review', review: { mode: 'review' } });
  await runReview({ root: b.root, address: 'claude-demo', id: m.id, runner: async () => ({ result }) });
  const file = path.join(b.root, 'reviews', 'claude-demo', m.id + '.json');
  const record = JSON.parse(await fs.readFile(file));
  // Reconstruct a crash after result save and before the publication claim.
  await fs.rename(path.join(b.root, 'done', 'claude-demo', m.id + '.json'), path.join(b.root, 'inbox', 'claude-demo', m.id + '.json'));
  const answer = (await b.cx.inbox())[0]; await fs.unlink(path.join(b.root, 'inbox', 'codex-demo', answer.id + '.json'));
  await fs.writeFile(file, JSON.stringify({ ...record, state: 'result' }));
  await fs.writeFile(path.join(b.root,'reviews','claude-demo','execution.json'), JSON.stringify({schemaVersion:1,id:m.id,hash:record.hash,jobDir:record.jobDir,ownerPid:process.pid}));
  let calls = 0;
  await runReview({ root: b.root, address: 'claude-demo', id: m.id, runner: async () => { calls++; return { result }; } });
  assert.equal(calls, 0); assert.equal((await b.cx.inbox()).length, 1);
  await assert.rejects(fs.stat(path.join(b.root,'reviews','claude-demo','execution.json')), {code:'ENOENT'});
  await fs.unlink(path.join(b.root, 'inbox', 'codex-demo', answer.id + '.json'));
  await fs.writeFile(file, JSON.stringify({ ...record, state: 'publishing' }));
  assert.equal((await runReview({ root: b.root, address: 'claude-demo', id: m.id, runner: async () => { calls++; } })).state, 'held');
  assert.equal((await b.cx.inbox()).length, 0); assert.equal(calls, 0);
});
test('content tampering and evidence roots exposing relay data are refused', async t => {
  const b = await configured(t);
  await assert.rejects(configureReview({ root: b.root, address: 'claude-demo', config: { ...b.cfg, evidenceDirs: [b.container] } }), { code: 'REVIEW_CONFIG' });
  const m = await b.cx.send({ body: 'Review', review: { mode: 'review' } });
  await runReview({ root: b.root, address: 'claude-demo', id: m.id, runner: async () => ({ result }) });
  await fs.writeFile(path.join(b.root, 'done', 'claude-demo', m.id + '.json'), JSON.stringify({ ...m, body: 'changed' }));
  await assert.rejects(runReview({ root: b.root, address: 'claude-demo', id: m.id }), { code: 'REVIEW_SCOPE' });
});
test('ordinary delivery continues while a review is busy; disabled reviews never fall back', async t => {
  const b = await configured(t); let finish;
  const m = await b.cx.send({ body: 'Do not post this review', review: { mode: 'review' } });
  const running = runReview({ root: b.root, address: 'claude-demo', id: m.id, runner: () => new Promise(resolve => { finish = () => resolve({ result }); }) });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
  let posts = [];
  const receiver = await openReceiver({ root: b.root, address: 'claude-demo', batchMs: 0, adapter: { identity: { provider: 'claude' }, post: async body => { posts.push(body); return { state: 'accepted' }; } } });
  b.beforeCleanup(() => receiver.close());
  await b.cx.send({ body: 'Ordinary message' }); await receiver.tick();
  assert.equal(posts.length, 1); assert.match(posts[0], /Ordinary message/); assert.doesNotMatch(posts[0], /Do not post/);
  assert.equal((await deliveryStatus({ root: b.root, address: 'claude-demo' })).reviewPending, 1);
  finish(); await running;
  const next = await b.cx.send({ body: 'Review disabled later', review: { mode: 'review' } });
  await configureReview({ root: b.root, address: 'claude-demo', config: false }); await receiver.tick();
  assert.equal(posts.length, 1); assert.ok((await b.cl.inbox()).some(x => x.id === next.id));
});
