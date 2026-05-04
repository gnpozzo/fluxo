import { getSupabaseClient } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const request = Array.isArray(req.body) ? req.body[0] : req.body;
    
    if (request.scope === 'SINGLE') {
      if (!request.consumoId) throw new Error('consumoId requerido');
      await supabase.from('movimientos').delete().eq('id_consumo_tarjeta_origen', request.consumoId);
      await supabase.from('consumos_tc').delete().eq('id_consumo_tarjeta', request.consumoId);
    } else if (request.scope === 'SERIES') {
      if (!request.recurGroupId || !request.fecha) throw new Error('Faltan recurGroupId o fecha');
      
      const { data: tcs } = await supabase.from('consumos_tc').select('id_consumo_tarjeta')
        .eq('recur_group_id', request.recurGroupId)
        .gte('fecha', request.fecha);
        
      if (tcs && tcs.length > 0) {
        const ids = tcs.map(r => r.id_consumo_tarjeta);
        await supabase.from('movimientos').delete().in('id_consumo_tarjeta_origen', ids);
        await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', ids);
      }
    } else {
      throw new Error('Scope inválido');
    }

    return res.status(200).json({ success: true, data: {} });
  } catch (err) {
    console.error('[API -> deleteConsumoTC]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
