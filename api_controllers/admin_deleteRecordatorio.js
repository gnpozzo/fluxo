import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const payload = Array.isArray(req.body) ? req.body[0] : (req.body?.args ? req.body.args[0] : req.body);
    const id = typeof payload === 'string' ? payload : payload?.id_recordatorio;

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });
    if (!id) return res.status(400).json({ success: false, error: 'Falta id_recordatorio' });

    const { error } = await supabase.from('recordatorios').delete().eq('id_recordatorio', id).eq('user_id', userId);
    if (error) throw error;

    return res.status(200).json({ success: true, id });
  } catch (err) {
    console.error('[API -> admin_deleteRecordatorio]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
