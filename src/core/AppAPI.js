// [Origen -> src/core -> AppAPI.js]
// v7.0.0 (Migración a REST Compatible con interfaces GAS Legacy)

import { EventBus } from './EventBus.js';

class ApiService {
  constructor() {
    this.defaultTtl = 5 * 60 * 1000;
    this._cache = new Map();
  }

  // --- COMPATIBILIDAD CON GAS Legacy ---

  call(fnName, ...args) {
    const endpointRegex = fnName.replace('api_', '');
    // Soporte nativo a endpoints migrados en nodejs para /api
    const path = `/api/${endpointRegex}`;
    return this.#internalFetch(path, 'POST', { args });
  }

  async cached(fnName, args = [], ttl = this.defaultTtl) {
    return this.swr(fnName, args, ttl).then(res => res.data);
  }

  async swr(fnName, args = [], ttlMs = this.defaultTtl, onRevalidate = null) {
    const key = fnName + JSON.stringify(args);
    const now = Date.now();
    const cached = this._cache.get(key);

    if (cached) {
       if (now - cached.timestamp < ttlMs) {
         this.call(fnName, ...args).then(fresh => {
           if (JSON.stringify(fresh) !== JSON.stringify(cached.data)) {
               this._cache.set(key, { timestamp: Date.now(), data: fresh });
               if (onRevalidate) onRevalidate(fresh);
           }
         }).catch(err => console.warn('[AppAPI -> SWR] Revalidation falló', err));
         return { data: cached.data };
       }
    }

    const data = await this.call(fnName, ...args);
    this._cache.set(key, { timestamp: Date.now(), data: data });
    return { data: data };
  }

  async get(fnName, extraParams = {}, ttl = this.defaultTtl) {
    const { cuenta, mes } = window.App.Store;
    return this.cached(fnName, [{ cuenta, mes, ...extraParams }], ttl);
  }

  async send(fnName, payload) {
    return this.call(fnName, payload);
  }

  async remove(fnName, id) {
    return this.call(fnName, id);
  }

  invalidatePattern(pattern) {
    for (const key of this._cache.keys()) {
      if (key.includes(pattern)) this._cache.delete(key);
    }
  }

  invalidateAll() {
    this._cache.clear();
  }

  // --- CORE DE RED ---

  async #internalFetch(endpoint, method = 'POST', bodyFields = {}) {
    if (window.App) window.App.log('AppAPI', 'fetch:start', { endpoint, method, bodyFields });
    const t0 = performance.now();
    const headers = {
      'Content-Type': 'application/json',
    };
    if (window.App && window.App.Auth) {
      const token = window.App.Auth.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    let finalBody = bodyFields;
    if (bodyFields.args) {
      finalBody = bodyFields.args;
    }

    try {
      const response = await fetch(endpoint, {
        method: method,
        headers: headers,
        body: JSON.stringify(finalBody)
      });

      if (!response.ok) {
        if (response.status === 401 && window.App && window.App.Events) {
          window.App.Events.emit('auth:unauthorized');
        }
        throw new Error(`HTTP Error: ${response.status} en ${endpoint}`);
      }

      const resObj = await response.json();
      
      if (resObj.success === false) {
        throw new Error(resObj.error || 'Error genérico en el servidor');
      }

      if (window.App) window.App.log('AppAPI', 'fetch:success', { endpoint, time: `${(performance.now() - t0).toFixed(1)}ms` });
      return resObj;
    } catch (err) {
      alert('APP_API ERROR: ' + err.message);
      if (window.App) window.App.error('AppAPI', 'fetch:error', { endpoint, error: err.message, time: `${(performance.now() - t0).toFixed(1)}ms` });
      throw err;
    }
  }

}

export const API = new ApiService();
