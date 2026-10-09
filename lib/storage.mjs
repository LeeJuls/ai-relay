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

export async function withWriter(root, action, io = fs) {
  let handle;
  const lock = path.join(root, '.writer.lock');
  try {
    await directory(root, [], io);
    try { handle = await io.open(lock, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new RelayError('WRITER_BUSY'); throw error; }
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
