import { createClient } from '@supabase/supabase-js';
import createMovimiento from './createMovimiento.js';
import createConsumoTC from './createConsumoTC.js';
import createConsumoCC from './createConsumoCC.js';

async function sendTelegramMessage(token, chatId, text, replyToMessageId = null) {
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
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
      // Just acknowledge non-message updates (like edited messages or inline queries)
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
Eres un asistente de parsing financiero en español. Tu tarea es extraer la información de transacciones enviadas por el usuario y formatearla en un objeto JSON estructurado que coincida con las APIs de nuestro sistema de finanzas.

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
1. Determina el "tipo_registro" de la transacción:
   - "tarjeta": si menciona explícitamente pagar con una tarjeta de crédito, o si se detecta un consumo en cuotas con tarjeta (ej. "en la Visa", "con la Amex", "3 cuotas de la tarjeta").
   - "cc": si se menciona que es un gasto a compartir con un contacto, o que lo pagó un contacto (ej. "pagó Bichi 5000", "gasto con Bichi de 2000").
   - "movimiento": si es un gasto común en efectivo, débito, transferencia, o si es un ingreso (ej. "pagué nafta 5000", "ingreso sueldo 20000").
   - "conversational": si no es una transacción sino un saludo, pregunta o comentario general.

2. Mapeo inteligente de entidades:
   - Categoría: Selecciona el "id" de la categoría que mejor corresponda semánticamente (ej: "nafta" o "combustible" -> "Servicios (Luz, Gas, Int.)" o la categoría más cercana, "comida" -> "Supermercado").
   - Tarjeta: Selecciona el "id" de la tarjeta si es un consumo de tarjeta.
   - Cuenta: Selecciona el "id" de la cuenta para movimientos. Si el usuario no especifica qué cuenta usó, selecciona el ID de la cuenta que está marcada como predeterminada ("predeterminada": true), o la primera de la lista.
   - Contacto: Para transacciones tipo "cc", mapea al "id" del contacto correspondiente.

3. Formato de payload según tipo_registro:
   - Para "movimiento":
     {
       "idCuenta": "id de la cuenta elegida",
       "fecha": "fecha de la transacción en formato YYYY-MM-DD",
       "idCategoria": "id de la categoría elegida",
       "tipo": "EGRESO" o "INGRESO",
       "descripcion": "Descripción concisa del gasto/ingreso",
       "importe": número (monto total de la transacción),
       "medioPago": "Efectivo", "Débito", "Transferencia" u "Otro",
       "tipoConsumo": "SIMPLE"
     }
   - Para "tarjeta":
     {
       "idTarjeta": "id de la tarjeta elegida",
       "idCuentaImputar": "idCuentaImputar de la tarjeta elegida",
       "fecha": "fecha de la transacción en formato YYYY-MM-DD",
       "idCategoria": "id de la categoría elegida",
       "descripcion": "Descripción concisa",
       "importe": número (monto total o de la cuota según corresponda),
       "tipoConsumo": "COMUN" o "CUOTAS",
       "cuotaActual": 1, // Si es en cuotas
       "cuotaTotal": cantidad total de cuotas, // Si es en cuotas, ej: "en 3 cuotas" -> cuotaTotal: 3, cuotaActual: 1.
       "imputar": true
     }
   - Para "cc":
     {
       "idCuenta": "id de la cuenta predeterminada",
       "idCategoria": "id de la categoría elegida",
       "idUsuario": "id del contacto elegido",
       "fecha": "fecha de la transacción en formato YYYY-MM-DD",
       "descripcion": "Descripción concisa",
       "importe": número (monto total del gasto compartido),
       "pagador": "YO" (si lo pagó el usuario) o "CONTACTO" (si lo pagó el contacto),
       "porcentajeImputado": 50, // porcentaje que asume el usuario. Si el usuario pagó todo y le deben la mitad, porcentajeImputado es 50. Por defecto 50 si no se indica.
       "tipo": "SIMPLE"
     }
   - Para "conversational":
     {
       "reply_message": "Una respuesta cordial o aclaración en español pidiendo más detalles para registrar un gasto."
     }

IMPORTANTE: Devuelve únicamente un objeto JSON válido, sin Markdown (no uses bloques de código \`\`\`json ni texto adicional).
`;

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Error: La API Key de Gemini no está configurada.', messageId);
      return res.status(200).json({ success: false, error: 'GEMINI_API_KEY not configured' });
    }

    const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: systemInstruction + `\n\nMensaje del usuario: "${messageText}"`
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const geminiResult = await response.json();
    const contentText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!contentText) {
      throw new Error('Gemini no devolvió ninguna respuesta.');
    }

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

    const payload = parsedResult.payload;
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
      
      detailText = `📝 *Gasto/Ingreso Común*\n` +
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
      
      detailText = `💳 *Consumo con Tarjeta*\n` +
                   `💵 Importe: $${payload.importe}${cuotaInfo}\n` +
                   `💳 Tarjeta: ${cardName}\n` +
                   `📂 Categoría: ${catName}\n` +
                   `📄 Detalle: ${payload.descripcion}\n` +
                   `📅 Fecha: ${payload.fecha}`;
                   
      await createConsumoTC(mockReq, mockRes);
    } else if (parsedResult.tipo_registro === 'cc') {
      const contactName = contactos.find(u => u.id_usuario === payload.idUsuario)?.nombre || 'Desconocido';
      const catName = categorias.find(c => c.id_categoria === payload.idCategoria)?.nombre || 'Desconocida';
      
      detailText = `👥 *Gasto Compartido*\n` +
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
      const successMsg = `✅ *Cargado con éxito*\n\n${detailText}`;
      await sendTelegramMessage(botToken, chatId, successMsg, messageId);
      return res.status(200).json({ success: true, data: responseData });
    } else {
      const errMsg = responseData?.error || 'Error desconocido al insertar en base de datos.';
      await sendTelegramMessage(botToken, chatId, `❌ *Error al cargar transacción*\n\n${errMsg}`, messageId);
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
        await sendTelegramMessage(botToken, chatId, `❌ *Error interno en el bot*\n\n${err.message}`, messageId);
      }
    } catch (msgErr) {
      console.error('[telegramWebhook Failed sending error back]', msgErr.message);
    }
    return res.status(200).json({ success: false, error: err.message });
  }
}
