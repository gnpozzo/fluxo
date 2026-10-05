// [Origen -> src/core -> AppAPI.js]
// v7.0.0 (Migración a REST Compatible con interfaces GAS Legacy)



export class ApiService {
  constructor() {
    this.generation = 0;
    this.defaultTtl = 5 * 60 * 1000;
    this._cache = new Map();
    this._inFlight = new Map();
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
    const key = (window.App?.Auth?.user?.id || 'anonymous') + ':' + fnName + JSON.stringify(args);
    const generation = this.generation;
    const now = Date.now();
    const cached = this._cache.get(key);
    const argsArray = Array.isArray(args) ? args : [args];

    if (cached) {
      // 1. Fresco: retornar directamente de memoria sin llamadas a la red
      if (now - cached.timestamp < ttlMs) {
        return { data: cached.data };
      }
      // 2. Stale (dentro de ventana de gracia 3x TTL): retornar caché y revalidar en segundo plano
      if (now - cached.timestamp < ttlMs * 3) {
        this.call(fnName, ...argsArray).then(fresh => {
          if (JSON.stringify(fresh) !== JSON.stringify(cached.data)) {
            this._cache.set(key, { timestamp: Date.now(), data: fresh });
            if (onRevalidate) onRevalidate(fresh);
          }
        }).catch(err => console.warn('[AppAPI -> SWR] Revalidation falló', err));
        return { data: cached.data };
      }
    }

    const data = await this.call(fnName, ...argsArray);
    if (generation === this.generation) this._cache.set(key, { timestamp: Date.now(), data });
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

  async fetch(endpoint, options = {}) {
    const method = options.method || 'POST';
    let body = options.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch(e) {}
    }
    return this.#internalFetch(endpoint, method, body || {}, options.idempotencyKey);
  }

  invalidatePattern(pattern) {
    for (const key of this._cache.keys()) {
      if (key.includes(pattern)) this._cache.delete(key);
    }
  }

  invalidateAll() {
    this.generation++;
    this._cache.clear();
    this._inFlight.clear();
  }

  // --- CORE DE RED ---

  async #internalFetch(endpoint, method = 'POST', bodyFields = {}, idempotencyKey = null) {
    const isRead = method === 'GET' || /\/(get|admin_get|search)/.test(endpoint);
    const user = window.App?.Auth?.user?.id || 'anonymous';
    const generation = this.generation;
    const key = isRead ? user + ':' + method + ':' + endpoint + ':' + JSON.stringify(bodyFields) : null;
    if (key && this._inFlight.has(key)) return this._inFlight.get(key);
    const requestKey = isRead ? null : (idempotencyKey || crypto.randomUUID());
    const promise = (async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        if(generation !== this.generation) throw new Error('La sesión cambió. Volvé a intentar.');
        const auth = window.App?.Auth;
        const token = auth?.getValidToken ? await auth.getValidToken() : auth?.getToken?.();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        if (requestKey) headers['Idempotency-Key'] = requestKey;
        let response, result;
        try {
          response = await fetch(endpoint, { method, headers, signal: AbortSignal.timeout(45000),
            ...(['GET','HEAD'].includes(method) ? {} : { body: JSON.stringify(bodyFields.args || bodyFields) }) });
          result = await response.json();
        } catch (error) {
          if(isRead && attempt < 3) { await new Promise(r => setTimeout(r,attempt*500)); continue; }
          throw new Error(requestKey ? 'No se pudo confirmar la operación. Actualizá los datos antes de volver a guardar.' : 'No se pudo conectar con el servidor.');
        }
        if(response.status === 401 && attempt === 1 && auth?.refreshSession && await auth.refreshSession()) continue;
        if(isRead && [502,503,504].includes(response.status) && attempt < 3) { await new Promise(r => setTimeout(r,attempt*500)); continue; }
        if(response.status === 401) window.App?.Events?.emit('auth:unauthorized');
        if(!response.ok || result?.success === false) throw new Error(result?.error || 'No se pudo completar la solicitud.');
        if(generation !== this.generation) throw new Error('La sesión cambió.');
        return result;
      }
      throw new Error('No se pudo completar la solicitud.');
    })();
    if(key) this._inFlight.set(key,promise);
    try { return await promise; } finally { if(key && this._inFlight.get(key) === promise) this._inFlight.delete(key); }
  }
}

export const API = new ApiService();
