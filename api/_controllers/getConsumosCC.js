import { getSupabaseClient } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const supabase = getSupabaseClient(req);
    const [cuenta, fechaInicio, fechaFin] = req.body || [];

    const { data: consumos, error } = await supabase.rpc('get_consumos_cc_list', {
      p_id_cuenta: cuenta,
      p_fecha_inicio: fechaInicio,
      p_fecha_fin: fechaFin
    });

    if (error) throw error;

    let gastoYo = 0;
    let gastoOtro = 0;
    let saldoNeto = 0;

    (consumos || []).forEach(c => {
      const miParte = (Number(c.importe || 0) * Number(c.porcentaje_imputado || 100)) / 100;
      if (c.pagador === 'YO') {
        gastoYo += Number(c.importe || 0);
        saldoNeto += miParte;
      } else {
        gastoOtro += Number(c.importe || 0);
        saldoNeto -= miParte;
      }
    });

    return res.status(200).json({
      success: true,
      kpis: { saldoNeto, gastoYo, gastoOtro },
      consumos: consumos || []
    });

  } catch (err) {
    console.error('[API -> getConsumosCC Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

