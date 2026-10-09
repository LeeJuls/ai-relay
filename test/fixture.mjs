import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function sandbox(t) {
  const parent = path.resolve(os.tmpdir());
  const container = await fs.mkdtemp(path.join(parent, 'relay-core-'));
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    const target = path.resolve(container);
    assert.ok(target.startsWith(parent + path.sep));
    assert.ok(path.basename(target).startsWith('relay-core-'));
    await fs.rm(target, { recursive: true, force: true });
  });
  return { container, root: path.join(container, '작업 공간 α'), beforeCleanup: action => cleanups.push(action) };
}

export async function loadCore() {
  let core;
  await assert.doesNotReject(async () => { core = await import('../lib/core.mjs'); }, 'portable core must be available');
  return core;
}

export async function paired(t, io) {
  const box = await sandbox(t);
  const core = await loadCore();
  await core.registerPair({ root: box.root, codexAddress: 'codex-demo', claudeAddress: 'claude-demo' });
  return {
    ...box, core,
    cx: core.createClient({ root: box.root, address: 'codex-demo', io }),
    cl: core.createClient({ root: box.root, address: 'claude-demo', io }),
  };
}
