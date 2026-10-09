import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { paired } from './fixture.mjs';

test('explicit dead-lock recovery preserves claims, refuses a live PID, and serializes against new registration', { timeout: 2000 }, async t => {
  const b = await paired(t), { recoverReceiverLock, openReceiver } = await import('../lib/receiver.mjs');
  const dir = path.join(b.root, 'runtime', 'claude-demo'); await fs.mkdir(dir, { recursive: true });
  const lock = path.join(dir, 'receiver.lock');
  await fs.writeFile(lock, JSON.stringify({ pid: process.pid, generation: 'live' }));
  await assert.rejects(recoverReceiverLock({ root: b.root, address: 'claude-demo' }), { code: 'RECEIVER_BUSY' });
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true });
  await new Promise(resolve => child.once('close', resolve));
  await fs.writeFile(lock, JSON.stringify({ pid: child.pid, generation: 'dead' }));
  const io = Object.create(fs);
  let release, entered;
  const enteredPromise = new Promise(resolve => entered = resolve), blocked = new Promise(resolve => release = resolve);
  io.unlink = async file => { if (file === lock) { entered(); await blocked; } return fs.unlink(file); };
  const recovery = recoverReceiverLock({ root: b.root, address: 'claude-demo', io });
  await enteredPromise;
  const adapter = { identity: { provider: 'claude' }, post: async () => ({ state: 'accepted' }) };
  let concurrent;
  try { await openReceiver({ root: b.root, address: 'claude-demo', adapter }); }
  catch (error) { concurrent = error.code; }
  release(); await recovery;
  assert.equal(concurrent, 'WRITER_BUSY');
  const r = await openReceiver({ root: b.root, address: 'claude-demo', adapter }); b.beforeCleanup(() => r.close());
  assert.ok(r.generation);
});

test('failed close during writer contention can be retried and never leaves an unreleaseable live lock', async t => {
  const b = await paired(t), { openReceiver } = await import('../lib/receiver.mjs');
  const adapter = { identity: { provider: 'claude' }, post: async () => ({ state: 'accepted' }) };
  const r = await openReceiver({ root: b.root, address: 'claude-demo', adapter }); b.beforeCleanup(() => r.close());
  const writer = path.join(b.root, '.writer.lock'); await fs.writeFile(writer, 'another writer');
  await assert.rejects(r.close(), { code: 'WRITER_BUSY' });
  await fs.unlink(writer); await r.close();
  await assert.rejects(fs.stat(path.join(b.root, 'runtime', 'claude-demo', 'receiver.lock')), { code: 'ENOENT' });
  const next = await openReceiver({ root: b.root, address: 'claude-demo', adapter }); b.beforeCleanup(() => next.close());
});
