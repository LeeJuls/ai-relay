import fs from 'node:fs/promises';
import path from 'node:path';
import {adapterConfig} from './interaction.mjs';
import {RelayError} from '../../lib/errors.mjs';
export function nativeClaudeExecutable(value){return typeof value==='string'&&!value.includes('\0')&&(path.isAbsolute(value)||path.win32.isAbsolute(value))&&['claude','claude.exe'].includes(path.win32.basename(value));}
export function validateLocalConfig(input){
 try{if(!input||Object.keys(input).sort().join(',')!=='adapter,claude_executable'||!nativeClaudeExecutable(input.claude_executable))throw Error();return Object.freeze({adapter:adapterConfig(input.adapter),claude_executable:input.claude_executable});}catch{throw new RelayError('LOCAL_CONFIG_INVALID');}
}
export async function loadLocalConfig(filename){try{return validateLocalConfig(JSON.parse(await fs.readFile(filename,'utf8')));}catch{throw new RelayError('LOCAL_CONFIG_INVALID');}}
