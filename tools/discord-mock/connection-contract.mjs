import {mockConfig,validateEvent,digest} from './policy.mjs';

const aliases=new Set(['claude','codex']);
const routeName=/^[a-z][a-z0-9-]{0,47}$/;
function plainData(value) {
  return value!==null&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).every(key=>typeof key==='string'&&Object.getOwnPropertyDescriptor(value,key).enumerable&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'));
}
function emptyDataArray(value) {
  return Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&Reflect.ownKeys(value).length===1&&Object.getOwnPropertyDescriptor(value,'length').value===0;
}

/** Produces a draft only. No runner, sender or discovery hook is accepted. */
export function planAssignment(snapshot,routes,nowMs) {
  const no=code=>({accepted:false,mode:'offline',code});
  if(!plainData(snapshot)||Object.keys(snapshot).length!==3||!['mode','agent','event'].every(k=>Object.hasOwn(snapshot,k))||snapshot.mode!=='offline'||typeof snapshot.agent!=='string'||!aliases.has(snapshot.agent)||!plainData(snapshot.event))return no('INVALID_ASSIGNMENT');
  if(typeof snapshot.event.created_at!=='string'||!emptyDataArray(snapshot.event.attachments)||!emptyDataArray(snapshot.event.mentions))return no('INVALID_ASSIGNMENT');
  if(!plainData(routes)||!Object.keys(routes).length||Object.keys(routes).length>2||Object.keys(routes).some(k=>!aliases.has(k)))return no('INVALID_ROUTES');
  const pinned={},names=new Set(),addresses=new Set();let policyDigest;
  try {
    for(const [alias,input] of Object.entries(routes)){
      if(!plainData(input)||!Object.hasOwn(input,'route_id')||!Object.hasOwn(input,'session_address'))return no('INVALID_ROUTES');
      const cfg=mockConfig(input);
      if(!routeName.test(cfg.route_id)||names.has(cfg.route_id)||addresses.has(cfg.session_address))return no('INVALID_ROUTES');
      names.add(cfg.route_id);addresses.add(cfg.session_address);
      const bound=digest({...cfg,route_id:'route',session_address:'session'});
      if(policyDigest!==undefined&&policyDigest!==bound)return no('ROUTE_POLICY_MISMATCH');
      policyDigest=bound;pinned[alias]=cfg;
    }
    if(!Object.hasOwn(pinned,snapshot.agent))return no('AGENT_NOT_CONFIGURED');
    const config=pinned[snapshot.agent],validated=validateEvent(snapshot.event,config,nowMs);
    if(!validated.accepted)return no(validated.code);
    return {accepted:true,mode:'offline',agent:snapshot.agent,config,
      event:structuredClone(snapshot.event),request:{route_id:config.route_id,session_address:config.session_address,envelope:structuredClone(validated.envelope)}};
  } catch {return no('INVALID_ROUTES');}
}
