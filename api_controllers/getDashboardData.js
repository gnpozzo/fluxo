import { getSupabaseClient } from '../api_lib/supabase.js';

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

    if (!cuenta) throw new Error("Parámetros insuficientes");

    const { data: movimientos, error: movError } = await supabase
      .from('movimientos')
      .select('*, categorias (nombre)')
      .eq('id_cuenta_principal', cuenta)
      .gte('fecha', fechaInicio)
      .lte('fecha', fechaFin)
      .order('fecha', { ascending: false });

    // Map categorization name
    if (movimientos) {
      movimientos.forEach(m => {
        m.categoria_nombre = m.categorias?.nombre || 'General';
      });
    }

    if (movError) throw movError;

    // Cálculo de capa intermedia en Edge Node.js (Más veloz que hacer el match en Frontend)
    let ingresos = 0, egresos = 0;
    (movimientos || []).forEach(m => {
        const amt = Math.abs(Number(m.importe));
        if (m.tipo_mov === 'INGRESO') ingresos += amt;
        if (m.tipo_mov === 'EGRESO') egresos -= amt;
    });

    return res.status(200).json({
      success: true,
      kpis: {
        ingresos,
        egresos,
        resultado: ingresos + egresos
      },
      movimientos: movimientos || []
    });

  } catch (err) {
    console.error('[API -> getDashboardData -> ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
