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
    const consumo = Array.isArray(req.body) ? req.body[0] : req.body;
    
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
