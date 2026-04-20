// [Origen -> src/core -> AppAPI.js]
// v6.0.0 (Migración a REST)
// Módulo responsable de mediar toda la comunicación del Front con el Backend en Vercel (/api).
// Reemplaza nativamente a 'google.script.run'.

import { EventBus } from './EventBus.js';

class ApiService {
  constructor() {
    this.defaultTtl = 5 * 60 * 1000; // 5 minutos de caché por SWR
    this._cache = new Map();
  }

  /**
   * Stale-While-Revalidate (SWR) implementation
   * Si los datos existen en caché local, los retorna instantáneamente mientras hace un fetch oculto
   * para revalidar, emitiendo un evento y callback si los datos cambian.
   * @param {string} endpoint - Path al endpoint (ej: '/api/getDashboardData')
   * @param {Object} payload - Body de la petición (JSON)
   * @param {number} ttlMs - Tiempo de vida de la caché
   * @param {Function} onRevalidate - Callback invocado si los datos se actualizan asíncronamente
   */
  async swr(endpoint, payload = {}, ttlMs = this.defaultTtl, onRevalidate = null) {
    const key = endpoint + JSON.stringify(payload);
    const now = Date.now();
    const cached = this._cache.get(key);

    // Si tenemos cache y no está vencida
    if (cached) {
      if (now - cached.timestamp < ttlMs) {
        // Ejecución en 2do plano de refetch "silencioso" para actualizar la caché 
        // sin bloquear UI, emulando la excelencia en UX de React SWR.
        this.#fetchAndStore(endpoint, payload, key).then(fresh => {
           // Chequeo de inmutabilidad (muy rudimentario para objetos, pero eficaz si serializa)
           if (JSON.stringify(fresh) !== JSON.stringify(cached.data)) {
               if (onRevalidate) onRevalidate(fresh);
           }
        }).catch(err => console.warn('[AppAPI -> SWR] Revalidation falló', err));

        // Retorno inmediato de la UI reactiva
        return { data: cached.data };
      }
    }

    // Caso base: No hay caché o expiró completamente (Hard fetch bloqueante)
    try {
      const data = await this.#fetchAndStore(endpoint, payload, key);
      return { data: data };
    } catch (err) {
      console.error(`[AppAPI -> ERROR] Falló fetch inicial a ${endpoint}:`, err);
      // Fallback a caché vieja si el server falla, garantizando Resiliencia!
      if (cached) return { data: cached.data };
      throw err;
    }
  }

  /**
   * Método transaccional directo sin caché (Para Writes/Updates/Deletes).
   */
  async post(endpoint, payload = {}) {
    return await this.#internalFetch(endpoint, 'POST', payload);
  }

  /**
   * Helper privado de Fetch
   */
  async #fetchAndStore(endpoint, payload, key) {
    const data = await this.#internalFetch(endpoint, 'POST', payload);
    this._cache.set(key, { timestamp: Date.now(), data: data });
    return data;
  }

  async #internalFetch(endpoint, method = 'POST', bodyFields = {}) {
    // QA: Tratamiento robusto de Errores e interceptores.
    const response = await fetch(endpoint, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
      // Sólo enviamos body en non-GET/HEAD
      body: method === 'GET' ? undefined : JSON.stringify(bodyFields)
    });

    if (!response.ok) {
      // Manejo de Error 401/403 (Auth invalidation)
      if (response.status === 401) {
        EventBus.emit('auth:unauthorized');
      }
      throw new Error(`HTTP Error: ${response.status} en ${endpoint}`);
    }

    const { success, error, data, ...rest } = await response.json();
    
    // Si la API explícitamente retorna success:false con un mensaje amigable
    if (success === false) {
      throw new Error(error || 'Error genérico en el servidor');
    }

    // Regresa el objeto estandarizado
    return { success: true, data: data, ...rest };
  }

  clearCache() {
    this._cache.clear();
  }
}

export const API = new ApiService();
