import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const payload = req.body?.args ? req.body.args[0] : (Array.isArray(req.body) ? req.body[0] : req.body);
    const id = (typeof payload === 'object' && payload !== null) ? (payload.id || payload.id_subcuenta) : payload;
    
    if (!id) throw new Error('ID requerido');

    const { data: deleted, error } = await supabase
      .from('ahorro_subcuentas')
      .delete()
      .eq('id_subcuenta', id)
      .eq('user_id', userId)
      .select();

    if (error) throw error;
    if (!deleted || deleted.length === 0) {
      return res.status(404).json({ success: false, error: 'No se encontró la alcancía para eliminar o no tienes permisos.' });
    }
    
    return res.status(200).json({ success: true, message: 'Alcancía eliminada correctamente' });
  } catch (err) {
    console.error('[API -> admin_deleteAhorroSubcuenta]', err.message);
    if (err.code === '23503') {
      return res.status(400).json({
        success: false,
        error: 'No puedes eliminar esta alcancía porque tiene movimientos de ahorro registrados.'
      });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
}
