import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const bodyArgs = Array.isArray(req.body?.args) ? req.body.args : (Array.isArray(req.body) ? req.body : null);
    let request = null;
    let rawId = null;

    if (bodyArgs) {
      if (bodyArgs[1] && typeof bodyArgs[1] === 'object') {
        request = bodyArgs[1];
        rawId = typeof bodyArgs[0] === 'string' ? bodyArgs[0] : null;
      } else if (bodyArgs[0] && typeof bodyArgs[0] === 'object') {
        request = bodyArgs[0];
      } else {
        request = {};
        rawId = typeof bodyArgs[0] === 'string' ? bodyArgs[0] : null;
      }
    } else if (req.body && typeof req.body === 'object') {
      request = req.body;
    } else {
      request = {};
    }
    
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const id_ahorro = request.id_ahorro || request.original?.id || rawId;
    const data = (request.data && Object.keys(request.data).length > 0) ? request.data : request;
    const { fecha, tipo_transfer, moneda, idSubcuenta, descripcion } = data;
    const importe = Number(data.importe);
    
    let importePrincipal = importe;
    let desc_principal = `${tipo_transfer} de Ahorro (${moneda}) - ${descripcion || ''}`;
    
    if (moneda === 'USD') {
      const { data: cotizData } = await supabase.from('cotizaciones_dolar').select('*').order('fecha', { ascending: false }).limit(1).single();
      const venta = cotizData ? cotizData.venta : 1000;
      importePrincipal = importe * venta;
      desc_principal = `${tipo_transfer} de Ahorro (USD ${importe.toFixed(2)} @ ${venta}) - ${descripcion || ''}`;
    }
    
    const tipo_mov_principal = (tipo_transfer === 'DEPOSITO') ? 'EGRESO' : 'INGRESO';
    
    // Update ahorros (scoped to user_id)
    const ahResult = await supabase.from('ahorros').update({
      fecha: fecha,
      tipo_transfer: tipo_transfer,
      moneda: moneda,
      importe: importe,
      id_subcuenta: idSubcuenta,
      descripcion: descripcion
    }).eq('id_ahorro', id_ahorro).eq('user_id', userId);
    if (ahResult.error) throw ahResult.error;
    
    // Update movimientos (scoped to user_id)
    const movResult = await supabase.from('movimientos').update({
      fecha: fecha,
      tipo_mov: tipo_mov_principal,
      descripcion: desc_principal,
      importe: importePrincipal
    }).eq('id_transfer_ahorro', id_ahorro).eq('user_id', userId);
    if (movResult.error) throw movResult.error;
    
    return res.status(200).json({ success: true, data: { id_ahorro: id_ahorro } });
  } catch (err) {
    console.error('[API -> updateAhorro]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
