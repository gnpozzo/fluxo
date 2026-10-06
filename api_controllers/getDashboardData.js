import { operationInfo } from '../shared/operation.js';
import { readAll, readInBatches } from '../api_lib/read-all.js';
import { getSupabaseClient } from '../api_lib/supabase.js';
import { resolveUserCuenta } from '../api_lib/auth.js';

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
    } else if (req.body && typeof req.body === 'object') {
      finalArgs = [req.body.cuenta || req.body.idCuenta, req.body.fechaInicio, req.body.fechaFin];
    }

    if (Array.isArray(finalArgs[0])) {
      finalArgs = finalArgs[0];
    }
    const [cuenta, fechaInicio, fechaFin] = finalArgs;

    if (!cuenta) throw new Error("Parámetros insuficientes");

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'No autenticado' });
    }

    const resolvedCuenta = await resolveUserCuenta(supabase, cuenta, userId);
    if (!resolvedCuenta) {
      return res.status(403).json({ success: false, error: 'Acceso denegado: La cuenta no pertenece al usuario autenticado.' });
    }

    const movimientos=await readAll(()=>supabase.from('movimientos').select('*, categorias(nombre)').eq('id_cuenta_principal',resolvedCuenta).eq('user_id',userId).gte('fecha',fechaInicio).lte('fecha',fechaFin).order('fecha',{ascending:false}).order('id_movimiento'));

    // Map categorization name & series info
    if (movimientos && movimientos.length > 0) {
      const recurIds = [...new Set(movimientos.map(m => m.recur_group_id).filter(Boolean))];
      let recurCountsMap = {};
      if (recurIds.length > 0) {
        const recurRows=await readInBatches(recurIds,batch=>supabase.from('movimientos').select('recur_group_id').in('recur_group_id',batch).eq('user_id',userId).order('id_movimiento'));
        if (recurRows) {
          recurRows.forEach(r => {
            recurCountsMap[r.recur_group_id] = (recurCountsMap[r.recur_group_id] || 0) + 1;
          });
        }
      }

      movimientos.forEach(m => {
        m.categoria_nombre = m.categorias?.nombre || 'General';
        if (m.recur_group_id && recurCountsMap[m.recur_group_id]) {
          m.series_total = recurCountsMap[m.recur_group_id];
        }
        const info = operationInfo(m);
        m.descripcion = info.description;
        if (info.total > 1) { m.cuota_actual = info.current; m.cuota_total = info.total; }

      });
    }



    // Estado de pagos desde logs (persistencia sin requerir migración DDL estricta)
    const { data: logRows } = await supabase
      .from('logs')
      .select('contexto')
      .eq('funcion', 'ESTADO_PAGOS')
      .eq('mensaje', userId)
      .order('id', {ascending:false})
      .limit(1);
    const pagosMap = logRows?.[0]?.contexto || {};

    // Cálculo de capa intermedia en Edge Node.js (Más veloz que hacer el match en Frontend)
    let ingresos = 0, egresos = 0, egresosSaldados = 0, egresosPendientes = 0;
    const kpisPorMoneda={ARS:{ingresos:0,egresos:0,resultado:0},USD:{ingresos:0,egresos:0,resultado:0}};
    (movimientos || []).forEach(m => {
        m.pagado = !!pagosMap[m.id_movimiento]?.pagado;
        m.fecha_pago = pagosMap[m.id_movimiento]?.fecha_pago || null;

        const isPagoTC = m.id_categoria === 'CAT_PAGO_TC' || (typeof m.descripcion === 'string' && m.descripcion.toLowerCase().startsWith('pago resumen:'));
        m.is_pago_tc = isPagoTC;

        const amt = Math.abs(Number(m.importe));
        const native=kpisPorMoneda[m.moneda||'ARS'];
        if(native && !isPagoTC) {if(m.tipo_mov==='INGRESO')native.ingresos+=amt;else native.egresos+=amt;native.resultado=native.ingresos-native.egresos;}
        if(m.moneda==='USD') return;
        if (m.tipo_mov === 'INGRESO') ingresos += amt;
        if (m.tipo_mov === 'EGRESO') {
          // Filosofía Copilot / Monarch: El pago de resumen es un flujo de transferencia/pasivo.
          // No debe sumarse al total de egresos operativos para no duplicar con los consumos desglosados (Adobe, Showcase, etc.)
          if (!isPagoTC) {
            egresos -= amt;
            if (m.pagado) egresosSaldados += amt;
            else egresosPendientes += amt;
          }
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

    const histMovs=await readAll(()=>supabase.from('movimientos').select('*, categorias(nombre)').eq('id_cuenta_principal',resolvedCuenta).eq('user_id',userId).gte('fecha',startRange).lte('fecha',endRange).order('fecha').order('id_movimiento'));

    histMovs.forEach(m => {
      m.categoria_nombre = m.categorias?.nombre || 'General';
      const info = operationInfo(m); m.descripcion = info.description;
      if (info.total > 1) { m.cuota_actual = info.current; m.cuota_total = info.total; }
      m.pagado = !!pagosMap[m.id_movimiento]?.pagado;
      m.fecha_pago = pagosMap[m.id_movimiento]?.fecha_pago || null;
      m.is_pago_tc = m.id_categoria === 'CAT_PAGO_TC' || m.descripcion?.toLowerCase().startsWith('pago resumen:');
    });

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

    const usdBuckets=Object.fromEntries(Object.entries(mesesBuckets).map(([key,b])=>[key,{...b,ingresos:0,egresos:0}]));
    (histMovs || []).forEach(hm => {
      const buckets=hm.moneda==='USD'?usdBuckets:mesesBuckets;
      const mKey = (hm.fecha || '').substring(0, 7);
      if (buckets[mKey]) {
        const isPagoTC = hm.id_categoria === 'CAT_PAGO_TC' || (typeof hm.descripcion === 'string' && hm.descripcion.toLowerCase().startsWith('pago resumen:'));
        const amt = Math.abs(Number(hm.importe || 0));
        if (hm.tipo_mov === 'INGRESO') buckets[mKey].ingresos += amt;
        if (hm.tipo_mov === 'EGRESO' && !isPagoTC) buckets[mKey].egresos += amt;
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
      monedaKpis: 'ARS',
      kpisPorMoneda,
      movimientos: movimientos || [],
      evolucionMensual,
      movimientosHistoricos: histMovs,
      evolucionPorMoneda:{ARS:evolucionMensual,USD:Object.values(usdBuckets).map(b=>({...b,balance:b.ingresos-b.egresos}))}
    });


  } catch (err) {
    console.error('[API -> getDashboardData -> ERROR]', err.message);
    return res.status(err.status || 500).json({ success: false, error: err.status ? err.message : 'No se pudo completar la operación.' });
  }
}
