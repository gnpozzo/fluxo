import { getSupabaseClient } from '../api_lib/supabase.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    // For now returning mock data to unblock UI
    return res.status(200).json({ 
      success: true, 
      kpis: { valorActual: 0, costoTotal: 0, gananciaTotal: 0, rendimientoPorc: 0 },
      portfolio: []
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}