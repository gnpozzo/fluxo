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
      metaAhorro = null,
      topeTC = null,
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
      gastosFijosTotal: 0,
      gastosVariablesTotal: 0,
      margenAhorroReal: 0,
      consumoTCPctSobreIngresos: 0,
      metaAhorroActual: metaAhorro || null,
      topeTCActual: topeTC || null,
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
                
                const esFijo = (mov.tipo_egreso === 'RECURRENTE') || 
                  /impuesto|servicio|luz|gas|agua|internet|telef|cable|expensa|alquiler|vivienda|colegio|educaci|cuota social|prepaga|obra social|salud|seguro/i.test(cat) ||
                  /alquiler|expensa|seguro|colegio|prepaga|osde|swiss medical|galeno|edenor|edesur|metrogas|aysa|fibertel|telecentro|flow|personal flow/i.test(mov.descripcion || '');

                if (esFijo) {
                  financialContext.gastosFijosTotal += imp;
                } else {
                  financialContext.gastosVariablesTotal += imp;
                }

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

            financialContext.margenAhorroReal = Math.max(0, financialContext.ingresosMes - financialContext.gastosFijosTotal);

            // Desglose analítico con doble métrica: % sobre gastos y % sobre ingresos
            const desgloseCats = {};
            Object.entries(financialContext.gastosPorCategoria).forEach(([cat, imp]) => {
              const pctG = financialContext.egresosMes > 0 ? (imp / financialContext.egresosMes) * 100 : 0;
              const pctI = financialContext.ingresosMes > 0 ? (imp / financialContext.ingresosMes) * 100 : 0;
              desgloseCats[cat] = {
                monto: Math.round(imp * 100) / 100,
                pctGastos: Math.round(pctG * 10) / 10 + '%',
                pctIngresos: financialContext.ingresosMes > 0 ? Math.round(pctI * 10) / 10 + '%' : 'Sin ingresos'
              };
            });
            financialContext.desgloseCategorias = desgloseCats;
          }

          // Estado de pagos (Saldados vs Pendientes)
          const { data: logRows } = await supabase
            .from('logs')
            .select('contexto')
            .eq('funcion', 'ESTADO_PAGOS')
            .eq('mensaje', userId)
            .limit(1);
          const pagosMap = logRows?.[0]?.contexto || {};
          let saldados = 0, pendientes = 0;
          (movs || []).forEach(m => {
            if (m.tipo_mov === 'EGRESO') {
              const isPaid = !!pagosMap[m.id_movimiento]?.pagado;
              const imp = Math.abs(Number(m.importe || 0));
              if (isPaid) saldados += imp;
              else pendientes += imp;
            }
          });
          financialContext.egresosSaldados = saldados;
          financialContext.egresosPendientes = pendientes;

          // Deuda de tarjetas
          const { data: tcConsumos } = await supabase
            .from('consumos_tc')
            .select('importe, cuota_actual, cuota_total, descripcion, id_tarjeta')
            .eq('user_id', userId)
            .gte('fecha', start)
            .lte('fecha', end);

          if (tcConsumos) {
            financialContext.deudaTarjetasTotal = tcConsumos.reduce((acc, c) => acc + Number(c.importe || 0), 0);
            financialContext.consumoTCPctSobreIngresos = financialContext.ingresosMes > 0 
              ? Math.round((financialContext.deudaTarjetasTotal / financialContext.ingresosMes) * 100 * 10) / 10 
              : 0;
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

6. PLANIFICACIÓN DE METAS DE AHORRO Y SALUD FINANCIERA (AUDITORÍA FIJOS VS VARIABLES):
   - Cuando el usuario converse sobre definir, ajustar o evaluar una meta de ahorro (ej. "ahorrar 3.000.000", "armar fondo de emergencia", "ahorro para vacaciones"):
     a) Realiza una auditoría rigurosa distinguiendo GASTOS FIJOS INELUDIBLES (impuestos, servicios, vivienda/alquiler, educación, salud, seguros) de sus GASTOS VARIABLES (salidas, compras, ocio).
     b) Advierte contundentemente que los gastos fijos NO se pueden recortar para ahorrar. El ahorro debe provenir de optimizar gastos variables o del margen real libre.
     c) Evalúa la viabilidad temporal del objetivo (ej. calculando cuántos meses tomará según su margen de ahorro mensual real) y cuestiona plazos irreales proponiendo alternativas alcanzables o metas escalonadas.
     d) Cuando definan o acuerden el objetivo con el usuario (o el usuario te pida fijarlo), DEBES EMITIR AL FINAL DE TU RESPUESTA la siguiente acción técnica para actualizar el dashboard inmediatamente:
     [ACCION_DEFINIR_META: {"titulo": "Objetivo acordado", "montoObjetivo": 3000000, "fechaLimite": "YYYY-MM-DD"}]
     (Si el objetivo no tiene vencimiento o es definitivo, coloca "fechaLimite": null).

7. CONTROL DE SALUD FINANCIERA Y TOPE DE TARJETA DE CRÉDITO:
   - Monitorea constantemente los consumos en tarjetas de crédito respecto a los ingresos.
   - Si el consumo en tarjeta supera o se aproxima al tope (por defecto 25% de ingresos), advierte proactivamente al usuario sobre el riesgo de liquidez y el alto costo de financiamiento.
   - Si el usuario acuerda o te pide fijar o modificar su tope de tarjeta (ej. "fijar un tope del 25%"), DEBES EMITIR AL FINAL DE TU RESPUESTA la siguiente acción técnica:
     [ACCION_DEFINIR_TOPE_TC: {"topePorcentaje": 25, "topeMonto": null}]

DATOS DEL USUARIO Y CONTEXTO PATRIMONIAL ACTUAL:
- Cuenta Activa: ${financialContext.cuentaNombre} (ID: ${financialContext.cuentaId}) | Período: ${mes || 'Actual'} | Moneda base: ${globalCurrency}
- Cuentas del Usuario: ${cuentasTxt}
- Perfil de Riesgo: ${riskProfile}
- Ingresos del Mes: $${financialContext.ingresosMes.toLocaleString('es-AR')} | Egresos Totales: $${financialContext.egresosMes.toLocaleString('es-AR')} | Balance Neto: $${balanceMes.toLocaleString('es-AR')}
- Desglose Fijos vs Variables (Auditoría de Salud Financiera):
  * Gastos Fijos Ineludibles (Impuestos, Servicios, Alquiler, Educación, Salud, Seguros): $${financialContext.gastosFijosTotal.toLocaleString('es-AR')}
  * Gastos Variables Discrecionales (Ocio, Salidas, Compras): $${financialContext.gastosVariablesTotal.toLocaleString('es-AR')}
  * Margen Real de Ahorro (Ingresos - Gastos Fijos): $${financialContext.margenAhorroReal.toLocaleString('es-AR')}
- Tarjetas de Crédito y Salud Financiera:
  * Consumo TC este mes: $${financialContext.deudaTarjetasTotal.toLocaleString('es-AR')} (${financialContext.consumoTCPctSobreIngresos}% de ingresos)
  * Tope TC actual configurado: ${financialContext.topeTCActual?.topePorcentaje || 25}%
- Meta de Ahorro Activa en Dashboard: ${financialContext.metaAhorroActual ? `${financialContext.metaAhorroActual.titulo} (Meta: $${Number(financialContext.metaAhorroActual.montoObjetivo || 3000000).toLocaleString('es-AR')}${financialContext.metaAhorroActual.fechaLimite ? `, Vence: ${financialContext.metaAhorroActual.fechaLimite}` : ', Sin vencimiento'})` : 'Meta: $ 3.000.000'}
- Estado de Pagos del Mes: Ya Saldados/Abonados: $${(financialContext.egresosSaldados || 0).toLocaleString('es-AR')} | Pendientes de Pago: $${(financialContext.egresosPendientes || 0).toLocaleString('es-AR')}
- Fondo en Chanchito (Ahorro líquido): $${financialContext.ahorroTotalARS.toLocaleString('es-AR')} ARS | US$ ${financialContext.ahorroTotalUSD.toLocaleString('es-AR')} USD
- Gastos por Categoría (% sobre gastos y % sobre ingresos): ${JSON.stringify(financialContext.desgloseCategorias || financialContext.gastosPorCategoria, null, 2)}
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
