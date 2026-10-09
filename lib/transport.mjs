import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RelayError } from './errors.mjs';

function endpoint(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) return false;
  return process.platform === 'win32' ? value.startsWith('\\\\.\\pipe\\') && value.length > 9 : path.isAbsolute(value);
}

// Credentials and endpoint stay in this closure; never serialize them or discover other processes.
export function createAdapter({ provider, env = process.env, timeoutMs = 10000 }) {
  if (!['codex', 'claude'].includes(provider) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new RelayError('INVALID_ARGS');
  const socketPath = provider === 'codex' ? env.CODEX_APP_TOOLS_PIPE_PATH : env.CLAUDE_CODE_MESSAGING_SOCKET;
  const credential = provider === 'codex' ? env.CODEX_THREAD_ID : env.CLAUDE_CODE_MESSAGING_TOKEN;
  if (!socketPath || !credential) throw new RelayError('REGISTRATION_MISSING');
  if (!endpoint(socketPath) || typeof credential !== 'string' || (provider === 'codex' && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(credential))) throw new RelayError('REGISTRATION_INVALID');
  const identity = Object.freeze({ provider, session: provider === 'codex' ? credential : 'own-session', experimental: provider === 'codex' });
  function call(text, probe = false) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 1048576) return Promise.resolve({ state: 'not_sent', code: 'POST_TOO_LARGE' });
    return new Promise(resolve => {
      let wrote = false, settled = false, bytes = Buffer.alloc(0), socket;
      const finish = (state, code) => {
        if (settled) return;
        settled = true; clearTimeout(timer); socket?.destroy(); resolve({ state, code });
      };
      const failure = code => finish(wrote ? 'uncertain' : 'not_sent', code);
      const timer = setTimeout(() => failure('TRANSPORT_TIMEOUT'), timeoutMs);
      const requestId = randomUUID();
      socket = net.createConnection(socketPath);
      socket.on('error', () => failure('ENDPOINT_UNAVAILABLE'));
      socket.on('connect', () => {
        if (provider === 'claude') {
          // No undocumented read-only Claude probe: simply having its own session env is not connectivity proof.
          const lines = JSON.stringify({ type: 'auth', token: credential }) + '\n' + JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';
          wrote = true; socket.end(lines);
        } else {
          const tool = probe ? 'list_artifacts' : 'send_message_to_thread';
          const args = probe ? {} : { threadId: credential, prompt: text };
          const body = Buffer.from(JSON.stringify({ id: requestId, jsonrpc: '2.0', method: 'tools/call', params: {
            callerSource: 'codex', namespace: 'codex_app', tool, arguments: args,
            threadId: credential, callId: requestId, turnId: requestId,
          } }));
          const head = Buffer.alloc(4); head.writeUInt32LE(body.length);
          wrote = true; socket.write(Buffer.concat([head, body]));
        }
      });
      socket.on('data', chunk => {
        if (provider === 'claude') return; // Never log or expose server bytes, which may contain credentials.
        if (bytes.length + chunk.length > 8 * 1048576 + 4) return failure('INVALID_APP_REPLY');
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length < 4) return;
        const length = bytes.readUInt32LE(0);
        if (length > 8 * 1048576) return failure('INVALID_APP_REPLY');
        if (bytes.length < length + 4) return;
        try {
          const reply = JSON.parse(bytes.subarray(4, length + 4));
          if (reply.id !== requestId || reply.error || reply.result?.success !== true) return failure('APP_REJECTED');
          finish('accepted', 'APP_ACCEPTED');
        } catch { failure('INVALID_APP_REPLY'); }
      });
      socket.on('end', () => { if (provider === 'codex') failure('APP_CLOSED'); });
      socket.on('close', hadError => {
        if (provider === 'claude' && !hadError && wrote) finish('accepted', 'SOCKET_WRITE_ACCEPTED');
        else failure('APP_CLOSED');
      });
    });
  }
  return Object.freeze({ identity, post: text => call(text), probe: async () => provider === 'codex' ? call('', true) : { state: 'registration_only', code: 'LIVE_ROUNDTRIP_REQUIRED' } });
}
