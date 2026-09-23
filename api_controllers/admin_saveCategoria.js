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

    // Si tiene id_categoria, verificar si corresponde a una categoría global del sistema (user_id IS NULL)
    if (payload.id_categoria) {
      const { data: existing } = await supabase
        .from('categorias')
        .select('*')
        .eq('id_categoria', payload.id_categoria)
        .maybeSingle();

      if (existing && !existing.user_id) {
        // Categoría global: guardar personalización en el perfil del usuario para evitar violaciones de RLS
        const { data: perfil } = await supabase
          .from('perfiles_usuario')
          .select('preferencias')
          .eq('id', userId)
          .maybeSingle();

        const prefs = (perfil && typeof perfil.preferencias === 'object' && perfil.preferencias) ? perfil.preferencias : {};
        if (!prefs.categorias_personalizadas) prefs.categorias_personalizadas = {};

        const custom = {};
        if (payload.nombre !== undefined) custom.nombre = payload.nombre;
        if (payload.jerarquia !== undefined) custom.jerarquia = payload.jerarquia;
        if (payload.tipo_mov !== undefined) custom.tipo_mov = payload.tipo_mov;
        if (payload.activa !== undefined) custom.activa = payload.activa;
        if (payload.presupuesto_mensual !== undefined) custom.presupuesto_mensual = payload.presupuesto_mensual;
        if (payload.id_cuenta !== undefined) custom.id_cuenta = payload.id_cuenta;

        prefs.categorias_personalizadas[payload.id_categoria] = custom;

        // Desocultar si estuviese en la lista de ocultas
        if (Array.isArray(prefs.categorias_ocultas)) {
          prefs.categorias_ocultas = prefs.categorias_ocultas.filter(id => id !== payload.id_categoria);
        }

        const { error: prefErr } = await supabase
          .from('perfiles_usuario')
          .upsert({ id: userId, preferencias: prefs, updated_at: new Date().toISOString() }, { onConflict: 'id' });

        if (prefErr) throw prefErr;

        return res.status(200).json({ success: true, data: { ...existing, ...custom }, isNew: false });
      }
    }

    let isNew = false;
    if (!payload.id_categoria) {
      isNew = true;
      payload.id_categoria = crypto.randomUUID();
    }
    payload.user_id = userId;

    const { data, error } = await supabase.from('categorias').upsert(payload).select().single();
    if (error) throw error;
    
    return res.status(200).json({ success: true, data, isNew });
  } catch (err) {
    console.error('[API -> admin_saveCategoria]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
