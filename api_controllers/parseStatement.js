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
  
  let response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok && modelName === 'gemini-1.5-flash') {
    console.warn(`[parseStatement] Model ${modelName} failed with status ${response.status}. Retrying with fallback gemini-1.5-flash-8b.`);
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }
  
  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini did not return any text.');
  }
  return text;
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

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return res.status(500).json({ success: false, error: 'GEMINI_API_KEY not configured on server.' });
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

    const systemInstruction = `
Eres un asistente de procesamiento de resúmenes de tarjeta de crédito en formato PDF y XLSX para la aplicación Fluxo.
Tu tarea es analizar el documento adjunto y compararlo con los consumos ya registrados en la base de datos para identificar nuevos consumos y consumos que difieren.

Tarjetas de crédito disponibles en el sistema:
${JSON.stringify(tarjetas.map(t => ({ id_tarjeta: t.id_tarjeta, nombre: t.nombre, banco: t.banco, ultimos_4_digitos: t.ultimos_4_digitos, id_cuenta_principal: t.id_cuenta_principal })))}

Categorías de egreso disponibles en el sistema:
${JSON.stringify(categorias.filter(c => c.tipo_mov === 'EGRESO').map(c => ({ id_categoria: c.id_categoria, nombre: c.nombre })))}

Consumos ya registrados en la base de datos (últimos 6 meses):
${JSON.stringify(dbConsumos)}

INSTRUCCIONES DE PROCESAMIENTO:
1. **Identificar la Tarjeta**: Busca en el documento a qué tarjeta corresponde (por ejemplo, Visa o Mastercard y sus últimos 4 dígitos). Compara esto con las "Tarjetas de crédito disponibles" y selecciona la que coincida.
2. **Extraer Metadatos del Resumen**:
   - Fecha de cierre (fecha_cierre): YYYY-MM-DD
   - Fecha de vencimiento (fecha_vencimiento): YYYY-MM-DD
   - Total en Pesos (total_ars)
   - Total en Dólares (total_usd)
3. **Extraer Transacciones**: Extrae todas las compras, consumos, impuestos, percepciones o intereses del resumen. Ignora pagos o créditos (por ejemplo, "SU PAGO EN PESOS").
   - Para transacciones en cuotas, busca formatos como "C.03/09" o "Cuota 3 de 9" y extrae cuota_actual (3) y cuota_total (9).
   - Determina la fecha de la transacción (YYYY-MM-DD). Usa el año correspondiente al cierre del resumen (2026).
4. **Comparar con la Base de Datos**:
   - Compara las transacciones del resumen con los "Consumos ya registrados" para la tarjeta seleccionada en el mes de facturación.
   - **Coincidencia Exacta (exact_matches)**: Si una transacción en el resumen coincide en descripción (concepto similar, ej. 'MERCADOLIBRE' y 'Mercado Libre'), importe, cuotas y moneda con un registro en la base de datos para la misma fecha o periodo de facturación, clasifícala como coincidencia exacta para evitar duplicados.
   - **Similares con Diferencias (similar_different)**: Si el comercio/concepto coincide pero el importe o el plan de cuotas difiere (por ejemplo, en la DB figura como simple por $80.000 pero en el resumen es cuota 9/12 por $73.721), clasifícalo aquí. Debes incluir el "db_record" completo y el "statement_record" con la información correcta.
   - **Nuevos Consumos (new_consumptions)**: Si la transacción en el resumen no tiene un registro similar en la base de datos, clasifícala como nuevo consumo.
5. **Clasificar Categorías**: Para cada nuevo consumo o consumo modificado, selecciona la categoría más adecuada de las "Categorías de egreso disponibles" y asigna su "id_categoria".

Debes responder ÚNICAMENTE con un JSON con el siguiente formato, sin bloques de código markdown, sin texto adicional:
{
  "tipo_registro": "pdf_analisis",
  "card_info": {
    "id_tarjeta": "UUID de la tarjeta coincidente",
    "nombre": "Nombre de la tarjeta",
    "ultimos_4_digitos": "4 digitos"
  },
  "statement_info": {
    "fecha_cierre": "YYYY-MM-DD",
    "fecha_vencimiento": "YYYY-MM-DD",
    "total_ars": número,
    "total_usd": número
  },
  "exact_matches": [
    { "descripcion": "...", "importe": 123, "fecha": "YYYY-MM-DD" }
  ],
  "similar_different": [
    {
      "db_record": {
        "id_consumo_tarjeta": "UUID del registro existente",
        "recur_group_id": "UUID del grupo recurrente o null",
        "descripcion": "...",
        "importe": 123
      },
      "statement_record": {
        "descripcion": "...",
        "importe": 123,
        "cuota_actual": 9,
        "cuota_total": 12,
        "fecha": "YYYY-MM-DD",
        "id_categoria": "UUID de la categoría seleccionada"
      }
    }
  ],
  "new_consumptions": [
    {
      "descripcion": "...",
      "importe": 123,
      "cuota_actual": null,
      "cuota_total": null,
      "fecha": "YYYY-MM-DD",
      "id_categoria": "UUID de la categoría seleccionada"
    }
  ]
}
`;

    const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    
    const parts = [];
    if (mimeType === 'application/pdf') {
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: fileBase64
        }
      });
    } else {
      // Parse XLSX
      const buffer = Buffer.from(fileBase64, 'base64');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const csvText = XLSX.utils.sheet_to_csv(worksheet);
      
      parts.push({
        text: `A continuación se detallan los datos del resumen de la tarjeta en formato CSV:\n\n${csvText}`
      });
    }

    parts.push({
      text: 'Analiza este resumen de tarjeta de crédito y compáralo con la base de datos.'
    });

    const history = [
      {
        role: 'user',
        parts: parts
      }
    ];

    const contentText = await callGemini(geminiKey, modelName, systemInstruction, history, 'application/json');
    
    let parsedResult;
    try {
      parsedResult = JSON.parse(contentText);
    } catch (e) {
      console.error('[parseStatement Gemini Parsing Error]', contentText);
      return res.status(500).json({ success: false, error: 'No se pudo interpretar la respuesta estructurada de la IA.' });
    }

    return res.status(200).json({ success: true, payload: parsedResult });

  } catch (err) {
    console.error('[API -> parseStatement Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
