import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const rawArgs = Array.isArray(req.body?.args) ? req.body.args : (Array.isArray(req.body) ? req.body : null);
    let request = (typeof req.body === 'object' && req.body !== null) ? req.body : {};
    if (typeof req.body === 'string') {
      try { request = JSON.parse(req.body); } catch (_) {}
    }
    if (rawArgs && rawArgs.length > 0) {
      if (typeof rawArgs[0] === 'object' && rawArgs[0] !== null) {
        request = { ...request, ...rawArgs[0] };
      } else {
        request = {
          ...request,
          consumoId: rawArgs[0],
          scope: rawArgs[1] || request.scope || 'SINGLE',
          recurGroupId: rawArgs[2] || request.recurGroupId,
          fecha: rawArgs[3] || request.fecha
        };
      }
    }
    
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const rawScope = request.scope || 'SINGLE';
    const consumoId = request.consumoId || request.id || request.id_consumo_tarjeta || request.id_consumo_tc || (rawArgs ? rawArgs[0] : null);
    const scope = (rawScope === 'ALL' || consumoId === 'ALL') ? 'ALL' : rawScope;

    if (scope === 'ALL' || scope === 'MONTH' || scope === 'MONTH_AND_FUTURE') {
      const targetCardId = request.idTarjeta || request.id_tarjeta;
      let mes = request.mes;
      let fechaInicio = request.fechaInicio;
      let fechaFin = request.fechaFin;

      if (mes && (!fechaInicio || !fechaFin)) {
        const [y, mo] = mes.split('-').map(Number);
        const ultimo = new Date(y, mo, 0).getDate();
        fechaInicio = `${y}-${String(mo).padStart(2, '0')}-01`;
        fechaFin = `${y}-${String(mo).padStart(2, '0')}-${ultimo}`;
      }

      let query = supabase.from('consumos_tc').select('id_consumo_tarjeta').eq('user_id', userId);

      if (targetCardId) {
        query = query.eq('id_tarjeta', targetCardId);
      }

      if (scope === 'MONTH') {
        if (fechaInicio) query = query.gte('fecha', fechaInicio);
        if (fechaFin) query = query.lte('fecha', fechaFin);
      } else if (scope === 'MONTH_AND_FUTURE') {
        if (fechaInicio) query = query.gte('fecha', fechaInicio);
      }

      const { data: tcs, error: tcsErr } = await query;
      if (tcsErr) throw tcsErr;

      if (tcs && tcs.length > 0) {
        const ids = tcs.map(r => r.id_consumo_tarjeta);
        for (let i = 0; i < ids.length; i += 200) {
          const chunk = ids.slice(i, i + 200);
          await supabase.from('movimientos').delete().in('id_consumo_tarjeta_origen', chunk).eq('user_id', userId);
          await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', chunk).eq('user_id', userId);
        }

        // Limpiar registro de pagos en logs para los consumos eliminados
        try {
          const { data: logRow } = await supabase.from('logs').select('id, contexto').eq('user_id', userId).eq('accion', 'ESTADO_PAGO_TC').maybeSingle();
          if (logRow?.contexto) {
            const pagosMap = { ...logRow.contexto };
            let mod = false;
            ids.forEach(id => {
              if (pagosMap[id]) { delete pagosMap[id]; mod = true; }
            });
            if (targetCardId && mes) {
              const summaryKey = `RESUMEN_${targetCardId}_${mes}`;
              if (pagosMap[summaryKey]) { delete pagosMap[summaryKey]; mod = true; }
            }
            if (mod) {
              await supabase.from('logs').update({ contexto: pagosMap }).eq('id', logRow.id);
            }
          }
        } catch (e) {
          console.warn('[deleteConsumoTC] Error actualizando logs:', e.message);
        }
      } else if (scope === 'ALL' && !targetCardId) {
        // Fallback para limpiar posibles movimientos huérfanos asociados a tarjetas
        await supabase.from('movimientos').delete().not('id_consumo_tarjeta_origen', 'is', null).eq('user_id', userId);
        await supabase.from('consumos_tc').delete().eq('user_id', userId);
      }

      // Restablecer totales de resumen de tarjetas si el período eliminado coincide o es hacia adelante
      if (targetCardId) {
        let shouldReset = (scope === 'ALL' || scope === 'MONTH_AND_FUTURE');
        if (!shouldReset && scope === 'MONTH') {
          const targetMes = mes || (fechaInicio ? fechaInicio.substring(0, 7) : null);
          if (targetMes) {
            const { data: tcCard } = await supabase.from('tarjetas')
              .select('fecha_vencimiento_actual, fecha_cierre_actual')
              .eq('id_tarjeta', targetCardId)
              .eq('user_id', userId)
              .maybeSingle();
            if (tcCard && (
              (tcCard.fecha_vencimiento_actual && tcCard.fecha_vencimiento_actual.substring(0, 7) === targetMes) ||
              (tcCard.fecha_cierre_actual && tcCard.fecha_cierre_actual.substring(0, 7) === targetMes)
            )) {
              shouldReset = true;
            }
          }
        }
        if (shouldReset) {
          await supabase.from('tarjetas')
            .update({ total_resumen_ars: 0, total_resumen_usd: 0 })
            .eq('id_tarjeta', targetCardId)
            .eq('user_id', userId);
        }
      } else {
        if (scope === 'ALL') {
          await supabase.from('tarjetas')
            .update({ total_resumen_ars: 0, total_resumen_usd: 0 })
            .eq('user_id', userId);
        } else {
          const targetMes = mes || (fechaInicio ? fechaInicio.substring(0, 7) : null);
          if (targetMes) {
            const { data: allTcs } = await supabase.from('tarjetas')
              .select('id_tarjeta, fecha_vencimiento_actual, fecha_cierre_actual')
              .eq('user_id', userId);
            if (allTcs) {
              const dueCardIds = allTcs.filter(t => 
                (t.fecha_vencimiento_actual && t.fecha_vencimiento_actual.substring(0, 7) === targetMes) ||
                (t.fecha_cierre_actual && t.fecha_cierre_actual.substring(0, 7) === targetMes)
              ).map(t => t.id_tarjeta);
              if (dueCardIds.length > 0) {
                await supabase.from('tarjetas').update({ total_resumen_ars: 0, total_resumen_usd: 0 }).in('id_tarjeta', dueCardIds).eq('user_id', userId);
              }
            }
          }
        }
      }

      return res.status(200).json({ success: true, data: { message: 'Consumos eliminados correctamente.' } });
    } else if (scope === 'SINGLE') {
      await supabase.from('movimientos').delete().eq('id_consumo_tarjeta_origen', consumoId).eq('user_id', userId);
      const { data: deleted, error: delErr } = await supabase.from('consumos_tc').delete().eq('id_consumo_tarjeta', consumoId).eq('user_id', userId).select();
      if (delErr) throw delErr;
      if (!deleted || deleted.length === 0) {
        return res.status(404).json({ success: false, error: 'No se encontró el consumo de tarjeta para eliminar.' });
      }
    } else if (scope === 'SERIES') {
      let recurGrp = request.recurGroupId;
      if (!recurGrp && consumoId) {
        const { data: origTC } = await supabase.from('consumos_tc')
          .select('recur_group_id, fecha')
          .eq('id_consumo_tarjeta', consumoId)
          .eq('user_id', userId)
          .maybeSingle();
        if (origTC) {
          recurGrp = origTC.recur_group_id;
        }
      }

      if (!recurGrp) {
        // Fallback: eliminar solo este consumo si no pertenece a una serie identificable
        await supabase.from('movimientos').delete().eq('id_consumo_tarjeta_origen', consumoId).eq('user_id', userId);
        const { error: delSingleErr } = await supabase.from('consumos_tc').delete().eq('id_consumo_tarjeta', consumoId).eq('user_id', userId);
        if (delSingleErr) throw delSingleErr;
      } else {
        const { data: tcs, error: qErr } = await supabase.from('consumos_tc').select('id_consumo_tarjeta')
          .eq('recur_group_id', recurGrp)
          .eq('user_id', userId);
          
        if (qErr) throw qErr;

        if (tcs && tcs.length > 0) {
          const ids = tcs.map(r => r.id_consumo_tarjeta);
          for (let i = 0; i < ids.length; i += 200) {
            const chunk = ids.slice(i, i + 200);
            await supabase.from('movimientos').delete().in('id_consumo_tarjeta_origen', chunk).eq('user_id', userId);
            await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', chunk).eq('user_id', userId);
          }
        }
      }
    } else {
      throw new Error('Scope inválido');
    }

    return res.status(200).json({ success: true, data: {} });
  } catch (err) {
    console.error('[API -> deleteConsumoTC]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
