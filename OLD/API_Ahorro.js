'use strict';
/**
 * SISTEMA DE GESTIÓN FINANCIERA - BACKEND (API Módulo Ahorro)
 * v5.0.0
 *
 * Cambios v5.0.0:
 * - [REFACTOR] 'use strict' a nivel de archivo
 * - [REFACTOR] Conversión USD→ARS centralizada en fromUSD() de Utils.js
 * - [ESTANDAR] validateRequired() para validación de input
 * - [ESTANDAR] Logs estructurados: [API_Ahorro → función → acción]
 * - [ESTANDAR] Respuesta unificada: { success: true, data } / { success: false, error }
 *
 * Cambios v3.0.0 (mantenidos):
 * - api_getAhorros(): pgRpc para KPIs y lista
 * - api_createAhorro(): pgInsert en movimientos + pgInsert en ahorros (secuencial)
 */

function api_getAhorros(idCuenta, fechaInicio, fechaFin) {
  Logger.log('[API_Ahorro → api_getAhorros → inicio] cuenta:' + idCuenta + ' ' + fechaInicio + '/' + fechaFin);
  try {
    // KPIs: saldo acumulado por moneda (sin filtro de fecha — saldo histórico total)
    const kpisData = pgRpc('get_ahorros_kpis', { p_id_cuenta: idCuenta });

    // Lista de movimientos del período
    const movimientos = pgRpc('get_ahorros_list', {
      p_id_cuenta:    idCuenta,
      p_fecha_inicio: fechaInicio,
      p_fecha_fin:    fechaFin
    });

    const cotizacion = getUSDCotizacionOficial();
    if (cotizacion) {
      cotizacion.lastUpdated = new Date().toISOString();
      cotizacion.fecha       = new Date().toISOString().split('T')[0];
    }

    let arsTotal = 0;
    let usdTotal = 0;
    kpisData.forEach(function(row) {
      if (row.moneda === 'ARS') arsTotal = row.saldo;
      if (row.moneda === 'USD') usdTotal = row.saldo;
    });

    const cotizVenta     = cotizacion ? cotizacion.venta : 0;
    const consolidadoArs = arsTotal + (usdTotal * cotizVenta);

    const kpis = {
      arsTotal:       arsTotal,
      usdTotal:       usdTotal,
      consolidadoArs: consolidadoArs
    };

    const subcuentas = pgSelect('ahorro_subcuentas', {}, 'id_subcuenta,nombre,moneda', 'nombre.asc');

    Logger.log('[API_Ahorro → api_getAhorros → OK] movimientos:' + movimientos.length);
    return { success: true, kpis: kpis, transferencias: movimientos, cotizacion: cotizacion, subcuentas: subcuentas };

  } catch (e) {
    Logger.log('[API_Ahorro → api_getAhorros → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_createAhorro(ahorroData) {
  Logger.log('[API_Ahorro → api_createAhorro → inicio] tipo:' + ahorroData.tipo_transfer + ' moneda:' + ahorroData.moneda);
  try {
    validateRequired(ahorroData, ['idCuenta', 'fecha', 'tipo_transfer', 'moneda', 'importe', 'idSubcuenta']);

    const idCuenta     = ahorroData.idCuenta;
    const fecha        = ahorroData.fecha;
    const tipo_transfer = ahorroData.tipo_transfer;
    const moneda       = ahorroData.moneda;
    const importe      = Number(ahorroData.importe);
    const idSubcuenta  = ahorroData.idSubcuenta;
    const descripcion  = ahorroData.descripcion || '';

    const ID_CATEGORIA_AHORRO = 'CAT_AHORRO';

    let importePrincipal = importe;
    let desc_principal   = tipo_transfer + ' de Ahorro (' + moneda + ') - ' + descripcion;

    if (moneda === 'USD') {
      const cotizacion = getUSDCotizacionOficial();
      if (!cotizacion) {
        throw new Error('No se pudo obtener la cotización del dólar. Intente más tarde.');
      }
      importePrincipal = fromUSD(importe, cotizacion.venta);
      desc_principal   = tipo_transfer + ' de Ahorro (USD ' + importe.toFixed(2) + ' @ ' + cotizacion.venta + ') - ' + descripcion;
    }

    const tipo_mov_principal = (tipo_transfer === 'DEPOSITO') ? 'EGRESO' : 'INGRESO';
    const idAhorro           = 'AHO_' + generateUUID();

    // 1. Crear movimiento origen
    const movResult = crearRegistroSQL(
      idCuenta, fecha, ID_CATEGORIA_AHORRO, tipo_mov_principal,
      desc_principal, importePrincipal, 'Transferencia',
      null, null, null, null, idAhorro
    );
    pgInsert('movimientos', movResult.row);
    const idMovimientoOrigen = movResult.id;

    // 2. Crear registro de ahorro
    pgInsert('ahorros', {
      id_ahorro:            idAhorro,
      id_movimiento_origen: idMovimientoOrigen,
      fecha:                fecha,
      tipo_transfer:        tipo_transfer,
      moneda:               moneda,
      importe:              importe,
      id_subcuenta:         idSubcuenta,
      descripcion:          sanitizeString(descripcion, 500)
      // created_at: DEFAULT now() en Postgres
    });

    Logger.log('[API_Ahorro → api_createAhorro → OK] ' + idAhorro);
    return { success: true, data: { id_ahorro: idAhorro } };

  } catch (e) {
    Logger.log('[API_Ahorro → api_createAhorro → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_getAhorro_forEdit(idAhorro) {
  Logger.log('[API_Ahorro → api_getAhorro_forEdit → inicio] ' + idAhorro);
  try {
    const data = pgSelect('ahorros', { id_ahorro: PG.eq(idAhorro) }, '*', null, 1);
    if (data.length === 0) throw new Error('No se encontró la transferencia de ahorro.');
    Logger.log('[API_Ahorro → api_getAhorro_forEdit → OK]');
    return { success: true, data: data[0] };
  } catch (e) {
    Logger.log('[API_Ahorro → api_getAhorro_forEdit → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_updateAhorro(request) {
  Logger.log('[API_Ahorro → api_updateAhorro → inicio] ' + request.id_ahorro);
  try {
    validateRequired(request, ['id_ahorro', 'data']);
    const idAhorro = request.id_ahorro;
    const data     = request.data;
    validateRequired(data, ['fecha', 'tipo_transfer', 'moneda', 'importe', 'idSubcuenta']);

    const importe     = Number(data.importe);
    const idSubcuenta = data.idSubcuenta;

    let importePrincipal = importe;
    let desc_principal   = data.tipo_transfer + ' de Ahorro (' + data.moneda + ') - ' + (data.descripcion || '');

    if (data.moneda === 'USD') {
      const cotizacion = getUSDCotizacionOficial();
      if (!cotizacion) {
        throw new Error('No se pudo obtener la cotización del dólar. Intente más tarde.');
      }
      importePrincipal = fromUSD(importe, cotizacion.venta);
      desc_principal   = data.tipo_transfer + ' de Ahorro (USD ' + importe.toFixed(2) + ' @ ' + cotizacion.venta + ') - ' + (data.descripcion || '');
    }

    const tipo_mov_principal = (data.tipo_transfer === 'DEPOSITO') ? 'EGRESO' : 'INGRESO';

    // Actualizar registro de ahorro
    pgUpdate('ahorros', { id_ahorro: PG.eq(idAhorro) }, {
      fecha:         data.fecha,
      tipo_transfer: data.tipo_transfer,
      moneda:        data.moneda,
      importe:       importe,
      id_subcuenta:  idSubcuenta,
      descripcion:   sanitizeString(data.descripcion || '', 500)
    });

    // Actualizar movimiento vinculado
    pgUpdate('movimientos', { id_transfer_ahorro: PG.eq(idAhorro) }, {
      fecha:       data.fecha,
      tipo_mov:    tipo_mov_principal,
      descripcion: desc_principal,
      importe:     importePrincipal
    });

    Logger.log('[API_Ahorro → api_updateAhorro → OK] ' + idAhorro);
    return { success: true, data: { id_ahorro: idAhorro } };

  } catch (e) {
    Logger.log('[API_Ahorro → api_updateAhorro → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_deleteAhorro(request) {
  Logger.log('[API_Ahorro → api_deleteAhorro → inicio] ' + request.id_ahorro);
  try {
    validateRequired(request, ['id_ahorro']);
    const idAhorro = request.id_ahorro;

    // Eliminar movimiento vinculado primero (FK → movimientos)
    pgDelete('movimientos', { id_transfer_ahorro: PG.eq(idAhorro) });
    // Luego el registro de ahorro
    pgDelete('ahorros', { id_ahorro: PG.eq(idAhorro) });

    Logger.log('[API_Ahorro → api_deleteAhorro → OK] ' + idAhorro);
    return { success: true, data: { id_ahorro: idAhorro } };

  } catch (e) {
    Logger.log('[API_Ahorro → api_deleteAhorro → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}
