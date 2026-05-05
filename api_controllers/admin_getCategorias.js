import { getSupabaseClient } from '../api_lib/supabase.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const { data: categorias, error: errCat } = await supabase.from('categorias').select('*').order('tipo_mov', { ascending: true }).order('nombre', { ascending: true });
    if (errCat) throw errCat;
    
    const { data: cuentas, error: errC } = await supabase.from('cuentas_principales').select('id_cuenta_principal,nombre');
    if (errC) throw errC;
    
    const cuentaMap = {};
    cuentas.forEach(c => cuentaMap[c.id_cuenta_principal] = c.nombre);
    
    const data = categorias.map(c => ({
      ...c,
      nombre_cuenta_principal: c.id_cuenta ? (cuentaMap[c.id_cuenta] || null) : null
    }));
    
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}