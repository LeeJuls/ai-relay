#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import {accumulator} from './reader.mjs';
const args=process.argv.slice(2),file=args.shift(),options={};
try{
 for(let i=0;i<args.length;i++){const key=args[i];if(key==='--json'){if(options.json)throw Error('Duplicate option');options.json=true;continue;}
  if(!['--since','--until','--provider'].includes(key)||options[key.slice(2)]!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw Error('Invalid options');options[key.slice(2)]=args[++i];}
 if(!file)throw Error('Usage: node tools/turn-cost/report.mjs <transcript.jsonl|folder> --since ISO --until ISO [--provider claude|codex] [--json]');
 const a=accumulator(options),target=path.resolve(file),stat=await fsp.lstat(target);if(stat.isSymbolicLink())throw Error('Use an ordinary local transcript file or folder.');
 const files=stat.isDirectory()?(await fsp.readdir(target)).filter(n=>n.endsWith('.jsonl')).sort().map(n=>path.join(target,n)):[target];
 let malformed=0;
 for(const source of files){const st=await fsp.lstat(source);if(st.isSymbolicLink()||!st.isFile())throw Error('Invalid transcript source');
  a.startSource(source);
  const rows=readline.createInterface({input:fs.createReadStream(source,{encoding:'utf8'}),crlfDelay:Infinity});
  for await(const line of rows){if(!line.trim())continue;let row;try{row=JSON.parse(line);}catch{malformed++;continue;}a.push(row);}
 }
 const result={...a.report(),sourceFiles:files.length,malformedRows:malformed};
 console.log(options.json?JSON.stringify(result):JSON.stringify(result,null,2));
}catch(e){console.error('turn-cost: '+(e.code??e.message));process.exitCode=2;}
