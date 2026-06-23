import { createClient } from '@supabase/supabase-js';
import createMovimiento from './createMovimiento.js';
import createConsumoTC from './createConsumoTC.js';
import createConsumoCC from './createConsumoCC.js';
import createAhorro from './createAhorro.js';
import createInversion from './createInversion.js';


async function downloadTelegramFile(botToken, fileId) {
  const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
  if (!fileRes.ok) throw new Error(`Error al obtener info de archivo: ${fileRes.status}`);
  const fileJson = await fileRes.json();
  if (!fileJson.ok || !fileJson.result?.file_path) throw new Error('Telegram no devolvió la ruta del archivo.');
  const filePath = fileJson.result.file_path;
  const downloadRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
  if (!downloadRes.ok) throw new Error(`Error al descargar archivo: ${downloadRes.status}`);
  const arrayBuffer = await downloadRes.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('base64');
}

async function registerConsumo(supabaseKey, consumoData) {
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
    body: consumoData,
    headers: {
      authorization: 'Bearer ' + supabaseKey
    }
  };

  await createConsumoTC(mockReq, mockRes);
  if (responseStatus !== 200 || !responseData?.success) {
    throw new Error(responseData?.error || 'Error al guardar consumo con tarjeta.');
  }
  return responseData;
}


async function sendTelegramMessage(token, chatId, text, replyToMessageId = null, replyMarkup = null) {
  let cleanText = text || '';
  if (typeof cleanText === 'string') {
    cleanText = cleanText
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<p>/gi, '')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<ul>/gi, '')
      .replace(/<\/ul>/gi, '')
      .replace(/<li>/gi, '• ')
      .replace(/<\/li>/gi, '\n')
      .trim();
  }

  const body = {
    chat_id: chatId,
    text: cleanText,
    parse_mode: 'HTML'
  };
  if (replyToMessageId) {
    body.reply_to_message_id = replyToMessageId;
  }
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
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

async function showFinalSummary(res, token, chatId, messageId, wizardState, cuentas, cardName, newCons, conflicts, saveState) {
  wizardState.step = 'FINAL_CONFIRM';
  const defaultAccount = cuentas.find(c => c.id_cuenta_principal === wizardState.selected_account_id);
  
  let numModify = 0;
  let numNew = 0;
  let numIgnore = 0;
  Object.values(wizardState.conflict_resolutions).forEach(res => {
    if (res === 'MODIFY') numModify++;
    else if (res === 'NEW') numNew++;
    else if (res === 'IGNORE') numIgnore++;
  });

  const reply = `📋 <b>Confirmar Carga de Resumen:</b>\n\n` +
                `💳 Tarjeta: <b>${cardName}</b>\n` +
                `🏦 Cuenta principal por defecto: <b>${defaultAccount?.nombre || '—'}</b>\n\n` +
                `🆕 Consumos Nuevos a registrar: <code>${newCons.length}</code>\n` +
                `🔄 Consumos a Modificar: <code>${numModify}</code>\n` +
                `➕ Consumos conflictivos a agregar como nuevos: <code>${numNew}</code>\n` +
                `🚫 Consumos a ignorar: <code>${numIgnore}</code>\n\n` +
                `¿Deseas impactar estos cambios en la base de datos?`;

  const replyMarkup = {
    keyboard: [
      [{ text: 'Confirmar Carga' }],
      [{ text: 'Cancelar' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  };

  await sendTelegramMessage(token, chatId, reply, messageId, replyMarkup);
  await saveState();
  return res.status(200).json({ success: true });
}

async function handleWizardStep(req, res, supabase, token, chatId, messageId, wizardState, text, cuentas, tarjetas, hasSessionTable, updateId, serviceKey) {
  const step = wizardState.step;
  const payload = wizardState.pdf_payload;
  const matchedCard = tarjetas.find(t => t.id_tarjeta === payload.card_info.id_tarjeta);
  const cardName = matchedCard ? matchedCard.nombre : (payload.card_info.nombre || 'Tarjeta');
  const newCons = payload.new_consumptions || [];
  const conflicts = payload.similar_different || [];

  const saveState = async () => {
    if (hasSessionTable) {
      const savedHistory = [
        { role: 'system_metadata', parts: [{ text: updateId || '' }] },
        { role: 'wizard_state', parts: [{ text: JSON.stringify(wizardState) }] }
      ];
      await supabase.from('bot_sessions').upsert({
        chat_id: String(chatId),
        history: savedHistory,
        updated_at: new Date().toISOString()
      });
    }
  };

  if (step === 'ASK_ACCOUNT') {
    const selectedAccount = cuentas.find(c => c.nombre.toLowerCase().trim() === text.toLowerCase().trim());
    if (!selectedAccount) {
      const reply = `⚠️ <b>Cuenta no válida.</b> Por favor, selecciona una de las cuentas disponibles:`;
      const replyMarkup = {
        keyboard: [
          cuentas.map(c => ({ text: c.nombre })),
          [{ text: 'Cancelar' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      await sendTelegramMessage(token, chatId, reply, messageId, replyMarkup);
      return res.status(200).json({ success: true, message: 'Invalid account name' });
    }

    wizardState.selected_account_id = selectedAccount.id_cuenta_principal;

    if (newCons.length > 0) {
      wizardState.step = 'ASK_IMPUTATION_CHOICE';
      const reply = `¿Deseas imputar todos los <b>${newCons.length} consumos nuevos</b> a la cuenta <b>${selectedAccount.nombre}</b> o prefieres personalizar la imputación uno por uno?`;
      const replyMarkup = {
        keyboard: [
          [{ text: `Todos a ${selectedAccount.nombre}` }, { text: 'Personalizar uno por uno' }],
          [{ text: 'Cancelar' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      await sendTelegramMessage(token, chatId, reply, messageId, replyMarkup);
      await saveState();
      return res.status(200).json({ success: true });
    } else if (conflicts.length > 0) {
      wizardState.step = 'ASK_CONFLICT';
      wizardState.current_conflict_index = 0;
      const conflict = conflicts[0];
      const reply = `[Conflicto 1 de ${conflicts.length}]\n` +
                    `El consumo <b>"${conflict.statement_record.descripcion}"</b> de <b>$${conflict.statement_record.importe.toLocaleString('es-AR')}</b> ya figura en la base de datos como <b>$${conflict.db_record.importe.toLocaleString('es-AR')}</b>.\n\n` +
                    `¿Qué deseas hacer con este consumo?`;
      const replyMarkup = {
        keyboard: [
          [{ text: 'Modificar existente' }, { text: 'Agregar como nuevo' }],
          [{ text: 'Ignorar este consumo' }, { text: 'Cancelar' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      await sendTelegramMessage(token, chatId, reply, messageId, replyMarkup);
      await saveState();
      return res.status(200).json({ success: true });
    } else {
      wizardState.step = 'FINAL_CONFIRM';
      const reply = `📋 <b>Resumen de importación:</b>\n\n` +
                    `💳 Tarjeta: <b>${cardName}</b>\n` +
                    `🏦 Cuenta de imputación: <b>${selectedAccount.nombre}</b>\n` +
                    `🔍 No se detectaron consumos nuevos ni modificaciones.\n\n` +
                    `¿Deseas finalizar la carga?`;
      const replyMarkup = {
        keyboard: [
          [{ text: 'Confirmar Carga' }],
          [{ text: 'Cancelar' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      await sendTelegramMessage(token, chatId, reply, messageId, replyMarkup);
      await saveState();
      return res.status(200).json({ success: true });
    }
  }

  if (step === 'ASK_IMPUTATION_CHOICE') {
    const isBulk = text.toLowerCase().includes('todos a');
    const isIndividual = text.toLowerCase().includes('personalizar');

    if (!isBulk && !isIndividual) {
      const selectedAccount = cuentas.find(c => c.id_cuenta_principal === wizardState.selected_account_id);
      const reply = `⚠️ Opción no válida. Por favor, selecciona una de las opciones:`;
      const replyMarkup = {
        keyboard: [
          [{ text: `Todos a ${selectedAccount.nombre}` }, { text: 'Personalizar uno por uno' }],
          [{ text: 'Cancelar' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      await sendTelegramMessage(token, chatId, reply, messageId, replyMarkup);
      return res.status(200).json({ success: true });
    }

    if (isBulk) {
      // Assign all new consumptions to the default selected account
      for (let i = 0; i < newCons.length; i++) {
        wizardState.imputations[i] = wizardState.selected_account_id;
      }
      
      // Move to conflicts
      if (conflicts.length > 0) {
        wizardState.step = 'ASK_CONFLICT';
        wizardState.current_conflict_index = 0;
        const conflict = conflicts[0];
        const reply = `[Conflicto 1 de ${conflicts.length}]\n` +
                      `El consumo <b>"${conflict.statement_record.descripcion}"</b> de <b>$${conflict.statement_record.importe.toLocaleString('es-AR')}</b> ya figura en la base de datos como <b>$${conflict.db_record.importe.toLocaleString('es-AR')}</b>.\n\n` +
                      `¿Qué deseas hacer con este consumo?`;
        const replyMarkup = {
          keyboard: [
            [{ text: 'Modificar existente' }, { text: 'Agregar como nuevo' }],
            [{ text: 'Ignorar este consumo' }, { text: 'Cancelar' }]
          ],
          resize_keyboard: true,
          one_time_keyboard: true
        };
        await sendTelegramMessage(token, chatId, reply, messageId, replyMarkup);
        await saveState();
        return res.status(200).json({ success: true });
      } else {
        return await showFinalSummary(res, token, chatId, messageId, wizardState, cuentas, cardName, newCons, conflicts, saveState);
      }
    } else {
      // Start individual personalization
      wizardState.step = 'ASK_IMPUTATION_INDIVIDUAL';
      wizardState.current_consumption_index = 0;
      const cons = newCons[0];
      const reply = `[Consumo 1 de ${newCons.length}]\n` +
                    `¿A qué cuenta deseas imputar el consumo <b>"${cons.descripcion}"</b> por <b>$${cons.importe.toLocaleString('es-AR')}</b>?`;
      const replyMarkup = {
        keyboard: [
          cuentas.map(c => ({ text: c.nombre })),
          [{ text: 'Cancelar' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      await sendTelegramMessage(token, chatId, reply, messageId, replyMarkup);
      await saveState();
      return res.status(200).json({ success: true });
    }
  }

  if (step === 'ASK_IMPUTATION_INDIVIDUAL') {
    const selectedAccount = cuentas.find(c => c.nombre.toLowerCase().trim() === text.toLowerCase().trim());
    if (!selectedAccount) {
      const index = wizardState.current_consumption_index;
      const cons = newCons[index];
      const reply = `⚠️ Cuenta no válida. ¿A qué cuenta deseas imputar el consumo <b>"${cons.descripcion}"</b> por <b>$${cons.importe.toLocaleString('es-AR')}</b>?`;
      const replyMarkup = {
        keyboard: [
          cuentas.map(c => ({ text: c.nombre })),
          [{ text: 'Cancelar' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      await sendTelegramMessage(token, chatId, reply, messageId, replyMarkup);
      return res.status(200).json({ success: true });
    }

    const index = wizardState.current_consumption_index;
    wizardState.imputations[index] = selectedAccount.id_cuenta_principal;

    if (index + 1 < newCons.length) {
      wizardState.current_consumption_index++;
      const nextIndex = index + 1;
      const cons = newCons[nextIndex];
      const reply = `[Consumo ${nextIndex + 1} de ${newCons.length}]\n` +
                    `¿A qué cuenta deseas imputar el consumo <b>"${cons.descripcion}"</b> por <b>$${cons.importe.toLocaleString('es-AR')}</b>?`;
      const replyMarkup = {
        keyboard: [
          cuentas.map(c => ({ text: c.nombre })),
          [{ text: 'Cancelar' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      await sendTelegramMessage(token, chatId, reply, messageId, replyMarkup);
      await saveState();
      return res.status(200).json({ success: true });
    } else {
      // Checked all new consumptions
      if (conflicts.length > 0) {
        wizardState.step = 'ASK_CONFLICT';
        wizardState.current_conflict_index = 0;
        const conflict = conflicts[0];
        const reply = `[Conflicto 1 de ${conflicts.length}]\n` +
                      `El consumo <b>"${conflict.statement_record.descripcion}"</b> de <b>$${conflict.statement_record.importe.toLocaleString('es-AR')}</b> ya figura en la base de datos como <b>$${conflict.db_record.importe.toLocaleString('es-AR')}</b>.\n\n` +
                      `¿Qué deseas hacer con este consumo?`;
        const replyMarkup = {
          keyboard: [
            [{ text: 'Modificar existente' }, { text: 'Agregar como nuevo' }],
            [{ text: 'Ignorar este consumo' }, { text: 'Cancelar' }]
          ],
          resize_keyboard: true,
          one_time_keyboard: true
        };
        await sendTelegramMessage(token, chatId, reply, messageId, replyMarkup);
        await saveState();
        return res.status(200).json({ success: true });
      } else {
        return await showFinalSummary(res, token, chatId, messageId, wizardState, cuentas, cardName, newCons, conflicts, saveState);
      }
    }
  }

  if (step === 'ASK_CONFLICT') {
    let resolution = null;
    const lowerText = text.toLowerCase();
    if (lowerText.includes('modificar')) resolution = 'MODIFY';
    else if (lowerText.includes('nuevo')) resolution = 'NEW';
    else if (lowerText.includes('ignorar')) resolution = 'IGNORE';

    const index = wizardState.current_conflict_index;
    const conflict = conflicts[index];

    if (!resolution) {
      const reply = `⚠️ Opción no válida. [Conflicto ${index + 1} de ${conflicts.length}]\n` +
                    `El consumo <b>"${conflict.statement_record.descripcion}"</b> de <b>$${conflict.statement_record.importe.toLocaleString('es-AR')}</b> ya figura en la base de datos como <b>$${conflict.db_record.importe.toLocaleString('es-AR')}</b>.\n\n` +
                    `¿Qué deseas hacer?`;
      const replyMarkup = {
        keyboard: [
          [{ text: 'Modificar existente' }, { text: 'Agregar como nuevo' }],
          [{ text: 'Ignorar este consumo' }, { text: 'Cancelar' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      await sendTelegramMessage(token, chatId, reply, messageId, replyMarkup);
      return res.status(200).json({ success: true });
    }

    wizardState.conflict_resolutions[index] = resolution;

    if (index + 1 < conflicts.length) {
      wizardState.current_conflict_index++;
      const nextIndex = index + 1;
      const nextConflict = conflicts[nextIndex];
      const reply = `[Conflicto ${nextIndex + 1} de ${conflicts.length}]\n` +
                    `El consumo <b>"${nextConflict.statement_record.descripcion}"</b> de <b>$${nextConflict.statement_record.importe.toLocaleString('es-AR')}</b> ya figura en la base de datos como <b>$${nextConflict.db_record.importe.toLocaleString('es-AR')}</b>.\n\n` +
                    `¿Qué deseas hacer con este consumo?`;
      const replyMarkup = {
        keyboard: [
          [{ text: 'Modificar existente' }, { text: 'Agregar como nuevo' }],
          [{ text: 'Ignorar este consumo' }, { text: 'Cancelar' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      await sendTelegramMessage(token, chatId, reply, messageId, replyMarkup);
      await saveState();
      return res.status(200).json({ success: true });
    } else {
      return await showFinalSummary(res, token, chatId, messageId, wizardState, cuentas, cardName, newCons, conflicts, saveState);
    }
  }

  if (step === 'FINAL_CONFIRM') {
    if (!text.toLowerCase().includes('confirmar')) {
      const reply = `⚠️ Por favor, selecciona una opción válida:`;
      const replyMarkup = {
        keyboard: [
          [{ text: 'Confirmar Carga' }],
          [{ text: 'Cancelar' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      await sendTelegramMessage(token, chatId, reply, messageId, replyMarkup);
      return res.status(200).json({ success: true });
    }

    await sendTelegramMessage(token, chatId, '⏳ <b>Procesando y guardando consumos en la base de datos...</b>', messageId);

    try {
      let newCount = 0;
      let updateCount = 0;
      let ignoredCount = 0;

      // 1. Process conflicts resolutions
      for (let i = 0; i < conflicts.length; i++) {
        const item = conflicts[i];
        const resolution = wizardState.conflict_resolutions[i] || 'MODIFY';

        if (resolution === 'MODIFY') {
          // Delete old record(s)
          const { db_record, statement_record } = item;
          if (db_record.recur_group_id) {
            const { error: delTC } = await supabase.from('consumos_tc').delete().eq('recur_group_id', db_record.recur_group_id);
            if (delTC) throw delTC;
            const { error: delMov } = await supabase.from('movimientos').delete().eq('recur_group_id', db_record.recur_group_id);
            if (delMov) throw delMov;
          } else {
            const { error: delTC } = await supabase.from('consumos_tc').delete().eq('id_consumo_tarjeta', db_record.id_consumo_tarjeta);
            if (delTC) throw delTC;
            const { error: delMov } = await supabase.from('movimientos').delete().eq('id_consumo_tarjeta_origen', db_record.id_consumo_tarjeta);
            if (delMov) throw delMov;
          }

          // Re-create updated series/item
          const payloadData = {
            idTarjeta: payload.card_info.id_tarjeta,
            idCuentaImputar: wizardState.selected_account_id,
            fecha: statement_record.fecha,
            idCategoria: statement_record.id_categoria,
            descripcion: statement_record.descripcion,
            importe: statement_record.importe,
            tipoConsumo: statement_record.cuota_total > 1 ? 'CUOTAS' : 'SIMPLE',
            cuotaActual: statement_record.cuota_actual || 1,
            cuotaTotal: statement_record.cuota_total || 1,
            imputar: true
          };

          await registerConsumo(serviceKey, payloadData);
          updateCount++;
        } else if (resolution === 'NEW') {
          const { statement_record } = item;
          const payloadData = {
            idTarjeta: payload.card_info.id_tarjeta,
            idCuentaImputar: wizardState.selected_account_id,
            fecha: statement_record.fecha,
            idCategoria: statement_record.id_categoria,
            descripcion: statement_record.descripcion,
            importe: statement_record.importe,
            tipoConsumo: statement_record.cuota_total > 1 ? 'CUOTAS' : 'SIMPLE',
            cuotaActual: statement_record.cuota_actual || 1,
            cuotaTotal: statement_record.cuota_total || 1,
            imputar: true
          };

          await registerConsumo(serviceKey, payloadData);
          newCount++;
        } else {
          ignoredCount++;
        }
      }

      // 2. Process new consumptions
      for (let i = 0; i < newCons.length; i++) {
        const item = newCons[i];
        const imputeAccount = wizardState.imputations[i] || wizardState.selected_account_id;

        const payloadData = {
          idTarjeta: payload.card_info.id_tarjeta,
          idCuentaImputar: imputeAccount,
          fecha: item.fecha,
          idCategoria: item.id_categoria,
          descripcion: item.descripcion,
          importe: item.importe,
          tipoConsumo: item.cuota_total > 1 ? 'CUOTAS' : 'SIMPLE',
          cuotaActual: item.cuota_actual || 1,
          cuotaTotal: item.cuota_total || 1,
          imputar: true
        };

        await registerConsumo(serviceKey, payloadData);
        newCount++;
      }

      // Clean up bot session
      if (hasSessionTable) {
        try {
          await supabase.from('bot_sessions').delete().eq('chat_id', String(chatId));
        } catch (err) {}
      }

      const successMsg = `✅ <b>Carga de resumen finalizada con éxito</b>\n\n` +
                         `💳 Tarjeta: <b>${cardName}</b>\n` +
                         `🆕 Nuevos consumos agregados: <code>${newCount}</code>\n` +
                         `🔄 Consumos modificados: <code>${updateCount}</code>\n` +
                         `🚫 Consumos omitidos: <code>${ignoredCount}</code>\n\n` +
                         `¡Los consumos y los movimientos se han registrado correctamente en las cuentas correspondientes!`;
      
      await sendTelegramMessage(token, chatId, successMsg, messageId, { remove_keyboard: true });
      return res.status(200).json({ success: true });

    } catch (err) {
      console.error('[telegramWebhook pdf wizard confirmation error]', err);
      await sendTelegramMessage(token, chatId, `❌ <b>Error al confirmar la carga:</b>\n<code>${err.message}</code>`, messageId);
      return res.status(200).json({ success: false, error: err.message });
    }
  }

  return res.status(200).json({ success: true });
}


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

function getWorkingDayDate(year, month, targetWorkingDay) {
  const daysInMonth = new Date(year, month, 0).getDate();
  let workingDaysCount = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const checkD = new Date(year, month - 1, day);
    const dayOfWeek = checkD.getDay(); // 0 is Sunday, 6 is Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      workingDaysCount++;
      if (workingDaysCount === targetWorkingDay) {
        return checkD;
      }
    }
  }
  return null;
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

    const updateId = body.update_id ? String(body.update_id) : null;
    const message = body.message;
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const messageText = message.text;
    const document = message.document;

    if (!messageText && !document) {
      return res.status(200).json({ success: true, message: 'Message has no text or document' });
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

    // Support canceling, restarting or help command session reset
    const isResetCommand = messageText && ['cancelar', 'reiniciar', '/cancel', '/ayuda', '/help', '/start', 'ayuda', 'help', 'tutorial'].includes(messageText.toLowerCase().trim());
    if (isResetCommand) {
      try {
        await supabase.from('bot_sessions').delete().eq('chat_id', String(chatId));
      } catch (err) {}
      
      // If it's a cancel/reset command, send reset message. If it's help/tutorial, let Gemini process it state-free!
      if (messageText.toLowerCase() === 'cancelar' || messageText.toLowerCase() === 'reiniciar' || messageText.toLowerCase() === '/cancel') {
        await sendTelegramMessage(botToken, chatId, '🔄 Conversación reiniciada. ¿Qué quieres registrar?', messageId, { remove_keyboard: true });
        return res.status(200).json({ success: true, message: 'Session reset' });
      }
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
    const host = req.headers.host || 'fluxo-delta.vercel.app';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const appUrl = `${proto}://${host}`;

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

    // De-duplicate updates to prevent multiple concurrent processing due to Telegram timeouts/retries
    if (updateId) {
      const metaObj = history.find(h => h.role === 'system_metadata');
      const lastUpdateId = metaObj?.parts?.[0]?.text;
      if (lastUpdateId === updateId) {
        console.warn(`[telegramWebhook] Ignoring duplicate update_id: ${updateId}`);
        return res.status(200).json({ success: true, message: 'Duplicate update ignored' });
      }
    }

    // Immediately save updateId lock in the session history to block concurrent retries
    if (updateId && hasSessionTable) {
      const cleanHistory = history.filter(h => h.role !== 'system_metadata');
      history = [
        { role: 'system_metadata', parts: [{ text: updateId }] },
        ...cleanHistory
      ];
      try {
        await supabase.from('bot_sessions').upsert({
          chat_id: String(chatId),
          history: history,
          updated_at: new Date().toISOString()
        });
      } catch (e) {
        console.error('[telegramWebhook session lock error]', e.message);
      }
    }

    // Guided PDF import wizard handler
    const wizardStateObj = history.find(h => h.role === 'wizard_state');
    if (wizardStateObj && messageText) {
      let wizardState = null;
      try {
        wizardState = JSON.parse(wizardStateObj.parts[0].text);
      } catch (e) {
        console.error('[telegramWebhook] Error parsing wizard state:', e);
      }

      if (wizardState) {
        const text = messageText.trim();
        const lowerText = text.toLowerCase();

        if (lowerText === 'cancelar') {
          try {
            await supabase.from('bot_sessions').delete().eq('chat_id', String(chatId));
          } catch (err) {}
          await sendTelegramMessage(botToken, chatId, '❌ <b>Importación cancelada.</b> Se borraron los datos temporales del resumen.', messageId, { remove_keyboard: true });
          return res.status(200).json({ success: true, message: 'Wizard cancelled by user' });
        }

        return await handleWizardStep(req, res, supabase, botToken, chatId, messageId, wizardState, text, cuentas, tarjetas, hasSessionTable, updateId, serviceKey);
      }
    }



    // Process PDF Document upload
    if (document) {
      if (document.mime_type !== 'application/pdf') {
        await sendTelegramMessage(botToken, chatId, '⚠️ Por favor, sube el resumen de tu tarjeta de crédito únicamente en formato PDF.', messageId);
        return res.status(200).json({ success: false, error: 'Invalid document type' });
      }

      if (tarjetas.length === 0) {
        await sendTelegramMessage(botToken, chatId, '⚠️ No tienes ninguna tarjeta de crédito activa registrada en la aplicación. Registra tu tarjeta en Ajustes antes de cargar el resumen.', messageId);
        return res.status(200).json({ success: false, error: 'No active cards found' });
      }

      await sendTelegramMessage(botToken, chatId, '⏳ <b>Resumen de tarjeta de crédito recibido.</b> Descargando y analizando consumos (esto puede demorar unos segundos)...', messageId);

      try {
        const fileBase64 = await downloadTelegramFile(botToken, document.file_id);

        // Fetch consumos for the last 6 months to compare
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const sixMonthsAgoStr = sixMonthsAgo.toISOString().split('T')[0];

        const { data: dbConsumos, error: dbConsErr } = await supabase
          .from('consumos_tc')
          .select('id_consumo_tarjeta, id_tarjeta, id_categoria, fecha, descripcion, importe, cuota_actual, cuota_total, recur_group_id')
          .gte('fecha', sixMonthsAgoStr);

        if (dbConsErr) throw dbConsErr;

        const systemInstruction = `
Eres un asistente de procesamiento de resúmenes de tarjeta de crédito en formato PDF para la aplicación Fluxo.
Tu tarea es analizar el PDF adjunto y compararlo con los consumos ya registrados en la base de datos para identificar nuevos consumos y consumos que difieren.

Tarjetas de crédito disponibles en el sistema:
${JSON.stringify(tarjetas.map(t => ({ id_tarjeta: t.id_tarjeta, nombre: t.nombre, banco: t.banco, ultimos_4_digitos: t.ultimos_4_digitos, id_cuenta_principal: t.id_cuenta_principal })))}

Categorías de egreso disponibles en el sistema:
${JSON.stringify(categorias.filter(c => c.tipo_mov === 'EGRESO').map(c => ({ id_categoria: c.id_categoria, nombre: c.nombre })))}

Consumos ya registrados en la base de datos (últimos 6 meses):
${JSON.stringify(dbConsumos)}

INSTRUCCIONES DE PROCESAMIENTO:
1. **Identificar la Tarjeta**: Busca en el PDF a qué tarjeta corresponde (por ejemplo, Visa o Mastercard y sus últimos 4 dígitos). Compara esto con las "Tarjetas de crédito disponibles" y selecciona la que coincida.
2. **Extraer Metadatos del Resumen**:
   - Fecha de cierre (fecha_cierre): YYYY-MM-DD
   - Fecha de vencimiento (fecha_vencimiento): YYYY-MM-DD
   - Total en Pesos (total_ars)
   - Total en Dólares (total_usd)
3. **Extraer Transacciones**: Extrae todas las compras, consumos, impuestos, percepciones o intereses del resumen. Ignora pagos o créditos (por ejemplo, "SU PAGO EN PESOS").
   - Para transacciones en cuotas, busca formatos como "C.03/09" o "Cuota 3 de 9" y extrae cuota_actual (3) y cuota_total (9).
   - Determina la fecha de la transacción (YYYY-MM-DD). Usa el año correspondiente al cierre del resumen (2026).
4. **Comparar con la Base de Datos**:
   - Compara las transacciones del resumen con los "Consumos ya registrados" para la tarjeta seleccionada en el mes de facturación (mayo 2026, dado que el cierre es 28 de Mayo de 2026).
   - **Coincidencia Exacta (exact_matches)**: Si una transacción en el resumen coincide en descripción (concepto similar), importe, cuotas y moneda con un registro en la base de datos, clasifícala como coincidencia exacta.
   - **Similares con Diferencias (similar_different)**: Si el comercio/concepto coincide pero el importe o el plan de cuotas difiere (por ejemplo, en la DB figura como simple por $80.000 pero en el resumen es cuota 9/12 por $73.721), clasifícalo aquí. Debes incluir el "db_record" completo y el "statement_record" con la información correcta.
   - **Nuevos Consumos (new_consumptions)**: Si la transacción en el resumen no tiene un registro similar en la base de datos, clasifícala como nuevo consumo.
5. **Clasificar Categorías**: Para cada nuevo consumo o consumo modificado, selecciona la categoría más adecuada de las "Categorías de egreso disponibles" y asigna su "id_categoria".

Debes responder ÚNICAMENTE con un JSON con el siguiente formato, sin bloques de código markdown, sin texto adicional:
{
  "tipo_registro": "conversational",
  "reply_message": "Resumen amigable formateado en HTML para el usuario (usando únicamente etiquetas <b>, <i>, <u>, <s>, <code>, <pre> y enlaces <a>; NO utilices etiquetas <p> ni <br>, utiliza saltos de línea '\\n' en su lugar), detallando la tarjeta, saldo total en ARS y USD, vencimiento, cantidad de consumos nuevos, cantidad de consumos a modificar, y pidiendo confirmación.",
  "buttons": [["Confirmar Carga", "Cancelar"]],
  "payload": {
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
}
`;

        const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

        const pdfHistory = [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: fileBase64
                }
              },
              {
                text: 'Analiza este resumen de tarjeta de crédito y compáralo con la base de datos.'
              }
            ]
          }
        ];

        const contentText = await callGemini(geminiKey, modelName, systemInstruction, pdfHistory, 'application/json');
        
        let parsedResult;
        try {
          parsedResult = JSON.parse(contentText);
        } catch (e) {
          console.error('[Gemini Parsing Error in PDF]', contentText);
          throw new Error('No se pudo interpretar la respuesta estructurada de la IA.');
        }

        const payload = parsedResult.payload;
        if (!payload || payload.tipo_registro !== 'pdf_analisis') {
          throw new Error('El análisis del PDF no arrojó los datos esperados.');
        }

        const matchedCard = tarjetas.find(t => t.id_tarjeta === payload.card_info.id_tarjeta);
        const cardName = matchedCard ? matchedCard.nombre : (payload.card_info.nombre || 'Tarjeta');
        
        const wizardState = {
          step: 'ASK_ACCOUNT',
          pdf_payload: payload,
          selected_account_id: null,
          imputations: {},
          conflict_resolutions: {},
          current_conflict_index: 0,
          current_consumption_index: 0
        };

        const reply = `📄 <b>Resumen de tarjeta leído con éxito</b>\n\n` +
                      `💳 Tarjeta: <b>${cardName}</b> (${payload.card_info.ultimos_4_digitos || '—'})\n` +
                      `📅 Cierre: <code>${payload.statement_info.fecha_cierre}</code>\n` +
                      `📅 Vencimiento: <code>${payload.statement_info.fecha_vencimiento}</code>\n` +
                      `💰 Total Pesos: <b>$${payload.statement_info.total_ars.toLocaleString('es-AR')}</b>\n` +
                      `💰 Total Dólares: <b>USD ${payload.statement_info.total_usd.toLocaleString('es-AR')}</b>\n\n` +
                      `🆕 Consumos nuevos detectados: <code>${(payload.new_consumptions || []).length}</code>\n` +
                      `🔄 Consumos similares con diferencias: <code>${(payload.similar_different || []).length}</code>\n\n` +
                      `<b>¿A qué cuenta principal deseas imputar este resumen por defecto?</b>`;

        const replyMarkup = {
          keyboard: [
            cuentas.map(c => ({ text: c.nombre })),
            [{ text: 'Cancelar' }]
          ],
          resize_keyboard: true,
          one_time_keyboard: true
        };

        await sendTelegramMessage(botToken, chatId, reply, messageId, replyMarkup);

        if (hasSessionTable) {
          const savedHistory = [
            {
              role: 'system_metadata',
              parts: [{ text: updateId || '' }]
            },
            {
              role: 'wizard_state',
              parts: [{ text: JSON.stringify(wizardState) }]
            }
          ];

          try {
            await supabase.from('bot_sessions').upsert({
              chat_id: String(chatId),
              history: savedHistory,
              updated_at: new Date().toISOString()
            });
          } catch (e) {
            console.error('[telegramWebhook session save error for PDF]', e.message);
          }
        }

        return res.status(200).json({ success: true, type: 'pdf_parsed_wizard_started' });

      } catch (err) {
        console.error('[telegramWebhook PDF Processing Error]', err);
        await sendTelegramMessage(botToken, chatId, `❌ <b>Error al procesar el resumen PDF:</b>\n<code>${err.message}</code>`, messageId);
        return res.status(200).json({ success: false, error: err.message });
      }
    }

    // Build instruction prompt for Gemini
    const systemInstruction = `
Eres un asistente de conversación y carga de transacciones financieras en español. Tu tarea es guiar al usuario paso a paso para completar la carga de gastos, ingresos, consumos en tarjetas de crédito, gastos compartidos (CC), ahorros o inversiones, u ofrecer información de la base de datos de manera amigable.

La URL de la aplicación web (Frontend) es: ${appUrl}
Si el usuario te pide el link de la app, te pregunta cómo ingresar, o quiere ir directamente a la aplicación web, debes proporcionarle este enlace amigablemente utilizando la etiqueta HTML de enlace (ej: <a href="${appUrl}"><b>Ir a Fluxo</b></a>).

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

TUTORIAL Y PREGUNTAS SOBRE LA APP (MANUAL DE USUARIO):
Si el usuario escribe "/ayuda", "/help", "tutorial", "ayuda", o hace preguntas generales sobre el funcionamiento de la aplicación, debes actuar como un experto en el manual de usuario de Fluxo.
Responde de manera conversacional, muy estructurada y amigable (tipo_registro: "conversational").
Aquí está el resumen del manual de usuario para responder preguntas:
1. Módulo Movimientos: Es el libro contable mensual. Soporta gastos comunes (efectivo/débito/transferencia), gastos en cuotas (se proyectan a futuro de forma automática y finalizan solas) y recurrentes (suscripciones que se repiten mes a mes). Permite carga distribuida (Split) de ingresos entre cuentas con un porcentaje (ej. 70% personal, 30% familiar) sumando máximo 100%. Soporta modificar/eliminar "Solo este movimiento" o "Toda la serie a futuro" al editar series.
2. Módulo Tarjetas: Permite ver la deuda total de tarjetas de crédito. Aísla qué parte te pertenece a vos y qué parte es de otros presupuestos. Muestra cuotas, débitos y consumos por tarjeta antes del cierre y vencimiento.
3. Módulo Gastos Compartidos (Cuentas Corrientes/Clearing): Organiza saldos con contactos (ej. "Bichi"). Si pagas algo por otro, indicas el Split (porcentaje) para que el clearing determine quién le debe a quién y saldar la deuda.
4. Módulo Ahorro (Chanchitos): Subcuentas o bóvedas en pesos (ARS) o dólares (USD) ubicadas físicamente en bancos, brokers o efectivo. Consolida el valor bimonetario neto.
5. Módulo Inversiones: Sigue el rendimiento del portfolio. Incluye carga de compras/ventas de activos (tickers) y un Monitor Global en tiempo real (Yahoo Finance / data912) que agrupa: Mundo (Índices, UST, Crypto, Commodities), Bonos Soberanos USD (AL30, GD30, etc.), Renta Fija Pesos (LECAPs, BONCAPs), Obligaciones Negociables (ONs), y CEDEARs más operados. También muestra cotizaciones del Dólar MEP, CCL, Blue y Riesgo País.
6. Barra Superior: Contiene el Selector de Mes, Selector de Entorno Presupuestario (Multi-cuenta: Personal, Familiar, Negocios), switch ARS/USD (conversión bimonetaria global en tiempo real usando el MEP), modo claro/oscuro, campana de notificaciones (alertas de cuotas finales, nuevos consumos y recordatorios activos), y el Panel de Ajustes (ABM de cuentas, tarjetas, categorías, subcuentas y contactos).
7. Integraciones externas: Dólar y mercados en tiempo real desde dolarapi.com y rendimientos.co (Yahoo Finance + data912).
8. Comandos y ejemplos del Bot de Telegram:
   - Registrar Gasto/Ingreso: "gasto de 5000 en super con debito", "ingreso de 120000 sueldo", "gasto mensual de 8000 en netflix", "consumo visa de 30000 en 3 cuotas".
   - Split de Ingresos: "ingreso de 100000 split 70% cuenta personal y 30% cuenta hogar".
   - Gastos Compartidos: "gasto de 6000 pagado por mi para Bichi al 50%" o "gasto de 8000 pagado por Juan al 50%".
   - Ahorros: "depósito de 100 usd en chanchito Viaje desde cuenta personal" o "extracción de 20000 ars de chanchito emergencias".
   - Inversiones: "compra de 10 nominales de AL30 a 55 usd en broker" o "venta de 5 nominales de GGAL a 3200 ars".
   - Recordatorios/Alertas: "Todos los meses el 5to dia habil recordame pagar la escuela por telegram y app", "Mostrame mis recordatorios" o "Eliminá el recordatorio [ID_CORTO]".
   - Consultas de datos: "cuánto gasté este mes en supermercado?", "mostrame últimos movimientos", "saldo de mis chanchitos", "cartera de inversiones", "proyección de la tarjeta".
   - Modificación/Borrado: "modificá el último gasto de super y poné 4500", "eliminá el de recién".

Si el usuario pide ayuda explícitamente, responde con un tutorial estructurado mostrando los comandos principales y agregando un enlace a la app usando la etiqueta HTML: <a href="${appUrl}"><b>Ir a la App</b></a>. No uses bloques de código markdown, responde directamente en formato de texto enriquecido HTML.

VOCABULARIO Y CLASIFICACIÓN CLAVE (MUY IMPORTANTE):
- "gasto" o "gastos": Se refiere a gastos comunes / movimientos de cuentas principales (medio de pago: efectivo, débito o transferencia). Se clasifica como tipo_registro: "movimiento".
- "consumo" o "consumos": Se refiere a consumos con tarjeta de crédito. Se clasifica como tipo_registro: "tarjeta".
- "gasto compartido" o "gastos compartidos": Se refiere a gastos divididos o compartidos con contactos (clearing). Se clasifica como tipo_registro: "cc".

COMPORTAMIENTO DE DIÁLOGO GUIADO (MUY IMPORTANTE):
1. Si el usuario te indica registrar un movimiento (gasto/ingreso), ahorro, inversión o consumo con tarjeta pero la información está INCOMPLETA, no asumas defaults. Debes responder de forma conversacional indicando opciones del sistema y solicitando lo que falta:
   - **NUNCA asumas el tipo de gasto o consumo por defecto** (por ejemplo, no asumas que un gasto es 'SIMPLE' o de 1 pago si el usuario no lo especificó explícitamente). Si el usuario te dice "gasto de 5000 en super" o "consumo visa de 3000", debes considerarlo incompleto y preguntarle de forma conversacional si es en 1 pago (simple), en cuotas o un gasto recurrente (suscripción mensual, etc.), mostrando los botones de opciones.
   - **Reconocer Patrones de Suscripciones**: Si el usuario te pide registrar un gasto o consumo con nombre de servicios que habitualmente son suscripciones recurrentes (como "Netflix", "Spotify", "Gimnasio", "Alquiler", "Luz", "Internet", "Expensas"), hazle una pregunta conversacional sugiriéndole si prefiere registrarlo como un gasto **Recurrente** en lugar de uno simple, para facilitar sus cargas futuras.
   - Para movimientos (ingreso/egreso común): requiere saber la cuenta principal, el tipo de pago (simple o recurrente), y si desea hacer split (distribuir con otra cuenta principal).
     - Si es recurrente: pregunta frecuencia (MENSUAL, BIMESTRAL, TRIMESTRAL, SEMESTRAL, ANUAL) y períodos (cuántos meses/ciclos).
     - Si desea hacer split: pregunta con qué cuenta principal desea hacer split y en qué porcentaje.
   - Para consumos de tarjeta de crédito (tarjeta): requiere saber qué tarjeta, el tipo de consumo (1 pago/simple, cuotas o recurrente).
     - Si es en cuotas: pregunta en cuántas cuotas.
     - Si es recurrente: pregunta durante cuántos meses.
   - Para ahorros (ahorro): requiere saber el chanchito de destino (subcuenta), cuenta de origen, importe, moneda, y si es un depósito o extracción.
   - Para inversiones (inversion): requiere saber si es compra o venta, ticker, cantidad nominal, precio unitario, moneda (ARS/USD), y cuenta/broker desde donde opera.
2. Si faltan datos clave, debes devolver el JSON con "tipo_registro": "conversational", explicando amigablemente qué falta definir. Además, DEBES generar una matriz de botones en el campo "buttons" para guiar táctilmente al usuario con las opciones permitidas:
   - Si preguntas por cuentas: lista las cuentas principales disponibles. Ejemplo: [["Cuenta Personal", "Negocio (Ejemplo)"], ["Cancelar"]]
   - Si preguntas por tarjetas: lista las tarjetas de crédito disponibles. Ejemplo: [["Visa (Banco Ejemplo)", "Amex (Banco Ejemplo)"], ["Cancelar"]]
   - Si preguntas por chanchitos: lista las subcuentas de ahorro disponibles. Ejemplo: [["Viaje", "Emergencias"], ["Cancelar"]]
   - Si preguntas por categorías: lista 3 o 4 categorías de egresos o ingresos sugeridas. Ejemplo: [["Supermercado", "Servicios", "Ocio"], ["Cancelar"]]
   - Si preguntas por el tipo de consumo/transacción: lista las opciones de tipo. Ejemplo: [["Simple", "Cuotas", "Recurrente"], ["Cancelar"]]
   - Si preguntas por confirmaciones, splits o recurrentes: usa botones apropiados como [["Sí", "No"], ["Cancelar"]].
3. Si el usuario te dice que te va a enviar el resumen de la tarjeta Visa Santander (o similar), indícale de forma atenta y amigable que proceda a subir el archivo PDF del resumen para que el sistema inicie el asistente conversacional paso a paso para la imputación de los gastos.
4. Solo cuando tengas todos los datos esenciales, devuelve el JSON estructurado correspondiente.

Tipos de registro disponibles:
- "movimiento": si cargas un ingreso/egreso de cuenta principal.
- "tarjeta": si cargas un consumo en tarjeta de crédito.
- "cc": si cargas un gasto compartido con un contacto.
- "ahorro": si cargas un depósito o extracción en un chanchito.
- "inversion": si cargas una compra o venta de activos (inversiones).
- "recordatorio": si configura, lista o borra recordatorios/notificaciones.
- "query": si el usuario consulta saldo, cartera, resumen, proyecciones.
- "update": si modifica o borra un registro previo.
- "conversational": si falta información o es una charla casual.

Formato de JSON a retornar:
{
  "tipo_registro": "movimiento" | "tarjeta" | "cc" | "ahorro" | "inversion" | "recordatorio" | "query" | "update" | "conversational",
  "reply_message": "Respuesta conversacional o pregunta amigable (solo cuando tipo_registro es conversational o query)",
  "buttons": [ // Opcional (solo en tipo_registro: conversational). Matriz de textos para botones nativos. Cada sub-array es una fila de botones en Telegram. Ej: [["Visa", "Amex"], ["Cancelar"]]
    ["Opción A", "Opción B"],
    ["Cancelar"]
  ],
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
- Si tipo_registro es "recordatorio":
  {
    "action": "create" | "list" | "delete",
    "idRecordatorio": "primeros 4 caracteres del ID del recordatorio (ej. 'a7b8', solo si action es delete)",
    "mensaje": "Mensaje del recordatorio (ej. 'pagar escuela', solo si action es create)",
    "frecuencia": "UNICA" | "MENSUAL" | "DIAS_HABILES" (solo si action es create),
    "diaMes": número (1-31, solo si frecuencia es MENSUAL y action es create),
    "diaHabil": número (1-20, solo si frecuencia es DIAS_HABILES y action es create),
    "fecha": "YYYY-MM-DD" (solo si frecuencia es UNICA y action es create),
    "canales": "TELEGRAM" | "APP" | "MAIL" (separados por coma, ej. "TELEGRAM,APP,MAIL", solo si action es create)
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
    "search_term": "búsqueda por descripción (dejar vacío o null si se refiere al último de recién, el último cargado, o el de recién)",
    "delete_future_only": boolean (opcional, true si el usuario indica dar de baja la suscripción o cancelar el pago futuro de un gasto/consumo recurrente),
    "updates": { ... campos modificables ... }
  }

IMPORTANTE: Devuelve únicamente un objeto JSON válido, sin Markdown (no uses bloques de código ni texto adicional).
`;

    // Append current message
    history.push({
      role: 'user',
      parts: [{ text: messageText || '' }]
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
      let replyMarkup = null;
      if (Array.isArray(parsedResult.buttons) && parsedResult.buttons.length > 0) {
        replyMarkup = {
          keyboard: parsedResult.buttons.map(row => {
            if (Array.isArray(row)) {
              return row.map(btn => ({ text: String(btn) }));
            } else {
              return [{ text: String(row) }];
            }
          }),
          resize_keyboard: true,
          one_time_keyboard: true
        };
      }
      await sendTelegramMessage(botToken, chatId, reply, messageId, replyMarkup);
      
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
      
      let isLastTerm = false;
      if (search_term) {
        const cleanTerm = search_term.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const lastPhrases = [
          'ultimo', 'el ultimo', 'la ultima', 'la de recien', 'el de recien', 
          'recien', 'ultimo gasto', 'ultima transaccion', 'el que acabo de cargar', 
          'el de recién', 'último', 'recién', 'el que acabo de subir', 'ultimo consumo',
          'ultimo gasto cargado'
        ];
        if (lastPhrases.includes(cleanTerm) || cleanTerm.includes('ultimo') || cleanTerm.includes('recien') || cleanTerm === '') {
          isLastTerm = true;
        }
      } else {
        isLastTerm = true;
      }

      if (search_term && !isLastTerm) {
        if (catId) {
          query = query.or(`descripcion.ilike.%${search_term}%,id_categoria.eq.${catId}`);
        } else {
          query = query.ilike('descripcion', `%${search_term}%`);
        }
      }
      
      let resultQuery = query.order('created_at', { ascending: false }).limit(1);
      let { data: rows, error: selErr } = await resultQuery;
      
      if (selErr) {
        console.warn('[telegramWebhook] order by created_at failed, falling back to fecha', selErr.message);
        resultQuery = query.order('fecha', { ascending: false }).limit(1);
        const fbRes = await resultQuery;
        rows = fbRes.data;
        selErr = fbRes.error;
      }
      
      if (selErr) throw selErr;

      if (rows && rows.length > 0) {
        const row = rows[0];
        const rowId = row[idColumn];
        
        if (action === 'delete') {
          const recurGroupId = row.recur_group_id;
          const deleteFutureOnly = payload.delete_future_only || false;
          
          if (recurGroupId && deleteFutureOnly) {
            const deleteDate = row.fecha;
            const { error: delTC } = await supabase.from('consumos_tc').delete().eq('recur_group_id', recurGroupId).gte('fecha', deleteDate);
            if (delTC) throw delTC;
            const { error: delMov } = await supabase.from('movimientos').delete().eq('recur_group_id', recurGroupId).gte('fecha', deleteDate);
            if (delMov) throw delMov;
            
            await sendTelegramMessage(
              botToken, 
              chatId, 
              `🗑️ <b>Suscripción cancelada con éxito</b>\n\nSe eliminaron todos los consumos futuros de la serie <b>"${row.descripcion}"</b> a partir del <code>${deleteDate}</code>.`, 
              messageId
            );
            return res.status(200).json({ success: true, type: 'recurring_series_deleted' });
          } else {
            const { error: delErr } = await supabase.from(target_table).delete().eq(idColumn, rowId);
            if (delErr) throw delErr;
            
            await sendTelegramMessage(
              botToken, 
              chatId, 
              `🗑️ <b>Eliminado con éxito</b>\n\nSe borró el registro de <b>${row.descripcion}</b> por <code>$${Math.abs(Number(row.importe))}</code> (Fecha: <code>${row.fecha}</code>).`, 
              messageId
            );
            return res.status(200).json({ success: true, type: 'record_deleted' });
          }
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

    if (parsedResult.tipo_registro === 'recordatorio') {
      const payload = parsedResult.payload || parsedResult;
      const { action } = payload;

      if (action === 'create') {
        const { mensaje, frecuencia, diaMes, diaHabil, canales, fecha } = payload;
        const defaultAccount = cuentas.find(c => c.es_predeterminada)?.id_cuenta_principal || cuentas[0]?.id_cuenta_principal;
        
        // Calculate next date (fecha_proxima)
        const [todayY, todayM, todayD] = todayStr.split('-').map(Number);
        let fechaProxima = null;

        if (frecuencia === 'UNICA') {
          fechaProxima = fecha || todayStr;
        } else if (frecuencia === 'MENSUAL') {
          const targetDay = Number(diaMes) || 1;
          if (targetDay > todayD) {
            fechaProxima = `${todayY}-${String(todayM).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
          } else {
            let nextM = todayM + 1;
            let nextY = todayY;
            if (nextM > 12) {
              nextM = 1;
              nextY += 1;
            }
            fechaProxima = `${nextY}-${String(nextM).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
          }
        } else if (frecuencia === 'DIAS_HABILES') {
          const targetWorkingDay = Number(diaHabil) || 5;
          // Calculate for current month first
          const currentMonthDate = getWorkingDayDate(todayY, todayM, targetWorkingDay);
          if (currentMonthDate) {
            const currentMonthDateStr = currentMonthDate.toISOString().split('T')[0];
            if (currentMonthDateStr >= todayStr) {
              fechaProxima = currentMonthDateStr;
            }
          }
          // If not set, calculate for next month
          if (!fechaProxima) {
            let nextM = todayM + 1;
            let nextY = todayY;
            if (nextM > 12) {
              nextM = 1;
              nextY += 1;
            }
            const nextMonthDate = getWorkingDayDate(nextY, nextM, targetWorkingDay);
            if (nextMonthDate) {
              fechaProxima = nextMonthDate.toISOString().split('T')[0];
            } else {
              fechaProxima = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
            }
          }
        }

        const { data, error } = await supabase
          .from('recordatorios')
          .insert({
            id_cuenta_principal: defaultAccount,
            chat_id: String(chatId),
            mensaje,
            frecuencia,
            dia_mes: frecuencia === 'MENSUAL' ? Number(diaMes) : null,
            dia_habil: frecuencia === 'DIAS_HABILES' ? Number(diaHabil) : null,
            fecha_proxima: fechaProxima,
            canales: canales || 'TELEGRAM',
            activa: true
          })
          .select()
          .single();

        if (error) throw error;

        const freqText = frecuencia === 'MENSUAL' 
          ? `el día ${diaMes} de cada mes` 
          : frecuencia === 'DIAS_HABILES' 
            ? `el ${diaHabil}° día hábil de cada mes` 
            : `una sola vez (el ${fechaProxima})`;

        await sendTelegramMessage(
          botToken,
          chatId,
          `🔔 <b>Recordatorio creado con éxito</b>\n\n` +
          `📝 Mensaje: "<i>${mensaje}</i>"\n` +
          `📅 Frecuencia: ${freqText}\n` +
          `📢 Canales: <code>${canales || 'TELEGRAM'}</code>\n` +
          `⏭️ Próxima ejecución: <code>${fechaProxima}</code>\n` +
          `🆔 ID para borrar: <code>${data.id_recordatorio.substring(0, 4)}</code>`,
          messageId
        );
        return res.status(200).json({ success: true, type: 'recordatorio_created' });

      } else if (action === 'list') {
        const { data: list, error } = await supabase
          .from('recordatorios')
          .select('*')
          .eq('chat_id', String(chatId))
          .eq('activa', true)
          .order('created_at', { ascending: false });

        if (error) throw error;

        if (!list || list.length === 0) {
          await sendTelegramMessage(
            botToken,
            chatId,
            `🔔 No tienes ningún recordatorio activo configurado.`,
            messageId
          );
          return res.status(200).json({ success: true, type: 'recordatorio_listed_empty' });
        }

        let msg = `🔔 <b>Tus Recordatorios Activos</b>\n\n`;
        list.forEach(r => {
          const idShort = r.id_recordatorio.substring(0, 4);
          const freqText = r.frecuencia === 'MENSUAL' 
            ? `el día ${r.dia_mes} de cada mes` 
            : r.frecuencia === 'DIAS_HABILES' 
              ? `el ${r.dia_habil}° día hábil de cada mes` 
              : `única vez (el ${r.fecha_proxima})`;

          msg += `🆔 <code>${idShort}</code>: "<i>${r.mensaje}</i>"\n` +
                 `   📅 Frecuencia: ${freqText}\n` +
                 `   📢 Canales: <code>${r.canales}</code>\n` +
                 `   ⏭️ Próxima fecha: <code>${r.fecha_proxima}</code>\n\n`;
        });

        msg += `💡 Para eliminar uno, puedes decirme: "<i>Eliminá el recordatorio [ID]</i>" (ej: <code>Eliminá el recordatorio ${list[0].id_recordatorio.substring(0, 4)}</code>).`;

        await sendTelegramMessage(botToken, chatId, msg, messageId);
        return res.status(200).json({ success: true, type: 'recordatorio_listed' });

      } else if (action === 'delete') {
        const { idRecordatorio } = payload;
        if (!idRecordatorio) {
          await sendTelegramMessage(botToken, chatId, `⚠️ Por favor indica el ID de 4 dígitos del recordatorio a eliminar.`, messageId);
          return res.status(200).json({ success: false, error: 'No ID provided' });
        }

        const { data: list, error: selErr } = await supabase
          .from('recordatorios')
          .select('*')
          .eq('chat_id', String(chatId));

        if (selErr) throw selErr;

        const matched = (list || []).filter(r => r.id_recordatorio.toLowerCase().startsWith(idRecordatorio.toLowerCase()));

        if (matched.length === 0) {
          await sendTelegramMessage(botToken, chatId, `⚠️ No se encontró ningún recordatorio que comience con el ID <code>${idRecordatorio}</code>.`, messageId);
          return res.status(200).json({ success: false, error: 'Recordatorio not found' });
        }

        const toDelete = matched[0];
        const { error: delErr } = await supabase
          .from('recordatorios')
          .delete()
          .eq('id_recordatorio', toDelete.id_recordatorio);

        if (delErr) throw delErr;

        await sendTelegramMessage(
          botToken,
          chatId,
          `🗑️ <b>Recordatorio eliminado con éxito</b>\n\n` +
          `Se borró: "<i>${toDelete.mensaje}</i>" (ID: <code>${toDelete.id_recordatorio.substring(0, 4)}</code>).`,
          messageId
        );
        return res.status(200).json({ success: true, type: 'recordatorio_deleted' });
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
      await sendTelegramMessage(botToken, chatId, successMsg, messageId, { remove_keyboard: true });
      return res.status(200).json({ success: true, data: responseData });
    } else {
      const errMsg = responseData?.error || 'Error desconocido al insertar en base de datos.';
      await sendTelegramMessage(botToken, chatId, `❌ <b>Error al cargar transacción</b>\n\n${errMsg}`, messageId, { remove_keyboard: true });
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
