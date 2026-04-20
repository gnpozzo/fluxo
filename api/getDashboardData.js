import { createClient } from '@supabase/supabase-js';

// [Origen -> api -> getDashboardData.js]
// v6.0.0
// Serverless Function para Vercel. 
// Reemplaza a las APIS de Google Apps Script ejecutando las consultas con cliente nativo Rest.
// Provee seguridad centralizada y valida variables de Entorno local vs Prod.

export default async function handler(req, res) {
  // Manejo de preflight y validación de métodos (CORS es manejado por vercel.json)
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('[QA -> Vercel API] Variables de entorno de Supabase no definidas.');
    return res.status(500).json({ success: false, error: 'Internal Configuration Error' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    const { cuenta, fechaInicio, fechaFin } = req.body;

    // Emulación del RPC consolidado que usaba GAS (pgRpc)
    const { data: movimientos, error: movError } = await supabase.rpc('get_movimientos_dashboard', {
      p_id_cuenta: cuenta,
      p_fecha_inicio: fechaInicio,
      p_fecha_fin: fechaFin
    });

    if (movError) throw movError;

    // Cálculo de capa intermedia en Edge Node.js (Más veloz que hacer el match en Frontend)
    let ingresos = 0, egresos = 0;
    (movimientos || []).forEach(m => {
        if (m.tipo_mov === 'INGRESO') ingresos += Number(m.importe);
        if (m.tipo_mov === 'EGRESO') egresos += Number(m.importe);
    });

    return res.status(200).json({
      success: true,
      kpis: {
        ingresos,
        egresos,
        resultado: ingresos - Math.abs(egresos)
      },
      movimientos: movimientos || []
    });

  } catch (err) {
    console.error('[API -> getDashboardData -> ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
