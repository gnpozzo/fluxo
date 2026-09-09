import { getSupabaseClient } from '../api_lib/supabase.js';
import crypto from 'crypto';

function parseDateSafe(val) {
  if (!val) return new Date();
  if (val instanceof Date) return isNaN(val.getTime()) ? new Date() : val;
  const s = String(val).trim();
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    const year = dmy[3];
    return new Date(`${year}-${month}-${day}T12:00:00Z`);
  }
  const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymd) {
    const year = ymd[1];
    const month = ymd[2].padStart(2, '0');
    const day = ymd[3].padStart(2, '0');
    return new Date(`${year}-${month}-${day}T12:00:00Z`);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date() : d;
}

function toIsoDateStr(val) {
  return parseDateSafe(val).toISOString().split('T')[0];
}

function addMonthsSafe(date, months) {
  const d = parseDateSafe(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() !== day) {
    d.setUTCDate(0);
  }
  return d;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    let request = null;
    if (req.body && Array.isArray(req.body.args)) {
      if (req.body.args[1] && typeof req.body.args[1] === 'object' && req.body.args[1].data) {
        request = req.body.args[1];
        if (req.body.args[2]) request.scope = req.body.args[2];
      } else {
        request = req.body.args[0];
      }
    } else if (Array.isArray(req.body)) {
      request = req.body[0];
    } else {
      request = req.body;
    }
    
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const { original = {}, data = {}, scope = 'SINGLE' } = request || {};
    const origId = original.consumoId || original.id_consumo_tc || original.id_consumo_tarjeta;
    const recurGrp = original.recurGroupId || original.recur_group_id;
    
    // 1. Delete original (scoped to user_id)
    if (scope === 'SINGLE' && origId) {
      await supabase.from('movimientos').delete().eq('id_consumo_tarjeta_origen', origId).eq('user_id', userId);
      const { error: delTcErr } = await supabase.from('consumos_tc').delete().eq('id_consumo_tarjeta', origId).eq('user_id', userId);
      if (delTcErr) throw delTcErr;
    } else if (scope === 'SERIES' && recurGrp) {
      const origFecha = toIsoDateStr(original.fecha?.value || original.fecha || '2000-01-01');
      const { data: tcs, error: qErr } = await supabase.from('consumos_tc').select('id_consumo_tarjeta')
        .eq('recur_group_id', recurGrp)
        .eq('user_id', userId)
        .gte('fecha', origFecha);
        
      if (qErr) throw qErr;

      if (tcs && tcs.length > 0) {
        const ids = tcs.map(r => r.id_consumo_tarjeta);
        await supabase.from('movimientos').delete().in('id_consumo_tarjeta_origen', ids).eq('user_id', userId);
        const { error: delSeriesErr } = await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', ids).eq('user_id', userId);
        if (delSeriesErr) throw delSeriesErr;
      }
    } else if (origId) {
      await supabase.from('movimientos').delete().eq('id_consumo_tarjeta_origen', origId).eq('user_id', userId);
      const { error: delSingleErr } = await supabase.from('consumos_tc').delete().eq('id_consumo_tarjeta', origId).eq('user_id', userId);
      if (delSingleErr) throw delSingleErr;
    }
    
    // 2. Resolve card account and due date
    const consumo = data;
    let cardAccountId = null;
    let cardVto = null;
    if (consumo.idTarjeta) {
      const { data: tc } = await supabase
        .from('tarjetas')
        .select('id_tarjeta, id_cuenta_principal, fecha_vencimiento_actual')
        .eq('id_tarjeta', consumo.idTarjeta)
        .eq('user_id', userId)
        .maybeSingle();
      if (tc) {
        cardAccountId = tc.id_cuenta_principal;
        cardVto = tc.fecha_vencimiento_actual;
      }
    }

    const { data: allUserCuentas } = await supabase
      .from('cuentas_principales')
      .select('id_cuenta_principal, nombre')
      .eq('user_id', userId);
    const cuentaNombreMap = {};
    (allUserCuentas || []).forEach(c => { cuentaNombreMap[c.id_cuenta_principal] = c.nombre; });

    // 3. Create new records
    let tipo = consumo.tipoConsumo || consumo.tipo;
    if (scope === 'SINGLE') {
      tipo = 'SIMPLE';
    } else if (!tipo || tipo === 'COMUN' || tipo === 'SIMPLE') {
      if (recurGrp?.startsWith('REC_')) {
        tipo = 'RECURRENTE';
      } else if (recurGrp?.startsWith('INSTL_') || Number(consumo.cuotaTotal) > 1) {
        tipo = 'CUOTAS';
      }
    }

    const tcRows = [];
    const movRows = [];
    const cleanImporte = Number(String(consumo.importe || 0).replace(',', '.'));
    const fechaBase = parseDateSafe(consumo.fecha);
    const fechaISO = toIsoDateStr(fechaBase);
    const targetAccountId = consumo.idCuentaImputar;

    if (tipo === 'SIMPLE' || tipo === 'COMUN') {
      const idConsumo = crypto.randomUUID();
      tcRows.push({
        id_consumo_tarjeta: idConsumo,
        id_tarjeta: consumo.idTarjeta,
        id_categoria: consumo.idCategoria,
        user_id: userId,
        fecha: fechaISO,
        descripcion: consumo.descripcion,
        importe: cleanImporte
      });
      if (consumo.imputar && targetAccountId) {
        movRows.push({
          id_movimiento: crypto.randomUUID(),
          id_cuenta_principal: targetAccountId,
          user_id: userId,
          fecha: fechaISO,
          id_categoria: consumo.idCategoria,
          tipo_mov: 'EGRESO',
          descripcion: consumo.descripcion,
          importe: cleanImporte,
          medio_pago: 'Tarjeta de Crédito',
          id_consumo_tarjeta_origen: idConsumo
        });

        if (cardAccountId && targetAccountId !== cardAccountId) {
          const fechaReintegro = toIsoDateStr(cardVto || fechaISO);
          const targetAccName = cuentaNombreMap[targetAccountId] || 'Externa';
          movRows.push({
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: cardAccountId,
            user_id: userId,
            fecha: fechaReintegro,
            id_categoria: 'CAT_REINTEGRO_TC',
            tipo_mov: 'INGRESO',
            descripcion: `Reintegro TC: ${consumo.descripcion} (${targetAccName})`,
            importe: cleanImporte,
            medio_pago: 'Tarjeta de Crédito',
            id_consumo_tarjeta_origen: idConsumo
          });
        }
      }
    } else if (tipo === 'CUOTAS') {
      const installmentGroupId = (scope === 'SERIES' && recurGrp) ? recurGrp : ('INSTL_' + crypto.randomUUID());
      const cuotasARegistrar = (consumo.cuotaTotal - consumo.cuotaActual) + 1;
      for (let i = 0; i < cuotasARegistrar; i++) {
        const idConsumo = crypto.randomUUID();
        const cuotaNumActual = consumo.cuotaActual + i;
        const fechaCuota = toIsoDateStr(addMonthsSafe(fechaBase, i));
        tcRows.push({
          id_consumo_tarjeta: idConsumo,
          id_tarjeta: consumo.idTarjeta,
          id_categoria: consumo.idCategoria,
          user_id: userId,
          fecha: fechaCuota,
          descripcion: consumo.descripcion,
          importe: cleanImporte,
          cuota_actual: cuotaNumActual,
          cuota_total: consumo.cuotaTotal,
          recur_group_id: installmentGroupId
        });
        if (consumo.imputar && targetAccountId) {
          const descImputacion = consumo.descripcion + ' (Cuota ' + cuotaNumActual + '/' + consumo.cuotaTotal + ')';
          movRows.push({
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: targetAccountId,
            user_id: userId,
            fecha: fechaCuota,
            id_categoria: consumo.idCategoria,
            tipo_mov: 'EGRESO',
            descripcion: descImputacion,
            importe: cleanImporte,
            medio_pago: 'Tarjeta de Crédito',
            recur_group_id: installmentGroupId,
            id_consumo_tarjeta_origen: idConsumo
          });

          if (cardAccountId && targetAccountId !== cardAccountId) {
            const targetAccName = cuentaNombreMap[targetAccountId] || 'Externa';
            movRows.push({
              id_movimiento: crypto.randomUUID(),
              id_cuenta_principal: cardAccountId,
              user_id: userId,
              fecha: fechaCuota,
              id_categoria: 'CAT_REINTEGRO_TC',
              tipo_mov: 'INGRESO',
              descripcion: `Reintegro TC: ${consumo.descripcion} (${cuotaNumActual}/${consumo.cuotaTotal}) (${targetAccName})`,
              importe: cleanImporte,
              medio_pago: 'Tarjeta de Crédito',
              recur_group_id: installmentGroupId,
              id_consumo_tarjeta_origen: idConsumo
            });
          }
        }
      }
    } else if (tipo === 'RECURRENTE') {
      const recurGroupId = (scope === 'SERIES' && recurGrp) ? recurGrp : ('REC_TC_' + crypto.randomUUID());
      const numPeriodos = consumo.periodos || 12;
      for (let i = 0; i < numPeriodos; i++) {
        const idConsumo = crypto.randomUUID();
        const fechaRec = toIsoDateStr(addMonthsSafe(fechaBase, i));
        tcRows.push({
          id_consumo_tarjeta: idConsumo,
          id_tarjeta: consumo.idTarjeta,
          id_categoria: consumo.idCategoria,
          user_id: userId,
          fecha: fechaRec,
          descripcion: consumo.descripcion,
          importe: cleanImporte,
          recur_group_id: recurGroupId
        });
        if (consumo.imputar && targetAccountId) {
          movRows.push({
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: targetAccountId,
            user_id: userId,
            fecha: fechaRec,
            id_categoria: consumo.idCategoria,
            tipo_mov: 'EGRESO',
            descripcion: consumo.descripcion,
            importe: cleanImporte,
            medio_pago: 'Tarjeta de Crédito',
            recur_group_id: recurGroupId,
            id_consumo_tarjeta_origen: idConsumo
          });

          if (cardAccountId && targetAccountId !== cardAccountId) {
            const targetAccName = cuentaNombreMap[targetAccountId] || 'Externa';
            movRows.push({
              id_movimiento: crypto.randomUUID(),
              id_cuenta_principal: cardAccountId,
              user_id: userId,
              fecha: fechaRec,
              id_categoria: 'CAT_REINTEGRO_TC',
              tipo_mov: 'INGRESO',
              descripcion: `Reintegro TC: ${consumo.descripcion} (${targetAccName})`,
              importe: cleanImporte,
              medio_pago: 'Tarjeta de Crédito',
              recur_group_id: recurGroupId,
              id_consumo_tarjeta_origen: idConsumo
            });
          }
        }
      }
    }

    if (tcRows.length > 0) {
      const { error: tcErr } = await supabase.from('consumos_tc').insert(tcRows);
      if (tcErr) {
        console.error('[updateConsumoTC] Error inserting tcRows:', tcErr);
        throw tcErr;
      }
    }
    if (movRows.length > 0) {
      const { error: movErr } = await supabase.from('movimientos').insert(movRows);
      if (movErr) {
        console.error('[updateConsumoTC] Error inserting movRows:', movErr);
        throw movErr;
      }
    }

    return res.status(200).json({ success: true, data: {} });
  } catch (err) {
    console.error('[API -> updateConsumoTC]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
