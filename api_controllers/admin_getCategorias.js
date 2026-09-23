import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const [
      { data: categorias, error: errCat },
      { data: cuentas, error: errC },
      { data: perfil }
    ] = await Promise.all([
      supabase
        .from('categorias')
        .select('*')
        .or(`user_id.is.null,user_id.eq.${userId}`)
        .order('tipo_mov', { ascending: true })
        .order('nombre', { ascending: true }),
      supabase
        .from('cuentas_principales')
        .select('id_cuenta_principal,nombre')
        .eq('user_id', userId),
      supabase
        .from('perfiles_usuario')
        .select('preferencias')
        .eq('id', userId)
        .maybeSingle()
    ]);

    if (errCat) throw errCat;
    if (errC) throw errC;

    const prefs = (perfil && typeof perfil.preferencias === 'object' && perfil.preferencias) ? perfil.preferencias : {};
    const ocultas = new Set(Array.isArray(prefs.categorias_ocultas) ? prefs.categorias_ocultas : []);
    const customOverrides = prefs.categorias_personalizadas || {};

    const cuentaMap = {};
    (cuentas || []).forEach(c => cuentaMap[c.id_cuenta_principal] = c.nombre);

    const data = (categorias || [])
      .filter(c => !ocultas.has(c.id_categoria))
      .map(c => {
        const custom = customOverrides[c.id_categoria] || {};
        const merged = { ...c, ...custom };
        return {
          ...merged,
          nombre_cuenta_principal: merged.id_cuenta ? (cuentaMap[merged.id_cuenta] || null) : null
        };
      });

    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}