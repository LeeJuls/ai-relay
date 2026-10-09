import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sandbox } from './fixture.mjs';

const script = fileURLToPath(new URL('../bin/relay.mjs', import.meta.url));
function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}
async function ok(args, cwd) {
  const out = await run(args, cwd);
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.stderr, '');
  return JSON.parse(out.stdout);
}

test('developer CLI performs a real pair/send/inbox/reply/done exchange', async t => {
  const { root, container } = await sandbox(t), body = path.join(container, '원문.txt');
  await fs.writeFile(body, 'CLI 질문\r\nsecond line\n');
  const pair = await ok(['pair', '--root', root, '--codex', 'codex-demo', '--claude', 'claude-demo'], container);
  assert.equal(pair.ok, true);
  const sent = await ok(['send', '--root', root, '--as', 'codex-demo', '--body-file', body, '--wake'], container);
  assert.equal(sent.state, 'saved');
  assert.equal(sent.message.body, 'CLI 질문\r\nsecond line\n');
  const inbox = await ok(['inbox', '--root', root, '--as', 'claude-demo'], container);
  assert.equal(inbox.messages[0].id, sent.message.id);
  await fs.writeFile(body, 'CLI 답장');
  const answer = await ok(['reply', '--root', root, '--as', 'claude-demo', '--id', sent.message.id, '--body-file', body], container);
  assert.equal(answer.message.replyTo, sent.message.id);
  assert.equal(answer.message.wake, true);
  const done = await ok(['done', '--root', root, '--as', 'codex-demo', '--id', answer.message.id], container);
  assert.equal(done.state, 'done');
  assert.deepEqual((await ok(['inbox', '--root', root, '--as', 'codex-demo'], container)).messages, []);
});

test('CLI requires an explicit data root and does not invent one', async t => {
  const { container } = await sandbox(t);
  const out = await run(['inbox', '--as', 'codex-demo'], container);
  assert.equal(out.code, 2);
  assert.equal(JSON.parse(out.stderr).error.code, 'INVALID_ROOT');
  assert.deepEqual(await fs.readdir(container), []);
});

test('CLI localizes human errors while retaining stable machine codes', async t => {
  const { container } = await sandbox(t);
  const en = await run(['inbox', '--as', 'codex-demo', '--lang', 'en'], container);
  const ko = await run(['inbox', '--as', 'codex-demo', '--lang', 'ko'], container);
  assert.equal(en.code, 2); assert.equal(ko.code, 2);
  const a = JSON.parse(en.stderr).error, b = JSON.parse(ko.stderr).error;
  assert.equal(a.code, b.code);
  assert.notEqual(a.message, b.message);
  assert.match(b.message, /[가-힣]/);
});

test('CLI rejects unknown flags instead of silently choosing a route', async t => {
  const { root, container } = await sandbox(t);
  const out = await run(['pair', '--root', root, '--codex', 'codex-demo', '--claude', 'claude-demo', '--model', 'surprise'], container);
  assert.equal(out.code, 2);
  assert.equal(JSON.parse(out.stderr).error.code, 'INVALID_ARGS');
  assert.deepEqual(await fs.readdir(container), []);
});

test('CLI detects missing flag values and duplicate options before touching data', async t => {
  const { container } = await sandbox(t);
  for (const args of [['inbox', '--root', '--as', 'codex-demo'], ['inbox', '--root', container, '--root', container]]) {
    const out = await run(args, container);
    assert.equal(out.code, 2);
    assert.equal(JSON.parse(out.stderr).error.code, 'INVALID_ARGS');
  }
  assert.deepEqual(await fs.readdir(container), []);
});

test('CLI missing body file returns a redacted I/O error without saving', async t => {
  const { root, container } = await sandbox(t);
  await ok(['pair', '--root', root, '--codex', 'codex-demo', '--claude', 'claude-demo'], container);
  const out = await run(['send', '--root', root, '--as', 'codex-demo', '--body-file', path.join(container, 'missing-secret-name.txt')], container);
  assert.equal(out.code, 2);
  assert.equal(JSON.parse(out.stderr).error.code, 'IO_ERROR');
  assert.ok(!out.stderr.includes('missing-secret-name'));
  assert.deepEqual((await ok(['inbox', '--root', root, '--as', 'claude-demo'], container)).messages, []);
});

test('CLI help is localized and does not initialize a mailbox', async t => {
  const { container } = await sandbox(t);
  const out = await run(['help', '--lang', 'ko'], container);
  assert.equal(out.code, 0);
  assert.match(out.stdout, /[가-힣]/);
  assert.deepEqual(await fs.readdir(container), []);
});
