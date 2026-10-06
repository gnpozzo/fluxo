import test from 'node:test';
import assert from 'node:assert/strict';
import dashboard from '../api_controllers/getDashboardData.js';
import shared from '../api_controllers/getConsumosCC.js';
const rows=[{id_movimiento:'september',fecha:'2026-09-05',tipo_mov:'EGRESO',importe:40,moneda:'ARS',categorias:{nombre:'Vivienda'}},{id_movimiento:'october',fecha:'2026-10-05',tipo_mov:'EGRESO',importe:100,moneda:'ARS',categorias:{nombre:'Vivienda'}}];
function database() {
 return {from(table){
  const filters={};let from='',to='';
  const result=()=>{
   assert.equal(filters.user_id || filters.mensaje,'user');
   if(table==='cuentas_principales')return {data:[{id_cuenta_principal:'account',nombre:'QA'}]};
   if(table==='logs')return {data:[]};
   assert.equal(filters.id_cuenta_principal,'account');
   return {data:rows.filter(row=>row.fecha>=from&&row.fecha<=to).map(row=>({...row}))};
  };
  const q={select(){return q;},eq(key,value){filters[key]=value;return q;},gte(key,value){from=value;return q;},lte(key,value){to=value;return q;},order(){return q;},limit(){return q;},range(){return Promise.resolve(result());},then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);}};return q;
 },rpc(name,args){
  assert.equal(name,'get_consumos_cc_list');assert.equal(args.p_id_cuenta,'account');
  return {range(){return Promise.resolve({data:rows.filter(row=>row.fecha>=args.p_fecha_inicio && row.fecha<=args.p_fecha_fin).map(row=>({...row,id_cc_consumo:row.id_movimiento,pagador:'YO',porcentaje_imputado:50}))});}};
 }};
}
async function run(handler){const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({method:'POST',body:['QA','2026-10-01','2026-10-31'],user:{id:'user'},db:database()},res);return res;}
test('dashboard returns category-aware historical detail scoped to the authenticated account',async()=>{
 const res=await run(dashboard);assert.equal(res.code,200);assert.equal(res.body.movimientos.length,1);assert.equal(res.body.movimientosHistoricos.length,2);assert.equal(res.body.movimientosHistoricos[0].categoria_nombre,'Vivienda');assert.equal(res.body.evolucionMensual.find(row=>row.mes==='2026-09').egresos,40);
});
test('shared history preserves monthly totals and maps detail without extending account scope',async()=>{
 const res=await run(shared);assert.equal(res.code,200);assert.equal(res.body.consumos.length,1);assert.equal(res.body.consumosHistoricos.length,2);assert.equal(res.body.kpis.gastoYo,100);assert.equal(res.body.consumosHistoricos[0].mi_parte,20);
});
