import fs from 'fs';
import path from 'path';

const apiDir = path.join(process.cwd(), 'api');

const createMovimiento = `import { getSupabaseClient } from './_lib/supabase.js';
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
         desc = \`\${desc} (Cuota \${cuotaNro}/\${mov.cuotaTotal})\`;
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
`;

const deleteMovimiento = `import { getSupabaseClient } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const request = Array.isArray(req.body) ? req.body[0] : req.body;
    
    switch (request.scope) {
      case 'SINGLE': {
        if (!request.id) throw new Error('id requerido');
        const { data: linkedTC } = await supabase.from('movimientos').select('id_consumo_tarjeta_origen').eq('id_movimiento', request.id).single();
        if (linkedTC && linkedTC.id_consumo_tarjeta_origen) {
          await supabase.from('consumos_tc').delete().eq('id_consumo_tarjeta', linkedTC.id_consumo_tarjeta_origen);
        }
        await supabase.from('movimientos').delete().eq('id_movimiento', request.id);
        break;
      }
      case 'GROUP': {
        if (!request.splitGroupId) throw new Error('splitGroupId requerido');
        const { data: groupMovs } = await supabase.from('movimientos').select('id_consumo_tarjeta_origen').eq('split_group_id', request.splitGroupId);
        if (groupMovs) {
          const tcIds = groupMovs.filter(r => r.id_consumo_tarjeta_origen).map(r => r.id_consumo_tarjeta_origen);
          if (tcIds.length > 0) await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', tcIds);
        }
        await supabase.from('movimientos').delete().eq('split_group_id', request.splitGroupId);
        break;
      }
      case 'SERIES': {
        if (!request.recurGroupId || !request.fecha) throw new Error('recurGroupId y fecha requeridos');
        const { data: seriesMovs } = await supabase.from('movimientos').select('id_consumo_tarjeta_origen').eq('recur_group_id', request.recurGroupId).gte('fecha', request.fecha);
        if (seriesMovs) {
          const tcIds = seriesMovs.filter(r => r.id_consumo_tarjeta_origen).map(r => r.id_consumo_tarjeta_origen);
          if (tcIds.length > 0) await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', tcIds);
        }
        await supabase.from('movimientos').delete().eq('recur_group_id', request.recurGroupId).gte('fecha', request.fecha);
        break;
      }
      default:
        throw new Error('Scope inválido');
    }

    return res.status(200).json({ success: true, data: {} });
  } catch (err) {
    console.error('[API -> deleteMovimiento]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
`;

const updateMovimiento = `import { getSupabaseClient } from './_lib/supabase.js';

function addMonthsSafe(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

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
      
      // 2. CREATE (Inline implementation of createMovimiento)
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
        if (esCuotas) desc = \`\${desc} (Cuota \${mov.cuotaActual + i}/\${mov.cuotaTotal})\`;

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

      await supabase.from('movimientos').insert(rows);

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
`;

fs.writeFileSync(path.join(apiDir, 'createMovimiento.js'), createMovimiento, 'utf8');
fs.writeFileSync(path.join(apiDir, 'updateMovimiento.js'), updateMovimiento, 'utf8');
fs.writeFileSync(path.join(apiDir, 'deleteMovimiento.js'), deleteMovimiento, 'utf8');
console.log('Movimientos endpoints generated');
