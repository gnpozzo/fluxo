'use strict';
/**
 * SISTEMA DE GESTIÓN FINANCIERA - BACKEND (Módulo de Base de Datos)
 * v5.0.0
 *
 * Cambios v5.0.0:
 * - [REFACTOR] 'use strict' a nivel de archivo
 * - [ESTANDAR] Logs estructurados: [Database → función → acción]
 */

// --- SECCIÓN 1: CLIENTE HTTP BASE ---

function _supabaseRequest(method, path, payload, extraHeaders) {
  const baseUrl = SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  const url = baseUrl + path;

  const headers = Object.assign(
    {
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type':  'application/json',
      'Accept':        'application/json'
    },
    extraHeaders || {}
  );

  const options = {
    method:             method.toLowerCase(),
    headers:            headers,
    muteHttpExceptions: true
  };

  if (payload !== null && payload !== undefined) {
    options.payload = JSON.stringify(payload);
  }

  let response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (err) {
    Logger.log('[Database → _supabaseRequest → red] ' + method + ' ' + path + ': ' + err.message);
    throw new Error('[Supabase] Error de red: ' + err.message);
  }

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code < 200 || code >= 300) {
    const errPreview = body ? body.substring(0, 300) : '(sin cuerpo)';
    Logger.log('[Database → _supabaseRequest → HTTP ' + code + '] ' + method + ' ' + path + ': ' + errPreview);
    throw new Error('[Supabase] HTTP ' + code + ': ' + errPreview);
  }

  if (!body || body.trim() === '') return null;

  try {
    return JSON.parse(body);
  } catch (e) {
    Logger.log('[Database → _supabaseRequest → JSON] ' + e.message);
    throw new Error('[Supabase] Respuesta no es JSON válido');
  }
}

// --- SECCIÓN 2: CONSTRUCCIÓN DE QUERY STRING ---

function _buildFilterQS(filters) {
  if (!filters || Object.keys(filters).length === 0) return '';
  return Object.entries(filters)
    .map(function(entry) {
      return encodeURIComponent(entry[0]) + '=' + encodeURIComponent(entry[1]);
    })
    .join('&');
}

// --- SECCIÓN 3: API PÚBLICA ---

function pgSelect(table, filters, select, order, limit) {
  const parts = [];
  if (select) parts.push('select=' + encodeURIComponent(select));
  if (order)  parts.push('order=' + encodeURIComponent(order));
  if (limit)  parts.push('limit=' + limit);
  const filterQS = _buildFilterQS(filters);
  if (filterQS) parts.push(filterQS);
  const qs     = parts.length > 0 ? '?' + parts.join('&') : '';
  const path   = '/rest/v1/' + table + qs;
  const result = _supabaseRequest('GET', path, null);
  return result || [];
}

function pgRpc(funcName, params) {
  const result = _supabaseRequest('POST', '/rest/v1/rpc/' + funcName, params || {});
  return result || [];
}

function pgInsert(table, rows) {
  const result = _supabaseRequest('POST', '/rest/v1/' + table, rows, { 'Prefer': 'return=representation' });
  return result || [];
}

function pgUpdate(table, filters, data) {
  const filterQS = _buildFilterQS(filters);
  const path     = '/rest/v1/' + table + (filterQS ? '?' + filterQS : '');
  const result   = _supabaseRequest('PATCH', path, data, { 'Prefer': 'return=representation' });
  return result || [];
}

function pgDelete(table, filters) {
  if (!filters || Object.keys(filters).length === 0) {
    throw new Error('[pgDelete] Se requiere al menos un filtro para evitar borrado masivo.');
  }
  const filterQS = _buildFilterQS(filters);
  const path     = '/rest/v1/' + table + '?' + filterQS;
  return _supabaseRequest('DELETE', path, null);
}

// --- SECCIÓN 4: HELPERS DE FILTROS ---

const PG = {
  eq:    function(v)   { return 'eq.'   + v; },
  neq:   function(v)   { return 'neq.'  + v; },
  gt:    function(v)   { return 'gt.'   + v; },
  gte:   function(v)   { return 'gte.'  + v; },
  lt:    function(v)   { return 'lt.'   + v; },
  lte:   function(v)   { return 'lte.'  + v; },
  is:    function(v)   { return 'is.'   + v; },
  ilike: function(v)   { return 'ilike.*' + v + '*'; },
  in:    function(arr) { return 'in.(' + arr.map(String).join(',') + ')'; }
};
