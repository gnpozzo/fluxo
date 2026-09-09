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

    let consumos = [];
    let error = null;

    // 1. First get all cards for this account
    const { data: tarjetas, error: tErr } = await supabase
      .from('tarjetas')
      .select('id_tarjeta, nombre, fecha_cierre_actual, fecha_vencimiento_actual, total_resumen_ars, total_resumen_usd')
      .eq('id_cuenta_principal', cuenta)
      .eq('user_id', userId);
    if (tErr) throw tErr;

    const tarjetaMap = {};
    const tarjetaIds = (tarjetas || []).map(t => {
      tarjetaMap[t.id_tarjeta] = t.nombre;
      return t.id_tarjeta;
    });

    const consumosMap = new Map();

    // Try RPC first for date range
    try {
      const rpcRes = await supabase.rpc('get_consumos_tc_list', {
        p_id_cuenta: cuenta,
        p_fecha_inicio: fechaInicio,
        p_fecha_fin: fechaFin
      });
      if (!rpcRes.error && Array.isArray(rpcRes.data)) {
        rpcRes.data.forEach(c => {
          if (c.id_consumo_tarjeta) consumosMap.set(c.id_consumo_tarjeta, c);
        });
      }
    } catch (e) {
      console.warn('[getConsumosTC] RPC notice:', e.message);
    }

    // Direct fallback for date range if RPC returned nothing
    if (tarjetaIds.length > 0 && consumosMap.size === 0) {
      let query = supabase.from('consumos_tc').select('*, categorias (nombre)').in('id_tarjeta', tarjetaIds).eq('user_id', userId);
      if (fechaInicio) query = query.gte('fecha', fechaInicio);
      if (fechaFin) query = query.lte('fecha', fechaFin);
      const { data: dFallback } = await query;
      (dFallback || []).forEach(c => {
        consumosMap.set(c.id_consumo_tarjeta, {
          ...c,
          tarjeta_nombre: tarjetaMap[c.id_tarjeta] || '—',
          categoria_nombre: c.categorias?.nombre || 'General'
        });
      });
    }

    // Include statement consumptions for any card whose vencimiento or cierre falls in [fechaInicio, fechaFin]
    for (const tc of (tarjetas || [])) {
      const isDueInMonth = (tc.fecha_vencimiento_actual && tc.fecha_vencimiento_actual >= fechaInicio && tc.fecha_vencimiento_actual <= fechaFin) ||
                           (tc.fecha_cierre_actual && tc.fecha_cierre_actual >= fechaInicio && tc.fecha_cierre_actual <= fechaFin);
      if (isDueInMonth) {
        let qStmt = supabase.from('consumos_tc')
          .select('*, categorias (nombre)')
          .eq('id_tarjeta', tc.id_tarjeta)
          .eq('user_id', userId);
        if (tc.fecha_cierre_actual) {
          qStmt = qStmt.lte('fecha', tc.fecha_cierre_actual);
        }
        const { data: stmtData } = await qStmt;
        (stmtData || []).forEach(c => {
          if (!consumosMap.has(c.id_consumo_tarjeta)) {
            consumosMap.set(c.id_consumo_tarjeta, {
              ...c,
              tarjeta_nombre: tc.nombre,
              categoria_nombre: c.categorias?.nombre || 'General'
            });
          }
        });
      }
    }

    consumos = Array.from(consumosMap.values());

    // Map id_tarjeta based on tarjeta_nombre if missing
    consumos.forEach(c => {
      if (!c.id_tarjeta && c.tarjeta_nombre) {
        const found = (tarjetas || []).find(t => t.nombre.toLowerCase() === c.tarjeta_nombre.toLowerCase());
        if (found) c.id_tarjeta = found.id_tarjeta;
      }
    });

    // Map the imputado and cuenta_imputada_nombre fields to align with layout expectations.
    // Query movements related to these card consumptions to verify if they are imputed.
    const consumoIds = (consumos || []).map(c => c.id_consumo_tarjeta);
    let movimientos = [];
    if (consumoIds.length > 0) {
      const { data: movsRes, error: movsErr } = await supabase
        .from('movimientos')
        .select('id_consumo_tarjeta_origen, id_cuenta_principal')
        .in('id_consumo_tarjeta_origen', consumoIds)
        .eq('user_id', userId);
      if (!movsErr) {
        movimientos = movsRes || [];
      }
    }

    const mapMovs = {};
    movimientos.forEach(m => {
      if (m.id_consumo_tarjeta_origen) {
        mapMovs[m.id_consumo_tarjeta_origen] = m;
      }
    });

    (consumos || []).forEach(c => {
      const mov = mapMovs[c.id_consumo_tarjeta];
      if (mov) {
        c.imputado = true;
        if (mov.id_cuenta_principal === cuenta) {
          c.cuenta_imputada_nombre = 'Propios';
        } else {
          c.cuenta_imputada_nombre = 'Familiar / Otros';
        }
      } else {
        c.imputado = false;
        c.cuenta_imputada_nombre = null;
      }
    });

    let saldoTotal = 0;
    let incidenciaPersonal = 0;
    let incidenciaFamiliar = 0;

    (consumos || []).forEach(c => {
      if (c.moneda === 'USD') return;
      const imp = Number(c.importe || 0);
      saldoTotal += imp;
      
      // Calculate incidence based on imputado flag or cuenta_imputada_nombre
      if (c.imputado && c.cuenta_imputada_nombre !== 'Propios') {
        incidenciaFamiliar += imp;
      } else {
        incidenciaPersonal += imp;
      }
    });

    return res.status(200).json({
      success: true,
      kpis: { saldoTotal, incidenciaPersonal, incidenciaFamiliar },
      consumos: consumos || []
    });

  } catch (err) {
    console.error('[API -> getConsumosTC Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
