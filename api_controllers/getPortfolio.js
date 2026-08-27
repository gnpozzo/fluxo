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
      finalArgs = [req.body.cuenta || req.body.idCuenta];
    }

    const idCuenta = finalArgs[0];
    if (!idCuenta) {
      return res.status(400).json({ success: false, error: 'Falta parámetro idCuenta' });
    }

    let movimientos = [];

    // 1. Consultar RPC o tabla
    const rpcRes = await supabase.rpc('get_inversiones_movimientos', { p_id_cuenta: idCuenta });
    if (!rpcRes.error && Array.isArray(rpcRes.data)) {
      movimientos = rpcRes.data;
    } else {
      const { data, error } = await supabase
        .from('inversiones_movimientos')
        .select('*')
        .order('fecha', { ascending: false });

      if (error) {
        console.warn('[getPortfolio] Supabase query notice:', error.message);
      }
      movimientos = data || [];
    }

    if (!movimientos || movimientos.length === 0) {
      return res.status(200).json({
        success: true,
        kpis: { valorActual: 0, costoTotal: 0, gananciaTotal: 0, rendimientoPorc: 0 },
        portfolio: []
      });
    }

    // 2. Extraer tickers únicos para cotización
    const tickersUnicos = [...new Set(movimientos.map(m => m.ticker).filter(Boolean))];
    const preciosPorTicker = {};

    // Obtener cotización Dólar CCL / MEP para conversiones
    let cotizUSD = 1540;
    try {
      const rdResp = await fetch('https://rendimientos.co/api/cotizaciones', { signal: AbortSignal.timeout(3000) });
      if (rdResp.ok) {
        const rd = await rdResp.json();
        if (rd?.ccl?.price) cotizUSD = rd.ccl.price;
        else if (rd?.mep?.price) cotizUSD = rd.mep.price;
      }
    } catch (_) {}

    // Intentar cotizar tickers consultando rendimientos.co
    await Promise.all(tickersUnicos.map(async (ticker) => {
      try {
        const resp = await fetch(`https://rendimientos.co/api/mundo?symbol=${encodeURIComponent(ticker.toUpperCase())}&range=1d`, {
          signal: AbortSignal.timeout(2500)
        });
        if (resp.ok) {
          const item = await resp.json();
          const d = Array.isArray(item) ? item[0] : item;
          const precio = d?.price || d?.regularMarketPrice || d?.c || null;
          if (precio) preciosPorTicker[ticker] = Number(precio);
        }
      } catch (_) {}
    }));

    // 3. Calcular tenencias actuales
    const tenencias = {};
    movimientos.forEach(mov => {
      const t = mov.ticker;
      if (!t) return;
      if (!tenencias[t]) {
        tenencias[t] = { cantNominales: 0, costoTotalArs: 0, cantCompra: 0, moneda: mov.moneda || 'ARS' };
      }
      const cant = Number(mov.cantidad_nominales || mov.cantidad || 0);
      const imp = Number(mov.importe_total_ars || (cant * Number(mov.precio_compra || mov.precio || 0)));

      if (mov.tipo_operacion === 'COMPRA') {
        tenencias[t].cantNominales += cant;
        tenencias[t].costoTotalArs += imp;
        tenencias[t].cantCompra += cant;
      } else if (mov.tipo_operacion === 'VENTA') {
        tenencias[t].cantNominales -= cant;
      }
    });

    let kpiValorTotal = 0;
    let kpiCostoTotal = 0;

    Object.keys(tenencias).forEach(ticker => {
      const ten = tenencias[ticker];
      if (ten.cantNominales <= 0.0001) return;
      const precioActual = preciosPorTicker[ticker] || 0;
      let valorActualArs = ten.cantNominales * precioActual;
      if (ten.moneda === 'USD') valorActualArs *= cotizUSD;
      const precioPromArs = ten.cantCompra > 0 ? ten.costoTotalArs / ten.cantCompra : 0;
      const costoProporArs = precioPromArs * ten.cantNominales;
      kpiValorTotal += valorActualArs;
      kpiCostoTotal += costoProporArs;
    });

    const kpiGananciaTotal = kpiValorTotal - kpiCostoTotal;
    const kpiRendimientoPorc = kpiCostoTotal > 0 ? (kpiGananciaTotal / kpiCostoTotal) * 100 : 0;

    // 4. Mapear operaciones individuales para la UI
    const portfolio = movimientos.map(mov => {
      const precioActual = preciosPorTicker[mov.ticker] || null;
      const cant = Number(mov.cantidad_nominales || mov.cantidad || 0);
      const precioCompra = Number(mov.precio_compra || mov.precio || 0);
      let ganancia = null;

      if (mov.tipo_operacion === 'COMPRA' && precioActual != null && precioActual > 0) {
        const valorActual = cant * precioActual;
        const costo = cant * precioCompra;
        const gananciaEnMoneda = valorActual - costo;
        ganancia = (mov.moneda === 'USD') ? gananciaEnMoneda * cotizUSD : gananciaEnMoneda;
      }

      return {
        id_operacion: mov.id_inversion_mov || mov.id,
        fecha: mov.fecha,
        tipo_op: mov.tipo_operacion || mov.tipo_op,
        ticker: mov.ticker,
        moneda: mov.moneda || 'ARS',
        cantidad: cant,
        precio: precioCompra,
        precio_actual: precioActual,
        ganancia: ganancia
      };
    });

    return res.status(200).json({
      success: true,
      kpis: {
        valorActual: kpiValorTotal,
        costoTotal: kpiCostoTotal,
        gananciaTotal: kpiGananciaTotal,
        rendimientoPorc: kpiRendimientoPorc
      },
      portfolio: portfolio
    });

  } catch (err) {
    console.error('[getPortfolio -> ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}