import { createClient } from '@supabase/supabase-js';

export function getSupabaseClient(req) {
  if (req.db) return req.db;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  
  if (!url || !anonKey) {
    throw new Error('Missing Supabase variables in environment config.');
  }

  // User requests must retain their JWT so database policies remain effective.
  const keyToUse = anonKey;
  let options = {};

  const authHeader = req.headers?.authorization;
  if (authHeader) {
    options = { global: { headers: { Authorization: authHeader } } };
  }
  
  return createClient(url, keyToUse, options);
}
