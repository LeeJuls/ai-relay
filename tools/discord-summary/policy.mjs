import {createHash} from 'node:crypto';
import en from '../../locales/en.json' with {type:'json'};
import ko from '../../locales/ko.json' with {type:'json'};
import ja from '../../locales/ja.json' with {type:'json'};

export function fail(code='SUMMARY_INVALID'){throw new Error(code);}
export function snapshot(value){
 if(value===null||['string','boolean'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value))return value;
 if(typeof value!=='object'||!(Array.isArray(value)?Object.getPrototypeOf(value)===Array.prototype:[Object.prototype,null].includes(Object.getPrototypeOf(value))))fail();
 const descriptors=Object.getOwnPropertyDescriptors(value);
 for(const [key,d]of Object.entries(descriptors))if(!(Array.isArray(value)&&key==='length')&&(!d.enumerable||!Object.hasOwn(d,'value')))fail();
 if(Object.getOwnPropertySymbols(value).length)fail();
 if(Array.isArray(value)){const out=[];if(Object.keys(value).length!==value.length)fail();for(let i=0;i<value.length;i++){const d=descriptors[String(i)];if(!d||!Object.hasOwn(d,'value'))fail();out.push(snapshot(d.value));}return out;}
 return Object.fromEntries(Object.keys(value).map(k=>[k,snapshot(descriptors[k].value)]));
}
function canonical(v){return v&&typeof v==='object'?(Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]))):v;}
export const digest=v=>createHash('sha256').update(JSON.stringify(canonical(snapshot(v)))).digest('hex');
export function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function keys(v,list){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==list.split(',').sort().join(','))fail();}
const id=v=>typeof v==='string'&&/^[0-9]{17,20}$/.test(v);
const ref=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function snapshotBindings(input){
 const b=snapshot(input);keys(b,'trial_id,guild_id,channel_id,owner_id,denied_channels,sources');
 if(!ref(b.trial_id)||![b.guild_id,b.channel_id,b.owner_id].every(id)||!Array.isArray(b.denied_channels)||!b.denied_channels.length||!b.denied_channels.every(id)||b.denied_channels.includes(b.channel_id))fail();
 keys(b.sources,'claude,codex');
 for(const slot of ['claude','codex']){const s=b.sources[slot];keys(s,'source_session_ref,provider,bot_id,display_name,provenance');if(!ref(s.source_session_ref)||s.provider!==slot||!id(s.bot_id)||s.display_name!==`준영-${slot}`||s.provenance!==(slot==='claude'?'user_forwarded':'current_task_authored'))fail();}
 if(b.sources.claude.bot_id===b.sources.codex.bot_id||b.sources.claude.source_session_ref===b.sources.codex.source_session_ref)fail();
 return freeze(b);
}
const blocked=/(?:@everyone|@here|<[@#][^>]*>|\b(?:authorization|discord_token|bot_token|api_key)\s*[:=]|\b(?:sk-(?:proj-)?[a-z0-9_-]{8,}|mfa\.[a-z0-9_-]+)|\b[a-z0-9_-]{20,}\.[a-z0-9_-]{6,}\.[a-z0-9_-]{20,}|[a-z]:[\\/]|\\\\[^\s\\]+\\|\/(?:home|Users|root|tmp|private|mnt)\/)/i;
export function prepareSummary({bindings,draft,locale}){
 const b=snapshotBindings(bindings),d=snapshot(draft);keys(d,'slot,revision,authored_at,sections');
 if(!['claude','codex'].includes(d.slot)||!ref(d.revision)||!time(d.authored_at)||!['en','ko','ja'].includes(locale))fail();
 keys(d.sections,'completed,verified,unverified,next');
 if(!Object.values(d.sections).every(x=>typeof x==='string'&&x.trim()&&x.length<=1800&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(x)))fail();
 const s=b.sources[d.slot],c={en,ko,ja}[locale];
 const content=[`${s.display_name} | ${s.provenance} | ${d.authored_at}`,c.summary_as_of,...['completed','verified','unverified','next'].map(k=>`${c['summary_'+k]}: ${d.sections[k]}`)].join('\n');
 if(content.length>1800||Buffer.byteLength(content,'utf8')>4096)fail('SUMMARY_TOO_LARGE');
 if(blocked.test(content))fail('SUMMARY_REVIEW_REQUIRED');
 const content_digest=digest(content),base={slot:d.slot,provider:s.provider,source_session_ref:s.source_session_ref,bot_id:s.bot_id,guild_id:b.guild_id,channel_id:b.channel_id,provenance:s.provenance,revision:d.revision,content_digest};
 const summary_id=digest(base);
 return freeze({...base,summary_id,nonce:summary_id.slice(0,24),dedup_key:digest([s.bot_id,b.channel_id,content_digest]),content,locale,draft:d});
}
export function validateApproval({expectedManifest,bindings,summaries,now}){
 const b=snapshotBindings(bindings),m=snapshot(expectedManifest),ss=snapshot(summaries);keys(m,'schema_version,trial_id,batch_id,approval_ref,approved_at,expires_at,bindings_digest,entries');
 if(m.schema_version!==1||m.trial_id!==b.trial_id||![m.batch_id,m.approval_ref].every(ref)||m.bindings_digest!==digest(b)||!time(m.approved_at)||!time(m.expires_at)||!Number.isFinite(now)||Date.parse(m.approved_at)>now||Date.parse(m.expires_at)<=now||Date.parse(m.expires_at)-Date.parse(m.approved_at)>900000||!Array.isArray(ss)||ss.length!==2||!Array.isArray(m.entries)||m.entries.length!==2)fail('SUMMARY_APPROVAL_REQUIRED');
 for(const [i,slot]of ['claude','codex'].entries()){
  const s=ss[i],e=m.entries[i];keys(e,'slot,summary_id,revision,content_digest');
  if(!s||s.slot!==slot||digest(prepareSummary({bindings:b,draft:s.draft,locale:s.locale}))!==digest(s)||digest(e)!==digest({slot,summary_id:s.summary_id,revision:s.revision,content_digest:s.content_digest}))fail('SUMMARY_APPROVAL_MISMATCH');
 }
 return freeze({bindings:b,manifest:m,summaries:ss});
}
