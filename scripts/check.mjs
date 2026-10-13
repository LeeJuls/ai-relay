import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
let checked = 0;
async function scan(folder){for(const entry of await fs.readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())await scan(file);else if(entry.isFile()&&entry.name.endsWith('.mjs')){execFileSync(process.execPath,['--check',file],{stdio:'pipe',windowsHide:true});checked++;}}}
for(const folder of ['bin','lib','scripts','tools'])await scan(path.join(root,folder));
const en = JSON.parse(await fs.readFile(path.join(root, 'locales', 'en.json'))), ko = JSON.parse(await fs.readFile(path.join(root, 'locales', 'ko.json')));
if (JSON.stringify(Object.keys(en).sort()) !== JSON.stringify(Object.keys(ko).sort())) throw Error('LOCALE_KEY_MISMATCH');
console.log(JSON.stringify({ syntaxErrors: 0, modulesChecked: checked, localeKeys: Object.keys(en).length }));
