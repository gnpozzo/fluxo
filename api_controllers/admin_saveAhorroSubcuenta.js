import { getSupabaseClient } from '../api_lib/supabase.js';
import { resolveUserCuenta } from '../api_lib/auth.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    // AppAPI.js wrappea los argumentos en { args: [...] } si se usa call()
    let payload = req.body?.args ? req.body.args[0] : (Array.isArray(req.body) ? req.body[0] : req.body);
    if (Array.isArray(payload)) payload = payload[0];
    payload = payload || {};
    
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    if (payload.id_cuenta_principal) {
      payload.id_cuenta_principal = await resolveUserCuenta(supabase, payload.id_cuenta_principal, userId) || payload.id_cuenta_principal;
    }

    let isNew = false;
    if (!payload.id_subcuenta) {
      isNew = true;
      payload.id_subcuenta = crypto.randomUUID();
    }
    payload.user_id = userId;

    const { data, error } = await supabase.from('ahorro_subcuentas').upsert(payload).select().single();
    if (error) throw error;
    
    return res.status(200).json({ success: true, data, isNew });
  } catch (err) {
    console.error('[API -> admin_saveAhorroSubcuenta]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
