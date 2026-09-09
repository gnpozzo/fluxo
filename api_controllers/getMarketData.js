// Cache en memoria para la serverless function (TTL 2 minutos)
let cachedMarketData = null;
let lastMarketFetchTime = 0;
const CACHE_TTL_MS = 2 * 60 * 1000;

export default async function handler(req, res) {
  const now = Date.now();
  if (cachedMarketData && (now - lastMarketFetchTime < CACHE_TTL_MS)) {
    return res.status(200).json(cachedMarketData);
  }

  try {
    const fetchWithTimeout = async (url, ms = 4000, headers = {}) => {
      try {
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', ...headers },
          signal: AbortSignal.timeout(ms)
        });
        if (!resp.ok) return null;
        return await resp.json();
      } catch (err) {
        console.warn(`[getMarketData] Error fetching ${url}:`, err.message);
        return null;
      }
    };

    // 1. Fetch de fuentes públicas en paralelo
    const [dolaresRaw, riesgoRaw, bondsRaw, notesRaw] = await Promise.all([
      fetchWithTimeout('https://dolarapi.com/v1/dolares', 3500),
      fetchWithTimeout('https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo', 3500),
      fetchWithTimeout('https://data912.com/live/arg_bonds', 4000),
      fetchWithTimeout('https://data912.com/live/arg_notes', 4000)
    ]);

    // 2. Fetch de Yahoo Finance para Índices y Acciones líderes
    const yahooTickers = [
      { sym: '^GSPC', label: 'S&P 500', icon: '🇺🇸', group: 'Índices Globales' },
      { sym: '^IXIC', label: 'Nasdaq', icon: '💻', group: 'Índices Globales' },
      { sym: '^MERV', label: 'S&P Merval', icon: '🇦🇷', group: 'Índices Locales' },
      { sym: 'GGAL',  label: 'Galicia ADR', icon: '🏦', group: 'ADRs Argentinos' },
      { sym: 'YPF',   label: 'YPF ADR', icon: '⚡', group: 'ADRs Argentinos' },
      { sym: 'AAPL',  label: 'Apple CEDEAR', icon: '🍏', group: 'CEDEARs' },
      { sym: 'NVDA',  label: 'Nvidia CEDEAR', icon: '🤖', group: 'CEDEARs' }
    ];

    const yahooResults = await Promise.all(
      yahooTickers.map(async (item) => {
        const data = await fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.sym)}`, 3000);
        if (data?.chart?.result?.[0]?.meta) {
          const meta = data.chart.result[0].meta;
          const price = meta.regularMarketPrice || 0;
          const prev = meta.chartPreviousClose || meta.previousClose || price;
          const pct = prev ? Number(((price - prev) / prev * 100).toFixed(2)) : 0;
          return {
            symbol: item.sym.replace('^', ''),
            name: item.label,
            icon: item.icon,
            group: item.group,
            price: price,
            change: pct,
            pct_change: pct
          };
        }
        return null;
      })
    );

    const validYahoo = yahooResults.filter(Boolean);

    // 3. Procesar Dólares
    const dolaresMap = {};
    const dolaresTicker = [];
    if (Array.isArray(dolaresRaw)) {
      dolaresRaw.forEach(d => {
        const casa = d.casa?.toLowerCase();
        if (casa) {
          dolaresMap[casa] = {
            nombre: d.nombre,
            compra: Number(d.compra || 0),
            venta: Number(d.venta || 0)
          };
        }
      });

      const ordenDolar = ['blue', 'bolsa', 'contadoconli', 'oficial'];
      ordenDolar.forEach(k => {
        const d = dolaresMap[k];
        if (d && d.venta > 0) {
          dolaresTicker.push({
            symbol: k === 'bolsa' ? 'USD MEP' : k === 'contadoconli' ? 'USD CCL' : `USD ${d.nombre}`,
            name: `Dólar ${d.nombre}`,
            price: `$ ${d.venta.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            raw_price: d.venta,
            pct_change: 0,
            tipo: 'dolar',
            badge: 'FX'
          });
        }
      });
    }

    // 4. Riesgo País
    const riesgoPaisVal = riesgoRaw?.valor || null;
    const riesgoPaisItem = riesgoPaisVal ? {
      symbol: 'RIESGO PAÍS',
      name: 'Riesgo País (EMBI+)',
      price: `${riesgoPaisVal.toLocaleString('es-AR')} pb`,
      raw_price: riesgoPaisVal,
      pct_change: 0,
      tipo: 'riesgo',
      badge: 'ARG'
    } : null;

    // 5. Bonos Soberanos (data912.com)
    const bonds = Array.isArray(bondsRaw) ? bondsRaw : [];
    const keyBondSymbols = ['AL30D', 'GD30D', 'AL30', 'GD30', 'AE38'];
    const bondsMap = new Map();
    bonds.forEach(b => { if (b.symbol) bondsMap.set(b.symbol, b); });

    // Ordenar bonos por mayor variación absoluta del día
    const sortedBonds = [...bonds]
      .filter(b => (b.v || 0) > 0 || keyBondSymbols.includes(b.symbol))
      .sort((a, b) => Math.abs(b.pct_change || 0) - Math.abs(a.pct_change || 0));

    const selectedBonds = [];
    const selectedBondSyms = new Set();

    // Priorizar bonos clave
    keyBondSymbols.forEach(sym => {
      const b = bondsMap.get(sym);
      if (b) {
        selectedBonds.push(b);
        selectedBondSyms.add(sym);
      }
    });

    // Agregar bonos con mayor variación del día
    for (const b of sortedBonds) {
      if (!selectedBondSyms.has(b.symbol)) {
        selectedBonds.push(b);
        selectedBondSyms.add(b.symbol);
      }
      if (selectedBonds.length >= 8) break;
    }

    // 6. Letras / LECAPs con mayor variación del día (data912.com)
    const notes = Array.isArray(notesRaw) ? notesRaw : [];
    const sortedNotes = [...notes]
      .sort((a, b) => Math.abs(b.pct_change || 0) - Math.abs(a.pct_change || 0))
      .slice(0, 6);

    // 7. Construir tickerItems unificado para el carrusel continuo
    const tickerItems = [];

    // A. Dólares
    dolaresTicker.forEach(item => tickerItems.push(item));

    // B. Riesgo País
    if (riesgoPaisItem) tickerItems.push(riesgoPaisItem);

    // C. Índices y Acciones (Yahoo)
    validYahoo.forEach(y => {
      tickerItems.push({
        symbol: y.symbol,
        name: y.name,
        price: y.price > 1000 
          ? y.price.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : `$ ${y.price.toFixed(2)}`,
        raw_price: y.price,
        pct_change: y.pct_change,
        tipo: y.group.includes('Índices') ? 'indice' : 'accion',
        badge: y.icon
      });
    });

    // D. Bonos Argentinos
    selectedBonds.forEach(b => {
      const isUsd = b.symbol.endsWith('D') || b.symbol.endsWith('C');
      tickerItems.push({
        symbol: b.symbol,
        name: `Bono ${b.symbol}`,
        price: `${isUsd ? 'US$' : '$'} ${(b.c || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        raw_price: b.c,
        pct_change: Number(b.pct_change || 0),
        tipo: 'bono',
        badge: 'BONO'
      });
    });

    // E. Letras / LECAPs con mayor variación
    sortedNotes.forEach(n => {
      tickerItems.push({
        symbol: n.symbol,
        name: `LECAP ${n.symbol}`,
        price: `$ ${(n.c || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`,
        raw_price: n.c,
        pct_change: Number(n.pct_change || 0),
        tipo: 'letra',
        badge: 'LECAP'
      });
    });

    const result = {
      success: true,
      tickerItems,
      dolares: dolaresMap,
      riesgoPais: riesgoPaisVal,
      mundo: validYahoo,
      soberanos: bonds.map(b => ({
        symbol: b.symbol,
        price_usd: b.symbol.endsWith('D') ? b.c : (b.c ? b.c / (dolaresMap.bolsa?.venta || 1320) : 0),
        bid: b.px_bid || 0,
        ask: b.px_ask || 0,
        pct_change: b.pct_change || 0,
        volume: b.v || 0
      })),
      lecaps: notes.map(n => ({
        ticker: n.symbol,
        nombre: `Letra ${n.symbol}`,
        precio: n.c || 0,
        variacion: n.pct_change || 0,
        tir: 0,
        tna: 0,
        volumen: n.v || 0
      })),
      ons: [],
      cedears: validYahoo.filter(y => y.group === 'CEDEARs')
    };

    cachedMarketData = result;
    lastMarketFetchTime = now;

    return res.status(200).json(result);
  } catch (err) {
    console.error('[getMarketData -> ERROR]', err.message);
    if (cachedMarketData) return res.status(200).json(cachedMarketData);
    return res.status(500).json({ success: false, error: err.message });
  }
}