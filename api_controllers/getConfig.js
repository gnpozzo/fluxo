export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  
  return res.status(200).json({
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || ''
  });
}
