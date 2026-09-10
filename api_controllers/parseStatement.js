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
    let body = req.body;
    if (Array.isArray(body)) {
      body = body[0];
    } else if (body && Array.isArray(body.args)) {
      body = body.args[0];
    } else if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        body = Array.isArray(parsed) ? parsed[0] : (parsed.args ? parsed.args[0] : parsed);
      } catch (e) {}
    }
    const { fileBase64, mimeType } = body || {};

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    // 1. Fetch active cards for this user
    const { data: tarjetas, error: tErr } = await supabase
      .from('tarjetas')
      .select('*')
      .eq('user_id', userId)
      .eq('activa', true);
    if (tErr) throw tErr;

    if (!tarjetas || tarjetas.length === 0) {
      return res.status(400).json({ success: false, error: 'No tienes tarjetas activas registradas para conciliar.' });
    }

    // 2. Fetch active outflow categories
    const { data: categorias, error: cErr } = await supabase
      .from('categorias')
      .select('*')
      .or(`user_id.is.null,user_id.eq.${userId}`)
      .eq('activa', true);
    if (cErr) throw cErr;

    // 3. Fetch recent consumptions (last 6 months) to compare scoped to user_id
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const sixMonthsAgoStr = sixMonthsAgo.toISOString().split('T')[0];

    const { data: dbConsumos, error: dbConsErr } = await supabase
      .from('consumos_tc')
      .select('id_consumo_tarjeta, id_tarjeta, id_categoria, fecha, descripcion, importe, cuota_actual, cuota_total, recur_group_id')
      .eq('user_id', userId)
      .gte('fecha', sixMonthsAgoStr);
    if (dbConsErr) throw dbConsErr;

    // Fetch past movements to remember imputed principal account per consumption / recur_group
    const { data: dbMovs } = await supabase
      .from('movimientos')
      .select('id_consumo_tarjeta_origen, id_cuenta_principal, recur_group_id')
      .eq('user_id', userId)
      .not('id_cuenta_principal', 'is', null);

    // 4. Fetch user accounts to resolve imputed accounts
    const { data: allUserCuentas } = await supabase
      .from('cuentas_principales')
      .select('id_cuenta_principal, nombre')
      .eq('user_id', userId);

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
Determina los metadatos del resumen y la tarjeta (incluyendo próximo cierre y próximo vencimiento si están presentes en el resumen).

Debes responder ÚNICAMENTE con un JSON con el siguiente formato, sin bloques de código markdown:
{
  "card_info": {
    "ultimos_4_digitos": "4 dígitos de la tarjeta"
  },
  "statement_info": {
    "fecha_cierre": "YYYY-MM-DD",
    "fecha_vencimiento": "YYYY-MM-DD",
    "proximo_cierre": "YYYY-MM-DD o null",
    "proximo_vencimiento": "YYYY-MM-DD o null",
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

    // 5. Intelligent Category & Account Resolution
    const servCat = categorias.find(c => c.nombre.toLowerCase().includes('servicio')) || categorias[0];
    const variosCat = categorias.find(c => c.nombre.toLowerCase().includes('varios') || c.nombre.toLowerCase().includes('general')) || categorias[0];
    const superCat = categorias.find(c => c.nombre.toLowerCase().includes('super') || c.nombre.toLowerCase().includes('alimento'));
    const viviendaCat = categorias.find(c => c.nombre.toLowerCase().includes('vivienda') || c.nombre.toLowerCase().includes('hogar')) || servCat;
    const transporteCat = categorias.find(c => c.nombre.toLowerCase().includes('transporte') || c.nombre.toLowerCase().includes('auto') || c.nombre.toLowerCase().includes('vehic')) || servCat;

    const hogarAcc = (allUserCuentas || []).find(a => a.nombre.toLowerCase().includes('hogar'))?.id_cuenta_principal || null;
    const personalAcc = (allUserCuentas || []).find(a => a.nombre.toLowerCase().includes('personal'))?.id_cuenta_principal || matchedCard.id_cuenta_principal;

    function getInsuranceSignature(desc) {
      if (!desc) return null;
      const s = String(desc).toLowerCase();

      // Detección de La Segunda (ej. "La segunda coo8758204-01/03-000-046" o renovaciones)
      if (s.includes('segunda')) {
        const polMatch = s.match(/(?:coo|poliza|pol|seg)?[\s\-_]*(\d{5,10})/i);
        const policyId = polMatch ? polMatch[1] : null;

        const cuotaMatch = s.match(/(\d{1,2})[\/\-](\d{1,2})/);
        const cuotaAct = cuotaMatch ? parseInt(cuotaMatch[1], 10) : null;
        const cuotaTot = cuotaMatch ? parseInt(cuotaMatch[2], 10) : null;

        return {
          isInsurance: true,
          provider: 'LA_SEGUNDA',
          policyId,
          cuotaAct,
          cuotaTot,
          // Base limpia sin los números variables de cuota
          cleanBase: s.replace(/[\/\-]\d{1,2}[\/\-]\d{1,2}/g, '').replace(/[^a-z0-9]/g, '')
        };
      }

      // Otros seguros recurrentes en formato cuotas
      const cuotaGeneric = s.match(/(\d{1,2})[\/\-](\d{1,2})/);
      if (cuotaGeneric && (s.includes('seguro') || s.includes('san cristobal') || s.includes('federacion') || s.includes('sancor') || s.includes('mapfre') || s.includes('zurich') || s.includes('allianz') || s.includes('rivadavia') || s.includes('mercantil'))) {
        return {
          isInsurance: true,
          provider: 'OTHER_INSURANCE',
          policyId: null,
          cuotaAct: parseInt(cuotaGeneric[1], 10),
          cuotaTot: parseInt(cuotaGeneric[2], 10),
          cleanBase: s.replace(/[\/\-]\d{1,2}[\/\-]\d{1,2}/g, '').replace(/[^a-z0-9]/g, '')
        };
      }

      return null;
    }

    // 6. Helper for recurring detection
    function isRecurringCandidate(desc, consumosHist) {
      const d = (desc || '').toLowerCase();
      if (d.includes('netflix') || d.includes('spotify') || d.includes('youtube') || d.includes('google *') ||
          d.includes('claro') || d.includes('personal') || d.includes('movistar') || d.includes('flow') ||
          d.includes('telecom') || d.includes('litoral gas') || d.includes('epe') || d.includes('edenor') ||
          d.includes('edesur') || d.includes('aysa') || d.includes('aguas') || d.includes('adt') ||
          d.includes('segunda') || d.includes('hbo') || d.includes('max') || d.includes('disney') ||
          d.includes('prime video') || d.includes('amazon') || d.includes('adobe') || d.includes('gym') ||
          d.includes('club') || d.includes('colegio') || d.includes('osde') || d.includes('swiss medical')) {
        return true;
      }
      const norm = d.replace(/[^a-z0-9]/g, '');
      if (norm.length >= 4) {
        const pastOccurrences = (consumosHist || []).filter(db => {
          const dbNorm = (db.descripcion || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          return (dbNorm.includes(norm) || norm.includes(dbNorm)) && (!db.cuota_total || db.cuota_total <= 1);
        });
        if (pastOccurrences.length >= 1) return true;
      }
      return false;
    }

    function resolveTransactionMetadata(tx, consumosHist) {
      const d = (tx.descripcion || '').toLowerCase();
      const sig = getInsuranceSignature(tx.descripcion);

      if (sig && sig.provider === 'LA_SEGUNDA') {
        let isHogar = false;
        let isAuto = false;

        // Criterios de diferenciación para La Segunda:
        // 1. Póliza 1028363 o ciclo de 6 cuotas (/06) -> Seguro Hogar (Vivienda)
        // 2. Póliza 8758204 o ciclo de 3 cuotas (/03) -> Seguro Auto (Transporte)
        if (sig.policyId === '1028363' || sig.cuotaTot === 6) {
          isHogar = true;
        } else if (sig.policyId === '8758204' || sig.cuotaTot === 3) {
          isAuto = true;
        } else {
          // Consultar historial del usuario en consumosHist
          const pastMatch = (consumosHist || []).find(db => {
            const dbSig = getInsuranceSignature(db.descripcion);
            return dbSig && (dbSig.policyId === sig.policyId || (sig.cuotaTot && dbSig.cuotaTot === sig.cuotaTot));
          });
          if (pastMatch) {
            if (pastMatch.id_categoria === viviendaCat.id_categoria) isHogar = true;
            else if (pastMatch.id_categoria === transporteCat.id_categoria) isAuto = true;
          }
          if (!isHogar && !isAuto) {
            // Heurística de monto: Hogar es de mayor valor (~71k), Auto es de menor valor (~43k)
            if (Number(tx.importe) > 60000) isHogar = true;
            else isAuto = true;
          }
        }

        if (isHogar) {
          return {
            id_categoria: viviendaCat.id_categoria,
            id_cuenta_imputar: hogarAcc,
            tipo_consumo: 'RECURRENTE',
            sugerencia_ia: 'Seguro del Hogar (La Segunda) - Recurrente imputado a Hogar',
            isRecur: true,
            subtype: 'HOGAR'
          };
        } else {
          return {
            id_categoria: transporteCat.id_categoria,
            id_cuenta_imputar: personalAcc,
            tipo_consumo: 'RECURRENTE',
            sugerencia_ia: 'Seguro del Auto (La Segunda) - Recurrente imputado a Personal',
            isRecur: true,
            subtype: 'AUTO'
          };
        }
      }

      // Categorización estándar para otros conceptos
      let id_categoria = variosCat.id_categoria;
      if (d.includes('epe') || d.includes('gas') || d.includes('litoral') || d.includes('claro') || d.includes('impuesto') || d.includes('iibb') || d.includes('iva') || d.includes('db.rg') || d.includes('adt')) {
        id_categoria = servCat.id_categoria;
      } else if (d.includes('coto') || d.includes('jumbo') || d.includes('carrefour') || d.includes('dia') || d.includes('super')) {
        id_categoria = superCat ? superCat.id_categoria : variosCat.id_categoria;
      } else {
        const norm = d.replace(/[^a-z0-9]/g, '');
        if (norm.length >= 4) {
          const hist = (consumosHist || []).find(db => {
            const dbNorm = (db.descripcion || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return dbNorm.length >= 4 && (dbNorm.includes(norm) || norm.includes(dbNorm));
          });
          if (hist && hist.id_categoria) id_categoria = hist.id_categoria;
        }
      }

      const isCuotas = tx.cuota_total && Number(tx.cuota_total) > 1;
      const isRecur = !isCuotas && isRecurringCandidate(tx.descripcion, consumosHist);

      return {
        id_categoria,
        id_cuenta_imputar: null,
        tipo_consumo: isCuotas ? 'CUOTAS' : (isRecur ? 'RECURRENTE' : 'SIMPLE'),
        sugerencia_ia: isRecur ? 'Sugerido: Recurrente (gasto mensual detectado)' : null,
        isRecur,
        subtype: null
      };
    }

    // 7. Deterministic comparison against dbConsumos
    const cardConsumos = (dbConsumos || []).filter(c => c.id_tarjeta === matchedCard.id_tarjeta);
    const exactMatches = [];
    const similarDiff = [];
    const newConsumptions = [];
    const matchedDbIds = new Set();

    const stCierre = extractedData.statement_info?.fecha_cierre;
    const stVto = extractedData.statement_info?.fecha_vencimiento;

    // Helper to find past imputed account
    function findImputedAccount(recurGroupId, consumoId) {
      if (!dbMovs) return null;
      if (recurGroupId) {
        const m = dbMovs.find(mov => mov.recur_group_id === recurGroupId);
        if (m) return m.id_cuenta_principal;
      }
      if (consumoId) {
        const m = dbMovs.find(mov => mov.id_consumo_tarjeta_origen === consumoId);
        if (m) return m.id_cuenta_principal;
      }
      return null;
    }

    (extractedData.transactions || []).forEach(tx => {
      const meta = resolveTransactionMetadata(tx, cardConsumos);
      tx.id_categoria = meta.id_categoria;
      tx.tipo_consumo = meta.tipo_consumo;
      if (meta.sugerencia_ia) tx.sugerencia_ia = meta.sugerencia_ia;
      if (meta.id_cuenta_imputar) tx.id_cuenta_imputar = meta.id_cuenta_imputar;

      const isCuotas = tx.tipo_consumo === 'CUOTAS';
      const isRecur = meta.isRecur;
      const txSig = getInsuranceSignature(tx.descripcion);
      const normTx = (tx.descripcion || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      const match = cardConsumos.find(db => {
        if (matchedDbIds.has(db.id_consumo_tarjeta)) return false;
        
        const dbSig = getInsuranceSignature(db.descripcion);

        // A. Coincidencia para seguros/servicios recurrentes con cuotas o renovaciones de póliza
        if (txSig && dbSig && txSig.provider === dbSig.provider) {
          const samePolicy = txSig.policyId && dbSig.policyId && txSig.policyId === dbSig.policyId;
          const sameCleanBase = txSig.cleanBase.length >= 6 && txSig.cleanBase === dbSig.cleanBase;
          const sameSubtype = (meta.subtype && db.id_categoria === meta.id_categoria) || (txSig.cuotaTot && dbSig.cuotaTot && txSig.cuotaTot === dbSig.cuotaTot);

          if (samePolicy || sameCleanBase || sameSubtype) {
            const dbMes = (db.fecha || '').substring(0, 7);
            const txMes = (tx.fecha || stVto || stCierre || '').substring(0, 7);
            if (dbMes === txMes || (db.recur_group_id && db.recur_group_id.startsWith('REC_TC_'))) {
              return true;
            }
          }
        }

        // B. Coincidencia estándar por importe, fecha o recurrencia
        const sameImp = Math.abs(Number(db.importe) - Number(tx.importe)) < 0.05;
        const sameDate = db.fecha === tx.fecha;
        const normDb = (db.descripcion || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const sameDesc = normDb.length >= 4 && normTx.length >= 4 && (normDb === normTx || normDb.startsWith(normTx) || normTx.startsWith(normDb));
        
        // Exact match
        if (sameImp && (sameDate || isRecur) && sameDesc) return true;

        // Recurrent service match with price adjustment
        if (isRecur && sameDesc) {
          const dbMes = (db.fecha || '').substring(0, 7);
          const txMes = (tx.fecha || stVto || '').substring(0, 7);
          if (dbMes === txMes || (db.recur_group_id && db.recur_group_id.startsWith('REC_TC_'))) {
            return true;
          }
        }
        return false;
      });

      if (match) {
        matchedDbIds.add(match.id_consumo_tarjeta);
        if (match.recur_group_id) tx.recur_group_id = match.recur_group_id;
        if (!tx.id_cuenta_imputar) {
          tx.id_cuenta_imputar = findImputedAccount(match.recur_group_id, match.id_consumo_tarjeta);
        }

        const dbCuotaAct = match.cuota_actual || 1;
        const dbCuotaTot = match.cuota_total || 1;
        const txCuotaAct = tx.cuota_actual || 1;
        const txCuotaTot = tx.cuota_total || 1;
        const sameImp = Math.abs(Number(match.importe) - Number(tx.importe)) < 0.05;

        if (dbCuotaAct !== txCuotaAct || dbCuotaTot !== txCuotaTot || !sameImp) {
          similarDiff.push({
            db_record: match,
            statement_record: tx
          });
        } else {
          exactMatches.push({ ...tx, dbRecord: match });
        }
      } else {
        // Buscar grupo recurrente previo o cuotas para preservar grupo e imputación de cuenta
        if (isRecur && !tx.recur_group_id) {
          const pastRec = cardConsumos.find(db => {
            if (!db.recur_group_id) return false;
            const dbSig = getInsuranceSignature(db.descripcion);
            if (txSig && dbSig && txSig.provider === dbSig.provider) {
              if (txSig.policyId && dbSig.policyId && txSig.policyId === dbSig.policyId) return true;
              if (txSig.cuotaTot && dbSig.cuotaTot && txSig.cuotaTot === dbSig.cuotaTot) return true;
              if (meta.subtype && db.id_categoria === meta.id_categoria) return true;
            }
            const normDb = (db.descripcion || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return normDb.length >= 4 && normTx.length >= 4 && (normDb.includes(normTx) || normTx.includes(normDb));
          });
          if (pastRec) {
            tx.recur_group_id = pastRec.recur_group_id;
            if (!tx.id_cuenta_imputar) tx.id_cuenta_imputar = findImputedAccount(pastRec.recur_group_id, pastRec.id_consumo_tarjeta);
            if (!tx.id_categoria) tx.id_categoria = pastRec.id_categoria;
          }
        } else if (isCuotas && !tx.recur_group_id) {
          const pastCuota = cardConsumos.find(db => {
            if (!db.recur_group_id) return false;
            const normDb = (db.descripcion || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return db.cuota_total === tx.cuota_total && normDb.length >= 4 && normTx.length >= 4 && (normDb.includes(normTx) || normTx.includes(normDb));
          });
          if (pastCuota) {
            tx.recur_group_id = pastCuota.recur_group_id;
            if (!tx.id_cuenta_imputar) tx.id_cuenta_imputar = findImputedAccount(pastCuota.recur_group_id, pastCuota.id_consumo_tarjeta);
          }
        }
        newConsumptions.push(tx);
      }
    });

    // 8. Identificar consumos recurrentes ausentes y consumos no correspondientes en la BD
    const recurrentesAusentes = [];
    const unmatchedDbConsumptions = [];

    const stMes = (stVto || stCierre || '').substring(0, 7);

    cardConsumos.forEach(db => {
      if (matchedDbIds.has(db.id_consumo_tarjeta)) return;

      const isRecurrenteGroup = db.recur_group_id && db.recur_group_id.startsWith('REC_TC_');
      const dbMes = (db.fecha || '').substring(0, 7);

      if (isRecurrenteGroup) {
        // Si no vino en este extracto, sugerir al usuario la posibilidad de darlo de baja
        recurrentesAusentes.push({
          id_consumo_tarjeta: db.id_consumo_tarjeta,
          recur_group_id: db.recur_group_id,
          descripcion: db.descripcion,
          importe: db.importe,
          moneda: db.moneda || 'ARS',
          fecha: db.fecha,
          sugerencia_ia: 'No figuró en el resumen de este mes. ¿Deseas dar de baja la recurrencia?'
        });
      } else if (stMes && dbMes === stMes && (!db.cuota_total || db.cuota_total <= 1)) {
        // Consumo simple que estaba registrado para este mes pero no vino en el resumen bancario
        unmatchedDbConsumptions.push({
          id_consumo_tarjeta: db.id_consumo_tarjeta,
          descripcion: db.descripcion,
          importe: db.importe,
          moneda: db.moneda || 'ARS',
          fecha: db.fecha
        });
      }
    });

    const payload = {
      card_info: cardInfo,
      statement_info: extractedData.statement_info || {},
      exact_matches: exactMatches,
      similar_different: similarDiff,
      new_consumptions: newConsumptions,
      recurrentes_ausentes: recurrentesAusentes,
      unmatched_db_consumptions: unmatchedDbConsumptions
    };

    return res.status(200).json({ success: true, payload });

  } catch (err) {
    console.error('[API -> parseStatement Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
