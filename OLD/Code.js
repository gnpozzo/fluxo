'use strict';
/**
 * SISTEMA DE GESTIÓN FINANCIERA - BACKEND (Archivo Principal)
 * v5.0.0
 *
 * Cambios v5.0.0:
 * - [REFACTOR] 'use strict' a nivel de archivo
 * - [NUEVO] APP_NAME: constante para el título de la app en el template
 * - [ESTANDAR] APP_VERSION actualizado a v5.0.0
 * - [ESTANDAR] Logs estructurados: [Code → función → acción]
 *
 * Cambios v3.0.0 (mantenidos):
 * - SUPABASE_URL / SUPABASE_KEY desde PropertiesService
 * - _requireOwner(): guard de autenticación para operaciones peligrosas
 * - api_getInitialData() y api_getUserInfo() con formato { success, data/error }
 */

//==================================================================
// 1. CONFIGURACIÓN GLOBAL DEL PROYECTO
//==================================================================

const _scriptProps = PropertiesService.getScriptProperties();

/** URL del proyecto Supabase. Ej: 'https://ltmpajstmrcmxezpfusn.supabase.co' */
const SUPABASE_URL = _scriptProps.getProperty('SUPABASE_URL');

/**
 * Key de Supabase para el backend GAS.
 * Lee 'SUPABASE_ANON_KEY' (la que ya está configurada en PropertiesService).
 *
 * IMPORTANTE: para evitar problemas con RLS, lo ideal es usar la service_role key
 * (Supabase → Settings → API → service_role) y guardarla como 'SUPABASE_ANON_KEY'
 * o agregar una nueva propiedad 'SUPABASE_SERVICE_KEY'.
 * El backend GAS es server-side y nunca expone esta key al browser.
 */
const SUPABASE_KEY = _scriptProps.getProperty('SUPABASE_ANON_KEY');

const APP_VERSION = 'v5.0.0';
const APP_NAME    = 'Sistema de Gestión Financiera';

// Validación en startup
if (!SUPABASE_URL || !SUPABASE_KEY) {
  Logger.log('[Code → startup → ADVERTENCIA] SUPABASE_URL o SUPABASE_ANON_KEY no configurados en PropertiesService.');
}

//==================================================================
// 2. GUARD DE AUTENTICACIÓN
//==================================================================

/**
 * Verifica que el usuario activo sea el propietario del sistema.
 * Lanza un Error si el acceso no está autorizado.
 *
 * Usar como primera línea en funciones peligrosas:
 *   · api_runSchemaSync()  (Schema.js)
 *   · seedDatabase()       (Seeding.js)
 *
 * @throws {Error} Si OWNER_EMAIL no está configurado o el usuario no es el propietario.
 */
function _requireOwner() {
  const ownerEmail = _scriptProps.getProperty('OWNER_EMAIL');

  if (!ownerEmail) {
    Logger.log('[Code → _requireOwner → ERROR] Propiedad OWNER_EMAIL no configurada en PropertiesService.');
    throw new Error('[Auth] Acceso bloqueado: la propiedad OWNER_EMAIL no está configurada. Contacte al administrador.');
  }

  const activeEmail = Session.getActiveUser().getEmail();

  // No loguear el email activo (PII). Solo loguear si falla.
  if (activeEmail !== ownerEmail) {
    Logger.log('[Code → _requireOwner → denegado] Usuario no autorizado.');
    throw new Error('[Auth] Acceso denegado: solo el propietario puede ejecutar esta operación.');
  }

  Logger.log('[Code → _requireOwner → OK] Acceso autorizado.');
}

//==================================================================
// 3. FUNCIÓN BOOTSTRAP (PARA SERVIR EL HTML)
//==================================================================

function doGet(e) {
  const template    = HtmlService.createTemplateFromFile('index');
  template.APP_NAME = APP_NAME;
  return template.evaluate()
    .setTitle(APP_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

//==================================================================
// 4. API - FUNCIONES GLOBALES DE LA APP
//==================================================================

function api_getInitialData() {
  Logger.log('[Code → api_getInitialData → inicio]');
  try {
    const cuentas = pgSelect(
      'cuentas_principales',
      { activa: PG.eq('true') },
      'id_cuenta_principal,nombre,moneda_principal,es_predeterminada,activa,fecha_creacion,modulo_tarjetas_activo,modulo_cc_activo,modulo_ahorro_activo,modulo_inversiones_activo',
      'es_predeterminada.desc,nombre.asc'
    );
    Logger.log('[Code → api_getInitialData → cuentas] ' + cuentas.length);

    const categorias = pgSelect(
      'categorias',
      { activa: PG.eq('true') },
      '*',
      'tipo_mov.asc,nombre.asc'
    );
    Logger.log('[Code → api_getInitialData → categorias] ' + categorias.length);

    const tarjetas = pgSelect(
      'tarjetas',
      { activa: PG.eq('true') },
      '*',
      'id_cuenta_principal.asc,nombre.asc'
    );
    Logger.log('[Code → api_getInitialData → tarjetas] ' + tarjetas.length);

    const usuarios_cc = pgSelect(
      'cta_corriente_usuarios',
      {},
      '*',
      'nombre.asc'
    );
    Logger.log('[Code → api_getInitialData → usuarios_cc] ' + usuarios_cc.length);

    return { success: true, cuentas: cuentas, categorias: categorias, tarjetas: tarjetas, usuarios_cc: usuarios_cc };

  } catch (e) {
    Logger.log('[Code → api_getInitialData → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_getUserInfo() {
  Logger.log('[Code → api_getUserInfo → inicio]');
  try {
    const email = Session.getActiveUser().getEmail();
    // No loguear el email — es PII.
    Logger.log('[Code → api_getUserInfo → OK]');
    return { success: true, email: email };
  } catch (e) {
    Logger.log('[Code → api_getUserInfo → ERROR] ' + e.message);
    return { success: false, email: 'Usuario no disponible' };
  }
}

function api_getNotificaciones(idCuenta, mesYYYYMM) {
  Logger.log('[Code → api_getNotificaciones → inicio] ' + mesYYYYMM);
  try {
    const notificaciones = [];
    const dateStart = mesYYYYMM + '-01';
    const parts = dateStart.split('-');
    const endM = new Date(Date.UTC(parts[0], parts[1], 0));
    const dateEnd = endM.toISOString().split('T')[0];

    const consumos = pgRpc('get_consumos_tc_list', {
      p_id_cuenta: idCuenta,
      p_fecha_inicio: dateStart,
      p_fecha_fin: dateEnd
    });

    if (consumos && consumos.length > 0) {
      consumos.forEach(function(c) {
         if (c.cuota_total > 1 && c.cuota_actual === c.cuota_total) {
            notificaciones.push({
               id: c.id_consumo_tarjeta + '_fin',
               tipo: 'info',
               icono: 'check_circle',
               titulo: 'Última Cuota en Tarjeta',
               mensaje: 'El consumo "' + c.descripcion + '" finaliza este mes.',
               importe: c.importe
            });
         } else if (c.cuota_total > 1 && c.cuota_actual === 1) {
            notificaciones.push({
               id: c.id_consumo_tarjeta + '_nuevo',
               tipo: 'ingreso',
               icono: 'fiber_new',
               titulo: 'Nuevo Consumo en Cuotas',
               mensaje: 'Inicia la 1° cuota de "' + c.descripcion + '".',
               importe: c.importe
            });
         }
      });
    }

    return { success: true, data: notificaciones };
  } catch (e) {
    Logger.log('[Code → api_getNotificaciones → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}
