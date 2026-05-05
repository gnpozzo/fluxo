import { createClient } from '@supabase/supabase-js';

export function getSupabaseClient(req) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  
  if (!url || !anonKey) {
    throw new Error('Missing Supabase variables in environment config.');
  }

  // Create an authenticated client if an Authorization header exists
  const authHeader = req.headers.authorization;
  const options = authHeader ? { global: { headers: { Authorization: authHeader } } } : {};
  
  return createClient(url, anonKey, options);
}
