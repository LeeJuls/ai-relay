// Local usage accounting only; reports never contain transcript message bodies.
function textOf(value){if(typeof value==='string')return value;if(Array.isArray(value))return value.map(x=>x?.text??'').join('\n');return '';}
function classify(text){
 const tags=[...text.matchAll(/\[(?:peer\s+(codex|claude)[^\]]*|cx\s+#[^\]]+|cl\s+#[^\]]+)\]/g)];
 const cx=tags.some(x=>x[1]==='codex'||x[0].startsWith('[cx ')),cl=tags.some(x=>x[1]==='claude'||x[0].startsWith('[cl '));
 return {trigger:cx?'codex_mail':cl?'claude_mail':/another.*session sent a message/i.test(text)?'session_message':/notification|agent.*completed/i.test(text)?'notification':'owner',mailCount:tags.length,handoverCandidate:/\b(slot|unity|handover|hand.?off|give.*window)\b/i.test(text)};
}
const numeric=x=>Number.isSafeInteger(x)&&x>=0?x:0;
export function accumulator({since,until,provider='claude'}={}){
 const lower=Date.parse(since),upper=Date.parse(until);
 if(!since||!until||!Number.isFinite(lower)||!Number.isFinite(upper)||lower>=upper||!['claude','codex'].includes(provider))throw Error('Provide --since and --until ISO timestamps, since < until; provider claude|codex.');
 const turns=[],seen=new Set();let current=null,skippedRows=0,missingUsage=0,source='default';
 const start=(text,time)=>{current={startedAt:time,...classify(text),calls:0,input:0,cacheRead:0,cacheWrite:0,output:0,partial:Date.parse(time)<lower};turns.push(current);};
 const add=(usage,time,key)=>{
  if(!current)return;const at=Date.parse(time);if(!Number.isFinite(at)||at<lower||at>=upper)return;
  if(!usage){missingUsage++;return;}if(key&&seen.has(key))return;if(key)seen.add(key);
  const cacheRead=numeric(provider==='codex'?usage.cached_input_tokens:usage.cache_read_input_tokens);
  current.calls++;current.input+=provider==='codex'?Math.max(0,numeric(usage.input_tokens)-cacheRead):numeric(usage.input_tokens);
  current.cacheRead+=cacheRead;current.cacheWrite+=numeric(usage.cache_creation_input_tokens);current.output+=numeric(usage.output_tokens);
 };
 return {
  startSource(key){current=null;source=key;},
  push(row){
   if(!row||typeof row!=='object'){skippedRows++;return;}
   const time=row.timestamp;if(!Number.isFinite(Date.parse(time))){skippedRows++;return;}
   if(provider==='claude'){
    if(row.type==='user'||row.message?.role==='user'){
      const content=row.message?.content,toolResult=Array.isArray(content)&&content.length>0&&content.every(x=>x?.type==='tool_result');
      if(!toolResult)start(textOf(content),time);
    }
    else if(row.type==='assistant'||row.message?.role==='assistant')add(row.message?.usage,time,row.message?.id?`claude:${row.message.id}`:null);
   }else if(row.type==='event_msg'){
    const p=row.payload??{};
    if(p.type==='task_started')start('',time);
    else if(p.type==='user_message'){if(!current)start(p.message??'',time);else Object.assign(current,classify(p.message??''));}
    else if(p.type==='token_count')add(p.info?.last_token_usage,time,p.info?`codex:${source}:${JSON.stringify(p.info.total_token_usage??{time,last:p.info.last_token_usage})}`:null);
    else if(p.type==='task_complete'||p.type==='task_aborted')current=null;
   }
  },
  report(){const selected=turns.filter(t=>t.calls||Date.parse(t.startedAt)>=lower&&Date.parse(t.startedAt)<upper);
   const totals={turns:selected.length,calls:0,input:0,cacheRead:0,cacheWrite:0,output:0};for(const t of selected)for(const k of ['calls','input','cacheRead','cacheWrite','output'])totals[k]+=t[k];
   return {schemaVersion:1,provider,since,until,turns:selected,totals,skippedRows,missingUsage,handoverMeaning:'keyword candidate only',unit:'tokens, not price or usage-limit equivalence'};},
 };
}
export function summarize(rows,options){const a=accumulator(options);for(const row of rows)a.push(row);return a.report();}
