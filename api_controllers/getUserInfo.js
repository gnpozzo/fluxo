import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  
  try {
    const supabase = getSupabaseClient(req);
    const authHeader = req.headers?.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    const user = req.user || (token ? (await supabase.auth.getUser(token)).data?.user : null);
    
    if (!user) {
      return res.status(200).json({ success: false, email: 'Usuario no disponible' });
    }
    
    let metadata = user.user_metadata || {};
    try {
      const { data: profile } = await supabase
        .from('perfiles_usuario')
        .select('nombre, avatar_url, preferencias')
        .eq('id', user.id)
        .maybeSingle();
      if (profile) {
        if (profile.nombre) metadata.full_name = profile.nombre;
        if (profile.avatar_url) metadata.avatar_url = profile.avatar_url;
        if (profile.preferencias) metadata.preferencias = profile.preferencias;
      }
    } catch (_) {}

    return res.status(200).json({
      success: true,
      email: user.email,
      user_metadata: metadata
    });
  } catch (err) {
    return res.status(200).json({ success: false, email: 'Usuario no disponible', error: err.message });
  }
}

