import { getSupabaseClient } from './_lib/supabase.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    // join with cuentas_principales
    const { data: tarjetas, error: errT } = await supabase.from('tarjetas').select('*').order('nombre', { ascending: true });
    if (errT) throw errT;
    
    const { data: cuentas, error: errC } = await supabase.from('cuentas_principales').select('id_cuenta_principal,nombre');
    if (errC) throw errC;
    
    const cuentaMap = {};
    cuentas.forEach(c => cuentaMap[c.id_cuenta_principal] = c.nombre);
    
    const data = tarjetas.map(t => ({
      ...t,
      nombre_cuenta_principal: cuentaMap[t.id_cuenta_principal] || null
    }));
    
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}