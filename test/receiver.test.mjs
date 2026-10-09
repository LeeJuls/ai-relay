import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { paired } from './fixture.mjs';

async function receiver() { return import('../lib/receiver.mjs'); }
const mock = post => ({ identity: { provider: 'claude', session: 'own-session' }, post });
async function open(t, box, adapter, options = {}) {
  const { openReceiver } = await receiver();
  const r = await openReceiver({ root: box.root, address: 'claude-demo', adapter, ...options });
  box.beforeCleanup(() => r.close()); return r;
}
test('durable claim precedes the post; accepted receipt survives re-registration without resend', async t => {
  const b = await paired(t); const sent = await b.cx.send({ body: '질문' }); let posts = 0;
  const r = await open(t, b, mock(async body => {
    posts++;
    const claim = JSON.parse(await fs.readFile(path.join(b.root, 'delivery', 'claude-demo', sent.id + '.json')));
    assert.equal(claim.state, 'claimed'); assert.match(body, /not-owner/); assert.match(body, /질문/);
    return { state: 'accepted', code: 'APP_ACCEPTED' };
  }));
  await r.tick(); assert.equal(posts, 1); await r.close();
  const next = await open(t, b, mock(async () => { posts++; return { state: 'accepted' }; }));
  await next.tick(); assert.equal(posts, 1);
  assert.equal((await next.status()).accepted, 1);
});
test('uncertain and leftover claims are held on restart, not resent', async t => {
  const b = await paired(t); const first = await b.cx.send({ body: 'one' }); let posts = 0;
  const r = await open(t, b, mock(async () => { posts++; return { state: 'uncertain', code: 'TRANSPORT_TIMEOUT' }; }));
  await r.tick(); await r.close();
  const second = await b.cx.send({ body: 'two' });
  await fs.writeFile(path.join(b.root, 'delivery', 'claude-demo', second.id + '.json'), JSON.stringify({ schemaVersion: 1, id: second.id, state: 'claimed', attempts: 1, updatedAt: new Date().toISOString() }));
  const next = await open(t, b, mock(async () => { posts++; }));
  await next.tick(); assert.equal(posts, 1); assert.equal((await next.status()).held, 2);
  assert.equal(first.to, 'claude-demo');
});
test('claim-save failure sends nothing', async t => {
  const b = await paired(t); await b.cx.send({ body: 'one' }); let posts = 0;
  const io = Object.create(fs);
  io.rename = async (source, target) => { if (target.includes(path.sep + 'delivery' + path.sep)) throw Object.assign(Error(), { code: 'EACCES' }); return fs.rename(source, target); };
  const r = await open(t, b, mock(async () => { posts++; }), { io });
  await assert.rejects(r.tick()); assert.equal(posts, 0);
});
test('only proven not_sent retries and stops after a bounded number', async t => {
  const b = await paired(t); await b.cx.send({ body: 'one' }); let posts = 0, now = 100000;
  const r = await open(t, b, mock(async () => { posts++; return { state: 'not_sent', code: 'ENDPOINT_UNAVAILABLE' }; }), { now: () => now, retryMs: 100 });
  await r.tick(); await r.tick(); assert.equal(posts, 1);
  now += 101; await r.tick(); now += 101; await r.tick(); now += 101; await r.tick();
  assert.equal(posts, 3); assert.equal((await r.status()).held, 1);
});
test('normal messages batch until the deadline; question flushes the batch immediately', async t => {
  const b = await paired(t); let now = 100000, groups = [];
  const r = await open(t, b, mock(async body => { groups.push(body); return { state: 'accepted', code: 'APP_ACCEPTED' }; }), { now: () => now, batchMs: 100 });
  await b.cx.send({ body: 'normal one', type: 'fyi' }); await r.tick();
  now += 50; await b.cx.send({ body: 'normal two', type: 'result' }); await r.tick(); assert.equal(groups.length, 0);
  await b.cx.send({ body: 'urgent question' }); await r.tick();
  assert.equal(groups.length, 1); assert.match(groups[0], /normal one/); assert.match(groups[0], /normal two/); assert.match(groups[0], /urgent question/);
});
test('ordinary answer deadline flushes without a new mail event', async t => {
  const b = await paired(t); let now = 100000, posts = 0;
  const r = await open(t, b, mock(async () => { posts++; return { state: 'accepted' }; }), { now: () => now, batchMs: 100 });
  await b.cx.send({ body: 'answer', type: 'answer' }); await r.tick(); now += 101; await r.tick(); assert.equal(posts, 1);
});
test('a second receiver cannot claim the same address; provider mismatch is rejected', async t => {
  const b = await paired(t), { openReceiver } = await receiver();
  const r = await open(t, b, mock(async () => ({ state: 'accepted' })));
  await assert.rejects(openReceiver({ root: b.root, address: 'claude-demo', adapter: mock(async () => {}) }), { code: 'RECEIVER_BUSY' });
  await r.close();
  await assert.rejects(openReceiver({ root: b.root, address: 'claude-demo', adapter: { identity: { provider: 'codex' }, post() {} } }), { code: 'REGISTRATION_INVALID' });
});
test('oversized post and excessive new turns are held without waking the app', async t => {
  const b = await paired(t); let posts = 0;
  const r = await open(t, b, mock(async () => { posts++; return { state: 'accepted' }; }), { maxPostBytes: 400, maxPostsPerMinute: 1 });
  await b.cx.send({ body: 'x'.repeat(500) }); await r.tick(); assert.equal(posts, 0);
  await b.cx.send({ body: 'short' }); await r.tick(); assert.equal(posts, 1);
  await b.cx.send({ body: 'another short' }); await r.tick(); assert.equal(posts, 1); assert.equal((await r.status()).held, 2);
});
test('corrupt receipt is never treated as missing or overwritten', async t => {
  const b = await paired(t); const sent = await b.cx.send({ body: 'one' }); let posts = 0;
  const r = await open(t, b, mock(async () => { posts++; }));
  const file = path.join(b.root, 'delivery', 'claude-demo', sent.id + '.json'); await fs.writeFile(file, 'null');
  await assert.rejects(r.tick(), { code: 'CORRUPT_RECEIPT' }); assert.equal(posts, 0); assert.equal(await fs.readFile(file, 'utf8'), 'null');
});
test('falsy JSON receipt values cannot resurrect delivered mail', async t => {
  const b = await paired(t); const sent = await b.cx.send({ body: 'one' }); let posts = 0;
  const r = await open(t, b, mock(async () => { posts++; return { state: 'accepted' }; }));
  const file = path.join(b.root, 'delivery', 'claude-demo', sent.id + '.json');
  for (const value of [false, 0, '']) {
    const bytes = JSON.stringify(value); await fs.writeFile(file, bytes);
    await assert.rejects(r.tick(), { code: 'CORRUPT_RECEIPT' });
    assert.equal(posts, 0); assert.equal(await fs.readFile(file, 'utf8'), bytes);
  }
});

for (const action of ['done', 'reply']) {
  test(`receiver excludes a concurrently ${action}-archived question from a mixed batch`, async t => {
    const b = await paired(t);
    const original = await b.cx.send({ body: 'already handled question' });
    const remaining = await b.cx.send({ body: 'still pending question' });
    const receiptFile = path.join(b.root, 'delivery', 'claude-demo', original.id + '.json');
    let entered, release, paused = false;
    const reached = new Promise(resolve => { entered = resolve; });
    const resume = new Promise(resolve => { release = resolve; });
    const io = Object.create(fs);
    io.readFile = async (...args) => {
      if (args[0] === receiptFile && !paused) { paused = true; entered(); await resume; }
      return fs.readFile(...args);
    };
    const bodies = [];
    const r = await open(t, b, mock(async body => {
      bodies.push(body);
      // Claiming must not hold the writer lock during the app's response.
      await b.cx.send({ body: 'sent while transport is active', type: 'fyi' });
      return { state: 'accepted' };
    }), { io });
    const tick = r.tick();
    await reached;
    try {
      if (action === 'done') await b.cl.done(original.id);
      else await b.cl.reply({ id: original.id, body: 'handled answer' });
    } finally { release(); }
    await tick;
    assert.equal(bodies.length, 1);
    assert.doesNotMatch(bodies[0], /already handled question/);
    assert.match(bodies[0], /still pending question/);
    await assert.rejects(fs.stat(receiptFile), { code: 'ENOENT' });
    const accepted = JSON.parse(await fs.readFile(path.join(b.root, 'delivery', 'claude-demo', remaining.id + '.json')));
    assert.equal(accepted.state, 'accepted');
  });
}

test('receiver does not wake the app when its whole snapshot was already completed', async t => {
  const b = await paired(t), sent = await b.cx.send({ body: 'handled before claim' });
  let entered, release;
  const reached = new Promise(resolve => { entered = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  const io = Object.create(fs);
  let paused = false, posts = 0;
  io.readFile = async (...args) => {
    if (args[0] === path.join(b.root, 'delivery', 'claude-demo', sent.id + '.json') && !paused) {
      paused = true; entered(); await resume;
    }
    return fs.readFile(...args);
  };
  const r = await open(t, b, mock(async () => { posts++; return { state: 'accepted' }; }), { io });
  const tick = r.tick(); await reached;
  try { await b.cl.done(sent.id); } finally { release(); }
  await tick;
  assert.equal(posts, 0);
});

test('claim contention waits for another tick without stopping or posting', async t => {
  const b = await paired(t); await b.cx.send({ body: 'wait for writer' });
  let posts = 0;
  const r = await open(t, b, mock(async () => { posts++; return { state: 'accepted' }; }));
  const writer = path.join(b.root, '.writer.lock');
  await fs.writeFile(writer, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  try { await r.tick(); assert.equal(posts, 0); }
  finally { await fs.unlink(writer); }
  await r.tick(); assert.equal(posts, 1);
});
