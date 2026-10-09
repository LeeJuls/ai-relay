import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sandbox } from './fixture.mjs';

async function storage() {
  let mod;
  await assert.doesNotReject(async () => { mod = await import('../lib/storage.mjs'); }, 'portable storage must be available');
  return mod;
}

test('temporary rename sharing errors eventually publish complete JSON', async t => {
  const { root } = await sandbox(t), mod = await storage();
  await fs.mkdir(root);
  const file = path.join(root, 'value.json');
  await fs.writeFile(file, '{"value":"old"}\n');
  let attempts = 0;
  const io = { ...fs, rename: async (...args) => {
    if (++attempts <= 2) throw Object.assign(new Error('busy'), { code: 'EPERM' });
    return fs.rename(...args);
  } };
  await mod.atomicJson(file, { value: 'new' }, { io, pause: async () => {} });
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { value: 'new' });
  assert.equal(attempts, 3);
  assert.deepEqual(await fs.readdir(root), ['value.json']);
});

test('permanent rename denial is bounded and preserves the previous file', async t => {
  const { root } = await sandbox(t), mod = await storage();
  await fs.mkdir(root);
  const file = path.join(root, 'value.json'); await fs.writeFile(file, 'original');
  let attempts = 0;
  const io = { ...fs, rename: async () => { attempts++; throw Object.assign(new Error('denied'), { code: 'EACCES' }); } };
  await assert.rejects(mod.atomicJson(file, { value: 'new' }, { io, pause: async () => {} }), { code: 'EACCES' });
  assert.equal(attempts, 4);
  assert.equal(await fs.readFile(file, 'utf8'), 'original');
  assert.deepEqual(await fs.readdir(root), ['value.json']);
});
