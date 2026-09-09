// Cache en memoria para la serverless function (TTL 60s)
let cachedData = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60 * 1000;

export default async function handler(req, res) {
  const now = Date.now();
  if (cachedData && (now - lastFetchTime < CACHE_TTL_MS)) {
    return res.status(200).json(cachedData);
  }

  try {
    const cotizaciones = {
      success: true,
      oficial: { compra: 1500, venta: 1535 },
      bolsa: { compra: 1520, venta: 1545 },
      contadoconliqui: { compra: 1580, venta: 1605 },
      blue: { compra: 1530, venta: 1555 },
      cripto: { compra: 1570, venta: 1595 },
      mayorista: { compra: 1490, venta: 1515 },
      risk_country: 509,
      lastUpdated: new Date().toISOString()
    };

    // 1. Fetch de dolarapi.com (dólares en Argentina)
    try {
      const resp = await fetch('https://dolarapi.com/v1/dolares', { signal: AbortSignal.timeout(4000) });
      if (resp.ok) {
        const arr = await resp.json();
        if (Array.isArray(arr)) {
          arr.forEach(d => {
            const key = d.casa?.toLowerCase();
            if (key) {
              cotizaciones[key] = {
                compra: Number(d.compra || d.venta || 0),
                venta: Number(d.venta || d.compra || 0),
                tipo: key,
                fechaActualizacion: d.fechaActualizacion
              };
            }
          });
        }
      }
    } catch (e) {
      console.warn('[getDolarCotizaciones] dolarapi error:', e.message);
    }

    // 2. Fetch de argentinadatos.com para Riesgo País oficial
    try {
      const respRd = await fetch('https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo', { signal: AbortSignal.timeout(3500) });
      if (respRd.ok) {
        const rd = await respRd.json();
        if (rd?.valor != null) {
          cotizaciones.risk_country = rd.valor;
        }
      }
    } catch (e) {
      console.warn('[getDolarCotizaciones] argentinadatos error:', e.message);
    }

    cotizaciones.lastUpdated = new Date().toISOString();
    cachedData = cotizaciones;
    lastFetchTime = now;

    return res.status(200).json(cotizaciones);
  } catch (err) {
    console.error('[getDolarCotizaciones -> ERROR]', err.message);
    if (cachedData) return res.status(200).json(cachedData);
    return res.status(500).json({ success: false, error: err.message });
  }
}
