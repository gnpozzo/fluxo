import { getSupabaseClient } from '../api_lib/supabase.js';
import { resolveUserCuenta } from '../api_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const supabase = getSupabaseClient(req);
    let finalArgs = [];
    if (Array.isArray(req.body)) {
      finalArgs = req.body;
    } else if (req.body && Array.isArray(req.body.args)) {
      finalArgs = req.body.args;
    } else if (typeof req.body === 'string') {
      try { finalArgs = JSON.parse(req.body); if (finalArgs.args) finalArgs = finalArgs.args; } catch(e){}
    }
    let [cuenta, fechaInicio, fechaFin] = finalArgs;

    if (!cuenta) throw new Error("Falta id de cuenta");

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const resolvedCuenta = await resolveUserCuenta(supabase, cuenta, userId);
    if (!resolvedCuenta) {
      return res.status(403).json({ success: false, error: 'Acceso denegado: La cuenta no pertenece al usuario autenticado.' });
    }
    cuenta = resolvedCuenta;

    // Assuming RPC for savings data if it exists, or fallback to tables
    const { data: dbData, error } = await supabase.rpc('get_ahorros_dashboard', {
      p_id_cuenta: cuenta,
      p_fecha_inicio: fechaInicio,
      p_fecha_fin: fechaFin
    });

    if (!error && dbData) {
      return res.status(200).json({ success: true, ...dbData });
    }

    // Subcuentas
    const { data: subcuentas } = await supabase.from('ahorro_subcuentas').select('*').eq('id_cuenta_principal', cuenta).eq('user_id', userId);

    // Consultar ahorros directamente con fallback a movimientos
    const { data: ahData } = await supabase.from('ahorros')
      .select('*, ahorro_subcuentas(nombre)')
      .eq('user_id', userId)
      .gte('fecha', fechaInicio)
      .lte('fecha', fechaFin)
      .order('fecha', { ascending: false });

    let transferencias = (ahData || []).map(a => ({
      ...a,
      id_ahorro: a.id_ahorro,
      subcuenta_nombre: a.ahorro_subcuentas?.nombre || a.descripcion || 'Alcancía',
      tipo_mov: a.tipo_transfer || 'DEPOSITO'
    }));

    if (!transferencias.length) {
      const { data: movData } = await supabase.from('movimientos')
        .select('*')
        .eq('id_cuenta_principal', cuenta)
        .eq('user_id', userId)
        .not('id_transfer_ahorro', 'is', null)
        .gte('fecha', fechaInicio)
        .lte('fecha', fechaFin);

      transferencias = (movData || []).map(m => ({
        ...m,
        id_ahorro: m.id_transfer_ahorro || m.id_movimiento,
        subcuenta_nombre: m.descripcion || 'General',
        tipo_mov: m.tipo_mov === 'EGRESO' ? 'DEPOSITO' : 'RETIRO'
      }));
    }

    let arsTotal = 0;
    let usdTotal = 0;

    (transferencias || []).forEach(t => {
      const imp = Number(t.importe || 0);
      const factor = t.tipo_mov === 'DEPOSITO' ? 1 : -1;
      if (t.moneda === 'USD') usdTotal += (imp * factor);
      else arsTotal += (imp * factor);
    });

    let consolidadoArs = arsTotal + (usdTotal * 1000);

    return res.status(200).json({
      success: true,
      kpis: { arsTotal, usdTotal, consolidadoArs },
      subcuentas: subcuentas || [],
      transferencias: transferencias
    });

  } catch (err) {
    console.error('[API -> getAhorros Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

