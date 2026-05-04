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
    const consumo = Array.isArray(req.body) ? req.body[0] : req.body;
    
    const ccItems = [];
    const fechaBase = new Date(consumo.fecha + 'T12:00:00Z');
    const recurGroupId = (consumo.tipo !== 'SIMPLE') ? 'CC_REC_' + crypto.randomUUID() : null;

    if (consumo.tipo === 'SIMPLE') {
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
        porcentaje_imputado: consumo.porcentajeImputado
      });
    } else if (consumo.tipo === 'CUOTAS') {
      const cuotasARegistrar = (consumo.cuotaTotal - consumo.cuotaActual) + 1;
      if (cuotasARegistrar < 1) throw new Error('La cuota actual no puede ser mayor al total.');
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
          porcentaje_imputado: consumo.porcentajeImputado,
          recur_group_id: recurGroupId,
          nro_cuota: consumo.cuotaActual + i,
          total_cuotas: consumo.cuotaTotal
        });
      }
    } else if (consumo.tipo === 'RECURRENTE') {
      if (consumo.periodos < 1) throw new Error('El número de períodos debe ser al menos 1.');
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
          porcentaje_imputado: consumo.porcentajeImputado,
          recur_group_id: recurGroupId
        });
      }
    } else {
      throw new Error('Tipo de consumo CC no reconocido: ' + consumo.tipo);
    }

    if (ccItems.length === 0) throw new Error('No se generaron registros CC para insertar.');

    const { error } = await supabase.from('cc_consumos').insert(ccItems);
    if (error) throw error;

    return res.status(200).json({ success: true, data: { count: ccItems.length } });
  } catch (err) {
    console.error('[API -> createConsumoCC]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
