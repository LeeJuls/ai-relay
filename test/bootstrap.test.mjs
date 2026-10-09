import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sandbox } from './fixture.mjs';

const exec = promisify(execFile);
const source = fileURLToPath(new URL('../', import.meta.url));
const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
const windowsOnly = { skip: process.platform !== 'win32' };
async function runPS(script) {
  script = "[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); $ProgressPreference='SilentlyContinue'; " + script;
  return exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 30000 });
}
async function fixture(t) {
  const { container } = await sandbox(t);
  const root = path.join(container, '한글 source');
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.copyFile(path.join(source, 'scripts', 'node-runtime.json'), path.join(root, 'scripts', 'node-runtime.json'));
  const prefix = `$ErrorActionPreference='Stop'; . ${psQuote(path.join(source, 'scripts', 'bootstrap-node.ps1'))}; $root=${psQuote(root)}; $messages=Get-Content -LiteralPath ${psQuote(path.join(source, 'locales', 'en.json'))} -Raw -Encoding UTF8 | ConvertFrom-Json; `;
  return { root, prefix };
}

test('bootstrap reuses compatible installed Node without creating a runtime folder', windowsOnly, async t => {
  const { root, prefix } = await fixture(t);
  const { stdout } = await runPS(prefix + `function Find-RelayInstalledNode { ${psQuote(process.execPath)} }; function Invoke-WebRequest { throw 'Unexpected download' }; Get-RelayNode -Root $root -Messages $messages`);
  assert.equal(stdout.trim(), process.execPath);
  await assert.rejects(fs.stat(path.join(root, 'runtime')), { code: 'ENOENT' });
});

test('bootstrap downloads a verified executable once and then reuses it', windowsOnly, async t => {
  const { root, prefix } = await fixture(t);
  const { stdout } = await runPS(prefix + `function Find-RelayInstalledNode { $null }; $script:downloads=0; function Invoke-WebRequest { param($Uri,$OutFile,$TimeoutSec,[switch]$UseBasicParsing,$ErrorAction) if($Uri -ne 'https://nodejs.org/download/release/v24.14.0/win-x64/node.exe'){throw 'Unexpected URL'}; $script:downloads++; Copy-Item -LiteralPath ${psQuote(process.execPath)} -Destination $OutFile }; $a=Get-RelayNode -Root $root -Messages $messages; $b=Get-RelayNode -Root $root -Messages $messages; @{first=$a;second=$b;downloads=$script:downloads} | ConvertTo-Json -Compress`);
  const result = JSON.parse(stdout);
  assert.equal(result.first, path.join(root, 'runtime', 'node.exe'));
  assert.equal(result.first, result.second); assert.equal(result.downloads, 1);
  assert.deepEqual((await fs.readdir(path.join(root, 'runtime'))).sort(), ['.download.lock', 'node.exe']);
});

test('bootstrap rejects a hash mismatch and a failed download without publishing a partial runtime', windowsOnly, async t => {
  const { root, prefix } = await fixture(t);
  const { stdout } = await runPS(prefix + `function Find-RelayInstalledNode { $null }; function Invoke-WebRequest { param($Uri,$OutFile,$TimeoutSec,[switch]$UseBasicParsing,$ErrorAction) [IO.File]::WriteAllText($OutFile,'bad executable') }; try { Get-RelayNode -Root $root -Messages $messages; throw 'Unexpected success' } catch { if($_.Exception.Message -notmatch '^BOOTSTRAP_HASH:'){throw}; }; function Invoke-WebRequest { throw 'Network unavailable' }; try { Get-RelayNode -Root $root -Messages $messages; throw 'Unexpected success' } catch { if($_.Exception.Message -notmatch '^BOOTSTRAP_FAILED:'){throw}; }; 'rejected'`);
  assert.equal(stdout.trim(), 'rejected');
  assert.deepEqual(await fs.readdir(path.join(root, 'runtime')), ['.download.lock']);
});

test('bootstrap refuses a corrupt existing local executable and preserves it', windowsOnly, async t => {
  const { root, prefix } = await fixture(t);
  await fs.mkdir(path.join(root, 'runtime')); await fs.writeFile(path.join(root, 'runtime', 'node.exe'), 'owner file');
  const { stdout } = await runPS(prefix + `function Invoke-WebRequest { throw 'Unexpected download' }; try { Get-RelayNode -Root $root -Messages $messages; throw 'Unexpected success' } catch { if($_.Exception.Message -notmatch '^BOOTSTRAP_HASH:'){throw}; }; 'rejected'`);
  assert.equal(stdout.trim(), 'rejected'); assert.equal(await fs.readFile(path.join(root, 'runtime', 'node.exe'), 'utf8'), 'owner file');
});

test('installed Node below the minimum or on a different major is not selected', windowsOnly, async t => {
  const { root, prefix } = await fixture(t);
  const stub = path.join(root, 'version.cmd');
  const result = [];
  for (const version of ['22.0.0', '24.0.0', '25.0.0', '24.14.0']) {
    await fs.writeFile(stub, `@echo off\r\necho v${version}\r\n`);
    const { stdout } = await runPS(prefix + `function Get-Command { @{Source=${psQuote(stub)}} }; $selected=Find-RelayInstalledNode; if($selected){'selected'}else{'missing'}`);
    result.push(stdout.trim());
  }
  assert.deepEqual(result, ['missing', 'missing', 'missing', 'selected']);
});

test('simultaneous first runs serialize downloads and both receive the verified runtime', windowsOnly, async t => {
  const { root, prefix } = await fixture(t);
  const count = path.join(root, 'downloads.txt');
  const script = prefix + `function Find-RelayInstalledNode { $null }; function Invoke-WebRequest { param($Uri,$OutFile,$TimeoutSec,[switch]$UseBasicParsing,$ErrorAction) [IO.File]::AppendAllText(${psQuote(count)},'download'); Start-Sleep -Milliseconds 800; Copy-Item -LiteralPath ${psQuote(process.execPath)} -Destination $OutFile }; Get-RelayNode -Root $root -Messages $messages`;
  const results = await Promise.all([runPS(script), runPS(script)]);
  for (const { stdout } of results) assert.equal(stdout.trim(), path.join(root, 'runtime', 'node.exe'));
  assert.equal(await fs.readFile(count, 'utf8'), 'download');
});

test('Windows launcher forwards Korean output, spaced arguments and CLI exit codes with no Node on PATH', windowsOnly, async t => {
  const { root } = await fixture(t);
  for (const relative of ['bin', 'lib', 'locales', 'scripts/bootstrap-node.ps1', 'relay.cmd']) {
    await fs.cp(path.join(source, relative), path.join(root, relative), { recursive: true });
  }
  await fs.mkdir(path.join(root, 'runtime')); await fs.copyFile(process.execPath, path.join(root, 'runtime', 'node.exe'));
  const data = path.join(root, 'data with spaces'); const body = path.join(root, '질문 file.txt');
  await fs.writeFile(body, '안녕하세요');
  const invoke = args => runPS(`$env:PATH=$env:SystemRoot+'\\System32'; & ${psQuote(path.join(root, 'relay.cmd'))} ${args.map(psQuote).join(' ')}; exit $LASTEXITCODE`);
  assert.match((await invoke(['help', '--lang', 'ko'])).stdout, /[가-힣]/);
  await invoke(['pair', '--root', data, '--codex', 'codex-demo', '--claude', 'claude-demo']);
  const sent = JSON.parse((await invoke(['send', '--root', data, '--as', 'codex-demo', '--body-file', body, '--task', '한글 task', '--wake'])).stdout);
  assert.ok(sent);
  const received = JSON.parse((await invoke(['inbox', '--root', data, '--as', 'claude-demo'])).stdout);
  assert.match(JSON.stringify(received), /한글 task/); assert.match(JSON.stringify(received), /안녕하세요/);
  await assert.rejects(invoke(['invalid-command']), error => error.code === 2);
});
