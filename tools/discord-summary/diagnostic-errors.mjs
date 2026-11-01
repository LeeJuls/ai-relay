import fs from 'node:fs/promises';
const records=new WeakMap();
const stages=new Set(['credential','identity','guild','member','channels','validation','unknown']);
const codes=new Set(['CREDENTIAL_FILE_MISSING','CREDENTIAL_READ_DENIED','CREDENTIAL_READ_FAILED','CREDENTIAL_KEY_MISSING','CREDENTIAL_EMPTY','CREDENTIAL_FORMAT','NETWORK_ERROR','HTTP_ERROR','TIMEOUT','REDIRECT','RESPONSE_INVALID','RESPONSE_TOO_LARGE','IDENTITY_MISMATCH','METADATA_INVALID','DIAGNOSTIC_FAILED']);
const networks=new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','EACCES','EPERM','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_SOCKET','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT']);
export function diagnosticError(code,stage,extra={}){
 const error=new Error('DIAGNOSTIC_FAILED'),record={code:codes.has(code)?code:'DIAGNOSTIC_FAILED',stage:stages.has(stage)?stage:'unknown'};
 if(Number.isInteger(extra.http_status)&&extra.http_status>=100&&extra.http_status<=599)record.http_status=extra.http_status;
 if(Number.isInteger(extra.discord_code)&&extra.discord_code>=0&&extra.discord_code<=999999999)record.discord_code=extra.discord_code;
 if(extra.network_code!==undefined)record.network_code=networks.has(extra.network_code)?extra.network_code:'OTHER';
 records.set(error,Object.freeze(record));return error;
}
export function safeFailure(error){return {...records.get(error)??{code:'DIAGNOSTIC_FAILED',stage:'unknown'}};}
export function knownFailure(error){return records.has(error);}
export async function loadDiagnosticCredential(file,{readFile=fs.readFile}={}){
 let text;
 try{text=await readFile(file,'utf8');}
 catch(e){throw diagnosticError(e?.code==='ENOENT'?'CREDENTIAL_FILE_MISSING':['EACCES','EPERM'].includes(e?.code)?'CREDENTIAL_READ_DENIED':'CREDENTIAL_READ_FAILED','credential');}
 const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(s=>s.trim()&&!s.trim().startsWith('#'));
 const tokens=lines.filter(s=>s.trim().startsWith('DISCORD_BOT_TOKEN='));
 if(!tokens.length)throw diagnosticError('CREDENTIAL_KEY_MISSING','credential');
 if(tokens.length===1&&!tokens[0].trim().slice('DISCORD_BOT_TOKEN='.length))throw diagnosticError('CREDENTIAL_EMPTY','credential');
 const match=lines.length===1&&/^DISCORD_BOT_TOKEN=([-A-Za-z0-9._]{20,256})$/.exec(lines[0].trim());
 if(!match||match[1].includes('PLACEHOLDER'))throw diagnosticError('CREDENTIAL_FORMAT','credential');
 const value='Bot '+match[1];return ()=>value;
}
