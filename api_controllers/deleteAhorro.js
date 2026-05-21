import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    let request = req.body;
    if (Array.isArray(req.body)) {
      if (typeof req.body[0] === 'object' && req.body[0] !== null) {
        request = req.body[0];
      } else {
        request = { id_ahorro: req.body[0] };
      }
    }
    const idAhorro = request.id_ahorro;
    
    // Delete from movimientos first (FK)
    const movResult = await supabase.from('movimientos').delete().eq('id_transfer_ahorro', idAhorro);
    if (movResult.error) throw movResult.error;
    
    // Delete from ahorros
    const ahResult = await supabase.from('ahorros').delete().eq('id_ahorro', idAhorro);
    if (ahResult.error) throw ahResult.error;
    
    return res.status(200).json({ success: true, data: { id_ahorro: idAhorro } });
  } catch (err) {
    console.error('[API -> deleteAhorro]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
