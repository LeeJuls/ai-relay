import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateRawSync, crc32 } from 'node:zlib';
import { absoluteRoot, ownedPath } from '../lib/storage.mjs';
import { RelayError } from '../lib/errors.mjs';

const SOURCE = fileURLToPath(new URL('../', import.meta.url));
const RUNTIME = JSON.parse(await fs.readFile(new URL('./node-runtime.json', import.meta.url), 'utf8'));
const NODE_HASH = RUNTIME.sha256;
const LICENSE_HASH = RUNTIME.licenseSha256;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ALLOW = ['bin', 'lib', 'locales', 'third-party', 'scripts/acceptance.mjs', 'scripts/bootstrap-node.ps1', 'scripts/node-runtime.json', 'relay.cmd', 'package.json', 'LICENSE', 'README.md', 'README.ko.md', 'README.ja.md', 'docs/usage.md', 'docs/usage.ko.md', 'PROVENANCE.md', 'SECURITY.md', 'SUPPORT.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'PREVIEW-CHECKLIST.md'];

// Fixed timestamps, sort order and compression level; ZIP32 only, no current path or wall-clock metadata.
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, bytes] of entries) {
    const filename = Buffer.from(name), compressed = deflateRawSync(bytes, { level: 9 });
    const crc = crc32(bytes), header = Buffer.alloc(30), record = Buffer.alloc(46), date = ((2026 - 1980) << 9) | (1 << 5) | 1;
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8); record.writeUInt16LE(8, 10); record.writeUInt16LE(date, 14);
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(compressed.length, 20); record.writeUInt32LE(bytes.length, 24); record.writeUInt16LE(filename.length, 28); record.writeUInt32LE(offset, 42);
    local.push(header, filename, compressed); central.push(record, filename); offset += header.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export async function buildPreview({ outDir, runtime }) {
  outDir = absoluteRoot(outDir);
  if (typeof runtime !== 'string' || !path.isAbsolute(runtime)) throw new RelayError('INVALID_ARGS');
  const node = await fs.readFile(runtime);
  if (sha(node) !== NODE_HASH) throw new RelayError('RUNTIME_HASH_MISMATCH');
  const license = await fs.readFile(path.join(SOURCE, 'third-party', 'NODE-LICENSE.txt'));
  if (sha(license) !== LICENSE_HASH) throw new RelayError('LICENSE_HASH_MISMATCH');
  const entries = [];
  async function visit(relative) {
    const file = await ownedPath(path.resolve(SOURCE), relative.split('/'));
    const stat = await fs.lstat(file);
    if (stat.isDirectory()) { for (const name of (await fs.readdir(file)).sort()) await visit(relative + '/' + name); }
    else if (stat.isFile()) {
      const bytes = await fs.readFile(file);
      if (/(?:[CD]:[\\/](?:Users[\\/]user|AI[\\/]Codex|Unity_Project|Project[\\/]survival))/i.test(bytes.toString('utf8'))) throw new RelayError('PRIVATE_PATH_IN_PACKAGE');
      entries.push([relative, bytes]);
    } else throw new RelayError('UNSAFE_PATH');
  }
  for (const item of ALLOW) await visit(item);
  entries.push(['runtime/node.exe', node]); entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const packageInfo = JSON.parse(await fs.readFile(path.join(SOURCE, 'package.json'), 'utf8'));
  const manifest = { schemaVersion: 1, version: packageInfo.version, platform: 'win-x64', privatePreview: false, license: packageInfo.license,
    runtime: { version: RUNTIME.version, source: RUNTIME.url, sha256: NODE_HASH },
    files: Object.fromEntries(entries.map(([name, bytes]) => [name, sha(bytes)])) };
  entries.push(['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')]); entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const bytes = zip(entries), filename = `ai-relay-${packageInfo.version}-win-x64.zip`;
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, filename); await fs.writeFile(file, bytes, { flag: 'wx' });
  const sha256 = sha(bytes); await fs.writeFile(file + '.sha256', sha256 + '  ' + filename + '\n', { flag: 'wx' });
  return { file, sha256, bytes: bytes.length, entries: entries.map(([name]) => name) };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await buildPreview({ outDir: process.argv[2], runtime: process.argv[3] }))); }
  catch (error) { console.error(JSON.stringify({ code: error.code ?? 'IO_ERROR' })); process.exitCode = 2; }
}
