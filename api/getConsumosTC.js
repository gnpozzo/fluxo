export default async function handler(req, res) {
  // Mock endpoint for QA when Supabase is not configured
  return res.status(200).json({
    success: true,
    consumos: [
      { id_tarjeta: 't1', importe: 125000, marca: 'VISA', ultimos_4: '4321', nombre: 'Mock Titular' },
      { id_tarjeta: 't2', importe: 45000, marca: 'MASTERCARD', ultimos_4: '8899', nombre: 'Mock Titular' }
    ]
  });
}
