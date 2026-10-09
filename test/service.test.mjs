import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { paired } from './fixture.mjs';

const cli = fileURLToPath(new URL('../bin/relay.mjs', import.meta.url));
function run(args, env = process.env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { env, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
async function until(condition) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (await condition()) return; await new Promise(r => setTimeout(r, 30)); }
  assert.fail('bounded condition did not occur');
}
test('CLI starts one isolated receiving process, delivers on file events, stops only that generation', async t => {
  const b = await paired(t); let posts = 0;
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\relay-child-${randomUUID()}` : path.join(b.container, 'child.sock');
  const sockets = new Set();
  const server = net.createServer(s => { sockets.add(s); s.on('close', () => sockets.delete(s)); s.on('data', () => posts++).on('end', () => s.end()); });
  await new Promise(resolve => server.listen(endpoint, resolve));
  b.beforeCleanup(async () => { for (const s of sockets) s.destroy(); await new Promise(r => server.close(r)); });
  let didStart = false;
  b.beforeCleanup(async () => {
    if (!didStart) return;
    await run(['stop', '--root', b.root, '--as', 'claude-demo']);
    await until(async () => !JSON.parse((await run(['status', '--root', b.root, '--as', 'claude-demo'])).stdout).processAlive);
  });
  const env = { ...process.env, CLAUDE_CODE_MESSAGING_SOCKET: endpoint, CLAUDE_CODE_MESSAGING_TOKEN: 'only-test-secret' };
  const args = ['start', '--root', b.root, '--as', 'claude-demo', '--batch-ms', '0'];
  const started = await run(args, env);
  assert.equal(started.code, 0, started.stderr); didStart = true; assert.equal(JSON.parse(started.stdout).state, 'started');
  const second = await run(args, env); assert.equal(second.code, 2); assert.equal(JSON.parse(second.stderr).error.code, 'RECEIVER_BUSY');
  await b.cx.send({ body: 'file event' }); await until(() => posts === 1);
  await until(async () => JSON.parse((await run(['status', '--root', b.root, '--as', 'claude-demo'])).stdout).accepted === 1);
  const stateFiles = await fs.readdir(path.join(b.root, 'runtime', 'claude-demo'));
  for (const file of stateFiles) {
    const text = await fs.readFile(path.join(b.root, 'runtime', 'claude-demo', file), 'utf8');
    assert.equal(text.includes('only-test-secret'), false); assert.equal(text.includes(endpoint), false);
  }
  const stopped = await run(['stop', '--root', b.root, '--as', 'claude-demo']); assert.equal(stopped.code, 0);
  await until(async () => !JSON.parse((await run(['status', '--root', b.root, '--as', 'claude-demo'])).stdout).processAlive);
});
test('CLI startup rejects missing own-session registration without leaving a helper', async t => {
  const b = await paired(t), env = { ...process.env };
  delete env.CLAUDE_CODE_MESSAGING_SOCKET; delete env.CLAUDE_CODE_MESSAGING_TOKEN;
  const out = await run(['start', '--root', b.root, '--as', 'claude-demo'], env);
  assert.equal(out.code, 2); assert.equal(JSON.parse(out.stderr).error.code, 'REGISTRATION_MISSING');
});
test('read-only doctor reports local registration requirements without posting to an app', async t => {
  const b = await paired(t);
  const out = await run(['doctor', '--root', b.root, '--as', 'claude-demo']);
  assert.equal(out.code, 0, out.stderr);
  const report = JSON.parse(out.stdout);
  assert.equal(report.modelTurnsStarted, 0); assert.equal(report.liveDeliveryVerified, false);
  assert.equal(report.provider, 'claude');
});
