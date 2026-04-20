
// [Origen -> api -> API_Admin.js]
// Migración REST transicional (Las funciones contenían: 'use strict';/** * SISTEMA DE GESTIÓN FINANCIERA - BACKEND (API Panel de Administración) * v5.0.0...)
// Se debe migrar cada sub-función usando el supabase-js client tal como en getDashboardData.js

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Not allowed');
  return res.status(501).json({ success: false, error: 'Endpoint sin transicionar. Por favor actualizar backend Edge.' });
}
/* CODIGO ORIGINAL MANTENIDO POR TRAZABILIDAD:
'use strict';
/**
 * SISTEMA DE GESTIÓN FINANCIERA - BACKEND (API Panel de Administración)
 * v5.0.0
 *
 * Cambios v5.0.0:
 * - [REFACTOR] 'use strict' a nivel de archivo
 * - [ESTANDAR] Respuesta unificada: { success: true, data } / { success: false, error }
 * - [ESTANDAR] Logs estructurados: [API_Admin → función → acción]
 *
 * Cambios v3.0.0 (mantenidos):
 * - Todas las queries usan pgSelect / pgInsert / pgUpdate
 * - api_admin_getTarjetas() y api_admin_getCategorias(): JOIN resuelto en JS
 */

//==================================================================
// 1. SECCIÓN: CUENTAS PRINCIPALES
//==================================================================

function api_admin_getCuentasPrincipales() {
  Logger.log('[API_Admin → api_admin_getCuentasPrincipales → inicio]');
  try {
    const data = pgSelect(
      'cuentas_principales',
      {},
      'id_cuenta_principal,nombre,moneda_principal,es_predeterminada,activa,fecha_creacion,modulo_tarjetas_activo,modulo_ahorro_activo,modulo_cc_activo',
      'fecha_creacion.desc'
    );
    Logger.log('[API_Admin → api_admin_getCuentasPrincipales → OK] ' + data.length);
    return { success: true, data: data };

  } catch (e) {
    Logger.log('[API_Admin → api_admin_getCuentasPrincipales → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_admin_saveCuentaPrincipal(cuentaData) {
  Logger.log('[API_Admin → api_admin_saveCuentaPrincipal → inicio]');
  try {
    validateRequired(cuentaData, ['nombre', 'moneda_principal']);

    const id_cuenta_principal    = cuentaData.id_cuenta_principal;
    const nombre                 = cuentaData.nombre;
    const moneda_principal       = cuentaData.moneda_principal;
    const es_predeterminada      = cuentaData.es_predeterminada      !== undefined ? cuentaData.es_predeterminada      : false;
    const activa                 = cuentaData.activa                 !== undefined ? cuentaData.activa                 : true;
    const modulo_tarjetas_activo = cuentaData.modulo_tarjetas_activo !== undefined ? cuentaData.modulo_tarjetas_activo : false;
    const modulo_ahorro_activo   = cuentaData.modulo_ahorro_activo   !== undefined ? cuentaData.modulo_ahorro_activo   : false;
    const modulo_cc_activo       = cuentaData.modulo_cc_activo       !== undefined ? cuentaData.modulo_cc_activo       : false;

    let isNew = false;

    if (id_cuenta_principal) {
      Logger.log('[API_Admin → api_admin_saveCuentaPrincipal → update] ' + id_cuenta_principal);
      pgUpdate(
        'cuentas_principales',
        { id_cuenta_principal: PG.eq(id_cuenta_principal) },
        {
          nombre:                 nombre,
          moneda_principal:       moneda_principal,
          es_predeterminada:      es_predeterminada,
          activa:                 activa,
          modulo_tarjetas_activo: modulo_tarjetas_activo,
          modulo_ahorro_activo:   modulo_ahorro_activo,
          modulo_cc_activo:       modulo_cc_activo
        }
      );

    } else {
      isNew = true;
      const newId = generateUUID();
      Logger.log('[API_Admin → api_admin_saveCuentaPrincipal → insert] ' + newId);
      pgInsert('cuentas_principales', {
        id_cuenta_principal:    newId,
        nombre:                 nombre,
        moneda_principal:       moneda_principal,
        es_predeterminada:      es_predeterminada,
        activa:                 activa,
        modulo_tarjetas_activo: modulo_tarjetas_activo,
        modulo_ahorro_activo:   modulo_ahorro_activo,
        modulo_cc_activo:       modulo_cc_activo
        // fecha_creacion: DEFAULT now() en Postgres
      });
      cuentaData.id_cuenta_principal = newId;
      cuentaData.fecha_creacion      = new Date().toISOString();
    }

    Logger.log('[API_Admin → api_admin_saveCuentaPrincipal → OK] ' + cuentaData.id_cuenta_principal);
    return { success: true, data: cuentaData, isNew: isNew };

  } catch (e) {
    Logger.log('[API_Admin → api_admin_saveCuentaPrincipal → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_admin_deleteCuentaPrincipal(id) {
  Logger.log('[API_Admin → api_admin_deleteCuentaPrincipal → inicio] ' + id);
  try {
    pgDelete('cuentas_principales', { id_cuenta_principal: PG.eq(id) });
    Logger.log('[API_Admin → api_admin_deleteCuentaPrincipal → OK] ' + id);
    return { success: true, message: 'Cuenta eliminada correctamente.' };
  } catch (e) {
    Logger.log('[API_Admin → api_admin_deleteCuentaPrincipal → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

//==================================================================
// 2. SECCIÓN: TARJETAS
//==================================================================

function api_admin_getTarjetas() {
  Logger.log('[API_Admin → api_admin_getTarjetas → inicio]');
  try {
    const tarjetas = pgSelect('tarjetas', {}, '*', 'nombre.asc');

    // JOIN en JS: enriquecer con nombre de cuenta (conjunto pequeño)
    if (tarjetas.length > 0) {
      const cuentas    = pgSelect('cuentas_principales', {}, 'id_cuenta_principal,nombre');
      const cuentaMap  = {};
      cuentas.forEach(function(c) { cuentaMap[c.id_cuenta_principal] = c.nombre; });
      tarjetas.forEach(function(t) {
        t.nombre_cuenta_principal = cuentaMap[t.id_cuenta_principal] || null;
      });
    }

    Logger.log('[API_Admin → api_admin_getTarjetas → OK] ' + tarjetas.length);
    return { success: true, data: tarjetas };

  } catch (e) {
    Logger.log('[API_Admin → api_admin_getTarjetas → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_admin_saveTarjeta(tarjetaData) {
  Logger.log('[API_Admin → api_admin_saveTarjeta → inicio]');
  try {
    validateRequired(tarjetaData, ['id_cuenta_principal', 'nombre', 'dia_cierre_resumen', 'dia_vencimiento_resumen']);

    const id_tarjeta             = tarjetaData.id_tarjeta;
    const id_cuenta_principal    = tarjetaData.id_cuenta_principal;
    const nombre                 = tarjetaData.nombre;
    const banco                  = tarjetaData.banco || null;
    const ultimos_4_digitos      = tarjetaData.ultimos_4_digitos || null;
    const diaC                   = parseInt(tarjetaData.dia_cierre_resumen, 10);
    const diaV                   = parseInt(tarjetaData.dia_vencimiento_resumen, 10);
    const activa                 = tarjetaData.activa !== undefined ? tarjetaData.activa : true;

    let isNew = false;

    if (id_tarjeta) {
      Logger.log('[API_Admin → api_admin_saveTarjeta → update] ' + id_tarjeta);
      pgUpdate(
        'tarjetas',
        { id_tarjeta: PG.eq(id_tarjeta) },
        {
          id_cuenta_principal:     id_cuenta_principal,
          nombre:                  nombre,
          banco:                   banco,
          ultimos_4_digitos:       ultimos_4_digitos,
          dia_cierre_resumen:      diaC,
          dia_vencimiento_resumen: diaV,
          activa:                  activa
        }
      );

    } else {
      isNew = true;
      const newId = generateUUID();
      Logger.log('[API_Admin → api_admin_saveTarjeta → insert] ' + newId);
      pgInsert('tarjetas', {
        id_tarjeta:              newId,
        id_cuenta_principal:     id_cuenta_principal,
        nombre:                  nombre,
        banco:                   banco,
        ultimos_4_digitos:       ultimos_4_digitos,
        dia_cierre_resumen:      diaC,
        dia_vencimiento_resumen: diaV,
        activa:                  activa
      });
      tarjetaData.id_tarjeta = newId;
    }

    Logger.log('[API_Admin → api_admin_saveTarjeta → OK] ' + tarjetaData.id_tarjeta);
    return { success: true, data: tarjetaData, isNew: isNew };

  } catch (e) {
    Logger.log('[API_Admin → api_admin_saveTarjeta → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_admin_deleteTarjeta(id) {
  Logger.log('[API_Admin → api_admin_deleteTarjeta → inicio] ' + id);
  try {
    pgDelete('tarjetas', { id_tarjeta: PG.eq(id) });
    Logger.log('[API_Admin → api_admin_deleteTarjeta → OK] ' + id);
    return { success: true, message: 'Tarjeta eliminada correctamente.' };
  } catch (e) {
    Logger.log('[API_Admin → api_admin_deleteTarjeta → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

//==================================================================
// 3. SECCIÓN: CATEGORÍAS
//==================================================================

function api_admin_getCategorias() {
  Logger.log('[API_Admin → api_admin_getCategorias → inicio]');
  try {
    const categorias = pgSelect(
      'categorias',
      {},
      'id_categoria,id_cuenta,nombre,tipo_mov,activa,presupuesto_mensual',
      'tipo_mov.asc,nombre.asc'
    );

    // JOIN en JS: enriquecer con nombre de cuenta
    if (categorias.length > 0) {
      const cuentas   = pgSelect('cuentas_principales', {}, 'id_cuenta_principal,nombre');
      const cuentaMap = {};
      cuentas.forEach(function(c) { cuentaMap[c.id_cuenta_principal] = c.nombre; });
      categorias.forEach(function(cat) {
        cat.nombre_cuenta_principal = cat.id_cuenta ? (cuentaMap[cat.id_cuenta] || null) : null;
      });
    }

    Logger.log('[API_Admin → api_admin_getCategorias → OK] ' + categorias.length);
    return { success: true, data: categorias };

  } catch (e) {
    Logger.log('[API_Admin → api_admin_getCategorias → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_admin_saveCategoria(categoriaData) {
  Logger.log('[API_Admin → api_admin_saveCategoria → inicio]');
  try {
    validateRequired(categoriaData, ['nombre', 'tipo_mov']);

    const id_categoria       = categoriaData.id_categoria;
    const id_cuenta          = categoriaData.id_cuenta || null;
    const nombre             = categoriaData.nombre;
    const tipo_mov           = categoriaData.tipo_mov;
    const activa             = categoriaData.activa !== undefined ? categoriaData.activa : true;
    const presupuesto        = categoriaData.presupuesto_mensual ? parseFloat(categoriaData.presupuesto_mensual) : null;

    let isNew = false;

    if (id_categoria) {
      Logger.log('[API_Admin → api_admin_saveCategoria → update] ' + id_categoria);
      pgUpdate(
        'categorias',
        { id_categoria: PG.eq(id_categoria) },
        {
          id_cuenta:           id_cuenta,
          nombre:              nombre,
          tipo_mov:            tipo_mov,
          activa:              activa,
          presupuesto_mensual: presupuesto
        }
      );

    } else {
      isNew = true;
      const newId = generateUUID();
      Logger.log('[API_Admin → api_admin_saveCategoria → insert] ' + newId);
      pgInsert('categorias', {
        id_categoria:        newId,
        id_cuenta:           id_cuenta,
        nombre:              nombre,
        tipo_mov:            tipo_mov,
        activa:              activa,
        presupuesto_mensual: presupuesto
      });
      categoriaData.id_categoria = newId;
    }

    Logger.log('[API_Admin → api_admin_saveCategoria → OK] ' + categoriaData.id_categoria);
    return { success: true, data: categoriaData, isNew: isNew };

  } catch (e) {
    Logger.log('[API_Admin → api_admin_saveCategoria → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_admin_deleteCategoria(id) {
  Logger.log('[API_Admin → api_admin_deleteCategoria → inicio] ' + id);
  try {
    pgDelete('categorias', { id_categoria: PG.eq(id) });
    Logger.log('[API_Admin → api_admin_deleteCategoria → OK] ' + id);
    return { success: true, message: 'Categoría eliminada correctamente.' };
  } catch (e) {
    Logger.log('[API_Admin → api_admin_deleteCategoria → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

//==================================================================
// 4. SECCIÓN: AHORRO Y CTA. CORRIENTE (Pendientes de implementación)
//==================================================================

function api_admin_getAhorroSubcuentas() {
  Logger.log('[API_Admin → api_admin_getAhorroSubcuentas → inicio]');
  try {
    const data = pgSelect('ahorro_subcuentas', {}, 'id_subcuenta,nombre,moneda', 'nombre.asc');
    return { success: true, data: data };
  } catch(e) {
    Logger.log('[API_Admin → api_admin_getAhorroSubcuentas → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_admin_saveAhorroSubcuenta(data) {
  Logger.log('[API_Admin → api_admin_saveAhorroSubcuenta → inicio]');
  try {
    validateRequired(data, ['nombre', 'moneda']);
    let isNew = false;
    const id = data.id_subcuenta;
    if (id) {
      pgUpdate('ahorro_subcuentas', { id_subcuenta: PG.eq(id) }, {
        nombre: sanitizeString(data.nombre, 100),
        moneda: data.moneda
      });
    } else {
      isNew = true;
      data.id_subcuenta = generateUUID();
      pgInsert('ahorro_subcuentas', {
        id_subcuenta: data.id_subcuenta,
        nombre:       sanitizeString(data.nombre, 100),
        moneda:       data.moneda
      });
    }
    return { success: true, data: data, isNew: isNew };
  } catch(e) {
    Logger.log('[API_Admin → api_admin_saveAhorroSubcuenta → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_admin_deleteAhorroSubcuenta(id) {
  Logger.log('[API_Admin → api_admin_deleteAhorroSubcuenta → inicio] ' + id);
  try {
    pgDelete('ahorro_subcuentas', { id_subcuenta: PG.eq(id) });
    return { success: true, message: 'Subcuenta eliminada correctamente.' };
  } catch(e) {
    Logger.log('[API_Admin → api_admin_deleteAhorroSubcuenta → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_admin_getCtaCorrienteUsuarios() {
  Logger.log('[API_Admin → api_admin_getCtaCorrienteUsuarios → inicio]');
  try {
    const data = pgSelect('cta_corriente_usuarios', {}, 'id_usuario,nombre', 'nombre.asc');
    return { success: true, data: data };
  } catch(e) {
    Logger.log('[API_Admin → api_admin_getCtaCorrienteUsuarios → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_admin_saveCtaCorrienteUsuario(data) {
  Logger.log('[API_Admin → api_admin_saveCtaCorrienteUsuario → inicio]');
  try {
    validateRequired(data, ['nombre']);
    let isNew = false;
    const id = data.id_usuario;
    if (id) {
      pgUpdate('cta_corriente_usuarios', { id_usuario: PG.eq(id) }, {
        nombre: data.nombre
      });
    } else {
      isNew = true;
      data.id_usuario = generateUUID();
      pgInsert('cta_corriente_usuarios', {
        id_usuario: data.id_usuario,
        nombre: data.nombre
      });
    }
    return { success: true, data: data, isNew: isNew };
  } catch(e) {
    Logger.log('[API_Admin → api_admin_saveCtaCorrienteUsuario → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_admin_deleteCtaCorrienteUsuario(id) {
  Logger.log('[API_Admin → api_admin_deleteCtaCorrienteUsuario → inicio] ' + id);
  try {
    pgDelete('cta_corriente_usuarios', { id_usuario: PG.eq(id) });
    return { success: true, message: 'Usuario eliminado correctamente.' };
  } catch(e) {
    Logger.log('[API_Admin → api_admin_deleteCtaCorrienteUsuario → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

*/
