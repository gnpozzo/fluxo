import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const request = Array.isArray(req.body) ? req.body[0] : req.body;
    
    const { id_ahorro, data } = request;
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
    
    // Update ahorros
    const ahResult = await supabase.from('ahorros').update({
      fecha: fecha,
      tipo_transfer: tipo_transfer,
      moneda: moneda,
      importe: importe,
      id_subcuenta: idSubcuenta,
      descripcion: descripcion
    }).eq('id_ahorro', id_ahorro);
    if (ahResult.error) throw ahResult.error;
    
    // Update movimientos
    const movResult = await supabase.from('movimientos').update({
      fecha: fecha,
      tipo_mov: tipo_mov_principal,
      descripcion: desc_principal,
      importe: importePrincipal
    }).eq('id_transfer_ahorro', id_ahorro);
    if (movResult.error) throw movResult.error;
    
    return res.status(200).json({ success: true, data: { id_ahorro: id_ahorro } });
  } catch (err) {
    console.error('[API -> updateAhorro]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
