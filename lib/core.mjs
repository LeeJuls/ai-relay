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
      if (binding.sendOnly !== undefined && typeof binding.sendOnly !== 'boolean') throw Error();
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

async function findReference(root,receiver,ref,io){
 if(typeof ref!=='string'||!/^[a-f0-9]{6,32}$/.test(ref))throw new RelayError('INVALID_ID');
 if(ref.length===32)return findFor(root,receiver,ref,io);
 const matches=new Set();
 for(const area of ['inbox','done']){let files=[];try{files=await io.readdir(await ownedPath(root,[area,receiver],io));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const f of files.filter(f=>/^[a-f0-9]{32}\.json$/.test(f))){const value=f.slice(0,-5);if(value.startsWith(ref)||value.endsWith(ref))matches.add(value);}}
 if(matches.size>1)throw new RelayError('AMBIGUOUS_ID');
 return matches.size?findFor(root,receiver,[...matches][0],io):null;
}

async function publish(root, cfg, msg, io) {
  if (cfg.addresses[msg.to].sendOnly && (msg.type === 'question' || msg.wake)) throw new RelayError('SEND_ONLY');
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

async function manualIntent(root,sender,value,io){
 const record=await readJson(root,['completion',sender,value+'.json'],{io,corrupt:'CORRUPT_RECEIPT'});
 if(record!==null&&(record.schemaVersion!==1||record.id!==value||record.manual!==true))throw new RelayError('CORRUPT_RECEIPT');
 return record!==null;
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
        const original = await findReference(root, sender, input.id, io);
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
        if(!saved&&await manualIntent(root,sender,original.message.id,io))throw new RelayError('MESSAGE_DONE');
        if (!saved && original.area === 'done') {
          const evidence = await readJson(root, ['delivery', sender, original.message.id + '.json'], {io, corrupt:'CORRUPT_RECEIPT'});
          if (evidence?.schemaVersion !== 1 || evidence.id !== original.message.id || evidence.state !== 'accepted' || evidence.archiveMode !== 'posted') throw new RelayError('MESSAGE_DONE');
        }
        const result = saved ?? await publish(root, cfg, answer, io);
        await archive(root, sender, original, io);
        return result;
      }, io);
    },
    async done(value) {
      return withWriter(root, async () => {
        const cfg = await config(root, io); peer(cfg, sender);
        const original = await findReference(root, sender, value, io);
        if (!original) throw new RelayError('MESSAGE_NOT_FOUND');
        value=original.message.id;
        if (original.message.from !== cfg.addresses[sender].peer) throw new RelayError('CORRUPT_MESSAGE');
        await directory(root,['completion',sender],io);
        await atomicJson(await ownedPath(root,['completion',sender,value+'.json'],io),{schemaVersion:1,id:value,manual:true},{io});
        const evidence=await readJson(root,['delivery',sender,value+'.json'],{io,corrupt:'CORRUPT_RECEIPT'});
        if(evidence?.state==='accepted') await atomicJson(await ownedPath(root,['delivery',sender,value+'.json'],io),{...evidence,archiveMode:'manual'},{io});
        return archive(root, sender, original, io);
      }, io);
    },
    async archivePosted(value) {
      return withWriter(root,async()=>{
        const cfg=await config(root,io);peer(cfg,sender);
        const original=await findFor(root,sender,value,io);
        if(!original)throw new RelayError('MESSAGE_NOT_FOUND');
        if(original.message.from!==cfg.addresses[sender].peer)throw new RelayError('CORRUPT_MESSAGE');
        if(await manualIntent(root,sender,value,io))return archive(root,sender,original,io);
        const evidence=await readJson(root,['delivery',sender,value+'.json'],{io,corrupt:'CORRUPT_RECEIPT'});
        if(evidence?.schemaVersion!==1||evidence.id!==value||evidence.state!=='accepted')throw new RelayError('CORRUPT_RECEIPT');
        if(evidence.archiveMode==='manual')return {id:value,state:'done',alreadyDone:true};
        await atomicJson(await ownedPath(root,['delivery',sender,value+'.json'],io),{...evidence,archiveMode:'posted'},{io});
        return archive(root,sender,original,io);
      },io);
    },
  };
}

export async function setSendOnly({root,address: name,enabled,io=fs}) {
 root=absoluteRoot(root);address(name);if(typeof enabled!=='boolean')throw new RelayError('INVALID_ARGS');
 return withWriter(root,async()=>{const cfg=await config(root,io);peer(cfg,name);cfg.addresses[name].sendOnly=enabled;
 await atomicJson(await ownedPath(root,['config.json'],io),cfg,{io});return {address:name,sendOnly:enabled};},io);
}

export async function readConfiguration({root,io=fs}) {return config(absoluteRoot(root),io);}
