import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createClient } from './core.mjs';
import { address as validAddress } from './message.mjs';
import { RelayError } from './errors.mjs';
import { absoluteRoot, directory, ownedPath, readJson, atomicJson, withWriter, recoverWriterLock } from './storage.mjs';

const STATES = ['claimed', 'accepted', 'not_sent', 'uncertain', 'held'];
async function receipt(root, address, id, io) {
  const value = await readJson(root, ['delivery', address, id + '.json'], { io, corrupt: 'CORRUPT_RECEIPT' });
  if (value !== null && (typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 || value.id !== id || !STATES.includes(value.state) || !Number.isInteger(value.attempts) || value.attempts < 0 || value.attempts > 3 || !Number.isFinite(Date.parse(value.updatedAt)))) throw new RelayError('CORRUPT_RECEIPT');
  return value;
}
async function save(root, address, value, io) {
  const file = await ownedPath(root, ['delivery', address, value.id + '.json'], io);
  await atomicJson(file, value, { io });
}
function living(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } }

// A receipt is transport evidence, never evidence that a model read or answered the mail.
export async function deliveryStatus({ root, address, io = fs }) {
  root = absoluteRoot(root); validAddress(address);
  const messages = await createClient({ root, address, io }).inbox();
  const counts = { pending: 0, accepted: 0, held: 0 };
  for (const m of messages) {
    const r = await receipt(root, address, m.id, io);
    if (!r || r.state === 'not_sent') counts.pending++;
    else if (r.state === 'accepted') counts.accepted++;
    else counts.held++;
  }
  const state = await readJson(root, ['runtime', address, 'status.json'], { io, corrupt: 'CORRUPT_RECEIPT' });
  const lock = await readJson(root, ['runtime', address, 'receiver.lock'], { io, corrupt: 'CORRUPT_RECEIPT' });
  if (lock && (!Number.isInteger(lock.pid) || lock.pid <= 0 || typeof lock.generation !== 'string')) throw new RelayError('CORRUPT_RECEIPT');
  return { address, ...counts, phase: state?.phase ?? 'not_registered', processAlive: !!lock && living(lock.pid),
    updatedAt: state?.updatedAt ?? null, provider: state?.provider ?? null, experimental: state?.experimental ?? null,
    lastOutcome: state?.lastOutcome ?? null, modelReceiptVerified: false };
}

export async function openReceiver({ root, address, adapter, io = fs, now = Date.now, batchMs = 120000, retryMs = 1000, maxPostBytes = 200000, maxPostsPerMinute = 6 }) {
  root = absoluteRoot(root); validAddress(address);
  if (!adapter?.identity || typeof adapter.post !== 'function' || !Number.isInteger(batchMs) || batchMs < 0 || batchMs > 120000 || !Number.isInteger(retryMs) || retryMs < 1 || !Number.isInteger(maxPostBytes) || maxPostBytes < 100 || maxPostBytes > 1048576 || !Number.isInteger(maxPostsPerMinute) || maxPostsPerMinute < 1 || maxPostsPerMinute > 60) throw new RelayError('INVALID_ARGS');
  const client = createClient({ root, address, io });
  await client.inbox(); // Strict core validation before using registration metadata.
  const cfg = await readJson(root, ['config.json'], { io, corrupt: 'CORRUPT_CONFIG' });
  if (cfg.addresses[address].provider !== adapter.identity.provider) throw new RelayError('REGISTRATION_INVALID');
  const runtime = await directory(root, ['runtime', address], io);
  await directory(root, ['delivery', address], io);
  const lockPath = await ownedPath(root, ['runtime', address, 'receiver.lock'], io);
  const generation = randomUUID();
  let lock;
  try { lock = await withWriter(root, async () => {
    let handle;
    try { handle = await io.open(lockPath, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new RelayError('RECEIVER_BUSY'); throw error; }
    try { await handle.writeFile(JSON.stringify({ schemaVersion: 1, pid: process.pid, generation }) + '\n'); await handle.sync(); return handle; }
    catch (error) { await handle.close(); await io.unlink(lockPath); throw error; }
  }, io); }
  catch (error) { if (error.code === 'EEXIST') throw new RelayError('RECEIVER_BUSY'); throw error; }
  let closed = false, released = false, handleClosed = false, closing = null, queue = Promise.resolve(), lastOutcome = null;
  const firstSeen = new Map(), postsAt = [];
  async function setStatus(phase) {
    await atomicJson(await ownedPath(root, ['runtime', address, 'status.json'], io), {
      schemaVersion: 1, address, provider: adapter.identity.provider, experimental: !!adapter.identity.experimental,
      generation, phase, pid: process.pid, updatedAt: new Date(now()).toISOString(), lastOutcome,
    }, { io });
  }
  function close() {
    if (released) return Promise.resolve();
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      await queue.catch(() => {});
      try { await setStatus('stopped'); }
      finally {
        for (let attempt = 0; ; attempt++) {
          try {
            await withWriter(root, async () => {
              const current = await readJson(root, ['runtime', address, 'receiver.lock'], { io, corrupt: 'CORRUPT_RECEIPT' });
              if (current?.generation !== generation) throw new RelayError('CORRUPT_RECEIPT');
              if (!handleClosed) { await lock.close(); handleClosed = true; }
              await io.unlink(lockPath); released = true;
            }, io);
            break;
          } catch (error) {
            if (error.code !== 'WRITER_BUSY' || attempt >= 3) throw error;
            await new Promise(resolve => setTimeout(resolve, [20, 50, 100][attempt]));
          }
        }
      }
    })().finally(() => { closing = null; });
    return closing;
  }
  try {
    await setStatus('registered');
  } catch (error) { await close(); throw error; }

  async function work() {
    if (closed) return;
    const pending = [];
    for (const m of await client.inbox()) {
      const old = await receipt(root, address, m.id, io);
      if (old && !['not_sent'].includes(old.state)) continue;
      if (old?.attempts >= 3) continue;
      if (old && now() - Date.parse(old.updatedAt) < retryMs) continue;
      if (!firstSeen.has(m.id)) firstSeen.set(m.id, now());
      pending.push({ m, old });
    }
    if (!pending.length) { await setStatus('watching'); return; }
    const due = pending.some(({ m }) => m.type === 'question' || m.wake) || pending.some(({ m }) => now() - firstSeen.get(m.id) >= batchMs);
    if (!due) { await setStatus('batch_wait'); return; }
    while (postsAt.length && now() - postsAt[0] >= 60000) postsAt.shift();
    let group = [], body = '';
    const hold = async (entry, code) => save(root, address, { schemaVersion: 1, id: entry.m.id, state: 'held', code, attempts: entry.old?.attempts ?? 0, updatedAt: new Date(now()).toISOString() }, io);
    let eligible = false;
    try {
      await withWriter(root, async () => {
        // Archive and claim share one lock: a stale snapshot cannot resurrect handled mail.
        const current = new Map((await client.inbox()).map(m => [m.id, m]));
        for (const entry of pending) {
          const latest = current.get(entry.m.id);
          if (!latest) { firstSeen.delete(entry.m.id); continue; }
          entry.m = latest;
          eligible = true;
          const text = `[peer ${entry.m.from} #${entry.m.id} not-owner]\n${entry.m.body}`;
          if (Buffer.byteLength(text) > maxPostBytes) { await hold(entry, 'POST_TOO_LARGE'); continue; }
          if (postsAt.length >= maxPostsPerMinute) { await hold(entry, 'RATE_LIMIT'); continue; }
          if (group.length && Buffer.byteLength(body + '\n\n' + text) > maxPostBytes) break;
          group.push(entry); body += (body ? '\n\n' : '') + text;
        }
        // Partial claim-save failure holds already claimed IDs; no app send follows it.
        for (const entry of group) await save(root, address, { schemaVersion: 1, id: entry.m.id, state: 'claimed', generation, attempts: (entry.old?.attempts ?? 0) + 1, updatedAt: new Date(now()).toISOString() }, io);
      }, io);
    } catch (error) {
      // A normal concurrent sender/archive must not terminate the watching receiver.
      if (error.code !== 'WRITER_BUSY') throw error;
      await setStatus('watching'); return;
    }
    if (!group.length) { await setStatus(eligible ? 'held' : 'watching'); return; }
    // App transport is outside the writer lock, allowing replies and other senders.
    await setStatus('sending');
    postsAt.push(now());
    let outcome;
    try { outcome = await adapter.post(body); } catch { outcome = { state: 'uncertain', code: 'TRANSPORT_ERROR' }; }
    if (!outcome || !['accepted', 'not_sent', 'uncertain'].includes(outcome.state)) outcome = { state: 'uncertain', code: 'INVALID_ADAPTER_RESULT' };
    lastOutcome = { state: outcome.state, code: /^[A-Z_]{1,60}$/.test(outcome.code ?? '') ? outcome.code : 'TRANSPORT_RESULT' };
    for (const entry of group) {
      const attempts = (entry.old?.attempts ?? 0) + 1;
      await save(root, address, { schemaVersion: 1, id: entry.m.id,
        state: outcome.state === 'not_sent' && attempts >= 3 ? 'held' : outcome.state,
        code: lastOutcome.code, attempts, generation, updatedAt: new Date(now()).toISOString() }, io);
    }
    await setStatus(outcome.state === 'accepted' ? 'watching' : outcome.state === 'not_sent' ? 'disconnected' : 'held');
  }
  return { address, runtime, generation, tick() { const next = queue.then(work); queue = next.catch(() => {}); return next; }, close,
    status: () => deliveryStatus({ root, address, io }) };
}

export async function requestStop({ root, address }) {
  root = absoluteRoot(root); validAddress(address);
  const lock = await readJson(root, ['runtime', address, 'receiver.lock'], { corrupt: 'CORRUPT_RECEIPT' });
  if (!lock) return { state: 'not_running' };
  if (!Number.isInteger(lock.pid) || lock.pid <= 0 || typeof lock.generation !== 'string') throw new RelayError('CORRUPT_RECEIPT');
  await atomicJson(await ownedPath(root, ['runtime', address, 'stop.json']), { generation: lock.generation });
  return { state: 'stop_requested', address };
}

export async function recoverReceiverLock({ root, address, io = fs }) {
  root = absoluteRoot(root); validAddress(address);
  const writer = await recoverWriterLock({ root, io });
  const result = await withWriter(root, async () => {
    const file = await ownedPath(root, ['runtime', address, 'receiver.lock'], io);
    const lock = await readJson(root, ['runtime', address, 'receiver.lock'], { io, corrupt: 'CORRUPT_RECEIPT' });
    if (lock === null) return { state: 'not_locked' };
    if (!Number.isInteger(lock.pid) || lock.pid <= 0 || typeof lock.generation !== 'string') throw new RelayError('CORRUPT_RECEIPT');
    if (living(lock.pid)) throw new RelayError('RECEIVER_BUSY');
    await io.unlink(file); // Serialized with acquisition and cleanup; claims are retained.
    return { state: 'lock_recovered', address };
  }, io);
  return { ...result, writerRecovered: writer.state === 'writer_lock_recovered' };
}
