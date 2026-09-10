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
    } else if (req.body && typeof req.body === 'object') {
      finalArgs = [req.body.cuenta, req.body.mes];
    }

    const [cuenta, mesYYYYMM] = finalArgs;

    if (!cuenta || !mesYYYYMM) {
      return res.status(400).json({ success: false, error: 'Faltan parámetros idCuenta o mes (YYYY-MM)' });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'No autenticado' });
    }

    const isOwner = await verifyCuentaOwnership(supabase, cuenta, userId);
    if (!isOwner) {
      return res.status(403).json({ success: false, error: 'Acceso denegado: La cuenta no pertenece al usuario autenticado.' });
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
        .eq('id_cuenta_principal', cuenta)
        .eq('user_id', userId);

      if (tErr) throw tErr;

      const tarjetaIds = (tarjetas || []).map(t => t.id_tarjeta);
      if (tarjetaIds.length > 0) {
        const { data: cData, error: cErr } = await supabase
          .from('consumos_tc')
          .select('fecha, importe, descripcion, moneda')
          .in('id_tarjeta', tarjetaIds)
          .eq('user_id', userId)
          .gte('fecha', fechaInicio)
          .lte('fecha', fechaFin);

        if (cErr) throw cErr;
        consumos = cData || [];
      }
    }

    // Funciones auxiliares para detección de impuestos existentes y consumos gravados
    const isTaxDesc = (desc = '') => {
      const d = desc.toLowerCase();
      return (
        d.includes('impuesto de sellos') ||
        d.includes('sellos') ||
        d.includes('iibb percep') ||
        d.includes('iva rg 4240') ||
        d.includes('db.rg 5617') ||
        d.includes('percep-sant') ||
        d.startsWith('db.rg') ||
        d.startsWith('iva rg') ||
        d.startsWith('iibb') ||
        d.startsWith('impuesto')
      );
    };

    const isDigitalOrUsd = (c) => {
      if (c.moneda === 'USD') return true;
      const d = (c.descripcion || '').toLowerCase();
      return (
        d.includes('adobe') ||
        d.includes('google') ||
        d.includes('youtube') ||
        d.includes('netflix') ||
        d.includes('spotify') ||
        d.includes('apple') ||
        d.includes('amazon') ||
        d.includes('microsoft') ||
        d.includes('openai') ||
        d.includes('github') ||
        d.includes('steam') ||
        d.includes('uber') ||
        d.includes('patreon')
      );
    };

    // Inicializar los 12 meses con subtotales y bases imponibles
    const objMeses = {};
    for (let i = 0; i < 12; i++) {
      const m = new Date(start);
      m.setMonth(start.getMonth() + i);
      const k = m.toISOString().substring(0, 7);
      objMeses[k] = {
        subtotal_consumos: 0,
        base_digital: 0
      };
    }

    // Sumarizar importes por mes excluyendo duplicación de impuestos históricos
    consumos.forEach(c => {
      const mesStr = (c.fecha || '').substring(0, 7);
      if (objMeses[mesStr] !== undefined) {
        if (!isTaxDesc(c.descripcion)) {
          const imp = Number(c.importe || 0);
          objMeses[mesStr].subtotal_consumos += imp;
          if (isDigitalOrUsd(c)) {
            objMeses[mesStr].base_digital += imp;
          }
        }
      }
    });

    const proyeccion = Object.keys(objMeses).sort().map(m => {
      const sub = Math.round(objMeses[m].subtotal_consumos * 100) / 100;
      const baseDig = Math.round(objMeses[m].base_digital * 100) / 100;

      // Sellos provincial (0.10% = 1 por mil sobre el total de la liquidación en pesos/USD pesificados)
      const sellos = Math.round(sub * 0.001 * 100) / 100;

      // Impuestos sobre servicios digitales del exterior (normativa AFIP/ARCA y Santa Fe)
      const iva_digital = baseDig > 0 ? Math.round(baseDig * 0.21 * 100) / 100 : 0;
      const ganancias_rg5617 = baseDig > 0 ? Math.round(baseDig * 0.30 * 100) / 100 : 0;
      const iibb_santafe = baseDig > 0 ? Math.round(baseDig * 0.03 * 100) / 100 : 0;

      const total_impuestos = Math.round((sellos + iva_digital + ganancias_rg5617 + iibb_santafe) * 100) / 100;
      const total = Math.round((sub + total_impuestos) * 100) / 100;

      return {
        mes: m,
        subtotal_consumos: sub,
        impuestos: {
          sellos,
          iva_digital,
          ganancias_rg5617,
          iibb_santafe,
          total_impuestos
        },
        total
      };
    });

    return res.status(200).json({
      success: true,
      proyeccion: proyeccion,
      totales: {
        subtotal_consumos: proyeccion.reduce((acc, p) => acc + p.subtotal_consumos, 0),
        total_impuestos: proyeccion.reduce((acc, p) => acc + p.impuestos.total_impuestos, 0),
        total: proyeccion.reduce((acc, p) => acc + p.total, 0)
      }
    });

  } catch (err) {
    console.error('[getProyeccionTC -> ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}