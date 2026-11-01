// No credential or network access without the explicit publish action AND a valid
// owner-approved, unexpired manifest file. This entry point is not run for preview.
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {loadSummaryBindings} from './local-bindings.mjs';
import {loadDiagnosticCredential,safeFailure} from './diagnostic-errors.mjs';
import {diagnoseBot} from './diagnostic.mjs';
import {runApprovedSummaries} from './approved-host.mjs';
const counts={get:0,post:0};
const measuredFetch=(url,init)=>{if(init.method==='GET')counts.get++;else if(init.method==='POST')counts.post++;return fetch(url,init);};
if(process.argv.length!==3||process.argv[2]!=='--publish'){
 console.log(JSON.stringify({event:'summary',ok:false,code:'EXPLICIT_PUBLISH_REQUIRED'}));process.exitCode=1;
}else{
 try{
  const approved=JSON.parse(await fs.readFile(new URL('../../runtime/summary-review/approved.json',import.meta.url),'utf8'));
  const expectedBindings=await loadSummaryBindings(new URL('../../.discord.summary.local.json',import.meta.url));
  const load=file=>async()=>(await loadDiagnosticCredential(new URL(file,import.meta.url)))();
  const result=await runApprovedSummaries({root:fileURLToPath(new URL('../../runtime/summary-sharing',import.meta.url)),approved,expectedBindings,authorizations:{claude:load('../../.env.discord.local'),codex:load('../../.env.discord.codex.local')},permissionCheck:diagnoseBot,fetchImpl:measuredFetch,now:Date.now});
  console.log(JSON.stringify({event:'summary',ok:result.counts.accepted===2,state:result.state,counts:result.counts,get_calls:counts.get,post_calls:counts.post}));if(result.counts.accepted!==2)process.exitCode=1;
 }catch(e){console.log(JSON.stringify({event:'summary',ok:false,...safeFailure(e),get_calls:counts.get,post_calls:counts.post}));process.exitCode=1;}
}