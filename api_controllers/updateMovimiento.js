import { getSupabaseClient } from '../api_lib/supabase.js';
import { resolveUserCuenta } from '../api_lib/auth.js';
import { inputError } from '../api_lib/validation.js';
import createMovimiento from './createMovimiento.js';

// Replacement and creation run inside the router's database transaction.
export default async function handler(req, res) {
  const db = getSupabaseClient(req), userId = req.user.id;
  const args = req.body?.args || (Array.isArray(req.body) ? req.body : null);
  const request = args ? (typeof args[0] === 'object' ? args[0] : args[1]) : req.body;
  const mov = request?.data || request || {};
  const original = request?.original || {};
  const id = original.movimientoId || original.id || original.id_movimiento || (typeof args?.[0] === 'string' ? args[0] : null) || request?.id || mov.id_movimiento;
  const scope = request?.scope || (typeof args?.[3] === 'string' ? args[3] : typeof args?.[2] === 'string' ? args[2] : 'SINGLE');
  if (!id || !['SINGLE', 'GROUP', 'SERIES'].includes(scope)) throw inputError('Movimiento o alcance inválido.');
  const { data: existing } = await db.from('movimientos').select('*').eq('id_movimiento', id).eq('user_id', userId).maybeSingle();
  if (!existing) return res.status(404).json({ success: false, error: 'No se encontró el movimiento.' });
  if (mov.idCuenta) {
    const account = await resolveUserCuenta(db, mov.idCuenta, userId);
    if (!account) throw inputError('La cuenta no pertenece al usuario.', 403);
    mov.idCuenta = account;
  }
  const recurrent = ['RECURRENTE', 'CUOTAS'].includes(mov.tipoConsumo);
  const replace = scope !== 'SINGLE' || recurrent !== Boolean(existing.recur_group_id) || Boolean(mov.esSplit) !== Boolean(existing.split_group_id) || Boolean(mov.idTarjetaCuotas);
  if (replace) {
    let query = db.from('movimientos').select('id_movimiento,id_consumo_tarjeta_origen').eq('user_id', userId);
    if (scope === 'GROUP' && existing.split_group_id) query = query.eq('split_group_id', existing.split_group_id);
    else if (scope === 'SERIES' && existing.recur_group_id) query = query.eq('recur_group_id', existing.recur_group_id).gte('fecha', existing.fecha);
    else query = query.eq('id_movimiento', id);
    const { data: rows } = await query;
    const tcIds = [...new Set(rows.map(r => r.id_consumo_tarjeta_origen).filter(Boolean))];
    if (tcIds.length) {
      await db.from('movimientos').delete().in('id_consumo_tarjeta_origen', tcIds).eq('user_id', userId);
      await db.from('consumos_tc').delete().in('id_consumo_tarjeta', tcIds).eq('user_id', userId);
    }
    await db.from('movimientos').delete().in('id_movimiento', rows.map(r => r.id_movimiento)).eq('user_id', userId);
    if (scope === 'SINGLE' && (existing.recur_group_id || existing.split_group_id)) {
      mov.tipoConsumo = 'COMUN'; mov.esSplit = false; mov.idTarjetaCuotas = null;
    }
    return createMovimiento({ ...req, body: mov, seriesGroupId: scope === 'SERIES' ? existing.recur_group_id : null }, res);
  }
  const payload = {
    fecha: mov.fecha, id_categoria: mov.idCategoria, descripcion: mov.descripcion,
    importe: mov.importe, medio_pago: mov.medioPago,
    ...(mov.idCuenta ? { id_cuenta_principal: mov.idCuenta } : {}),
    ...(mov.tipo ? { tipo_mov: mov.tipo } : {}),
    ...(mov.moneda ? { moneda: mov.moneda } : {})
  };
  await db.from('movimientos').update(payload).eq('id_movimiento', id).eq('user_id', userId);
  if (existing.id_consumo_tarjeta_origen) {
    await db.from('consumos_tc').update({ fecha: mov.fecha, id_categoria: mov.idCategoria, descripcion: mov.descripcion, importe: mov.importe, ...(mov.moneda ? { moneda: mov.moneda } : {}) }).eq('id_consumo_tarjeta', existing.id_consumo_tarjeta_origen).eq('user_id', userId);
  }
  return res.status(200).json({ success: true, data: {} });
}
