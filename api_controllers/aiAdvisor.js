import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { 
      message, 
      chatHistory = [], 
      cuentaId, 
      mes, 
      globalCurrency = 'ARS',
      riskProfile = 'MODERADO', 
      projectGoal = null 
    } = req.body || {};

    if (!message) {
      return res.status(400).json({ success: false, error: 'Mensaje requerido' });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'GEMINI_API_KEY no configurada en el servidor.' });
    }

    // 1. Obtener datos financieros de Supabase
    let financialContext = {
      cuentaNombre: cuentaId || 'Principal',
      ingresosMes: 0,
      egresosMes: 0,
      gastosPorCategoria: {},
      gastosRecurrentes: [],
      deudaTarjetasTotal: 0,
      ahorroTotalARS: 0,
      ahorroTotalUSD: 0,
      carteraInversiones: []
    };

    try {
      const supabase = getSupabaseClient(req);
      if (cuentaId && mes) {
        const start = mes + '-01';
        const [y, m] = mes.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        const end = `${mes}-${String(lastDay).padStart(2, '0')}`;

        // Movimientos del mes con categorías
        const { data: movs } = await supabase
          .from('movimientos')
          .select('*, categorias (nombre)')
          .eq('id_cuenta_principal', cuentaId)
          .gte('fecha', start)
          .lte('fecha', end);

        if (movs) {
          movs.forEach(mov => {
            const imp = Math.abs(Number(mov.importe || 0));
            const cat = mov.categorias?.nombre || 'Otros';
            if (mov.tipo_mov === 'INGRESO') {
              financialContext.ingresosMes += imp;
            } else {
              financialContext.egresosMes += imp;
              financialContext.gastosPorCategoria[cat] = (financialContext.gastosPorCategoria[cat] || 0) + imp;
              if (mov.tipo_egreso === 'RECURRENTE' || mov.tipo_egreso === 'CUOTA') {
                financialContext.gastosRecurrentes.push({
                  descripcion: mov.descripcion,
                  categoria: cat,
                  importe: imp,
                  tipo: mov.tipo_egreso
                });
              }
            }
          });
        }

        // Deuda de tarjetas
        const { data: tcConsumos } = await supabase
          .from('consumos_tc')
          .select('importe, cuota_actual, cuota_total, descripcion, id_tarjeta')
          .gte('fecha', start)
          .lte('fecha', end);

        if (tcConsumos) {
          financialContext.deudaTarjetasTotal = tcConsumos.reduce((acc, c) => acc + Number(c.importe || 0), 0);
        }

        // Ahorros
        const { data: ahorros } = await supabase
          .from('ahorros_movimientos')
          .select('moneda, importe');

        if (ahorros) {
          ahorros.forEach(a => {
            if (a.moneda === 'USD') financialContext.ahorroTotalUSD += Number(a.importe || 0);
            else financialContext.ahorroTotalARS += Number(a.importe || 0);
          });
        }

        // Inversiones
        const { data: invs } = await supabase
          .from('inversiones_movimientos')
          .select('ticker, tipo_operacion, cantidad_nominales, precio_compra, moneda');

        if (invs) {
          financialContext.carteraInversiones = invs;
        }
      }
    } catch (dbErr) {
      console.warn('[aiAdvisor] Context gathering notice:', dbErr.message);
    }

    // 2. Obtener datos de mercado en vivo
    let marketContext = {
      dolarMEP: 1545,
      dolarCCL: 1605,
      dolarBlue: 1555,
      dolarOficial: 1535,
      riesgoPais: 509,
      inflacionEstimadaMensual: '2.8% - 3.5%',
      tasaLECAPsMensualTNA: '34% - 38% (TEM ~2.8% - 3.1%)',
      rendimientoONsUSD: '7.5% - 9.2% anual en USD',
      cedearsDestacados: ['SPY (ETF S&P 500)', 'QQQ (Nasdaq 100)', 'AAPL', 'NVDA', 'MELI', 'MSFT']
    };

    try {
      const respDolar = await fetch('https://dolarapi.com/v1/dolares', { signal: AbortSignal.timeout(3000) }).then(r => r.json()).catch(() => null);
      if (Array.isArray(respDolar)) {
        respDolar.forEach(d => {
          const k = d.casa?.toLowerCase();
          if (k === 'bolsa') marketContext.dolarMEP = Number(d.venta || d.compra || marketContext.dolarMEP);
          if (k === 'contadoconliqui') marketContext.dolarCCL = Number(d.venta || d.compra || marketContext.dolarCCL);
          if (k === 'blue') marketContext.dolarBlue = Number(d.venta || d.compra || marketContext.dolarBlue);
          if (k === 'oficial') marketContext.dolarOficial = Number(d.venta || d.compra || marketContext.dolarOficial);
        });
      }
    } catch (_) {}

    // 3. Compilar System Prompt especializado
    const balanceMes = financialContext.ingresosMes - financialContext.egresosMes;
    const systemPrompt = `Eres "Fluxo AI Wealth Advisor", un asesor financiero matriculado, planificador patrimonial y estratega de inversiones de élite en Argentina y mercados globales.
Tu misión es asistir al usuario con rigurosidad matemática, visión estratégica y claridad empática.

DATOS DEL USUARIO Y CONTEXTO PATRIMONIAL ACTUAL:
- Cuenta Activa: ${financialContext.cuentaNombre} | Período: ${mes || 'Actual'} | Moneda base: ${globalCurrency}
- Perfil de Riesgo del Inversor: ${riskProfile} (CONSERVADOR / MODERADO / AGRESIVO)
- Ingresos del Mes: $${financialContext.ingresosMes.toLocaleString('es-AR')}
- Egresos del Mes: $${financialContext.egresosMes.toLocaleString('es-AR')}
- Balance / Flujo Neto del Mes: $${balanceMes.toLocaleString('es-AR')}
- Compromisos en Tarjetas de Crédito este mes: $${financialContext.deudaTarjetasTotal.toLocaleString('es-AR')}
- Fondo en Chanchito (Ahorro líquido): $${financialContext.ahorroTotalARS.toLocaleString('es-AR')} ARS | US$ ${financialContext.ahorroTotalUSD.toLocaleString('es-AR')} USD
- Gastos por Categoría: ${JSON.stringify(financialContext.gastosPorCategoria, null, 2)}
- Gastos Recurrentes / Cuotas activas: ${JSON.stringify(financialContext.gastosRecurrentes.slice(0, 8), null, 2)}
- Tenencias actuales de Inversión: ${JSON.stringify(financialContext.carteraInversiones.slice(0, 10), null, 2)}

CONDICIONES MACROECONÓMICAS Y MERCADO DE CAPITALES VIVO:
- Dólar MEP: $${marketContext.dolarMEP} | Dólar CCL: $${marketContext.dolarCCL} | Dólar Blue: $${marketContext.dolarBlue} | Oficial: $${marketContext.dolarOficial}
- Riesgo País: ${marketContext.riesgoPais} pb
- Tasa Renta Fija Pesos (LECAPs/Tasa Real): ${marketContext.tasaLECAPsMensualTNA}
- Tasa Renta Fija Dólares (ONs Corporativas Hard Dollar como YPF, Pampa, Telecom): ${marketContext.rendimientoONsUSD}
- Renta Variable / CEDEARs recomendados: ${marketContext.cedearsDestacados.join(', ')}

TUS CAPACIDADES Y REGLAS DE CONDUCTA:
1. TEST Y EVALUACIÓN DE PERFIL DE RIESGO INTERACTIVO (PASO A PASO):
   - NUNCA envíes las 3 preguntas juntas de golpe.
   - Envía SIEMPRE DE A 1 PREGUNTA por turno y aguarda la respuesta del usuario antes de pasar a la siguiente.
   - En cada pregunta del test, formula la pregunta de manera muy clara y breve, y al final incluye obligatoriamente las opciones en una línea con el formato exacto:
     [OPCIONES: A) Opción 1 | B) Opción 2 | C) Opción 3]
   - Cuando el usuario responda la pregunta 3, realiza el diagnóstico definitivo indicando:
     "Tu perfil es: CONSERVADOR" (o MODERADO / AGRESIVO) junto con la explicación de su tolerancia al riesgo y la estrategia de cartera sugerida.
2. PLANIFICACIÓN DE METAS DE AHORRO Y RECORTE DE PARTIDAS:
   - Si el usuario dice que quiere ahorrar $X por mes para un proyecto:
     a) Analiza sus gastos por categoría y detecta partidas prescindibles o reducibles.
     b) Especifica exactamente QUÉ partidas recortar, CUÁNTO recortar y a partir de qué mes.
     c) Realiza una PROYECCIÓN CRONOLÓGICA DE AHORRO acumulado (ej. a 3, 6, 12 meses con y sin rendimiento).
3. ESTRATEGIA DE INVERSIÓN Y DIVERSIFICACIÓN POR PROYECTO:
   - Para el dinero ahorrado mes a mes, diseña una cartera diversificada acorde a su Perfil (${riskProfile}) y plazo del proyecto.
   - Distribuye porcentualmente entre Renta Fija en Pesos (LECAPs), Renta Fija en USD (ONs) y Renta Variable (CEDEARs).
   - Justifica con inflación y devaluación actual.
4. MEMORIA DE PATRONES, PROYECTOS Y PREFERENCIAS:
   - Mantén en memoria todo lo conversado en turnos anteriores: proyectos definidos, montos de ahorro acordados, instrumentos preferidos y metas patrimoniales.
   - Si el usuario retoma un proyecto o meta que te mencionó antes, haz referencia a esos datos previos para darle una experiencia de asesoramiento continuo y personalizado.
5. ESTILO Y FORMATO LIMPIO:
   - NO uses encabezados gigantes con "###" ni bloques de código con ``` markdown.
   - Escribe en texto limpio, fluido, directo y profesional en español. Usa negritas puntuales para resaltar conceptos clave.`;

    // 4. Llamar a la API de Gemini con lista de modelos en cascada
    const contents = [];
    (chatHistory || []).forEach(msg => {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text || (msg.parts && msg.parts[0]?.text) || '' }]
      });
    });

    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });

    // 4. Descubrimiento dinámico de modelos soportados por la API Key
    let geminiData = null;
    let lastError = null;

    try {
      // Consultar qué modelos tiene habilitados exactamente esta API Key
      const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, { signal: AbortSignal.timeout(4000) });
      let availableModels = [];
      if (listResp.ok) {
        const listData = await listResp.json();
        availableModels = (listData.models || [])
          .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
          .map(m => m.name.replace('models/', ''));
      }

      // Modelos preferidos de texto en orden de prioridad (3.6 Flash, 3.5 Flash-Lite, 2.5 Flash, etc.)
      const priorityOrder = [
        'gemini-3.6-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.5-flash',
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash',
        'gemini-1.5-flash',
        'gemini-1.5-flash-latest',
        'gemini-1.5-pro'
      ];

      // Ordenar los disponibles según nuestra preferencia, descartando modelos exclusivos de audio/TTS/imágenes
      let modelsToTry = [];
      if (availableModels.length > 0) {
        // Filtrar modelos puramente de voz/TTS o imágenes
        const textModels = availableModels.filter(m => 
          !m.includes('tts') && 
          !m.includes('audio') && 
          !m.includes('imagen') && 
          !m.includes('embedding') &&
          !m.includes('bison')
        );

        modelsToTry = priorityOrder.filter(m => textModels.includes(m));
        textModels.forEach(m => {
          if (!modelsToTry.includes(m)) modelsToTry.push(m);
        });
      }

      if (modelsToTry.length === 0) {
        modelsToTry = priorityOrder;
      }

      for (const model of modelsToTry) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemPrompt }] },
              contents: contents
            })
          });

          if (resp.ok) {
            geminiData = await resp.json();
            break;
          } else {
            const errBody = await resp.json().catch(() => null);
            lastError = errBody?.error?.message || `HTTP ${resp.status}`;
            // Si es 400 por clave inválida general o cuota, detén la cascada
            if (resp.status === 403) break;
          }
        } catch (callErr) {
          lastError = callErr.message;
        }
      }
    } catch (listErr) {
      lastError = listErr.message;
    }

    if (!geminiData) {
      throw new Error(`Gemini API error: ${lastError || 'No se pudo contactar el modelo de IA'}`);
    }

    const replyText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'No pude generar una recomendación en este momento.';

    return res.status(200).json({
      success: true,
      reply: replyText,
      macroSnapshot: {
        dolarMEP: marketContext.dolarMEP,
        dolarCCL: marketContext.dolarCCL,
        riesgoPais: marketContext.riesgoPais
      }
    });

  } catch (err) {
    console.error('[aiAdvisor -> ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
