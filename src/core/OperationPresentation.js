import { operationInfo, canTogglePayment, isCardPurchase } from '../../shared/operation.js';

export { operationInfo };

export function operationBadge(row) {
  const { label } = operationInfo(row);
  return `<span class="badge operation-badge ${label === 'Última cuota' ? 'operation-last' : ''}">${App.Utils.escapeHtml(label)}</span>`;
}

export function paymentStatus(row) {
  if (row.tipo_mov === 'INGRESO' || row.es_consolidado) return '';
  const paid = Boolean(row.pagado), text = paid ? 'Pagado' : 'Pendiente';
  const css = `btn-toggle-pago ${paid ? 'pago-saldado' : 'pago-pendiente'}`;
  if (canTogglePayment(row)) {
    return `<button type="button" class="${css}" data-toggle-pago="${App.Utils.escapeHtml(row.id_movimiento)}" aria-label="${paid ? 'Marcar pendiente' : 'Marcar pagado'}: ${App.Utils.escapeHtml(operationInfo(row).description)}" title="Clic para marcar ${paid ? 'pendiente' : 'pagado'}">${text}</button>`;
  }
  return `<span class="${css} payment-readonly" title="${isCardPurchase(row) ? 'Se salda al registrar el pago de la tarjeta' : 'Pago registrado por la operación de origen'}">${text}</span>`;
}

export async function togglePayment(button, row) {
  button.disabled = true;
  try {
    const response = await App.API.fetch('/api/togglePago', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle', id: row.id_movimiento, pagado: !row.pagado })
    });
    if (!response?.success) throw new Error(response?.error || 'No se pudo actualizar el estado.');
    App.API.invalidateAll();
    App.Events.emit('data:changed');
    App.Toast.success(row.pagado ? 'Movimiento pendiente' : 'Movimiento pagado');
  } catch (error) {
    button.disabled = false;
    App.Toast.error(error.message);
  }
}
