export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    let query = '';
    if (req.query?.q) {
      query = req.query.q;
    } else if (Array.isArray(req.body)) {
      query = req.body[0];
    } else if (req.body?.args) {
      query = Array.isArray(req.body.args) ? req.body.args[0] : req.body.args;
    } else if (typeof req.body === 'string') {
      try {
        const p = JSON.parse(req.body);
        query = Array.isArray(p) ? p[0] : (p.args ? p.args[0] : (p.query || p));
      } catch (_) {
        query = req.body;
      }
    } else if (req.body?.query) {
      query = req.body.query;
    }

    query = String(query || '').trim().toUpperCase();
    if (!query || query.length < 1) {
      return res.status(200).json([]);
    }

    const MARKET_TICKERS = [
      // CEDEARs
      { symbol: 'AAPL', name: 'Apple Inc.', type: 'CEDEAR' },
      { symbol: 'MSFT', name: 'Microsoft Corporation', type: 'CEDEAR' },
      { symbol: 'NVDA', name: 'Nvidia Corporation', type: 'CEDEAR' },
      { symbol: 'TSLA', name: 'Tesla Inc.', type: 'CEDEAR' },
      { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'CEDEAR' },
      { symbol: 'GOOGL', name: 'Alphabet Inc. Class A', type: 'CEDEAR' },
      { symbol: 'META', name: 'Meta Platforms Inc.', type: 'CEDEAR' },
      { symbol: 'MELI', name: 'MercadoLibre Inc.', type: 'CEDEAR' },
      { symbol: 'KO', name: 'The Coca-Cola Company', type: 'CEDEAR' },
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', type: 'CEDEAR' },
      { symbol: 'QQQ', name: 'Invesco QQQ Trust (Nasdaq 100)', type: 'CEDEAR' },
      { symbol: 'DIA', name: 'SPDR Dow Jones Industrial Average ETF', type: 'CEDEAR' },
      { symbol: 'IWM', name: 'iShares Russell 2000 ETF', type: 'CEDEAR' },
      { symbol: 'AMD', name: 'Advanced Micro Devices Inc.', type: 'CEDEAR' },
      { symbol: 'INTC', name: 'Intel Corporation', type: 'CEDEAR' },
      { symbol: 'BABA', name: 'Alibaba Group Holding', type: 'CEDEAR' },
      { symbol: 'DIS', name: 'The Walt Disney Company', type: 'CEDEAR' },
      { symbol: 'NFLX', name: 'Netflix Inc.', type: 'CEDEAR' },
      { symbol: 'V', name: 'Visa Inc.', type: 'CEDEAR' },
      { symbol: 'WMT', name: 'Walmart Inc.', type: 'CEDEAR' },
      { symbol: 'JNJ', name: 'Johnson & Johnson', type: 'CEDEAR' },
      { symbol: 'JPM', name: 'JPMorgan Chase & Co.', type: 'CEDEAR' },
      { symbol: 'XOM', name: 'Exxon Mobil Corporation', type: 'CEDEAR' },
      { symbol: 'CVX', name: 'Chevron Corporation', type: 'CEDEAR' },
      { symbol: 'BRKB', name: 'Berkshire Hathaway Inc.', type: 'CEDEAR' },
      { symbol: 'PFE', name: 'Pfizer Inc.', type: 'CEDEAR' },
      { symbol: 'GLOB', name: 'Globant S.A.', type: 'CEDEAR' },
      { symbol: 'DESP', name: 'Despegar.com Corp.', type: 'CEDEAR' },
      { symbol: 'VALE', name: 'Vale S.A.', type: 'CEDEAR' },
      { symbol: 'PBR', name: 'Petroleo Brasileiro (Petrobras)', type: 'CEDEAR' },
      { symbol: 'GOLD', name: 'Barrick Gold Corporation', type: 'CEDEAR' },

      // Acciones Argentinas (Panel Lider y General)
      { symbol: 'GGAL', name: 'Grupo Financiero Galicia', type: 'Accion' },
      { symbol: 'YPFD', name: 'YPF S.A.', type: 'Accion' },
      { symbol: 'PAMP', name: 'Pampa Energia S.A.', type: 'Accion' },
      { symbol: 'BMA', name: 'Banco Macro S.A.', type: 'Accion' },
      { symbol: 'TXAR', name: 'Ternium Argentina S.A.', type: 'Accion' },
      { symbol: 'ALUA', name: 'Aluar Aluminio Argentino', type: 'Accion' },
      { symbol: 'CRES', name: 'Cresud S.A.I.F. y A.', type: 'Accion' },
      { symbol: 'EDN', name: 'Edenor S.A.', type: 'Accion' },
      { symbol: 'CEPU', name: 'Central Puerto S.A.', type: 'Accion' },
      { symbol: 'TRAN', name: 'Transener S.A.', type: 'Accion' },
      { symbol: 'TGSU2', name: 'Transportadora de Gas del Sur', type: 'Accion' },
      { symbol: 'TGNO4', name: 'Transportadora de Gas del Norte', type: 'Accion' },
      { symbol: 'SUPV', name: 'Grupo Supervielle S.A.', type: 'Accion' },
      { symbol: 'BBAR', name: 'Banco BBVA Argentina', type: 'Accion' },
      { symbol: 'MIRG', name: 'Mirgor S.A.C.I.F.I.A.', type: 'Accion' },
      { symbol: 'BYMA', name: 'Bolsas y Mercados Argentinos', type: 'Accion' },
      { symbol: 'VALO', name: 'Banco de Valores S.A.', type: 'Accion' },
      { symbol: 'TECO2', name: 'Telecom Argentina S.A.', type: 'Accion' },
      { symbol: 'COME', name: 'Sociedad Comercial del Plata', type: 'Accion' },
      { symbol: 'LOMA', name: 'Loma Negra C.I.A.S.A.', type: 'Accion' },
      { symbol: 'IRSA', name: 'IRSA Inversiones y Representaciones', type: 'Accion' },

      // Bonos Soberanos y Bopreales
      { symbol: 'AL30', name: 'Bonos Republica Argentina 2030 (ARS)', type: 'Bono' },
      { symbol: 'AL30D', name: 'Bonos Republica Argentina 2030 (USD)', type: 'Bono' },
      { symbol: 'GD30', name: 'Bonos Globales Argentina 2030 (ARS)', type: 'Bono' },
      { symbol: 'GD30D', name: 'Bonos Globales Argentina 2030 (USD)', type: 'Bono' },
      { symbol: 'AL35', name: 'Bonos Republica Argentina 2035', type: 'Bono' },
      { symbol: 'GD35', name: 'Bonos Globales Argentina 2035', type: 'Bono' },
      { symbol: 'AE38', name: 'Bonos Republica Argentina 2038', type: 'Bono' },
      { symbol: 'GD38', name: 'Bonos Globales Argentina 2038', type: 'Bono' },
      { symbol: 'AL41', name: 'Bonos Republica Argentina 2041', type: 'Bono' },
      { symbol: 'GD41', name: 'Bonos Globales Argentina 2041', type: 'Bono' },
      { symbol: 'BPJ27', name: 'Bopreal Serie 1 (BCRA)', type: 'Bono' },
      { symbol: 'BPO27', name: 'Bopreal Serie 2 (BCRA)', type: 'Bono' },
      { symbol: 'BPY26', name: 'Bopreal Serie 3 (BCRA)', type: 'Bono' },

      // Obligaciones Negociables (ONs)
      { symbol: 'YMCXO', name: 'ON YPF Clase 16 (USD)', type: 'ON' },
      { symbol: 'YMCHO', name: 'ON YPF Clase 14 (USD)', type: 'ON' },
      { symbol: 'TLC1O', name: 'ON Telecom Clase 1 (USD)', type: 'ON' },
      { symbol: 'IRCFO', name: 'ON IRSA Clase 14 (USD)', type: 'ON' },
      { symbol: 'MRCSO', name: 'ON Generacion Mediterranea (USD)', type: 'ON' },
      { symbol: 'PAE2O', name: 'ON Pan American Energy (USD)', type: 'ON' },
      { symbol: 'CAC2O', name: 'ON Compania General de Combustibles', type: 'ON' },
      { symbol: 'MGC1O', name: 'ON Mastellone Hnos (USD)', type: 'ON' },

      // Letras & LECAPs
      { symbol: 'S14O4', name: 'LECAP Vto. 14 Octubre 2024', type: 'Letra' },
      { symbol: 'S28F5', name: 'LECAP Vto. 28 Febrero 2025', type: 'Letra' },
      { symbol: 'S31E5', name: 'LECAP Vto. 31 Enero 2025', type: 'Letra' },
      { symbol: 'S28M5', name: 'LECAP Vto. 28 Marzo 2025', type: 'Letra' },
      { symbol: 'S30A5', name: 'LECAP Vto. 30 Abril 2025', type: 'Letra' },
      { symbol: 'S30Y5', name: 'LECAP Vto. 30 Mayo 2025', type: 'Letra' },

      // Cripto
      { symbol: 'BTC', name: 'Bitcoin (BTC)', type: 'Cripto' },
      { symbol: 'ETH', name: 'Ethereum (ETH)', type: 'Cripto' },
      { symbol: 'SOL', name: 'Solana (SOL)', type: 'Cripto' },
      { symbol: 'USDT', name: 'Tether USD (USDT)', type: 'Cripto' },
      { symbol: 'USDC', name: 'USD Coin (USDC)', type: 'Cripto' }
    ];

    const matched = MARKET_TICKERS.filter(item => 
      item.symbol.includes(query) || item.name.toUpperCase().includes(query)
    );

    const fmpKey = process.env.FMP_API_KEY;
    if (fmpKey && matched.length < 5) {
      try {
        const resp = await fetch(`https://financialmodelingprep.com/stable/search-symbol?query=${encodeURIComponent(query)}&limit=10&apikey=${fmpKey}`, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
          const fmpResults = await resp.json();
          if (Array.isArray(fmpResults)) {
            fmpResults.forEach(f => {
              if (!matched.some(m => m.symbol === f.symbol)) {
                matched.push({ symbol: f.symbol, name: f.name || f.symbol, type: 'FMP' });
              }
            });
          }
        }
      } catch (err) {
        console.warn('[searchTickers] FMP error:', err.message);
      }
    }

    return res.status(200).json(matched.slice(0, 10));
  } catch (err) {
    console.error('[searchTickers -> ERROR]', err.message);
    return res.status(200).json([]);
  }
}
