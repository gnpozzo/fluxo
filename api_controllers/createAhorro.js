import { getSupabaseClient } from '../api_lib/supabase.js';
import { verifyCuentaOwnership } from '../api_lib/auth.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    let ahorroData = req.body;
    if (Array.isArray(ahorroData)) {
      ahorroData = ahorroData[0];
    } else if (ahorroData && Array.isArray(ahorroData.args)) {
      ahorroData = ahorroData.args[0];
    } else if (typeof ahorroData === 'string') {
      try {
        const parsed = JSON.parse(ahorroData);
        ahorroData = Array.isArray(parsed) ? parsed[0] : (parsed.args ? parsed.args[0] : parsed);
      } catch (e) {}
    }
    ahorroData = ahorroData || {};
    
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const { idCuenta, fecha, tipo_transfer, moneda, idSubcuenta, descripcion } = ahorroData;
    const importe = Number(ahorroData.importe);
    
    if (idCuenta) {
      const isOwner = await verifyCuentaOwnership(supabase, idCuenta, userId);
      if (!isOwner) return res.status(403).json({ success: false, error: 'Acceso denegado: La cuenta no pertenece al usuario autenticado.' });
    }

    const ID_CATEGORIA_AHORRO = 'CAT_AHORRO';
    let importePrincipal = importe;
    let desc_principal = `${tipo_transfer} de Ahorro (${moneda}) - ${descripcion || ''}`;
    
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
      importePrincipal = importe * venta;
      desc_principal = `${tipo_transfer} de Ahorro (USD ${importe.toFixed(2)} @ ${venta}) - ${descripcion || ''}`;
    }
    
    if (!Number.isFinite(importePrincipal) || importePrincipal <= 0) {
      importePrincipal = importe || 0;
    }
    
    const tipo_mov_principal = (tipo_transfer === 'DEPOSITO') ? 'EGRESO' : 'INGRESO';
    const idAhorro = 'AHO_' + crypto.randomUUID();
    const idMovimiento = crypto.randomUUID();
    
    // Insert into movimientos first
    const movResult = await supabase.from('movimientos').insert({
      id_movimiento: idMovimiento,
      id_cuenta_principal: idCuenta,
      user_id: userId,
      fecha: fecha,
      id_categoria: ID_CATEGORIA_AHORRO,
      tipo_mov: tipo_mov_principal,
      descripcion: desc_principal,
      importe: importePrincipal,
      medio_pago: 'Transferencia',
      id_transfer_ahorro: idAhorro
    });
    if (movResult.error) throw movResult.error;
    
    // Insert into ahorros with fallback if id_subcuenta column does not exist in schema cache
    const ahorroRow = {
      id_ahorro: idAhorro,
      user_id: userId,
      id_movimiento_origen: idMovimiento,
      fecha: fecha,
      tipo_transfer: tipo_transfer,
      moneda: moneda,
      importe: importe,
      descripcion: descripcion
    };
    if (idSubcuenta) ahorroRow.id_subcuenta = idSubcuenta;

    let ahResult = await supabase.from('ahorros').insert(ahorroRow);
    if (ahResult.error && ahResult.error.message && ahResult.error.message.includes('id_subcuenta')) {
      delete ahorroRow.id_subcuenta;
      ahResult = await supabase.from('ahorros').insert(ahorroRow);
    }
    if (ahResult.error) throw ahResult.error;
    
    return res.status(200).json({ success: true, data: { id_ahorro: idAhorro } });
  } catch (err) {
    console.error('[API -> createAhorro]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
