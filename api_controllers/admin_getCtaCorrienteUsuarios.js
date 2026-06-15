import { getSupabaseClient } from '../api_lib/supabase.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    let { data, error } = await supabase.from('cta_corriente_usuarios').select('id_usuario,nombre,es_yo,id_cuenta_principal').order('nombre', { ascending: true });
    if (error) {
      if (error.message && (error.message.includes('es_yo') || error.code === 'PGRST200' || error.message.includes('does not exist'))) {
        const fallbackRes = await supabase.from('cta_corriente_usuarios').select('id_usuario,nombre').order('nombre', { ascending: true });
        if (fallbackRes.error) throw fallbackRes.error;
        data = (fallbackRes.data || []).map(u => ({ ...u, es_yo: false, id_cuenta_principal: null }));
      } else {
        throw error;
      }
    }
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}