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
        request = { id_ahorro: rawArgs[0] };
      }
    }
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const idAhorro = request.id_ahorro || request.id || (rawArgs ? rawArgs[0] : null);
    if (!idAhorro) throw new Error('id_ahorro requerido');
    
    // Delete from movimientos first (FK) scoped to user_id
    const movResult = await supabase.from('movimientos').delete().eq('id_transfer_ahorro', idAhorro).eq('user_id', userId);
    if (movResult.error) throw movResult.error;
    
    // Delete from ahorros scoped to user_id
    const ahResult = await supabase.from('ahorros').delete().eq('id_ahorro', idAhorro).eq('user_id', userId).select();
    if (ahResult.error) throw ahResult.error;
    if (!ahResult.data || ahResult.data.length === 0) {
      return res.status(404).json({ success: false, error: 'No se encontró el registro de ahorro para eliminar.' });
    }
    
    return res.status(200).json({ success: true, data: { id_ahorro: idAhorro } });
  } catch (err) {
    console.error('[API -> deleteAhorro]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
