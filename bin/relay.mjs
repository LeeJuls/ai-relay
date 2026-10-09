#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createClient, registerPair } from '../lib/core.mjs';
import { RelayError } from '../lib/errors.mjs';
import { startReceiver, doctor } from '../lib/service.mjs';
import { deliveryStatus, requestStop, recoverReceiverLock } from '../lib/receiver.mjs';
import { openDashboard } from '../lib/dashboard.mjs';
import { installPackage, uninstallPackage } from '../lib/installation.mjs';

const argv = process.argv.slice(2);
const hinted = argv[argv.indexOf('--lang') + 1];
const language = ['en', 'ko'].includes(hinted) ? hinted : 'en';
const strings = JSON.parse(await fs.readFile(new URL(`../locales/${language}.json`, import.meta.url), 'utf8'));

const flags = {
  pair: ['root', 'codex', 'claude', 'lang'],
  send: ['root', 'as', 'to', 'body-file', 'type', 'task', 'id', 'wake', 'lang'],
  reply: ['root', 'as', 'id', 'body-file', 'type', 'wake', 'lang'],
  inbox: ['root', 'as', 'lang'],
  done: ['root', 'as', 'id', 'lang'],
  start: ['root', 'as', 'batch-ms', 'lang'],
  stop: ['root', 'as', 'lang'],
  status: ['root', 'as', 'lang'],
  doctor: ['root', 'as', 'lang'],
  recover: ['root', 'as', 'lang'],
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
    if (key === 'wake') { options[key] = true; continue; }
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new RelayError('INVALID_ARGS');
    options[key] = value;
  }
  if (options.lang !== undefined && !['en', 'ko'].includes(options.lang)) throw new RelayError('INVALID_ARGS');
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
    } else if (command === 'pair') {
      const cfg = await registerPair({ root: options.root, codexAddress: options.codex, claudeAddress: options.claude });
      result = { ok: true, state: 'configured', addresses: Object.keys(cfg.addresses) };
    } else if (['start', 'stop', 'status', 'doctor', 'recover'].includes(command)) {
      const input = { root: options.root, address: options.as };
      if (command === 'start') result = { ok: true, ...await startReceiver({ ...input, batchMs: options['batch-ms'] === undefined ? 120000 : Number(options['batch-ms']) }) };
      if (command === 'stop') result = { ok: true, ...await requestStop(input) };
      if (command === 'status') result = { ok: true, ...await deliveryStatus(input) };
      if (command === 'doctor') result = { ok: true, ...await doctor(input) };
      if (command === 'recover') result = { ok: true, ...await recoverReceiverLock(input) };
    } else {
      const client = createClient({ root: options.root, address: options.as });
      if (command === 'inbox') result = { ok: true, messages: await client.inbox() };
      else if (command === 'done') result = { ok: true, ...await client.done(options.id) };
      else {
        const input = { body: await readBody(options['body-file']), id: options.id, type: options.type, wake: options.wake };
        const saved = command === 'send'
          ? await client.send({ ...input, to: options.to, task: options.task })
          : await client.reply(input);
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
