import { getSupabaseClient } from '../api_lib/supabase.js';
import { resolveUserCuenta } from '../api_lib/auth.js';
import crypto from 'crypto';

// Mapping frontend UI frequencies to month step intervals
const FREQ_MAP = {
  MENSUAL: 1,
  BIMESTRAL: 2,
  TRIMESTRAL: 3,
  SEMESTRAL: 6,
  ANUAL: 12
};

function addMonthsSafe(date, months) {
  const d = new Date(date);
  const targetMonth = d.getMonth() + months;
  d.setMonth(targetMonth);
  return d;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const bodyArgs = Array.isArray(req.body?.args) ? req.body.args : (Array.isArray(req.body) ? req.body : null);
    let request = null;
    let rawScope = null;
    const rawId = (typeof bodyArgs?.[0] === 'string') ? bodyArgs[0] : null;

    if (bodyArgs) {
      if (bodyArgs[1] && typeof bodyArgs[1] === 'object') {
        request = bodyArgs[1];
        rawScope = typeof bodyArgs[3] === 'string' ? bodyArgs[3] : (typeof bodyArgs[2] === 'string' ? bodyArgs[2] : null);
      } else if (bodyArgs[0] && typeof bodyArgs[0] === 'object') {
        request = bodyArgs[0];
      } else {
        request = {};
      }
    } else if (req.body && typeof req.body === 'object') {
      request = req.body;
    } else {
      request = {};
    }
    
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const { original = {}, data = {} } = request || {};
    const scope = request.scope || rawScope || 'SINGLE';
    const mov = (data && Object.keys(data).length > 0) ? data : request;
    const targetId = original.movimientoId || original.id || original.id_movimiento || rawId || request.id || mov.id_movimiento;

    if (mov?.idCuenta) {
      const resolved = await resolveUserCuenta(supabase, mov.idCuenta, userId);
      if (!resolved) {
        return res.status(403).json({ success: false, error: 'Acceso denegado: La cuenta seleccionada no pertenece al usuario autenticado.' });
      }
      mov.idCuenta = resolved;
    }

    let origRecurGroupId = original.recurGroupId;
    let origSplitGroupId = original.splitGroupId;
    let origFecha = original.fecha ? String(original.fecha).substring(0, 10) : null;

    if (targetId && (!origRecurGroupId || !origFecha)) {
      const { data: existingMov } = await supabase
        .from('movimientos')
        .select('recur_group_id, split_group_id, fecha, descripcion')
        .eq('id_movimiento', targetId)
        .eq('user_id', userId)
        .maybeSingle();
      if (existingMov) {
        if (!origRecurGroupId) origRecurGroupId = existingMov.recur_group_id;
        if (!origSplitGroupId) origSplitGroupId = existingMov.split_group_id;
        if (!origFecha) origFecha = String(existingMov.fecha || '').substring(0, 10);
      }
    }

    const isOriginalRecurrente = Boolean(origRecurGroupId);
    const isOriginalSplit = Boolean(origSplitGroupId);
    const isMovRecurrente = mov.tipoConsumo === 'RECURRENTE' || mov.tipoConsumo === 'CUOTAS';
    const isComplexityChanging = isMovRecurrente !== isOriginalRecurrente || Boolean(mov.esSplit) !== isOriginalSplit;

    if (scope !== 'SINGLE' || isComplexityChanging) {
      // 1. DELETE (scoped to user_id)
      if (scope === 'SINGLE') {
        if (targetId) await supabase.from('movimientos').delete().eq('id_movimiento', targetId).eq('user_id', userId);
      } else if (scope === 'GROUP') {
        if (origSplitGroupId) {
          const { data: groupMovs } = await supabase.from('movimientos').select('id_consumo_tarjeta_origen').eq('split_group_id', origSplitGroupId).eq('user_id', userId);
          if (groupMovs) {
            const tcIds = groupMovs.filter(r => r.id_consumo_tarjeta_origen).map(r => r.id_consumo_tarjeta_origen);
            if (tcIds.length > 0) await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', tcIds).eq('user_id', userId);
          }
          await supabase.from('movimientos').delete().eq('split_group_id', origSplitGroupId).eq('user_id', userId);
        }
      } else if (scope === 'SERIES') {
        if (origRecurGroupId && origFecha) {
          const { data: seriesMovs } = await supabase.from('movimientos').select('id_consumo_tarjeta_origen').eq('recur_group_id', origRecurGroupId).gte('fecha', origFecha).eq('user_id', userId);
          if (seriesMovs) {
            const tcIds = seriesMovs.filter(r => r.id_consumo_tarjeta_origen).map(r => r.id_consumo_tarjeta_origen);
            if (tcIds.length > 0) await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', tcIds).eq('user_id', userId);
          }
          await supabase.from('movimientos').delete().eq('recur_group_id', origRecurGroupId).gte('fecha', origFecha).eq('user_id', userId);
        } else if (targetId) {
          await supabase.from('movimientos').delete().eq('id_movimiento', targetId).eq('user_id', userId);
        }
      }

      if (scope === 'SINGLE' && (isOriginalRecurrente || isOriginalSplit)) {
        mov.tipoConsumo = 'COMUN';
        mov.esSplit = false;
      }
      
      // 2. CREATE (Inline)
      const rows = [];
      const fechaBase = new Date((mov.fecha ? String(mov.fecha).substring(0, 10) : (origFecha || new Date().toISOString().substring(0, 10))) + 'T12:00:00Z');
      let pctRetenido = 100;
      const destinos = [];
      if (mov.esSplit && Array.isArray(mov.splitDestinos)) {
        mov.splitDestinos.forEach(d => {
          const pct = parseFloat(d.pct);
          pctRetenido -= pct;
          destinos.push({ cuenta: d.cuenta, pct: pct / 100 });
        });
      }
      let periodos = 1;
      let esCuotas = false;
      let groupIdPrefix = 'REC_';
      let monthStep = 1;

      if (mov.tipoConsumo === 'CUOTAS') {
        periodos = Math.max(1, (Number(mov.cuotaTotal) || 2) - (Number(mov.cuotaActual) || 1) + 1);
        esCuotas = true;
        groupIdPrefix = 'INSTL_';
      } else if (mov.tipoConsumo === 'RECURRENTE') {
        periodos = Math.max(1, Number(mov.periodos) || 12);
        monthStep = FREQ_MAP[mov.frecuencia] || 1;
      }
      if (periodos < 1) periodos = 1;
      const isSeries = periodos > 1;

      // Preserve existing series identifier when updating a series to maintain continuity
      let seriesGroupId = null;
      if (isSeries) {
        if (origRecurGroupId) {
          seriesGroupId = esCuotas ? origRecurGroupId.replace(/^REC_/, 'INSTL_') : origRecurGroupId.replace(/^INSTL_/, 'REC_');
        } else {
          seriesGroupId = groupIdPrefix + crypto.randomUUID();
        }
      }

      // Sanitize description to remove any residual cuota annotations
      const baseDesc = (mov.descripcion || '')
        .replace(/\s*\(Cuota\s+\d+\/\d+\)/gi, '')
        .replace(/\s*\(\d+\/\d+\)/g, '')
        .trim();

      for (let i = 0; i < periodos; i++) {
        const monthsToAdd = esCuotas ? i : (i * monthStep);
        const fechaISO = addMonthsSafe(fechaBase, monthsToAdd).toISOString().split('T')[0];
        let desc = baseDesc;
        if (esCuotas) {
          const cuotaNro = (Number(mov.cuotaActual) || 1) + i;
          desc = `${baseDesc} (Cuota ${cuotaNro}/${mov.cuotaTotal})`;
        }

        if (mov.esSplit && destinos.length > 0) {
          const splitGroupId = 'SPLIT_' + crypto.randomUUID();
          destinos.forEach(d => {
            rows.push({
              id_movimiento: crypto.randomUUID(),
              id_cuenta_principal: d.cuenta,
              user_id: userId,
              fecha: fechaISO,
              id_categoria: mov.idCategoria,
              tipo_mov: mov.tipo,
              descripcion: desc,
              importe: mov.importe * d.pct,
              medio_pago: mov.medioPago,
              recur_group_id: seriesGroupId,
              split_group_id: splitGroupId,
              split_rol: 'DESTINO'
            });
          });
          if (pctRetenido > 0) {
            rows.push({
              id_movimiento: crypto.randomUUID(),
              id_cuenta_principal: mov.idCuenta,
              user_id: userId,
              fecha: fechaISO,
              id_categoria: mov.idCategoria,
              tipo_mov: mov.tipo,
              descripcion: desc,
              importe: mov.importe * (pctRetenido / 100),
              medio_pago: mov.medioPago,
              recur_group_id: seriesGroupId,
              split_group_id: splitGroupId,
              split_rol: 'ORIGEN'
            });
          }
        } else {
          const rowObj = {
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: mov.idCuenta,
            user_id: userId,
            fecha: fechaISO,
            id_categoria: mov.idCategoria,
            tipo_mov: mov.tipo,
            descripcion: desc,
            importe: mov.importe,
            medio_pago: mov.medioPago,
            recur_group_id: seriesGroupId
          };
          if (esCuotas && mov.idTarjetaCuotas) {
            rowObj.id_consumo_tarjeta_origen = mov.idTarjetaCuotas;
          }
          rows.push(rowObj);
        }
      }

      if (rows.length > 0) {
        const { error } = await supabase.from('movimientos').insert(rows);
        if (error) throw error;
      }

    } else {
      // UPDATE SIMPLE (scoped to user_id)
      const baseDesc = (mov.descripcion || '')
        .replace(/\s*\(Cuota\s+\d+\/\d+\)/gi, '')
        .replace(/\s*\(\d+\/\d+\)/g, '')
        .trim();
      let finalDesc = baseDesc;
      if (mov.tipoConsumo === 'CUOTAS' && Number(mov.cuotaTotal) > 1) {
        finalDesc = `${baseDesc} (Cuota ${mov.cuotaActual || 1}/${mov.cuotaTotal})`;
      }
      const updatePayload = {
        fecha: mov.fecha ? String(mov.fecha).substring(0, 10) : undefined,
        id_categoria: mov.idCategoria,
        descripcion: finalDesc,
        importe: mov.importe,
        medio_pago: mov.medioPago
      };
      if (mov.idCuenta) updatePayload.id_cuenta_principal = mov.idCuenta;
      if (mov.tipo) updatePayload.tipo_mov = mov.tipo;
      if (mov.idTarjetaCuotas) updatePayload.id_consumo_tarjeta_origen = mov.idTarjetaCuotas;

      const { data: updated, error } = await supabase.from('movimientos').update(updatePayload).eq('id_movimiento', targetId).eq('user_id', userId).select();
      if (error) throw error;
      if (!updated || updated.length === 0) {
        return res.status(404).json({ success: false, error: 'No se encontró el movimiento para actualizar.' });
      }
    }

    return res.status(200).json({ success: true, data: {} });
  } catch (err) {
    console.error('[API -> updateMovimiento]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
