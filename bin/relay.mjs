#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createClient, registerPair, setSendOnly } from '../lib/core.mjs';
import { RelayError } from '../lib/errors.mjs';
import { startReceiver, doctor } from '../lib/service.mjs';
import { deliveryStatus, requestStop, recoverReceiverLock } from '../lib/receiver.mjs';
import { openDashboard } from '../lib/dashboard.mjs';
import { installPackage, uninstallPackage } from '../lib/installation.mjs';
import * as slots from '../lib/slots.mjs';
import {retryWriterBusy} from '../lib/storage.mjs';
import { configureReview, reviewStatus, reviewExecutionStatus } from '../lib/review.mjs';

const argv = process.argv.slice(2);
const hinted = argv[argv.indexOf('--lang') + 1];
const language = ['en', 'ko', 'ja'].includes(hinted) ? hinted : 'en';
const strings = JSON.parse(await fs.readFile(new URL(`../locales/${language}.json`, import.meta.url), 'utf8'));

const flags = {
  pair: ['root', 'codex', 'claude', 'lang'],
  send: ['root', 'as', 'to', 'body-file', 'type', 'task', 'id', 'wake', 'lang', 'mode', 'previous'],
  reply: ['root', 'as', 'id', 'body-file', 'type', 'wake', 'lang'],
  inbox: ['root', 'as', 'lang'],
  done: ['root', 'as', 'id', 'lang'],
  start: ['root', 'as', 'batch-ms', 'probe-ms','keep-pending','lang'],
  'send-only':['root','as','off','lang'],
  slot:['root','as','action','name','to','force','reason','timeout-ms','interval-ms','lines','lang'],
  stop: ['root', 'as', 'lang'],
  status: ['root', 'as', 'lang'],
  doctor: ['root', 'as', 'lang'],
  recover: ['root', 'as', 'lang'],
  'review-config': ['root', 'as', 'config-file', 'off', 'lang'],
  'review-status': ['root', 'as', 'lang'],
  dashboard: ['root', 'port', 'lang'],
  install: ['dir', 'lang'],
  uninstall: ['dir', 'lang'],
  help: ['lang'],
};

function parse() {
  const command = argv[0] === '--help' || argv.length === 0 ? 'help' : argv[0];
  if (!Object.hasOwn(flags, command)) throw new RelayError('INVALID_ARGS');
  const options = {};
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : '';
    if (!flags[command].includes(key) || Object.hasOwn(options, key)) throw new RelayError('INVALID_ARGS');
    if (['wake','keep-pending','off','force'].includes(key)) { options[key] = true; continue; }
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new RelayError('INVALID_ARGS');
    options[key] = value;
  }
  if (options.lang !== undefined && !['en', 'ko', 'ja'].includes(options.lang)) throw new RelayError('INVALID_ARGS');
  if (options.mode !== undefined && !['review', 'followup'].includes(options.mode)) throw new RelayError('INVALID_ARGS');
  if (options.previous !== undefined && options.mode !== 'followup') throw new RelayError('INVALID_ARGS');
  return { command, options };
}

async function readBody(file) {
  if (!file) throw new RelayError('INVALID_ARGS');
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new RelayError('IO_ERROR');
    if (stat.size > 1048576) throw new RelayError('INVALID_BODY');
    const buffer = Buffer.alloc(1048577);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > 1048576) throw new RelayError('INVALID_BODY');
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, size)); }
    catch (error) { throw new RelayError('INVALID_BODY', { cause: error }); }
  } finally { await handle.close(); }
}

try {
  const { command, options } = parse();
  if (command === 'help') process.stdout.write(strings.HELP + '\n');
  else {
    let result;
    if (command === 'install') result = { ok: true, ...await installPackage({ target: options.dir }) };
    else if (command === 'uninstall') result = { ok: true, ...await uninstallPackage({ target: options.dir }) };
    else if (command === 'dashboard') {
      const ui = await openDashboard({ root: options.root, language, port: options.port === undefined ? 0 : Number(options.port) });
      process.stdout.write(JSON.stringify({ ok: true, state: 'dashboard_started', url: ui.url }) + '\n');
      const stop = async () => { await ui.close(); process.exitCode = 0; };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      await new Promise(resolve => process.once('beforeExit', resolve));
      result = { ok: true, state: 'dashboard_stopped' };
    } else if(command==='slot'){
      const input={root:options.root,name:options.name,as:options.as,action:options.action,to:options.to,force:!!options.force,reason:options.reason};
      if(options.action==='status')result={ok:true,now:await slots.list(input)};
      else if(options.action==='history')result={ok:true,history:await slots.history({...input,lines:options.lines===undefined?20:Number(options.lines)}),now:await slots.list(input)};
      else if(options.action==='wait'){
        const controller=new AbortController(),cancel=()=>controller.abort();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
        try{result=await slots.wait({...input,timeoutMs:options['timeout-ms']===undefined?240*60000:Number(options['timeout-ms']),intervalMs:options['interval-ms']===undefined?1000:Number(options['interval-ms']),signal:controller.signal});}
        finally{process.off('SIGINT',cancel);process.off('SIGTERM',cancel);}
      }else result=await slots.act(input);
      // JSON includes the all-slot now snapshot on success, contention and timeout.
      if(!result.ok)process.exitCode=result.timeout?3:2;
    } else if(command==='review-config') {
      if (!!options.off === !!options['config-file']) throw new RelayError('INVALID_ARGS');
      result = { ok: true, ...await configureReview({ root: options.root, address: options.as, config: options.off ? false : JSON.parse(await readBody(options['config-file'])) }) };
    } else if(command==='review-status')result={ok:true,reviews:await reviewStatus({root:options.root,address:options.as}),execution:await reviewExecutionStatus({root:options.root,address:options.as})};
    else if(command==='send-only')result={ok:true,...await setSendOnly({root:options.root,address:options.as,enabled:!options.off})};
    else if (command === 'pair') {
      const cfg = await registerPair({ root: options.root, codexAddress: options.codex, claudeAddress: options.claude });
      result = { ok: true, state: 'configured', addresses: Object.keys(cfg.addresses) };
    } else if (['start', 'stop', 'status', 'doctor', 'recover'].includes(command)) {
      const input = { root: options.root, address: options.as };
      if (command === 'start') result = { ok: true, ...await startReceiver({ ...input, batchMs: options['batch-ms'] === undefined ? 120000 : Number(options['batch-ms']),probeMs:options['probe-ms']===undefined?30000:Number(options['probe-ms']),keepPending:!!options['keep-pending'] }) };
      if (command === 'stop') result = { ok: true, ...await requestStop(input) };
      if (command === 'status') result = { ok: true, ...await deliveryStatus(input) };
      if (command === 'doctor') result = { ok: true, ...await doctor(input) };
      if (command === 'recover') result = { ok: true, ...await recoverReceiverLock(input) };
    } else {
      const client = createClient({ root: options.root, address: options.as });
      if (command === 'inbox') result = { ok: true, messages: await client.inbox() };
      else if (command === 'done') result = { ok: true, ...await retryWriterBusy(()=>client.done(options.id)) };
      else {
        const input = { body: await readBody(options['body-file']), id: options.id, type: options.type, wake: options.wake };
        const saved = await retryWriterBusy(()=>command === 'send'
          ? client.send({ ...input, to: options.to, task: options.task, ...(options.mode ? { review: { mode: options.mode, ...(options.previous ? { previousId: options.previous } : {}) } } : {}) })
          : client.reply(input));
        result = { ok: true, state: 'saved', message: saved };
      }
    }
    process.stdout.write(JSON.stringify(result) + '\n');
  }
} catch (error) {
  const code = error instanceof RelayError ? error.code : (error.code ? 'IO_ERROR' : 'INTERNAL_ERROR');
  process.stderr.write(JSON.stringify({ ok: false, error: { code, message: strings[code] ?? strings.INTERNAL_ERROR } }) + '\n');
  process.exitCode = 2;
}
