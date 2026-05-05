import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const request = Array.isArray(req.body) ? req.body[0] : req.body;
    
    if (request.scope === 'SINGLE') {
      if (!request.consumoId) throw new Error('consumoId requerido');
      const { error } = await supabase.from('cc_consumos').delete().eq('id_cc_consumo', request.consumoId);
      if (error) throw error;
    } else if (request.scope === 'SERIES') {
      if (!request.recurGroupId || !request.fecha) throw new Error('Faltan recurGroupId o fecha');
      const { error } = await supabase.from('cc_consumos').delete()
        .eq('recur_group_id', request.recurGroupId)
        .gte('fecha', request.fecha);
      if (error) throw error;
    } else {
      throw new Error('Scope inválido');
    }

    return res.status(200).json({ success: true, data: {} });
  } catch (err) {
    console.error('[API -> deleteConsumoCC]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
