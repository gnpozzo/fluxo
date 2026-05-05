import { getSupabaseClient } from './_lib/supabase.js';
import crypto from 'crypto';

function addMonthsSafe(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const mov = Array.isArray(req.body) ? req.body[0] : req.body;
    
    const rows = [];
    const fechaBase = new Date(mov.fecha + 'T12:00:00Z');

    let pctRetenido = 100;
    const destinos = [];
    if (mov.esSplit && Array.isArray(mov.splitDestinos)) {
      mov.splitDestinos.forEach(d => {
        const pct = parseFloat(d.pct);
        if (isNaN(pct) || pct <= 0) throw new Error('Porcentaje de distribución inválido.');
        pctRetenido -= pct;
        destinos.push({ cuenta: d.cuenta, pct: pct / 100 });
      });
      if (pctRetenido < 0) throw new Error('La suma de porcentajes de distribución supera el 100%.');
    }

    let periodos = 1;
    let esCuotas = false;
    let groupIdPrefix = 'REC_';
    
    if (mov.tipoConsumo === 'CUOTAS') {
      periodos = mov.cuotaTotal - mov.cuotaActual + 1;
      esCuotas = true;
      groupIdPrefix = 'INSTL_';
    } else if (mov.tipoConsumo === 'RECURRENTE') {
      periodos = mov.periodos || 12;
    }

    if (periodos < 1) periodos = 1;
    const isSeries = periodos > 1;
    const seriesGroupId = isSeries ? groupIdPrefix + crypto.randomUUID() : null;

    for (let i = 0; i < periodos; i++) {
      const fechaISO = addMonthsSafe(fechaBase, i).toISOString().split('T')[0];
      
      let desc = mov.descripcion;
      if (esCuotas) {
         const cuotaNro = mov.cuotaActual + i;
         desc = `${desc} (Cuota ${cuotaNro}/${mov.cuotaTotal})`;
      }

      if (mov.esSplit && destinos.length > 0) {
        const splitGroupId = 'SPLIT_' + crypto.randomUUID();
        // Destinos
        destinos.forEach(d => {
          const importeDestino = mov.importe * d.pct;
          rows.push({
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: d.cuenta,
            fecha: fechaISO,
            id_categoria: mov.idCategoria,
            tipo_mov: mov.tipo,
            descripcion: desc,
            importe: importeDestino,
            medio_pago: mov.medioPago,
            recur_group_id: seriesGroupId,
            split_group_id: splitGroupId,
            split_rol: 'DESTINO'
          });
        });
        
        // Origen Remanente
        const importeOrigen = mov.importe * (pctRetenido / 100);
        rows.push({
          id_movimiento: crypto.randomUUID(),
          id_cuenta_principal: mov.idCuenta,
          fecha: fechaISO,
          id_categoria: mov.idCategoria,
          tipo_mov: mov.tipo,
          descripcion: desc,
          importe: importeOrigen,
          medio_pago: mov.medioPago,
          recur_group_id: seriesGroupId,
          split_group_id: splitGroupId,
          split_rol: 'ORIGEN'
        });
      } else {
        // CASO NORMAL
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

    if (rows.length === 0) throw new Error('No se generaron registros para la creación.');

    const { error } = await supabase.from('movimientos').insert(rows);
    if (error) throw error;

    return res.status(200).json({ success: true, data: { count: rows.length } });
  } catch (err) {
    console.error('[API -> createMovimiento]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
