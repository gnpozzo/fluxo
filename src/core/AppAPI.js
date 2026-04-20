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

  invalidateAll() {
    this._cache.clear();
  }

  // --- CORE DE RED ---

  async #internalFetch(endpoint, method = 'POST', bodyFields = {}) {
    const response = await fetch(endpoint, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyFields.args ? bodyFields.args[0] : bodyFields)
    });

    if (!response.ok) {
      if (response.status === 401 && window.App.Events) {
        window.App.Events.emit('auth:unauthorized');
      }
      throw new Error(`HTTP Error: ${response.status} en ${endpoint}`);
    }

    const { success, error, data, ...rest } = await response.json();
    
    if (success === false) {
      throw new Error(error || 'Error genérico en el servidor');
    }

    return { success: true, ...data, ...rest };
  }

}

export const API = new ApiService();
