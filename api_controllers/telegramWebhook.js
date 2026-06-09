import { createClient } from '@supabase/supabase-js';
import createMovimiento from './createMovimiento.js';
import createConsumoTC from './createConsumoTC.js';
import createConsumoCC from './createConsumoCC.js';
import createAhorro from './createAhorro.js';
import createInversion from './createInversion.js';


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

async function callGemini(key, modelName, systemInstruction, history, responseMimeType = null) {
  const payload = {
    contents: history
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
    const geminiKey = process.env.GEMINI_API_KEY;
    
    if (!supabaseUrl || !serviceKey || !geminiKey) {
      await sendTelegramMessage(botToken, chatId, '⚠️ Error de configuración: Supabase o Gemini no configurado.', messageId);
      return res.status(200).json({ success: false, error: 'Configs missing' });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Support canceling or restarting conversation session
    if (messageText.toLowerCase() === 'cancelar' || messageText.toLowerCase() === 'reiniciar' || messageText.toLowerCase() === '/cancel') {
      try {
        await supabase.from('bot_sessions').delete().eq('chat_id', String(chatId));
      } catch (err) {}
      await sendTelegramMessage(botToken, chatId, '🔄 Conversación reiniciada. ¿Qué quieres registrar?', messageId);
      return res.status(200).json({ success: true, message: 'Session reset' });
    }

    const [cuentasRes, categoriasRes, tarjetasRes, contactosRes, subcuentasRes] = await Promise.all([
      supabase.from('cuentas_principales').select('id_cuenta_principal,nombre,moneda_principal,es_predeterminada').eq('activa', true),
      supabase.from('categorias').select('id_categoria,nombre,tipo_mov').eq('activa', true),
      supabase.from('tarjetas').select('id_tarjeta,nombre,banco,ultimos_4_digitos,id_cuenta_principal').eq('activa', true),
      supabase.from('cta_corriente_usuarios').select('id_usuario,nombre'),
      supabase.from('ahorro_subcuentas').select('id_subcuenta,nombre,moneda,id_cuenta_principal')
    ]);

    if (cuentasRes.error || categoriasRes.error || tarjetasRes.error || contactosRes.error) {
      throw new Error('Error al consultar tablas maestras en Supabase.');
    }

    const cuentas = cuentasRes.data || [];
    const categorias = categoriasRes.data || [];
    const tarjetas = tarjetasRes.data || [];
    const contactos = contactosRes.data || [];
    const subcuentas = subcuentasRes?.data || [];

    const todayStr = new Date().toISOString().split('T')[0];

    // Build instruction prompt for Gemini
    const systemInstruction = `
Eres un asistente de conversación y carga de transacciones financieras en español. Tu tarea es guiar al usuario paso a paso para completar la carga de gastos, ingresos, consumos en tarjetas de crédito, gastos compartidos (CC), ahorros o inversiones, u ofrecer información de la base de datos de manera amigable.

A continuación, se presenta la lista de registros activos en la base de datos:

Cuentas principales disponibles:
${JSON.stringify(cuentas.map(c => ({ id: c.id_cuenta_principal, nombre: c.nombre, moneda: c.moneda_principal, predeterminada: c.es_predeterminada })))}

Categorías disponibles:
${JSON.stringify(categorias.map(c => ({ id: c.id_categoria, nombre: c.nombre, tipo_mov: c.tipo_mov })))}

Tarjetas de crédito disponibles:
${JSON.stringify(tarjetas.map(t => ({ id: t.id_tarjeta, nombre: t.nombre, banco: t.banco, ultimos4: t.ultimos_4_digitos, idCuentaImputar: t.id_cuenta_principal })))}

Contactos (cuenta corriente) disponibles:
${JSON.stringify(contactos.map(u => ({ id: u.id_usuario, nombre: u.nombre })))}

Subcuentas de ahorro (Chanchitos) disponibles:
${JSON.stringify(subcuentas.map(s => ({ id: s.id_subcuenta, nombre: s.nombre, moneda: s.moneda, idCuentaPrincipal: s.id_cuenta_principal })))}

Fecha de referencia: ${todayStr} (Año-Mes-Día)

COMPORTAMIENTO DE DIÁLOGO GUIADO (MUY IMPORTANTE):
1. Si el usuario te indica registrar un movimiento (gasto/ingreso), ahorro, inversión o consumo con tarjeta pero la información está INCOMPLETA, no asumas defaults. Debes responder de forma conversacional indicando opciones del sistema y solicitando lo que falta:
   - Para movimientos (ingreso/egreso común): requiere saber la cuenta principal, si es recurrente o simple, y si desea hacer split (distribuir con otra cuenta principal).
     - Si es recurrente: pregunta frecuencia (MENSUAL, BIMESTRAL, TRIMESTRAL, SEMESTRAL, ANUAL) y períodos (cuántos meses/ciclos).
     - Si desea hacer split: pregunta con qué cuenta principal desea hacer split y en qué porcentaje.
   - Para consumos de tarjeta de crédito (tarjeta): requiere saber qué tarjeta, si es en 1 pago, cuotas o recurrente.
     - Si es en cuotas: pregunta en cuántas cuotas.
     - Si es recurrente: pregunta durante cuántos meses.
   - Para ahorros (ahorro): requiere saber el chanchito de destino (subcuenta), cuenta de origen, importe, moneda, y si es un depósito o extracción.
   - Para inversiones (inversion): requiere saber si es compra o venta, ticker, cantidad nominal, precio unitario, moneda (ARS/USD), y cuenta/broker desde donde opera.
2. Si faltan datos clave, debes devolver el JSON con "tipo_registro": "conversational", listando las opciones de cuentas, tarjetas o chanchitos según el caso, y explicando amigablemente qué falta definir.
3. Solo cuando tengas todos los datos esenciales, devuelve el JSON estructurado correspondiente.

Tipos de registro disponibles:
- "movimiento": si cargas un ingreso/egreso de cuenta principal.
- "tarjeta": si cargas un consumo en tarjeta de crédito.
- "cc": si cargas un gasto compartido con un contacto.
- "ahorro": si cargas un depósito o extracción en un chanchito.
- "inversion": si cargas una compra o venta de activos (inversiones).
- "query": si el usuario consulta saldo, cartera, resumen, proyecciones.
- "update": si modifica o borra un registro previo.
- "conversational": si falta información o es una charla casual.

Formato de JSON a retornar:
{
  "tipo_registro": "movimiento" | "tarjeta" | "cc" | "ahorro" | "inversion" | "query" | "update" | "conversational",
  "reply_message": "Respuesta conversacional o pregunta amigable (solo cuando tipo_registro es conversational o query)",
  "payload": { ... campos del tipo elegido ... }
}

Estructura de "payload" por "tipo_registro":
- Si tipo_registro es "movimiento":
  {
    "idCuenta": "UUID de la cuenta principal",
    "fecha": "YYYY-MM-DD",
    "idCategoria": "UUID de la categoría",
    "tipo": "EGRESO" o "INGRESO",
    "descripcion": "Detalle conciso",
    "importe": número (monto total),
    "medioPago": "Efectivo", "Débito", "Transferencia" u "Otro",
    "tipoConsumo": "SIMPLE" | "RECURRENTE" | "CUOTAS",
    "frecuencia": "MENSUAL" | "BIMESTRAL" | "TRIMESTRAL" | "SEMESTRAL" | "ANUAL", // Solo si es RECURRENTE
    "periodos": número (total de repeticiones, ej: 12), // Solo si es RECURRENTE
    "cuotaActual": número, // Solo si es CUOTAS
    "cuotaTotal": número, // Solo si es CUOTAS
    "esSplit": boolean (si desea distribuir),
    "splitDestinos": [ // Solo si esSplit es true
      { "cuenta": "UUID de la cuenta destino", "pct": número (porcentaje de 1 a 100) }
    ]
  }
- Si tipo_registro es "tarjeta":
  {
    "idTarjeta": "UUID de la tarjeta",
    "idCuentaImputar": "UUID de la cuenta a imputar el pago de la tarjeta",
    "fecha": "YYYY-MM-DD",
    "idCategoria": "UUID de la categoría",
    "descripcion": "Detalle conciso",
    "importe": número,
    "tipoConsumo": "SIMPLE" | "CUOTAS" | "RECURRENTE",
    "cuotaActual": 1, // Si es en cuotas
    "cuotaTotal": número, // Si es en cuotas
    "periodos": número, // Si es recurrente
    "imputar": true
  }
- Si tipo_registro es "cc":
  {
    "idCuenta": "UUID de la cuenta principal",
    "idCategoria": "UUID de la categoría",
    "idUsuario": "UUID del contacto",
    "fecha": "YYYY-MM-DD",
    "descripcion": "Detalle",
    "importe": número,
    "pagador": "YO" | "CONTACTO",
    "porcentajeImputado": 50,
    "tipo": "SIMPLE" | "CUOTAS" | "RECURRENTE",
    "cuotaActual": 1, // Si es en cuotas
    "cuotaTotal": número, // Si es en cuotas
    "periodos": número // Si es recurrente
  }
- Si tipo_registro es "ahorro":
  {
    "idCuenta": "UUID de la cuenta principal origen/destino",
    "idSubcuenta": "UUID del chanchito de ahorro",
    "fecha": "YYYY-MM-DD",
    "tipo_transfer": "DEPOSITO" o "EXTRACCION",
    "moneda": "ARS" o "USD",
    "importe": número,
    "descripcion": "Detalle opcional"
  }
- Si tipo_registro es "inversion":
  {
    "idCuenta": "UUID de la cuenta principal/broker",
    "tipoOp": "COMPRA" o "VENTA",
    "fecha": "YYYY-MM-DD",
    "ticker": "Ticker del activo (ej. GGAL, AL30)",
    "moneda": "ARS" o "USD",
    "cantidad": número,
    "precio": número
  }
- Si tipo_registro es "query":
  {
    "intent": "resumen_mes" | "gastos_categoria" | "ultimos_movimientos" | "info_tarjetas" | "proyeccion" | "inversiones" | "ahorros",
    "idCuenta": "UUID de la cuenta (opcional)",
    "idCategoria": "UUID de la categoría (opcional)",
    "mes": "YYYY-MM" (opcional)
  }
- Si tipo_registro es "update":
  {
    "action": "modify" o "delete",
    "target_table": "movimientos" | "consumos_tc" | "cc_consumos",
    "search_term": "búsqueda por descripción",
    "updates": { ... campos modificables ... }
  }

IMPORTANTE: Devuelve únicamente un objeto JSON válido, sin Markdown (no uses bloques de código ni texto adicional).
`;

    // 3. Retrieve or initiate Bot Session History
    let history = [];
    let hasSessionTable = true;
    try {
      const { data: sessionData, error: sErr } = await supabase
        .from('bot_sessions')
        .select('history, updated_at')
        .eq('chat_id', String(chatId))
        .maybeSingle();

      if (!sErr && sessionData) {
        const lastUpdate = new Date(sessionData.updated_at);
        const diffMs = new Date() - lastUpdate;
        // Inactivity timeout: 20 minutes
        if (diffMs < 20 * 60 * 1000) {
          history = sessionData.history || [];
        }
      }
    } catch (e) {
      console.warn('[telegramWebhook] bot_sessions table does not exist. Running statelessly.');
      hasSessionTable = false;
    }

    // Append current message
    history.push({
      role: 'user',
      parts: [{ text: messageText }]
    });

    // Call Gemini with the conversation history
    const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    const contentText = await callGemini(geminiKey, modelName, systemInstruction, history, 'application/json');

    let parsedResult;
    try {
      parsedResult = JSON.parse(contentText);
    } catch (e) {
      console.error('[Gemini Parsing Error]', contentText);
      await sendTelegramMessage(botToken, chatId, '❌ Error: No se pudo interpretar la respuesta de la IA. Intenta de nuevo.', messageId);
      return res.status(200).json({ success: false, error: 'JSON parse error' });
    }

    // Handle conversational replies (saving state)
    if (parsedResult.tipo_registro === 'conversational') {
      const reply = parsedResult.reply_message || 'Hola, ¿en qué te puedo ayudar hoy?';
      await sendTelegramMessage(botToken, chatId, reply, messageId);
      
      if (hasSessionTable) {
        history.push({
          role: 'model',
          parts: [{ text: contentText }]
        });
        try {
          await supabase.from('bot_sessions').upsert({
            chat_id: String(chatId),
            history: history,
            updated_at: new Date().toISOString()
          });
        } catch (e) {
          console.error('[telegramWebhook session save error]', e.message);
        }
      }
      return res.status(200).json({ success: true, type: 'conversational' });
    }

    // Clear session on successful transactional load, update or query
    if (hasSessionTable) {
      try {
        await supabase.from('bot_sessions').delete().eq('chat_id', String(chatId));
      } catch (err) {}
    }

    // Handle user queries (ida y vuelta / pass info of the app)
    if (parsedResult.tipo_registro === 'query') {
      const payload = parsedResult.payload || parsedResult;
      const intent = payload.intent || 'resumen_mes';
      let fetchedDataContext = '';
      
      if (intent === 'resumen_mes') {
        const month = payload.mes || todayStr.substring(0, 7);
        const accountId = payload.idCuenta || cuentas.find(c => c.es_predeterminada)?.id_cuenta_principal || cuentas[0]?.id_cuenta_principal;
        
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
- Balance Neto: $${totalIngresos - totalEgresos}
- Listado de movimientos del mes: ${JSON.stringify((movs || []).map(m => ({ fecha: m.fecha, desc: m.descripcion, monto: m.importe, tipo: m.tipo_mov, cat: m.categorias?.nombre })))}`;
        
      } else if (intent === 'gastos_categoria') {
        const month = payload.mes || todayStr.substring(0, 7);
        const accountId = payload.idCuenta || cuentas.find(c => c.es_predeterminada)?.id_cuenta_principal || cuentas[0]?.id_cuenta_principal;
        const catId = payload.idCategoria;
        
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
        
      } else if (intent === 'inversiones') {
        const accountId = payload.idCuenta || cuentas.find(c => c.es_predeterminada)?.id_cuenta_principal || cuentas[0]?.id_cuenta_principal;
        
        const { data: invMovs, error: invErr } = await supabase
          .from('inversiones_movimientos')
          .select('*, movimientos!inner(id_cuenta_principal, descripcion, fecha)')
          .eq('movimientos.id_cuenta_principal', accountId);
          
        if (invErr) throw invErr;
        
        const holdings = {};
        (invMovs || []).forEach(m => {
          const t = m.ticker.toUpperCase();
          if (!holdings[t]) {
            holdings[t] = { cantidad: 0, invertidoArs: 0, moneda: m.moneda };
          }
          if (m.tipo_operacion === 'COMPRA') {
            holdings[t].cantidad += Number(m.cantidad_nominales);
            holdings[t].invertidoArs += Number(m.importe_total_ars);
          } else {
            holdings[t].cantidad -= Number(m.cantidad_nominales);
            holdings[t].invertidoArs -= Number(m.importe_total_ars);
          }
        });
        
        const activeHoldings = Object.entries(holdings)
          .filter(([_, h]) => h.cantidad > 0.0001)
          .map(([ticker, h]) => ({
            ticker,
            cantidad: h.cantidad,
            promedioCompra: h.cantidad > 0 ? (h.invertidoArs / h.cantidad) : 0,
            moneda: h.moneda,
            totalInvertidoArs: h.invertidoArs
          }));
          
        fetchedDataContext = `Datos reales de inversiones en cartera para la cuenta "${cuentas.find(c => c.id_cuenta_principal === accountId)?.nombre || 'Principal'}":
- Posiciones activas: ${JSON.stringify(activeHoldings)}
- Historial reciente de operaciones de inversión: ${JSON.stringify((invMovs || []).slice(-10).map(m => ({ fecha: m.fecha, ticker: m.ticker, op: m.tipo_operacion, cant: m.cantidad_nominales, precio: m.precio_compra, moneda: m.moneda, totalArs: m.importe_total_ars })))}`;

      } else if (intent === 'ahorros') {
        const accountId = payload.idCuenta || cuentas.find(c => c.es_predeterminada)?.id_cuenta_principal || cuentas[0]?.id_cuenta_principal;
        
        const { data: subcuentasList, error: scErr } = await supabase
          .from('ahorro_subcuentas')
          .select('*')
          .eq('id_cuenta_principal', accountId);
          
        if (scErr) throw scErr;
        
        const subIds = (subcuentasList || []).map(s => s.id_subcuenta);
        let transferencias = [];
        if (subIds.length > 0) {
          const { data: tfData, error: tfErr } = await supabase
            .from('ahorros')
            .select('*')
            .in('id_subcuenta', subIds);
          if (tfErr) throw tfErr;
          transferencias = tfData || [];
        }
        
        const balances = (subcuentasList || []).map(sc => {
          let saldo = 0;
          transferencias.forEach(t => {
            if (t.id_subcuenta === sc.id_subcuenta) {
              saldo += t.tipo_transfer === 'DEPOSITO' ? Number(t.importe || 0) : -Number(t.importe || 0);
            }
          });
          return {
            nombre: sc.nombre,
            moneda: sc.moneda,
            saldo: saldo
          };
        });
        
        fetchedDataContext = `Saldos actuales de tus chanchitos de ahorro en la cuenta "${cuentas.find(c => c.id_cuenta_principal === accountId)?.nombre || 'Principal'}":
- Detalle de ahorros por subcuenta: ${JSON.stringify(balances)}`;

      } else {
        fetchedDataContext = `No se pudo determinar el tipo de consulta.`;
      }
      
      const answerText = await callGemini(
        geminiKey, 
        modelName, 
        null, 
        [{
          role: 'user',
          parts: [{
            text: `El usuario de Telegram preguntó: "${messageText}".\n\nAquí tienes la información real extraída de la base de datos de Supabase:\n\n${fetchedDataContext}\n\nResponde directamente al usuario de manera clara, amigable y resumida en español. Utiliza viñetas y etiquetas HTML (como <b> para negritas y <code> para montos de dinero o fechas) para formatear tu respuesta. No uses bloques de código markdown.`
          }]
        }]
      );
      
      await sendTelegramMessage(botToken, chatId, answerText, messageId);
      return res.status(200).json({ success: true, type: 'query_answered' });
    }

    // Handle modification and deletion updates directly
    if (parsedResult.tipo_registro === 'update') {
      const payload = parsedResult.payload || parsedResult;
      const { action, target_table, search_term, updates } = payload;
      
      const accountId = cuentas.find(c => c.es_predeterminada)?.id_cuenta_principal || cuentas[0]?.id_cuenta_principal;
      const idColumn = target_table === 'movimientos' 
        ? 'id_movimiento' 
        : (target_table === 'consumos_tc' ? 'id_consumo_tarjeta' : 'id_cc_consumo');
      
      let catId = null;
      if (search_term) {
        const matchedCat = categorias.find(c => c.nombre.toLowerCase().includes(search_term.toLowerCase()));
        if (matchedCat) {
          catId = matchedCat.id_categoria;
        }
      }

      let query = supabase.from(target_table).select('*');
      if (target_table === 'movimientos' || target_table === 'cc_consumos') {
        query = query.eq('id_cuenta_principal', accountId);
      }
      
      if (search_term) {
        if (catId) {
          query = query.or(`descripcion.ilike.%${search_term}%,id_categoria.eq.${catId}`);
        } else {
          query = query.ilike('descripcion', `%${search_term}%`);
        }
      }
      
      const { data: rows, error: selErr } = await query.order('fecha', { ascending: false }).limit(1);
      if (selErr) throw selErr;

      if (rows && rows.length > 0) {
        const row = rows[0];
        const rowId = row[idColumn];
        
        if (action === 'delete') {
          const { error: delErr } = await supabase.from(target_table).delete().eq(idColumn, rowId);
          if (delErr) throw delErr;
          
          await sendTelegramMessage(
            botToken, 
            chatId, 
            `🗑️ <b>Eliminado con éxito</b>\n\nSe borró el registro de <b>${row.descripcion}</b> por <code>$${Math.abs(Number(row.importe))}</code> (Fecha: <code>${row.fecha}</code>).`, 
            messageId
          );
          return res.status(200).json({ success: true, type: 'record_deleted' });
        } else {
          const mappedUpdates = {};
          if (updates.importe !== undefined) mappedUpdates.importe = updates.importe;
          if (updates.descripcion !== undefined) mappedUpdates.descripcion = updates.descripcion;
          if (updates.fecha !== undefined) mappedUpdates.fecha = updates.fecha;
          if (updates.idCategoria !== undefined) mappedUpdates.id_categoria = updates.idCategoria;
          
          const { error: updErr } = await supabase.from(target_table).update(mappedUpdates).eq(idColumn, rowId);
          if (updErr) throw updErr;
          
          let changesText = '';
          if (mappedUpdates.importe !== undefined) {
            changesText += `💵 Importe: <code>$${Math.abs(Number(row.importe))}</code> ➡️ <code>$${mappedUpdates.importe}</code>\n`;
          }
          if (mappedUpdates.descripcion !== undefined) {
            changesText += `📄 Concepto: "<i>${row.descripcion}</i>" ➡️ "<i>${mappedUpdates.descripcion}</i>"\n`;
          }
          if (mappedUpdates.fecha !== undefined) {
            changesText += `📅 Fecha: <code>${row.fecha}</code> ➡️ <code>${mappedUpdates.fecha}</code>\n`;
          }
          if (mappedUpdates.id_categoria !== undefined) {
            const oldCatName = categorias.find(c => c.id_categoria === row.id_categoria)?.nombre || 'Desconocida';
            const newCatName = categorias.find(c => c.id_categoria === mappedUpdates.id_categoria)?.nombre || 'Desconocida';
            changesText += `📂 Categoría: <b>${oldCatName}</b> ➡️ <b>${newCatName}</b>\n`;
          }
          
          await sendTelegramMessage(
            botToken, 
            chatId, 
            `✅ <b>Modificado con éxito</b>\n\nSe actualizó el registro de <b>${mappedUpdates.descripcion || row.descripcion}</b>:\n${changesText}`, 
            messageId
          );
          return res.status(200).json({ success: true, type: 'record_updated' });
        }
      } else {
        await sendTelegramMessage(
          botToken, 
          chatId, 
          `⚠️ No se encontró ningún registro reciente ${search_term ? `que coincida con "${search_term}"` : ''} para modificar o eliminar.`, 
          messageId
        );
        return res.status(200).json({ success: false, error: 'Record not found' });
      }
    }

    // Handle transactional loads
    let payload = parsedResult.payload;
    if (!payload && parsedResult.tipo_registro && parsedResult.tipo_registro !== 'conversational') {
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
    } else if (parsedResult.tipo_registro === 'ahorro') {
      const scName = subcuentas.find(s => s.id_subcuenta === payload.idSubcuenta)?.nombre || 'Desconocida';
      const ctaName = cuentas.find(c => c.id_cuenta_principal === payload.idCuenta)?.nombre || 'Desconocida';
      
      detailText = `🐷 <b>Registro de Ahorro (Chanchito)</b>\n` +
                   `💵 Importe: ${payload.moneda} ${payload.importe}\n` +
                   `🐷 Chanchito: ${scName}\n` +
                   `💼 Cuenta Origen: ${ctaName}\n` +
                   `🔄 Operación: ${payload.tipo_transfer === 'DEPOSITO' ? 'Depósito' : 'Extracción'}\n` +
                   `📄 Detalle: ${payload.descripcion || ''}\n` +
                   `📅 Fecha: ${payload.fecha}`;
                   
      await createAhorro(mockReq, mockRes);
    } else if (parsedResult.tipo_registro === 'inversion') {
      const ctaName = cuentas.find(c => c.id_cuenta_principal === payload.idCuenta)?.nombre || 'Desconocida';
      
      detailText = `📈 <b>Operación de Inversión</b>\n` +
                   `💵 Importe: ${payload.moneda} ${payload.cantidad * payload.precio}\n` +
                   `📈 Activo: ${payload.ticker}\n` +
                   `📊 Cantidad: ${payload.cantidad} @ ${payload.moneda} ${payload.precio}\n` +
                   `💼 Cuenta/Broker: ${ctaName}\n` +
                   `🔄 Operación: ${payload.tipoOp === 'COMPRA' ? 'Compra' : 'Venta'}\n` +
                   `📅 Fecha: ${payload.fecha}`;
                   
      await createInversion(mockReq, mockRes);
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
