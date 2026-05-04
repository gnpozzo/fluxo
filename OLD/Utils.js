'use strict';
/**
 * SISTEMA DE GESTIÓN FINANCIERA - BACKEND (Módulo de Utilidades)
 * v5.0.0
 *
 * Cambios v5.0.0:
 * - [REFACTOR] 'use strict' a nivel de archivo
 * - [NUEVO] validateRequired(obj, fields): validación centralizada de input
 * - [NUEVO] buildInsert(table, row): factory genérico que reemplaza helpers duplicados
 * - [NUEVO] toUSD(importeARS, cotizacion): conversión ARS→USD movida desde API_Ahorro
 * - [ESTANDAR] Logs estructurados: [Utils → función → acción]
 *
 * Cambios v3.0.0 (mantenidos):
 * - crearRegistroSQL(): retorna {id, _table, row} para pgInsert()
 * - executeBatch(): itera {_table, row} y llama pgInsert() por cada fila
 * - getRendimientosData(): cliente HTTP para rendimientos.co
 */

// --- SECCIÓN 0: CONFIGURACIÓN Y CONSTANTES ---

/** Valores válidos para el campo tipo_mov en la tabla Movimientos. */
const TIPOS_MOV_VALIDOS = ['INGRESO', 'EGRESO'];

/**
 * Tipos de dólar soportados por dolarapi.com.
 * Documentación: https://dolarapi.com
 */
const DOLAR_TIPOS_VALIDOS = ['oficial', 'blue', 'bolsa', 'contadoconliqui', 'cripto', 'mayorista'];

// --- SECCIÓN 1: VALIDACIÓN DE INPUT ---

/**
 * Valida que los campos requeridos estén presentes en el objeto de entrada.
 * Lanza un Error con detalle del campo faltante si la validación falla.
 * Usar dentro de bloques try/catch en todas las funciones api_*.
 *
 * @param {object} obj    - Objeto a validar (payload del frontend).
 * @param {string[]} fields - Lista de nombres de campos requeridos.
 * @throws {Error} Si algún campo está ausente, null, undefined o vacío.
 */
function validateRequired(obj, fields) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('[validateRequired] El payload es nulo o no es un objeto.');
  }
  fields.forEach(function(f) {
    const val = obj[f];
    if (val === undefined || val === null || val === '') {
      throw new Error('Campo requerido faltante: ' + f);
    }
  });
}

// --- SECCIÓN 2: FACTORY DE INSERCIONES ---

/**
 * Crea un objeto {_table, row} listo para pgInsert() o executeBatch().
 * Factory genérico que reemplaza los helpers buildTCInsert, buildCCInsert,
 * buildInversionInsert que duplicaban esta estructura.
 *
 * @param {string} table - Nombre de la tabla Supabase (ej. 'movimientos').
 * @param {object} row   - Campos y valores del registro. El ID debe incluirse en el row.
 * @returns {{ _table: string, row: object }}
 * @throws {Error} Si table o row son inválidos.
 */
function buildInsert(table, row) {
  if (!table || typeof table !== 'string') {
    throw new Error('[buildInsert] table es requerida y debe ser string.');
  }
  if (!row || typeof row !== 'object') {
    throw new Error('[buildInsert] row es requerido y debe ser un objeto.');
  }
  return { _table: table, row: row };
}

// --- SECCIÓN 3: CONVERSIÓN DE MONEDA ---

/**
 * Convierte un importe en ARS a USD usando una cotización.
 * Centraliza la lógica que antes estaba duplicada en API_Ahorro.js.
 *
 * @param {number} importeARS  - Importe en pesos argentinos.
 * @param {number} cotizacion  - Tipo de cambio ARS/USD (precio del dólar en ARS).
 * @returns {number} Importe equivalente en USD, redondeado a 2 decimales.
 * @throws {Error} Si los parámetros son inválidos o la cotización es cero.
 */
function toUSD(importeARS, cotizacion) {
  if (typeof importeARS !== 'number' || isNaN(importeARS)) {
    throw new Error('[toUSD] importeARS debe ser un número válido.');
  }
  if (typeof cotizacion !== 'number' || isNaN(cotizacion) || cotizacion <= 0) {
    throw new Error('[toUSD] cotizacion debe ser un número positivo.');
  }
  return Math.round((importeARS / cotizacion) * 100) / 100;
}

/**
 * Convierte un importe en USD a ARS usando una cotización.
 *
 * @param {number} importeUSD  - Importe en dólares.
 * @param {number} cotizacion  - Tipo de cambio ARS/USD (precio del dólar en ARS).
 * @returns {number} Importe equivalente en ARS, redondeado a 2 decimales.
 * @throws {Error} Si los parámetros son inválidos o la cotización es cero.
 */
function fromUSD(importeUSD, cotizacion) {
  if (typeof importeUSD !== 'number' || isNaN(importeUSD)) {
    throw new Error('[fromUSD] importeUSD debe ser un número válido.');
  }
  if (typeof cotizacion !== 'number' || isNaN(cotizacion) || cotizacion <= 0) {
    throw new Error('[fromUSD] cotizacion debe ser un número positivo.');
  }
  return Math.round((importeUSD * cotizacion) * 100) / 100;
}

// --- SECCIÓN 4: GENERACIÓN DE IDs ---

function generateUUID() {
  return Utilities.getUuid();
}

// --- SECCIÓN 5: COTIZACIONES EXTERNAS ---

/**
 * Obtiene datos desde la API de rendimientos.co (rendimientos-ar).
 * Sin autenticación ni API key. Caché de 60 segundos por endpoint.
 *
 * Endpoints disponibles:
 *   '/api/cotizaciones'  → { Oficial, CCL, MEP, Risk_Country }
 *   '/api/mundo'         → Índices y acciones globales (S&P 500, Nasdaq, oro, etc.)
 *   '/api/mundo?symbol=X&range=1d' → Cotización puntual de un ticker
 *   '/api/soberanos'     → Bonos soberanos USD (AL30D, GD30, etc.)
 *   '/api/lecaps'        → LECAPs y BONCAPs
 *   '/api/ons'           → Obligaciones Negociables
 *   '/api/fci'           → Fondos Comunes de Inversión (TNA)
 *   '/api/cer'           → Coeficiente CER del BCRA
 *
 * @param {string} endpoint - Ruta relativa (ej. '/api/cotizaciones')
 * @returns {object|Array|null}
 */
function getRendimientosData(endpoint) {
  const cacheKey = 'RENDIMIENTOS_' + endpoint.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  const cache    = CacheService.getScriptCache();
  const cached   = cache.get(cacheKey);

  if (cached) {
    Logger.log('[Utils → getRendimientosData → caché] ' + endpoint);
    return JSON.parse(cached);
  }

  const url     = 'https://rendimientos.co' + endpoint;
  const options = { method: 'get', muteHttpExceptions: true };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const code     = response.getResponseCode();

    if (code !== 200) {
      Logger.log('[Utils → getRendimientosData → HTTP ' + code + '] ' + endpoint);
      return null;
    }

    const data = JSON.parse(response.getContentText());
    cache.put(cacheKey, JSON.stringify(data), 60);
    Logger.log('[Utils → getRendimientosData → OK] ' + endpoint);
    return data;

  } catch (e) {
    Logger.log('[Utils → getRendimientosData → ERROR] ' + endpoint + ': ' + e.message);
    return null;
  }
}

/**
 * Obtiene la cotización de un tipo de dólar desde dolarapi.com.
 * Almacena en caché por 1 hora para reducir llamadas externas.
 *
 * Tipos disponibles:
 *   - 'oficial'         → Dólar Banco Nación (compra/venta)
 *   - 'blue'            → Dólar blue informal
 *   - 'bolsa'           → Dólar MEP (Mercado Electrónico de Pagos)
 *   - 'contadoconliqui' → Dólar CCL (Contado Con Liquidación)
 *   - 'cripto'          → Dólar cripto (USDT/ARS en exchanges)
 *   - 'mayorista'       → Dólar mayorista (mercado interbancario)
 *
 * @param {'oficial'|'blue'|'bolsa'|'contadoconliqui'|'cripto'|'mayorista'} tipo
 * @returns {{compra: number, venta: number, tipo: string}|null}
 */
function getUSDCotizacion(tipo) {
  if (!DOLAR_TIPOS_VALIDOS.includes(tipo)) {
    Logger.log('[Utils → getUSDCotizacion → tipo inválido] "' + tipo + '". Válidos: ' + DOLAR_TIPOS_VALIDOS.join(', '));
    return null;
  }

  const cache     = CacheService.getScriptCache();
  const CACHE_KEY = 'USD_COTIZACION_' + tipo.toUpperCase();
  const cached    = cache.get(CACHE_KEY);

  if (cached) {
    Logger.log('[Utils → getUSDCotizacion → caché] ' + tipo);
    return JSON.parse(cached);
  }

  const API_URL = 'https://dolarapi.com/v1/dolares/' + tipo;
  Logger.log('[Utils → getUSDCotizacion → fetch] ' + tipo);

  const options = { method: 'get', muteHttpExceptions: true };

  try {
    const response     = UrlFetchApp.fetch(API_URL, options);
    const responseCode = response.getResponseCode();

    if (responseCode !== 200) {
      throw new Error('dolarapi.com HTTP ' + responseCode + ' para tipo "' + tipo + '".');
    }

    const data   = JSON.parse(response.getContentText());
    const compra = parseFloat(data.compra);
    const venta  = parseFloat(data.venta);

    if (isNaN(compra) || isNaN(venta)) {
      throw new Error('No se pudo parsear compra/venta de dolarapi.com para tipo "' + tipo + '".');
    }

    const cotizacion = { compra: compra, venta: venta, tipo: tipo };
    cache.put(CACHE_KEY, JSON.stringify(cotizacion), 3600);

    Logger.log('[Utils → getUSDCotizacion → OK] ' + tipo + ' compra:' + compra + ' venta:' + venta);
    return cotizacion;

  } catch (e) {
    Logger.log('[Utils → getUSDCotizacion → ERROR] ' + tipo + ': ' + e.message);
    return null;
  }
}

/**
 * Obtiene la cotización del Dólar Oficial desde dolarapi.com.
 * Wrapper de compatibilidad sobre getUSDCotizacion('oficial').
 * @returns {{compra: number, venta: number, tipo: string}|null}
 */
function getUSDCotizacionOficial() {
  return getUSDCotizacion('oficial');
}

/**
 * Obtiene la cotización de un ticker desde Financial Modeling Prep (FMP).
 * Usa lógica de fallback: ticker directo → ticker.BA → Alpha Vantage.
 * @param {string} ticker - Símbolo del activo (ej. 'AAPL', 'GGAL').
 * @returns {number|null}
 */
function getFMPCotizacion(ticker) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('FMP_API_KEY');

  if (!apiKey) {
    Logger.log("[Utils → getFMPCotizacion → ERROR] Propiedad 'FMP_API_KEY' no configurada.");
    return fetchAlphaVantagePrice(ticker);
  }

  const tickerLimpio = ticker.toUpperCase().replace('.BA', '');

  let price = fetchFMPPrice(tickerLimpio, apiKey);

  if (price === null && !tickerLimpio.includes('.')) {
    Logger.log('[Utils → getFMPCotizacion → fallback .BA] ' + tickerLimpio);
    price = fetchFMPPrice(tickerLimpio + '.BA', apiKey);
  }

  if (price === null) {
    Logger.log('[Utils → getFMPCotizacion → fallback AlphaVantage] ' + tickerLimpio);
    price = fetchAlphaVantagePrice(tickerLimpio);
  }

  return price;
}

/**
 * Función auxiliar para la llamada HTTP a FMP para un ticker específico.
 * @param {string} ticker - Símbolo del activo con sufijo si aplica.
 * @param {string} apiKey - API key de FMP.
 * @returns {number|null}
 */
function fetchFMPPrice(ticker, apiKey) {
  const API_URL = 'https://financialmodelingprep.com/stable/quote-short/' + ticker + '?apikey=' + apiKey;
  const options = { method: 'get', muteHttpExceptions: true };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    if (response.getResponseCode() !== 200) {
      Logger.log('[Utils → fetchFMPPrice → HTTP] ' + response.getResponseCode() + ' para ' + ticker);
      return null;
    }
    const data = JSON.parse(response.getContentText());

    if (Array.isArray(data) && data.length > 0 && data[0] && data[0].price) {
      Logger.log('[Utils → fetchFMPPrice → OK] ' + ticker + ': ' + data[0].price);
      return Number(data[0].price);
    }

    Logger.log('[Utils → fetchFMPPrice → sin datos] ' + ticker);
    return null;

  } catch (e) {
    Logger.log('[Utils → fetchFMPPrice → ERROR] ' + ticker + ': ' + e.message);
    return null;
  }
}

/**
 * Obtiene el precio de un ticker desde Alpha Vantage API (free tier).
 * Caché de 15 minutos por ticker para respetar el límite de 25 req/día del free tier.
 * Requiere la propiedad 'ALPHA_VANTAGE_API_KEY' en PropertiesService.
 *
 * @param {string} ticker - Símbolo del activo (ej. 'AAPL', 'MSFT').
 * @returns {number|null}
 */
function fetchAlphaVantagePrice(ticker) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ALPHA_VANTAGE_API_KEY');

  if (!apiKey) {
    Logger.log("[Utils → fetchAlphaVantagePrice → ERROR] Propiedad 'ALPHA_VANTAGE_API_KEY' no configurada.");
    return null;
  }

  const cache     = CacheService.getScriptCache();
  const CACHE_KEY = 'AV_PRICE_' + ticker.toUpperCase();
  const cached    = cache.get(CACHE_KEY);

  if (cached) {
    Logger.log('[Utils → fetchAlphaVantagePrice → caché] ' + ticker + ': ' + cached);
    return Number(cached);
  }

  const API_URL = 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=' + encodeURIComponent(ticker) + '&apikey=' + apiKey;
  const options = { method: 'get', muteHttpExceptions: true };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    if (response.getResponseCode() !== 200) {
      Logger.log('[Utils → fetchAlphaVantagePrice → HTTP] ' + response.getResponseCode() + ' para ' + ticker);
      return null;
    }

    const data  = JSON.parse(response.getContentText());
    const quote = data['Global Quote'];

    if (!quote || !quote['05. price']) {
      Logger.log('[Utils → fetchAlphaVantagePrice → sin datos] ' + ticker + ' (límite diario alcanzado?)');
      return null;
    }

    const price = Number(quote['05. price']);
    cache.put(CACHE_KEY, String(price), 900);

    Logger.log('[Utils → fetchAlphaVantagePrice → OK] ' + ticker + ': ' + price);
    return price;

  } catch (e) {
    Logger.log('[Utils → fetchAlphaVantagePrice → ERROR] ' + ticker + ': ' + e.message);
    return null;
  }
}

// --- SECCIÓN 6: HELPERS DE SEGURIDAD Y SANITIZACIÓN ---

/**
 * Sanitiza un string de entrada truncando a la longitud máxima.
 * Los valores se pasan como parámetros a PostgREST; nunca se concatenan en SQL.
 *
 * @param {*} str - El valor a sanitizar.
 * @param {number} maxLen - Longitud máxima permitida (default: 500).
 * @returns {string}
 */
function sanitizeString(str, maxLen) {
  if (maxLen === undefined) maxLen = 500;
  if (str === null || str === undefined) return '';
  return String(str).substring(0, maxLen);
}

// --- SECCIÓN 7: GENERADOR DE ROW OBJECTS PARA SUPABASE ---

/**
 * Crea un row object listo para insertar en la tabla `movimientos` via pgInsert().
 *
 * @param {string}      idCuenta    - ID de cuentas_principales.
 * @param {string}      fechaISO    - Fecha en formato YYYY-MM-DD.
 * @param {string}      idCategoria - ID de categorias.
 * @param {string}      tipo        - 'INGRESO' o 'EGRESO'.
 * @param {string}      desc        - Descripción (se trunca a 500 chars).
 * @param {number}      imp         - Importe del movimiento.
 * @param {string}      medio       - Medio de pago.
 * @param {string|null} recurId     - ID de grupo recurrente (REC_uuid).
 * @param {string|null} splitId     - ID de grupo split (SPLIT_uuid).
 * @param {string|null} splitRol    - 'ORIGEN' o 'DESTINO'.
 * @param {string|null} idConsumoTC - ID del consumo TC vinculado.
 * @param {string|null} idAhorro    - ID de la transferencia de ahorro vinculada.
 * @param {string|null} idInversion - ID de la operación de inversión vinculada.
 * @param {string}      [moneda]    - 'ARS' (default) o 'USD'.
 * @returns {{id: string, _table: string, row: object}}
 */
function crearRegistroSQL(
  idCuenta, fechaISO, idCategoria, tipo, desc, imp, medio,
  recurId, splitId, splitRol,
  idConsumoTC, idAhorro, idInversion,
  moneda
) {
  if (splitRol    === undefined) splitRol    = null;
  if (idConsumoTC === undefined) idConsumoTC = null;
  if (idAhorro    === undefined) idAhorro    = null;
  if (idInversion === undefined) idInversion = null;
  if (moneda      === undefined) moneda      = 'ARS';

  if (!idCuenta || typeof idCuenta !== 'string') {
    throw new Error('[crearRegistroSQL] idCuenta es requerido y debe ser string.');
  }
  if (!fechaISO || !/^\d{4}-\d{2}-\d{2}$/.test(fechaISO)) {
    throw new Error('[crearRegistroSQL] fechaISO inválido: "' + fechaISO + '". Formato esperado: YYYY-MM-DD.');
  }
  if (!idCategoria || typeof idCategoria !== 'string') {
    throw new Error('[crearRegistroSQL] idCategoria es requerido y debe ser string.');
  }
  if (!TIPOS_MOV_VALIDOS.includes(tipo)) {
    throw new Error('[crearRegistroSQL] tipo_mov inválido: "' + tipo + '". Válidos: ' + TIPOS_MOV_VALIDOS.join(', ') + '.');
  }
  const importeNum = typeof imp === 'number' ? imp : parseFloat(imp);
  if (isNaN(importeNum)) {
    throw new Error('[crearRegistroSQL] importe inválido: "' + imp + '". Debe ser numérico.');
  }

  const idMovimiento = generateUUID();

  return {
    id:     idMovimiento,
    _table: 'movimientos',
    row: {
      id_movimiento:             idMovimiento,
      id_cuenta_principal:       idCuenta,
      id_categoria:              idCategoria,
      fecha:                     fechaISO,
      tipo_mov:                  tipo,
      descripcion:               sanitizeString(desc, 500),
      importe:                   importeNum,
      medio_pago:                sanitizeString(medio || 'efectivo', 100),
      moneda:                    moneda,
      recur_group_id:            recurId    || null,
      split_group_id:            splitId    || null,
      split_rol:                 splitRol   || null,
      es_imputacion_tc:          !!idConsumoTC,
      id_consumo_tarjeta_origen: idConsumoTC || null,
      id_transfer_ahorro:        idAhorro   || null,
      id_transfer_inversion:     idInversion || null
      // created_at: omitido — Postgres usa DEFAULT now()
    }
  };
}

// --- SECCIÓN 8: HELPER DE FECHA SEGURA ---

/**
 * Avanza una fecha por N meses sin desbordamiento de día (fix M5).
 * Reemplaza el uso directo de setUTCMonth() en todos los módulos.
 *
 * Ejemplo:
 *   addMonthsSafe(new Date('2024-01-31'), 1) → 2024-02-29
 *   addMonthsSafe(new Date('2024-03-31'), 1) → 2024-04-30
 *
 * @param {Date} baseDate - Fecha base (objeto Date UTC).
 * @param {number} months - Meses a avanzar (puede ser 0).
 * @returns {Date}
 */
function addMonthsSafe(baseDate, months) {
  const baseYear  = baseDate.getUTCFullYear();
  const baseMonth = baseDate.getUTCMonth();
  const baseDay   = baseDate.getUTCDate();

  const totalMonths = baseMonth + months;
  const targetYear  = baseYear + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;

  const lastDayOfTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(baseDay, lastDayOfTarget);

  return new Date(Date.UTC(targetYear, targetMonth, targetDay));
}

// --- SECCIÓN 9: HELPER DE EJECUCIÓN POR LOTES ---

/**
 * Inserta un array de row objects en Supabase, uno por uno en secuencia.
 * Detiene en el primer error (atomicidad de falla), lo que evita inserciones parciales.
 *
 * Cada elemento debe ser un objeto con:
 *   - _table {string} — nombre de la tabla Supabase (ej. 'movimientos', 'ahorros')
 *   - row    {object} — campos y valores a insertar
 *
 * Compatible con lotes de tablas mixtas (ej. movimiento + ahorro).
 *
 * @param {Array<{_table: string, row: object}>} items
 * @throws {Error} Si el array está vacío o si algún objeto es inválido.
 */
function executeBatch(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('[executeBatch] Se requiere un array de row objects no vacío.');
  }

  Logger.log('[Utils → executeBatch → inicio] ' + items.length + ' registro(s).');

  var i = 0;
  for (var idx = 0; idx < items.length; idx++) {
    var item = items[idx];
    if (!item || !item._table || !item.row) {
      throw new Error('[executeBatch] Objeto en índice ' + idx + ' no tiene _table o row válidos.');
    }
    pgInsert(item._table, item.row);
    i++;
  }

  Logger.log('[Utils → executeBatch → OK] ' + i + ' registro(s) insertados.');
}
