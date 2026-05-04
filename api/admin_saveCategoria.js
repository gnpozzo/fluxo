import { getSupabaseClient } from './_lib/supabase.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    // AppAPI.js wrappea los argumentos en { args: [...] } si se usa call()
    const payload = Array.isArray(req.body) ? req.body[0] : req.body;
    
    let isNew = false;
    if (!payload.id_categoria) {
      isNew = true;
      payload.id_categoria = crypto.randomUUID();
    }
    
    const { data, error } = await supabase.from('categorias').upsert(payload).select().single();
    if (error) throw error;
    
    return res.status(200).json({ success: true, data, isNew });
  } catch (err) {
    console.error('[API -> admin_saveCategoria]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
