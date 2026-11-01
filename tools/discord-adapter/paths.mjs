import {fileURLToPath} from 'node:url';
export function runtimePaths(provider){
 if(!['claude','codex'].includes(provider))throw new Error('RUNTIME_PROVIDER_REQUIRED');
 const base=new URL(`../../runtime/bots/${provider}/`,import.meta.url);
 return Object.freeze({worker:fileURLToPath(new URL('worker',base)),relay_ledger:fileURLToPath(new URL('relay-ledger',base)),summary_ledger:fileURLToPath(new URL('summary-ledger',base))});
}