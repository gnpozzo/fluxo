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
        .select('id_consumo_tarjeta_origen, id_cuenta_principal, tipo_mov')
        .in('id_consumo_tarjeta_origen', consumoIds)
        .eq('user_id', userId);
      if (!movsErr) {
        movimientos = movsRes || [];
      }
    }

    const { data: allUserCuentas } = await supabase
      .from('cuentas_principales')
      .select('id_cuenta_principal, nombre, icono')
      .eq('user_id', userId);
    const cuentaMap = {};
    (allUserCuentas || []).forEach(acc => { cuentaMap[acc.id_cuenta_principal] = acc; });

    // Prioritize EGRESO movement to determine the account to which the consumption was charged
    const mapMovs = {};
    movimientos.forEach(m => {
      if (m.id_consumo_tarjeta_origen) {
        if (!mapMovs[m.id_consumo_tarjeta_origen] || m.tipo_mov === 'EGRESO') {
          mapMovs[m.id_consumo_tarjeta_origen] = m;
        }
      }
    });

    (consumos || []).forEach(c => {
      const mov = mapMovs[c.id_consumo_tarjeta];
      if (mov) {
        c.imputado = true;
        c.id_cuenta_imputada = mov.id_cuenta_principal;
        c.es_incidencia_externa = (mov.id_cuenta_principal !== cuenta);
        const accInfo = cuentaMap[mov.id_cuenta_principal];
        if (c.es_incidencia_externa) {
          c.cuenta_imputada_nombre = accInfo?.nombre || 'Externa';
          c.cuenta_imputada_icono = accInfo?.icono || 'home';
        } else {
          c.cuenta_imputada_nombre = 'Propios';
          c.cuenta_imputada_icono = accInfo?.icono || 'person';
        }
      } else {
        c.imputado = false;
        c.id_cuenta_imputada = null;
        c.es_incidencia_externa = false;
        c.cuenta_imputada_nombre = null;
        c.cuenta_imputada_icono = null;
      }

      c.tipo_consumo = c.recur_group_id?.startsWith('REC_') ? 'RECURRENTE' : (Number(c.cuota_total) > 1 ? 'CUOTAS' : 'COMUN');
    });

    // Obtener estado de pagos
    const { data: logRows } = await supabase
      .from('logs')
      .select('contexto')
      .eq('funcion', 'ESTADO_PAGOS')
      .eq('mensaje', userId)
      .limit(1);
    const pagosMap = logRows?.[0]?.contexto || {};

    let saldoTotal = 0;
    let incidenciaPersonal = 0;
    let incidenciaFamiliar = 0;
    let saldoSaldado = 0;
    let saldoPendiente = 0;

    (consumos || []).forEach(c => {
      c.pagado = !!pagosMap[c.id_consumo_tarjeta]?.pagado;
      c.fecha_pago = pagosMap[c.id_consumo_tarjeta]?.fecha_pago || null;

      if (c.moneda === 'USD') return;
      const imp = Number(c.importe || 0);
      saldoTotal += imp;
      
      if (c.pagado) saldoSaldado += imp;
      else saldoPendiente += imp;

      // Calculate incidence based on imputado flag and external status
      if (c.imputado && c.es_incidencia_externa) {
        incidenciaFamiliar += imp;
      } else {
        incidenciaPersonal += imp;
      }
    });

    return res.status(200).json({
      success: true,
      kpis: { saldoTotal, incidenciaPersonal, incidenciaFamiliar, saldoSaldado, saldoPendiente },
      pagosMap,
      consumos: consumos || []
    });


  } catch (err) {
    console.error('[API -> getConsumosTC Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
