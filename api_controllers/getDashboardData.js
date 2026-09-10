import { getSupabaseClient } from '../api_lib/supabase.js';
import { verifyCuentaOwnership } from '../api_lib/auth.js';

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

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'No autenticado' });
    }

    const isOwner = await verifyCuentaOwnership(supabase, cuenta, userId);
    if (!isOwner) {
      return res.status(403).json({ success: false, error: 'Acceso denegado: La cuenta no pertenece al usuario autenticado.' });
    }

    const { data: movimientos, error: movError } = await supabase
      .from('movimientos')
      .select('*, categorias (nombre)')
      .eq('id_cuenta_principal', cuenta)
      .eq('user_id', userId)
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

    // Estado de pagos desde logs (persistencia sin requerir migración DDL estricta)
    const { data: logRows } = await supabase
      .from('logs')
      .select('contexto')
      .eq('funcion', 'ESTADO_PAGOS')
      .eq('mensaje', userId)
      .limit(1);
    const pagosMap = logRows?.[0]?.contexto || {};

    // Cálculo de capa intermedia en Edge Node.js (Más veloz que hacer el match en Frontend)
    let ingresos = 0, egresos = 0, egresosSaldados = 0, egresosPendientes = 0;
    (movimientos || []).forEach(m => {
        m.pagado = !!pagosMap[m.id_movimiento]?.pagado;
        m.fecha_pago = pagosMap[m.id_movimiento]?.fecha_pago || null;

        const amt = Math.abs(Number(m.importe));
        if (m.tipo_mov === 'INGRESO') ingresos += amt;
        if (m.tipo_mov === 'EGRESO') {
          egresos -= amt;
          if (m.pagado) egresosSaldados += amt;
          else egresosPendientes += amt;
        }
    });

    const totalEgrAbs = Math.abs(egresos);

    return res.status(200).json({
      success: true,
      kpis: {
        ingresos,
        egresos,
        resultado: ingresos + egresos,
        egresosSaldados,
        egresosPendientes,
        pctSaldado: totalEgrAbs > 0 ? Math.round((egresosSaldados / totalEgrAbs) * 100) : 0,
        pctPendiente: totalEgrAbs > 0 ? Math.round((egresosPendientes / totalEgrAbs) * 100) : 0
      },
      movimientos: movimientos || []
    });


  } catch (err) {
    console.error('[API -> getDashboardData -> ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
