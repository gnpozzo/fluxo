import { getSupabaseClient } from '../api_lib/supabase.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const { data, error } = await supabase
      .from('ahorro_subcuentas')
      .select('id_subcuenta,nombre,moneda,id_cuenta_principal')
      .eq('user_id', userId)
      .order('nombre', { ascending: true });
    if (error) throw error;
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}