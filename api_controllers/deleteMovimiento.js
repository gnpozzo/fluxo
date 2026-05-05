import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const request = Array.isArray(req.body) ? req.body[0] : req.body;
    
    switch (request.scope) {
      case 'SINGLE': {
        if (!request.id) throw new Error('id requerido');
        const { data: linkedTC } = await supabase.from('movimientos').select('id_consumo_tarjeta_origen').eq('id_movimiento', request.id).single();
        if (linkedTC && linkedTC.id_consumo_tarjeta_origen) {
          await supabase.from('consumos_tc').delete().eq('id_consumo_tarjeta', linkedTC.id_consumo_tarjeta_origen);
        }
        await supabase.from('movimientos').delete().eq('id_movimiento', request.id);
        break;
      }
      case 'GROUP': {
        if (!request.splitGroupId) throw new Error('splitGroupId requerido');
        const { data: groupMovs } = await supabase.from('movimientos').select('id_consumo_tarjeta_origen').eq('split_group_id', request.splitGroupId);
        if (groupMovs) {
          const tcIds = groupMovs.filter(r => r.id_consumo_tarjeta_origen).map(r => r.id_consumo_tarjeta_origen);
          if (tcIds.length > 0) await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', tcIds);
        }
        await supabase.from('movimientos').delete().eq('split_group_id', request.splitGroupId);
        break;
      }
      case 'SERIES': {
        if (!request.recurGroupId || !request.fecha) throw new Error('recurGroupId y fecha requeridos');
        const { data: seriesMovs } = await supabase.from('movimientos').select('id_consumo_tarjeta_origen').eq('recur_group_id', request.recurGroupId).gte('fecha', request.fecha);
        if (seriesMovs) {
          const tcIds = seriesMovs.filter(r => r.id_consumo_tarjeta_origen).map(r => r.id_consumo_tarjeta_origen);
          if (tcIds.length > 0) await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', tcIds);
        }
        await supabase.from('movimientos').delete().eq('recur_group_id', request.recurGroupId).gte('fecha', request.fecha);
        break;
      }
      default:
        throw new Error('Scope inválido');
    }

    return res.status(200).json({ success: true, data: {} });
  } catch (err) {
    console.error('[API -> deleteMovimiento]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
