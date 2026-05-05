import { getSupabaseClient } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  
  try {
    const supabase = getSupabaseClient(req);
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
      return res.status(200).json({ success: false, email: 'Usuario no disponible' });
    }
    
    return res.status(200).json({
      success: true,
      email: user.email
    });
  } catch (err) {
    return res.status(200).json({ success: false, email: 'Usuario no disponible' });
  }
}

