import {openAdapterRuntime} from './runtime.mjs';
import {adapterConfig} from './interaction.mjs';
import {commandDefinitionFor} from './live-transport.mjs';
import {RelayError} from '../../lib/errors.mjs';
export function parseLaunchArgs(argv){if(argv.length===1&&['--auth','--prepare'].includes(argv[0]))return {mode:argv[0]};if(argv.length===3&&argv[0]==='--start'&&argv[1]==='--trial-id'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(argv[2]))return {mode:'--start',trial_id:argv[2]};throw new RelayError('LIVE_LAUNCH_ARGS');}
const unavailable=async()=>{throw new RelayError('PREPARATION_NO_TRANSPORT');};
const summary=(trial,cfg)=>({state:'prepared',trial_id:trial.id,expires_at:trial.expires_at,command:cfg.command,option:'text',window_ms:180000,max_requests:2,baseline_completed:trial.baseline_completed});
async function localRuntime({root,config,now=Date.now}){return openAdapterRuntime({root,config,now,recover:false,session:{dispatch:unavailable},publisher:{publish:unavailable}});}
export async function prepareLiveTrial(input){const cfg=adapterConfig(input.config),runtime=await localRuntime({...input,config:cfg});try{return summary(await runtime.prepareBoundedTrial(),cfg);}finally{await runtime.close();}}
export async function inspectLivePreparation(input){const cfg=adapterConfig(input.config),runtime=await localRuntime({...input,config:cfg});try{return summary(await runtime.assertPreparedTrial(input.trial_id),cfg);}finally{await runtime.close();}}
export function validateRegisteredCommand(c,config){
 try{
  const target=adapterConfig(config),definition=commandDefinitionFor(target);
  if(c.id!==target.command_id||c.application_id!==target.application_id||c.guild_id!==target.guild_id||c.type!==1||c.name!==definition.name||c.default_member_permissions!=='0'||!Array.isArray(c.options)||c.options.length!==1)throw Error();
  const option=c.options[0],expected=definition.options[0];if(Object.keys(expected).some(key=>option[key]!==expected[key]))throw Error();
  for(const key of Object.keys(option))if(!Object.hasOwn(expected,key)&&!(key==='autocomplete'&&option[key]===false)&&!(['name_localizations','description_localizations'].includes(key)&&option[key]===null))throw Error();
  return c.id;
 }catch{throw new RelayError('LIVE_COMMAND_MISMATCH');}
}
