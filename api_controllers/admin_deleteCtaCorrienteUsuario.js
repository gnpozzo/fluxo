import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const payload = req.body?.args ? req.body.args[0] : (Array.isArray(req.body) ? req.body[0] : req.body);
    const id = (typeof payload === 'object' && payload !== null) ? (payload.id || payload.id_usuario) : payload;
    
    if (!id) throw new Error('ID requerido');

    // 1. Verificar si el usuario existe y si es el perfil propio 'Yo'
    const { data: usuario, error: uErr } = await supabase
      .from('cta_corriente_usuarios')
      .select('id_usuario, nombre, es_yo')
      .eq('id_usuario', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (uErr) throw uErr;
    if (!usuario) return res.status(404).json({ success: false, error: 'Contacto no encontrado o sin permisos.' });

    if (usuario.es_yo === true) {
      return res.status(400).json({
        success: false,
        error: 'No puedes eliminar tu propio contacto de cuenta corriente ("Yo").'
      });
    }

    // 2. Ejecutar eliminación
    const { data: deleted, error } = await supabase
      .from('cta_corriente_usuarios')
      .delete()
      .eq('id_usuario', id)
      .eq('user_id', userId)
      .select();

    if (error) throw error;
    if (!deleted || deleted.length === 0) {
      return res.status(404).json({ success: false, error: 'No se pudo eliminar el contacto.' });
    }
    
    return res.status(200).json({ success: true, message: 'Contacto eliminado correctamente' });
  } catch (err) {
    console.error('[API -> admin_deleteCtaCorrienteUsuario]', err.message);
    if (err.code === '23503') {
      return res.status(400).json({
        success: false,
        error: 'No puedes eliminar este contacto porque tiene gastos compartidos registrados.'
      });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
}
