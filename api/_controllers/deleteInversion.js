import { getSupabaseClient } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const idOperacion = Array.isArray(req.body) ? req.body[0] : req.body;
    
    if (!idOperacion) throw new Error('idOperacion requerido');
    
    // Delete from movimientos first (FK)
    const movResult = await supabase.from('movimientos').delete().eq('id_transfer_inversion', idOperacion);
    if (movResult.error) throw movResult.error;
    
    // Delete from inversiones_movimientos
    const invResult = await supabase.from('inversiones_movimientos').delete().eq('id_inversion_mov', idOperacion);
    if (invResult.error) throw invResult.error;
    
    return res.status(200).json({ success: true, data: { id_operacion: idOperacion } });
  } catch (err) {
    console.error('[API -> deleteInversion]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
