import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiService } from '../src/core/AppAPI.js';

const context=()=>globalThis.window={App:{Auth:{user:{id:'user-a'},getValidToken:async()=> 'jwt'},Events:{emit(){}}}};
const reply=(status,body={success:true})=>({status,ok:status<400,json:async()=>body});
test('temporary read errors retry without re-entering the same in-flight promise',async()=>{
  context();let calls=0;globalThis.fetch=async()=>reply(++calls===1?503:200);
  const api=new ApiService();assert.equal((await api.call('api_getInitialData')).success,true);assert.equal(calls,2);
});
test('a mutation does not automatically repeat after a server error',async()=>{
  context();let calls=0;globalThis.fetch=async()=>{calls++;return reply(503,{error:'temporary'});};
  await assert.rejects(new ApiService().call('api_createMovimiento',{importe:10}),/temporary/);assert.equal(calls,1);
});
test('authentication refresh keeps the same idempotency key on a mutation',async()=>{
  context();window.App.Auth.refreshSession=async()=>true;const keys=[];globalThis.fetch=async(_url,options)=>{keys.push(options.headers['Idempotency-Key']);return reply(keys.length===1?401:200);};
  await new ApiService().call('api_createMovimiento',{importe:10});assert.equal(keys.length,2);assert.ok(keys[0]);assert.equal(keys[0],keys[1]);
});
test('concurrent identical reads share one network call',async()=>{
  context();let finish,calls=0;globalThis.fetch=()=>{calls++;return new Promise(r=>finish=()=>r(reply(200)));};const api=new ApiService();
  const a=api.call('api_getInitialData'),b=api.call('api_getInitialData');await new Promise(r=>setImmediate(r));finish();await Promise.all([a,b]);assert.equal(calls,1);
});
test('GET sends no body and an account change prevents stale cache writes',async()=>{
  context();let options;globalThis.fetch=async(_url,o)=>{options=o;return reply(200);};const api=new ApiService();await api.fetch('/api/getConfig',{method:'GET'});assert.equal(options.body,undefined);
  let finish;globalThis.fetch=()=>new Promise(r=>finish=()=>r(reply(200)));const pending=api.cached('api_getInitialData');await new Promise(r=>setImmediate(r));api.invalidateAll();finish();await assert.rejects(pending,/sesión cambió/);assert.equal(api._cache.size,0);
});
