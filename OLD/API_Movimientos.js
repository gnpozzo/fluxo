'use strict';
/**
 * SISTEMA DE GESTIÓN FINANCIERA - BACKEND (API Módulo Movimientos)
 * v5.0.0
 *
 * Cambios v5.0.0:
 * - [REFACTOR] 'use strict' a nivel de archivo
 * - [ESTANDAR] api_getDashboardData() retorna { success: true, kpis, movimientos }
 * - [ESTANDAR] validateRequired() para validación de input
 * - [ESTANDAR] Logs estructurados: [API_Movimientos → función → acción]
 *
 * Cambios v3.0.0 (mantenidos):
 * - api_getDashboardData(): pgRpc('get_dashboard_kpis') + pgRpc('get_ajuste_cc/tc') + pgRpc('get_movimientos_list')
 * - api_createMovimiento(): 4 casos SIMPLE / RECURRENTE / SPLIT / SPLIT+RECURRENTE
 * - api_updateMovimiento(): UPDATE directo para simple, delete-then-create para complejo
 * - api_deleteMovimiento(): scope SINGLE / GROUP / SERIES con limpieza de consumos TC vinculados
 */

// --- SECCIÓN 0: CONSTANTES ---

const MAX_ROWS_MOVIMIENTOS = 500;

// --- SECCIÓN 1: API — LECTURA ---

function api_getDashboardData(idCuenta, fechaInicio, fechaFin, requiereAjustes) {
  Logger.log('[API_Movimientos → api_getDashboardData → inicio] cuenta:' + idCuenta + ' ajustes:' + requiereAjustes);
  try {
    if (!idCuenta || !fechaInicio || !fechaFin) {
      throw new Error('Faltan parámetros: idCuenta, fechaInicio, fechaFin.');
    }

    let kpis = { ingresos: 0, egresos: 0, resultado: 0, ajuste_cc: 0, ajuste_tc: 0 };

    // KPIs de movimientos propios
    const dataMovimientos = pgRpc('get_dashboard_kpis', {
      p_id_cuenta:    idCuenta,
      p_fecha_inicio: fechaInicio,
      p_fecha_fin:    fechaFin
    });

    dataMovimientos.forEach(function(row) {
      if (row.tipo_mov === 'INGRESO')      kpis.ingresos += row.subtotal || 0;
      else if (row.tipo_mov === 'EGRESO')  kpis.egresos  += row.subtotal || 0;
    });

    // Ajuste de CC y TC (solo si la cuenta los requiere)
    if (requiereAjustes) {
      Logger.log('[API_Movimientos → api_getDashboardData → ajustes]');

      const dataCC = pgRpc('get_ajuste_cc', {
        p_id_cuenta:    idCuenta,
        p_fecha_inicio: fechaInicio,
        p_fecha_fin:    fechaFin
      });
      if (dataCC.length > 0 && dataCC[0].ajuste_neto_cc !== null) {
        const ajusteCC = dataCC[0].ajuste_neto_cc || 0;
        kpis.ajuste_cc = ajusteCC;
        if (ajusteCC > 0)      kpis.ingresos += ajusteCC;
        else if (ajusteCC < 0) kpis.egresos  += Math.abs(ajusteCC);
      }

      const calcTC = api_getConsumosTC(idCuenta, fechaInicio, fechaFin);
      if (calcTC && calcTC.success && calcTC.kpis) {
        const saldoTC  = calcTC.kpis.incidenciaPersonal || 0;
        kpis.ajuste_tc = saldoTC;
        kpis.egresos  += saldoTC;
      }
    }

    kpis.resultado = kpis.ingresos - kpis.egresos;

    // Lista de movimientos del período
    const lista = pgRpc('get_movimientos_list', {
      p_id_cuenta:    idCuenta,
      p_fecha_inicio: fechaInicio,
      p_fecha_fin:    fechaFin,
      p_limit:        MAX_ROWS_MOVIMIENTOS
    });

    Logger.log('[API_Movimientos → api_getDashboardData → OK] movimientos:' + lista.length);
    return { success: true, kpis: kpis, movimientos: lista };

  } catch (e) {
    Logger.log('[API_Movimientos → api_getDashboardData → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_getMovimientoDataForEdit(idMovimiento) {
  Logger.log('[API_Movimientos → api_getMovimientoDataForEdit → inicio] ' + idMovimiento);
  try {
    const data = pgSelect('movimientos', { id_movimiento: PG.eq(idMovimiento) }, '*', null, 1);
    if (data.length === 0) throw new Error('No se encontró el movimiento.');

    let movimientoData = data[0];

    if (movimientoData.split_group_id) {
      Logger.log('[API_Movimientos → api_getMovimientoDataForEdit → split] ' + movimientoData.split_group_id);
      const totalData = pgRpc('get_split_total', { p_split_group_id: movimientoData.split_group_id });
      if (totalData.length > 0 && totalData[0].importe_total !== null) {
        movimientoData.importe = totalData[0].importe_total;
      }
    }

    Logger.log('[API_Movimientos → api_getMovimientoDataForEdit → OK]');
    return { success: true, data: movimientoData };

  } catch (e) {
    Logger.log('[API_Movimientos → api_getMovimientoDataForEdit → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

// --- SECCIÓN 3: API — ESCRITURA ---

function api_createMovimiento(mov) {
  Logger.log('[API_Movimientos → api_createMovimiento → inicio] tipoConsumo:' + mov.tipoConsumo + ' esSplit:' + mov.esSplit);
  try {
    validateRequired(mov, ['idCuenta', 'tipo', 'fecha', 'idCategoria', 'importe', 'medioPago']);

    const rows    = [];
    const fechaBase = new Date(mov.fecha + 'T12:00:00Z');

    // Validación de destinos de Split
    let pctRetenido = 100;
    const destinos = [];
    if (mov.esSplit && Array.isArray(mov.splitDestinos)) {
      mov.splitDestinos.forEach(d => {
        const pct = parseFloat(d.pct);
        if (isNaN(pct) || pct <= 0) throw new Error('Porcentaje de distribución inválido.');
        pctRetenido -= pct;
        destinos.push({ cuenta: d.cuenta, pct: pct / 100 });
      });
      if (pctRetenido < 0) {
        throw new Error('La suma de porcentajes de distribución supera el 100%.');
      }
    }

    // Determinar iteraciones según tipoConsumo
    let periodos = 1;
    let esCuotas = false;
    let groupIdPrefix = 'REC_';
    
    if (mov.tipoConsumo === 'CUOTAS') {
      periodos = mov.cuotaTotal - mov.cuotaActual + 1;
      esCuotas = true;
      groupIdPrefix = 'INSTL_';
    } else if (mov.tipoConsumo === 'RECURRENTE') {
      periodos = mov.periodos || 12; // Si viene 0 podría ser infinito, pero el motor inyecta un nro por defecto (120) o 12.
    }

    if (periodos < 1) periodos = 1;
    const isSeries = periodos > 1;
    const seriesGroupId = isSeries ? groupIdPrefix + generateUUID() : null;

    // Generar Movimientos
    for (let i = 0; i < periodos; i++) {
      const fechaISO = addMonthsSafe(fechaBase, i).toISOString().split('T')[0];
      
      let desc = mov.descripcion;
      if (esCuotas) {
         const cuotaNro = mov.cuotaActual + i;
         desc = `${desc} (Cuota ${cuotaNro}/${mov.cuotaTotal})`;
      }

      if (mov.esSplit && destinos.length > 0) {
        const splitGroupId = 'SPLIT_' + generateUUID();
        // Generar Destinos
        destinos.forEach(d => {
          const importeDestino = mov.importe * d.pct;
          rows.push(crearRegistroSQL(
            d.cuenta, fechaISO, mov.idCategoria, mov.tipo,
            desc, importeDestino, mov.medioPago,
            seriesGroupId, splitGroupId, 'DESTINO'
          ).row);
        });
        
        // Generar Origen Remanente (si es > 0)
        if (pctRetenido > 0) {
          const importeOrigen = mov.importe * (pctRetenido / 100);
          rows.push(crearRegistroSQL(
            mov.idCuenta, fechaISO, mov.idCategoria, mov.tipo,
            desc, importeOrigen, mov.medioPago,
            seriesGroupId, splitGroupId, 'ORIGEN'
          ).row);
        } else {
          // Si retuvo 0%, asigna 0 como traza lógica de salida
          rows.push(crearRegistroSQL(
            mov.idCuenta, fechaISO, mov.idCategoria, mov.tipo,
            desc, 0, mov.medioPago,
            seriesGroupId, splitGroupId, 'ORIGEN'
          ).row);
        }

      } else {
        // CASO NORMAL (Sin Split)
        rows.push(crearRegistroSQL(
          mov.idCuenta, fechaISO, mov.idCategoria, mov.tipo,
          desc, mov.importe, mov.medioPago,
          seriesGroupId, null, null
        ).row);
      }
    }

    if (rows.length === 0) throw new Error('No se generaron registros para la creación.');

    pgInsert('movimientos', rows);

    Logger.log('[API_Movimientos → api_createMovimiento → OK] ' + rows.length + ' registro(s)');
    return { success: true, data: { count: rows.length } };

  } catch (e) {
    Logger.log('[API_Movimientos → api_createMovimiento → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_deleteMovimiento(request) {
  Logger.log('[API_Movimientos → api_deleteMovimiento → inicio] scope:' + request.scope);
  try {
    validateRequired(request, ['scope']);

    switch (request.scope) {
      case 'SINGLE': {
        if (!request.movimientoId) throw new Error('movimientoId requerido para scope SINGLE.');
        // Borrar consumos TC vinculados antes del movimiento (FK)
        const linkedTC = pgSelect('movimientos',
          { id_movimiento: PG.eq(request.movimientoId) },
          'id_consumo_tarjeta_origen',
          null, 1
        );
        if (linkedTC.length > 0 && linkedTC[0].id_consumo_tarjeta_origen) {
          pgDelete('consumos_tc', { id_consumo_tarjeta: PG.eq(linkedTC[0].id_consumo_tarjeta_origen) });
        }
        pgDelete('movimientos', { id_movimiento: PG.eq(request.movimientoId) });
        break;
      }

      case 'GROUP': {
        if (!request.splitGroupId) throw new Error('splitGroupId requerido para scope GROUP.');
        const groupMovs = pgSelect('movimientos',
          { split_group_id: PG.eq(request.splitGroupId) },
          'id_movimiento,id_consumo_tarjeta_origen'
        );
        const tcIds = groupMovs
          .filter(function(r) { return !!r.id_consumo_tarjeta_origen; })
          .map(function(r) { return r.id_consumo_tarjeta_origen; });
        if (tcIds.length > 0) pgDelete('consumos_tc', { id_consumo_tarjeta: PG.in(tcIds) });
        pgDelete('movimientos', { split_group_id: PG.eq(request.splitGroupId) });
        break;
      }

      case 'SERIES': {
        if (!request.recurGroupId || !request.fecha) {
          throw new Error('recurGroupId y fecha requeridos para scope SERIES.');
        }
        const seriesMovs = pgSelect('movimientos',
          { recur_group_id: PG.eq(request.recurGroupId), fecha: PG.gte(request.fecha) },
          'id_movimiento,id_consumo_tarjeta_origen'
        );
        const tcIds = seriesMovs
          .filter(function(r) { return !!r.id_consumo_tarjeta_origen; })
          .map(function(r) { return r.id_consumo_tarjeta_origen; });
        if (tcIds.length > 0) pgDelete('consumos_tc', { id_consumo_tarjeta: PG.in(tcIds) });
        pgDelete('movimientos', {
          recur_group_id: PG.eq(request.recurGroupId),
          fecha:          PG.gte(request.fecha)
        });
        break;
      }

      default:
        throw new Error('Scope de borrado no válido: "' + request.scope + '".');
    }

    Logger.log('[API_Movimientos → api_deleteMovimiento → OK] scope:' + request.scope);
    return { success: true, data: {} };

  } catch (e) {
    Logger.log('[API_Movimientos → api_deleteMovimiento → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_updateMovimiento(request) {
  Logger.log('[API_Movimientos → api_updateMovimiento → inicio] scope:' + request.scope);
  try {
    validateRequired(request, ['scope', 'data', 'original']);

    const mov      = request.data;
    const original = request.original;

    const isOriginalRecurrente  = !!original.recurGroupId;
    const isOriginalSplit       = !!original.splitGroupId;
    const isMovRecurrente       = mov.tipoConsumo === 'RECURRENTE' || mov.tipoConsumo === 'CUOTAS';
    const isComplexityChanging  = isMovRecurrente !== isOriginalRecurrente || mov.esSplit !== isOriginalSplit;

    if (request.scope !== 'SINGLE' || isComplexityChanging) {
      // Edición compleja: delete-then-create
      Logger.log('[API_Movimientos → api_updateMovimiento → delete-create] scope:' + request.scope);

      switch (request.scope) {
        case 'SINGLE':
          pgDelete('movimientos', { id_movimiento: PG.eq(original.movimientoId) });
          break;
        case 'GROUP':
          pgDelete('movimientos', { split_group_id: PG.eq(original.splitGroupId) });
          break;
        case 'SERIES':
          pgDelete('movimientos', {
            recur_group_id: PG.eq(original.recurGroupId),
            fecha:          PG.gte(original.fecha)
          });
          break;
        default:
          throw new Error('Scope de actualización no válido: "' + request.scope + '".');
      }

      // Si se edita un ítem de una serie/grupo como SINGLE, aplanar a simple
      if (request.scope === 'SINGLE' && (isOriginalRecurrente || isOriginalSplit)) {
        mov.tipoConsumo  = 'COMUN';
        mov.esSplit      = false;
      }

      return api_createMovimiento(mov);

    } else {
      // Edición simple: UPDATE directo
      Logger.log('[API_Movimientos → api_updateMovimiento → update] ' + original.movimientoId);
      pgUpdate(
        'movimientos',
        { id_movimiento: PG.eq(original.movimientoId) },
        {
          fecha:        mov.fecha,
          id_categoria: mov.idCategoria,
          descripcion:  sanitizeString(mov.descripcion, 500),
          importe:      mov.importe,
          medio_pago:   mov.medioPago
        }
      );
    }

    Logger.log('[API_Movimientos → api_updateMovimiento → OK]');
    return { success: true, data: {} };

  } catch (e) {
    Logger.log('[API_Movimientos → api_updateMovimiento → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}
