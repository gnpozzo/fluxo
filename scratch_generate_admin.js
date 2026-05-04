import fs from 'fs';
import path from 'path';

const endpoints = [
  { name: 'admin_saveCuentaPrincipal', table: 'cuentas_principales', pk: 'id_cuenta_principal' },
  { name: 'admin_deleteCuentaPrincipal', table: 'cuentas_principales', pk: 'id_cuenta_principal' },
  { name: 'admin_saveTarjeta', table: 'tarjetas', pk: 'id_tarjeta' },
  { name: 'admin_deleteTarjeta', table: 'tarjetas', pk: 'id_tarjeta' },
  { name: 'admin_saveCategoria', table: 'categorias', pk: 'id_categoria' },
  { name: 'admin_deleteCategoria', table: 'categorias', pk: 'id_categoria' },
  { name: 'admin_saveAhorroSubcuenta', table: 'ahorro_subcuentas', pk: 'id_subcuenta' },
  { name: 'admin_deleteAhorroSubcuenta', table: 'ahorro_subcuentas', pk: 'id_subcuenta' },
  { name: 'admin_saveCtaCorrienteUsuario', table: 'cta_corriente_usuarios', pk: 'id_usuario' },
  { name: 'admin_deleteCtaCorrienteUsuario', table: 'cta_corriente_usuarios', pk: 'id_usuario' },
];

const apiDir = path.join(process.cwd(), 'api');

if (!fs.existsSync(apiDir)) {
  fs.mkdirSync(apiDir);
}

for (const ep of endpoints) {
  const isDelete = ep.name.includes('delete');
  let content = '';

  if (isDelete) {
    content = `import { getSupabaseClient } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    // request body is directly the ID for delete endpoints based on AppAPI.js call format
    const id = Array.isArray(req.body) ? req.body[0] : req.body;
    
    if (!id) throw new Error('ID requerido');

    const { error } = await supabase.from('${ep.table}').delete().eq('${ep.pk}', id);
    if (error) throw error;
    
    return res.status(200).json({ success: true, message: 'Eliminado correctamente' });
  } catch (err) {
    console.error('[API -> ${ep.name}]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
`;
  } else {
    content = `import { getSupabaseClient } from './_lib/supabase.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    // AppAPI.js wrappea los argumentos en { args: [...] } si se usa call()
    const payload = Array.isArray(req.body) ? req.body[0] : req.body;
    
    let isNew = false;
    if (!payload.${ep.pk}) {
      isNew = true;
      payload.${ep.pk} = crypto.randomUUID();
    }
    
    const { data, error } = await supabase.from('${ep.table}').upsert(payload).select().single();
    if (error) throw error;
    
    return res.status(200).json({ success: true, data, isNew });
  } catch (err) {
    console.error('[API -> ${ep.name}]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
`;
  }

  const filePath = path.join(apiDir, `${ep.name}.js`);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Generated ${filePath}`);
}
