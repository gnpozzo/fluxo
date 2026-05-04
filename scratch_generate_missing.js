import fs from 'fs';
import path from 'path';

const apiDir = path.join(process.cwd(), 'api');

const endpoints = {
  'admin_getCuentasPrincipales': `import { getSupabaseClient } from './_lib/supabase.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const { data, error } = await supabase
      .from('cuentas_principales')
      .select('id_cuenta_principal,nombre,moneda_principal,es_predeterminada,activa,fecha_creacion,modulo_tarjetas_activo,modulo_ahorro_activo,modulo_cc_activo,requiere_ajuste_cc_tc')
      .order('fecha_creacion', { ascending: false });
    if (error) throw error;
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}`,

  'admin_getTarjetas': `import { getSupabaseClient } from './_lib/supabase.js';
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
}`,

  'admin_getCategorias': `import { getSupabaseClient } from './_lib/supabase.js';
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
}`,

  'admin_getAhorroSubcuentas': `import { getSupabaseClient } from './_lib/supabase.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const { data, error } = await supabase.from('ahorro_subcuentas').select('id_subcuenta,nombre,moneda').order('nombre', { ascending: true });
    if (error) throw error;
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}`,

  'admin_getCtaCorrienteUsuarios': `import { getSupabaseClient } from './_lib/supabase.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const { data, error } = await supabase.from('cta_corriente_usuarios').select('id_usuario,nombre').order('nombre', { ascending: true });
    if (error) throw error;
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}`,

  'getProyeccionTC': `import { getSupabaseClient } from './_lib/supabase.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const args = Array.isArray(req.body) ? req.body : [req.body];
    const { cuenta, mes } = args[0] || {};
    
    // For now returning mock data to unblock UI
    return res.status(200).json({ success: true, consumos: [], totales: { total: 0 } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}`,

  'getMarketData': `import { getSupabaseClient } from './_lib/supabase.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    // For now returning mock data to unblock UI
    return res.status(200).json({ success: true, data: {} });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}`,

  'getPortfolio': `import { getSupabaseClient } from './_lib/supabase.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    // For now returning mock data to unblock UI
    return res.status(200).json({ success: true, data: [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}`
};

for (const [name, content] of Object.entries(endpoints)) {
  const filePath = path.join(apiDir, name + '.js');
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Created ' + filePath);
}
