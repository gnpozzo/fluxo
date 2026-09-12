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

    // Consulta histórica y proyectada para evolución temporal (12 meses móviles + resto del año en curso)
    const [yNum, mNum] = fechaInicio.split('-').map(Number);
    const activeMesKey = `${yNum}-${String(mNum).padStart(2, '0')}`;

    // 11 meses atrás para 12M histórico
    const dHist = new Date(Date.UTC(yNum, mNum - 1, 1));
    dHist.setUTCMonth(dHist.getUTCMonth() - 11);
    const startRange = `${dHist.getUTCFullYear()}-${String(dHist.getUTCMonth() + 1).padStart(2, '0')}-01`;

    // Hasta fin de año en curso para proyecciones
    const endRange = `${yNum}-12-31`;

    const { data: histMovs } = await supabase
      .from('movimientos')
      .select('fecha, tipo_mov, importe, tipo_egreso')
      .eq('id_cuenta_principal', cuenta)
      .eq('user_id', userId)
      .gte('fecha', startRange)
      .lte('fecha', endRange);

    // Identificar todos los meses desde startRange hasta fin de año en curso
    const mesesBuckets = {};
    const dIter = new Date(Date.UTC(dHist.getUTCFullYear(), dHist.getUTCMonth(), 1));
    const dEnd = new Date(Date.UTC(yNum, 11, 1)); // Diciembre del año en curso

    while (dIter <= dEnd) {
      const key = `${dIter.getUTCFullYear()}-${String(dIter.getUTCMonth() + 1).padStart(2, '0')}`;
      mesesBuckets[key] = {
        mes: key,
        ingresos: 0,
        egresos: 0,
        balance: 0,
        esProyectado: key > activeMesKey
      };
      dIter.setUTCMonth(dIter.getUTCMonth() + 1);
    }

    (histMovs || []).forEach(hm => {
      const mKey = (hm.fecha || '').substring(0, 7);
      if (mesesBuckets[mKey]) {
        const amt = Math.abs(Number(hm.importe || 0));
        if (hm.tipo_mov === 'INGRESO') mesesBuckets[mKey].ingresos += amt;
        if (hm.tipo_mov === 'EGRESO') mesesBuckets[mKey].egresos += amt;
      }
    });

    const evolucionMensual = Object.values(mesesBuckets).map(b => ({
      mes: b.mes,
      ingresos: b.ingresos,
      egresos: b.egresos,
      balance: b.ingresos - b.egresos,
      esProyectado: b.esProyectado
    }));

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
      movimientos: movimientos || [],
      evolucionMensual
    });


  } catch (err) {
    console.error('[API -> getDashboardData -> ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
