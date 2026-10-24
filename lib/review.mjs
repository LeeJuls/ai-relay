import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createClient, readConfiguration } from './core.mjs';
import { address as validAddress, id as validId, replyId } from './message.mjs';
import { absoluteRoot, directory, ownedPath, readJson, atomicJson, withWriter, retryWriterBusy } from './storage.mjs';
import { RelayError } from './errors.mjs';
import { validateReviewConfig } from './review-config.mjs';
import { runReviewCli, reviewRules, validateResult } from './review-runner.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const states = new Set(['running', 'result', 'publishing', 'replied', 'held']);
const nested = (a, b) => a === b || a.startsWith(b + path.sep);
const key = p => process.platform === 'win32' ? p.toLowerCase() : p;
const overlaps = (a, b) => nested(key(a), key(b)) || nested(key(b), key(a));
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
}
async function neutral(dir) {
  for (let p = dir; ; p = path.dirname(p)) {
    for (const name of ['.git', 'AGENTS.md', 'CLAUDE.md']) {
      if (p === os.homedir() && name !== '.git') continue; // Mandatory user instructions remain in force.
      try { await fs.lstat(path.join(p, name)); throw new RelayError('REVIEW_CONFIG'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    if (path.dirname(p) === p) break;
  }
}
async function resolvedConfig(root, config) {
  validateReviewConfig(config);
  if (config === false) return false;
  const cli = await fs.realpath(config.cli);
  if (!(await fs.stat(cli)).isFile() || (process.platform === 'win32' && !/\.exe$/i.test(cli))) throw new RelayError('REVIEW_CONFIG');
  await neutral(config.jobRoot);
  await directory(absoluteRoot(config.jobRoot), []);
  const jobRoot = await fs.realpath(config.jobRoot); await neutral(jobRoot);
  const dataRoot = await fs.realpath(root);
  if (overlaps(jobRoot, dataRoot)) throw new RelayError('REVIEW_CONFIG');
  const evidenceDirs = [];
  for (const dir of config.evidenceDirs) {
    const actual = await fs.realpath(dir);
    if (!(await fs.stat(actual)).isDirectory() || overlaps(actual, dataRoot) || overlaps(actual, jobRoot)) throw new RelayError('REVIEW_CONFIG');
    if (!evidenceDirs.some(d => key(d) === key(actual))) evidenceDirs.push(actual);
  }
  return { ...config, cli, jobRoot, evidenceDirs };
}
export async function configureReview({ root, address, config }) {
  root = absoluteRoot(root); validAddress(address);
  const cfg = await readConfiguration({ root });
  if (!cfg.addresses[address]) throw new RelayError('UNKNOWN_ADDRESS');
  const resolved = await resolvedConfig(root, config);
  return retryWriterBusy(() => withWriter(root, async () => {
    const current = await readConfiguration({ root });
    current.addresses[address].review = resolved;
    await atomicJson(await ownedPath(root, ['config.json']), current);
    return { address, reviewEnabled: resolved !== false };
  }));
}
export function boundedPrevious(input) {
  validateResult(input);
  const result = { conclusion: input.conclusion.slice(0, 3000), evidence: input.evidence.slice(0, 5).map(x => x.slice(0, 300)), nextAction: input.nextAction.slice(0, 1000) };
  while (JSON.stringify(result).length > 6000) {
    if (result.evidence.length) result.evidence.pop();
    else {
      const k = result.conclusion.length > result.nextAction.length ? 'conclusion' : 'nextAction';
      result[k] = result[k].slice(0, Math.max(0, result[k].length - 200));
    }
  }
  return { result, truncated: JSON.stringify(result) !== JSON.stringify(input) };
}
function recordValid(r, id) {
  if (!r || r.schemaVersion !== 1 || r.id !== id || !states.has(r.state) || !/^[a-f0-9]{64}$/.test(r.hash) ||
      typeof r.jobDir !== 'string' || !path.isAbsolute(r.jobDir)) throw new RelayError('CORRUPT_RECEIPT');
  return r;
}
async function record(root, address, id) {
  const r = await readJson(root, ['reviews', address, id + '.json'], { corrupt: 'CORRUPT_RECEIPT' });
  return r === null ? null : recordValid(r, id);
}
async function executionGate(root, address) {
  const gate = await readJson(root, ['reviews', address, 'execution.json'], { corrupt: 'CORRUPT_RECEIPT' });
  if (gate && (gate.schemaVersion !== 1 || !/^[a-f0-9]{32}$/.test(gate.id) || !/^[a-f0-9]{64}$/.test(gate.hash))) throw new RelayError('CORRUPT_RECEIPT');
  return gate;
}
async function releaseGate(root, address, state) {
  const gate = await executionGate(root, address);
  if (gate?.id === state.id && gate.hash === state.hash && state.code !== 'REVIEW_PROCESS_UNCERTAIN') await fs.unlink(await ownedPath(root, ['reviews', address, 'execution.json']));
}
export async function reviewStatus({ root, address }) {
  root = absoluteRoot(root); validAddress(address);
  const cfg = await readConfiguration({ root });
  if (!cfg.addresses[address]) throw new RelayError('UNKNOWN_ADDRESS');
  const gate = await executionGate(root, address);
  let files;
  try { files = await fs.readdir(await ownedPath(root, ['reviews', address])); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  return Promise.all(files.filter(f => /^[a-f0-9]{32}\.json$/.test(f)).sort().map(async f => {
    const r = await record(root, address, f.slice(0, -5));
    const interrupted = r.state === 'running' && !alive(r.ownerPid);
    return { id: r.id, state: interrupted || r.state === 'publishing' ? 'held' : r.state, code: interrupted ? 'REVIEW_INTERRUPTED' : r.code ?? null, executionHeld: gate?.id === r.id, jobDir: r.jobDir, updatedAt: r.updatedAt };
  }));
}
export async function reviewExecutionStatus({ root, address }) {
  root = absoluteRoot(root); validAddress(address);
  const cfg = await readConfiguration({ root });
  if (!cfg.addresses[address]) throw new RelayError('UNKNOWN_ADDRESS');
  const gate = await executionGate(root, address);
  return gate ? { id: gate.id, ownerPid: gate.ownerPid ?? null, ownerAlive: alive(gate.ownerPid), state: 'claimed' } : null;
}
export async function runReview({ root, address, id, runner = runReviewCli }) {
  root = absoluteRoot(root); validAddress(address); validId(id);
  const client = createClient({ root, address });
  const cfg = await readConfiguration({ root });
  const binding = cfg.addresses[address];
  if (!binding) throw new RelayError('UNKNOWN_ADDRESS');
  if (!binding.review || binding.sendOnly) throw new RelayError('REVIEW_DISABLED');
  const config = await resolvedConfig(root, binding.review);
  const canonicalRoot = await fs.realpath(root);
  const jobDir = await directory(config.jobRoot, [digest(canonicalRoot).slice(0, 32), address, id]);
  const save = async r => {
    await directory(root, ['reviews', address]);
    await atomicJson(await ownedPath(root, ['reviews', address, id + '.json']), { ...r, updatedAt: new Date().toISOString() });
  };
  let entry, state, execute = false;
  await retryWriterBusy(() => withWriter(root, async () => {
    entry = await client.received(id);
    if (!entry || !entry.message.review) throw new RelayError('MESSAGE_NOT_FOUND');
    const m = entry.message, hash = digest(JSON.stringify(m));
    state = await record(root, address, id);
    if (state && (state.hash !== hash || state.jobDir !== jobDir)) throw new RelayError('REVIEW_SCOPE');
    if (!state) {
      if (entry.area !== 'inbox') throw new RelayError('MESSAGE_DONE');
      if (await executionGate(root, address)) throw new RelayError('REVIEW_PROCESS_UNCERTAIN');
      state = { schemaVersion: 1, id, hash, jobDir, state: 'running', ownerPid: process.pid };
      await directory(root, ['reviews', address]);
      // Durable address-wide claim also survives a crash before per-ID state publication.
      await atomicJson(await ownedPath(root, ['reviews', address, 'execution.json']), { schemaVersion: 1, id, hash, jobDir, ownerPid: process.pid });
      await save(state); execute = true;
    }
  }));
  const m = entry.message;
  if (!execute && (state.state === 'running' || (state.state === 'held' && !state.body))) return { id, state: 'held', code: state.code ?? 'REVIEW_INTERRUPTED', jobDir };
  if (execute) {
    try {
      let previous = '';
      if (m.review.mode === 'followup') {
        const old = await client.received(m.review.previousId);
        const prior = await record(root, address, m.review.previousId);
        if (!old || old.message.task !== m.task || old.message.from !== m.from || !old.message.review || !prior || prior.hash !== digest(JSON.stringify(old.message)) || prior.state !== 'replied' || !prior.result) throw new RelayError('REVIEW_SCOPE');
        previous = '\nPrevious result (same task only, bounded; truncation is explicit):\n' + JSON.stringify(boundedPrevious(prior.result));
      }
      const prompt = reviewRules + '\nTask: ' + m.task + '\nDesignated evidence directories: ' + JSON.stringify(config.evidenceDirs) + previous + '\nRequest:\n' + m.body;
      const outcome = await runner({ ...config, provider: binding.provider, jobDir, prompt });
      state.result = validateResult(outcome.result);
      await atomicJson(await ownedPath(config.jobRoot, [path.relative(config.jobRoot, jobDir), 'result.json']), state.result);
    } catch (e) {
      state.code = e instanceof RelayError && /^REVIEW_|^IO_ERROR$/.test(e.code) ? e.code : 'REVIEW_EXEC';
      state.result = { conclusion: 'Blocked: ' + state.code, evidence: ['No complete review was certified. Execution may require inspection; this ID will not run again.'], nextAction: 'Inspect the local review status and logs. Ask the owner before creating a new request.' };
    }
    state.body = JSON.stringify(state.result);
    state.state = 'result'; await retryWriterBusy(() => withWriter(root, async () => { await save(state); await releaseGate(root, address, state); }));
  }
  const replies = createClient({ root, address: m.from });
  const exact = (await replies.received(replyId(id, address)))?.message;
  if (exact) {
    if (exact.replyTo !== id || exact.from !== address || exact.to !== m.from || exact.task !== m.task || exact.type !== 'result' || exact.body !== state.body) throw new RelayError('REPLY_CONFLICT');
    // Also finishes an archive interrupted after the deterministic reply was saved.
    await retryWriterBusy(() => client.reply({ id, type: 'result', body: state.body }));
    state.state = 'replied'; await retryWriterBusy(() => withWriter(root, async () => { await save(state); await releaseGate(root, address, state); }));
    return { id, state: 'replied', code: state.code ?? null, jobDir };
  }
  if (['publishing', 'replied', 'held'].includes(state.state)) return { id, state: 'held', code: state.code ?? 'REVIEW_PUBLICATION_UNCERTAIN', jobDir };
  // A saved publication claim without a linked reply is held on restart.
  state.state = 'publishing'; await retryWriterBusy(() => withWriter(root, () => save(state)));
  try {
    await retryWriterBusy(() => client.reply({ id, body: state.body, type: 'result' }));
    state.state = 'replied'; await retryWriterBusy(() => withWriter(root, async () => { await save(state); await releaseGate(root, address, state); }));
    return { id, state: 'replied', code: state.code ?? null, jobDir };
  } catch (e) {
    state.state = 'held'; state.code = e instanceof RelayError ? e.code : 'IO_ERROR';
    await retryWriterBusy(() => withWriter(root, () => save(state)));
    return { id, state: 'held', code: state.code, jobDir };
  }
}
