import fs from 'fs';
import path from 'path';

const apiDir = path.join(process.cwd(), 'api');

const createInversion = `import { getSupabaseClient } from './_lib/supabase.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const operacionData = Array.isArray(req.body) ? req.body[0] : req.body;
    
    const { idCuenta, tipoOp, fecha, moneda } = operacionData;
    const ticker = operacionData.ticker.toUpperCase().trim();
    const cantidad = Number(operacionData.cantidad);
    const precio = Number(operacionData.precio);
    
    const ID_CATEGORIA_INVERSION = 'CAT_INVERSION';
    let importe_total_ars = cantidad * precio;
    
    if (moneda === 'USD') {
      const { data: cotizData } = await supabase.from('cotizaciones_dolar').select('*').order('fecha', { ascending: false }).limit(1).single();
      const venta = cotizData ? cotizData.venta : 1000;
      importe_total_ars = importe_total_ars * venta;
    }
    
    const tipo_mov_principal = (tipoOp === 'COMPRA') ? 'EGRESO' : 'INGRESO';
    const desc_principal = \`\${tipoOp} \${ticker} (\${moneda}) - \${cantidad} nom. @ \${precio}\`;
    const idInversion = 'INV_' + crypto.randomUUID();
    const idMovimiento = crypto.randomUUID();
    
    const movResult = await supabase.from('movimientos').insert({
      id_movimiento: idMovimiento,
      id_cuenta_principal: idCuenta,
      fecha: fecha,
      id_categoria: ID_CATEGORIA_INVERSION,
      tipo_mov: tipo_mov_principal,
      descripcion: desc_principal,
      importe: importe_total_ars,
      medio_pago: 'Broker',
      id_transfer_inversion: idInversion,
      moneda: moneda
    });
    if (movResult.error) throw movResult.error;
    
    const invResult = await supabase.from('inversiones_movimientos').insert({
      id_inversion_mov: idInversion,
      id_movimiento_origen: idMovimiento,
      ticker: ticker,
      fecha: fecha,
      tipo_operacion: tipoOp,
      moneda: moneda,
      cantidad_nominales: cantidad,
      precio_compra: precio,
      importe_total_ars: importe_total_ars
    });
    if (invResult.error) throw invResult.error;
    
    return res.status(200).json({ success: true, data: { id_operacion: idInversion } });
  } catch (err) {
    console.error('[API -> createInversion]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
`;

const deleteInversion = `import { getSupabaseClient } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    const idOperacion = Array.isArray(req.body) ? req.body[0] : req.body;
    
    if (!idOperacion) throw new Error('idOperacion requerido');
    
    // Delete from movimientos first (FK)
    const movResult = await supabase.from('movimientos').delete().eq('id_transfer_inversion', idOperacion);
    if (movResult.error) throw movResult.error;
    
    // Delete from inversiones_movimientos
    const invResult = await supabase.from('inversiones_movimientos').delete().eq('id_inversion_mov', idOperacion);
    if (invResult.error) throw invResult.error;
    
    return res.status(200).json({ success: true, data: { id_operacion: idOperacion } });
  } catch (err) {
    console.error('[API -> deleteInversion]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
`;

fs.writeFileSync(path.join(apiDir, 'createInversion.js'), createInversion, 'utf8');
fs.writeFileSync(path.join(apiDir, 'deleteInversion.js'), deleteInversion, 'utf8');
console.log('Inversiones endpoints generated');
