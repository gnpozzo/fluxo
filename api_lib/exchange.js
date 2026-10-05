import { inputError } from './validation.js';

// Booking exchange rates must be explicit or dated; never invent a fallback.
export async function bookingRate(supabase, payload) {
  const supplied = payload.tipoCambio ?? payload.tipo_cambio;
  if (supplied !== undefined) {
    const rate = Number(supplied);
    if (!Number.isFinite(rate) || rate <= 0) throw inputError('Tipo de cambio inválido.');
    return rate;
  }
  const { data, error } = await supabase.from('cotizaciones_dolar').select('*').order('fecha', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  const rate = Number(data?.venta ?? data?.valor);
  const timestamp = Date.parse(data?.fecha || '');
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(timestamp) || Date.now() - timestamp > 3 * 86400000) {
    throw inputError('Indicá el tipo de cambio de la operación: no hay una cotización reciente disponible.');
  }
  return rate;
}
