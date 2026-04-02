/**
 * SISTEMA DE GESTIÓN FINANCIERA - BACKEND (Schema)
 * v3.0.0 (Sprint 4 - Migración Supabase)
 */

function api_runSchemaSync() {
  _requireOwner();
  Logger.log('[Schema -> api_runSchemaSync] Verificando conectividad con Supabase...');
  try {
    const result = pgSelect('cuentas_principales', {}, 'id_cuenta_principal', null, 1);
    Logger.log('[Schema -> api_runSchemaSync] Conectividad OK. Filas de prueba: ' + result.length);
    return { success: true, message: 'Conectividad con Supabase verificada correctamente.' };
  } catch (e) {
    Logger.log('[Schema -> api_runSchemaSync] ERROR: ' + e.message);
    return { success: false, error: e.message };
  }
}
