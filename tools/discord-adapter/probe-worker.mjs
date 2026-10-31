import fs from 'node:fs/promises';
import {subscriptionStatus,runWorker,probePrompt} from './worker.mjs';
import {loadLocalConfig} from './local-config.mjs';
const cwd=new URL('../../../.discord-worker/',import.meta.url);
try{
 const local=await loadLocalConfig(new URL('../../.discord.local.json',import.meta.url)),cli=local.claude_executable;
 await fs.mkdir(cwd,{recursive:true});await subscriptionStatus({cli,cwd});
 const result=await runWorker({cli,cwd,prompt:probePrompt});
 console.log(JSON.stringify({ok:true,tools:result.tools,mcp:result.mcp,expected_reply:result.text.trim()==='NO_TOOLS',usage:result.usage,process_ended:true}));
}catch(e){console.log(JSON.stringify({ok:false,code:/^WORKER_[A-Z_]+$/.test(e.code)?e.code:'WORKER_FAILED',process_ended:e.code!=='WORKER_PROCESS_UNCERTAIN'}));process.exitCode=1;}
