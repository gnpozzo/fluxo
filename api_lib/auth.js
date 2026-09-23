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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resuelve una referencia de cuenta (UUID, nombre o fallback) al id_cuenta_principal (UUID)
 * perteneciente legítimamente al usuario autenticado.
 * Previene ataques IDOR y errores de sintaxis Postgres (22P02).
 */
export async function resolveUserCuenta(supabase, idCuenta, userId) {
  if (!userId) return null;
  try {
    const rawId = typeof idCuenta === 'string' ? idCuenta.trim() : '';

    // 1. Si es un UUID válido, verificar directamente pertenencia al usuario
    if (rawId && UUID_REGEX.test(rawId)) {
      const { data, error } = await supabase
        .from('cuentas_principales')
        .select('id_cuenta_principal')
        .eq('id_cuenta_principal', rawId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data?.id_cuenta_principal) {
        return data.id_cuenta_principal;
      }
    }

    // 2. Consultar cuentas del usuario para emparejar por nombre o fallback
    const { data: accounts, error: accError } = await supabase
      .from('cuentas_principales')
      .select('id_cuenta_principal, nombre, es_predeterminada, activa')
      .eq('user_id', userId)
      .order('es_predeterminada', { ascending: false });

    if (accError || !accounts || accounts.length === 0) {
      return null;
    }

    if (rawId) {
      const search = rawId.toLowerCase();
      // Búsqueda por coincidencia de ID exacto o nombre exacto
      const byId = accounts.find(a => a.id_cuenta_principal && a.id_cuenta_principal.toLowerCase() === search);
      if (byId) return byId.id_cuenta_principal;

      const byName = accounts.find(a => a.nombre && a.nombre.trim().toLowerCase() === search);
      if (byName) return byName.id_cuenta_principal;
    }

    // 3. Si idCuenta es 'Principal', 'Gastos', vacío o fallback no encontrado, usar la predeterminada o primera activa
    if (!rawId || rawId.toLowerCase() === 'principal' || rawId.toLowerCase() === 'gastos') {
      const def = accounts.find(a => a.es_predeterminada && a.activa !== false)
               || accounts.find(a => a.es_predeterminada)
               || accounts.find(a => a.activa !== false)
               || accounts[0];
      return def ? def.id_cuenta_principal : null;
    }

    return null;
  } catch (err) {
    console.error('[resolveUserCuenta] Error:', err);
    return null;
  }
}

/**
 * Valida que una cuenta principal pertenezca legítimamente al usuario autenticado.
 * Previene ataques IDOR (Insecure Direct Object Reference).
 */
export async function verifyCuentaOwnership(supabase, idCuenta, userId) {
  if (!idCuenta || !userId) return false;
  const resolved = await resolveUserCuenta(supabase, idCuenta, userId);
  return !!resolved;
}

