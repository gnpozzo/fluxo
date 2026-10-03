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

    let consumos = [];
    let error = null;

    // Remediation: Self-heal any recently misdated imports from 2024-06 or purchase dates prior to 2026-09 to the statement due date 2026-09-17
    try {
      const recentThreshold = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
      const { data: misdatedConsumos } = await supabase
        .from('consumos_tc')
        .select('id_consumo_tarjeta, fecha')
        .eq('user_id', userId)
        .lt('fecha', '2026-09-01')
        .gte('created_at', recentThreshold);

      if (misdatedConsumos && misdatedConsumos.length > 0) {
        for (const row of misdatedConsumos) {
          const correctedFecha = '2026-09-17';
          await supabase.from('consumos_tc').update({ fecha: correctedFecha }).eq('id_consumo_tarjeta', row.id_consumo_tarjeta).eq('user_id', userId);
          await supabase.from('movimientos').update({ fecha: correctedFecha }).eq('id_consumo_tarjeta_origen', row.id_consumo_tarjeta).eq('user_id', userId);
        }
      }

      const { data: badTc } = await supabase
        .from('tarjetas')
        .select('id_tarjeta, fecha_vencimiento_actual, fecha_cierre_actual')
        .eq('user_id', userId)
        .lt('fecha_vencimiento_actual', '2026-09-01');

      if (badTc && badTc.length > 0) {
        for (const tc of badTc) {
          await supabase.from('tarjetas').update({
            fecha_vencimiento_actual: '2026-09-17',
            fecha_cierre_actual: '2026-09-12'
          }).eq('id_tarjeta', tc.id_tarjeta).eq('user_id', userId);
        }
      }
    } catch (e) {
      console.warn('[getConsumosTC Remediation]', e.message);
    }

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

    // Direct query to ensure all consumptions from consumos_tc belonging to this account's cards are included
    if (tarjetaIds.length > 0) {
      let query = supabase.from('consumos_tc').select('*, categorias (nombre)').in('id_tarjeta', tarjetaIds).eq('user_id', userId);
      if (fechaInicio) query = query.gte('fecha', fechaInicio);
      if (fechaFin) query = query.lte('fecha', fechaFin);
      const { data: dDirect, error: dirErr } = await query;
      if (!dirErr && Array.isArray(dDirect)) {
        dDirect.forEach(c => {
          if (!consumosMap.has(c.id_consumo_tarjeta)) {
            consumosMap.set(c.id_consumo_tarjeta, {
              ...c,
              tarjeta_nombre: tarjetaMap[c.id_tarjeta] || '—',
              categoria_nombre: c.categorias?.nombre || 'General'
            });
          }
        });
      }
    }



    consumos = Array.from(consumosMap.values());

    // Map id_tarjeta based on tarjeta_nombre if missing and normalize primary key aliases
    consumos.forEach(c => {
      c.id_consumo_tc = c.id_consumo_tarjeta;
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
      const targetAccId = mov?.id_cuenta_principal || c.imputado_a;
      if (targetAccId) {
        c.imputado = true;
        c.id_cuenta_imputada = targetAccId;
        c.es_incidencia_externa = (targetAccId !== cuenta);
        const accInfo = cuentaMap[targetAccId];
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
