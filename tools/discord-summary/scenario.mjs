import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {snapshotBindings,prepareSummary,digest} from './policy.mjs';
import {createSummaryPublisher} from './publisher.mjs';
import {openSummaryBatch} from './batch.mjs';

// Deliberately fake-only. No environment, token loader, live worker or fetch.
export async function runScenario(root){
 const instant=Date.parse('2030-01-01T00:00:00.000Z'),now=()=>instant;
 const bindings=snapshotBindings({trial_id:'fake-summary-trial',guild_id:'111111111111111111',channel_id:'222222222222222222',owner_id:'333333333333333333',denied_channels:['444444444444444444'],sources:{claude:{source_session_ref:'fake-claude',provider:'claude',bot_id:'555555555555555555',display_name:'준영-claude',provenance:'user_forwarded'},codex:{source_session_ref:'fake-codex',provider:'codex',bot_id:'666666666666666666',display_name:'준영-codex',provenance:'current_task_authored'}}});
 const summaries=['claude','codex'].map(slot=>prepareSummary({bindings,locale:'en',draft:{slot,revision:'fake-r1',authored_at:new Date(instant).toISOString(),sections:{completed:'Synthetic summary.',verified:'Offline fixture only.',unverified:'No live verification.',next:'Owner review before any live preparation.'}}}));
 const expectedManifest={schema_version:1,trial_id:bindings.trial_id,batch_id:'fake-batch',approval_ref:'fake-owner-preview',approved_at:new Date(instant).toISOString(),expires_at:new Date(instant+900000).toISOString(),bindings_digest:digest(bindings),entries:summaries.map(s=>({slot:s.slot,summary_id:s.summary_id,revision:s.revision,content_digest:s.content_digest}))};
 const botClients=Object.fromEntries(['claude','codex'].map(slot=>[slot,{verifyIdentity:async()=>({id:bindings.sources[slot].bot_id,bot:true}),request:async r=>({status:200,body:{id:slot==='claude'?'777777777777777777':'888888888888888888',channel_id:bindings.channel_id,nonce:r.body.nonce}}),close:async()=>{}}]));
 const publisher=createSummaryPublisher({expectedManifest,bindings,summaries,botClients,now});
 const batch=await openSummaryBatch({root,expectedManifest,bindings,summaries,publisher,now});
 const result=await batch.run();return {transport:'fake_only',state:result.state,counts:result.counts};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{if(process.argv.length!==4||process.argv[2]!=='--root'||!path.isAbsolute(process.argv[3]))throw Error();console.log(JSON.stringify(await runScenario(process.argv[3])));}
 catch{console.error('SUMMARY_SCENARIO_FAILED');process.exitCode=1;}
}
