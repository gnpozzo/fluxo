import { getSupabaseClient } from '../api_lib/supabase.js';
import { callGemini } from '../api_lib/gemini.js';
import XLSX from 'xlsx';
import zlib from 'zlib';

function extractPdfTokens(buf) {
  try {
    const str = buf.toString('latin1');
    function getCMap(id) {
      const m = str.indexOf(id + ' 0 obj');
      if (m === -1) return {};
      const s = str.indexOf('beginbfrange', m);
      if (s === -1) return {};
      const e = str.indexOf('endbfrange', s);
      const text = str.slice(s, e);
      const map = {};
      const regex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        map[parseInt(match[1], 16)] = String.fromCharCode(parseInt(match[3], 16));
      }
      return map;
    }

    const cmaps = {};
    for (let i = 1; i <= 60; i++) {
      const cm = getCMap(i);
      if (Object.keys(cm).length > 0) cmaps[i] = cm;
    }

    const pKidsMatch = str.match(/\/Pages[\s\S]*?\/Kids\s*\[(.*?)\]/);
    if (!pKidsMatch) return [];
    const kids = pKidsMatch[1].trim().split(/\s+/).filter(x => x.match(/^\d+$/));

    const tokens = [];
    kids.forEach(pId => {
      const pObj = str.indexOf(pId + ' 0 obj');
      if (pObj === -1) return;
      const chunk = str.slice(pObj, pObj + 400);
      const m = chunk.match(/\/Contents\s+(\d+)\s+0\s+R/);
      if (!m) return;
      const contentsObj = parseInt(m[1], 10);
      const mStream = str.indexOf(contentsObj + ' 0 obj');
      const sIdx = str.indexOf('stream', mStream);
      let start = sIdx + 6;
      if (buf[start] === 13) start++;
      if (buf[start] === 10) start++;
      const eIdx = str.indexOf('endstream', start);
      let inflated;
      try {
        inflated = zlib.inflateSync(buf.subarray(start, eIdx)).toString('latin1');
      } catch (e) { return; }

      let curFont = 10;
      const regex = /(\/F\d+)|\[<([0-9a-fA-F]+)>\]|<([0-9a-fA-F]+)>/g;
      let match;
      while ((match = regex.exec(inflated)) !== null) {
        if (match[1]) {
          const fn = parseInt(match[1].replace('/F', ''), 10);
          curFont = fn * 5;
        } else {
          const hex = match[2] || match[3];
          const map = cmaps[curFont] || cmaps[10] || {};
          let t = '';
          for (let i = 0; i < hex.length; i += 4) {
            t += map[parseInt(hex.slice(i, i + 4), 16)] || '';
          }
          if (t.trim()) tokens.push(t.trim());
        }
      }
    });

    return tokens;
  } catch (err) {
    console.warn('[extractPdfTokens] Error extracting PDF tokens:', err.message);
    return [];
  }
}

function tryParseMercadoPagoPdf(buffer, fileName = '') {
  try {
    const tokens = extractPdfTokens(buffer);
    if (!tokens || tokens.length === 0) return null;

    const isMp = tokens.some(t => t.includes('Mercado Pago') || t.includes('Tarjeta de crédito') || t.includes('MERPAGO'));
    if (!isMp) return null;

    const monthsMap = {
      'enero': '01', 'ene': '01',
      'febrero': '02', 'feb': '02',
      'marzo': '03', 'mar': '03',
      'abril': '04', 'abr': '04',
      'mayo': '05', 'may': '05',
      'junio': '06', 'jun': '06',
      'julio': '07', 'jul': '07',
      'agosto': '08', 'ago': '08',
      'septiembre': '09', 'sep': '09', 'set': '09',
      'octubre': '10', 'oct': '10',
      'noviembre': '11', 'nov': '11',
      'diciembre': '12', 'dic': '12'
    };

    let defaultYear = 2026;
    if (fileName) {
      const ym = fileName.match(/\b(202\d)\b/);
      if (ym) defaultYear = parseInt(ym[1], 10);
    }
    for (const t of tokens) {
      const ym = t.match(/\b(202\d)\b/);
      if (ym) { defaultYear = parseInt(ym[1], 10); break; }
    }

    function parseDate(dStr, year = defaultYear) {
      if (!dStr) return null;
      const clean = dStr.trim().toLowerCase();
      const m1 = clean.match(/(\d{1,2})\s+de\s+([a-z]+)/);
      if (m1) {
        const d = m1[1].padStart(2, '0');
        const m = monthsMap[m1[2]] || '01';
        return `${year}-${m}-${d}`;
      }
      const m2 = clean.match(/(\d{1,2})\/([a-z]+)/);
      if (m2) {
        const d = m2[1].padStart(2, '0');
        const m = monthsMap[m2[2]] || '01';
        return `${year}-${m}-${d}`;
      }
      const m3 = clean.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (m3) {
        const d = m3[1].padStart(2, '0');
        const m = m3[2].padStart(2, '0');
        let y = m3[3];
        if (y.length === 2) y = '20' + y;
        return `${y}-${m}-${d}`;
      }
      return null;
    }

    function parseMoney(str) {
      if (!str) return 0;
      const clean = str.replace(/[^\d,\-]/g, '').replace(',', '.');
      return parseFloat(clean) || 0;
    }

    let fechaCierre = null;
    let fechaVto = null;
    let proximoCierre = null;
    let proximoVto = null;
    let totalArs = 0;
    let totalUsd = 0;

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === 'Fecha de cierre' && tokens[i + 1]) {
        fechaCierre = parseDate(tokens[i + 1]);
      } else if (t === 'Fecha de vencimiento' && tokens[i + 1]) {
        fechaVto = parseDate(tokens[i + 1]);
      } else if (t === 'Cierre actual' && tokens[i + 1]) {
        if (!fechaCierre) fechaCierre = parseDate(tokens[i + 1]);
      } else if (t === 'Vencimiento actual' && tokens[i + 1]) {
        if (!fechaVto) fechaVto = parseDate(tokens[i + 1]);
      } else if (t === 'Cierre próximo' && tokens[i + 1]) {
        proximoCierre = parseDate(tokens[i + 1]);
      } else if (t === 'Vencimiento próximo' && tokens[i + 1]) {
        proximoVto = parseDate(tokens[i + 1]);
      } else if (t === 'Total a pagar' && tokens[i + 1]) {
        if (tokens[i + 1].includes('$')) {
          let mStr = tokens[i + 1];
          if (tokens[i + 2] && /^\d{2}$/.test(tokens[i + 2])) {
            mStr += ',' + tokens[i + 2];
          }
          totalArs = parseMoney(mStr);
        }
      }
    }

    const transactions = [];

    // Parse consumos (Between 'Con tarjeta virtual' and next 'Impuestos e intereses')
    const startConsumos = tokens.indexOf('Con tarjeta virtual');
    const endConsumos = tokens.indexOf('Impuestos e intereses', startConsumos !== -1 ? startConsumos : 0);
    if (startConsumos !== -1) {
      const limit = endConsumos !== -1 ? endConsumos : tokens.length;
      let i = startConsumos + 1;
      while (i < limit && (tokens[i] === 'Fecha' || tokens[i] === 'Descripción' || tokens[i] === 'Cuota' || tokens[i] === 'Operación' || tokens[i] === 'Pesos' || tokens[i] === 'Dólares')) {
        i++;
      }

      while (i < limit) {
        if (tokens[i] === 'Subtotal') break;
        const dateToken = tokens[i];
        if (/^\d{1,2}\/[a-z]+$/i.test(dateToken) || /^\d{1,2}\/\d{1,2}$/.test(dateToken)) {
          const fecha = parseDate(dateToken);
          const desc = tokens[i + 1] || '';
          let cuotaAct = null;
          let cuotaTot = null;
          let importe = 0;
          let nextIdx = i + 2;

          if (tokens[nextIdx] && tokens[nextIdx].includes('de')) {
            const cm = tokens[nextIdx].match(/(\d+)\s+de\s+(\d+)/);
            if (cm) {
              cuotaAct = parseInt(cm[1], 10);
              cuotaTot = parseInt(cm[2], 10);
            }
            nextIdx++;
          }

          if (tokens[nextIdx] && /^\d{5,8}$/.test(tokens[nextIdx])) {
            nextIdx++;
          }

          if (tokens[nextIdx] && tokens[nextIdx].includes('$')) {
            let mStr = tokens[nextIdx];
            if (tokens[nextIdx + 1] && /^\d{2}$/.test(tokens[nextIdx + 1])) {
              mStr += ',' + tokens[nextIdx + 1];
              nextIdx++;
            }
            importe = parseMoney(mStr);
            nextIdx++;
          }

          if (desc && importe > 0) {
            transactions.push({
              fecha,
              descripcion: desc,
              importe,
              moneda: 'ARS',
              cuota_actual: cuotaAct,
              cuota_total: cuotaTot,
              isTax: false
            });
          }
          i = nextIdx;
        } else {
          i++;
        }
      }
    }

    // Parse Impuestos e intereses
    if (endConsumos !== -1) {
      let j = endConsumos + 1;
      while (j < tokens.length && (tokens[j] === '1' || tokens[j] === 'Fecha' || tokens[j] === 'Descripción' || tokens[j] === 'Pesos' || tokens[j] === 'Dólares')) {
        j++;
      }
      while (j < tokens.length) {
        if (tokens[j] === 'Subtotal' || tokens[j] === 'Pagos anticipados') break;
        const dateToken = tokens[j];
        if (/^\d{1,2}\/[a-z]+$/i.test(dateToken) || /^\d{1,2}\/\d{1,2}$/.test(dateToken)) {
          const fecha = parseDate(dateToken);
          const desc = tokens[j + 1] || '';
          let importe = 0;
          let nextIdx = j + 2;
          if (tokens[nextIdx] && tokens[nextIdx].includes('$')) {
            let mStr = tokens[nextIdx];
            if (tokens[nextIdx + 1] && /^\d{2}$/.test(tokens[nextIdx + 1])) {
              mStr += ',' + tokens[nextIdx + 1];
              nextIdx++;
            }
            importe = parseMoney(mStr);
            nextIdx++;
          }
          if (desc && importe > 0) {
            transactions.push({
              fecha,
              descripcion: desc,
              importe,
              moneda: 'ARS',
              cuota_actual: null,
              cuota_total: null,
              isTax: true
            });
          }
          j = nextIdx;
        } else {
          j++;
        }
      }
    }

    if (transactions.length === 0 && !fechaCierre) return null;

    if (fechaVto) {
      transactions.forEach(tx => {
        tx.fecha_compra = tx.fecha;
        tx.fecha = fechaVto;
      });
    }

    return {
      card_info: {
        ultimos_4_digitos: null,
        banco_o_emisor: 'Mercado Pago',
        nombre_tarjeta: 'Mercado Pago'
      },
      statement_info: {
        fecha_cierre: fechaCierre,
        fecha_vencimiento: fechaVto,
        proximo_cierre: proximoCierre,
        proximo_vencimiento: proximoVto,
        total_ars: totalArs,
        total_usd: totalUsd
      },
      transactions
    };
  } catch (mpErr) {
    console.warn('[tryParseMercadoPagoPdf] Error parsing Mercado Pago PDF:', mpErr.message);
    return null;
  }
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
            cuota_total: null,
            isTax: true
          });
        }
      }
    }

    if (fechaVto) {
      transactions.forEach(tx => {
        tx.fecha_compra = tx.fecha;
        tx.fecha = fechaVto;
      });
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
    const { fileBase64, mimeType, fileName } = body || {};

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

    // Fetch user preferences and learned imputation rules
    const { data: userProfile } = await supabase
      .from('perfiles_usuario')
      .select('preferencias')
      .eq('id', userId)
      .maybeSingle();
    const learnedRules = (userProfile && typeof userProfile.preferencias === 'object' && userProfile.preferencias)
      ? (userProfile.preferencias.reglas_imputacion || {})
      : {};

    // Fetch past movements to remember imputed principal account and category per consumption / recur_group / merchant
    const { data: dbMovs } = await supabase
      .from('movimientos')
      .select('id_consumo_tarjeta_origen, id_cuenta_principal, id_categoria, descripcion, recur_group_id, fecha')
      .eq('user_id', userId)
      .not('id_cuenta_principal', 'is', null)
      .order('fecha', { ascending: false });

    // 4. Fetch user accounts to resolve imputed accounts
    const { data: allUserCuentas } = await supabase
      .from('cuentas_principales')
      .select('id_cuenta_principal, nombre')
      .eq('user_id', userId);

    let extractedData = null;

    // 1. Try direct XLSX parsing first for instant speed and 100% precision
    if (mimeType !== 'application/pdf') {
      const buffer = Buffer.from(fileBase64, 'base64');
      extractedData = tryParseSantanderXlsx(buffer);
    } else {
      // 2. Try direct PDF parsing for Mercado Pago (instant speed, 100% precision, zero API failure)
      const buffer = Buffer.from(fileBase64, 'base64');
      extractedData = tryParseMercadoPagoPdf(buffer, fileName);
    }

    // 3. Fallback to Gemini for unrecognized PDFs or formats
    if (!extractedData) {
      const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
      if (!geminiKey) {
        return res.status(500).json({ success: false, error: 'GEMINI_API_KEY no configurada en el servidor.' });
      }

      const fileYearMatch = (fileName || '').match(/\b(202\d)\b/);
      const docYear = fileYearMatch ? fileYearMatch[1] : '2026';
      const currentDateStr = '2026-09-28';

      const systemInstruction = `
Eres un asistente de procesamiento de resúmenes de tarjeta de crédito para Fluxo.
Extrae todas las compras, consumos, impuestos y percepciones del documento (ignora pagos anteriores o pagos del resumen como "SU PAGO EN PESOS", "Pago del resumen", "Total a pagar del periodo anterior" o "Composición del saldo del periodo anterior").
Identifica y marca impuestos y percepciones bancarias/fiscales (Impuesto de sellos, IVA RG, IIBB percep, DB.RG, Percepciones) con "isTax": true.
Determina los metadatos del resumen y la tarjeta (incluyendo próximo cierre y próximo vencimiento si están presentes en el resumen).

ANCLAJE TEMPORAL CRÍTICO (AÑO DE FACTURACIÓN: ${docYear}):
- La fecha de hoy es ${currentDateStr}. El año en curso es ${docYear}.
- Nombre del archivo analizado: "${fileName || 'resumen.pdf'}".
- REGLA ESTRICTA DE AÑO: El período de este documento corresponde a ${docYear}. TODAS las fechas generadas DEBEN pertenecer al año ${docYear} (formato ISO YYYY-MM-DD, ej. ${docYear}-09-XX).
- ESTÁ ESTRICTAMENTE PROHIBIDO asignar fechas en 2024 o 2025. Toda fecha sin año explícito (ej. "12 de septiembre", "17/sep", "29 de septiembre") DEBE construirse obligatoriamente con el año ${docYear}.

REGLAS ESPECÍFICAS PARA RESÚMENES DE MERCADO PAGO / TARJETAS VIRTUALES:
- Emisor / Banco: Si es de Mercado Pago / MercadoLibre, indícalo en "banco_o_emisor": "Mercado Pago" y "nombre_tarjeta": "Mercado Pago". Las tarjetas de Mercado Pago suelen ser virtuales y NO muestran los últimos 4 dígitos en el resumen; en ese caso "ultimos_4_digitos" debe ser null o cadena vacía "".
- Año de las fechas: En Mercado Pago las fechas figuran como "DD/mes" (ej. "14/sep", "5/ago", "12/sep") o "DD de mes" (ej. "12 de septiembre", "17 de septiembre"). Genera todas las fechas en formato ISO ${docYear}-MM-DD.
- Cuotas en Mercado Pago: Si la columna cuota dice "X de Y" (ej. "3 de 3", "2 de 2"), extrae "cuota_actual": X y "cuota_total": Y como enteros. Si no tiene cuotas, ambos deben ser null.
- Exclusiones estrictas: La sección "Composición del saldo del periodo anterior" (que contiene "Total a pagar del periodo anterior" y "Pago del resumen -$...") NO son consumos del periodo y deben ser completamente ignoradas.
- Próximo cierre y próximo vencimiento: En la sección "Ciclo de facturación", extrae las fechas de "Cierre próximo" y "Vencimiento próximo" para "proximo_cierre" y "proximo_vencimiento" con año ${docYear}.

Debes responder ÚNICAMENTE con un JSON con el siguiente formato, sin bloques de código markdown:
{
  "card_info": {
    "ultimos_4_digitos": "4 dígitos de la tarjeta o null",
    "banco_o_emisor": "Mercado Pago, Santander, etc.",
    "nombre_tarjeta": "Mercado Pago, Visa, Mastercard, etc."
  },
  "statement_info": {
    "fecha_cierre": "${docYear}-MM-DD",
    "fecha_vencimiento": "${docYear}-MM-DD",
    "proximo_cierre": "${docYear}-MM-DD o null",
    "proximo_vencimiento": "${docYear}-MM-DD o null",
    "total_ars": número,
    "total_usd": número
  },
  "transactions": [
    {
      "fecha": "${docYear}-MM-DD",
      "descripcion": "Comercio o concepto",
      "importe": 123.45,
      "moneda": "ARS" o "USD",
      "cuota_actual": número o null,
      "cuota_total": número o null,
      "isTax": true o false
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
      parts.push({ text: `Nombre del archivo subido: "${fileName || 'resumen.pdf'}". Hoy es ${currentDateStr}. Extrae los datos y transacciones de este resumen respetando estrictamente el año ${docYear}.` });

      const modelName = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
      const contentText = await callGemini(geminiKey, modelName, systemInstruction, [{ role: 'user', parts }], 'application/json', 35000);

      try {
        extractedData = JSON.parse(contentText);
      } catch (e) {
        console.error('[parseStatement Gemini Parsing Error]', contentText);
        return res.status(500).json({ success: false, error: 'No se pudo interpretar la respuesta estructurada de la IA.' });
      }
    }

    // Post-parsing Year & Date Sanitizer (guarantees no 2024 or 2025 hallucinations)
    const fileYearMatch = (fileName || '').match(/\b(202\d)\b/);
    const targetYearStr = fileYearMatch ? fileYearMatch[1] : '2026';
    const isTargetSep = (/orp2026/i.test(fileName || '') || /sep/i.test(fileName || '') || /septiembre/i.test(fileName || ''));

    function sanitizeIsoDate(dStr, fallbackDate = null) {
      if (!dStr || typeof dStr !== 'string') return fallbackDate || `${targetYearStr}-09-17`;
      let clean = dStr.trim();
      clean = clean.replace(/^(2024|2025)/, targetYearStr);
      if (!clean.startsWith('202')) {
        clean = fallbackDate || `${targetYearStr}-09-17`;
      }
      return clean;
    }

    if (!extractedData.statement_info) {
      extractedData.statement_info = {};
    }
    const si = extractedData.statement_info;
    if (si.fecha_vencimiento) {
      si.fecha_vencimiento = sanitizeIsoDate(si.fecha_vencimiento);
    }
    if (si.fecha_cierre) {
      si.fecha_cierre = sanitizeIsoDate(si.fecha_cierre);
    }
    if (si.proximo_cierre) {
      si.proximo_cierre = sanitizeIsoDate(si.proximo_cierre);
    }
    if (si.proximo_vencimiento) {
      si.proximo_vencimiento = sanitizeIsoDate(si.proximo_vencimiento);
    }

    const statementVto = si.fecha_vencimiento || null;

    if (Array.isArray(extractedData.transactions)) {
      extractedData.transactions.forEach(tx => {
        const rawDate = tx.fecha;
        tx.fecha_compra = rawDate ? sanitizeIsoDate(rawDate, statementVto) : (statementVto || `${targetYearStr}-09-17`);
        // Imputar el consumo SIEMPRE a la fecha de vencimiento del resumen (para cualquier tipo de tarjeta)
        tx.fecha = statementVto || tx.fecha_compra;
      });
    }

    // 4. Identify Card
    const ultimos4 = extractedData.card_info?.ultimos_4_digitos;
    const emisor = (extractedData.card_info?.banco_o_emisor || extractedData.card_info?.nombre_tarjeta || '').toLowerCase();
    let matchedCard = null;

    if (ultimos4) {
      matchedCard = tarjetas.find(t => t.ultimos_4_digitos === ultimos4);
    }

    // Si no coincide por los últimos 4 dígitos o no están disponibles (como en Mercado Pago virtual)
    if (!matchedCard && emisor) {
      matchedCard = tarjetas.find(t => {
        const tNombre = (t.nombre || '').toLowerCase();
        const tBanco = (t.banco || '').toLowerCase();
        const isMp = emisor.includes('mercado') || emisor.includes('mp');
        if (isMp) {
          return tNombre.includes('mercado') || tNombre.includes('mp') || tBanco.includes('mercado') || tBanco.includes('mp');
        }
        return tNombre.includes(emisor) || tBanco.includes(emisor);
      });
    }

    // Si sigue sin haber match pero en las transacciones o descripción general hay menciones a mercado pago
    if (!matchedCard) {
      const hasMpTx = (extractedData.transactions || []).some(tx => (tx.descripcion || '').toLowerCase().includes('merpago'));
      if (hasMpTx) {
        matchedCard = tarjetas.find(t => {
          const tNombre = (t.nombre || '').toLowerCase();
          const tBanco = (t.banco || '').toLowerCase();
          return tNombre.includes('mercado') || tNombre.includes('mp') || tBanco.includes('mercado') || tBanco.includes('mp');
        });
      }
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

    const taxCat = categorias.find(c => c.nombre.toLowerCase().includes('impuesto') || c.id_categoria.toLowerCase().includes('impuesto')) || servCat || variosCat;

    const hogarAcc = (allUserCuentas || []).find(a => a.nombre.toLowerCase().includes('hogar'))?.id_cuenta_principal || null;
    const personalAcc = (allUserCuentas || []).find(a => a.nombre.toLowerCase().includes('personal'))?.id_cuenta_principal || matchedCard.id_cuenta_principal;
    const cuentaMap = {};
    (allUserCuentas || []).forEach(a => { cuentaMap[a.id_cuenta_principal] = a.nombre; });

    function extractBaseKey(desc) {
      if (!desc) return '';
      return String(desc).toLowerCase()
        .replace(/[\/\-]\d{1,2}[\/\-]\d{1,2}/g, '')
        .replace(/cuota\s*\d+(\s*\/\s*\d+)?/gi, '')
        .replace(/[^a-z0-9]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3)
        .slice(0, 4)
        .join('_');
    }

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

    function isTaxConcept(desc) {
      if (!desc) return false;
      const d = String(desc).toLowerCase();
      return d.includes('impuesto de sellos') ||
             d.includes('imp.sellos') ||
             d.includes('iva rg') ||
             d.includes('iibb') ||
             d.includes('percep') ||
             d.includes('db.rg') ||
             d.includes('rg 4240') ||
             d.includes('rg 5617') ||
             d.includes('rg 4815') ||
             d.includes('rg 5272') ||
             d.includes('ley 27541') ||
             d.includes('impuesto pais');
    }

    function resolveTransactionMetadata(tx, consumosHist) {
      const d = (tx.descripcion || '').toLowerCase();
      const sig = getInsuranceSignature(tx.descripcion);
      const baseKey = extractBaseKey(tx.descripcion);
      const normTx = d.replace(/[^a-z0-9]/g, '');

      // 0. PRIORIDAD 0: Impuestos y percepciones específicas del resumen (no se imputan a cuentas)
      if (tx.isTax || isTaxConcept(tx.descripcion)) {
        return {
          id_categoria: taxCat?.id_categoria || variosCat?.id_categoria || (categorias[0]?.id_categoria || 'CAT_GENERAL'),
          id_cuenta_imputar: null,
          tipo_consumo: 'SIMPLE',
          sugerencia_ia: '🏛️ Impuesto de resumen (específico de la tarjeta, no se imputa a cuentas)',
          isRecur: false,
          isTax: true,
          subtype: 'TAX'
        };
      }

      // 1. PRIORIDAD 1: Reglas aprendidas explícitas del usuario (guardadas al editar consumos)
      let matchedRule = null;
      if (sig?.policyId && learnedRules['pol_' + sig.policyId]) {
        matchedRule = learnedRules['pol_' + sig.policyId];
      } else {
        for (const [key, rule] of Object.entries(learnedRules)) {
          if (key.startsWith('desc_')) {
            const pattern = key.replace('desc_', '');
            const words = pattern.split('_').filter(w => w.length >= 3);
            if (words.length > 0 && words.every(w => d.includes(w))) {
              matchedRule = rule;
              break;
            }
          }
        }
      }

      if (matchedRule) {
        const accName = cuentaMap[matchedRule.id_cuenta] || 'Externa';
        const isCuotas = tx.cuota_total && Number(tx.cuota_total) > 1;
        return {
          id_categoria: matchedRule.id_categoria,
          id_cuenta_imputar: matchedRule.id_cuenta,
          tipo_consumo: isCuotas ? 'CUOTAS' : 'RECURRENTE',
          sugerencia_ia: `✨ Imputación aprendida: ${accName}`,
          isRecur: true,
          subtype: 'LEARNED',
          descripcion_limpia: matchedRule.descripcion_limpia || null
        };
      }

      // 2. PRIORIDAD 2: Historial directo de movimientos previos del usuario (ordenados de más reciente a más antiguo)
      if (dbMovs && dbMovs.length > 0) {
        const pastMov = dbMovs.find(m => {
          if (!m.descripcion) return false;
          const mSig = getInsuranceSignature(m.descripcion);
          if (sig && mSig && sig.provider === mSig.provider) {
            if (sig.policyId && mSig.policyId && sig.policyId === mSig.policyId) return true;
            if (sig.cuotaTot && mSig.cuotaTot && sig.cuotaTot === mSig.cuotaTot) return true;
          }
          const normM = m.descripcion.toLowerCase().replace(/[^a-z0-9]/g, '');
          return normM.length >= 4 && normTx.length >= 4 && (normM.includes(normTx) || normTx.includes(normM));
        });

        if (pastMov && pastMov.id_cuenta_principal) {
          const accName = cuentaMap[pastMov.id_cuenta_principal] || 'Externa';
          const isCuotas = tx.cuota_total && Number(tx.cuota_total) > 1;
          const isRec = !isCuotas && isRecurringCandidate(tx.descripcion, consumosHist);
          return {
            id_categoria: pastMov.id_categoria || variosCat.id_categoria,
            id_cuenta_imputar: pastMov.id_cuenta_principal,
            tipo_consumo: isCuotas ? 'CUOTAS' : (isRec ? 'RECURRENTE' : 'SIMPLE'),
            sugerencia_ia: `✨ Imputado según historial previo: ${accName}`,
            isRecur: isRec,
            subtype: 'HISTORY'
          };
        }
      }

      // 3. PRIORIDAD 3: Diferenciación de Seguros (La Segunda)
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

      // 4. PRIORIDAD 4: Categorización estándar para otros conceptos
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

    // 7. Intelligent Reconciliation Engine (Gemini AI + Deterministic Smart Matcher)
    const cardConsumos = (dbConsumos || []).filter(c => c.id_tarjeta === matchedCard.id_tarjeta);
    const exactMatches = [];
    const similarDiff = [];
    const newConsumptions = [];
    const matchedDbIds = new Set();
    const matchedRecurGroupIds = new Set();

    const stCierre = extractedData.statement_info?.fecha_cierre;
    const stVto = extractedData.statement_info?.fecha_vencimiento;
    const stMes = (stVto || stCierre || '').substring(0, 7);

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

    function formatMoneyArs(val) {
      return '$ ' + Number(val || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // A. Catalog of active recurring groups for this card
    const activeRecurrentGroups = new Map();
    cardConsumos.forEach(db => {
      if (db.recur_group_id && db.recur_group_id.startsWith('REC_TC_')) {
        const gid = db.recur_group_id;
        if (!activeRecurrentGroups.has(gid)) {
          activeRecurrentGroups.set(gid, {
            recur_group_id: gid,
            descripcion: db.descripcion,
            importe: Number(db.importe || 0),
            moneda: db.moneda || 'ARS',
            id_categoria: db.id_categoria,
            id_cuenta_imputar: findImputedAccount(gid, db.id_consumo_tarjeta),
            records: [],
            targetMonthRecord: null
          });
        }
        const grp = activeRecurrentGroups.get(gid);
        grp.records.push(db);
        const dbMes = (db.fecha || '').substring(0, 7);
        if (stMes && dbMes === stMes) {
          grp.targetMonthRecord = db;
          grp.descripcion = db.descripcion;
          grp.importe = Number(db.importe || 0);
          grp.id_categoria = db.id_categoria || grp.id_categoria;
          const impAcc = findImputedAccount(gid, db.id_consumo_tarjeta);
          if (impAcc) grp.id_cuenta_imputar = impAcc;
        }
      }
    });

    // Helper to clean merchant names from banking prefixes/suffixes/account numbers
    function cleanMerchantName(str) {
      if (!str) return '';
      return String(str).toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\b(deb\s*aut|debito\s*automatico|merpago\*|payu\*ar\*|db\.rg|cr\.rg)\b/gi, ' ')
        .replace(/\b(s\.?a\.?|s\.?r\.?l\.?|coop|cooperativa|sociedad\s*anonima)\b/gi, ' ')
        .replace(/\b\d{5,}\b/g, ' ')
        .replace(/[^a-z0-9]/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
    }

    // Helper for deterministic smart recurring match
    function findSmartRecurrentMatch(txDesc) {
      const cTx = cleanMerchantName(txDesc);
      const tksTx = cTx.split(' ').filter(x => x.length >= 2);
      if (tksTx.length === 0) return null;

      for (const [gid, grp] of activeRecurrentGroups.entries()) {
        const cDb = cleanMerchantName(grp.descripcion);
        const tksDb = cDb.split(' ').filter(x => x.length >= 2);
        if (tksDb.length === 0) continue;

        const isDbInTx = tksDb.every(t => cTx.includes(t));
        const isTxInDb = tksTx.every(t => cDb.includes(t));
        if (isDbInTx || isTxInDb) {
          return grp;
        }

        if ((cTx.includes('gas') && cDb.includes('gas')) ||
            (cTx.includes('epe') && cDb.includes('epe')) ||
            (cTx.includes('claro') && cDb.includes('claro')) ||
            (cTx.includes('adt') && cDb.includes('adt')) ||
            (cTx.includes('max') && cDb.includes('max')) ||
            (cTx.includes('youtube') && cDb.includes('youtube'))) {
          return grp;
        }
      }
      return null;
    }

    // B. AI-Powered Semantic Reconciliation via Gemini (if API key available)
    const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const aiReconciliationMap = new Map();

    if (geminiKey && extractedData.transactions && extractedData.transactions.length > 0 && activeRecurrentGroups.size > 0) {
      try {
        const recurringCatalogList = Array.from(activeRecurrentGroups.values()).map(g => ({
          recur_group_id: g.recur_group_id,
          descripcion: g.descripcion,
          ultimo_importe: g.importe,
          moneda: g.moneda,
          categoria_nombre: (categorias.find(c => c.id_categoria === g.id_categoria)?.nombre) || '',
          id_cuenta_imputar: g.id_cuenta_imputar || null,
          cuenta_nombre: cuentaMap[g.id_cuenta_imputar] || ''
        }));

        const txListPrompt = extractedData.transactions.map((tx, idx) => ({
          idx,
          descripcion: tx.descripcion,
          importe: Number(tx.importe || 0),
          moneda: tx.moneda || 'ARS',
          cuota_actual: tx.cuota_actual || null,
          cuota_total: tx.cuota_total || null,
          isTax: !!tx.isTax
        }));

        const promptSystem = `Eres el motor de conciliación bancaria inteligente de Fluxo.
Compara las transacciones del extracto bancario ("transacciones_extracto") con el catálogo de servicios recurrentes activos ("servicios_recurrentes_bd") y las cuentas del usuario.

REGLAS DE CONCILIACIÓN:
1. DETECCIÓN SEMÁNTICA DE SERVICIOS RECURRENTES:
   - Los extractos modifican las descripciones con códigos de débito automático, números de cliente o prefijos bancarios (ej. "Litoral gas sa 00178700014 " -> "Litoral gas sa", "Claro deb aut 000021508728225 " -> "Claro", "Epe santa fe 000285401700239 " -> "Epe", "Adtsec 000934739000 10/26 " -> "ADT", "Merpago*max " -> "Max", "Google *youtubep p1on " -> "YouTube Premium", "Mutual socios am..." -> "Mutual socios am").
   - VARIACIÓN DE TARIFA/IMPORTE: Un servicio recurrente (gas, luz, telefonía, seguros, etc.) cambia de precio habitualmente. Si el concepto coincide pero el importe es diferente, ¡ES EL MISMO SERVICIO RECURRENTE CON PRECIO ACTUALIZADO!
   - Asigna "matched_recur_group_id" con el ID del servicio correspondiente.
   - Si el importe difiere del registrado en BD, genera "sugerencia_ia":
     "✨ Consumo recurrente detectado: importe anterior $ X ➔ nuevo $ Y (+Z%). Al confirmar se actualizarán este período y las proyecciones futuras."
   - Si el importe es igual:
     "✨ Consumo recurrente habitual detectado."

2. SEGUROS "LA SEGUNDA":
   - Póliza de Hogar (o ciclo 6 cuotas /06, o póliza 1028363): Vivienda -> cuenta Hogar.
   - Póliza de Auto (o ciclo 3 cuotas /03, o póliza 8758204): Transporte -> cuenta Personal.

3. IMPUESTOS Y PERCEPCIONES:
   - Impuesto de sellos, IVA RG, DB.RG, Percepciones IIBB: "isTax": true, tipo_consumo: "SIMPLE".

Responde ÚNICAMENTE con un JSON con el array "matches":
[
  {
    "idx": número de índice,
    "matched_recur_group_id": "REC_TC_..." o null,
    "tipo_consumo": "RECURRENTE" | "CUOTAS" | "SIMPLE",
    "id_categoria": "ID_CATEGORIA" o null,
    "id_cuenta_imputar": "ID_CUENTA" o null,
    "sugerencia_ia": "Texto explicativo"
  }
]`;

        const userPrompt = JSON.stringify({
          servicios_recurrentes_bd: recurringCatalogList,
          transacciones_extracto: txListPrompt,
          cuentas: allUserCuentas || [],
          categorias: (categorias || []).map(c => ({ id: c.id_categoria, nombre: c.nombre }))
        });

        const modelName = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
        const aiRespText = await callGemini(geminiKey, modelName, promptSystem, [{ role: 'user', parts: [{ text: userPrompt }] }], 'application/json', 15000);
        const parsedAi = JSON.parse(aiRespText);
        if (Array.isArray(parsedAi?.matches)) {
          parsedAi.matches.forEach(m => {
            if (m && typeof m.idx === 'number') {
              aiReconciliationMap.set(m.idx, m);
            }
          });
        }
      } catch (aiErr) {
        console.warn('[parseStatement] AI reconciliation fallback to smart heuristics:', aiErr.message);
      }
    }

    // C. Reconcile transactions against database & classifications
    (extractedData.transactions || []).forEach((tx, txIdx) => {
      const meta = resolveTransactionMetadata(tx, cardConsumos);
      const aiMatch = aiReconciliationMap.get(txIdx);

      // Precedence: AI suggestion / classification, then heuristic metadata
      if (aiMatch) {
        if (aiMatch.id_categoria) tx.id_categoria = aiMatch.id_categoria;
        if (aiMatch.id_cuenta_imputar) tx.id_cuenta_imputar = aiMatch.id_cuenta_imputar;
        if (aiMatch.tipo_consumo) tx.tipo_consumo = aiMatch.tipo_consumo;
        if (aiMatch.sugerencia_ia) tx.sugerencia_ia = aiMatch.sugerencia_ia;
      } else {
        tx.id_categoria = meta.id_categoria;
        tx.tipo_consumo = meta.tipo_consumo;
        if (meta.sugerencia_ia) tx.sugerencia_ia = meta.sugerencia_ia;
        if (meta.id_cuenta_imputar) tx.id_cuenta_imputar = meta.id_cuenta_imputar;
      }
      if (meta.isTax) tx.isTax = true;
      if (meta.descripcion_limpia && !tx.raw_descripcion) {
        tx.raw_descripcion = tx.descripcion;
        tx.descripcion = meta.descripcion_limpia;
      }

      const isCuotas = tx.tipo_consumo === 'CUOTAS' || (tx.cuota_total && Number(tx.cuota_total) > 1);
      const txSig = getInsuranceSignature(tx.descripcion);
      const normTx = (tx.descripcion || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      // 1. Try matching with active recurring group (via AI or smart matcher)
      let matchedRecGroup = null;
      if (aiMatch?.matched_recur_group_id && activeRecurrentGroups.has(aiMatch.matched_recur_group_id)) {
        matchedRecGroup = activeRecurrentGroups.get(aiMatch.matched_recur_group_id);
      } else if (!isCuotas && !tx.isTax) {
        matchedRecGroup = findSmartRecurrentMatch(tx.descripcion);
      }

      if (matchedRecGroup) {
        matchedRecurGroupIds.add(matchedRecGroup.recur_group_id);
        tx.recur_group_id = matchedRecGroup.recur_group_id;
        tx.tipo_consumo = 'RECURRENTE';
        if (!tx.id_categoria) tx.id_categoria = matchedRecGroup.id_categoria;
        if (!tx.id_cuenta_imputar) tx.id_cuenta_imputar = matchedRecGroup.id_cuenta_imputar;

        // Adopt user's defined clean canonical name!
        tx.raw_descripcion = tx.descripcion;
        tx.descripcion = matchedRecGroup.descripcion;

        // Mark all records of this group as matched in DB
        matchedRecGroup.records.forEach(r => matchedDbIds.add(r.id_consumo_tarjeta));

        const baseRecord = matchedRecGroup.targetMonthRecord || matchedRecGroup.records[0];
        const sameImp = Math.abs(Number(matchedRecGroup.importe) - Number(tx.importe)) < 0.05;

        if (sameImp) {
          tx.sugerencia_ia = tx.sugerencia_ia || '✨ Consumo recurrente habitual detectado';
          exactMatches.push({ ...tx, dbRecord: baseRecord });
        } else {
          const diffPct = matchedRecGroup.importe > 0
            ? (((Number(tx.importe) - Number(matchedRecGroup.importe)) / Number(matchedRecGroup.importe)) * 100)
            : 0;
          const pctStr = diffPct !== 0 ? ` (${diffPct > 0 ? '+' : ''}${diffPct.toFixed(1)}%)` : '';
          tx.sugerencia_ia = aiMatch?.sugerencia_ia || `✨ Consumo recurrente '${matchedRecGroup.descripcion}' detectado: importe anterior ${formatMoneyArs(matchedRecGroup.importe)} ➔ nuevo ${formatMoneyArs(tx.importe)}${pctStr}. Al confirmar se actualizarán este mes y las proyecciones futuras.`;
          tx.is_recurrent_diff = true;
          similarDiff.push({
            db_record: baseRecord,
            statement_record: tx
          });
        }
        return;
      }

      // 1.5. Cuotas Disambiguation / Progression Matching (e.g. "Muebles Living" vs "Mercado Pago 7 de 9")
      if (isCuotas) {
        const txCuotaTot = Number(tx.cuota_total || 1);
        const txCuotaAct = Number(tx.cuota_actual || 1);

        const installmentMatch = cardConsumos.find(db => {
          if (matchedDbIds.has(db.id_consumo_tarjeta)) return false;
          if (!db.cuota_total || Number(db.cuota_total) <= 1) return false;
          if (Number(db.cuota_total) !== txCuotaTot) return false;

          const dbCuotaAct = Number(db.cuota_actual || 1);
          const isConsecutive = (dbCuotaAct === txCuotaAct) || (dbCuotaAct === txCuotaAct - 1);
          const sameImp = Math.abs(Number(db.importe) - Number(tx.importe)) < 5.0;

          const normDb = (db.descripcion || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const isGenericProcessor = normTx.includes('merpago') || normTx.includes('mercadopago') || normTx.includes('payu');
          const descMatch = normDb.length >= 4 && normTx.length >= 4 && (normDb.includes(normTx) || normTx.includes(normDb));

          return sameImp && (descMatch || (isConsecutive && isGenericProcessor));
        });

        if (installmentMatch) {
          matchedDbIds.add(installmentMatch.id_consumo_tarjeta);
          if (installmentMatch.recur_group_id) {
            tx.recur_group_id = installmentMatch.recur_group_id;
            matchedRecurGroupIds.add(installmentMatch.recur_group_id);
          }
          tx.raw_descripcion = tx.descripcion;
          tx.descripcion = installmentMatch.descripcion;
          tx.id_categoria = installmentMatch.id_categoria || tx.id_categoria;
          tx.id_cuenta_imputar = findImputedAccount(installmentMatch.recur_group_id, installmentMatch.id_consumo_tarjeta) || tx.id_cuenta_imputar;
          tx.sugerencia_ia = `✨ Compra en cuotas identificada: "${installmentMatch.descripcion}" (${txCuotaAct}/${txCuotaTot}).`;

          exactMatches.push({ ...tx, dbRecord: installmentMatch });
          return;
        }
      }

      // 2. Non-recurring or installments matching against cardConsumos
      const match = cardConsumos.find(db => {
        if (matchedDbIds.has(db.id_consumo_tarjeta)) return false;
        
        const dbSig = getInsuranceSignature(db.descripcion);
        if (txSig && dbSig && txSig.provider === dbSig.provider) {
          const samePolicy = txSig.policyId && dbSig.policyId && txSig.policyId === dbSig.policyId;
          const sameCleanBase = txSig.cleanBase.length >= 6 && txSig.cleanBase === dbSig.cleanBase;
          const sameSubtype = (meta.subtype && db.id_categoria === meta.id_categoria) || (txSig.cuotaTot && dbSig.cuotaTot && txSig.cuotaTot === dbSig.cuotaTot);
          if (samePolicy || sameCleanBase || sameSubtype) {
            return true;
          }
        }

        const sameImp = Math.abs(Number(db.importe) - Number(tx.importe)) < 0.05;
        const sameDate = db.fecha === tx.fecha;
        const normDb = (db.descripcion || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const sameDesc = normDb.length >= 4 && normTx.length >= 4 && (normDb === normTx || normDb.startsWith(normTx) || normTx.startsWith(normDb));
        
        if (sameImp && (sameDate || meta.isRecur) && sameDesc) return true;
        if (meta.isRecur && sameDesc) return true;
        return false;
      });

      if (match) {
        matchedDbIds.add(match.id_consumo_tarjeta);
        if (match.recur_group_id) {
          tx.recur_group_id = match.recur_group_id;
          matchedRecurGroupIds.add(match.recur_group_id);
        }
        if (!tx.id_cuenta_imputar) {
          tx.id_cuenta_imputar = findImputedAccount(match.recur_group_id, match.id_consumo_tarjeta);
        }
        if (match.descripcion && match.descripcion !== tx.descripcion) {
          tx.raw_descripcion = tx.descripcion;
          tx.descripcion = match.descripcion;
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
        // Look up previous recur_group_id or installments group to preserve group & account imputation
        if (meta.isRecur && !tx.recur_group_id) {
          const pastRec = cardConsumos.find(db => {
            if (!db.recur_group_id) return false;
            const normDb = (db.descripcion || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return normDb.length >= 4 && normTx.length >= 4 && (normDb.includes(normTx) || normTx.includes(normDb));
          });
          if (pastRec) {
            tx.recur_group_id = pastRec.recur_group_id;
            matchedRecurGroupIds.add(pastRec.recur_group_id);
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

    // 8. Identificar consumos recurrentes REALMENTE ausentes y consumos simples huérfanos
    const recurrentesAusentes = [];
    const unmatchedDbConsumptions = [];

    // Recurrentes ausentes: Solo grupos activos que NO tuvieron match en este extracto (exactamente 1 fila por servicio)
    for (const [groupId, grp] of activeRecurrentGroups.entries()) {
      if (matchedRecurGroupIds.has(groupId)) {
        continue; // Coincidió en este extracto, no está ausente
      }
      recurrentesAusentes.push({
        id_consumo_tarjeta: grp.targetMonthRecord?.id_consumo_tarjeta || grp.records[0]?.id_consumo_tarjeta,
        recur_group_id: groupId,
        descripcion: grp.descripcion,
        importe: grp.importe,
        moneda: grp.moneda || 'ARS',
        fecha: grp.targetMonthRecord?.fecha || grp.records[0]?.fecha,
        sugerencia_ia: 'No figuró en el resumen de este mes. ¿Deseas dar de baja la recurrencia?'
      });
    }

    // Consumos simples huérfanos del mes (no recurrentes y cuotas = 1)
    cardConsumos.forEach(db => {
      if (matchedDbIds.has(db.id_consumo_tarjeta)) return;
      if (db.recur_group_id) return; // Ya evaluado en recurrentes

      const dbMes = (db.fecha || '').substring(0, 7);
      if (stMes && dbMes === stMes && (!db.cuota_total || db.cuota_total <= 1)) {
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
    const isOverload = (err.message || '').includes('503') ||
      (err.message || '').includes('alta demanda') ||
      (err.message || '').includes('UNAVAILABLE') ||
      (err.message || '').includes('high demand') ||
      (err.message || '').includes('Gateway Timeout');

    const userMsg = isOverload
      ? 'El servicio de IA (Google Gemini) se encuentra temporalmente con alta demanda en Google. Por favor, vuelve a intentar en unos instantes.'
      : err.message;

    return res.status(500).json({ success: false, error: userMsg });
  }
}

