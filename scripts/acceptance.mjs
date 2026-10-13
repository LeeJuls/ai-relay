import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient, registerPair } from '../lib/core.mjs';
import { startReceiver } from '../lib/service.mjs';
import { deliveryStatus, requestStop } from '../lib/receiver.mjs';
import { absoluteRoot, ownedPath, atomicJson,retryWriterBusy } from '../lib/storage.mjs';
import { RelayError } from '../lib/errors.mjs';

async function until(condition) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new RelayError('TEST_TIMEOUT');
}
async function socketServer(endpoint, onConnection) {
  const sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); onConnection(socket); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve); });
  return { close: () => { for (const socket of sockets) socket.destroy(); return new Promise(resolve => server.close(resolve)); } };
}

// This intentionally never connects to the user's apps. It proves fixture transport/installation only.
export async function runAcceptance({ root }) {
  root = absoluteRoot(root); await ownedPath(root, []);
  try { await fs.lstat(root); throw new RelayError('TEST_DIRECTORY_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await registerPair({ root, codexAddress: 'codex-test', claudeAddress: 'claude-test' });
  const name = randomUUID();
  const cxPipe = process.platform === 'win32' ? `\\\\.\\pipe\\relay-cx-${name}` : path.join(root, 'cx.sock');
  const clPipe = process.platform === 'win32' ? `\\\\.\\pipe\\relay-cl-${name}` : path.join(root, 'cl.sock');
  const observed = { codex: [], claude: [] }, servers = [], addresses = [];
  let result, failure;
  try {
    servers.push(await socketServer(cxPipe, socket => {
      let data = Buffer.alloc(0), answered = false;
      socket.on('data', chunk => {
        data = Buffer.concat([data, chunk]);
        if (answered || data.length < 4 || data.length < data.readUInt32LE(0) + 4) return;
        answered = true;
        try {
          const call = JSON.parse(data.subarray(4, data.readUInt32LE(0) + 4));
          observed.codex.push(call.params.arguments.prompt);
          const bytes = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: call.id, result: { success: true } })), header = Buffer.alloc(4); header.writeUInt32LE(bytes.length);
          socket.end(Buffer.concat([header, bytes]));
        } catch { socket.destroy(); }
      });
    }));
    servers.push(await socketServer(clPipe, socket => {
      let data = '';
      socket.on('data', chunk => data += chunk);
      socket.on('end', () => {
        try { const lines = data.trim().split('\n').map(JSON.parse); if (lines[0].token !== 'local-fixture-token') throw Error(); observed.claude.push(lines[1].message.content); socket.end(); }
        catch { socket.destroy(); }
      });
    }));
    // Override every relevant app credential. Existing real session env is never used by these workers.
    const env = { ...process.env, CODEX_THREAD_ID: '11111111-1111-4111-8111-111111111111', CODEX_APP_TOOLS_PIPE_PATH: cxPipe,
      CLAUDE_CODE_MESSAGING_SOCKET: clPipe, CLAUDE_CODE_MESSAGING_TOKEN: 'local-fixture-token' };
    for (const address of ['codex-test', 'claude-test']) { await startReceiver({ root, address, batchMs: 0, env }); addresses.push(address); }
    const cx = createClient({ root, address: 'codex-test' }), cl = createClient({ root, address: 'claude-test' });
    const question = await retryWriterBusy(()=>cx.send({ body: 'Isolated preview question / 한글', wake: true }));
    await until(async () => (await deliveryStatus({ root, address: 'claude-test' })).accepted === 1);
    const answer = await retryWriterBusy(()=>cl.reply({ id: question.id, body: 'Isolated preview answer / 답장' }));
    await until(async () => (await deliveryStatus({ root, address: 'codex-test' })).accepted === 1);
    if (observed.claude.length !== 1 || observed.codex.length !== 1 || !observed.claude[0].includes(question.id) || !observed.codex[0].includes(answer.id)) throw new RelayError('TEST_FAILED');
    await retryWriterBusy(()=>cx.done(answer.id));
    result = { schemaVersion: 1, mode: 'mock-native-pipes', actualAppDeliveryVerified: false, modelTurnsStarted: 0,
      twoWay: true, questionId: question.id, answerId: answer.id, answerReplyTo: answer.replyTo,
      observedPosts: { codex: observed.codex.length, claude: observed.claude.length }, helpersStopped: false };
  } catch (error) { failure = error; }
  finally {
    try {
      for (const address of addresses) await requestStop({ root, address });
      for (const address of addresses) await until(async () => !(await deliveryStatus({ root, address })).processAlive);
      if (result) result.helpersStopped = true;
    } catch (error) { failure = failure ?? error; }
    for (const server of servers) await server.close();
  }
  if (failure) throw failure;
  await atomicJson(await ownedPath(root, ['acceptance-report.json']), result);
  return result;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await runAcceptance({ root: process.argv[2] }))); }
  catch (error) { console.error(JSON.stringify({ code: error.code ?? 'TEST_FAILED' })); process.exitCode = 2; }
}
