// Installments are metadata. Read legacy suffixes without changing stored history.
export function operationInfo(row = {}) {
  row ||= {};
  const raw = String(row.descripcion || '');
  const suffix = raw.match(/\s*\((?:Cuota\s+)?(\d+)\/(\d+)\)\s*$/i);
  const current = Number(row.cuota_actual ?? suffix?.[1] ?? 1);
  const total = Number(row.cuota_total ?? suffix?.[2] ?? 1);
  const valid = Number.isInteger(current) && Number.isInteger(total) && current > 0 && total >= current;
  const recurrent = row.tipo_consumo === 'RECURRENTE' || row.recur_group_id?.startsWith('REC_');
  const description = suffix && valid ? raw.slice(0, suffix.index).trim() : raw;
  const label = recurrent ? 'Recurrente' : valid && total > 1
    ? current === total ? 'Última cuota' : `Cuota ${current}/${total}`
    : 'Simple';
  return { description, label, current: valid ? current : 1, total: valid ? total : 1 };
}

export function isCardPurchase(row = {}) {
  if (row.id_consumo_tarjeta_origen || row.id_consumo_tarjeta || row.id_consumo_tc) return true;
  const method = String(row.medio_pago || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (method.includes('debito')) return false;
  return method.includes('credito') || method === 'tarjeta' || method === 'tc';
}

export function canTogglePayment(row = {}) {
  return row.tipo_mov === 'EGRESO' && !isCardPurchase(row) && !row.is_pago_tc && row.id_categoria !== 'CAT_PAGO_TC'
    && !row.descripcion?.toLowerCase().startsWith('pago resumen:');
}
