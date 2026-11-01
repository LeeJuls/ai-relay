// One-shot diagnostic; private targets stay in an ignored operator configuration.
import {loadSummaryBindings} from './local-bindings.mjs';
import {loadDiagnosticCredential,safeFailure} from './diagnostic-errors.mjs';
import {diagnoseBot} from './diagnostic.mjs';
if(process.argv.length!==3||process.argv[2]!=='--verify'){
 console.log(JSON.stringify({event:'diagnostic',ok:false,code:'EXPLICIT_VERIFY_REQUIRED'}));process.exitCode=1;
}else{
 let bindings;
 try{bindings=await loadSummaryBindings(new URL('../../.discord.summary.local.json',import.meta.url));}
 catch{console.log(JSON.stringify({event:'diagnostic',ok:false,code:'SUMMARY_BINDING_REQUIRED'}));process.exitCode=1;}
 if(bindings)for(const provider of ['claude','codex']){
  try{
   const file=provider==='claude'?'../../.env.discord.local':'../../.env.discord.codex.local';
   const result=await diagnoseBot({guild_id:bindings.guild_id,channel_id:bindings.channel_id,required_denied_ids:bindings.denied_channels,bot_id:bindings.sources[provider].bot_id,authorization:await loadDiagnosticCredential(new URL(file,import.meta.url)),fetchImpl:fetch});
   console.log(JSON.stringify({event:'diagnostic',provider,ok:true,...result}));if(!result.isolated)process.exitCode=1;
  }catch(e){console.log(JSON.stringify({event:'diagnostic',provider,ok:false,...safeFailure(e)}));process.exitCode=1;}
 }
}