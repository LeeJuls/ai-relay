import fs from 'node:fs/promises';
import { RelayError } from './errors.mjs';
import { address, id, message, validateMessage, sameContent, replyId } from './message.mjs';
import { absoluteRoot, ownedPath, directory, readJson, atomicJson, withWriter, renameBounded } from './storage.mjs';

async function config(root, io, optional = false) {
  const data = await readJson(root, ['config.json'], { io, corrupt: 'CORRUPT_CONFIG' });
  if (data === null) {
    if (optional) return { schemaVersion: 1, addresses: {} };
    throw new RelayError('NOT_INITIALIZED');
  }
  try {
    if (data.schemaVersion !== 1 || !data.addresses || typeof data.addresses !== 'object' || Array.isArray(data.addresses)) throw Error();
    for (const [name, binding] of Object.entries(data.addresses)) {
      address(name); address(binding.peer);
      if (!['codex', 'claude'].includes(binding.provider) || binding.peer === name || !Object.hasOwn(data.addresses, binding.peer) || data.addresses[binding.peer].peer !== name) throw Error();
    }
  } catch (error) { throw new RelayError('CORRUPT_CONFIG', { cause: error }); }
  return data;
}

function peer(cfg, sender) {
  if (!Object.hasOwn(cfg.addresses, sender)) throw new RelayError('UNKNOWN_ADDRESS');
  return cfg.addresses[sender].peer;
}

async function findFor(root, receiver, value, io) {
  id(value);
  const found = [];
  for (const area of ['inbox', 'done']) {
    const msg = await readJson(root, [area, receiver, value + '.json'], { io });
    if (msg !== null) {
      try { validateMessage(msg); if (msg.id !== value || msg.to !== receiver) throw Error(); }
      catch (error) { throw new RelayError('CORRUPT_MESSAGE', { cause: error }); }
      found.push({ message: msg, area });
    }
  }
  if (found.length > 1) {
    // A reader may observe the source before an archive rename and its destination afterwards.
    const source = await ownedPath(root, ['inbox', receiver, value + '.json'], io);
    try { await io.lstat(source); }
    catch (error) { if (error.code === 'ENOENT') return found.find(entry => entry.area === 'done'); throw error; }
    throw new RelayError('CORRUPT_MESSAGE');
  }
  return found[0] ?? null;
}

async function findGlobal(root, cfg, value, io) {
  const found = [];
  for (const name of Object.keys(cfg.addresses)) {
    const entry = await findFor(root, name, value, io);
    if (entry) found.push(entry);
  }
  if (found.length > 1) throw new RelayError('ID_CONFLICT');
  return found[0]?.message ?? null;
}

async function publish(root, cfg, msg, io) {
  const old = await findGlobal(root, cfg, msg.id, io);
  if (old) {
    if (!sameContent(old, msg)) throw new RelayError('ID_CONFLICT');
    return old;
  }
  await directory(root, ['inbox', msg.to], io);
  const file = await ownedPath(root, ['inbox', msg.to, msg.id + '.json'], io);
  await atomicJson(file, msg, { io });
  return msg;
}

async function archive(root, receiver, entry, io) {
  const value = entry.message.id;
  if (entry.area === 'done') return { id: value, state: 'done', alreadyDone: true };
  await directory(root, ['done', receiver], io);
  const source = await ownedPath(root, ['inbox', receiver, value + '.json'], io);
  const target = await ownedPath(root, ['done', receiver, value + '.json'], io);
  await renameBounded(source, target, { io });
  return { id: value, state: 'done', alreadyDone: false };
}

export async function registerPair({ root, codexAddress, claudeAddress, io = fs }) {
  root = absoluteRoot(root); address(codexAddress); address(claudeAddress);
  if (codexAddress === claudeAddress) throw new RelayError('INVALID_ADDRESS');
  return withWriter(root, async () => {
    const cfg = await config(root, io, true);
    if (Object.hasOwn(cfg.addresses, codexAddress) || Object.hasOwn(cfg.addresses, claudeAddress)) throw new RelayError('ADDRESS_EXISTS');
    for (const name of [codexAddress, claudeAddress]) {
      await directory(root, ['inbox', name], io);
      await directory(root, ['done', name], io);
    }
    cfg.addresses[codexAddress] = { provider: 'codex', peer: claudeAddress };
    cfg.addresses[claudeAddress] = { provider: 'claude', peer: codexAddress };
    await atomicJson(await ownedPath(root, ['config.json'], io), cfg, { io });
    return cfg;
  }, io);
}

export function createClient({ root, address: sender, io = fs }) {
  root = absoluteRoot(root); address(sender);
  return {
    async send(input) {
      return withWriter(root, async () => {
        const cfg = await config(root, io), destination = peer(cfg, sender);
        if (input.to !== undefined && input.to !== destination) throw new RelayError('NOT_PEER');
        const msg = message({ from: sender, to: destination, body: input.body, type: input.type, task: input.task, wake: input.wake, id: input.id });
        return publish(root, cfg, msg, io);
      }, io);
    },
    async inbox() {
      const cfg = await config(root, io); peer(cfg, sender);
      const dir = await ownedPath(root, ['inbox', sender], io);
      let files;
      try { files = await io.readdir(dir); }
      catch (error) { if (error.code === 'ENOENT') return []; throw new RelayError('IO_ERROR', { cause: error }); }
      const messages = [];
      for (const file of files.filter(name => name.endsWith('.json'))) {
        const entry = await findFor(root, sender, file.slice(0, -5), io);
        if (!entry || entry.area !== 'inbox') continue;
        if (entry.message.from !== cfg.addresses[sender].peer) throw new RelayError('CORRUPT_MESSAGE');
        messages.push(entry.message);
      }
      return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },
    async reply(input) {
      return withWriter(root, async () => {
        const cfg = await config(root, io), destination = peer(cfg, sender);
        const original = await findFor(root, sender, input.id, io);
        if (!original) throw new RelayError('MESSAGE_NOT_FOUND');
        if (original.message.from !== destination) throw new RelayError('CORRUPT_MESSAGE');
        if (original.message.replyTo !== null) throw new RelayError('REPLY_CHAIN_BLOCKED');
        const answer = message({
          id: replyId(original.message.id, sender), from: sender, to: destination,
          replyTo: original.message.id, task: original.message.task, body: input.body,
          type: input.type ?? 'answer', wake: input.wake === undefined
            ? (original.message.type === 'question' && original.message.wake)
            : (typeof input.wake === 'boolean' ? input.wake || (original.message.type === 'question' && original.message.wake) : input.wake),
        });
        const saved = await findGlobal(root, cfg, answer.id, io);
        if (saved && !sameContent(saved, answer)) throw new RelayError('REPLY_CONFLICT');
        if (!saved && original.area === 'done') throw new RelayError('MESSAGE_DONE');
        const result = saved ?? await publish(root, cfg, answer, io);
        await archive(root, sender, original, io);
        return result;
      }, io);
    },
    async done(value) {
      return withWriter(root, async () => {
        const cfg = await config(root, io); peer(cfg, sender);
        const original = await findFor(root, sender, value, io);
        if (!original) throw new RelayError('MESSAGE_NOT_FOUND');
        if (original.message.from !== cfg.addresses[sender].peer) throw new RelayError('CORRUPT_MESSAGE');
        return archive(root, sender, original, io);
      }, io);
    },
  };
}
