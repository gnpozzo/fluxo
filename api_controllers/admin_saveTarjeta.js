import { saveOwned } from '../api_lib/validation.js';
import { getSupabaseClient } from '../api_lib/supabase.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    // AppAPI.js wrappea los argumentos en { args: [...] } si se usa call()
    const payload = req.body?.args ? req.body.args[0] : (Array.isArray(req.body) ? req.body[0] : req.body);
    
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    let isNew = false;
    if (!payload.id_tarjeta) {
      isNew = true;
      payload.id_tarjeta = crypto.randomUUID();
    }
    payload.user_id = userId;

    const { data, error } = await saveOwned(supabase, 'tarjetas', 'id_tarjeta', payload, userId, ["id_tarjeta","id_cuenta_principal","nombre","activa","banco","ultimos_4_digitos","dia_cierre_resumen","dia_vencimiento_resumen","color","red","fecha_cierre_actual","fecha_vencimiento_actual","proximo_cierre","proximo_vencimiento","total_resumen_ars","total_resumen_usd","limite_ars","limite_usd"]);
    if (error) throw error;
    
    return res.status(200).json({ success: true, data, isNew });
  } catch (err) {
    console.error('[API -> admin_saveTarjeta]', err.message);
    return res.status(err.status || 500).json({ success: false, error: err.status ? err.message : 'No se pudo completar la operación.' });
  }
}
