import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { RelayError } from './errors.mjs';

export function absoluteRoot(root) {
  if (typeof root !== 'string' || !root || !path.isAbsolute(root)) throw new RelayError('INVALID_ROOT');
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root) throw new RelayError('INVALID_ROOT');
  return resolved;
}

export async function ownedPath(root, parts, io = fs) {
  const target = path.resolve(root, ...parts);
  if (target !== root && !target.startsWith(root + path.sep)) throw new RelayError('UNSAFE_PATH');
  const relative = path.relative(root, target);
  const nodes = [root];
  for (const part of relative ? relative.split(path.sep) : []) nodes.push(path.join(nodes.at(-1), part));
  for (const [index, node] of nodes.entries()) {
    try {
      const stat = await io.lstat(node);
      if (stat.isSymbolicLink() || (index < nodes.length - 1 && !stat.isDirectory())) throw new RelayError('UNSAFE_PATH');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}

export async function directory(root, parts, io = fs) {
  const dir = await ownedPath(root, parts, io);
  await io.mkdir(dir, { recursive: true });
  await ownedPath(root, parts, io);
  return dir;
}

export async function readJson(root, parts, { io = fs, corrupt = 'CORRUPT_MESSAGE' } = {}) {
  const file = await ownedPath(root, parts, io);
  let data;
  try { data = await io.readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let parsed;
  try { parsed = JSON.parse(data); }
  catch (error) { throw new RelayError(corrupt, { cause: error }); }
  // Only ENOENT means missing; a present JSON null record is corrupt application data.
  if (parsed === null) throw new RelayError(corrupt);
  return parsed;
}

export async function atomicJson(file, value, { io = fs, pause = setTimeout } = {}) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(8).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await io.open(tmp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value) + '\n', 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    await renameBounded(tmp, file, { io, pause });
  } finally {
    if (handle) await handle.close();
    await io.unlink(tmp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function renameBounded(source, target, { io = fs, pause = setTimeout } = {}) {
  const delays = [10, 30, 60];
  for (let attempt = 0; ; attempt++) {
    try { await io.rename(source, target); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= delays.length) throw error;
      await pause(delays[attempt]);
    }
  }
}

async function requireNoRecovery(root, io) {
  const gate = await ownedPath(root, ['.writer-recovery.lock'], io);
  try { await io.lstat(gate); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new RelayError('WRITER_BUSY');
}

// Explicit operator recovery only. No live/uncertain owner is ever evicted.
export async function recoverWriterLock({ root, io = fs }) {
  root = absoluteRoot(root);
  await requireNoRecovery(root, io);
  if (await readJson(root, ['.writer.lock'], { io, corrupt: 'CORRUPT_WRITER' }) === null) return { state: 'not_locked' };
  const gate = await ownedPath(root, ['.writer-recovery.lock'], io);
  let handle;
  try {
    try { handle = await io.open(gate, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new RelayError('WRITER_BUSY'); throw error; }
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
    await handle.sync();
    const original = await readJson(root, ['.writer.lock'], { io, corrupt: 'CORRUPT_WRITER' });
    if (original === null) return { state: 'not_locked' };
    if (typeof original !== 'object' || Array.isArray(original) || !Number.isInteger(original.pid) || original.pid <= 0 || original.pid > 2147483647 || typeof original.startedAt !== 'string' || !Number.isFinite(Date.parse(original.startedAt)) || new Date(original.startedAt).toISOString() !== original.startedAt) throw new RelayError('CORRUPT_WRITER');
    let dead = false;
    try { process.kill(original.pid, 0); }
    catch (error) { dead = error.code === 'ESRCH'; }
    if (!dead) throw new RelayError('WRITER_BUSY');
    const current = await readJson(root, ['.writer.lock'], { io, corrupt: 'CORRUPT_WRITER' });
    if (!current || current.pid !== original.pid || current.startedAt !== original.startedAt) throw new RelayError('CORRUPT_WRITER');
    await io.unlink(await ownedPath(root, ['.writer.lock'], io));
    return { state: 'writer_lock_recovered' };
  } catch (error) {
    if (error instanceof RelayError) throw error;
    throw new RelayError('IO_ERROR', { cause: error });
  } finally {
    if (handle) { await handle.close(); await io.unlink(gate); }
  }
}

export async function withWriter(root, action, io = fs) {
  let handle;
  const lock = path.join(root, '.writer.lock');
  try {
    await directory(root, [], io);
    await requireNoRecovery(root, io);
    try { handle = await io.open(lock, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new RelayError('WRITER_BUSY'); throw error; }
    // Recovery can start after the first check; back out before writing or acting.
    await requireNoRecovery(root, io);
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
    await handle.sync();
    return await action();
  } catch (error) {
    if (error instanceof RelayError) throw error;
    throw new RelayError('IO_ERROR', { cause: error });
  } finally {
    if (handle) { await handle.close(); await io.unlink(lock); }
  }
}

// Only the writer's pre-action refusal is retryable, never IO/transport uncertainty.
export async function retryWriterBusy(action,{attempts=10,pause=setTimeout}={}){
 if(typeof action!=='function'||!Number.isInteger(attempts)||attempts<1||attempts>50)throw new RelayError('INVALID_ARGS');
 for(let attempt=0;;attempt++){try{return await action();}catch(e){if(e.code!=='WRITER_BUSY'||attempt+1>=attempts)throw e;await pause(20);}}
}
