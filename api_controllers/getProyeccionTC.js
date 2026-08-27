import { getSupabaseClient } from '../api_lib/supabase.js';

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
    } else if (req.body && typeof req.body === 'object') {
      finalArgs = [req.body.cuenta, req.body.mes];
    }

    const [cuenta, mesYYYYMM] = finalArgs;

    if (!cuenta || !mesYYYYMM) {
      return res.status(400).json({ success: false, error: 'Faltan parámetros idCuenta o mes (YYYY-MM)' });
    }

    const start = new Date(mesYYYYMM + '-01T12:00:00Z');
    const end = new Date(start);
    end.setMonth(start.getMonth() + 12);
    end.setDate(0); // Último día del mes 12
    const fechaFin = end.toISOString().split('T')[0];
    const fechaInicio = start.toISOString().split('T')[0];

    let consumos = [];

    // 1. Intentar por RPC
    const rpcRes = await supabase.rpc('get_consumos_tc_list', {
      p_id_cuenta: cuenta,
      p_fecha_inicio: fechaInicio,
      p_fecha_fin: fechaFin
    });

    if (!rpcRes.error && Array.isArray(rpcRes.data)) {
      consumos = rpcRes.data;
    } else {
      // Fallback: consultar por tarjetas de la cuenta
      const { data: tarjetas, error: tErr } = await supabase
        .from('tarjetas')
        .select('id_tarjeta')
        .eq('id_cuenta_principal', cuenta);

      if (tErr) throw tErr;

      const tarjetaIds = (tarjetas || []).map(t => t.id_tarjeta);
      if (tarjetaIds.length > 0) {
        const { data: cData, error: cErr } = await supabase
          .from('consumos_tc')
          .select('fecha, importe')
          .in('id_tarjeta', tarjetaIds)
          .gte('fecha', fechaInicio)
          .lte('fecha', fechaFin);

        if (cErr) throw cErr;
        consumos = cData || [];
      }
    }

    // Inicializar los 12 meses
    const objMeses = {};
    for (let i = 0; i < 12; i++) {
      const m = new Date(start);
      m.setMonth(start.getMonth() + i);
      const k = m.toISOString().substring(0, 7);
      objMeses[k] = 0;
    }

    // Sumarizar importes por mes
    consumos.forEach(c => {
      const mesStr = (c.fecha || '').substring(0, 7);
      if (objMeses[mesStr] !== undefined) {
        objMeses[mesStr] += Number(c.importe || 0);
      }
    });

    const proyeccion = Object.keys(objMeses).sort().map(m => ({
      mes: m,
      total: objMeses[m]
    }));

    return res.status(200).json({
      success: true,
      proyeccion: proyeccion,
      totales: {
        total: proyeccion.reduce((acc, p) => acc + p.total, 0)
      }
    });

  } catch (err) {
    console.error('[getProyeccionTC -> ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}