// Explicit integration verification. All financial fixtures live inside one
// outer transaction which is unconditionally rolled back, including on failure.
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import { management,projectRef } from './supabase-management.js';
import { supabaseCa } from '../api_lib/supabase-ca.js';
import { atomicRequest } from '../api_lib/transaction.js';
import createMovimiento from '../api_controllers/createMovimiento.js';
import updateMovimiento from '../api_controllers/updateMovimiento.js';
import createMovimientosBatch from '../api_controllers/createMovimientosBatch.js';
import createAhorro from '../api_controllers/createAhorro.js';
import deleteAhorro from '../api_controllers/deleteAhorro.js';
import createInversion from '../api_controllers/createInversion.js';
import deleteInversion from '../api_controllers/deleteInversion.js';
import createConsumoTC from '../api_controllers/createConsumoTC.js';
import togglePago from '../api_controllers/togglePago.js';
import saveTarjeta from '../api_controllers/admin_saveTarjeta.js';

const login=await management('cli/login-role',{read_only:false});
const pooler=(await management('config/database/pooler'))[0];
const url=new URL(pooler.connection_string);url.username=`${login.role}.${projectRef}`;url.password=login.password;
const client=new pg.Client({connectionString:url.toString(),ssl:{ca:supabaseCa,rejectUnauthorized:true},connectionTimeoutMillis:10000});
let assertions=0;
try {
  await client.connect();await client.query('SET ROLE postgres');await client.query('BEGIN');
  const user=crypto.randomUUID(),other=crypto.randomUUID();
  await client.query('INSERT INTO auth.users(id,raw_user_meta_data) VALUES($1,$3),($2,$3)',[user,other,'{}']);
  const account=(await client.query('SELECT id_cuenta_principal FROM public.cuentas_principales WHERE user_id=$1',[user])).rows[0].id_cuenta_principal;
  const second=(await client.query('SELECT id_cuenta_principal FROM public.cuentas_principales WHERE user_id=$1',[other])).rows[0].id_cuenta_principal;
  const sub=(await client.query('SELECT id_subcuenta FROM public.ahorro_subcuentas WHERE user_id=$1 LIMIT 1',[user])).rows[0].id_subcuenta;
  const connection={async query(sql,values){if(sql==='BEGIN')sql='SAVEPOINT operation';else if(sql==='COMMIT')sql='RELEASE SAVEPOINT operation';else if(sql==='ROLLBACK')sql='ROLLBACK TO SAVEPOINT operation';else if(sql==='RESET ROLE')sql='SET LOCAL ROLE postgres';return client.query(sql,values);},release(){}};
  const pool={connect:async()=>connection};
  const run=async(handler,body,key=crypto.randomUUID())=>{
    const req={method:'POST',body,user:{id:user},headers:{'idempotency-key':key}};
    const res={code:200,status(n){this.code=n;return this;},json(value){this.body=value;return this;}};
    try{await atomicRequest(req,res,handler,handler.name+handler.toString().slice(0,50),pool);}catch(error){res.code=error.status||500;res.body={success:false,error:error.message};}
    return res;
  };
  const count=async(table)=>Number((await client.query(`SELECT count(*) FROM public.${table} WHERE user_id=$1`,[user])).rows[0].count);
  const mov={idCuenta:account,fecha:'2026-01-31',tipo:'EGRESO',idCategoria:'CAT_PAGO_TC',importe:100,tipoConsumo:'RECURRENTE',periodos:3,descripcion:'QA recurring',moneda:'ARS'};
  const key=crypto.randomUUID();let res=await run(createMovimiento,mov,key);assert.equal(res.code,200,JSON.stringify(res.body));assert.equal(await count('movimientos'),3);assertions++;
  res=await run(createMovimiento,mov,key);assert.equal(res.code,200);assert.equal(await count('movimientos'),3);assertions++;
  assert.deepEqual((await client.query('SELECT fecha::text FROM public.movimientos WHERE user_id=$1 ORDER BY fecha',[user])).rows.map(r=>r.fecha),['2026-01-31','2026-02-28','2026-03-31']);assertions++;
  const before=await count('movimientos');res=await run(createAhorro,{idCuenta:account,idSubcuenta:crypto.randomUUID(),fecha:'2026-10-05',importe:100,moneda:'ARS'});assert.equal(res.body.success,false);assert.equal(await count('movimientos'),before);assertions++;
  res=await run(createAhorro,{idCuenta:account,idSubcuenta:sub,fecha:'2026-10-05',importe:100,moneda:'USD',tipoCambio:1200});assert.equal(res.code,200,JSON.stringify(res.body));const savingsId=res.body.data.id_ahorro;assertions++;
  res=await run(deleteAhorro,{id_ahorro:savingsId});assert.equal(res.code,200,JSON.stringify(res.body));assert.equal(await count('ahorros'),0);assert.equal(await count('movimientos'),before);assertions++;
  res=await run(createMovimientosBatch,{movimientos:[{...mov,tipoConsumo:'COMUN'},{...mov,idCuenta:second}]});assert.equal(res.body.success,false);assert.equal(await count('movimientos'),before);assertions++;
  const cardId=crypto.randomUUID();res=await run(saveTarjeta,{id_tarjeta:cardId,nombre:'QA Card',id_cuenta_principal:account,activa:true,fecha_vencimiento_actual:'2026-02-28',total_resumen_ars:100,total_resumen_usd:10});assert.equal(res.code,200,JSON.stringify(res.body));assertions++;
  for(const [currency,amount]of [['ARS',100],['USD',10]]){res=await run(createConsumoTC,{idTarjeta:cardId,idCuenta:account,fecha:'2026-02-28',idCategoria:'CAT_PAGO_TC',tipoConsumo:'SIMPLE',descripcion:'QA purchase '+currency,importe:amount,moneda:currency});assert.equal(res.code,200,JSON.stringify(res.body));}assertions++;
  res=await run(togglePago,{action:'pagar_resumen',idTarjeta:cardId,mes:'2026-02',fechaPago:'2026-02-28'});assert.equal(res.code,200,JSON.stringify(res.body));
  const payments=(await client.query("SELECT moneda,importe::text FROM public.movimientos WHERE user_id=$1 AND descripcion LIKE 'Pago Resumen:%' ORDER BY moneda",[user])).rows;
  assert.deepEqual(payments.map(p=>({...p,importe:Number(p.importe)})),[{moneda:'ARS',importe:100},{moneda:'USD',importe:10}]);assertions++;
  res=await run(togglePago,{action:'pagar_resumen',idTarjeta:cardId,mes:'2026-02',fechaPago:'2026-02-28'});assert.equal(res.code,200);assert.equal(Number((await client.query("SELECT count(*) FROM public.movimientos WHERE user_id=$1 AND descripcion LIKE 'Pago Resumen:%'",[user])).rows[0].count),2);assertions++;
  res=await run(createMovimiento,{...mov,tipoConsumo:'CUOTAS',idTarjetaCuotas:cardId,cuotaActual:1,cuotaTotal:2,fecha:'2026-03-31',descripcion:'QA card installment'});assert.equal(res.code,200,JSON.stringify(res.body));
  const installments=(await client.query("SELECT fecha::text,cuota_actual FROM public.consumos_tc WHERE user_id=$1 AND descripcion='QA card installment' ORDER BY fecha",[user])).rows;
  assert.deepEqual(installments,[{fecha:'2026-03-31',cuota_actual:1},{fecha:'2026-04-30',cuota_actual:2}]);assertions++;
  const installmentMov=(await client.query("SELECT id_movimiento FROM public.movimientos WHERE user_id=$1 AND descripcion LIKE 'QA card installment%' ORDER BY fecha LIMIT 1",[user])).rows[0].id_movimiento;
  res=await run(updateMovimiento,{original:{id:installmentMov},scope:'SINGLE',data:{...mov,tipoConsumo:'COMUN',descripcion:'QA edited',importe:25}});assert.equal(res.code,200,JSON.stringify(res.body));assertions++;
  res=await run(updateMovimiento,{original:{id:crypto.randomUUID()},scope:'SERIES',data:mov});assert.equal(res.code,404);assertions++;
  const external=crypto.randomUUID();await client.query('INSERT INTO public.cuentas_principales(id_cuenta_principal,nombre,user_id) VALUES($1,$2,$3)',[external,'QA external',user]);
  for(const amount of [5,7]){res=await run(createConsumoTC,{idTarjeta:cardId,idCuenta:account,idCuentaImputar:external,imputar:true,fecha:'2026-05-15',idCategoria:'CAT_PAGO_TC',tipoConsumo:'SIMPLE',descripcion:'QA shared USD '+amount,importe:amount,moneda:'USD'});assert.equal(res.code,200,JSON.stringify(res.body));}
  const shared=(await client.query("SELECT id_consumo_tarjeta FROM public.consumos_tc WHERE user_id=$1 AND descripcion LIKE 'QA shared USD%' ORDER BY importe",[user])).rows.map(c=>c.id_consumo_tarjeta);
  res=await run(togglePago,{action:'pagar_resumen',idTarjeta:cardId,mes:'2026-05',ids:[shared[0]]});assert.equal(res.code,200,JSON.stringify(res.body));assertions++;
  res=await run(togglePago,{action:'pagar_resumen',idTarjeta:cardId,mes:'2026-05',ids:[shared[1]]});assert.equal(res.code,200,JSON.stringify(res.body));
  const sharedLedger=(await client.query("SELECT tipo_mov,moneda,importe FROM public.movimientos WHERE user_id=$1 AND descripcion LIKE '%(2026-05)%' ORDER BY tipo_mov",[user])).rows;
  assert.deepEqual(sharedLedger.map(m=>({...m,importe:Number(m.importe)})),[{tipo_mov:'EGRESO',moneda:'USD',importe:12},{tipo_mov:'INGRESO',moneda:'USD',importe:12}]);assertions++;
  // Mixed payment methods: card payment settles only the purchase and its explicit ledger link.
  const manualCategory=(await client.query("SELECT id_categoria FROM public.categorias WHERE id_categoria<>'CAT_PAGO_TC' LIMIT 1")).rows[0].id_categoria;
  const manualIds=[];
  for(const method of ['Tarjeta de Débito','Transferencia','Efectivo']) {
    res=await run(createMovimiento,{...mov,idCuenta:external,idCategoria:manualCategory,tipoConsumo:'COMUN',fecha:'2026-06-15',medioPago:method,descripcion:'QA manual '+method});
    assert.equal(res.code,200,JSON.stringify(res.body));
    manualIds.push((await client.query('SELECT id_movimiento FROM public.movimientos WHERE user_id=$1 AND descripcion=$2',[user,'QA manual '+method])).rows[0].id_movimiento);
  }
  res=await run(createConsumoTC,{idTarjeta:cardId,idCuenta:account,idCuentaImputar:external,imputar:true,fecha:'2026-06-15',idCategoria:manualCategory,tipoConsumo:'SIMPLE',descripcion:'QA linked June',importe:40,moneda:'ARS'});
  assert.equal(res.code,200,JSON.stringify(res.body));
  const june=(await client.query("SELECT id_consumo_tarjeta FROM public.consumos_tc WHERE user_id=$1 AND descripcion='QA linked June'",[user])).rows[0].id_consumo_tarjeta;
  const linkedJune=(await client.query('SELECT id_movimiento FROM public.movimientos WHERE user_id=$1 AND id_consumo_tarjeta_origen=$2',[user,june])).rows[0].id_movimiento;
  res=await run(togglePago,{action:'pagar_resumen',idTarjeta:cardId,mes:'2026-06'});assert.equal(res.code,200,JSON.stringify(res.body));
  assert.equal(res.body.data[june].pagado,true);assert.equal(res.body.data[linkedJune].pagado,true);
  for(const id of manualIds) assert.equal(Boolean(res.body.data[id]?.pagado),false);assertions++;
  for(const id of [june,linkedJune]) {res=await run(togglePago,{id});assert.equal(res.code,400);assertions++;}
  for(const id of manualIds) {
    res=await run(togglePago,{id,pagado:true});assert.equal(res.code,200,JSON.stringify(res.body));assert.equal(res.body.data[id].pagado,true);
    res=await run(togglePago,{id,pagado:false});assert.equal(res.code,200);assert.equal(res.body.data[id].pagado,false);assertions++;
  }
  res=await run(togglePago,{id:[manualIds[0],june],pagado:true});assert.equal(res.code,400);
  res=await run(togglePago,{action:'get_state'});assert.equal(res.body.data[manualIds[0]].pagado,false);assert.equal(res.body.data[june].pagado,true);assertions++;

  // Non-card installments retain position when descriptions are no longer annotated.
  const installmentData={...mov,idCategoria:manualCategory,tipoConsumo:'CUOTAS',cuotaActual:2,cuotaTotal:3,fecha:'2026-07-31',descripcion:'QA clean installments',medioPago:'Transferencia'};
  res=await run(createMovimiento,installmentData);assert.equal(res.code,200,JSON.stringify(res.body));
  let clean=(await client.query("SELECT id_movimiento,descripcion,cuota_actual,cuota_total FROM public.movimientos WHERE user_id=$1 AND descripcion='QA clean installments' ORDER BY fecha",[user])).rows;
  assert.deepEqual(clean.map(r=>[r.descripcion,r.cuota_actual,r.cuota_total]),[['QA clean installments',2,3],['QA clean installments',3,3]]);assertions++;
  res=await run(updateMovimiento,{original:{id:clean[0].id_movimiento},scope:'SERIES',data:{...installmentData,descripcion:'QA clean edited'}});assert.equal(res.code,200,JSON.stringify(res.body));
  clean=(await client.query("SELECT descripcion,cuota_actual,cuota_total FROM public.movimientos WHERE user_id=$1 AND descripcion='QA clean edited' ORDER BY fecha",[user])).rows;
  assert.deepEqual(clean.map(r=>[r.descripcion,r.cuota_actual,r.cuota_total]),[['QA clean edited',2,3],['QA clean edited',3,3]]);assertions++;
  res=await run(createInversion,{idCuenta:account,ticker:'QA',fecha:'2026-01-01',tipoOp:'COMPRA',moneda:'USD',cantidad:10,precio:5,tipoCambio:1200});assert.equal(res.code,200,JSON.stringify(res.body));const investment=res.body.data.id_operacion;assertions++;
  res=await run(createInversion,{idCuenta:account,ticker:'QA',fecha:'2026-01-02',tipoOp:'VENTA',moneda:'USD',cantidad:11,precio:5,tipoCambio:1200});assert.equal(res.body.success,false);assert.equal(await count('inversiones_movimientos'),1);assertions++;
  res=await run(deleteInversion,investment);assert.equal(res.code,200,JSON.stringify(res.body));assert.equal(await count('inversiones_movimientos'),0);assertions++;
  console.log(`PASS: ${assertions} PostgreSQL integration assertions. Fixtures are rolled back.`);
} finally {
  try{await client.query('ROLLBACK');}finally{await client.end();}
}
