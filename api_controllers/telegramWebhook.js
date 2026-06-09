import { createClient } from '@supabase/supabase-js';
import createMovimiento from './createMovimiento.js';
import createConsumoTC from './createConsumoTC.js';
import createConsumoCC from './createConsumoCC.js';

async function sendTelegramMessage(token, chatId, text, replyToMessageId = null) {
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  };
  if (replyToMessageId) {
    body.reply_to_message_id = replyToMessageId;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error('[telegramWebhook -> sendTelegramMessage response error]', errorText);
    }
  } catch (err) {
    console.error('[telegramWebhook -> sendTelegramMessage]', err.message);
  }
}

async function callGemini(key, modelName, systemInstruction, promptText, responseMimeType = null) {
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: (systemInstruction ? systemInstruction + '\n\n' : '') + promptText
          }
        ]
      }
    ]
  };
  if (responseMimeType) {
    payload.generationConfig = { responseMimeType };
  }
  
  let response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok && modelName === 'gemini-3.5-flash') {
    console.warn(`[telegramWebhook] Model ${modelName} failed with status ${response.status}. Retrying with fallback gemini-3.1-flash-lite.`);
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${key}`, {
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
    throw new Error('Gemini no devolvió respuesta.');
  }
  return text;
}

export default async function handler(req, res) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  
  // 1. Setup endpoint (GET) to automatically configure Telegram webhook
  if (req.method === 'GET' && req.query?.setup === 'true') {
    const setupSecret = req.query.secret;
    if (!webhookSecret || setupSecret !== webhookSecret) {
      return res.status(401).json({ success: false, error: 'Unauthorized setup request' });
    }
    
    if (!botToken) {
      return res.status(500).json({ success: false, error: 'TELEGRAM_BOT_TOKEN is not configured' });
    }
    
    const host = req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const webhookUrl = `${proto}://${host}/api/telegramWebhook`;
    
    try {
      const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: webhookSecret
        })
      });
      
      const telegramData = await telegramRes.json();
      return res.status(200).json({ success: true, telegram: telegramData, url: webhookUrl });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // 2. Main Webhook Handler (POST)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Verify Telegram secret token for security
  const telegramHeaderSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (!webhookSecret || telegramHeaderSecret !== webhookSecret) {
    console.warn('[telegramWebhook] Unauthorized POST request received.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = req.body;
    if (!body || !body.message) {
      return res.status(200).json({ success: true, message: 'No message payload' });
    }

    const message = body.message;
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const messageText = message.text;

    if (!messageText) {
      return res.status(200).json({ success: true, message: 'Message has no text' });
    }

    // Authenticate Sender
    const allowedUsersStr = process.env.TELEGRAM_ALLOWED_USERS || '';
    const allowedUsers = allowedUsersStr.split(',').map(s => s.trim().toLowerCase());
    
    const senderId = message.from?.id ? String(message.from.id) : '';
    const senderUsername = message.from?.username ? message.from.username.toLowerCase() : '';
    
    const isAllowed = allowedUsers.includes(senderId) || allowedUsers.includes(senderUsername);
    if (!isAllowed) {
      console.warn(`[telegramWebhook] Blocked unauthorized user: ID=${senderId}, Username=${senderUsername}`);
      await sendTelegramMessage(botToken, chatId, '⚠️ No tienes permiso para interactuar con este bot.', messageId);
      return res.status(200).json({ success: false, error: 'User not allowed' });
    }

    // Fetch context from Supabase (cards, categories, accounts, contacts)
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !serviceKey) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Error de configuración: Supabase no configurado.', messageId);
      return res.status(200).json({ success: false, error: 'Supabase configs missing' });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const [cuentasRes, categoriasRes, tarjetasRes, contactosRes] = await Promise.all([
      supabase.from('cuentas_principales').select('id_cuenta_principal,nombre,moneda_principal,es_predeterminada').eq('activa', true),
      supabase.from('categorias').select('id_categoria,nombre,tipo_mov').eq('activa', true),
      supabase.from('tarjetas').select('id_tarjeta,nombre,banco,ultimos_4_digitos,id_cuenta_principal').eq('activa', true),
      supabase.from('cta_corriente_usuarios').select('id_usuario,nombre')
    ]);

    if (cuentasRes.error || categoriasRes.error || tarjetasRes.error || contactosRes.error) {
      throw new Error('Error al consultar tablas maestras en Supabase.');
    }

    const cuentas = cuentasRes.data || [];
    const categorias = categoriasRes.data || [];
    const tarjetas = tarjetasRes.data || [];
    const contactos = contactosRes.data || [];

    const todayStr = new Date().toISOString().split('T')[0];

    // Build instruction prompt for Gemini
    const systemInstruction = `
Eres un asistente de parsing financiero en español. Tu tarea es extraer la información de transacciones enviadas por el usuario, o clasificar sus preguntas sobre saldos y gastos, y devolver un objeto JSON estructurado que coincida con las APIs de nuestro sistema.

A continuación, se presenta la lista de registros activos en la base de datos:

Cuentas principales disponibles:
${JSON.stringify(cuentas.map(c => ({ id: c.id_cuenta_principal, nombre: c.nombre, moneda: c.moneda_principal, predeterminada: c.es_predeterminada })))}

Categorías disponibles:
${JSON.stringify(categorias.map(c => ({ id: c.id_categoria, nombre: c.nombre, tipo_mov: c.tipo_mov })))}

Tarjetas de crédito disponibles:
${JSON.stringify(tarjetas.map(t => ({ id: t.id_tarjeta, nombre: t.nombre, banco: t.banco, ultimos4: t.ultimos_4_digitos, idCuentaImputar: t.id_cuenta_principal })))}

Contactos (cuenta corriente) disponibles:
${JSON.stringify(contactos.map(u => ({ id: u.id_usuario, nombre: u.nombre })))}

Fecha actual de referencia: ${todayStr} (Año-Mes-Día)

Instrucciones de clasificación:
1. Determina el "tipo_registro" de la transacción o consulta:
   - "tarjeta": si menciona cargar un consumo en tarjeta de crédito.
   - "cc": si menciona cargar un gasto compartido.
   - "movimiento": si menciona cargar un gasto común o un ingreso en cuenta.
   - "query": si el usuario está haciendo una pregunta sobre sus finanzas (saldos, gastos del mes, ingresos del mes, últimos movimientos registrados, consumos en tarjetas de crédito, o proyecciones de gastos futuros).
     Ejemplos: "¿Cuánto dinero me queda?", "¿Cuánto gasté en supermercado?", "mostrame los últimos gastos", "cuánto tengo que pagar de tarjeta?", "haceme una proyección de los próximos meses".
   - "conversational": si no es una carga de datos ni una consulta a sus finanzas, sino un saludo, despedida, agradecimiento, etc.

2. Mapeo inteligente de entidades:
   - Categoría: Selecciona el "id" de la categoría que mejor corresponda semánticamente (ej: "comida" -> "Supermercado").
   - Tarjeta: Selecciona el "id" de la tarjeta si es un consumo de tarjeta.
   - Cuenta: Selecciona el "id" de la cuenta. Si no se especifica cuál, selecciona el ID de la cuenta marcada como predeterminada ("predeterminada": true), o la primera.
   - Contacto: Para transacciones tipo "cc", mapea al "id" del contacto.

3. Formato de JSON a retornar:
El JSON devuelto debe tener exactamente esta estructura de campos principales:
{
  "tipo_registro": "movimiento" | "tarjeta" | "cc" | "query" | "conversational",
  "reply_message": "Una respuesta cordial en español pidiendo más detalles (solo si tipo_registro es conversational)",
  "payload": {
     ... aquí van los campos específicos según el tipo_registro ...
  }
}

Estructura del "payload" según el "tipo_registro":
- Si tipo_registro es "movimiento":
  {
    "idCuenta": "id de la cuenta elegida (UUID)",
    "fecha": "fecha de la transacción en formato YYYY-MM-DD",
    "idCategoria": "id de la categoría elegida (UUID)",
    "tipo": "EGRESO" o "INGRESO",
    "descripcion": "Descripción concisa del gasto/ingreso",
    "importe": número (monto total de la transacción),
    "medioPago": "Efectivo", "Débito", "Transferencia" u "Otro",
    "tipoConsumo": "SIMPLE"
  }
- Si tipo_registro es "tarjeta":
  {
    "idTarjeta": "id de la tarjeta elegida (UUID)",
    "idCuentaImputar": "idCuentaImputar de la tarjeta elegida (UUID)",
    "fecha": "fecha de la transacción en formato YYYY-MM-DD",
    "idCategoria": "id de la categoría elegida (UUID)",
    "descripcion": "Descripción concisa",
    "importe": número (monto total o de la cuota según corresponda),
    "tipoConsumo": "COMUN" o "CUOTAS",
    "cuotaActual": 1, // Si es en cuotas
    "cuotaTotal": cantidad total de cuotas, // Si es en cuotas (ej: "en 3 cuotas" -> cuotaTotal: 3, cuotaActual: 1).
    "imputar": true
  }
- Si tipo_registro es "cc":
  {
    "idCuenta": "id de la cuenta predeterminada (UUID)",
    "idCategoria": "id de la categoría elegida (UUID)",
    "idUsuario": "id del contacto elegido (UUID)",
    "fecha": "fecha de la transacción en formato YYYY-MM-DD",
    "descripcion": "Descripción concisa",
    "importe": número (monto total del gasto compartido),
    "pagador": "YO" (si lo pagó el usuario) o "CONTACTO" (si lo pagó el contacto),
    "porcentajeImputado": 50, // porcentaje que asume el usuario. Por defecto 50 si no se indica.
    "tipo": "SIMPLE"
  }
- Si tipo_registro es "query":
  {
    "intent": "resumen_mes" (para preguntas generales de saldo, gastos o ingresos del mes) | "gastos_categoria" (para gastos en una categoría específica) | "ultimos_movimientos" (para ver los últimos registros) | "info_tarjetas" (para ver consumos en tarjetas de crédito) | "proyeccion" (para proyecciones de gastos futuros de los próximos meses),
    "idCuenta": "id de la cuenta consultada (UUID, opcional, por defecto usar la predeterminada)",
    "idCategoria": "id de la categoría (UUID, opcional, solo si consulta por una categoría en particular)",
    "mes": "YYYY-MM" (el mes de consulta en formato año-mes. Ejemplo: "este mes" -> "2026-06", "el mes pasado" -> "2026-05")
  }

IMPORTANTE: Devuelve únicamente un objeto JSON válido que respete esta estructura, sin Markdown (no utilices bloques de código \`\`\`json ni texto adicional).
`;

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Error: La API Key de Gemini no está configurada.', messageId);
      return res.status(200).json({ success: false, error: 'GEMINI_API_KEY not configured' });
    }

    const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    
    // Call Gemini to classify and parse input
    const contentText = await callGemini(geminiKey, modelName, systemInstruction, `Mensaje del usuario: "${messageText}"`, 'application/json');

    let parsedResult;
    try {
      parsedResult = JSON.parse(contentText);
    } catch (e) {
      console.error('[Gemini Parsing Error]', contentText);
      await sendTelegramMessage(botToken, chatId, '❌ Error: No se pudo interpretar la respuesta de la IA. Intenta reformular el mensaje.', messageId);
      return res.status(200).json({ success: false, error: 'JSON parse error' });
    }

    // Handle conversational replies
    if (parsedResult.tipo_registro === 'conversational') {
      const reply = parsedResult.reply_message || 'Hola, ¿en qué te puedo ayudar hoy?';
      await sendTelegramMessage(botToken, chatId, reply, messageId);
      return res.status(200).json({ success: true, type: 'conversational' });
    }

    // Handle user queries (ida y vuelta / pass info of the app)
    if (parsedResult.tipo_registro === 'query') {
      const payload = parsedResult.payload || parsedResult;
      const intent = payload.intent || 'resumen_mes';
      let fetchedDataContext = '';
      
      if (intent === 'resumen_mes') {
        const month = payload.mes || todayStr.substring(0, 7);
        const accountId = payload.idCuenta || cuentas.find(c => c.es_predeterminada)?.id_cuenta_principal || cuentas[0]?.id_cuenta_principal;
        
        // Calculate safe date ranges
        const parts = month.split('-');
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const nextM = m === 12 ? 1 : m + 1;
        const nextY = m === 12 ? y + 1 : y;
        const nextMonthStr = `${nextY}-${String(nextM).padStart(2, '0')}`;
        
        const { data: movs, error } = await supabase
          .from('movimientos')
          .select('importe, tipo_mov, descripcion, fecha, categorias(nombre)')
          .eq('id_cuenta_principal', accountId)
          .gte('fecha', `${month}-01`)
          .lt('fecha', `${nextMonthStr}-01`);
          
        if (error) throw error;
        
        const totalIngresos = (movs || []).filter(m => m.tipo_mov === 'INGRESO').reduce((acc, m) => acc + Math.abs(Number(m.importe)), 0);
        const totalEgresos = (movs || []).filter(m => m.tipo_mov === 'EGRESO').reduce((acc, m) => acc + Math.abs(Number(m.importe)), 0);
        
        fetchedDataContext = `Datos reales de la base de datos para el mes ${month}:
- Cuenta consultada: ${cuentas.find(c => c.id_cuenta_principal === accountId)?.nombre || 'Principal'}
- Total Ingresos: $${totalIngresos}
- Total Egresos: $${totalEgresos}
- Balance Neto (Ahorro o Déficit): $${totalIngresos - totalEgresos}
- Listado de movimientos del mes: ${JSON.stringify((movs || []).map(m => ({ fecha: m.fecha, desc: m.descripcion, monto: m.importe, tipo: m.tipo_mov, cat: m.categorias?.nombre })))}`;
        
      } else if (intent === 'gastos_categoria') {
        const month = payload.mes || todayStr.substring(0, 7);
        const accountId = payload.idCuenta || cuentas.find(c => c.es_predeterminada)?.id_cuenta_principal || cuentas[0]?.id_cuenta_principal;
        const catId = payload.idCategoria;
        
        // Calculate safe date ranges
        const parts = month.split('-');
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const nextM = m === 12 ? 1 : m + 1;
        const nextY = m === 12 ? y + 1 : y;
        const nextMonthStr = `${nextY}-${String(nextM).padStart(2, '0')}`;
        
        const query = supabase
          .from('movimientos')
          .select('importe, descripcion, fecha, categorias(nombre)')
          .eq('id_cuenta_principal', accountId)
          .eq('tipo_mov', 'EGRESO')
          .gte('fecha', `${month}-01`)
          .lt('fecha', `${nextMonthStr}-01`);
          
        if (catId) {
          query.eq('id_categoria', catId);
        }
        
        const { data: movs, error } = await query;
        if (error) throw error;
        
        const totalGasto = (movs || []).reduce((acc, m) => acc + Math.abs(Number(m.importe)), 0);
        const catName = categorias.find(c => c.id_categoria === catId)?.nombre || 'la categoría consultada';
        
        fetchedDataContext = `Datos reales para el mes ${month} en la categoría "${catName}":
- Total gastado: $${totalGasto}
- Detalle de consumos en esta categoría: ${JSON.stringify((movs || []).map(m => ({ fecha: m.fecha, desc: m.descripcion, monto: m.importe })))}`;
        
      } else if (intent === 'ultimos_movimientos') {
        const accountId = payload.idCuenta || cuentas.find(c => c.es_predeterminada)?.id_cuenta_principal || cuentas[0]?.id_cuenta_principal;
        
        const { data: movs, error } = await supabase
          .from('movimientos')
          .select('importe, tipo_mov, descripcion, fecha, categorias(nombre)')
          .eq('id_cuenta_principal', accountId)
          .order('fecha', { ascending: false })
          .limit(10);
          
        if (error) throw error;
        
        fetchedDataContext = `Últimos 10 movimientos registrados en la cuenta "${cuentas.find(c => c.id_cuenta_principal === accountId)?.nombre || 'Principal'}":
${JSON.stringify((movs || []).map(m => ({ fecha: m.fecha, desc: m.descripcion, monto: m.importe, tipo: m.tipo_mov, cat: m.categorias?.nombre })))}`;
        
      } else if (intent === 'info_tarjetas') {
        const month = payload.mes || todayStr.substring(0, 7);
        const parts = month.split('-');
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const nextM = m === 12 ? 1 : m + 1;
        const nextY = m === 12 ? y + 1 : y;
        const nextMonthStr = `${nextY}-${String(nextM).padStart(2, '0')}`;

        const { data: tarjetasRes, error: tErr } = await supabase
          .from('tarjetas')
          .select('id_tarjeta, nombre')
          .eq('activa', true);
        
        if (tErr) throw tErr;
        
        const tarjetaIds = (tarjetasRes || []).map(t => t.id_tarjeta);
        let consumos = [];
        if (tarjetaIds.length > 0) {
          const { data: cData, error: cErr } = await supabase
            .from('consumos_tc')
            .select('*, tarjetas(nombre), categorias(nombre)')
            .in('id_tarjeta', tarjetaIds)
            .gte('fecha', `${month}-01`)
            .lt('fecha', `${nextMonthStr}-01`);
            
          if (cErr) throw cErr;
          consumos = cData || [];
        }
        
        const totalTarjeta = (consumos || []).reduce((acc, c) => acc + Math.abs(Number(c.importe)), 0);
        
        fetchedDataContext = `Consumos con tarjeta de crédito en el mes ${month}:
- Total gastado en tarjetas: $${totalTarjeta}
- Detalle de consumos en tarjeta: ${JSON.stringify(consumos.map(c => ({ tarjeta: c.tarjetas?.nombre, fecha: c.fecha, desc: c.descripcion, monto: c.importe, cuota: c.cuota_actual ? `${c.cuota_actual}/${c.cuota_total}` : '1/1' })))}`;
        
      } else if (intent === 'proyeccion') {
        const currentMonthStr = todayStr.substring(0, 7);
        const parts = currentMonthStr.split('-');
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        
        // Calculate limit for next 3 months
        const endM = m + 4;
        const endY = endM > 12 ? y + 1 : y;
        const endMAdjusted = endM > 12 ? endM - 12 : endM;
        const nextMonthLimitStr = `${endY}-${String(endMAdjusted).padStart(2, '0')}-01`;
        
        const accountId = payload.idCuenta || cuentas.find(c => c.es_predeterminada)?.id_cuenta_principal || cuentas[0]?.id_cuenta_principal;
        
        const { data: movs, error: mErr } = await supabase
          .from('movimientos')
          .select('importe, descripcion, fecha, categorias(nombre)')
          .eq('id_cuenta_principal', accountId)
          .eq('tipo_mov', 'EGRESO')
          .gte('fecha', `${currentMonthStr}-01`)
          .lt('fecha', nextMonthLimitStr);
          
        if (mErr) throw mErr;
        
        const { data: tarjetasRes, error: tErr } = await supabase
          .from('tarjetas')
          .select('id_tarjeta, nombre')
          .eq('id_cuenta_principal', accountId);
          
        if (tErr) throw tErr;
        
        const tarjetaIds = (tarjetasRes || []).map(t => t.id_tarjeta);
        let consumos = [];
        if (tarjetaIds.length > 0) {
          const { data: cData, error: cErr } = await supabase
            .from('consumos_tc')
            .select('*, tarjetas(nombre), categorias(nombre)')
            .in('id_tarjeta', tarjetaIds)
            .gte('fecha', `${currentMonthStr}-01`)
            .lt('fecha', nextMonthLimitStr);
            
          if (cErr) throw cErr;
          consumos = cData || [];
        }
        
        fetchedDataContext = `Compromisos y egresos futuros proyectados desde ${currentMonthStr}-01 hasta antes de ${nextMonthLimitStr}:
- Movimientos de Egreso agendados para próximos meses: ${JSON.stringify((movs || []).map(m => ({ fecha: m.fecha, desc: m.descripcion, monto: m.importe, cat: m.categorias?.nombre })))}
- Cuotas y consumos con tarjeta agendados para próximos meses: ${JSON.stringify(consumos.map(c => ({ tarjeta: c.tarjetas?.nombre, fecha: c.fecha, desc: c.descripcion, monto: c.importe, cuota: c.cuota_actual ? `${c.cuota_actual}/${c.cuota_total}` : '1/1' })))}`;
        
      } else {
        fetchedDataContext = `No se pudo determinar el tipo de consulta.`;
      }
      
      // Call Gemini a second time to formulate a natural language response
      const answerText = await callGemini(
        geminiKey, 
        modelName, 
        null, 
        `El usuario de Telegram preguntó: "${messageText}".\n\nAquí tienes la información real extraída de la base de datos de Supabase:\n\n${fetchedDataContext}\n\nResponde directamente al usuario de manera clara, amigable y resumida en español. Utiliza viñetas y etiquetas HTML (como <b> para negritas y <code> para montos de dinero o fechas) para formatear tu respuesta. No uses bloques de código markdown.`
      );
      
      await sendTelegramMessage(botToken, chatId, answerText, messageId);
      return res.status(200).json({ success: true, type: 'query_answered' });
    }

    // Handle transactional loads
    // Fallback: support both wrapped payload and flat payload structure
    let payload = parsedResult.payload;
    if (!payload && parsedResult.tipo_registro && parsedResult.tipo_registro !== 'conversational') {
      // If flat, clone the parsedResult and clean up metadata fields to build the payload
      payload = { ...parsedResult };
      delete payload.tipo_registro;
      delete payload.reply_message;
    }
    
    if (!payload) {
      await sendTelegramMessage(botToken, chatId, '⚠️ No se pudieron extraer los datos del gasto. Por favor, intenta de nuevo.', messageId);
      return res.status(200).json({ success: false, error: 'No payload found' });
    }

    // Mock Express Request and Response to call existing controllers
    let responseData = null;
    let responseStatus = 200;

    const mockRes = {
      status(code) {
        responseStatus = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      }
    };

    const mockReq = {
      method: 'POST',
      body: payload,
      headers: {
        authorization: 'Bearer ' + serviceKey
      }
    };

    let detailText = '';

    if (parsedResult.tipo_registro === 'movimiento') {
      const catName = categorias.find(c => c.id_categoria === payload.idCategoria)?.nombre || 'Desconocida';
      const ctaName = cuentas.find(c => c.id_cuenta_principal === payload.idCuenta)?.nombre || 'Desconocida';
      
      detailText = `📝 <b>Gasto/Ingreso Común</b>\n` +
                   `💵 Importe: $${payload.importe}\n` +
                   `📂 Categoría: ${catName}\n` +
                   `💼 Cuenta: ${ctaName}\n` +
                   `📄 Detalle: ${payload.descripcion}\n` +
                   `📅 Fecha: ${payload.fecha}`;
                   
      await createMovimiento(mockReq, mockRes);
    } else if (parsedResult.tipo_registro === 'tarjeta') {
      const cardName = tarjetas.find(t => t.id_tarjeta === payload.idTarjeta)?.nombre || 'Desconocida';
      const isCuotas = payload.tipoConsumo === 'CUOTAS';
      const cuotaInfo = isCuotas ? ` (Cuota ${payload.cuotaActual}/${payload.cuotaTotal})` : '';
      const catName = categorias.find(c => c.id_categoria === payload.idCategoria)?.nombre || 'Desconocida';
      
      detailText = `💳 <b>Consumo con Tarjeta</b>\n` +
                   `💵 Importe: $${payload.importe}${cuotaInfo}\n` +
                   `💳 Tarjeta: ${cardName}\n` +
                   `📂 Categoría: ${catName}\n` +
                   `📄 Detalle: ${payload.descripcion}\n` +
                   `📅 Fecha: ${payload.fecha}`;
                   
      await createConsumoTC(mockReq, mockRes);
    } else if (parsedResult.tipo_registro === 'cc') {
      const contactName = contactos.find(u => u.id_usuario === payload.idUsuario)?.nombre || 'Desconocido';
      const catName = categorias.find(c => c.id_categoria === payload.idCategoria)?.nombre || 'Desconocida';
      
      detailText = `👥 <b>Gasto Compartido</b>\n` +
                   `💵 Importe: $${payload.importe}\n` +
                   `👤 Contacto: ${contactName}\n` +
                   `💳 Pagador: ${payload.pagador === 'YO' ? 'Vos' : contactName}\n` +
                   `📊 Tu Parte: ${payload.porcentajeImputado}%\n` +
                   `📂 Categoría: ${catName}\n` +
                   `📄 Detalle: ${payload.descripcion}\n` +
                   `📅 Fecha: ${payload.fecha}`;
                   
      await createConsumoCC(mockReq, mockRes);
    } else {
      await sendTelegramMessage(botToken, chatId, '⚠️ Tipo de registro no soportado.', messageId);
      return res.status(200).json({ success: false, error: 'Unsupported register type' });
    }

    if (responseStatus === 200 && responseData?.success) {
      const successMsg = `✅ <b>Cargado con éxito</b>\n\n${detailText}`;
      await sendTelegramMessage(botToken, chatId, successMsg, messageId);
      return res.status(200).json({ success: true, data: responseData });
    } else {
      const errMsg = responseData?.error || 'Error desconocido al insertar en base de datos.';
      await sendTelegramMessage(botToken, chatId, `❌ <b>Error al cargar transacción</b>\n\n${errMsg}`, messageId);
      return res.status(200).json({ success: false, error: errMsg });
    }
  } catch (err) {
    console.error('[telegramWebhook Main Error]', err.message);
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const body = req.body;
      const chatId = body?.message?.chat?.id;
      const messageId = body?.message?.message_id;
      if (botToken && chatId) {
        await sendTelegramMessage(botToken, chatId, `❌ <b>Error interno en el bot</b>\n\n<code>${err.message}</code>`, messageId);
      }
    } catch (msgErr) {
      console.error('[telegramWebhook Failed sending error back]', msgErr.message);
    }
    return res.status(200).json({ success: false, error: err.message });
  }
}
