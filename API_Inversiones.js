'use strict';
/**
 * SISTEMA DE GESTIÓN FINANCIERA - BACKEND (API Módulo Inversiones)
 * v5.0.0
 *
 * Cambios v5.0.0:
 * - [REFACTOR] 'use strict' a nivel de archivo
 * - [REFACTOR] buildInversionInsert() usa buildInsert() factory de Utils.js
 * - [ESTANDAR] api_getPortfolio(): retorna { portfolio, kpis } con nombres camelCase
 *   alineados al frontend (valorActual, costoTotal, gananciaTotal, rendimientoPorc)
 * - [ESTANDAR] api_getDolarCotizaciones(): retorna cotizaciones al nivel raíz
 * - [ESTANDAR] validateRequired(), logs estructurados
 *
 * Cambios v3.0.0 (mantenidos):
 * - Precio actual de tickers: rendimientos.co → FMP → Alpha Vantage
 * - api_getDolarCotizaciones(): rendimientos.co + dolarapi.com
 */

// --- HELPER PRIVADO: ROW OBJECT PARA inversiones_movimientos ---

/**
 * Construye un row object listo para pgInsert() en inversiones_movimientos.
 * Wrapper sobre buildInsert() de Utils.js.
 */
function buildInversionInsert(opts) {
  return buildInsert('inversiones_movimientos', {
    id_inversion_mov:     opts.idInversion,
    id_movimiento_origen: opts.idMovimientoOrigen,
    ticker:               opts.ticker.toUpperCase(),
    fecha:                opts.fechaISO,
    tipo_operacion:       opts.tipoOperacion,
    moneda:               opts.moneda,
    cantidad_nominales:   opts.cantidadNominales,
    precio_compra:        opts.precioCompra,
    importe_total_ars:    opts.importeTotalArs
    // created_at: DEFAULT now() en Postgres
  });
}

// --- HELPERS PRIVADOS: COTIZACIÓN DE TICKERS ---

/**
 * Obtiene el precio actual de un ticker desde rendimientos.co (/api/mundo).
 * @param {string} ticker
 * @returns {number|null}
 */
function _getPrecioRendimientos(ticker) {
  try {
    const data = getRendimientosData('/api/mundo?symbol=' + encodeURIComponent(ticker.toUpperCase()) + '&range=1d');
    if (!data) return null;
    const item  = Array.isArray(data) ? data[0] : data;
    if (!item)  return null;
    const precio = item.price || item.regularMarketPrice || item.c || null;
    return precio ? parseFloat(precio) : null;
  } catch (e) {
    Logger.log('[API_Inversiones → _getPrecioRendimientos → ERROR] ' + ticker + ': ' + e.message);
    return null;
  }
}

/**
 * Cascada de fuentes: rendimientos.co → FMP → Alpha Vantage.
 * @param {string} ticker
 * @returns {number} 0 si no se encuentra precio.
 */
function _getPrecioActivo(ticker) {
  let precio = _getPrecioRendimientos(ticker);
  if (precio !== null) {
    Logger.log('[API_Inversiones → _getPrecioActivo → rendimientos] ' + ticker + ': ' + precio);
    return precio;
  }

  precio = getFMPCotizacion(ticker);
  if (precio !== null) {
    Logger.log('[API_Inversiones → _getPrecioActivo → FMP] ' + ticker + ': ' + precio);
    return precio;
  }

  Logger.log('[API_Inversiones → _getPrecioActivo → sin precio] ' + ticker);
  return 0;
}

// --- FUNCIONES API ---

/**
 * Retorna cotizaciones de dólar desde rendimientos.co + dolarapi.com.
 * Las cotizaciones se exponen al nivel raíz de la respuesta para acceso directo:
 * response.blue?.venta, response.oficial?.venta, etc.
 */
function api_getDolarCotizaciones() {
  Logger.log('[API_Inversiones → api_getDolarCotizaciones → inicio]');
  try {
    const cotizaciones = {};

    // Fuente primaria: rendimientos.co
    const rdData = getRendimientosData('/api/cotizaciones');
    if (rdData) {
      if (rdData.Oficial)      cotizaciones.oficial         = { compra: rdData.Oficial.compra, venta: rdData.Oficial.venta, tipo: 'oficial' };
      if (rdData.MEP)          cotizaciones.bolsa           = { compra: rdData.MEP.compra,      venta: rdData.MEP.venta,     tipo: 'bolsa'   };
      if (rdData.CCL)          cotizaciones.contadoconliqui = { compra: rdData.CCL.compra,      venta: rdData.CCL.venta,     tipo: 'contadoconliqui' };
      if (rdData.Risk_Country) cotizaciones.risk_country    = rdData.Risk_Country;
    }

    // Complementar con dolarapi.com para tipos faltantes
    ['oficial', 'bolsa', 'contadoconliqui', 'blue', 'cripto', 'mayorista'].forEach(function(tipo) {
      if (!cotizaciones[tipo]) {
        cotizaciones[tipo] = getUSDCotizacion(tipo);
      }
    });

    cotizaciones.lastUpdated = new Date().toISOString();
    Logger.log('[API_Inversiones → api_getDolarCotizaciones → OK]');

    // Retornar cotizaciones al nivel raíz para acceso directo: response.blue?.venta
    return Object.assign({ success: true }, cotizaciones);

  } catch (e) {
    Logger.log('[API_Inversiones → api_getDolarCotizaciones → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_searchTickers(query) {
  Logger.log('[API_Inversiones → api_searchTickers → inicio] "' + query + '"');
  if (!query || query.length < 2) {
    return [];
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty('FMP_API_KEY');
  if (!apiKey) {
    Logger.log('[API_Inversiones → api_searchTickers → sin FMP_API_KEY]');
    return [];
  }

  const API_URL = 'https://financialmodelingprep.com/stable/search-symbol?query=' + encodeURIComponent(query) + '&limit=10&apikey=' + apiKey;
  const options = { method: 'get', muteHttpExceptions: true };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    if (response.getResponseCode() !== 200) {
      Logger.log('[API_Inversiones → api_searchTickers → HTTP] ' + response.getResponseCode());
      return [];
    }
    const results = JSON.parse(response.getContentText());
    Logger.log('[API_Inversiones → api_searchTickers → OK] ' + (results.length || 0) + ' resultados');
    return Array.isArray(results) ? results : [];
  } catch (e) {
    Logger.log('[API_Inversiones → api_searchTickers → ERROR] ' + e.message);
    return [];
  }
}

/**
 * Retorna el portfolio de inversiones con operaciones individuales y KPIs globales.
 * - portfolio: array de operaciones individuales (COMPRA/VENTA) con precio actual y P&L
 * - kpis: { valorActual, costoTotal, gananciaTotal, rendimientoPorc }
 */
function api_getPortfolio(idCuenta) {
  Logger.log('[API_Inversiones → api_getPortfolio → inicio] cuenta:' + idCuenta);
  try {
    const movimientos = pgRpc('get_inversiones_movimientos', { p_id_cuenta: idCuenta });

    if (!movimientos || movimientos.length === 0) {
      return {
        success:   true,
        kpis:      { valorActual: 0, costoTotal: 0, gananciaTotal: 0, rendimientoPorc: 0 },
        portfolio: []
      };
    }

    // Obtener precio actual por ticker (una sola llamada por ticker único)
    const preciosPorTicker = {};
    const tickersUnicos    = [];
    movimientos.forEach(function(m) {
      if (tickersUnicos.indexOf(m.ticker) === -1) tickersUnicos.push(m.ticker);
    });
    tickersUnicos.forEach(function(ticker) {
      preciosPorTicker[ticker] = _getPrecioActivo(ticker);
    });

    // Cotización USD para conversión de posiciones en USD
    const rdData        = getRendimientosData('/api/cotizaciones');
    const cotizUSD      = (rdData && rdData.CCL && rdData.CCL.venta) ? rdData.CCL.venta : null;
    const cotizFallback = cotizUSD || (getUSDCotizacion('oficial')?.venta) || 0;

    // Calcular tenencias actuales (para KPIs de portfolio)
    const tenencias = {};
    movimientos.forEach(function(mov) {
      const t = mov.ticker;
      if (!tenencias[t]) {
        tenencias[t] = { cantNominales: 0, costoTotalArs: 0, cantCompra: 0, moneda: mov.moneda };
      }
      if (mov.tipo_operacion === 'COMPRA') {
        tenencias[t].cantNominales += mov.cantidad_nominales;
        tenencias[t].costoTotalArs += mov.importe_total_ars;
        tenencias[t].cantCompra    += mov.cantidad_nominales;
      } else if (mov.tipo_operacion === 'VENTA') {
        tenencias[t].cantNominales -= mov.cantidad_nominales;
      }
    });

    let kpiValorTotal = 0;
    let kpiCostoTotal = 0;
    Object.keys(tenencias).forEach(function(ticker) {
      const ten = tenencias[ticker];
      if (ten.cantNominales <= 0.0001) return;
      const precioActual   = preciosPorTicker[ticker] || 0;
      let   valorActualArs = ten.cantNominales * precioActual;
      if (ten.moneda === 'USD') valorActualArs *= cotizFallback;
      const precioPromArs  = ten.cantCompra > 0 ? ten.costoTotalArs / ten.cantCompra : 0;
      const costoProporArs = precioPromArs * ten.cantNominales;
      kpiValorTotal += valorActualArs;
      kpiCostoTotal += costoProporArs;
    });

    const kpiGananciaTotal  = kpiValorTotal - kpiCostoTotal;
    const kpiRendimientoPorc = kpiCostoTotal > 0 ? (kpiGananciaTotal / kpiCostoTotal) * 100 : 0;

    // Mapear operaciones individuales al formato que espera el frontend
    const portfolio = movimientos.map(function(mov) {
      const precioActual = preciosPorTicker[mov.ticker] || 0;
      let ganancia       = null;

      if (mov.tipo_operacion === 'COMPRA' && precioActual > 0) {
        const valorActual = mov.cantidad_nominales * precioActual;
        const costo       = mov.cantidad_nominales * mov.precio_compra;
        const gananciaEnMoneda = valorActual - costo;
        ganancia = (mov.moneda === 'USD') ? gananciaEnMoneda * cotizFallback : gananciaEnMoneda;
      }

      return {
        id_operacion:  mov.id_inversion_mov,
        fecha:         mov.fecha,
        tipo_op:       mov.tipo_operacion,
        ticker:        mov.ticker,
        moneda:        mov.moneda,
        cantidad:      mov.cantidad_nominales,
        precio:        mov.precio_compra,
        precio_actual: precioActual > 0 ? precioActual : null,
        ganancia:      ganancia
      };
    });

    Logger.log('[API_Inversiones → api_getPortfolio → OK] ' + portfolio.length + ' operaciones');
    return {
      success:  true,
      kpis: {
        valorActual:    kpiValorTotal,
        costoTotal:     kpiCostoTotal,
        gananciaTotal:  kpiGananciaTotal,
        rendimientoPorc: kpiRendimientoPorc
      },
      portfolio: portfolio
    };

  } catch (e) {
    Logger.log('[API_Inversiones → api_getPortfolio → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_createInversion(operacionData) {
  Logger.log('[API_Inversiones → api_createInversion → inicio] ticker:' + operacionData.ticker);
  try {
    validateRequired(operacionData, ['idCuenta', 'tipoOp', 'fecha', 'ticker', 'moneda', 'cantidad', 'precio']);

    const idCuenta         = operacionData.idCuenta;
    const fecha            = operacionData.fecha;
    const tipo_operacion   = operacionData.tipoOp;
    const ticker           = operacionData.ticker.toUpperCase().trim();
    const moneda           = operacionData.moneda;
    const cantidad         = Number(operacionData.cantidad);
    const precio           = Number(operacionData.precio);

    const ID_CATEGORIA_INVERSION = 'CAT_INVERSION';

    let importe_total_ars = cantidad * precio;

    if (moneda === 'USD') {
      const rdData      = getRendimientosData('/api/cotizaciones');
      const cotizacion  = (rdData && rdData.CCL) ? { venta: rdData.CCL.venta } : getUSDCotizacion('oficial');
      if (!cotizacion) {
        throw new Error('No se pudo obtener la cotización del dólar. Intente más tarde.');
      }
      importe_total_ars = fromUSD(importe_total_ars, cotizacion.venta);
    }

    const tipo_mov_principal = (tipo_operacion === 'COMPRA') ? 'EGRESO' : 'INGRESO';
    const desc_principal     = tipo_operacion + ' ' + ticker + ' (' + moneda + ') - ' + cantidad + ' nom. @ ' + precio;
    const idInversion        = 'INV_' + generateUUID();

    // 1. Crear movimiento origen
    const movResult = crearRegistroSQL(
      idCuenta, fecha, ID_CATEGORIA_INVERSION, tipo_mov_principal,
      desc_principal, importe_total_ars, 'Broker',
      null, null, null, null, null, idInversion,
      moneda
    );
    pgInsert('movimientos', movResult.row);

    // 2. Crear registro de inversión
    const invResult = buildInversionInsert({
      idInversion:         idInversion,
      idMovimientoOrigen:  movResult.id,
      ticker:              ticker,
      fechaISO:            fecha,
      tipoOperacion:       tipo_operacion,
      moneda:              moneda,
      cantidadNominales:   cantidad,
      precioCompra:        precio,
      importeTotalArs:     importe_total_ars
    });
    pgInsert('inversiones_movimientos', invResult.row);

    Logger.log('[API_Inversiones → api_createInversion → OK] ' + idInversion);
    return { success: true, data: { id_operacion: idInversion } };

  } catch (e) {
    Logger.log('[API_Inversiones → api_createInversion → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}

function api_deleteInversion(idOperacion) {
  Logger.log('[API_Inversiones → api_deleteInversion → inicio] ' + idOperacion);
  try {
    if (!idOperacion) throw new Error('idOperacion es requerido.');

    // Borrar movimiento vinculado
    pgDelete('movimientos', { id_transfer_inversion: PG.eq(idOperacion) });
    // Borrar registro de inversión
    pgDelete('inversiones_movimientos', { id_inversion_mov: PG.eq(idOperacion) });

    Logger.log('[API_Inversiones → api_deleteInversion → OK] ' + idOperacion);
    return { success: true, data: { id_operacion: idOperacion } };

  } catch (e) {
    Logger.log('[API_Inversiones → api_deleteInversion → ERROR] ' + e.message);
    return { success: false, error: e.message };
  }
}
