import { getSupabaseClient } from '../api_lib/supabase.js';
import crypto from 'crypto';

// En el OLD API, updateConsumoCC hacía un delete + create.
// Como los endpoints son archivos separados, lo resolvemos internamente aquí.
// Pero como es un serverless function, simplemente importaremos deleteConsumoCC.js 
// o haremos las queries directamente. Por simplicidad, haré las queries.

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
    
    // 1. DELETE
    if (scope === 'SINGLE') {
      const { error } = await supabase.from('cc_consumos').delete().eq('id_cc_consumo', original.consumoId);
      if (error) throw error;
    } else if (scope === 'SERIES') {
      const { error } = await supabase.from('cc_consumos').delete()
        .eq('recur_group_id', original.recurGroupId)
        .gte('fecha', original.fecha);
      if (error) throw error;
    }
    
    // 2. CREATE
    if (scope === 'SINGLE') data.tipo = 'SIMPLE';
    
    const consumo = data;
    const tipo = consumo.tipo || (consumo.tipoConsumo === 'COMUN' ? 'SIMPLE' : (consumo.tipoConsumo || 'SIMPLE'));
    const porcentajeImputado = (consumo.porcentajeImputado !== undefined && consumo.porcentajeImputado !== null)
      ? consumo.porcentajeImputado
      : (consumo.usaPorcentaje ? consumo.porcentajeYo : 50);

    const ccItems = [];
    const fechaBase = new Date(consumo.fecha + 'T12:00:00Z');
    const recurGroupId = (tipo !== 'SIMPLE') ? 'CC_REC_' + crypto.randomUUID() : null;

    if (tipo === 'SIMPLE') {
      const fechaISO = fechaBase.toISOString().split('T')[0];
      ccItems.push({
        id_cc_consumo: crypto.randomUUID(),
        id_cuenta_principal: consumo.idCuenta,
        id_categoria: consumo.idCategoria,
        id_usuario: consumo.idUsuario || null,
        fecha: fechaISO,
        descripcion: consumo.descripcion,
        importe: consumo.importe,
        pagador: consumo.pagador,
        porcentaje_imputado: porcentajeImputado
      });
    } else if (tipo === 'CUOTAS') {
      const cuotasARegistrar = (consumo.cuotaTotal - consumo.cuotaActual) + 1;
      for (let i = 0; i < cuotasARegistrar; i++) {
        const fechaISO = addMonthsSafe(fechaBase, i).toISOString().split('T')[0];
        ccItems.push({
          id_cc_consumo: crypto.randomUUID(),
          id_cuenta_principal: consumo.idCuenta,
          id_categoria: consumo.idCategoria,
          id_usuario: consumo.idUsuario || null,
          fecha: fechaISO,
          descripcion: consumo.descripcion,
          importe: consumo.importe,
          pagador: consumo.pagador,
          porcentaje_imputado: porcentajeImputado,
          recur_group_id: recurGroupId,
          nro_cuota: consumo.cuotaActual + i,
          total_cuotas: consumo.cuotaTotal
        });
      }
    } else if (tipo === 'RECURRENTE') {
      for (let i = 0; i < consumo.periodos; i++) {
        const fechaISO = addMonthsSafe(fechaBase, i).toISOString().split('T')[0];
        ccItems.push({
          id_cc_consumo: crypto.randomUUID(),
          id_cuenta_principal: consumo.idCuenta,
          id_categoria: consumo.idCategoria,
          id_usuario: consumo.idUsuario || null,
          fecha: fechaISO,
          descripcion: consumo.descripcion,
          importe: consumo.importe,
          pagador: consumo.pagador,
          porcentaje_imputado: porcentajeImputado,
          recur_group_id: recurGroupId
        });
      }
    }

    const { error: insertError } = await supabase.from('cc_consumos').insert(ccItems);
    if (insertError) throw insertError;

    return res.status(200).json({ success: true, data: {} });
  } catch (err) {
    console.error('[API -> updateConsumoCC]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
