import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.query.secret !== 'fluxo_debug_1234') {
    return res.status(403).json({ error: 'Unauthorized debug access' });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!url || !serviceKey) {
    return res.status(500).json({ error: 'Missing Supabase URL or Service Role Key in server environment' });
  }

  const supabase = createClient(url, serviceKey);

  try {
    let webhookInfo = null;
    if (botToken) {
      try {
        const teleRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
        webhookInfo = await teleRes.json();
      } catch (err) {
        webhookInfo = { error: err.message };
      }
    } else {
      webhookInfo = { error: 'TELEGRAM_BOT_TOKEN not found in server process.env' };
    }

    let geminiModels = null;
    const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
        const gData = await gRes.json();
        geminiModels = (gData.models || []).map(m => m.name.replace('models/', '')).filter(n => n.includes('flash') || n.includes('pro'));
      } catch (gErr) {
        geminiModels = { error: gErr.message };
      }
    }

    const [tarjetas, cuentas, consumos, movimientos, botSessions] = await Promise.all([
      supabase.from('tarjetas').select('*'),
      supabase.from('cuentas_principales').select('*'),
      supabase.from('consumos_tc').select('*'),
      supabase.from('movimientos').select('*'),
      supabase.from('bot_sessions').select('*')
    ]);

    return res.status(200).json({
      success: true,
      gemini_models: geminiModels,
      telegram_webhook: webhookInfo,
      tarjetas: tarjetas.data,
      cuentas: cuentas.data,
      consumos_tc: consumos.data,
      movimientos_tc_related: (movimientos.data || []).filter(m => m.id_consumo_tarjeta_origen || m.medio_pago?.toLowerCase().includes('tarjeta')),
      bot_sessions: botSessions.data,
      errors: {
        tarjetas: tarjetas.error,
        cuentas: cuentas.error,
        consumos_tc: consumos.error,
        movimientos: movimientos.error,
        bot_sessions: botSessions.error
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
