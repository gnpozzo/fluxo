import { getSupabaseClient } from '../api_lib/supabase.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    // AppAPI.js wrappea los argumentos en { args: [...] } si se usa call()
    const payload = Array.isArray(req.body) ? req.body[0] : req.body;
    
    let isNew = false;
    if (!payload.id_usuario) {
      isNew = true;
      payload.id_usuario = crypto.randomUUID();
    }
    
    if (payload.es_yo === true || payload.es_yo === 'true') {
      const { error: resetError } = await supabase
        .from('cta_corriente_usuarios')
        .update({ es_yo: false })
        .neq('id_usuario', payload.id_usuario);
      if (resetError && (!resetError.message || (!resetError.message.includes('es_yo') && !resetError.message.includes('does not exist')))) {
        throw resetError;
      }
    }
    
    let { data, error } = await supabase.from('cta_corriente_usuarios').upsert(payload).select().single();
    if (error) {
      if (error.message && (error.message.includes('es_yo') || error.message.includes('id_cuenta_principal') || error.message.includes('does not exist'))) {
        const cleanPayload = { ...payload };
        delete cleanPayload.es_yo;
        delete cleanPayload.id_cuenta_principal;
        const fallbackRes = await supabase.from('cta_corriente_usuarios').upsert(cleanPayload).select().single();
        if (fallbackRes.error) throw fallbackRes.error;
        data = { ...fallbackRes.data, es_yo: false, id_cuenta_principal: null };
      } else {
        throw error;
      }
    }
    
    return res.status(200).json({ success: true, data, isNew });
  } catch (err) {
    console.error('[API -> admin_saveCtaCorrienteUsuario]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
