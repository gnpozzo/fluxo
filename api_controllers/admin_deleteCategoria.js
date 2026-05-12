import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    // request body is directly the ID for delete endpoints based on AppAPI.js call format
    const id = Array.isArray(req.body) ? req.body[0] : req.body;
    
    if (!id) throw new Error('ID requerido');

    const { error } = await supabase.from('categorias').delete().eq('id_categoria', id);
    if (error) throw error;
    
    return res.status(200).json({ success: true, message: 'Eliminado correctamente' });
  } catch (err) {
    console.error('[API -> admin_deleteCategoria]', err.message);
    if (err.code === '23503') {
      return res.status(400).json({ success: false, error: 'No puedes eliminar esta categoría porque está siendo usada en movimientos existentes.' });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
}
