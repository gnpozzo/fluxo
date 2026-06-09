import { createClient } from '@supabase/supabase-js';

async function sendTelegramMessage(token, chatId, text) {
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      console.error('[sendReminders -> sendMessage response error]', await res.text());
    }
  } catch (err) {
    console.error('[sendReminders -> sendMessage]', err.message);
  }
}

export default async function handler(req, res) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!supabaseUrl || !serviceKey || !botToken) {
      return res.status(500).json({ success: false, error: 'Configuration missing' });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const todayStr = new Date().toISOString().split('T')[0];

    // Fetch all active reminders where next date is today or passed
    const { data: reminders, error } = await supabase
      .from('recordatorios')
      .select('*')
      .eq('activa', true)
      .lte('fecha_proxima', todayStr);

    if (error) throw error;

    const sentIds = [];

    for (const r of (reminders || [])) {
      // 1. Send Telegram Message if TELEGRAM channel is configured
      if (r.canales && r.canales.toUpperCase().includes('TELEGRAM')) {
        const formattedMsg = `🔔 <b>Recordatorio Financiero</b>\n\n${r.mensaje}`;
        await sendTelegramMessage(botToken, r.chat_id, formattedMsg);
      }

      // 2. Calculate next execution date
      let nextDate = null;
      let nextActiva = true;

      if (r.frecuencia === 'UNICA') {
        nextActiva = false;
      } else if (r.frecuencia === 'MENSUAL') {
        const d = new Date(r.fecha_proxima + 'T12:00:00Z');
        d.setMonth(d.getMonth() + 1);
        d.setDate(r.dia_mes || 1);
        nextDate = d.toISOString().split('T')[0];
      } else if (r.frecuencia === 'DIAS_HABILES') {
        const d = new Date(r.fecha_proxima + 'T12:00:00Z');
        // move to next month
        d.setMonth(d.getMonth() + 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1; // 1-indexed
        const targetWorkingDay = r.dia_habil || 5;
        
        let workingDaysCount = 0;
        const daysInMonth = new Date(y, m, 0).getDate();
        let matchedDate = null;
        for (let day = 1; day <= daysInMonth; day++) {
          const checkD = new Date(y, m - 1, day);
          const dayOfWeek = checkD.getDay();
          if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            workingDaysCount++;
            if (workingDaysCount === targetWorkingDay) {
              matchedDate = checkD;
              break;
            }
          }
        }
        if (matchedDate) {
          nextDate = matchedDate.toISOString().split('T')[0];
        } else {
          // fallback standard monthly
          d.setDate(1);
          nextDate = d.toISOString().split('T')[0];
        }
      }

      // 3. Update reminder
      await supabase
        .from('recordatorios')
        .update({
          fecha_proxima: nextDate,
          activa: nextActiva
        })
        .eq('id_recordatorio', r.id_recordatorio);

      sentIds.push(r.id_recordatorio);
    }

    return res.status(200).json({ success: true, processed: sentIds.length, ids: sentIds });
  } catch (err) {
    console.error('[sendReminders Handler Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
