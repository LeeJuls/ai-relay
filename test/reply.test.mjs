import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { paired } from './fixture.mjs';

test('reply-to-reply cannot create an automatic conversation loop', async t => {
  const { cx, cl } = await paired(t);
  const original = await cx.send({ body: 'question' });
  const answer = await cl.reply({ id: original.id, body: 'answer' });
  await assert.rejects(cx.reply({ id: answer.id, body: 'thanks; please answer again' }), { code: 'REPLY_CHAIN_BLOCKED' });
  assert.equal((await cl.inbox()).length, 0);
});

test('reply reverses the configured route and retains the exact original ID', async t => {
  const { cx, cl } = await paired(t);
  const original = await cx.send({ body: 'plan?', task: 'design' });
  const answer = await cl.reply({ id: original.id, body: 'review', from: 'owner', to: 'third-party' });
  assert.equal(answer.from, 'claude-demo'); assert.equal(answer.to, 'codex-demo');
  assert.equal(answer.replyTo, original.id); assert.equal(answer.task, 'design');
  assert.equal(answer.type, 'answer');
  assert.deepEqual(await cl.inbox(), []);
  assert.deepEqual(await cx.inbox(), [answer]);
});

test('reply to an urgent question inherits wake', async t => {
  const { cx, cl } = await paired(t);
  const original = await cx.send({ body: 'blocked?', wake: true });
  assert.equal((await cl.reply({ id: original.id, body: 'unblocked' })).wake, true);
});

test('ordinary answers and replies to urgent FYI do not propagate urgency', async t => {
  const { cx, cl } = await paired(t);
  for (const input of [{ body: 'normal' }, { body: 'notice', type: 'fyi', wake: true }]) {
    const original = await cx.send(input);
    assert.equal((await cl.reply({ id: original.id, body: 'read' })).wake, false);
  }
});

test('repeating the same reply after original archival returns one saved answer', async t => {
  const { cx, cl } = await paired(t), original = await cx.send({ body: 'question' });
  const input = { id: original.id, body: 'same answer' };
  const first = await cl.reply(input), again = await cl.reply(input);
  assert.deepEqual(again, first);
  assert.equal((await cx.inbox()).length, 1);
});

test('changed reply retry cannot overwrite the existing answer', async t => {
  const { cx, cl } = await paired(t), original = await cx.send({ body: 'question' });
  await cl.reply({ id: original.id, body: 'first answer' });
  await assert.rejects(cl.reply({ id: original.id, body: 'changed answer' }), { code: 'REPLY_CONFLICT' });
  assert.equal((await cx.inbox())[0].body, 'first answer');
});

test('saved reply survives archive failure and a new client retries without another answer', async t => {
  const { root, core, cx, cl } = await paired(t);
  const original = await cx.send({ body: 'question' });
  const source = path.join(root, 'inbox', 'claude-demo', original.id + '.json');
  const faulty = core.createClient({ root, address: 'claude-demo', io: { ...fs, rename: async (a, b) => {
    if (a === source) throw Object.assign(new Error('archive device failure'), { code: 'EIO' });
    return fs.rename(a, b);
  } } });
  await assert.rejects(faulty.reply({ id: original.id, body: 'durable answer' }), { code: 'IO_ERROR' });
  const saved = (await cx.inbox())[0];
  assert.equal(saved.body, 'durable answer');
  assert.equal((await cl.inbox()).length, 1);
  const freshClient = core.createClient({ root, address: 'claude-demo' });
  const recovered = await freshClient.reply({ id: original.id, body: 'durable answer' });
  assert.equal(recovered.id, saved.id);
  assert.equal((await cx.inbox()).length, 1);
  assert.deepEqual(await cl.inbox(), []);
});

test('done is idempotent and never sends an acknowledgement', async t => {
  const { cx, cl } = await paired(t), original = await cx.send({ body: 'FYI', type: 'fyi' });
  assert.equal((await cl.done(original.id)).alreadyDone, false);
  assert.equal((await cl.done(original.id)).alreadyDone, true);
  assert.deepEqual(await cx.inbox(), []);
  assert.deepEqual(await cl.inbox(), []);
});

test('a manually completed original cannot acquire a new reply later', async t => {
  const { cx, cl } = await paired(t), original = await cx.send({ body: 'FYI', type: 'fyi' });
  await cl.done(original.id);
  await assert.rejects(cl.reply({ id: original.id, body: 'late answer' }), { code: 'MESSAGE_DONE' });
  assert.deepEqual(await cx.inbox(), []);
});

test('unknown IDs cannot read or archive another address messages', async t => {
  const { cx, cl } = await paired(t), original = await cx.send({ body: 'question' });
  await assert.rejects(cx.reply({ id: original.id, body: 'not my inbox' }), { code: 'MESSAGE_NOT_FOUND' });
  await assert.rejects(cl.done('f'.repeat(32)), { code: 'MESSAGE_NOT_FOUND' });
  assert.equal((await cl.inbox()).length, 1);
});

test('corrupt inbox message is reported and left intact', async t => {
  const { root, cx, cl } = await paired(t), original = await cx.send({ body: 'question' });
  const file = path.join(root, 'inbox', 'claude-demo', original.id + '.json');
  await fs.writeFile(file, JSON.stringify({ ...original, id: '0'.repeat(32) }));
  await assert.rejects(cl.inbox(), { code: 'CORRUPT_MESSAGE' });
  await assert.rejects(cl.reply({ id: original.id, body: 'must not save' }), { code: 'CORRUPT_MESSAGE' });
  assert.ok(await fs.readFile(file, 'utf8'));
  assert.deepEqual(await cx.inbox(), []);
});

test('inbox does not report corruption if a message is archived during its read', async t => {
  const { root, core, cx, cl } = await paired(t), original = await cx.send({ body: 'question' });
  const source = path.join(root, 'inbox', 'claude-demo', original.id + '.json');
  let entered, release;
  const reached = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const reader = core.createClient({ root, address: 'claude-demo', io: { ...fs, readFile: async (...args) => {
    const data = await fs.readFile(...args);
    if (args[0] === source) { entered(); await gate; }
    return data;
  } } });
  const reading = reader.inbox();
  await reached;
  try { await cl.done(original.id); } finally { release(); }
  assert.deepEqual(await reading, []);
});

test('JSON null archive record cannot resurrect a message on a stable-ID retry', async t => {
  const { root, cx, cl } = await paired(t), original = await cx.send({ body: 'completed' });
  await cl.done(original.id);
  const file = path.join(root, 'done', 'claude-demo', original.id + '.json');
  await fs.writeFile(file, 'null');
  await assert.rejects(cx.send({ id: original.id, body: original.body }), { code: 'CORRUPT_MESSAGE' });
  assert.equal(await fs.readFile(file, 'utf8'), 'null');
  assert.deepEqual(await fs.readdir(path.join(root, 'inbox', 'claude-demo')), []);
});
