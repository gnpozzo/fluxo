export default async function handler(req, res) {
  return res.status(200).json({ success: true, bolsa: { compra: 1000, venta: 1050 } });
}
