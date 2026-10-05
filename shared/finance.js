export function civilDate(value) {
  const s = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Object.assign(new Error('Fecha inválida (YYYY-MM-DD).'), {status:400});
  const d = new Date(`${s}T12:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw Object.assign(new Error('Fecha inválida.'), {status:400});
  return s;
}

export function addMonthsSafe(value, months) {
  const d = value instanceof Date ? new Date(value) : new Date(`${civilDate(value)}T12:00:00Z`);
  if (!Number.isInteger(months) || !Number.isFinite(d.getTime())) throw new Error('Período inválido.');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) throw Object.assign(new Error('Mes inválido (YYYY-MM).'), {status:400});
  const [y, m] = month.split('-').map(Number);
  return [civilDate(`${month}-01`), `${month}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`];
}

export function todayArgentina() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Importe inválido.');
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function sharedBalance(amount, percentage, payer) {
  const total = money(amount), pct = Number(percentage ?? 50);
  if (total < 0 || !Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error('Reparto inválido.');
  const own = money(total * pct / 100);
  return { own, balance: money(payer === 'YO' ? total - own : -own) };
}

// Allocate integer cents; the final share receives the rounding remainder.
export function allocateMoney(amount, percentages) {
  const cents = Math.round(money(amount) * 100);
  let allocated = 0;
  return percentages.map((pct, i) => {
    const part = i === percentages.length - 1 ? cents - allocated : Math.round(cents * pct / 100);
    allocated += part;
    return part / 100;
  });
}

// Chronological moving-average cost, including sales before later purchases.
export function holdings(operations) {
  const map = new Map();
  for (const op of [...operations].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.created_at || '').localeCompare(String(b.created_at || '')))) {
    const currency = op.moneda || 'ARS';
    const key = `${op.ticker}:${currency}`;
    const h = map.get(key) || { ticker: op.ticker, moneda: currency, quantity: 0, costArs: 0, costNative: 0, realizedArs: 0 };
    const quantity = Number(op.cantidad_nominales ?? op.cantidad);
    const total = Number(op.importe_total_ars ?? quantity * Number(op.precio_compra ?? op.precio));
    if (op.tipo_operacion === 'COMPRA') { h.quantity += quantity; h.costArs += total; h.costNative += quantity*Number(op.precio_compra ?? op.precio ?? 0); }
    else if (op.tipo_operacion === 'VENTA') {
      if (quantity > h.quantity + 0.000001) throw new Error(`Venta superior a la tenencia de ${op.ticker}.`);
      const cost = h.quantity > 0 ? h.costArs * quantity / h.quantity : 0;
      h.costNative *= h.quantity>0 ? (h.quantity-quantity)/h.quantity : 0;
      h.quantity -= quantity; h.costArs -= cost; h.realizedArs += total - cost;
    }
    map.set(key, h);
  }
  return [...map.values()];
}
