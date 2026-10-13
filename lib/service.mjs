import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from './core.mjs';
import { createAdapter } from './transport.mjs';
import { openReceiver } from './receiver.mjs';
import { absoluteRoot, ownedPath, readJson, directory } from './storage.mjs';
import { address as validAddress } from './message.mjs';
import { RelayError } from './errors.mjs';

async function binding(root, address) {
  await createClient({ root, address }).inbox();
  return (await readJson(root, ['config.json'], { corrupt: 'CORRUPT_CONFIG' })).addresses[address];
}
export async function doctor({ root, address, env = process.env }) {
  root = absoluteRoot(root); validAddress(address);
  const cfg = await binding(root, address);
  let registration = 'available', errorCode = null;
  try { createAdapter({ provider: cfg.provider, env }); }
  catch (error) { registration = 'unavailable'; errorCode = error.code ?? 'REGISTRATION_INVALID'; }
  return { address, provider: cfg.provider, peer: cfg.peer, node: process.versions.node, platform: process.platform,
    registration, errorCode, experimental: cfg.provider === 'codex', liveDeliveryVerified: false, modelTurnsStarted: 0 };
}

export async function startReceiver({ root, address, batchMs = 120000, probeMs=30000,keepPending=false, env = process.env }) {
  root = absoluteRoot(root); validAddress(address);
  const cfg = await binding(root, address);
  if(cfg.sendOnly)throw new RelayError('SEND_ONLY');
  createAdapter({ provider: cfg.provider, env }); // Validate before creating logs or starting a child.
  if (!Number.isInteger(batchMs) || batchMs < 0 || batchMs > 120000) throw new RelayError('INVALID_ARGS');
  if(!Number.isInteger(probeMs)||probeMs<0||probeMs>3600000||typeof keepPending!=='boolean')throw new RelayError('INVALID_ARGS');
  const dir = await directory(root, ['runtime', address]);
  if (await readJson(root, ['runtime', address, 'receiver.lock'], { corrupt: 'CORRUPT_RECEIPT' })) throw new RelayError('RECEIVER_BUSY');
  const stdout = await fsp.open(await ownedPath(root, ['runtime', address, 'worker.stdout.log']), 'a', 0o600);
  const stderr = await fsp.open(await ownedPath(root, ['runtime', address, 'worker.stderr.log']), 'a', 0o600);
  let child;
  try {
    child = fork(fileURLToPath(new URL('../bin/receiver.mjs', import.meta.url)), [root, address, String(batchMs),String(probeMs),String(keepPending)], {
      execPath: process.execPath, env, cwd: dir, detached: true, windowsHide: true,
      stdio: ['ignore', stdout.fd, stderr.fd, 'ipc'],
    });
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, result) => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (error) { child.kill(); reject(error); } else { child.unref(); resolve(result); }
      };
      const timer = setTimeout(() => finish(new RelayError('START_TIMEOUT')), 8000);
      child.once('message', data => data?.state === 'started' ? finish(null, data) : finish(new RelayError(data?.code ?? 'INTERNAL_ERROR')));
      child.once('error', () => finish(new RelayError('IO_ERROR')));
      child.once('exit', () => finish(new RelayError('START_FAILED')));
    });
  } finally { await stdout.close(); await stderr.close(); }
}

export async function runReceiver({ root, address, batchMs,probeMs=30000,keepPending=false, env = process.env, ready = () => {} }) {
  if(!Number.isInteger(probeMs)||probeMs<0||probeMs>3600000)throw new RelayError('INVALID_ARGS');
  const cfg = await binding(root, address);
  const adapter = createAdapter({ provider: cfg.provider, env });
  const receiver = await openReceiver({ root, address, adapter, batchMs,keepPending });
  let closed = false, scanning = false, again = false, timer,probeTimer,probing=false, watcher, stopWatcher;
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  async function close(code = null) {
    if (closed) return; closed = true;
    clearInterval(timer);clearInterval(probeTimer); watcher?.close(); stopWatcher?.close();
    process.off('SIGTERM', terminate); process.off('SIGINT', terminate);
    try { await receiver.close(code); } catch { code = code ?? 'IO_ERROR'; }
    finish(code);
  }
  function terminate() { void close(); }
  async function scan() {
    if (closed) return;
    if (scanning||probing) { again = true; return; }
    scanning = true;
    try {
      do {
        again = false;
        const stop = await readJson(root, ['runtime', address, 'stop.json'], { corrupt: 'CORRUPT_RECEIPT' });
        if (stop?.generation === receiver.generation) { await close(); break; }
        await receiver.tick();
      } while (again && !closed);
    } catch (error) { await close(error instanceof RelayError ? error.code : 'IO_ERROR'); }
    finally { scanning = false; }
  }
  try {
    watcher = fs.watch(await ownedPath(root, ['inbox', address]), () => void scan());
    stopWatcher = fs.watch(receiver.runtime, (_, file) => { if (String(file) === 'stop.json') void scan(); });
    watcher.on('error', () => void close('WATCH_FAILED'));
    stopWatcher.on('error', () => void close('WATCH_FAILED'));
    timer = setInterval(() => void scan(), 1000); // Machine-only missed-event recovery and batching deadlines.
    if(probeMs)probeTimer=setInterval(async()=>{
      if(closed||scanning||probing)return;probing=true;
      try{const outcome=await adapter.probe();if(outcome.code==='SESSION_INBOX_GONE')await close('SESSION_INBOX_GONE');}
      catch{/* Transient probe failures do not stop transport. */}
      finally{probing=false;if(again&&!closed)void scan();}
    },probeMs);
    process.on('SIGTERM', terminate); process.on('SIGINT', terminate);
    ready({ state: 'started', address, pid: process.pid, generation: receiver.generation });
    void scan();
  } catch (error) { await close(error.code ?? 'IO_ERROR'); }
  return completed;
}
