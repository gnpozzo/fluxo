import fs from 'node:fs';

export const projectRef = 'ltmpajstmrcmxezpfusn';
export async function management(path, body) {
  const env = fs.readFileSync('.env.supabase', 'utf8');
  const token = env.match(/^SUPABASE_ACCESS_TOKEN\s*=\s*(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '');
  if (!token) throw new Error('Falta SUPABASE_ACCESS_TOKEN en .env.supabase');
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Supabase Management HTTP ${response.status}: ${JSON.stringify(result)}`);
  return result;
}
export const query = sql => management('database/query', { query: sql });
