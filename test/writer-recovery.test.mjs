import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { paired } from './fixture.mjs';

async function deadPid() {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true });
  await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  return child.pid;
}

test('public recovery releases a killed global writer without changing retained mail', { timeout: 5000 }, async t => {
  const b = await paired(t);
  const saved = await b.cx.send({ body: 'preserve this message' });
  const mailPath = path.join(b.root, 'inbox', 'claude-demo', saved.id + '.json');
  const original = await fs.readFile(mailPath);
  const storage = new URL('../lib/storage.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import { withWriter } from ${JSON.stringify(storage)}; await withWriter(process.argv[1], async () => { process.stdout.write('locked\\n'); await new Promise(() => { setInterval(() => {}, 1000); }); });`, b.root],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('close', resolve));
  b.beforeCleanup(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; });
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve); child.once('error', reject);
  });
  child.kill(); await exited;
  const { recoverReceiverLock } = await import('../lib/receiver.mjs');
  const recovered = await recoverReceiverLock({ root: b.root, address: 'claude-demo' });
  assert.equal(recovered.writerRecovered, true);
  await b.cx.send({ body: 'new send after recovery' });
  assert.deepEqual(await fs.readFile(mailPath), original);
  await assert.rejects(fs.stat(path.join(b.root, '.writer.lock')), { code: 'ENOENT' });
});

test('recovery preserves live, malformed and uncertain writer ownership', async t => {
  const b = await paired(t), { recoverWriterLock } = await import('../lib/storage.mjs');
  const file = path.join(b.root, '.writer.lock'), gate = path.join(b.root, '.writer-recovery.lock');
  const examples = [
    [JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'WRITER_BUSY'],
    ['null', 'CORRUPT_WRITER'], ['{', 'CORRUPT_WRITER'], ['{}', 'CORRUPT_WRITER'],
    [JSON.stringify({ pid: 0, startedAt: new Date().toISOString() }), 'CORRUPT_WRITER'],
    [JSON.stringify({ pid: -1, startedAt: new Date().toISOString() }), 'CORRUPT_WRITER'],
    [JSON.stringify({ pid: 2147483648, startedAt: new Date().toISOString() }), 'CORRUPT_WRITER'],
    [JSON.stringify({ pid: process.pid, startedAt: 'yesterday' }), 'CORRUPT_WRITER'],
  ];
  for (const [bytes, code] of examples) {
    await fs.writeFile(file, bytes);
    await assert.rejects(recoverWriterLock({ root: b.root }), { code });
    assert.equal(await fs.readFile(file, 'utf8'), bytes);
    await assert.rejects(fs.stat(gate), { code: 'ENOENT' });
  }
  await fs.unlink(file);
});

test('a retained recovery gate blocks writers and recovery without deleting either lock', async t => {
  const b = await paired(t), { recoverWriterLock, withWriter } = await import('../lib/storage.mjs');
  const file = path.join(b.root, '.writer.lock'), gate = path.join(b.root, '.writer-recovery.lock');
  const original = JSON.stringify({ pid: await deadPid(), startedAt: new Date().toISOString() });
  await fs.writeFile(file, original); await fs.writeFile(gate, 'retained uncertain recovery');
  await assert.rejects(recoverWriterLock({ root: b.root }), { code: 'WRITER_BUSY' });
  await assert.rejects(withWriter(b.root, () => assert.fail('must not write')), { code: 'WRITER_BUSY' });
  assert.equal(await fs.readFile(file, 'utf8'), original);
  assert.equal(await fs.readFile(gate, 'utf8'), 'retained uncertain recovery');
});

test('a writer paused before acquisition cannot run through concurrent recovery', { timeout: 5000 }, async t => {
  const b = await paired(t), { recoverWriterLock, withWriter } = await import('../lib/storage.mjs');
  const file = path.join(b.root, '.writer.lock');
  await fs.writeFile(file, JSON.stringify({ pid: await deadPid(), startedAt: new Date().toISOString() }));
  let writerEntered, writerRelease, recoveryEntered, recoveryRelease;
  const beforeOpen = new Promise(resolve => { writerEntered = resolve; });
  const resumeOpen = new Promise(resolve => { writerRelease = resolve; });
  const afterUnlink = new Promise(resolve => { recoveryEntered = resolve; });
  const resumeRecovery = new Promise(resolve => { recoveryRelease = resolve; });
  const writerIo = Object.create(fs), recoveryIo = Object.create(fs);
  writerIo.open = async (...args) => {
    if (args[0] === file) { writerEntered(); await resumeOpen; }
    return fs.open(...args);
  };
  recoveryIo.unlink = async (...args) => {
    const result = await fs.unlink(...args);
    if (args[0] === file) { recoveryEntered(); await resumeRecovery; }
    return result;
  };
  let actions = 0;
  const writerResult = withWriter(b.root, () => { actions++; }, writerIo).then(() => 'ran', error => error.code);
  await beforeOpen;
  const recovery = recoverWriterLock({ root: b.root, io: recoveryIo });
  await afterUnlink;
  try {
    await assert.rejects(recoverWriterLock({ root: b.root }), { code: 'WRITER_BUSY' });
    writerRelease();
    assert.equal(await writerResult, 'WRITER_BUSY'); assert.equal(actions, 0);
    await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  } finally { writerRelease(); recoveryRelease(); }
  assert.equal((await recovery).state, 'writer_lock_recovered');
  await b.cx.send({ body: 'writes resume after gate cleanup' });
});

test('recovery rechecks ownership immediately before deletion', async t => {
  const b = await paired(t), { recoverWriterLock } = await import('../lib/storage.mjs');
  const file = path.join(b.root, '.writer.lock');
  await fs.writeFile(file, JSON.stringify({ pid: await deadPid(), startedAt: new Date().toISOString() }));
  const replacement = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
  const io = Object.create(fs); let reads = 0;
  io.readFile = async (...args) => {
    if (args[0] === file && ++reads === 3) await fs.writeFile(file, replacement);
    return fs.readFile(...args);
  };
  await assert.rejects(recoverWriterLock({ root: b.root, io }), { code: 'CORRUPT_WRITER' });
  assert.equal(await fs.readFile(file, 'utf8'), replacement);
});
