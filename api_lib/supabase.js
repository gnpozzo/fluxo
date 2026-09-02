import { createClient } from '@supabase/supabase-js';

export function getSupabaseClient(req) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !anonKey) {
    throw new Error('Missing Supabase variables in environment config.');
  }

  // On trusted serverless backend endpoints, prioritize serviceKey to bypass RLS restrictions
  const keyToUse = serviceKey || anonKey;
  let options = {};

  const authHeader = req.headers?.authorization;
  if (authHeader && !serviceKey) {
    options = { global: { headers: { Authorization: authHeader } } };
  }
  
  return createClient(url, keyToUse, options);
}
