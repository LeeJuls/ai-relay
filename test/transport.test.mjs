import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const thread = '11111111-1111-4111-8111-111111111111';
async function adapter() { return import('../lib/transport.mjs'); }
async function server(t, handle) {
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\relay-test-${randomUUID()}` : path.join(os.tmpdir(), `relay-${randomUUID()}.sock`);
  const sockets = new Set();
  const s = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); handle(socket); });
  await new Promise((resolve, reject) => { s.once('error', reject); s.listen(endpoint, resolve); });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => s.close(resolve)); });
  return endpoint;
}
function framed(value) { const data = Buffer.from(JSON.stringify(value)); const head = Buffer.alloc(4); head.writeUInt32LE(data.length); return Buffer.concat([head, data]); }

test('Codex adapter uses the own-thread framed call and accepts only an explicit success', async t => {
  let received;
  const endpoint = await server(t, socket => {
    let bytes = Buffer.alloc(0);
    socket.on('data', chunk => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length < 4 || bytes.length < bytes.readUInt32LE(0) + 4) return;
      received = JSON.parse(bytes.subarray(4).toString());
      const response = framed({ id: received.id, jsonrpc: '2.0', result: { success: true } });
      socket.write(response.subarray(0, 2)); socket.end(response.subarray(2));
    });
  });
  const { createAdapter } = await adapter();
  const a = createAdapter({ provider: 'codex', env: { CODEX_THREAD_ID: thread, CODEX_APP_TOOLS_PIPE_PATH: endpoint } });
  assert.deepEqual(await a.post('peer text'), { state: 'accepted', code: 'APP_ACCEPTED' });
  assert.equal(received.params.arguments.threadId, thread);
  assert.equal(received.params.arguments.prompt, 'peer text');
  assert.equal(received.params.callerSource, 'codex');
  assert.equal(JSON.stringify(a.identity).includes(endpoint), false);
});

test('Claude own-session auth is sent before the body and never exposed by identity', async t => {
  let received = '';
  const endpoint = await server(t, socket => socket.on('data', chunk => { received += chunk; }).on('end', () => socket.end()));
  const { createAdapter } = await adapter();
  const a = createAdapter({ provider: 'claude', env: { CLAUDE_CODE_MESSAGING_SOCKET: endpoint, CLAUDE_CODE_MESSAGING_TOKEN: 'secret-fixture' } });
  assert.deepEqual(await a.post('peer text'), { state: 'accepted', code: 'SOCKET_WRITE_ACCEPTED' });
  const lines = received.trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines[0], { type: 'auth', token: 'secret-fixture' });
  assert.equal(lines[1].message.content, 'peer text');
  assert.equal(JSON.stringify(a.identity).includes('secret-fixture'), false);
  assert.equal(JSON.stringify(a.identity).includes(endpoint), false);
});

test('connect failure before any write is proven not_sent', async () => {
  const { createAdapter } = await adapter();
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\missing-${randomUUID()}` : path.join(os.tmpdir(), `missing-${randomUUID()}`);
  const a = createAdapter({ provider: 'codex', env: { CODEX_THREAD_ID: thread, CODEX_APP_TOOLS_PIPE_PATH: endpoint } });
  assert.deepEqual(await a.post('text'), { state: 'not_sent', code: 'ENDPOINT_UNAVAILABLE' });
});

test('timeout after a complete write is uncertain and must not be retried automatically', async t => {
  const endpoint = await server(t, socket => socket.on('data', () => {}));
  const { createAdapter } = await adapter();
  const a = createAdapter({ provider: 'codex', timeoutMs: 40, env: { CODEX_THREAD_ID: thread, CODEX_APP_TOOLS_PIPE_PATH: endpoint } });
  assert.deepEqual(await a.post('text'), { state: 'uncertain', code: 'TRANSPORT_TIMEOUT' });
});

test('app rejection and invalid/oversized replies after write are conservative holds', async t => {
  const { createAdapter } = await adapter();
  for (const kind of ['rejected', 'bad']) {
    const endpoint = await server(t, socket => socket.once('data', data => {
      const req = JSON.parse(data.subarray(4).toString());
      if (kind === 'rejected') socket.end(framed({ id: req.id, error: { message: 'secret error' } }));
      else { const h = Buffer.alloc(4); h.writeUInt32LE(999999999); socket.end(h); }
    }));
    const a = createAdapter({ provider: 'codex', env: { CODEX_THREAD_ID: thread, CODEX_APP_TOOLS_PIPE_PATH: endpoint } });
    const result = await a.post('text');
    assert.equal(result.state, 'uncertain'); assert.equal(JSON.stringify(result).includes('secret'), false);
  }
});

test('missing registration and arbitrary TCP endpoints fail before transport', async () => {
  const { createAdapter } = await adapter();
  assert.throws(() => createAdapter({ provider: 'claude', env: {} }), { code: 'REGISTRATION_MISSING' });
  assert.throws(() => createAdapter({ provider: 'codex', env: { CODEX_THREAD_ID: thread, CODEX_APP_TOOLS_PIPE_PATH: 'tcp://example.com' } }), { code: 'REGISTRATION_INVALID' });
});
