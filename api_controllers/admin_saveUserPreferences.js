import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const payload = req.body?.args ? req.body.args[0] : (Array.isArray(req.body) ? req.body[0] : req.body);
    const updates = (payload && typeof payload === 'object') ? (payload.preferencias || payload) : {};

    // Get current preferences
    const { data: perfil } = await supabase
      .from('perfiles_usuario')
      .select('preferencias')
      .eq('id', userId)
      .maybeSingle();

    const currentPrefs = (perfil && typeof perfil.preferencias === 'object' && perfil.preferencias) ? perfil.preferencias : {};
    const newPrefs = { ...currentPrefs, ...updates };

    const { data, error } = await supabase
      .from('perfiles_usuario')
      .upsert({
        id: userId,
        preferencias: newPrefs,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, preferencias: newPrefs });
  } catch (err) {
    console.error('[API -> admin_saveUserPreferences]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
