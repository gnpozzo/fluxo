import { holdings } from '../shared/finance.js';
import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const rawArgs = Array.isArray(req.body?.args) ? req.body.args : (Array.isArray(req.body) ? req.body : null);
    let payload = rawArgs ? rawArgs[0] : req.body;
    let idOperacion = (typeof payload === 'object' && payload !== null)
      ? (payload.id || payload.id_inversion || payload.idOperacion || payload.id_operacion || payload.id_inversion_mov)
      : payload;
    
    if (!idOperacion) throw new Error('idOperacion requerido');
    
    const {data:deleted}=await supabase.from('inversiones_movimientos').delete().eq('id_inversion_mov',idOperacion).eq('user_id',userId).select();
    if(!deleted.length) return res.status(404).json({success:false,error:'No se encontró la operación.'});
    await supabase.from('movimientos').delete().eq('id_transfer_inversion',idOperacion).eq('user_id',userId);
    const {data:remaining}=await supabase.from('inversiones_movimientos').select('*').eq('id_cuenta_principal',deleted[0].id_cuenta_principal).eq('user_id',userId);
    try{holdings(remaining)}catch(e){e.status=400;throw e;}
    return res.status(200).json({ success: true, data: { id_operacion: idOperacion } });
  } catch (err) {
    console.error('[API -> deleteInversion]', err.message);
    return res.status(err.status || 500).json({ success: false, error: err.status ? err.message : 'No se pudo completar la operación.' });
  }
}
