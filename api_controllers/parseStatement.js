import { getSupabaseClient } from '../api_lib/supabase.js';
import XLSX from 'xlsx';

async function callGemini(key, modelName, systemInstruction, history, responseMimeType = null) {
  const cleanHistory = (history || []).filter(h => h.role === 'user' || h.role === 'model');
  const payload = {
    contents: cleanHistory
  };
  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }
  if (responseMimeType) {
    payload.generationConfig = { responseMimeType };
  }
  
  const modelsToTry = [
    modelName,
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-flash-latest'
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let lastError = null;
  for (const model of modelsToTry) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text;
      } else {
        const errTxt = await response.text();
        lastError = `${response.status} - ${errTxt}`;
        console.warn(`[parseStatement] Model ${model} failed: ${lastError}`);
      }
    } catch (e) {
      lastError = e.message;
      console.warn(`[parseStatement] Model ${model} threw: ${lastError}`);
    }
  }

  throw new Error(`Gemini API error: ${lastError || 'No model responded'}`);
}

function tryParseSantanderXlsx(buffer) {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return null;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
    if (!rows || rows.length < 10) return null;

    let ultimos4 = null, fechaCierre = null, fechaVto = null, totalArs = 0, totalUsd = 0;
    let isSantander = false;

    for (let i = 0; i < Math.min(20, rows.length); i++) {
      const row = rows[i] || [];
      const text = row.join(' ');
      if (text.includes('Movimientos del resumen') || text.includes('terminada en')) {
        isSantander = true;
      }
      const m4 = text.match(/terminada en (\d{4})/i);
      if (m4 && !ultimos4) ultimos4 = m4[1];

      if (row.includes('Fecha de cierre') && rows[i + 1]) {
        const [d, m, y] = String(rows[i + 1][0] || '').trim().split('/');
        if (y && m && d) fechaCierre = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        const [vd, vm, vy] = String(rows[i + 1][1] || '').trim().split('/');
        if (vy && vm && vd) fechaVto = `${vy}-${vm.padStart(2, '0')}-${vd.padStart(2, '0')}`;
      }

      if (row.includes('Total a pagar') && rows[i + 1]) {
        const parseM = s => parseFloat(String(s || '').replace(/[^0-9,-]/g, '').replace(',', '.')) || 0;
        totalArs = parseM(rows[i + 1][0]);
        totalUsd = parseM(rows[i + 1][1]);
      }
    }

    if (!isSantander) return null;

    const transactions = [];
    let inTx = false, inOther = false, lastDate = fechaCierre;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      if (row.includes('Fecha') && row.includes('Descripción')) { inTx = true; inOther = false; continue; }
      if (row.some(c => String(c).includes('Total de Visa') || String(c).includes('Total de Mastercard') || String(c).includes('Total de Tarjeta'))) { inTx = false; continue; }
      if (row.some(c => String(c).includes('Otros conceptos'))) { inOther = true; inTx = false; continue; }

      if (inTx && row.length >= 2) {
        const rawDate = row[0];
        const desc = String(row[1] || '').trim();
        const cuotasStr = String(row[2] || '').trim();
        const montoArsStr = row[4];
        const montoUsdStr = row[5];

        if (!desc || desc.startsWith('Su pago') || desc.startsWith('Cr.rg')) continue;

        if (rawDate) {
          const [d, m, y] = String(rawDate).trim().split('/');
          if (y && m && d) lastDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }

        let importe = 0, moneda = 'ARS';
        if (montoUsdStr) {
          importe = parseFloat(String(montoUsdStr).replace(/[^0-9,-]/g, '').replace(',', '.')) || 0;
          moneda = 'USD';
        } else if (montoArsStr) {
          importe = parseFloat(String(montoArsStr).replace(/[^0-9,-]/g, '').replace(',', '.')) || 0;
          moneda = 'ARS';
        }

        if (importe <= 0) continue;

        let cuotaAct = 1, cuotaTot = 1;
        const cm = cuotasStr.match(/(\d+)\s+de\s+(\d+)/i);
        if (cm) {
          cuotaAct = parseInt(cm[1], 10);
          cuotaTot = parseInt(cm[2], 10);
        }

        transactions.push({
          fecha: lastDate,
          descripcion: moneda === 'USD' ? `${desc} USD ${importe}` : desc,
          importe,
          moneda,
          cuota_actual: cuotaTot > 1 ? cuotaAct : null,
          cuota_total: cuotaTot > 1 ? cuotaTot : null
        });
      }

      if (inOther && row.length >= 2) {
        const desc = String(row[0] || '').trim();
        if (!desc || desc.startsWith('Descripción') || desc.startsWith('Aviso')) continue;
        const importe = parseFloat(String(row[1] || '').replace(/[^0-9,-]/g, '').replace(',', '.')) || 0;
        if (importe > 0) {
          transactions.push({
            fecha: fechaCierre,
            descripcion: desc,
            importe,
            moneda: 'ARS',
            cuota_actual: null,
            cuota_total: null
          });
        }
      }
    }

    return {
      card_info: { ultimos_4_digitos: ultimos4 },
      statement_info: {
        fecha_cierre: fechaCierre,
        fecha_vencimiento: fechaVto,
        total_ars: totalArs,
        total_usd: totalUsd
      },
      transactions
    };
  } catch (err) {
    console.warn('[tryParseSantanderXlsx] Fallback to Gemini:', err);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const supabase = getSupabaseClient(req);
    const body = Array.isArray(req.body) ? req.body[0] : req.body;
    const { fileBase64, mimeType } = body || {};

    if (!fileBase64 || !mimeType) {
      return res.status(400).json({ success: false, error: 'Missing fileBase64 or mimeType in request body.' });
    }

    // 1. Fetch active cards
    const { data: tarjetas, error: tErr } = await supabase
      .from('tarjetas')
      .select('*')
      .eq('activa', true);
    if (tErr) throw tErr;

    if (!tarjetas || tarjetas.length === 0) {
      return res.status(400).json({ success: false, error: 'No active cards registered in database.' });
    }

    // 2. Fetch active outflow categories
    const { data: categorias, error: cErr } = await supabase
      .from('categorias')
      .select('*')
      .eq('activa', true);
    if (cErr) throw cErr;

    // 3. Fetch recent consumptions (last 6 months) to compare
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const sixMonthsAgoStr = sixMonthsAgo.toISOString().split('T')[0];

    const { data: dbConsumos, error: dbConsErr } = await supabase
      .from('consumos_tc')
      .select('id_consumo_tarjeta, id_tarjeta, id_categoria, fecha, descripcion, importe, cuota_actual, cuota_total, recur_group_id')
      .gte('fecha', sixMonthsAgoStr);
    if (dbConsErr) throw dbConsErr;

    let extractedData = null;

    // Try direct XLSX parsing first for instant speed and 100% precision
    if (mimeType !== 'application/pdf') {
      const buffer = Buffer.from(fileBase64, 'base64');
      extractedData = tryParseSantanderXlsx(buffer);
    }

    // Fallback to Gemini for PDFs or unrecognized formats
    if (!extractedData) {
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        return res.status(500).json({ success: false, error: 'GEMINI_API_KEY not configured on server.' });
      }

      const systemInstruction = `
Eres un asistente de procesamiento de resúmenes de tarjeta de crédito para Fluxo.
Extrae todas las compras, consumos, impuestos y percepciones del documento (ignora pagos como "SU PAGO EN PESOS").
Determina los metadatos del resumen y la tarjeta.

Debes responder ÚNICAMENTE con un JSON con el siguiente formato, sin bloques de código markdown:
{
  "card_info": {
    "ultimos_4_digitos": "4 dígitos de la tarjeta"
  },
  "statement_info": {
    "fecha_cierre": "YYYY-MM-DD",
    "fecha_vencimiento": "YYYY-MM-DD",
    "total_ars": número,
    "total_usd": número
  },
  "transactions": [
    {
      "fecha": "YYYY-MM-DD",
      "descripcion": "Comercio o concepto",
      "importe": 123.45,
      "moneda": "ARS" o "USD",
      "cuota_actual": número o null,
      "cuota_total": número o null
    }
  ]
}
`;

      const parts = [];
      if (mimeType === 'application/pdf') {
        parts.push({ inlineData: { mimeType, data: fileBase64 } });
      } else {
        const buffer = Buffer.from(fileBase64, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const csvText = XLSX.utils.sheet_to_csv(worksheet);
        parts.push({ text: `Datos en CSV:\n\n${csvText}` });
      }
      parts.push({ text: 'Extrae los datos y transacciones de este resumen.' });

      const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      const contentText = await callGemini(geminiKey, modelName, systemInstruction, [{ role: 'user', parts }], 'application/json');

      try {
        extractedData = JSON.parse(contentText);
      } catch (e) {
        console.error('[parseStatement Gemini Parsing Error]', contentText);
        return res.status(500).json({ success: false, error: 'No se pudo interpretar la respuesta estructurada de la IA.' });
      }
    }

    // 4. Identify Card
    const ultimos4 = extractedData.card_info?.ultimos_4_digitos;
    let matchedCard = null;
    if (ultimos4) {
      matchedCard = tarjetas.find(t => t.ultimos_4_digitos === ultimos4);
    }
    if (!matchedCard) {
      matchedCard = tarjetas[0];
    }

    const cardInfo = {
      id_tarjeta: matchedCard.id_tarjeta,
      nombre: matchedCard.nombre,
      ultimos_4_digitos: matchedCard.ultimos_4_digitos || ultimos4 || ''
    };

    // 5. Default category mapping helper
    const servCat = categorias.find(c => c.nombre.toLowerCase().includes('servicio')) || categorias[0];
    const variosCat = categorias.find(c => c.nombre.toLowerCase().includes('varios') || c.nombre.toLowerCase().includes('general')) || categorias[0];
    const superCat = categorias.find(c => c.nombre.toLowerCase().includes('super') || c.nombre.toLowerCase().includes('alimento'));

    function inferCategory(desc) {
      const d = (desc || '').toLowerCase();
      if (d.includes('epe') || d.includes('gas') || d.includes('litoral') || d.includes('claro') || d.includes('impuesto') || d.includes('iibb') || d.includes('iva') || d.includes('db.rg') || d.includes('adt') || d.includes('segunda')) {
        return servCat.id_categoria;
      }
      if (d.includes('coto') || d.includes('jumbo') || d.includes('carrefour') || d.includes('dia') || d.includes('super')) {
        return superCat ? superCat.id_categoria : variosCat.id_categoria;
      }
      return variosCat.id_categoria;
    }

    // 6. Deterministic comparison against dbConsumos
    const cardConsumos = (dbConsumos || []).filter(c => c.id_tarjeta === matchedCard.id_tarjeta);
    const exactMatches = [];
    const similarDiff = [];
    const newConsumptions = [];

    (extractedData.transactions || []).forEach(tx => {
      tx.id_categoria = inferCategory(tx.descripcion);
      const normTx = (tx.descripcion || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      const match = cardConsumos.find(db => {
        const sameImp = Math.abs(Number(db.importe) - Number(tx.importe)) < 0.05;
        const normDb = (db.descripcion || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const sameDesc = normDb.includes(normTx.slice(0, 8)) || normTx.includes(normDb.slice(0, 8));
        return sameImp && sameDesc;
      });

      if (match) {
        const dbCuotaAct = match.cuota_actual || 1;
        const dbCuotaTot = match.cuota_total || 1;
        const txCuotaAct = tx.cuota_actual || 1;
        const txCuotaTot = tx.cuota_total || 1;

        if (dbCuotaAct !== txCuotaAct || dbCuotaTot !== txCuotaTot) {
          similarDiff.push({
            db_record: match,
            statement_record: tx
          });
        } else {
          exactMatches.push(tx);
        }
      } else {
        newConsumptions.push(tx);
      }
    });

    const payload = {
      card_info: cardInfo,
      statement_info: extractedData.statement_info || {},
      exact_matches: exactMatches,
      similar_different: similarDiff,
      new_consumptions: newConsumptions
    };

    return res.status(200).json({ success: true, payload });

  } catch (err) {
    console.error('[API -> parseStatement Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
