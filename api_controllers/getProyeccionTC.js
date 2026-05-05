import { getSupabaseClient } from '../api_lib/supabase.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const args = Array.isArray(req.body) ? req.body : [req.body];
    const { cuenta, mes } = args[0] || {};
    
    // For now returning mock data to unblock UI
    return res.status(200).json({ success: true, consumos: [], totales: { total: 0 } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}