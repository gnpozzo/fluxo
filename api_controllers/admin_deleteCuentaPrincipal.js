import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const payload = req.body?.args ? req.body.args[0] : (Array.isArray(req.body) ? req.body[0] : req.body);
    const id = (typeof payload === 'object' && payload !== null) ? (payload.id || payload.id_cuenta_principal) : payload;
    
    if (!id) throw new Error('ID requerido');

    const { error } = await supabase.from('cuentas_principales').delete().eq('id_cuenta_principal', id).eq('user_id', userId);
    if (error) throw error;
    
    return res.status(200).json({ success: true, message: 'Eliminado correctamente' });
  } catch (err) {
    console.error('[API -> admin_deleteCuentaPrincipal]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
