export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error: 'Methosd Not Allowed'});
  return res.status(200).json({
    success: true,
    cuentas: [{ id_cuenta_principal: '1', nombre: 'Mock Cuenta', es_predeterminada: true, modulo_tarjetas_activo: true, modulo_cc_activo: true }],
    meses: ['2023-10'],
    categorias: [],
    tarjetas: [],
    usuarios_cc: []
  });
};