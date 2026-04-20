export default async function handler(req, res) {
  return res.status(200).json({ success: true, email: 'gaston.pozzo@tester.com' });
}
