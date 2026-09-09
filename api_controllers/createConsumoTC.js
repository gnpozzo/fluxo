import { getSupabaseClient } from '../api_lib/supabase.js';
import { verifyCuentaOwnership } from '../api_lib/auth.js';
import crypto from 'crypto';

function addMonthsSafe(date, months) {
  const d = new Date(date);
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
    let consumo = req.body;
    if (Array.isArray(consumo)) {
      consumo = consumo[0];
    } else if (consumo && Array.isArray(consumo.args)) {
      consumo = consumo.args[0];
    } else if (typeof consumo === 'string') {
      try {
        const parsed = JSON.parse(consumo);
        consumo = Array.isArray(parsed) ? parsed[0] : (parsed.args ? parsed.args[0] : parsed);
      } catch (e) {}
    }
    consumo = consumo || {};
    
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    // Validate tarjeta ownership
    if (consumo.idTarjeta) {
      const { data: tc } = await supabase.from('tarjetas').select('id_tarjeta').eq('id_tarjeta', consumo.idTarjeta).eq('user_id', userId).maybeSingle();
      if (!tc) return res.status(403).json({ success: false, error: 'Acceso denegado: La tarjeta no pertenece al usuario autenticado.' });
    }

    // Validate account if imputed
    if (consumo.imputar && consumo.idCuentaImputar) {
      const isOwner = await verifyCuentaOwnership(supabase, consumo.idCuentaImputar, userId);
      if (!isOwner) return res.status(403).json({ success: false, error: 'Acceso denegado: La cuenta seleccionada para imputar no pertenece al usuario autenticado.' });
    }

    const tcRows = [];
    const movRows = [];

    // --- MODO BATCH (Importación completa de resumen en una sola llamada) ---
    if (consumo.batch && Array.isArray(consumo.consumos)) {
      const targetCardId = consumo.idTarjeta;
      const targetAccountId = consumo.idCuentaImputar || consumo.idCuenta;

      for (const item of consumo.consumos) {
        const idConsumo = crypto.randomUUID();
        const monedaItem = item.moneda || 'ARS';
        const fechaISO = (item.fecha ? String(item.fecha).substring(0, 10) : new Date().toISOString().split('T')[0]);
        const cuotaTot = Number(item.cuotaTotal || item.cuota_total || 1);
        const cuotaAct = Number(item.cuotaActual || item.cuota_actual || 1);

        tcRows.push({
          id_consumo_tarjeta: idConsumo,
          id_tarjeta: targetCardId,
          id_categoria: item.idCategoria || item.id_categoria || null,
          user_id: userId,
          fecha: fechaISO,
          descripcion: item.descripcion,
          importe: Number(item.importe || 0),
          moneda: monedaItem,
          cuota_actual: cuotaTot > 1 ? cuotaAct : null,
          cuota_total: cuotaTot > 1 ? cuotaTot : null,
          recur_group_id: cuotaTot > 1 ? (item.recur_group_id || ('INSTL_' + crypto.randomUUID())) : null
        });

        if (consumo.imputar && targetAccountId) {
          movRows.push({
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: targetAccountId,
            user_id: userId,
            fecha: fechaISO,
            id_categoria: item.idCategoria || item.id_categoria || null,
            tipo_mov: 'EGRESO',
            descripcion: item.descripcion + (cuotaTot > 1 ? ` (${cuotaAct}/${cuotaTot})` : ''),
            importe: Number(item.importe || 0),
            moneda: monedaItem,
            medio_pago: 'Tarjeta de Crédito',
            id_consumo_tarjeta_origen: idConsumo
          });
        }
      }

      // Si viene metadata del resumen, actualizamos la tarjeta y creamos recordatorios automáticos
      if (consumo.statementInfo && targetCardId) {
        const st = consumo.statementInfo;
        const updateFields = {};
        if (st.fecha_cierre) updateFields.fecha_cierre_actual = st.fecha_cierre;
        if (st.fecha_vencimiento) updateFields.fecha_vencimiento_actual = st.fecha_vencimiento;
        if (st.proximo_cierre) updateFields.proximo_cierre = st.proximo_cierre;
        if (st.proximo_vencimiento) updateFields.proximo_vencimiento = st.proximo_vencimiento;
        if (st.total_ars != null) updateFields.total_resumen_ars = Number(st.total_ars);
        if (st.total_usd != null) updateFields.total_resumen_usd = Number(st.total_usd);

        if (Object.keys(updateFields).length > 0) {
          await supabase.from('tarjetas').update(updateFields).eq('id_tarjeta', targetCardId).eq('user_id', userId);
        }

        // Generar recordatorios automáticos de cierre y vencimiento
        if (st.fecha_vencimiento) {
          const vDate = new Date(st.fecha_vencimiento + 'T12:00:00Z');
          const reminderVto = new Date(vDate);
          reminderVto.setDate(reminderVto.getDate() - 3); // 3 días antes
          const remVtoStr = reminderVto.toISOString().split('T')[0];

          const saldoArsStr = st.total_ars ? `$ ${Number(st.total_ars).toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : '$ 0,00';
          const saldoUsdStr = st.total_usd ? ` y U$S ${Number(st.total_usd).toFixed(2)}` : '';
          const msgVto = `Tu resumen de tarjeta vence el ${st.fecha_vencimiento.split('-').reverse().join('/')}. Saldo a pagar: ${saldoArsStr}${saldoUsdStr}`;

          await supabase.from('recordatorios').insert([{
            id_recordatorio: crypto.randomUUID(),
            id_cuenta_principal: targetAccountId,
            user_id: userId,
            mensaje: msgVto,
            fecha_proxima: remVtoStr,
            frecuencia: 'MENSUAL',
            canales: 'app,telegram',
            activa: true
          }]);
        }

        if (st.proximo_cierre) {
          const cDate = new Date(st.proximo_cierre + 'T12:00:00Z');
          cDate.setDate(cDate.getDate() - 2); // 2 días antes del cierre
          const remCierreStr = cDate.toISOString().split('T')[0];
          const msgCierre = `Aviso de cierre: Tu tarjeta cierra su ciclo el ${st.proximo_cierre.split('-').reverse().join('/')}`;

          await supabase.from('recordatorios').insert([{
            id_recordatorio: crypto.randomUUID(),
            id_cuenta_principal: targetAccountId,
            user_id: userId,
            mensaje: msgCierre,
            fecha_proxima: remCierreStr,
            frecuencia: 'MENSUAL',
            canales: 'app,telegram',
            activa: true
          }]);
        }
      }

    } else {
      // --- MODO INDIVIDUAL ---
      const fechaBase = new Date(consumo.fecha + 'T12:00:00Z');
      const moneda = consumo.moneda || 'ARS';

      if (consumo.tipoConsumo === 'COMUN' || consumo.tipoConsumo === 'SIMPLE') {
        const idConsumo = crypto.randomUUID();
        const fechaISO = fechaBase.toISOString().split('T')[0];
        
        tcRows.push({
          id_consumo_tarjeta: idConsumo,
          id_tarjeta: consumo.idTarjeta,
          id_categoria: consumo.idCategoria,
          user_id: userId,
          fecha: fechaISO,
          descripcion: consumo.descripcion,
          importe: consumo.importe,
          moneda: moneda
        });

        if (consumo.imputar) {
          movRows.push({
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: consumo.idCuentaImputar,
            user_id: userId,
            fecha: fechaISO,
            id_categoria: consumo.idCategoria,
            tipo_mov: 'EGRESO',
            descripcion: consumo.descripcion,
            importe: consumo.importe,
            moneda: moneda,
            medio_pago: 'Tarjeta de Crédito',
            id_consumo_tarjeta_origen: idConsumo
          });
        }
      } else if (consumo.tipoConsumo === 'CUOTAS') {
        const installmentGroupId = 'INSTL_' + crypto.randomUUID();
      const cuotasARegistrar = (consumo.cuotaTotal - consumo.cuotaActual) + 1;
      
      for (let i = 0; i < cuotasARegistrar; i++) {
        const idConsumo = crypto.randomUUID();
        const cuotaNumActual = consumo.cuotaActual + i;
        const fechaISO = addMonthsSafe(fechaBase, cuotaNumActual - 1).toISOString().split('T')[0];
        
        tcRows.push({
          id_consumo_tarjeta: idConsumo,
          id_tarjeta: consumo.idTarjeta,
          id_categoria: consumo.idCategoria,
          user_id: userId,
          fecha: fechaISO,
          descripcion: consumo.descripcion,
          importe: consumo.importe,
          moneda: moneda,
          cuota_actual: cuotaNumActual,
          cuota_total: consumo.cuotaTotal,
          recur_group_id: installmentGroupId
        });

        if (consumo.imputar) {
          const descImputacion = consumo.descripcion + ' (Cuota ' + cuotaNumActual + '/' + consumo.cuotaTotal + ')';
          movRows.push({
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: consumo.idCuentaImputar,
            user_id: userId,
            fecha: fechaISO,
            id_categoria: consumo.idCategoria,
            tipo_mov: 'EGRESO',
            descripcion: descImputacion,
            importe: consumo.importe,
            moneda: moneda,
            medio_pago: 'Tarjeta de Crédito',
            recur_group_id: installmentGroupId,
            id_consumo_tarjeta_origen: idConsumo
          });
        }
      }

    } else if (consumo.tipoConsumo === 'RECURRENTE') {
      const recurGroupId = 'REC_TC_' + crypto.randomUUID();
      
      for (let i = 0; i < consumo.periodos; i++) {
        const idConsumo = crypto.randomUUID();
        const fechaISO = addMonthsSafe(fechaBase, i).toISOString().split('T')[0];
        
        tcRows.push({
          id_consumo_tarjeta: idConsumo,
          id_tarjeta: consumo.idTarjeta,
          id_categoria: consumo.idCategoria,
          user_id: userId,
          fecha: fechaISO,
          descripcion: consumo.descripcion,
          importe: consumo.importe,
          moneda: moneda,
          recur_group_id: recurGroupId
        });

        if (consumo.imputar) {
          movRows.push({
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: consumo.idCuentaImputar,
            user_id: userId,
            fecha: fechaISO,
            id_categoria: consumo.idCategoria,
            tipo_mov: 'EGRESO',
            descripcion: consumo.descripcion,
            importe: consumo.importe,
            moneda: moneda,
            medio_pago: 'Tarjeta de Crédito',
            recur_group_id: recurGroupId,
            id_consumo_tarjeta_origen: idConsumo
          });
        }
      }
    }
  }

    if (tcRows.length > 0) {
      const { error: tcError } = await supabase.from('consumos_tc').insert(tcRows);
      if (tcError) throw tcError;
    }
    if (movRows.length > 0) {
      const { error: movError } = await supabase.from('movimientos').insert(movRows);
      if (movError) throw movError;
    }

    return res.status(200).json({ success: true, data: { tcCount: tcRows.length, movCount: movRows.length } });
  } catch (err) {
    console.error('[API -> createConsumoTC]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
