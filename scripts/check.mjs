import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
let checked = 0;
for (const folder of ['bin', 'lib', 'scripts']) {
  for (const name of await fs.readdir(path.join(root, folder))) {
    if (!name.endsWith('.mjs')) continue;
    execFileSync(process.execPath, ['--check', path.join(root, folder, name)], { stdio: 'pipe', windowsHide: true }); checked++;
  }
}
const en = JSON.parse(await fs.readFile(path.join(root, 'locales', 'en.json'))), ko = JSON.parse(await fs.readFile(path.join(root, 'locales', 'ko.json')));
if (JSON.stringify(Object.keys(en).sort()) !== JSON.stringify(Object.keys(ko).sort())) throw Error('LOCALE_KEY_MISMATCH');
console.log(JSON.stringify({ syntaxErrors: 0, modulesChecked: checked, localeKeys: Object.keys(en).length }));
