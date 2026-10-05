import { civilDate, monthBounds } from '../shared/finance.js';

export function inputError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function validateFinancialInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw inputError('Datos inválidos.');
  for (const key of ['importe', 'precio', 'cantidad']) if (value[key] !== undefined && (!Number.isFinite(Number(value[key])) || Number(value[key]) <= 0)) throw inputError(`${key} debe ser positivo y finito.`);
  if (value.moneda && !['ARS', 'USD'].includes(value.moneda)) throw inputError('Moneda inválida.');
  if (value.fecha) civilDate(value.fecha);
  if (value.periodos !== undefined && (!Number.isInteger(Number(value.periodos)) || Number(value.periodos) < 1 || Number(value.periodos) > 120)) throw inputError('Los períodos deben estar entre 1 y 120.');
  if (value.tipoConsumo && !['COMUN', 'SIMPLE', 'CUOTAS', 'RECURRENTE'].includes(value.tipoConsumo)) throw inputError('Tipo de consumo inválido.');
  if (value.tipoConsumo === 'CUOTAS' || value.tipo === 'CUOTAS') {
    const a = Number(value.cuotaActual ?? value.cuota_actual), b = Number(value.cuotaTotal ?? value.cuota_total);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a || b > 120) throw inputError('Cuotas inválidas.');
  }
  for (const key of ['porcentajeYo', 'porcentajeImputado']) if (value[key] !== undefined && (!Number.isFinite(Number(value[key])) || Number(value[key]) < 0 || Number(value[key]) > 100)) throw inputError('Porcentaje inválido.');
  if (value.splitDestinos) {
    if (!Array.isArray(value.splitDestinos) || value.splitDestinos.length > 20) throw inputError('Distribución inválida.');
    let total = 0;
    for (const dest of value.splitDestinos) { const pct = Number(dest.pct); if (!dest.cuenta || !Number.isFinite(pct) || pct <= 0) throw inputError('Destino inválido.'); total += pct; }
    if (total > 100) throw inputError('La distribución supera el 100%.');
  }
  if (value.consumos) {
    if (!Array.isArray(value.consumos) || value.consumos.length > 1000) throw inputError('Lote demasiado grande.');
    value.consumos.forEach(validateFinancialInput);
  }
  if (value.scope && !['SINGLE', 'GROUP', 'SERIES', 'ALL', 'MONTH', 'MONTH_AND_FUTURE'].includes(value.scope)) throw inputError('Alcance inválido.');
  if (['MONTH', 'MONTH_AND_FUTURE'].includes(value.scope)) {
    if (value.mes) monthBounds(value.mes);
    else { if (!value.fechaInicio || (value.scope === 'MONTH' && !value.fechaFin)) throw inputError('El período es obligatorio.'); civilDate(value.fechaInicio); if (value.fechaFin) civilDate(value.fechaFin); }
  }
  if (value.data) validateFinancialInput(value.data);
  for (const key of ['importe','precio','cantidad','cuotaActual','cuotaTotal','periodos','porcentajeYo','porcentajeImputado']) if(value[key] !== undefined) value[key]=Number(value[key]);
  return value;
}

export async function saveOwned(supabase, table, pk, payload, userId, fields) {
  const clean = Object.fromEntries(Object.entries(payload).filter(([k]) => fields.includes(k) || k === pk));
  clean.user_id = userId;
  if(clean.nombre!==undefined && (typeof clean.nombre!=='string' || !clean.nombre.trim() || clean.nombre.length>160)) throw inputError('Nombre inválido.');
  for(const key of ['fecha_proxima','fecha_cierre_actual','fecha_vencimiento_actual']) if(clean[key]) civilDate(clean[key]);
  for(const key of ['total_resumen_ars','total_resumen_usd']) if(clean[key]!==undefined && clean[key]!==null && (!Number.isFinite(Number(clean[key])) || Number(clean[key])<0)) throw inputError('Total del resumen inválido.');
  if(table==='recordatorios') {
    if(clean.frecuencia && !['UNICA','MENSUAL','DIAS_HABILES'].includes(clean.frecuencia)) throw inputError('Frecuencia inválida.');
    if(clean.dia_mes!=null && (!Number.isInteger(Number(clean.dia_mes)) || Number(clean.dia_mes)<1 || Number(clean.dia_mes)>31)) throw inputError('Día del mes inválido.');
    if(clean.dia_habil!=null && (!Number.isInteger(Number(clean.dia_habil)) || Number(clean.dia_habil)<1 || Number(clean.dia_habil)>23)) throw inputError('Día hábil inválido.');
    if(clean.mensaje && String(clean.mensaje).length>3500) throw inputError('Recordatorio demasiado largo.');
  }
  const { data: existing, error: lookupError } = await supabase.from(table).select(`${pk},user_id`).eq(pk, clean[pk]).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing && existing.user_id !== userId) throw inputError('La entidad no pertenece al usuario.', 403);
  if (clean.id_cuenta_principal) {
    const { data: account, error } = await supabase.from('cuentas_principales').select('id_cuenta_principal').eq('id_cuenta_principal', clean.id_cuenta_principal).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!account) throw inputError('La cuenta no pertenece al usuario.', 403);
  }
  const query = existing ? supabase.from(table).update(clean).eq(pk, clean[pk]).eq('user_id', userId) : supabase.from(table).insert(clean);
  return query.select().single();
}
