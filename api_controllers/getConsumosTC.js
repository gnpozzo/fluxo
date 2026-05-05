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
    }
    const [cuenta, fechaInicio, fechaFin] = finalArgs;
    
    if (!cuenta) throw new Error("Falta id de cuenta");

    let consumos = [];
    let error = null;

    // Try RPC first
    const rpcRes = await supabase.rpc('get_consumos_tc_list', {
      p_id_cuenta: cuenta,
      p_fecha_inicio: fechaInicio,
      p_fecha_fin: fechaFin
    });

    if (!rpcRes.error) {
       consumos = rpcRes.data;
    } else {
       // Fallback: get tarjetas for this account, then get their consumos
       const { data: tarjetas, error: tErr1 } = await supabase
         .from('tarjetas')
         .select('id_tarjeta')
         .eq('id_cuenta_principal', cuenta);
       if (tErr1) throw tErr1;
       
       const tarjetaIds = (tarjetas || []).map(t => t.id_tarjeta);
       if (tarjetaIds.length > 0) {
         let query = supabase.from('consumos_tc').select('*').in('id_tarjeta', tarjetaIds);
         if (fechaInicio) query = query.gte('fecha', fechaInicio);
         if (fechaFin) query = query.lte('fecha', fechaFin);
         const { data, error: tErr2 } = await query;
         if (tErr2) throw tErr2;
         consumos = data;
       }
    }

    let saldoTotal = 0;
    let incidenciaPersonal = 0;
    let incidenciaFamiliar = 0;

    (consumos || []).forEach(c => {
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

