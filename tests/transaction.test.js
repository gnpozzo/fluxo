import test from 'node:test';
import assert from 'node:assert/strict';
import { TransactionQuery,atomicRequest } from '../api_lib/transaction.js';

test('SQL values are parameterized even when filters precede an update',async()=>{
  let captured;const db={client:{async query(sql,values){captured={sql,values};return {rows:[{id_movimiento:'id'}]};}}};
  await new TransactionQuery(db,'movimientos').update({descripcion:"x'; DELETE FROM movimientos; --"}).eq('id_movimiento','id').eq('user_id','owner').select('id_movimiento');
  assert.match(captured.sql,/"descripcion"=\$3/);assert.match(captured.sql,/"id_movimiento" = \$1/);assert.equal(captured.values[2],"x'; DELETE FROM movimientos; --");assert.ok(!captured.sql.includes('DELETE FROM'));
});
test('unfiltered destructive queries and identifier injection are rejected',async()=>{
  const db={client:{query:()=>{throw Error('Should not execute');}}};
  await assert.rejects(new TransactionQuery(db,'movimientos').delete().execute(),/sin filtros/);
  assert.throws(()=>new TransactionQuery(db,'movimientos;DROP TABLE logs'),/Tabla/);
});
function fakePool(cached=[]){const statements=[];let released=false;const client={async query(sql){statements.push(sql);return {rows:sql.startsWith('SELECT request_hash')?cached:[]};},release(){released=true;}};return {pool:{connect:async()=>client},statements,get released(){return released;}};}
const request=()=>({user:{id:'00000000-0000-4000-8000-000000000001'},body:{importe:10},headers:{'idempotency-key':'operation-1'}});
const response=()=>({code:200,status(n){this.code=n;return this;},json(value){this.value=value;return this;}});
test('failure after a first write rolls back before reporting failure',async()=>{
  const fixture=fakePool(),req=request(),res=response();
  await atomicRequest(req,res,async(req,res)=>{await req.db.from('movimientos').insert({id_movimiento:'a'});res.status(400).json({success:false,error:'second write failed'});},'createAhorro',fixture.pool);
  assert.ok(fixture.statements.includes('ROLLBACK'));assert.ok(!fixture.statements.includes('COMMIT'));assert.equal(res.code,400);assert.equal(req.db,undefined);assert.equal(fixture.released,true);
});
test('successful operations save replay state and commit before responding',async()=>{
  const fixture=fakePool(),res=response();await atomicRequest(request(),res,async(_req,res)=>res.json({success:true}),'createMovimiento',fixture.pool);
  assert.ok(fixture.statements.some(s=>s.startsWith('INSERT INTO fluxo_private.requests')));assert.equal(fixture.statements.at(-1),'COMMIT');assert.equal(res.value.success,true);
});
test('reusing an operation key with a different payload rejects without dispatch',async()=>{
  const fixture=fakePool([{request_hash:'different',status:200,response:{success:true}}]);let called=false;
  await assert.rejects(atomicRequest(request(),response(),async()=>{called=true;},'createMovimiento',fixture.pool),/otros datos/);assert.equal(called,false);assert.ok(fixture.statements.includes('ROLLBACK'));
});
