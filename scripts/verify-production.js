// Explicit smoke test against the verified Fluxo domain. Creates a temporary
// QA identity, never emails or messages, and removes every fixture in finally.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { query } from './supabase-management.js';

if(!process.argv.includes('--allow-production')) throw new Error('Usar --allow-production solo para una verificación autorizada de Fluxo.');
const domain='https://fluxo-delta.vercel.app';
const read=(file,key)=>fs.readFileSync(file,'utf8').match(new RegExp('^'+key+'\\s*=\\s*(.+)$','m'))?.[1].trim().replace(/^['"]|['"]$/g,'');
const db=createClient(read('.env','SUPABASE_URL'),read('.env.service','SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const config=await (await fetch(domain+'/api/getConfig')).json();
const auth=createClient(config.url,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
let userId,token,assertions=0;
const request=async(endpoint,body,key,method='POST')=>{
 const response=await fetch(domain+'/api/'+endpoint,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)})});
 return {status:response.status,body:await response.json()};
};
try {
 const unauth=await request('getInitialData',[]);assert.equal(unauth.status,401);assertions++;
 assert.equal((await request('sendReminders',null,null,'GET')).status,401);assertions++;
 const email=`fluxo-qa-${crypto.randomUUID()}@example.com`,password=crypto.randomBytes(32).toString('base64url');
 const created=await db.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'QA temporal'}});
 if(created.error)throw created.error;userId=created.data.user.id;
 const signed=await auth.auth.signInWithPassword({email,password});if(signed.error)throw signed.error;token=signed.data.session.access_token;
 const initial=await request('getInitialData',[]);assert.equal(initial.status,200,JSON.stringify(initial.body));assert.equal(initial.body.cuentas.length,1);assertions++;
 const account=initial.body.cuentas[0].id_cuenta_principal;
 const data={idCuenta:account,fecha:'2026-10-05',tipo:'EGRESO',idCategoria:'CAT_PAGO_TC',importe:1,tipoConsumo:'COMUN',descripcion:'QA producción temporal',moneda:'ARS'};
 const key=crypto.randomUUID();const first=await request('createMovimiento',data,key);assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.success,true);assertions++;
 const replay=await request('createMovimiento',data,key);assert.equal(replay.status,200);assert.deepEqual(replay.body,first.body);assertions++;
 const conflict=await request('createMovimiento',{...data,importe:2},key);assert.equal(conflict.status,409);assertions++;
 const dashboard=await request('getDashboardData',[account,'2026-10-01','2026-10-31']);assert.equal(dashboard.status,200,JSON.stringify(dashboard.body));assert.equal(dashboard.body.movimientos.length,1);assertions++;
 const invalid=await request('createMovimiento',{...data,importe:-1},crypto.randomUUID());assert.equal(invalid.status,400);assertions++;
 const deleted=await request('deleteMovimiento',{id:dashboard.body.movimientos[0].id_movimiento,scope:'SINGLE'},crypto.randomUUID());assert.equal(deleted.status,200,JSON.stringify(deleted.body));assertions++;
 const empty=await request('getDashboardData',[account,'2026-10-01','2026-10-31']);assert.equal(empty.body.movimientos.length,0);assertions++;
 console.log(`PASS: ${assertions} production HTTP assertions. Temporary QA identity will be removed.`);
}finally {
 if(userId){
  assert.match(userId,/^[0-9a-f-]{36}$/i);
  const tables=['recordatorios','ahorros','inversiones_movimientos','cc_consumos','movimientos','consumos_tc','tarjetas','ahorro_subcuentas','cta_corriente_usuarios','categorias','cuentas_principales'];
  const statements=tables.map(table=>`DELETE FROM public.${table} WHERE user_id='${userId}';`).join('\n');
  await query(`BEGIN; ${statements} DELETE FROM fluxo_private.requests WHERE user_id='${userId}'; DELETE FROM public.logs WHERE funcion='ESTADO_PAGOS' AND mensaje='${userId}'; DELETE FROM public.perfiles_usuario WHERE id='${userId}'; COMMIT;`);
  const deleted=await db.auth.admin.deleteUser(userId);if(deleted.error)throw deleted.error;
  console.log('QA identity and all financial/idempotency fixtures removed.');
 }
}
