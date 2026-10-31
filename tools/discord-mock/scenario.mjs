import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mockConfig} from './policy.mjs';
import {openMockStore} from './store.mjs';
import {openMockBridge} from './bridge.mjs';
import {fakeClock,fakeDiscord,fakeSession,fakePublisher} from './fakes.mjs';

export async function runMockScenario({root}) {
  const clock=fakeClock(Date.parse('2026-10-31T00:00:00.000Z')),config=mockConfig();
  const store=await openMockStore({root,config,now:clock.now}),session=fakeSession(),publisher=fakePublisher();
  const open=()=>openMockBridge({store,config,session,publisher,now:clock.now}),bridge=await open();
  for(let n=0;n<100;n++)await bridge.tick();const idle_dispatches=session.calls.length;
  await bridge.ingest(fakeDiscord({channel_id:'mock-human'}));await bridge.tick();const blocked_dispatches=session.calls.length-idle_dispatches;
  const event=fakeDiscord(),task=await bridge.ingest(event);await bridge.tick();
  await bridge.submitResult({task_id:task.task_id,result_text:'explicit mock answer'});await bridge.tick();
  const next=await open();await next.ingest(event);await next.tick();
  return {...await next.status(),idle_dispatches,blocked_dispatches,fake_dispatches:session.calls.length,fake_publishes:publisher.calls.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==4||process.argv[2]!=='--root')throw Object.assign(Error(),{code:'MOCK_ROOT_REQUIRED'});
    process.stdout.write(JSON.stringify(await runMockScenario({root:process.argv[3]}))+'\n');
  }catch(error){process.stderr.write(JSON.stringify({mode:'mock',error:/^[A-Z_]+$/.test(error.code??'')?error.code:'MOCK_FAILED'})+'\n');process.exitCode=2;}
}
