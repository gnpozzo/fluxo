import { getSupabaseClient } from '../api_lib/supabase.js';
import crypto from 'crypto';

function addMonthsSafe(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

const FREQ_MAP = {
  'MENSUAL': 1, 'BIMESTRAL': 2, 'TRIMESTRAL': 3, 'SEMESTRAL': 6, 'ANUAL': 12
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const request = Array.isArray(req.body) ? req.body[0] : req.body;
    
    const { original, data, scope } = request;
    const mov = data;

    const isOriginalRecurrente = !!original.recurGroupId;
    const isOriginalSplit = !!original.splitGroupId;
    const isMovRecurrente = mov.tipoConsumo === 'RECURRENTE' || mov.tipoConsumo === 'CUOTAS';
    const isComplexityChanging = isMovRecurrente !== isOriginalRecurrente || mov.esSplit !== isOriginalSplit;

    if (scope !== 'SINGLE' || isComplexityChanging) {
      // 1. DELETE
      if (scope === 'SINGLE') {
        await supabase.from('movimientos').delete().eq('id_movimiento', original.movimientoId);
      } else if (scope === 'GROUP') {
        await supabase.from('movimientos').delete().eq('split_group_id', original.splitGroupId);
      } else if (scope === 'SERIES') {
        await supabase.from('movimientos').delete().eq('recur_group_id', original.recurGroupId).gte('fecha', original.fecha);
      }

      if (scope === 'SINGLE' && (isOriginalRecurrente || isOriginalSplit)) {
        mov.tipoConsumo = 'COMUN';
        mov.esSplit = false;
      }
      
      // 2. CREATE (Inline)
      const rows = [];
      const fechaBase = new Date(mov.fecha + 'T12:00:00Z');
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
        periodos = mov.cuotaTotal - mov.cuotaActual + 1;
        esCuotas = true;
        groupIdPrefix = 'INSTL_';
      } else if (mov.tipoConsumo === 'RECURRENTE') {
        periodos = mov.periodos || 12;
        monthStep = FREQ_MAP[mov.frecuencia] || 1;
      }
      if (periodos < 1) periodos = 1;
      const isSeries = periodos > 1;
      const seriesGroupId = isSeries ? groupIdPrefix + crypto.randomUUID() : null;

      for (let i = 0; i < periodos; i++) {
        const monthsToAdd = esCuotas ? i : (i * monthStep);
        const fechaISO = addMonthsSafe(fechaBase, monthsToAdd).toISOString().split('T')[0];
        let desc = mov.descripcion;
        if (esCuotas) desc = `${desc} (Cuota ${mov.cuotaActual + i}/${mov.cuotaTotal})`;

        if (mov.esSplit && destinos.length > 0) {
          const splitGroupId = 'SPLIT_' + crypto.randomUUID();
          destinos.forEach(d => {
            rows.push({
              id_movimiento: crypto.randomUUID(),
              id_cuenta_principal: d.cuenta,
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
          rows.push({
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: mov.idCuenta,
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
        } else {
          rows.push({
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: mov.idCuenta,
            fecha: fechaISO,
            id_categoria: mov.idCategoria,
            tipo_mov: mov.tipo,
            descripcion: desc,
            importe: mov.importe,
            medio_pago: mov.medioPago,
            recur_group_id: seriesGroupId
          });
        }
      }

      if (rows.length > 0) {
        const { error } = await supabase.from('movimientos').insert(rows);
        if (error) throw error;
      }

    } else {
      // UPDATE SIMPLE
      const { error } = await supabase.from('movimientos').update({
        fecha: mov.fecha,
        id_categoria: mov.idCategoria,
        descripcion: mov.descripcion,
        importe: mov.importe,
        medio_pago: mov.medioPago
      }).eq('id_movimiento', original.movimientoId);
      if (error) throw error;
    }

    return res.status(200).json({ success: true, data: {} });
  } catch (err) {
    console.error('[API -> updateMovimiento]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
