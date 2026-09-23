import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const payload = req.body?.args ? req.body.args[0] : (Array.isArray(req.body) ? req.body[0] : req.body);
    const id = (typeof payload === 'object' && payload !== null) ? (payload.id || payload.id_cuenta_principal) : payload;
    
    if (!id) throw new Error('ID requerido');

    // 1. Verificar si la cuenta existe y si es la predeterminada
    const { data: cuenta, error: cErr } = await supabase
      .from('cuentas_principales')
      .select('id_cuenta_principal, nombre, es_predeterminada')
      .eq('id_cuenta_principal', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (cErr) throw cErr;
    if (!cuenta) return res.status(404).json({ success: false, error: 'Cuenta no encontrada o sin permisos.' });

    if (cuenta.es_predeterminada) {
      return res.status(400).json({
        success: false,
        error: 'No puedes eliminar la cuenta principal predeterminada. Configura otra cuenta como predeterminada antes de eliminar esta.'
      });
    }

    // 2. Verificar que no sea la única cuenta existente del usuario
    const { count, error: countErr } = await supabase
      .from('cuentas_principales')
      .select('id_cuenta_principal', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (countErr) throw countErr;
    if ((count || 0) <= 1) {
      return res.status(400).json({
        success: false,
        error: 'No puedes eliminar tu única cuenta principal activa.'
      });
    }

    // 3. Ejecutar eliminación
    const { data: deleted, error } = await supabase
      .from('cuentas_principales')
      .delete()
      .eq('id_cuenta_principal', id)
      .eq('user_id', userId)
      .select();

    if (error) throw error;
    if (!deleted || deleted.length === 0) {
      return res.status(404).json({ success: false, error: 'No se pudo eliminar la cuenta.' });
    }
    
    return res.status(200).json({ success: true, message: 'Cuenta eliminada correctamente' });
  } catch (err) {
    console.error('[API -> admin_deleteCuentaPrincipal]', err.message);
    if (err.code === '23503') {
      return res.status(400).json({
        success: false,
        error: 'No puedes eliminar esta cuenta porque tiene movimientos, tarjetas o alcancías asociadas. Debes reasignarlos o eliminarlos primero.'
      });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
}
