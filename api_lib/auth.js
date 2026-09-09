import { getSupabaseClient } from './supabase.js';

/**
 * Middleware centralizado de autenticación para endpoints serverless de Fluxo.
 * Valida el token JWT contra Supabase Auth y garantiza aislamiento multi-tenant.
 */
export async function authenticateUser(req, res) {
  const authHeader = req.headers?.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    res.status(401).json({
      success: false,
      error: 'No autenticado: Se requiere encabezado de autorización Bearer válido.'
    });
    return null;
  }

  try {
    const supabase = getSupabaseClient(req);
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      res.status(401).json({
        success: false,
        error: 'Sesión inválida o expirada. Inicia sesión nuevamente.'
      });
      return null;
    }

    req.user = data.user;
    return data.user;
  } catch (err) {
    res.status(401).json({
      success: false,
      error: 'Fallo al autenticar la petición: ' + err.message
    });
    return null;
  }
}

/**
 * Valida que una cuenta principal pertenezca legítimamente al usuario autenticado.
 * Previene ataques IDOR (Insecure Direct Object Reference).
 */
export async function verifyCuentaOwnership(supabase, idCuenta, userId) {
  if (!idCuenta || !userId) return false;
  try {
    const { data, error } = await supabase
      .from('cuentas_principales')
      .select('id_cuenta_principal')
      .eq('id_cuenta_principal', idCuenta)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return false;
    return true;
  } catch (_) {
    return false;
  }
}
