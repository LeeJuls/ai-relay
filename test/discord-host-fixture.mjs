export const config={application_id:'111111111111111111',command_id:'222222222222222222',guild_id:'333333333333333333',channel_id:'444444444444444444',owner_id:'555555555555555555',human_channel_ids:['666666666666666666'],command:'ask',session_address:'readonly-claude',route_id:'discord-test'};
export const epoch=Date.UTC(2026,9,31);
export function command(at=epoch,index=0){return {op:0,t:'INTERACTION_CREATE',s:2+index,d:{id:(((BigInt(at)-1420070400000n)<<22n)+BigInt(index)).toString(),application_id:config.application_id,type:2,guild_id:config.guild_id,channel_id:config.channel_id,channel:{id:config.channel_id,type:0},member:{user:{id:config.owner_id}},data:{id:config.command_id,name:'ask',type:1,options:[{name:'text',type:3,value:'short question'}]},token:'FAKE_OFFLINE_INTERACTION'}};}
export const hello=()=>({op:10,d:{heartbeat_interval:1000}});
export const ready=()=>({op:0,t:'READY',s:1,d:{v:10,application:{id:config.application_id},user:{id:config.application_id,bot:true},session_id:'FAKE_SESSION',resume_gateway_url:'wss://gateway.discord.gg'}});
export function harness(){let at=epoch,next=0;const tasks=new Map(),sockets=[];
 const timers={set(fn,delay){const id=++next;tasks.set(id,{fn,at:at+delay});return id;},clear:id=>tasks.delete(id)};
 return {now:()=>at,timers,tasks,sockets,async advance(ms){const end=at+ms;let budget=1000;for(;;){const pair=[...tasks].filter(([,x])=>x.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!pair)break;if(--budget<0)throw Error('fake timer loop');tasks.delete(pair[0]);at=pair[1].at;await pair[1].fn();}at=end;},
  socketFactory(url){const handlers=new Map();const socket={url,sent:[],closed:[],addEventListener(type,fn){handlers.set(type,fn);},send(raw){this.sent.push(JSON.parse(raw));},close(code){this.closed.push(code);},emit(packet){return handlers.get('message')?.({data:typeof packet==='string'?packet:JSON.stringify(packet)});},disconnect(code=1006){return handlers.get('close')?.({code});}};sockets.push(socket);return socket;},
  discover:async()=>({url:'wss://gateway.discord.gg',shards:1,session_start_limit:{remaining:10,max_concurrency:1,reset_after:10000}}),authorization:async()=> 'Bot OFFLINE_ONLY',jitter:()=>0.5};
}
