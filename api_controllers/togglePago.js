import { isCardPurchase } from '../shared/operation.js';
import { getSupabaseClient } from '../api_lib/supabase.js';
import { civilDate, monthBounds, todayArgentina, money } from '../shared/finance.js';
import { inputError } from '../api_lib/validation.js';
import crypto from 'node:crypto';

// Runs inside atomicRequest: payment state and ledger entries commit together.
export default async function handler(req, res) {
  const db = getSupabaseClient(req), userId = req.user.id;
  const body = req.body?.args?.[0] || (Array.isArray(req.body) ? req.body[0] : req.body) || {};
  const { action = 'toggle', pagado } = body;
  const date = civilDate(body.fechaPago || todayArgentina());
  const { data: logs } = await db.from('logs').select('id,contexto').eq('funcion','ESTADO_PAGOS').eq('mensaje',userId).order('id',{ascending:false}).limit(1);
  const logId = logs[0]?.id, state = { ...(logs[0]?.contexto || {}) };
  if(action === 'get_state') return res.status(200).json({success:true,data:state});
  let count = 0, last = false;
  const mark = (id,value,type) => { state[id]={pagado:value,fecha_pago:value?date:null,...(type?{tipo:type}:{})}; count++; last=value; };
  if(action === 'toggle') {
    const raw = body.idMovimiento || body.id || body.idConsumo;
    const ids = [...new Set(Array.isArray(raw)?raw:[raw])];
    if(!ids.length || ids.length>1000 || ids.some(id=>typeof id!=='string')) throw inputError('IDs inválidos.');
    const {data:movs}=await db.from('movimientos').select('id_movimiento,id_consumo_tarjeta_origen,medio_pago,id_categoria,descripcion').in('id_movimiento',ids).eq('user_id',userId);
    const {data:tcs}=await db.from('consumos_tc').select('id_consumo_tarjeta').in('id_consumo_tarjeta',ids).eq('user_id',userId);
    const owned=new Set([...movs.map(m=>m.id_movimiento),...tcs.map(c=>c.id_consumo_tarjeta)]);
    if(ids.some(id=>!owned.has(id))) throw inputError('La operación no pertenece al usuario.',403);
    if(tcs.length || movs.some(isCardPurchase)) throw inputError('Los consumos con tarjeta se saldan al registrar el pago del resumen.');
    if(movs.some(m=>m.id_categoria==='CAT_PAGO_TC' && m.descripcion?.toLowerCase().startsWith('pago resumen:'))) throw inputError('El pago del resumen se administra desde Tarjetas.');
    for(const id of ids) mark(id,pagado===undefined?!state[id]?.pagado:!!pagado);
  } else if(action === 'pagar_resumen') {
    const month=body.mes;
    const [start,end]=monthBounds(month);
    let q=db.from('consumos_tc').select('*').eq('user_id',userId).gte('fecha',start).lte('fecha',end);
    if(body.idTarjeta) q=q.eq('id_tarjeta',body.idTarjeta);
    if(body.ids && (!Array.isArray(body.ids) || body.ids.length>1000 || body.ids.some(id=>typeof id!=='string'))) throw inputError('IDs inválidos.');
    const {data:periodConsumos}=await q;
    const consumos=periodConsumos.filter(c=>!body.ids?.length || body.ids.includes(c.id_consumo_tarjeta) || state[c.id_consumo_tarjeta]?.pagado);
    if(!consumos.length) throw inputError('No hay consumos para pagar en ese período.');
    if(body.ids?.some(id=>!consumos.some(c=>c.id_consumo_tarjeta===id))) throw inputError('Consumos fuera del período o del usuario.',403);
    const {data:cards}=await db.from('tarjetas').select('*').in('id_tarjeta',[...new Set(consumos.map(c=>c.id_tarjeta))]).eq('user_id',userId);
    const {data:linked}=await db.from('movimientos').select('*').in('id_consumo_tarjeta_origen',consumos.map(c=>c.id_consumo_tarjeta)).eq('user_id',userId);
    const ledger = async (card,currency,type,category,description,total) => {
      const {data:found}=await db.from('movimientos').select('id_movimiento').eq('user_id',userId).eq('id_cuenta_principal',card.id_cuenta_principal).eq('descripcion',description).eq('moneda',currency).limit(1);
      if(total<=0) {
        if(found.length) { await db.from('movimientos').delete().eq('id_movimiento',found[0].id_movimiento).eq('user_id',userId); delete state[found[0].id_movimiento]; }
        return;
      }
      const id=found[0]?.id_movimiento || crypto.randomUUID();
      const row={id_movimiento:id,user_id:userId,id_cuenta_principal:card.id_cuenta_principal,fecha:date,id_categoria:category,tipo_mov:type,descripcion:description,importe:money(total),moneda:currency,medio_pago:'Transferencia'};
      if(found.length) await db.from('movimientos').update(row).eq('id_movimiento',id).eq('user_id',userId);
      else await db.from('movimientos').insert(row);
      mark(id,true,type==='EGRESO'?'PAGO_TC':'REINTEGRO_TC');
    };
    for(const card of cards) {
      const own=consumos.filter(c=>c.id_tarjeta===card.id_tarjeta);
      const current=card.fecha_vencimiento_actual?.slice(0,7)===month;
      for(const currency of ['ARS','USD']) {
        const subtotal=own.filter(c=>(c.moneda||'ARS')===currency).reduce((n,c)=>n+Number(c.importe),0);
        const complete=periodConsumos.filter(c=>c.id_tarjeta===card.id_tarjeta).every(c=>own.some(p=>p.id_consumo_tarjeta===c.id_consumo_tarjeta));
        const official=current && complete ? Number(card[currency==='USD'?'total_resumen_usd':'total_resumen_ars']) : 0;
        await ledger(card,currency,'EGRESO','CAT_PAGO_TC',`Pago Resumen: ${card.nombre} (${month}) [${currency}]`,official>0?official:subtotal);
        const reimburse=linked.filter(m=>m.tipo_mov==='EGRESO' && m.id_cuenta_principal!==card.id_cuenta_principal && (m.moneda||'ARS')===currency && own.some(c=>c.id_consumo_tarjeta===m.id_consumo_tarjeta_origen)).reduce((n,m)=>n+Number(m.importe),0);
        const alreadyBooked=linked.filter(m=>m.tipo_mov==='INGRESO' && m.id_cuenta_principal===card.id_cuenta_principal && (m.moneda||'ARS')===currency && own.some(c=>c.id_consumo_tarjeta===m.id_consumo_tarjeta_origen)).reduce((n,m)=>n+Number(m.importe),0);
        await ledger(card,currency,'INGRESO','CAT_REINTEGRO_TC',`Reintegro TC: ${card.nombre} (${month}) [${currency}]`,Math.max(0,reimburse-alreadyBooked));
      }
      if(!body.ids?.length) mark(`RESUMEN_${card.id_tarjeta}_${month}`,true);
    }
    for(const c of consumos) mark(c.id_consumo_tarjeta,true,'TC');
    for(const m of linked) mark(m.id_movimiento,true,'MOV');
  } else throw inputError('Acción inválida.');
  const row={funcion:'ESTADO_PAGOS',mensaje:userId,nivel:'INFO',contexto:state,timestamp:new Date().toISOString()};
  if(logId) await db.from('logs').update(row).eq('id',logId).eq('mensaje',userId);
  else await db.from('logs').insert(row);
  return res.status(200).json({success:true,pagado:last,updatedCount:count,data:state});
}
