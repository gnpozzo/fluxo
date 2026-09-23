import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  try {
    const supabase = getSupabaseClient(req);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    let cuenta = req.query.idCuenta || req.query.cuenta;
    if (!cuenta && req.method === 'POST') {
      const payload = Array.isArray(req.body) ? req.body[0] : (req.body?.args ? req.body.args[0] : req.body);
      cuenta = typeof payload === 'string' ? payload : payload?.idCuenta || payload?.cuenta;
    }

    let query = supabase
      .from('recordatorios')
      .select('*')
      .eq('user_id', userId)
      .order('fecha_proxima', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (cuenta) {
      query = query.or(`id_cuenta_principal.eq.${cuenta},id_cuenta_principal.is.null`);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Deduplicar automáticamente si existen recordatorios idénticos generados en pruebas
    const seen = new Set();
    const uniqueList = [];
    const duplicateIds = [];

    (data || []).forEach(r => {
      const cleanMsg = (r.mensaje || '').trim().toLowerCase();
      const key = `${r.id_cuenta_principal || 'global'}_${cleanMsg}_${r.fecha_proxima || ''}`;
      if (seen.has(key)) {
        duplicateIds.push(r.id_recordatorio);
      } else {
        seen.add(key);
        uniqueList.push(r);
      }
    });

    if (duplicateIds.length > 0) {
      await supabase.from('recordatorios').delete().in('id_recordatorio', duplicateIds).eq('user_id', userId);
    }

    return res.status(200).json({ success: true, data: uniqueList });
  } catch (err) {
    console.error('[API -> admin_getRecordatorios]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
