import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sandbox, loadCore, paired } from './fixture.mjs';

test('bound sender saves verbatim Unicode text for its configured peer', async t => {
  const { cx, cl } = await paired(t);
  const body = '얼굴 계획\r\nSecond line "quoted" 😀\n';
  const msg = await cx.send({ body, from: 'owner' });
  assert.equal(msg.from, 'codex-demo');
  assert.equal(msg.to, 'claude-demo');
  assert.equal(msg.body, body);
  assert.equal(msg.type, 'question');
  assert.equal(msg.replyTo, null);
  assert.match(msg.id, /^[a-f0-9]{32}$/);
  assert.deepEqual(await cl.inbox(), [msg]);
  assert.deepEqual(await cx.inbox(), []);
});

test('two explicit data roots never mix messages', async t => {
  const a = await paired(t), b = await paired(t);
  await a.cx.send({ body: 'only A' });
  assert.equal((await a.cl.inbox()).length, 1);
  assert.deepEqual(await b.cl.inbox(), []);
});

test('core refuses absent or relative roots without using ambient defaults', async () => {
  const core = await loadCore();
  for (const root of [undefined, '', './mail']) {
    assert.throws(() => core.createClient({ root, address: 'codex-demo' }), { code: 'INVALID_ROOT' });
  }
});

test('uninitialized root is reported rather than silently registered', async t => {
  const { root } = await sandbox(t), core = await loadCore();
  await assert.rejects(core.createClient({ root, address: 'codex-demo' }).send({ body: 'test' }), { code: 'NOT_INITIALIZED' });
});

test('unknown sender cannot write under a registered pair', async t => {
  const { root, core, cl } = await paired(t);
  await assert.rejects(core.createClient({ root, address: 'codex-other' }).send({ body: 'test' }), { code: 'UNKNOWN_ADDRESS' });
  assert.deepEqual(await cl.inbox(), []);
});

test('a registered address cannot send to a non-peer', async t => {
  const { root, core, cx } = await paired(t);
  await core.registerPair({ root, codexAddress: 'codex-second', claudeAddress: 'claude-second' });
  await assert.rejects(cx.send({ to: 'claude-second', body: 'wrong destination' }), { code: 'NOT_PEER' });
  assert.deepEqual(await core.createClient({ root, address: 'claude-second' }).inbox(), []);
});

test('registration rejects traversal and Windows device addresses', async t => {
  const { root } = await sandbox(t), core = await loadCore();
  for (const address of ['../outside', 'codex/a', 'con', 'nul', 'com1', 'lpt9', 'UPPER', '__proto__', 'constructor', 'has space']) {
    await assert.rejects(core.registerPair({ root, codexAddress: address, claudeAddress: 'claude-demo' }), { code: 'INVALID_ADDRESS' });
  }
});

test('duplicate registration does not replace another pair', async t => {
  const { root, core, cx, cl } = await paired(t);
  await assert.rejects(core.registerPair({ root, codexAddress: 'codex-demo', claudeAddress: 'claude-other' }), { code: 'ADDRESS_EXISTS' });
  await cx.send({ body: 'original peer' });
  assert.equal((await cl.inbox())[0].to, 'claude-demo');
});

test('invalid body, type, ID and wake metadata are rejected before save', async t => {
  const { cx, cl } = await paired(t);
  const bad = [
    { body: '   ', want: 'INVALID_BODY' },
    { body: 42, want: 'INVALID_BODY' },
    { body: 'a'.repeat(1048577), want: 'INVALID_BODY' },
    { body: 'ok', type: 'owner', want: 'INVALID_TYPE' },
    { body: 'ok', id: '../../x', want: 'INVALID_ID' },
    { body: 'ok', wake: 'true', want: 'INVALID_MESSAGE' },
    { body: 'ok', task: '', want: 'INVALID_MESSAGE' },
  ];
  for (const { want, ...input } of bad) await assert.rejects(cx.send(input), { code: want });
  assert.deepEqual(await cl.inbox(), []);
});

test('body size is measured in UTF-8 bytes, not characters', async t => {
  const { cx, cl } = await paired(t);
  await assert.rejects(cx.send({ body: '가'.repeat(349526) }), { code: 'INVALID_BODY' });
  const body = '가'.repeat(349525);
  const msg = await cx.send({ body });
  assert.equal((await cl.inbox())[0].body, body);
  assert.equal(msg.body, body);
});

test('explicit stable send ID returns the same saved message on retry', async t => {
  const { cx, cl } = await paired(t);
  const input = { id: '1'.repeat(32), body: 'stable request' };
  const first = await cx.send(input), again = await cx.send(input);
  assert.deepEqual(again, first);
  assert.equal((await cl.inbox()).length, 1);
});

test('changed content with the same ID cannot overwrite saved body', async t => {
  const { cx, cl } = await paired(t), id = '2'.repeat(32);
  await cx.send({ id, body: 'first' });
  await assert.rejects(cx.send({ id, body: 'different' }), { code: 'ID_CONFLICT' });
  assert.equal((await cl.inbox())[0].body, 'first');
});

test('root writer lock fails fast and is never removed by another writer', async t => {
  const { root, cx, cl } = await paired(t), lock = path.join(root, '.writer.lock');
  await fs.writeFile(lock, 'other owner');
  await assert.rejects(cx.send({ body: 'must not save' }), { code: 'WRITER_BUSY' });
  assert.equal(await fs.readFile(lock, 'utf8'), 'other owner');
  assert.deepEqual(await cl.inbox(), []);
});

test('concurrent real writers publish at most one of the contested messages', async t => {
  const { cx, cl } = await paired(t);
  const outcomes = await Promise.allSettled([cx.send({ body: 'one' }), cx.send({ body: 'two' })]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(r => r.status === 'rejected').reason.code, 'WRITER_BUSY');
  assert.equal((await cl.inbox()).length, 1);
});

test('internal directory junction cannot route messages outside the root', async t => {
  const { root, container } = await sandbox(t), core = await loadCore();
  const outside = path.join(container, 'other-owned-directory');
  await fs.mkdir(root); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(root, 'inbox'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(core.registerPair({ root, codexAddress: 'codex-demo', claudeAddress: 'claude-demo' }), { code: 'UNSAFE_PATH' });
  assert.deepEqual(await fs.readdir(outside), []);
});

test('corrupt configuration is reported without silently replacing it', async t => {
  const { root, cx } = await paired(t), file = path.join(root, 'config.json');
  await fs.writeFile(file, '{broken');
  await assert.rejects(cx.send({ body: 'no repair' }), { code: 'CORRUPT_CONFIG' });
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});

test('JSON null configuration cannot silently replace existing registrations', async t => {
  const { root, core } = await paired(t), file = path.join(root, 'config.json');
  await fs.writeFile(file, 'null');
  await assert.rejects(core.registerPair({ root, codexAddress: 'codex-second', claudeAddress: 'claude-second' }), { code: 'CORRUPT_CONFIG' });
  assert.equal(await fs.readFile(file, 'utf8'), 'null');
});

test('JSON null inbox record is reported and cannot be overwritten by a stable-ID retry', async t => {
  const { root, cx, cl } = await paired(t), original = await cx.send({ body: 'preserve corrupt record' });
  const file = path.join(root, 'inbox', 'claude-demo', original.id + '.json');
  await fs.writeFile(file, 'null');
  await assert.rejects(cl.inbox(), { code: 'CORRUPT_MESSAGE' });
  await assert.rejects(cx.send({ id: original.id, body: original.body }), { code: 'CORRUPT_MESSAGE' });
  assert.equal(await fs.readFile(file, 'utf8'), 'null');
});
