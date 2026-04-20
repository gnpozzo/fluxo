export default async function handler(req, res) {
  // Mock endpoint for QA
  return res.status(200).json({
    success: true,
    kpis: { arsTotal: 250000, usdTotal: 1200, consolidadoArs: 1450000 },
    subcuentas: [
      { id_subcuenta: 'a1', nombre: 'Fondo Emergencia', moneda: 'ARS' },
      { id_subcuenta: 'a2', nombre: 'Viaje', moneda: 'USD' }
    ],
    transferencias: [
      { id_subcuenta: 'a1', importe: 50000, tipo_transfer: 'DEPOSITO' },
      { id_subcuenta: 'a2', importe: 200, tipo_transfer: 'DEPOSITO' }
    ]
  });
}
