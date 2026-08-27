import { getSupabaseClient } from '../api_lib/supabase.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    // AppAPI.js wrappea los argumentos en { args: [...] } si se usa call()
    const payload = Array.isArray(req.body) ? req.body[0] : req.body;
    
    let isNew = false;
    if (!payload.id_cuenta_principal) {
      isNew = true;
      payload.id_cuenta_principal = crypto.randomUUID();
    }

    // Filtrar solo las columnas existentes en la tabla cuentas_principales
    const cleanPayload = {
      id_cuenta_principal: payload.id_cuenta_principal,
      nombre: payload.nombre,
      moneda_principal: payload.moneda_principal || 'ARS',
      activa: payload.activa !== undefined ? payload.activa : true,
      modulo_tarjetas_activo: payload.modulo_tarjetas_activo !== undefined ? payload.modulo_tarjetas_activo : false,
      modulo_ahorro_activo: payload.modulo_ahorro_activo !== undefined ? payload.modulo_ahorro_activo : false,
      modulo_cc_activo: payload.modulo_cc_activo !== undefined ? payload.modulo_cc_activo : false,
      modulo_inversiones_activo: payload.modulo_inversiones_activo !== undefined ? payload.modulo_inversiones_activo : false
    };

    if (payload.es_predeterminada !== undefined) {
      cleanPayload.es_predeterminada = payload.es_predeterminada;
    }
    
    const { data, error } = await supabase.from('cuentas_principales').upsert(cleanPayload).select().single();
    if (error) throw error;
    
    return res.status(200).json({ success: true, data, isNew });
  } catch (err) {
    console.error('[API -> admin_saveCuentaPrincipal]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
