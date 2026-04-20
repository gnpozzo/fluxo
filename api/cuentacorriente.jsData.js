
// [Origen -> api -> API_CuentaCorriente.js]
// Migración REST transicional (Las funciones contenían: 'use strict';/** * SISTEMA DE GESTIÓN FINANCIERA - BACKEND (API Módulo Cuenta Corriente) * v5.0.0...)
// Se debe migrar cada sub-función usando el supabase-js client tal como en getDashboardData.js

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Not allowed');
  return res.status(501).json({ success: false, error: 'Endpoint sin transicionar. Por favor actualizar backend Edge.' });
}
/* CODIGO ORIGINAL MANTENIDO POR TRAZABILIDAD:
'use strict';
/**
 * SISTEMA DE GESTIÓN FINANCIERA - BACKEND (API Módulo Cuenta Corriente)
 * v5.0.0
 *
 * Cambios v5.0.0:
 * - [REFACTOR] 'use strict' a nivel de archivo
 * - [REFACTOR] buildCCInsert() usa buildInsert() factory de Utils.js
 * - [ESTANDAR] api_getConsumosCC() retorna { success: true, kpis, consumos }
 * - [ESTANDAR] validateRequired() para validación de input
 * - [ESTANDAR] Logs estructurados: [API_CuentaCorriente → función → acción]
 *
 * Cambios v3.0.0 (mantenidos):
 * - api_getConsumosCC(): pgRpc('get_consumos_cc_list')
 * - api_createConsumoCC(): batch insert cc_consumos con lógica SIMPLE/CUOTAS/RECURRENTE
 */

// --- HELPER PRIVADO: ROW OBJECT PARA cc_consumos ---

/**
 * Construye un row object listo para pgInsert() en la tabla cc_consumos.
 * Wrapper sobre buildInsert() de Utils.js.
 *
 * @param {object}      opts
 * @param {string}      opts.id                - UUID del consumo CC.
 * @param {string}      opts.idCuenta          - ID de la cuenta principal.
 * @param {string}      opts.idCategoria       - ID de la categoría.
 * @param {string}      opts.fechaISO          - Fecha YYYY-MM-DD.
 * @param {string}      opts.descripcion       - Descripción.
 * @param {number}      opts.importe           - Importe.
 * @param {string}      opts.pagador           - 'YO' o 'OTRO'.
 * @param {number}      opts.porcentajeImputado- Porcentaje imputado (0-100).
 * @param {string}      [opts.idUsuario]       - ID del contacto (usuario CC).
 * @param {string|null} [opts.recurGroupId]    - ID de grupo recurrente o de cuotas.
 * @param {number|null} [opts.nroCuota]        - Número de cuota (CUOTAS).
 * @param {number|null} [opts.totalCuotas]     - Total de cuotas (CUOTAS).
 * @returns {{_table: string, row: object}}
 */
function buildCCInsert(opts) {
  return buildInsert('cc_consumos', {
    id_cc_consumo:       opts.id,
    id_cuenta_principal: opts.idCuenta,
    id_categoria:        opts.idCategoria,
    id_usuario:          opts.idUsuario || null,
    fecha:               opts.fechaISO,
    descripcion:         sanitizeString(opts.descripcion, 500),
    importe:             opts.importe,
    pagador:             opts.pagador,
    porcentaje_imputado: opts.porcentajeImputado,
    recur_group_id:      opts.recurGroupId  || null,
    nro_cuota:           opts.nroCuota      != null ? opts.nroCuota    : null,
    total_cuotas:        opts.totalCuotas   != null ? opts.totalCuotas : null
    // created_at: DEFAULT now() en Postgres
  });
}

// --- FUNCIONES API ---

function api_getConsumosCC(idCuenta, fechaInicio, fechaFin) {
  Logger.log('[API_CuentaCorriente → api_getConsumosCC → inicio] cuenta:' + idCuenta);
  try {
    if (!idCuenta || !fechaInicio || !fechaFin) {
      throw new Error('Faltan parámetros: idCuenta, fechaInicio, fechaFin.');
    }

    const consumos = pgRpc('get_consumos_cc_list', {
      p_id_cuenta:    idCuenta,
      p_fecha_inicio: fechaInicio,
      p_fecha_fin:    fechaFin
    });

    const kpis = { gastoYo: 0, gastoOtro: 0, saldoNeto: 0 };
    consumos.forEach(function(c) {
      if (c.pagador === 'YO')   kpis.gastoYo   += c.importe;
      if (c.pagador === 'OTRO') kpis.gastoOtro += c.importe;
      const importeFinal = (c.importe * c.porcentaje_imputado) / 100;
      if (c.pagador === 'YO')   kpis.saldoNeto += importeFinal;
      if (c.pagador === 'OTRO') kpis.saldoNeto -= importeFinal;
    });

    Logger.log('[API_CuentaCorriente → api_getConsumosCC → OK] consumos:' + consumos.length);
    return { success: true, kpis: kpis, consumos: consumos };

  } catch (e) {
    Logger.log('[API_CuentaCorriente → api_getConsumosCC → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_createConsumoCC(consumo) {
  Logger.log('[API_CuentaCorriente → api_createConsumoCC → inicio] tipo:' + consumo.tipo);
  try {
    validateRequired(consumo, ['idCuenta', 'idUsuario', 'idCategoria', 'fecha', 'tipo', 'importe', 'pagador', 'porcentajeImputado']);

    const ccItems     = [];
    const fechaBase   = new Date(consumo.fecha + 'T12:00:00Z');
    const recurGroupId = (consumo.tipo !== 'SIMPLE') ? 'CC_REC_' + generateUUID() : null;

    if (consumo.tipo === 'SIMPLE') {
      const fechaISO = fechaBase.toISOString().split('T')[0];
      ccItems.push(buildCCInsert({
        id:                 generateUUID(),
        idCuenta:           consumo.idCuenta,
        idCategoria:        consumo.idCategoria,
        idUsuario:          consumo.idUsuario,
        fechaISO:           fechaISO,
        descripcion:        consumo.descripcion,
        importe:            consumo.importe,
        pagador:            consumo.pagador,
        porcentajeImputado: consumo.porcentajeImputado
      }));

    } else if (consumo.tipo === 'CUOTAS') {
      const cuotasARegistrar = (consumo.cuotaTotal - consumo.cuotaActual) + 1;
      if (cuotasARegistrar < 1) throw new Error('La cuota actual no puede ser mayor al total.');

      for (let i = 0; i < cuotasARegistrar; i++) {
        const fechaISO = addMonthsSafe(fechaBase, i).toISOString().split('T')[0];
        ccItems.push(buildCCInsert({
          id:                 generateUUID(),
          idCuenta:           consumo.idCuenta,
          idCategoria:        consumo.idCategoria,
          idUsuario:          consumo.idUsuario,
          fechaISO:           fechaISO,
          descripcion:        consumo.descripcion,
          importe:            consumo.importe,
          pagador:            consumo.pagador,
          porcentajeImputado: consumo.porcentajeImputado,
          recurGroupId:       recurGroupId,
          nroCuota:           consumo.cuotaActual + i,
          totalCuotas:        consumo.cuotaTotal
        }));
      }

    } else if (consumo.tipo === 'RECURRENTE') {
      if (consumo.periodos < 1) throw new Error('El número de períodos debe ser al menos 1.');

      for (let i = 0; i < consumo.periodos; i++) {
        const fechaISO = addMonthsSafe(fechaBase, i).toISOString().split('T')[0];
        ccItems.push(buildCCInsert({
          id:                 generateUUID(),
          idCuenta:           consumo.idCuenta,
          idCategoria:        consumo.idCategoria,
          idUsuario:          consumo.idUsuario,
          fechaISO:           fechaISO,
          descripcion:        consumo.descripcion,
          importe:            consumo.importe,
          pagador:            consumo.pagador,
          porcentajeImputado: consumo.porcentajeImputado,
          recurGroupId:       recurGroupId
        }));
      }

    } else {
      throw new Error('Tipo de consumo CC no reconocido: "' + consumo.tipo + '".');
    }

    if (ccItems.length === 0) throw new Error('No se generaron registros CC para insertar.');

    // Batch insert: todos son cc_consumos → pgInsert con array
    pgInsert('cc_consumos', ccItems.map(function(item) { return item.row; }));

    Logger.log('[API_CuentaCorriente → api_createConsumoCC → OK] ' + ccItems.length + ' registros');
    return { success: true, data: { count: ccItems.length } };

  } catch (e) {
    Logger.log('[API_CuentaCorriente → api_createConsumoCC → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_getConsumoCC_forEdit(consumoId) {
  Logger.log('[API_CuentaCorriente → api_getConsumoCC_forEdit → inicio] ' + consumoId);
  try {
    const data = pgSelect('cc_consumos', { id_cc_consumo: PG.eq(consumoId) }, '*', null, 1);
    if (data.length === 0) throw new Error('No se encontró el consumo de CC.');
    Logger.log('[API_CuentaCorriente → api_getConsumoCC_forEdit → OK]');
    return { success: true, data: data[0] };
  } catch (e) {
    Logger.log('[API_CuentaCorriente → api_getConsumoCC_forEdit → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_updateConsumoCC(request) {
  Logger.log('[API_CuentaCorriente → api_updateConsumoCC → inicio] scope:' + request.scope);
  try {
    validateRequired(request, ['original', 'data', 'scope']);

    const deleteResult = api_deleteConsumoCC({
      consumoId:    request.original.consumoId,
      fecha:        request.original.fecha,
      recurGroupId: request.original.recurGroupId,
      scope:        request.scope
    });
    if (!deleteResult.success) throw new Error('Fallo en el paso de borrado: ' + deleteResult.error);

    if (request.scope === 'SINGLE') request.data.tipo = 'SIMPLE';
    const createResult = api_createConsumoCC(request.data);
    if (!createResult.success) throw new Error('Fallo en el paso de creación: ' + createResult.error);

    Logger.log('[API_CuentaCorriente → api_updateConsumoCC → OK]');
    return { success: true, data: {} };

  } catch (e) {
    Logger.log('[API_CuentaCorriente → api_updateConsumoCC → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_deleteConsumoCC(request) {
  Logger.log('[API_CuentaCorriente → api_deleteConsumoCC → inicio] scope:' + request.scope);
  try {
    validateRequired(request, ['scope']);

    switch (request.scope) {
      case 'SINGLE':
        if (!request.consumoId) throw new Error('consumoId requerido para scope SINGLE.');
        pgDelete('cc_consumos', { id_cc_consumo: PG.eq(request.consumoId) });
        break;
      case 'SERIES':
        if (!request.recurGroupId || !request.fecha) {
          throw new Error('Faltan recurGroupId o fecha para borrado de SERIES.');
        }
        pgDelete('cc_consumos', {
          recur_group_id: PG.eq(request.recurGroupId),
          fecha:          PG.gte(request.fecha)
        });
        break;
      default:
        throw new Error('Scope de borrado de CC no válido: "' + request.scope + '".');
    }

    Logger.log('[API_CuentaCorriente → api_deleteConsumoCC → OK] scope:' + request.scope);
    return { success: true, data: {} };

  } catch (e) {
    Logger.log('[API_CuentaCorriente → api_deleteConsumoCC → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

*/
