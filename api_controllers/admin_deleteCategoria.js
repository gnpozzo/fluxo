import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const payload = req.body?.args ? req.body.args[0] : (Array.isArray(req.body) ? req.body[0] : req.body);
    const id = (typeof payload === 'object' && payload !== null) ? (payload.id || payload.id_categoria) : payload;
    
    if (!id) throw new Error('ID requerido');

    // 1. Verificar si la categoría existe en la base de datos
    const { data: cat, error: catErr } = await supabase
      .from('categorias')
      .select('*')
      .eq('id_categoria', id)
      .maybeSingle();

    if (catErr) throw catErr;

    // 2. Verificar si está en uso en movimientos o consumos del usuario
    const [movUsage, tcUsage, ccUsage] = await Promise.all([
      supabase.from('movimientos').select('id_movimiento', { count: 'exact', head: true }).eq('id_categoria', id).eq('user_id', userId),
      supabase.from('consumos_tc').select('id_consumo_tarjeta', { count: 'exact', head: true }).eq('id_categoria', id).eq('user_id', userId),
      supabase.from('cc_consumos').select('id_cc_consumo', { count: 'exact', head: true }).eq('id_categoria', id).eq('user_id', userId)
    ]);

    const totalUsage = (movUsage.count || 0) + (tcUsage.count || 0) + (ccUsage.count || 0);
    if (totalUsage > 0) {
      return res.status(400).json({
        success: false,
        error: `No puedes eliminar esta categoría porque está siendo usada en ${totalUsage} movimientos o consumos existentes.`
      });
    }

    // 3. Si es una categoría personalizada del usuario, eliminarla de la tabla categorias
    if (cat && cat.user_id === userId) {
      const { data: deleted, error: delErr } = await supabase
        .from('categorias')
        .delete()
        .eq('id_categoria', id)
        .eq('user_id', userId)
        .select();

      if (delErr) throw delErr;
      if (!deleted || deleted.length === 0) {
        return res.status(404).json({ success: false, error: 'No se encontró la categoría para eliminar.' });
      }
    } else {
      // 4. Si es una categoría global o heredada (user_id IS NULL), registrarla como oculta en el perfil del usuario
      const { data: perfil } = await supabase
        .from('perfiles_usuario')
        .select('preferencias')
        .eq('id', userId)
        .maybeSingle();

      const prefs = (perfil && typeof perfil.preferencias === 'object' && perfil.preferencias) ? perfil.preferencias : {};
      const ocultas = new Set(Array.isArray(prefs.categorias_ocultas) ? prefs.categorias_ocultas : []);
      ocultas.add(id);
      prefs.categorias_ocultas = Array.from(ocultas);

      if (prefs.categorias_personalizadas && prefs.categorias_personalizadas[id]) {
        delete prefs.categorias_personalizadas[id];
      }

      const { error: updErr } = await supabase
        .from('perfiles_usuario')
        .upsert({ id: userId, preferencias: prefs, updated_at: new Date().toISOString() }, { onConflict: 'id' });

      if (updErr) throw updErr;
    }
    
    return res.status(200).json({ success: true, message: 'Categoría eliminada correctamente' });
  } catch (err) {
    console.error('[API -> admin_deleteCategoria]', err.message);
    if (err.code === '23503') {
      return res.status(400).json({
        success: false,
        error: 'No puedes eliminar esta categoría porque está siendo usada en movimientos existentes.'
      });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
}
