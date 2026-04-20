export default async function handler(req, res) {
  // Mock endpoint for QA
  return res.status(200).json({
    success: true,
    kpis: { saldoNeto: -15000, gastoYo: 10000, gastoOtro: 25000 },
    consumos: [
      { pagador: 'OTRO', importe: 25000, categoria_nombre: 'Salidas', porcentaje_imputado: 100 },
      { pagador: 'YO', importe: 10000, categoria_nombre: 'Servicios', porcentaje_imputado: 100 }
    ]
  });
}
