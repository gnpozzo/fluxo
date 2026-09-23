import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const rawArgs = Array.isArray(req.body?.args) ? req.body.args : (Array.isArray(req.body) ? req.body : null);
    let request = (typeof req.body === 'object' && req.body !== null) ? req.body : {};
    if (typeof req.body === 'string') {
      try { request = JSON.parse(req.body); } catch (_) {}
    }
    if (rawArgs && rawArgs.length > 0) {
      if (typeof rawArgs[0] === 'object' && rawArgs[0] !== null) {
        request = { ...request, ...rawArgs[0] };
      } else {
        request = {
          ...request,
          consumoId: rawArgs[0],
          scope: rawArgs[1] || request.scope || 'SINGLE',
          recurGroupId: rawArgs[2] || request.recurGroupId,
          fecha: rawArgs[3] || request.fecha
        };
      }
    }
    
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const scope = request.scope || 'SINGLE';
    const consumoId = request.consumoId || request.id || request.id_consumo_tarjeta || request.id_consumo_tc || (rawArgs ? rawArgs[0] : null);

    if (scope === 'SINGLE') {
      await supabase.from('movimientos').delete().eq('id_consumo_tarjeta_origen', consumoId).eq('user_id', userId);
      const { data: deleted, error: delErr } = await supabase.from('consumos_tc').delete().eq('id_consumo_tarjeta', consumoId).eq('user_id', userId).select();
      if (delErr) throw delErr;
      if (!deleted || deleted.length === 0) {
        return res.status(404).json({ success: false, error: 'No se encontró el consumo de tarjeta para eliminar.' });
      }
    } else if (request.scope === 'SERIES') {
      if (!request.recurGroupId || !request.fecha) throw new Error('Faltan recurGroupId o fecha');
      
      const { data: tcs } = await supabase.from('consumos_tc').select('id_consumo_tarjeta')
        .eq('recur_group_id', request.recurGroupId)
        .eq('user_id', userId)
        .gte('fecha', request.fecha);
        
      if (tcs && tcs.length > 0) {
        const ids = tcs.map(r => r.id_consumo_tarjeta);
        await supabase.from('movimientos').delete().in('id_consumo_tarjeta_origen', ids).eq('user_id', userId);
        await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', ids).eq('user_id', userId);
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
