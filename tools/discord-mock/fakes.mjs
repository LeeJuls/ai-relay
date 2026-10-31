export function fakeDiscord(overrides={}) {
  return {event_id:'mock-event',guild_id:'mock-guild',channel_id:'mock-ai',owner_id:'mock-owner',command:'ask',text:'mock question',created_at:'2026-10-31T00:00:00.000Z',author_bot:false,webhook_id:null,thread_id:null,attachments:[],mentions:[],...overrides};
}
function effect(method,outcomes=[]) {
  const pending=[...outcomes],calls=[];
  return {calls,[method]:async request=>{
    calls.push(structuredClone(request));const next=pending.length?pending.shift():{state:'accepted',code:'FAKE_ACCEPTED'};
    if(next instanceof Error)throw next;
    return typeof next==='function'?next(request):structuredClone(next);
  }};
}
export const fakeSession=outcomes=>effect('dispatch',outcomes);
export const fakePublisher=outcomes=>effect('publish',outcomes);
export function fakeClock(startMs) {
  let value=startMs;
  if(!Number.isSafeInteger(value)||value<0)throw Error('MOCK_CLOCK');
  return {now:()=>value,advance(ms){if(!Number.isSafeInteger(ms)||ms<0||!Number.isSafeInteger(value+ms))throw Error('MOCK_CLOCK');value+=ms;}};
}
