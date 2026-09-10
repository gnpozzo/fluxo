import { getSupabaseClient } from '../api_lib/supabase.js';
import XLSX from 'xlsx';

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
      projectGoal = null,
      fileBase64 = null,
      mimeType = null,
      fileName = null
    } = req.body || {};

    if (!message && !fileBase64) {
      return res.status(400).json({ success: false, error: 'Mensaje o archivo requerido' });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'GEMINI_API_KEY no configurada en el servidor.' });
    }

    // 1. Obtener datos financieros de Supabase
    let financialContext = {
      cuentaId: cuentaId,
      cuentaNombre: 'Principal',
      cuentasDisponibles: [],
      categoriasDisponibles: [],
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
      const userId = req.user?.id;

      if (userId) {
        // Cuentas del usuario
        const { data: accounts } = await supabase
          .from('cuentas_principales')
          .select('id_cuenta_principal, nombre')
          .eq('user_id', userId);
        if (accounts) {
          financialContext.cuentasDisponibles = accounts;
          const matchedAcc = accounts.find(a => a.id_cuenta_principal === cuentaId);
          if (matchedAcc) {
            financialContext.cuentaNombre = matchedAcc.nombre;
          } else if (accounts.length > 0) {
            financialContext.cuentaNombre = accounts[0].nombre;
            financialContext.cuentaId = accounts[0].id_cuenta_principal;
          }
        }

        // Categorías activas
        const { data: cats } = await supabase
          .from('categorias')
          .select('id_categoria, nombre, tipo_mov')
          .eq('activa', true);
        if (cats) {
          financialContext.categoriasDisponibles = cats;
        }

        if (financialContext.cuentaId && mes) {
          const start = mes + '-01';
          const [y, m] = mes.split('-').map(Number);
          const lastDay = new Date(y, m, 0).getDate();
          const end = `${mes}-${String(lastDay).padStart(2, '0')}`;

          // Movimientos del mes con categorías
          const { data: movs } = await supabase
            .from('movimientos')
            .select('*, categorias (nombre)')
            .eq('id_cuenta_principal', financialContext.cuentaId)
            .eq('user_id', userId)
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
            .eq('user_id', userId)
            .gte('fecha', start)
            .lte('fecha', end);

          if (tcConsumos) {
            financialContext.deudaTarjetasTotal = tcConsumos.reduce((acc, c) => acc + Number(c.importe || 0), 0);
          }

          // Ahorros
          const { data: ahorros } = await supabase
            .from('ahorros')
            .select('moneda, importe')
            .eq('user_id', userId);

          if (ahorros) {
            ahorros.forEach(a => {
              if (a.moneda === 'USD') financialContext.ahorroTotalUSD += Number(a.importe || 0);
              else financialContext.ahorroTotalARS += Number(a.importe || 0);
            });
          }

          // Inversiones
          const { data: invs } = await supabase
            .from('inversiones_movimientos')
            .select('ticker, tipo_operacion, cantidad_nominales, precio_compra, moneda')
            .eq('user_id', userId);

          if (invs) {
            financialContext.carteraInversiones = invs;
          }
        }
      }
    } catch (dbErr) {
      console.warn('[FluxoAI -> Context gathering notice]:', dbErr.message);
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

    // 3. Procesar archivo adjunto si existe
    let fileTextExtraction = '';
    let hasInlineAttachment = false;
    let inlineMimeType = null;
    let inlineData = null;

    if (fileBase64) {
      const isXlsx = (fileName && (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv'))) ||
                     (mimeType && (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv')));

      if (isXlsx) {
        try {
          const buf = Buffer.from(fileBase64, 'base64');
          const wb = XLSX.read(buf, { type: 'buffer' });
          const sheetNames = wb.SheetNames || [];
          let tablesText = [];
          for (const sName of sheetNames.slice(0, 3)) {
            const sheet = wb.Sheets[sName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            if (rows && rows.length > 0) {
              const rowsSlice = rows.slice(0, 80);
              const tableMd = rowsSlice.map(r => Array.isArray(r) ? r.join(' | ') : String(r)).join('\n');
              tablesText.push(`--- HOJA "${sName}" (${rows.length} filas) ---\n${tableMd}`);
            }
          }
          fileTextExtraction = `\n\n[PLANILLA ADJUNTA "${fileName || 'datos.xlsx'}"]:\n${tablesText.join('\n\n')}\n`;
        } catch (parseXlsErr) {
          console.warn('[FluxoAI] Error parsing XLSX buffer:', parseXlsErr.message);
          fileTextExtraction = `\n[Nota: Archivo XLSX adjunto "${fileName || 'documento'}" recibido].`;
        }
      } else {
        // PDF o Imagen: compatible con Gemini Vision / Multimodal API
        hasInlineAttachment = true;
        inlineMimeType = mimeType || (fileName?.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
        inlineData = fileBase64;
      }
    }

    // 4. Compilar System Prompt con criterio propio y cuestionamiento financiero
    const balanceMes = financialContext.ingresosMes - financialContext.egresosMes;
    const cuentasTxt = financialContext.cuentasDisponibles.map(a => `${a.nombre} (ID: ${a.id_cuenta_principal})`).join(', ') || 'Principal';
    const categoriasTxt = financialContext.categoriasDisponibles.map(c => `${c.nombre} (${c.tipo_mov}, ID: ${c.id_categoria})`).join(', ') || 'General';

    const systemPrompt = `Eres "FluxoAI", un asesor financiero matriculado, planificador patrimonial y estratega de inversiones con CRITERIO PROPIO, PENSAMIENTO CRÍTICO y DISCIPLINA FINANCIERA RIGUROSA en Argentina y mercados globales.

TUS PRINCIPIOS Y PERSONALIDAD:
1. PENSAMIENTO CRÍTICO Y CUESTIONAMIENTO:
   - NO des nada por hecho y NO seas un simple asistente complaciente que aprueba cualquier plan.
   - Cuestiona al usuario cuando tome decisiones financieramente imprudentes, apresuradas o sin cálculo:
     * Si el usuario quiere invertir en renta variable, cripto o instrumentos volátiles teniendo deudas de tarjeta de crédito (CFT > 100-150% anual), CUESTIONA FIRMEMENTE esa postura. Explica con números que cancelar la deuda de tarjeta otorga un rendimiento 100% libre de riesgo superior a cualquier activo bursátil.
     * Si plantea un objetivo de ahorro irreal que recortaría gastos esenciales fijos (colegio, alquiler, seguros del hogar, servicios básicos), adviértele las consecuencias y propone metas escalonadas.
     * Si propone instrumentos en pesos con tasa fija nominal frente a expectativas de devaluación o inflación acelerada, analiza la tasa real negativa.
   - Cuestiónate también a ti mismo: explica pros y contras, riesgos ocultos, comisiones de broker y falta de liquidez.

2. ASESORAMIENTO Y CONSULTA DE INSTRUMENTOS BURSÁTILES:
   - Cuando el usuario pregunte por un instrumento (ej. un Bono Soberano como GD30/AL30, LECAP, ON corporativa en USD como YCA6O/PAMPA, o CEDEAR como SPY/NVDA/AAPL):
     a) Detalla condiciones de emisión o pliego (moneda, legislación, cupón, amortización, paridad o TIR estimada).
     b) Evalúa si es adecuado para su Perfil de Riesgo (${riskProfile}) y horizonte temporal.
     c) Cuestiona si la concentración en ese activo es prudente o si existen alternativas con mejor relación riesgo-retorno o mayor liquidez.

3. EXTRACCIÓN E INCORPORACIÓN INTELIGENTE DE GASTOS Y MOVIMIENTOS:
   - Si el usuario adjunta un archivo (planilla XLSX, PDF de resumen bancario, factura, ticket o imagen) o pide incorporar movimientos a una cuenta:
     a) Identifica minuciosamente cada transacción (fecha YYYY-MM-DD, descripción limpia, importe positivo, tipo 'EGRESO' o 'INGRESO').
     b) Asigna la cuenta destino (por defecto "${financialContext.cuentaNombre}" con ID "${financialContext.cuentaId}", o la que el usuario indique entre: ${cuentasTxt}).
     c) Asigna la categoría más adecuada de la lista oficial: ${categoriasTxt}.
     d) Presenta un desglose ordenado y claro de los gastos detectados.
     e) Y AL FINAL DE LA RESPUESTA, incluye OBLIGATORIAMENTE el siguiente bloque de acción para permitir la carga directa con 1 clic:
     [ACCION_IMPORTAR_MOVIMIENTOS: {"cuentaId": "${financialContext.cuentaId}", "cuentaNombre": "${financialContext.cuentaNombre}", "movimientos": [{"fecha": "YYYY-MM-DD", "descripcion": "...", "importe": 123.45, "tipo_mov": "EGRESO", "id_categoria": "..."}]}]

4. TEST DE PERFIL DE INVERSOR INTERACTIVO:
   - Formula UNA PREGUNTA POR TURNO (no las 3 juntas) e incluye al final:
     [OPCIONES: A) Opción 1 | B) Opción 2 | C) Opción 3]
   - Al responder la última, define el perfil definitivo: "Tu perfil es: CONSERVADOR" (o MODERADO / AGRESIVO).

5. REGLAS DE NEGOCIO Y DOMINIO ESPECÍFICAS DEL USUARIO (SEGUROS RECURRENTES):
   - El usuario abona dos pólizas de seguro mensuales con "La Segunda" que en extractos o resúmenes aparecen con formato de cuotas (ej. "La segunda coo...-01/06-...", "La segunda coo...-01/03-..."), pero son GASTOS RECURRENTES continuos que al vencer renuevan la póliza y resetean el contador de cuotas:
     * Seguro del Hogar: Se categoriza SIEMPRE como "Vivienda" y se imputa a la cuenta "Hogar" (habitualmente en ciclos de 6 cuotas, póliza 1028363).
     * Seguro del Auto: Se categoriza SIEMPRE como "Transporte" y se imputa a la cuenta "Personal" (habitualmente en ciclos de 3 cuotas, póliza 8758204).
   - Cuando analices resúmenes, planillas o archivos adjuntos, debes dirimir inteligentemente que se trata de la continuidad del consumo del mes anterior, asignando la categoría y cuenta correspondiente a cada póliza sin duplicar ni confundirlas.

DATOS DEL USUARIO Y CONTEXTO PATRIMONIAL ACTUAL:
- Cuenta Activa: ${financialContext.cuentaNombre} (ID: ${financialContext.cuentaId}) | Período: ${mes || 'Actual'} | Moneda base: ${globalCurrency}
- Cuentas del Usuario: ${cuentasTxt}
- Perfil de Riesgo: ${riskProfile}
- Ingresos del Mes: $${financialContext.ingresosMes.toLocaleString('es-AR')} | Egresos: $${financialContext.egresosMes.toLocaleString('es-AR')} | Balance Neto: $${balanceMes.toLocaleString('es-AR')}
- Deuda en Tarjetas este mes: $${financialContext.deudaTarjetasTotal.toLocaleString('es-AR')}
- Fondo en Chanchito (Ahorro líquido): $${financialContext.ahorroTotalARS.toLocaleString('es-AR')} ARS | US$ ${financialContext.ahorroTotalUSD.toLocaleString('es-AR')} USD
- Gastos por Categoría: ${JSON.stringify(financialContext.gastosPorCategoria, null, 2)}
- Gastos Recurrentes / Cuotas: ${JSON.stringify(financialContext.gastosRecurrentes.slice(0, 8), null, 2)}
- Cartera de Inversiones: ${JSON.stringify(financialContext.carteraInversiones.slice(0, 8), null, 2)}

CONDICIONES MACROECONÓMICAS Y MERCADO FINANCIERO:
- Dólar MEP: $${marketContext.dolarMEP} | CCL: $${marketContext.dolarCCL} | Blue: $${marketContext.dolarBlue} | Oficial: $${marketContext.dolarOficial}
- Riesgo País: ${marketContext.riesgoPais} pb | Inflación mensual estimada: ${marketContext.inflacionEstimadaMensual}
- Rendimiento LECAPs: ${marketContext.tasaLECAPsMensualTNA} | ONs Hard Dollar: ${marketContext.rendimientoONsUSD}
- CEDEARs destacados: ${marketContext.cedearsDestacados.join(', ')}

FORMATO: Escribe con elegancia, precisión profesional en español y negritas destacadas. Evita encabezados gigantes ### o bloques de código \`\`\`.`;

    // 5. Preparar contents para la API de Gemini
    const contents = [];
    (chatHistory || []).forEach(msg => {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text || (msg.parts && msg.parts[0]?.text) || '' }]
      });
    });

    const userTextParts = [{ text: (message || '') + fileTextExtraction }];
    if (hasInlineAttachment && inlineData && inlineMimeType) {
      userTextParts.push({
        inlineData: {
          mimeType: inlineMimeType,
          data: inlineData
        }
      });
    }

    contents.push({
      role: 'user',
      parts: userTextParts
    });

    // 6. Descubrimiento dinámico de modelos soportados por la API Key
    let geminiData = null;
    let lastError = null;

    try {
      const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, { signal: AbortSignal.timeout(4000) });
      let availableModels = [];
      if (listResp.ok) {
        const listData = await listResp.json();
        availableModels = (listData.models || [])
          .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
          .map(m => m.name.replace('models/', ''));
      }

      const priorityOrder = [
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-1.5-flash',
        'gemini-1.5-flash-latest',
        'gemini-2.5-pro',
        'gemini-1.5-pro'
      ];

      let modelsToTry = [];
      if (availableModels.length > 0) {
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
      throw new Error(`FluxoAI Error: ${lastError || 'No se pudo contactar el modelo de IA'}`);
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
    console.error('[FluxoAI -> ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
