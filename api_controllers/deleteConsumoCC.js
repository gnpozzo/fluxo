import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const rawArgs = Array.isArray(req.body?.args) ? req.body.args : (Array.isArray(req.body) ? req.body : null);
    let request = req.body || {};
    if (rawArgs) {
      if (typeof rawArgs[0] === 'object' && rawArgs[0] !== null) {
        request = rawArgs[0];
      } else {
        request = {
          consumoId: rawArgs[0],
          scope: rawArgs[1] || 'SINGLE',
          recurGroupId: rawArgs[2],
          fecha: rawArgs[3]
        };
      }
    }
    
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const scope = request.scope || 'SINGLE';
    const consumoId = request.consumoId || request.id || request.id_consumo_cc || request.id_cc_consumo || (rawArgs ? rawArgs[0] : null);

    if (scope === 'SINGLE') {
      if (!consumoId) throw new Error('consumoId requerido');
      const { data: deleted, error } = await supabase.from('cc_consumos').delete().eq('id_cc_consumo', consumoId).eq('user_id', userId).select();
      if (error) throw error;
      if (!deleted || deleted.length === 0) {
        return res.status(404).json({ success: false, error: 'No se encontró el consumo de cuenta corriente para eliminar.' });
      }
    } else if (request.scope === 'SERIES') {
      if (!request.recurGroupId || !request.fecha) throw new Error('Faltan recurGroupId o fecha');
      const { error } = await supabase.from('cc_consumos').delete()
        .eq('recur_group_id', request.recurGroupId)
        .eq('user_id', userId)
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
