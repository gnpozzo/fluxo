import { getSupabaseClient } from '../api_lib/supabase.js';
import { verifyCuentaOwnership } from '../api_lib/auth.js';
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

    // Validate tarjeta ownership & resolve account linked to the card
    let cardAccountId = null;
    let cardVto = null;
    if (consumo.idTarjeta) {
      const { data: tc } = await supabase.from('tarjetas')
        .select('id_tarjeta, id_cuenta_principal, fecha_vencimiento_actual')
        .eq('id_tarjeta', consumo.idTarjeta)
        .eq('user_id', userId)
        .maybeSingle();
      if (!tc) return res.status(403).json({ success: false, error: 'Acceso denegado: La tarjeta no pertenece al usuario autenticado.' });
      cardAccountId = tc.id_cuenta_principal;
      cardVto = tc.fecha_vencimiento_actual;
    }

    // Mapping of account names to format compensation movements cleanly
    const { data: allUserCuentas } = await supabase
      .from('cuentas_principales')
      .select('id_cuenta_principal, nombre')
      .eq('user_id', userId);
    const cuentaNombreMap = {};
    (allUserCuentas || []).forEach(c => { cuentaNombreMap[c.id_cuenta_principal] = c.nombre; });

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

      // 1. Eliminar consumos que no correspondan según la conciliación
      if (Array.isArray(consumo.consumosAEliminar) && consumo.consumosAEliminar.length > 0) {
        await supabase.from('movimientos').delete().in('id_consumo_tarjeta_origen', consumo.consumosAEliminar).eq('user_id', userId);
        await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', consumo.consumosAEliminar).eq('user_id', userId);
      }

      // 2. Dar de baja recurrencias ausentes si el usuario así lo decidió
      if (Array.isArray(consumo.bajasRecurrencias) && consumo.bajasRecurrencias.length > 0) {
        const cutoffDate = (consumo.statementInfo?.fecha_cierre || new Date().toISOString().split('T')[0]);
        const { data: tcFuture } = await supabase.from('consumos_tc')
          .select('id_consumo_tarjeta')
          .in('recur_group_id', consumo.bajasRecurrencias)
          .gte('fecha', cutoffDate)
          .eq('user_id', userId);
        const idsToDel = (tcFuture || []).map(t => t.id_consumo_tarjeta);
        if (idsToDel.length > 0) {
          await supabase.from('movimientos').delete().in('id_consumo_tarjeta_origen', idsToDel).eq('user_id', userId);
          await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', idsToDel).eq('user_id', userId);
        }
      }

      // 3. Procesar consumos del resumen y proyectar cuotas y recurrencias
      const stVto = consumo.statementInfo?.fecha_vencimiento;
      const stCierre = consumo.statementInfo?.fecha_cierre;

      for (const item of consumo.consumos) {
        const idConsumo = crypto.randomUUID();
        const monedaItem = item.moneda || 'ARS';
        // La fecha del consumo de tarjeta se imputa SIEMPRE al vencimiento del resumen (pago diferido)
        const fechaISO = (stVto ? String(stVto).substring(0, 10) : (item.fecha ? String(item.fecha).substring(0, 10) : new Date().toISOString().split('T')[0]));
        const cuotaTot = Number(item.cuotaTotal || item.cuota_total || 1);
        const cuotaAct = Number(item.cuotaActual || item.cuota_actual || 1);
        const tipoConsumo = item.tipoConsumo || (cuotaTot > 1 ? 'CUOTAS' : 'SIMPLE');
        const rowAccountId = item.idCuentaImputar || targetAccountId;

        let recurGroupId = item.recur_group_id || null;
        if (tipoConsumo === 'CUOTAS' && cuotaTot > 1 && !recurGroupId) {
          recurGroupId = 'INSTL_' + crypto.randomUUID();
        } else if (tipoConsumo === 'RECURRENTE' && !recurGroupId) {
          recurGroupId = 'REC_TC_' + crypto.randomUUID();
        }

        // Si ya existía un registro previo proyectado de esta misma cuota en la base, evitar duplicado
        if (tipoConsumo === 'CUOTAS' && cuotaTot > 1) {
          const { data: existingCuota } = await supabase.from('consumos_tc')
            .select('id_consumo_tarjeta')
            .eq('id_tarjeta', targetCardId)
            .eq('descripcion', item.descripcion)
            .eq('cuota_actual', cuotaAct)
            .eq('cuota_total', cuotaTot)
            .eq('user_id', userId);
          if (existingCuota && existingCuota.length > 0) {
            const exIds = existingCuota.map(e => e.id_consumo_tarjeta);
            await supabase.from('movimientos').delete().in('id_consumo_tarjeta_origen', exIds).eq('user_id', userId);
            await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', exIds).eq('user_id', userId);
          }

          // Si es la última cuota (ej: 6/6), asegurarse de eliminar cualquier proyección futura residual de esta serie
          if (cuotaAct >= cuotaTot && recurGroupId) {
            const { data: trailingCuotas } = await supabase.from('consumos_tc')
              .select('id_consumo_tarjeta')
              .eq('id_tarjeta', targetCardId)
              .eq('recur_group_id', recurGroupId)
              .gt('fecha', fechaISO)
              .eq('user_id', userId);
            if (trailingCuotas && trailingCuotas.length > 0) {
              const trIds = trailingCuotas.map(e => e.id_consumo_tarjeta);
              await supabase.from('movimientos').delete().in('id_consumo_tarjeta_origen', trIds).eq('user_id', userId);
              await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', trIds).eq('user_id', userId);
            }
          }
        }

        // Si ya existían registros de este recurGroupId con fecha >= fechaISO, eliminamos para actualizar con los nuevos importes
        if (tipoConsumo === 'RECURRENTE' && recurGroupId) {
          const { data: existingRecur } = await supabase.from('consumos_tc')
            .select('id_consumo_tarjeta')
            .eq('id_tarjeta', targetCardId)
            .eq('recur_group_id', recurGroupId)
            .gte('fecha', fechaISO)
            .eq('user_id', userId);
          if (existingRecur && existingRecur.length > 0) {
            const exIds = existingRecur.map(e => e.id_consumo_tarjeta);
            await supabase.from('movimientos').delete().in('id_consumo_tarjeta_origen', exIds).eq('user_id', userId);
            await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', exIds).eq('user_id', userId);
          }
        }

        // Consumo del período auditado
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
          recur_group_id: recurGroupId
        });

        if (consumo.imputar && rowAccountId) {
          // 1. Egreso en la cuenta imputada (ej: Hogar)
          movRows.push({
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: rowAccountId,
            user_id: userId,
            fecha: fechaISO,
            id_categoria: item.idCategoria || item.id_categoria || null,
            tipo_mov: 'EGRESO',
            descripcion: item.descripcion + (cuotaTot > 1 ? ` (${cuotaAct}/${cuotaTot})` : ''),
            importe: Number(item.importe || 0),
            moneda: monedaItem,
            medio_pago: 'Tarjeta de Crédito',
            id_consumo_tarjeta_origen: idConsumo,
            recur_group_id: recurGroupId
          });

          // 2. Si es una imputación externa (la tarjeta pertenece a otra cuenta, ej: Personal):
          // Se genera un INGRESO por reintegro en la cuenta de la tarjeta al vencimiento del resumen.
          if (cardAccountId && rowAccountId !== cardAccountId) {
            const fechaReintegro = stVto || cardVto || fechaISO;
            const targetAccName = cuentaNombreMap[rowAccountId] || 'Externa';
            movRows.push({
              id_movimiento: crypto.randomUUID(),
              id_cuenta_principal: cardAccountId,
              user_id: userId,
              fecha: fechaReintegro,
              id_categoria: 'CAT_REINTEGRO_TC',
              tipo_mov: 'INGRESO',
              descripcion: `Reintegro TC: ${item.descripcion}${cuotaTot > 1 ? ` (${cuotaAct}/${cuotaTot})` : ''} (${targetAccName})`,
              importe: Number(item.importe || 0),
              moneda: monedaItem,
              medio_pago: 'Tarjeta de Crédito',
              id_consumo_tarjeta_origen: idConsumo,
              recur_group_id: recurGroupId
            });
          }
        }

        // Base para proyecciones futuras (mes consecutivo a partir de la fecha del consumo)
        const baseDate = new Date(fechaISO + 'T12:00:00Z');

        // A) Proyección a futuro de cuotas restantes (X+1 ... N)
        if (tipoConsumo === 'CUOTAS' && cuotaTot > cuotaAct) {
          const restantes = cuotaTot - cuotaAct;
          for (let i = 1; i <= restantes; i++) {
            const cuotaFutura = cuotaAct + i;
            const fechaFutura = addMonthsSafe(baseDate, i).toISOString().split('T')[0];
            const idFuturo = crypto.randomUUID();

            tcRows.push({
              id_consumo_tarjeta: idFuturo,
              id_tarjeta: targetCardId,
              id_categoria: item.idCategoria || item.id_categoria || null,
              user_id: userId,
              fecha: fechaFutura,
              descripcion: item.descripcion,
              importe: Number(item.importe || 0),
              moneda: monedaItem,
              cuota_actual: cuotaFutura,
              cuota_total: cuotaTot,
              recur_group_id: recurGroupId
            });

            // Imputación persistente hacia la cuenta destino
            if (consumo.imputar && rowAccountId) {
              movRows.push({
                id_movimiento: crypto.randomUUID(),
                id_cuenta_principal: rowAccountId,
                user_id: userId,
                fecha: fechaFutura,
                id_categoria: item.idCategoria || item.id_categoria || null,
                tipo_mov: 'EGRESO',
                descripcion: `${item.descripcion} (${cuotaFutura}/${cuotaTot})`,
                importe: Number(item.importe || 0),
                moneda: monedaItem,
                medio_pago: 'Tarjeta de Crédito',
                id_consumo_tarjeta_origen: idFuturo,
                recur_group_id: recurGroupId
              });

              if (cardAccountId && rowAccountId !== cardAccountId) {
                const targetAccName = cuentaNombreMap[rowAccountId] || 'Externa';
                movRows.push({
                  id_movimiento: crypto.randomUUID(),
                  id_cuenta_principal: cardAccountId,
                  user_id: userId,
                  fecha: fechaFutura,
                  id_categoria: 'CAT_REINTEGRO_TC',
                  tipo_mov: 'INGRESO',
                  descripcion: `Reintegro TC: ${item.descripcion} (${cuotaFutura}/${cuotaTot}) (${targetAccName})`,
                  importe: Number(item.importe || 0),
                  moneda: monedaItem,
                  medio_pago: 'Tarjeta de Crédito',
                  id_consumo_tarjeta_origen: idFuturo,
                  recur_group_id: recurGroupId
                });
              }
            }
          }
        }

        // B) Proyección de consumos recurrentes (próximos 11 meses con el importe actualizado)
        if (tipoConsumo === 'RECURRENTE') {
          for (let i = 1; i <= 11; i++) {
            const fechaFutura = addMonthsSafe(baseDate, i).toISOString().split('T')[0];
            const idFuturo = crypto.randomUUID();

            tcRows.push({
              id_consumo_tarjeta: idFuturo,
              id_tarjeta: targetCardId,
              id_categoria: item.idCategoria || item.id_categoria || null,
              user_id: userId,
              fecha: fechaFutura,
              descripcion: item.descripcion,
              importe: Number(item.importe || 0),
              moneda: monedaItem,
              cuota_actual: null,
              cuota_total: null,
              recur_group_id: recurGroupId
            });

            // Imputación persistente hacia la cuenta destino
            if (consumo.imputar && rowAccountId) {
              movRows.push({
                id_movimiento: crypto.randomUUID(),
                id_cuenta_principal: rowAccountId,
                user_id: userId,
                fecha: fechaFutura,
                id_categoria: item.idCategoria || item.id_categoria || null,
                tipo_mov: 'EGRESO',
                descripcion: item.descripcion,
                importe: Number(item.importe || 0),
                moneda: monedaItem,
                medio_pago: 'Tarjeta de Crédito',
                id_consumo_tarjeta_origen: idFuturo,
                recur_group_id: recurGroupId
              });

              if (cardAccountId && rowAccountId !== cardAccountId) {
                const targetAccName = cuentaNombreMap[rowAccountId] || 'Externa';
                movRows.push({
                  id_movimiento: crypto.randomUUID(),
                  id_cuenta_principal: cardAccountId,
                  user_id: userId,
                  fecha: fechaFutura,
                  id_categoria: 'CAT_REINTEGRO_TC',
                  tipo_mov: 'INGRESO',
                  descripcion: `Reintegro TC: ${item.descripcion} (${targetAccName})`,
                  importe: Number(item.importe || 0),
                  moneda: monedaItem,
                  medio_pago: 'Tarjeta de Crédito',
                  id_consumo_tarjeta_origen: idFuturo,
                  recur_group_id: recurGroupId
                });
              }
            }
          }
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

          if (cardAccountId && consumo.idCuentaImputar !== cardAccountId) {
            const fechaReintegro = cardVto || fechaISO;
            const targetAccName = cuentaNombreMap[consumo.idCuentaImputar] || 'Externa';
            movRows.push({
              id_movimiento: crypto.randomUUID(),
              id_cuenta_principal: cardAccountId,
              user_id: userId,
              fecha: fechaReintegro,
              id_categoria: 'CAT_REINTEGRO_TC',
              tipo_mov: 'INGRESO',
              descripcion: `Reintegro TC: ${consumo.descripcion} (${targetAccName})`,
              importe: consumo.importe,
              moneda: moneda,
              medio_pago: 'Tarjeta de Crédito',
              id_consumo_tarjeta_origen: idConsumo
            });
          }
        }
      } else if (consumo.tipoConsumo === 'CUOTAS') {
        const installmentGroupId = 'INSTL_' + crypto.randomUUID();
      const cuotasARegistrar = (consumo.cuotaTotal - consumo.cuotaActual) + 1;
      
      for (let i = 0; i < cuotasARegistrar; i++) {
        const idConsumo = crypto.randomUUID();
        const cuotaNumActual = consumo.cuotaActual + i;
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

          if (cardAccountId && consumo.idCuentaImputar !== cardAccountId) {
            const targetAccName = cuentaNombreMap[consumo.idCuentaImputar] || 'Externa';
            movRows.push({
              id_movimiento: crypto.randomUUID(),
              id_cuenta_principal: cardAccountId,
              user_id: userId,
              fecha: fechaISO,
              id_categoria: 'CAT_REINTEGRO_TC',
              tipo_mov: 'INGRESO',
              descripcion: `Reintegro TC: ${consumo.descripcion} (${cuotaNumActual}/${consumo.cuotaTotal}) (${targetAccName})`,
              importe: consumo.importe,
              moneda: moneda,
              medio_pago: 'Tarjeta de Crédito',
              recur_group_id: installmentGroupId,
              id_consumo_tarjeta_origen: idConsumo
            });
          }
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

          if (cardAccountId && consumo.idCuentaImputar !== cardAccountId) {
            const targetAccName = cuentaNombreMap[consumo.idCuentaImputar] || 'Externa';
            movRows.push({
              id_movimiento: crypto.randomUUID(),
              id_cuenta_principal: cardAccountId,
              user_id: userId,
              fecha: fechaISO,
              id_categoria: 'CAT_REINTEGRO_TC',
              tipo_mov: 'INGRESO',
              descripcion: `Reintegro TC: ${consumo.descripcion} (${targetAccName})`,
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
