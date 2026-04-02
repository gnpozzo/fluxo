'use strict';
/**
 * SISTEMA DE GESTIÓN FINANCIERA - BACKEND (API Módulo Tarjetas)
 * v5.0.0
 *
 * Cambios v5.0.0:
 * - [REFACTOR] 'use strict' a nivel de archivo
 * - [REFACTOR] buildTCInsert() usa buildInsert() factory de Utils.js
 * - [ESTANDAR] api_getConsumosTC() retorna { success: true, kpis, consumos }
 * - [ESTANDAR] validateRequired() para validación de input
 * - [ESTANDAR] Logs estructurados: [API_Tarjetas → función → acción]
 *
 * Cambios v3.0.0 (mantenidos):
 * - api_getConsumosTC(): pgRpc('get_consumos_tc_list')
 * - api_createConsumoTC(): batch pgInsert consumos_tc + movimientos con lógica SIMPLE/CUOTAS/RECURRENTE
 * - api_deleteConsumoTC(): pgSelect + pgDelete con PG.in para SERIES
 */

// --- HELPER PRIVADO: ROW OBJECT PARA consumos_tc ---

/**
 * Construye un row object listo para pgInsert() en la tabla consumos_tc.
 * Wrapper sobre buildInsert() de Utils.js.
 *
 * @param {object}      opts
 * @param {string}      opts.idConsumo     - UUID del consumo.
 * @param {string}      opts.idTarjeta     - ID de la tarjeta.
 * @param {string}      opts.idCategoria   - ID de la categoría.
 * @param {string}      opts.fechaISO      - Fecha YYYY-MM-DD.
 * @param {string}      opts.descripcion   - Descripción.
 * @param {number}      opts.importe       - Importe del consumo.
 * @param {number|null} [opts.cuotaActual] - Número de cuota actual.
 * @param {number|null} [opts.cuotaTotal]  - Total de cuotas.
 * @param {string|null} [opts.recurGroupId]- ID de grupo recurrente o de cuotas.
 * @returns {{_table: string, row: object}}
 */
function buildTCInsert(opts) {
  return buildInsert('consumos_tc', {
    id_consumo_tarjeta: opts.idConsumo,
    id_tarjeta:         opts.idTarjeta,
    id_categoria:       opts.idCategoria,
    fecha:              opts.fechaISO,
    descripcion:        sanitizeString(opts.descripcion, 500),
    importe:            opts.importe,
    cuota_actual:       opts.cuotaActual  != null ? opts.cuotaActual  : null,
    cuota_total:        opts.cuotaTotal   != null ? opts.cuotaTotal   : null,
    recur_group_id:     opts.recurGroupId || null
    // created_at: DEFAULT now() en Postgres
  });
}

// --- FUNCIONES API ---

function api_getConsumosTC(idCuenta, fechaInicio, fechaFin) {
  Logger.log('[API_Tarjetas → api_getConsumosTC → inicio] cuenta:' + idCuenta);
  try {
    if (!idCuenta || !fechaInicio || !fechaFin) {
      throw new Error('Faltan parámetros: idCuenta, fechaInicio, fechaFin.');
    }

    const consumos = pgRpc('get_consumos_tc_list', {
      p_id_cuenta:    idCuenta,
      p_fecha_inicio: fechaInicio,
      p_fecha_fin:    fechaFin
    });

    const kpis = { saldoTotal: 0, saldoImputado: 0, saldoConsolidado: 0 };
    consumos.forEach(function(c) {
      kpis.saldoTotal += c.importe;
      if (c.id_movimiento_imputado) kpis.saldoImputado += c.importe;
    });
    kpis.saldoConsolidado = kpis.saldoTotal - kpis.saldoImputado;

    Logger.log('[API_Tarjetas → api_getConsumosTC → OK] consumos:' + consumos.length);
    return { success: true, kpis: kpis, consumos: consumos };

  } catch (e) {
    Logger.log('[API_Tarjetas → api_getConsumosTC → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_createConsumoTC(consumo) {
  Logger.log('[API_Tarjetas → api_createConsumoTC → inicio] tipo:' + consumo.tipo + ' tarjeta:' + consumo.idTarjeta);
  try {
    validateRequired(consumo, ['idTarjeta', 'idCategoria', 'fecha', 'tipo', 'importe']);

    const tcRows    = [];  // rows para consumos_tc
    const movRows   = [];  // rows para movimientos (imputaciones)
    const fechaBase = new Date(consumo.fecha + 'T12:00:00Z');

    if (consumo.tipo === 'SIMPLE') {
      const idConsumo = generateUUID();
      const fechaISO  = fechaBase.toISOString().split('T')[0];

      tcRows.push(buildTCInsert({
        idConsumo:   idConsumo,
        idTarjeta:   consumo.idTarjeta,
        idCategoria: consumo.idCategoria,
        fechaISO:    fechaISO,
        descripcion: consumo.descripcion,
        importe:     consumo.importe
      }).row);

      if (consumo.imputar) {
        movRows.push(crearRegistroSQL(
          consumo.idCuentaImputar, fechaISO, consumo.idCategoria,
          'EGRESO', consumo.descripcion, consumo.importe,
          'Tarjeta de Crédito', null, null, null, idConsumo
        ).row);
      }

    } else if (consumo.tipo === 'CUOTAS') {
      const installmentGroupId = 'INSTL_' + generateUUID();
      const cuotasARegistrar   = (consumo.cuotaTotal - consumo.cuotaActual) + 1;
      if (cuotasARegistrar < 1) throw new Error('La cuota actual no puede ser mayor al total.');

      for (let i = 0; i < cuotasARegistrar; i++) {
        const idConsumo      = generateUUID();
        const cuotaNumActual = consumo.cuotaActual + i;
        const fechaISO       = addMonthsSafe(fechaBase, i).toISOString().split('T')[0];

        tcRows.push(buildTCInsert({
          idConsumo:    idConsumo,
          idTarjeta:    consumo.idTarjeta,
          idCategoria:  consumo.idCategoria,
          fechaISO:     fechaISO,
          descripcion:  consumo.descripcion,
          importe:      consumo.importe,
          cuotaActual:  cuotaNumActual,
          cuotaTotal:   consumo.cuotaTotal,
          recurGroupId: installmentGroupId
        }).row);

        if (consumo.imputar) {
          const descImputacion = consumo.descripcion + ' (Cuota ' + cuotaNumActual + '/' + consumo.cuotaTotal + ')';
          movRows.push(crearRegistroSQL(
            consumo.idCuentaImputar, fechaISO, consumo.idCategoria,
            'EGRESO', descImputacion, consumo.importe,
            'Tarjeta de Crédito', installmentGroupId, null, null, idConsumo
          ).row);
        }
      }

    } else if (consumo.tipo === 'RECURRENTE') {
      const recurGroupId = 'REC_TC_' + generateUUID();

      for (let i = 0; i < consumo.periodos; i++) {
        const idConsumo = generateUUID();
        const fechaISO  = addMonthsSafe(fechaBase, i).toISOString().split('T')[0];

        tcRows.push(buildTCInsert({
          idConsumo:    idConsumo,
          idTarjeta:    consumo.idTarjeta,
          idCategoria:  consumo.idCategoria,
          fechaISO:     fechaISO,
          descripcion:  consumo.descripcion,
          importe:      consumo.importe,
          recurGroupId: recurGroupId
        }).row);

        if (consumo.imputar) {
          movRows.push(crearRegistroSQL(
            consumo.idCuentaImputar, fechaISO, consumo.idCategoria,
            'EGRESO', consumo.descripcion, consumo.importe,
            'Tarjeta de Crédito', recurGroupId, null, null, idConsumo
          ).row);
        }
      }

    } else {
      throw new Error('Tipo de consumo TC no reconocido: "' + consumo.tipo + '".');
    }

    if (tcRows.length === 0) throw new Error('No se generaron registros TC para insertar.');

    // Insertar consumos TC primero (atomicidad: si falla, no se crean imputaciones)
    pgInsert('consumos_tc', tcRows);
    if (movRows.length > 0) pgInsert('movimientos', movRows);

    Logger.log('[API_Tarjetas → api_createConsumoTC → OK] tc:' + tcRows.length + ' mov:' + movRows.length);
    return { success: true, data: { tcCount: tcRows.length, movCount: movRows.length } };

  } catch (e) {
    Logger.log('[API_Tarjetas → api_createConsumoTC → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_getConsumoTC_forEdit(consumoId) {
  Logger.log('[API_Tarjetas → api_getConsumoTC_forEdit → inicio] ' + consumoId);
  try {
    const data = pgRpc('get_consumo_tc_for_edit', { p_consumo_id: consumoId });
    const row  = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('No se encontró el consumo de TC.');
    Logger.log('[API_Tarjetas → api_getConsumoTC_forEdit → OK]');
    return { success: true, data: row };
  } catch (e) {
    Logger.log('[API_Tarjetas → api_getConsumoTC_forEdit → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_updateConsumoTC(request) {
  Logger.log('[API_Tarjetas → api_updateConsumoTC → inicio] scope:' + request.scope);
  try {
    validateRequired(request, ['original', 'data', 'scope']);

    const deleteResult = api_deleteConsumoTC({
      consumoId:    request.original.consumoId,
      fecha:        request.original.fecha,
      recurGroupId: request.original.recurGroupId,
      scope:        request.scope
    });
    if (!deleteResult.success) throw new Error('Fallo en el paso de borrado: ' + deleteResult.error);

    if (request.scope === 'SINGLE') request.data.tipo = 'SIMPLE';
    const createResult = api_createConsumoTC(request.data);
    if (!createResult.success) throw new Error('Fallo en el paso de creación: ' + createResult.error);

    Logger.log('[API_Tarjetas → api_updateConsumoTC → OK]');
    return { success: true, data: {} };

  } catch (e) {
    Logger.log('[API_Tarjetas → api_updateConsumoTC → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_deleteConsumoTC(request) {
  Logger.log('[API_Tarjetas → api_deleteConsumoTC → inicio] scope:' + request.scope);
  try {
    validateRequired(request, ['scope']);

    if (request.scope === 'SINGLE') {
      if (!request.consumoId) throw new Error('consumoId requerido para scope SINGLE.');
      // Borrar imputación en movimientos (si existe) y luego el consumo TC
      pgDelete('movimientos', { id_consumo_tarjeta_origen: PG.eq(request.consumoId) });
      pgDelete('consumos_tc', { id_consumo_tarjeta: PG.eq(request.consumoId) });

    } else if (request.scope === 'SERIES') {
      if (!request.recurGroupId || !request.fecha) {
        throw new Error('Faltan recurGroupId o fecha para borrado de SERIES.');
      }

      // 1. Obtener IDs de los consumos TC futuros de la serie
      const tcs = pgSelect(
        'consumos_tc',
        { recur_group_id: PG.eq(request.recurGroupId), fecha: PG.gte(request.fecha) },
        'id_consumo_tarjeta'
      );
      if (tcs.length === 0) {
        Logger.log('[API_Tarjetas → api_deleteConsumoTC → noop] sin consumos futuros');
        return { success: true, data: { deleted: 0 } };
      }
      const ids = tcs.map(function(r) { return r.id_consumo_tarjeta; });

      // 2. Borrar imputaciones vinculadas en movimientos
      pgDelete('movimientos', { id_consumo_tarjeta_origen: PG.in(ids) });

      // 3. Borrar los consumos TC de la serie
      pgDelete('consumos_tc', { id_consumo_tarjeta: PG.in(ids) });

    } else {
      throw new Error('Scope de borrado de TC no válido: "' + request.scope + '".');
    }

    Logger.log('[API_Tarjetas → api_deleteConsumoTC → OK] scope:' + request.scope);
    return { success: true, data: {} };

  } catch (e) {
    Logger.log('[API_Tarjetas → api_deleteConsumoTC → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}
