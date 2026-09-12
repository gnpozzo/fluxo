import { getSupabaseClient } from '../api_lib/supabase.js';
import { verifyCuentaOwnership } from '../api_lib/auth.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    let operacionData = req.body;
    if (Array.isArray(operacionData)) {
      operacionData = operacionData[0];
    } else if (operacionData && Array.isArray(operacionData.args)) {
      operacionData = operacionData.args[0];
    } else if (typeof operacionData === 'string') {
      try {
        const parsed = JSON.parse(operacionData);
        operacionData = Array.isArray(parsed) ? parsed[0] : (parsed.args ? parsed.args[0] : parsed);
      } catch (e) {}
    }
    operacionData = operacionData || {};
    
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const { idCuenta, tipoOp, fecha, moneda } = operacionData;

    if (idCuenta) {
      const isOwner = await verifyCuentaOwnership(supabase, idCuenta, userId);
      if (!isOwner) return res.status(403).json({ success: false, error: 'Acceso denegado: La cuenta no pertenece al usuario autenticado.' });
    }

    const ticker = (operacionData.ticker || 'ACTIVO').toUpperCase().trim();
    const cantidad = Number(operacionData.cantidad) || 0;
    const precio = Number(operacionData.precio) || 0;
    
    const ID_CATEGORIA_INVERSION = 'CAT_INVERSION';
    let importe_total_ars = cantidad * precio;
    
    if (moneda === 'USD') {
      let venta = 1400;
      try {
        const { data: cotizData } = await supabase.from('cotizaciones_dolar').select('*').order('fecha', { ascending: false }).limit(1).maybeSingle();
        if (cotizData) {
          venta = Number(cotizData.valor || cotizData.venta || 1400) || 1400;
        }
      } catch (_) {
        venta = 1400;
      }
      importe_total_ars = importe_total_ars * venta;
    }

    if (!Number.isFinite(importe_total_ars) || importe_total_ars <= 0) {
      importe_total_ars = (cantidad * precio) || 0;
    }
    
    const tipo_mov_principal = (tipoOp === 'COMPRA') ? 'EGRESO' : 'INGRESO';
    const desc_principal = `${tipoOp} ${ticker} (${moneda}) - ${cantidad} nom. @ ${precio}`;
    const idInversion = 'INV_' + crypto.randomUUID();
    const idMovimiento = crypto.randomUUID();
    
    const movResult = await supabase.from('movimientos').insert({
      id_movimiento: idMovimiento,
      id_cuenta_principal: idCuenta,
      user_id: userId,
      fecha: fecha,
      id_categoria: ID_CATEGORIA_INVERSION,
      tipo_mov: tipo_mov_principal,
      descripcion: desc_principal,
      importe: importe_total_ars,
      medio_pago: 'Broker',
      id_transfer_inversion: idInversion,
      moneda: moneda
    });
    if (movResult.error) throw movResult.error;
    
    const invRow = {
      id_inversion_mov: idInversion,
      id_movimiento_origen: idMovimiento,
      user_id: userId,
      ticker: ticker,
      fecha: fecha,
      tipo_operacion: tipoOp,
      moneda: moneda,
      cantidad_nominales: cantidad,
      precio_compra: precio,
      importe_total_ars: importe_total_ars
    };
    
    const invResult = await supabase.from('inversiones_movimientos').insert(invRow);
    if (invResult.error) throw invResult.error;
    
    return res.status(200).json({ success: true, data: { id_operacion: idInversion } });
  } catch (err) {
    console.error('[API -> createInversion]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
