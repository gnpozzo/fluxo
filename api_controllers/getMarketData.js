// Cache en memoria para la serverless function (TTL 5 minutos)
let cachedMarketData = null;
let lastMarketFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export default async function handler(req, res) {
  const now = Date.now();
  if (cachedMarketData && (now - lastMarketFetchTime < CACHE_TTL_MS)) {
    return res.status(200).json(cachedMarketData);
  }

  try {
    const fetchWithTimeout = async (url, ms = 4500) => {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(ms) });
        if (!resp.ok) return [];
        const data = await resp.json();
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.data)) return data.data;
        return [];
      } catch (err) {
        console.warn(`[getMarketData] Error fetching ${url}:`, err.message);
        return [];
      }
    };

    const [mundo, lecaps, soberanos, ons, cedears] = await Promise.all([
      fetchWithTimeout('https://rendimientos.co/api/mundo'),
      fetchWithTimeout('https://rendimientos.co/api/lecaps'),
      fetchWithTimeout('https://rendimientos.co/api/soberanos'),
      fetchWithTimeout('https://rendimientos.co/api/ons'),
      fetchWithTimeout('https://rendimientos.co/api/cedears')
    ]);

    const result = {
      success: true,
      mundo: Array.isArray(mundo) ? mundo : [],
      lecaps: Array.isArray(lecaps) ? lecaps : [],
      soberanos: Array.isArray(soberanos) ? soberanos : [],
      ons: Array.isArray(ons) ? ons : [],
      cedears: Array.isArray(cedears) ? cedears : []
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