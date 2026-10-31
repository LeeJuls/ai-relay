import {RelayError} from '../../lib/errors.mjs';

const keys=['mode','server_id','ai_channel_id','human_channel_ids','owner_id','pc_label','session_labels','readonly_plan'];
const aliases=new Set(['claude','codex']);
function plainData(value) {
  return value!==null&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).every(key=>typeof key==='string'&&Object.getOwnPropertyDescriptor(value,key).enumerable&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'));
}
function text(value,max,nullable=false){return nullable&&value===null||typeof value==='string'&&value.isWellFormed()&&value.length<=max;}
function channelData(value) {
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)return null;
  const length=Object.getOwnPropertyDescriptor(value,'length')?.value;
  if(!Number.isSafeInteger(length)||length<0||length>32||Reflect.ownKeys(value).length!==length+1)return null;
  const result=[];
  for(let i=0;i<length;i++){
    const field=Object.getOwnPropertyDescriptor(value,String(i));
    if(!field||!field.enumerable||!Object.hasOwn(field,'value')||!text(field.value,128)||!field.value.trim())return null;
    result.push(field.value);
  }
  return result;
}

/** Advisory data validation only: it cannot attest permissions or authorize effects. */
export function inspectOfflineSetup(input) {
  const invalid=()=>{throw new RelayError('INVALID_PREFLIGHT');};
  if(!plainData(input)||Object.keys(input).length!==keys.length||keys.some(k=>!Object.hasOwn(input,k))||input.mode!=='offline')invalid();
  for(const key of ['server_id','ai_channel_id','owner_id','pc_label'])if(!text(input[key],128,true))invalid();
  const channels=channelData(input.human_channel_ids);
  if(channels===null||new Set(channels).size!==channels.length||channels.includes(input.ai_channel_id))invalid();
  if(!plainData(input.session_labels)||!plainData(input.readonly_plan)||Object.keys(input.session_labels).length>2)invalid();
  for(const [alias,label]of Object.entries(input.session_labels))if(!aliases.has(alias)||!text(label,128))invalid();
  for(const [alias,plan]of Object.entries(input.readonly_plan))if(!Object.hasOwn(input.session_labels,alias)||!text(plan,300))invalid();
  const missing_inputs=[];
  for(const key of ['server_id','ai_channel_id','human_channel_ids','owner_id','pc_label','session_labels']){
    if(key==='human_channel_ids'){if(!channels.length)missing_inputs.push(key);}
    else if(key==='session_labels'){if(!Object.keys(input[key]).length)missing_inputs.push(key);}
    else if(input[key]===null||!input[key].trim())missing_inputs.push(key);
  }
  for(const alias of ['claude','codex'])if(Object.hasOwn(input.session_labels,alias)){
    if(!input.session_labels[alias].trim())missing_inputs.push('session_labels.'+alias);
    if(!input.readonly_plan[alias]?.trim())missing_inputs.push('readonly_plan.'+alias);
  }
  return {mode:'offline',input_complete:missing_inputs.length===0,live_ready:false,missing_inputs,
    unverified_checks:['effective_human_channel_view_denial','enforced_readonly_and_result_callback','session_identity_and_route_ownership','live_dispatch_and_publish_receipts'],
    approvals_needed:['bot_creation','oauth_install','credential_configuration','persistent_session_registration','live_adapter_execution','live_send'],actual_tokens:null};
}
