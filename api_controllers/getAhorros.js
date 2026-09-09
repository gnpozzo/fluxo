import { getSupabaseClient } from '../api_lib/supabase.js';
import { verifyCuentaOwnership } from '../api_lib/auth.js';

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
    const [cuenta, fechaInicio, fechaFin] = finalArgs;

    if (!cuenta) throw new Error("Falta id de cuenta");

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const isOwner = await verifyCuentaOwnership(supabase, cuenta, userId);
    if (!isOwner) {
      return res.status(403).json({ success: false, error: 'Acceso denegado: La cuenta no pertenece al usuario autenticado.' });
    }

    // Assuming RPC for savings data if it exists, or fallback to tables
    const { data: dbData, error } = await supabase.rpc('get_ahorros_dashboard', {
      p_id_cuenta: cuenta,
      p_fecha_inicio: fechaInicio,
      p_fecha_fin: fechaFin
    });

    if (!error && dbData) {
      return res.status(200).json({ success: true, ...dbData });
    }

    // Fallback if RPC doesn't exist
    const { data: subcuentas } = await supabase.from('ahorro_subcuentas').select('*').eq('id_cuenta_principal', cuenta).eq('user_id', userId);
    const { data: transferencias } = await supabase.from('movimientos').select('*').eq('id_cuenta_principal', cuenta).eq('user_id', userId).not('id_transfer_ahorro', 'is', null).gte('fecha', fechaInicio).lte('fecha', fechaFin);

    let arsTotal = 0;
    let usdTotal = 0;

    (subcuentas || []).forEach(sc => {
      // Very naive balance calculation for fallback
      let saldo = 0;
      (transferencias || []).forEach(t => {
        if (t.id_transfer_ahorro === sc.id_subcuenta) {
          saldo += t.tipo_mov === 'INGRESO' ? Number(t.importe || 0) : -Number(t.importe || 0);
        }
      });
      if (sc.moneda === 'USD') usdTotal += saldo;
      else arsTotal += saldo;
    });

    let consolidadoArs = arsTotal + (usdTotal * 1000); // 1000 ARS per 1 USD naive fallback

    return res.status(200).json({
      success: true,
      kpis: { arsTotal, usdTotal, consolidadoArs },
      subcuentas: subcuentas || [],
      transferencias: transferencias || []
    });

  } catch (err) {
    console.error('[API -> getAhorros Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

