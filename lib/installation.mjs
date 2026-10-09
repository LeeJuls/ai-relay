import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { absoluteRoot, ownedPath, readJson, atomicJson } from './storage.mjs';
import { RelayError } from './errors.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const exec = promisify(execFile);
function inside(root, file) {
  const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const a = canonical(root), b = canonical(file); return a === b || b.startsWith(a + path.sep);
}
export function defaultInstallDirectory(env = process.env) {
  if (process.platform !== 'win32' || !env.LOCALAPPDATA || !path.isAbsolute(env.LOCALAPPDATA)) throw new RelayError('INVALID_ROOT');
  return path.join(env.LOCALAPPDATA, 'AiRelayPreview', 'app');
}
async function verify(source) {
  source = absoluteRoot(source);
  const manifest = await readJson(source, ['manifest.json'], { corrupt: 'INSTALL_MODIFIED' });
  if (!manifest) throw new RelayError('NOT_PACKAGED');
  if (manifest.schemaVersion !== 1 || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files) || !Object.hasOwn(manifest.files, 'runtime/node.exe')) throw new RelayError('INSTALL_MODIFIED');
  const entries = [];
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (!/^[a-zA-Z0-9_.\/-]+$/.test(name) || name.startsWith('/') || name.split('/').some(x => !x || x === '.' || x === '..') || !/^[a-f0-9]{64}$/.test(hash)) throw new RelayError('INSTALL_MODIFIED');
    const file = await ownedPath(source, name.split('/'));
    const stat = await fs.lstat(file); if (!stat.isFile()) throw new RelayError('INSTALL_MODIFIED');
    const bytes = await fs.readFile(file); if (sha(bytes) !== hash) throw new RelayError('INSTALL_MODIFIED');
    entries.push([name, bytes]);
  }
  entries.push(['manifest.json', await fs.readFile(await ownedPath(source, ['manifest.json']))]);
  return entries;
}
export async function installPackage({ source = fileURLToPath(new URL('../', import.meta.url)), target = defaultInstallDirectory() }) {
  source = absoluteRoot(source); target = absoluteRoot(target);
  const entries = await verify(source);
  await ownedPath(target, []);
  try { await fs.mkdir(target); }
  catch (error) {
    if (error.code === 'EEXIST') throw new RelayError('INSTALL_EXISTS');
    if (error.code !== 'ENOENT') throw error;
    await fs.mkdir(path.dirname(target), { recursive: true });
    try { await fs.mkdir(target); } catch (other) { if (other.code === 'EEXIST') throw new RelayError('INSTALL_EXISTS'); throw other; }
  }
  // A copy failure leaves an inspectable incomplete directory; it never deletes a potentially modified tree.
  for (const [name, bytes] of entries) {
    const file = await ownedPath(target, name.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
  }
  await atomicJson(await ownedPath(target, ['.ai-relay-install.json']), { schemaVersion: 1, kind: 'ai-relay-preview', manifestSha256: sha(entries.find(([name]) => name === 'manifest.json')[1]) });
  return { state: 'installed', directory: target, messagesPreserved: true };
}

export async function uninstallPackage({ target }) {
  target = absoluteRoot(target);
  await ownedPath(target, []);
  const marker = await readJson(target, ['.ai-relay-install.json'], { corrupt: 'INSTALL_MODIFIED' });
  if (!marker || marker.schemaVersion !== 1 || marker.kind !== 'ai-relay-preview') throw new RelayError('NOT_INSTALLED');
  const entries = await verify(target);
  const manifest = entries.find(([name]) => name === 'manifest.json')[1];
  if (marker.manifestSha256 !== sha(manifest)) throw new RelayError('INSTALL_MODIFIED');
  if (inside(target, process.execPath)) throw new RelayError('INSTALL_IN_USE');
  if (process.platform === 'win32') {
    // No environment/token extraction. The machine query is fixed text; the selected directory is never shell-interpolated.
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"name = 'node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"], { windowsHide: true, maxBuffer: 1048576 });
    const records = stdout.trim() ? JSON.parse(stdout) : [], list = Array.isArray(records) ? records : [records];
    if (list.some(r => r.ProcessId !== process.pid && String(r.CommandLine ?? '').toLowerCase().includes(target.toLowerCase()))) throw new RelayError('INSTALL_IN_USE');
  }
  const expected = new Set([...entries.map(([name]) => name), '.ai-relay-install.json']);
  const allowedDirs = new Set(['']);
  for (const name of expected) {
    const parts = name.split('/'); parts.pop();
    while (parts.length) { allowedDirs.add(parts.join('/')); parts.pop(); }
  }
  const dirs = [];
  async function walk(relative) {
    const dir = await ownedPath(target, relative ? relative.split('/') : []); dirs.push(dir);
    for (const name of await fs.readdir(dir)) {
      const key = relative ? relative + '/' + name : name;
      const file = await ownedPath(target, key.split('/')); const stat = await fs.lstat(file);
      if (stat.isDirectory()) { if (!allowedDirs.has(key)) throw new RelayError('INSTALL_MODIFIED'); await walk(key); }
      else if (!stat.isFile() || !expected.has(key)) throw new RelayError('INSTALL_MODIFIED');
    }
  }
  await walk('');
  // Every absolute target was contained, enumerated and verified above. Never recursively remove arbitrary data.
  for (const name of expected) await fs.unlink(await ownedPath(target, name.split('/')));
  for (const dir of dirs.reverse()) await fs.rmdir(dir);
  return { state: 'uninstalled', directory: target, messagesPreserved: true };
}
