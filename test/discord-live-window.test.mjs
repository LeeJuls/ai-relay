import test from 'node:test';import assert from 'node:assert/strict';
const mod=await import('../tools/discord-adapter/window.mjs').catch(()=>({}));
test('three minute window begins only on actual Gateway ready',()=>{
 const window=mod.trialWindow(1000);assert.equal(window.observe('connecting',6000).remaining_ms,null);const ready=window.observe('ready',10000);assert.equal(ready.remaining_ms,180000);assert.equal(ready.announce,true);assert.equal(window.observe('ready',11000).announce,false);assert.equal(window.observe('ready',190000).done,true);
});
test('startup has its own finite deadline and never claims ready',()=>{
 const window=mod.trialWindow(1000);assert.deepEqual(window.observe('connecting',16000),{done:true,announce:false,remaining_ms:null});
});
test('hard deadline schedules from READY without status polling',()=>{
 let callback,delay,expired=0;const boundary=mod.trialDeadline({set:(fn,ms)=>{callback=fn;delay=ms;return 1;},clear:()=>{},expire:()=>expired++});boundary.ready();assert.equal(delay,180000);callback();assert.equal(expired,1);boundary.ready();assert.equal(expired,1);
});
test('Gateway close and request abort precede waiting for model completion',async()=>{
 const order=[];await mod.closeTrial({host:{stop(){order.push('stop');return Promise.resolve();},close(){order.push('close');return Promise.resolve();}},broker:{stop(){order.push('broker-stop');},async drain(){order.push('drain');}},abort(){order.push('abort');}});assert.ok(order.indexOf('close')<order.indexOf('drain'));assert.ok(order.indexOf('abort')<order.indexOf('drain'));
});
