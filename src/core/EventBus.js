// [Origen -> src/core -> EventBus.js]
// v1.0.0
// QA Passed: true
// Singleton robusto que funge como mediador central de la app mediante Pub/Sub.
// Garantiza desacoplamiento estricto según paradigma POO.

class EventBusCore {
  constructor() {
    // Almacén de callbacks suscritos por evento
    this.listeners = {};
    // QA: Guardamos un log interno para tracing
    this.debug = true;
  }

  /**
   * Suscribe un callback a un evento específico.
   * @param {string} eventName - Nombre del evento (ej: 'auth:login')
   * @param {Function} callback - Función a ejecutar
   * @returns {Function} Función para desuscribirse
   */
  on(eventName, callback) {
    if (typeof callback !== 'function') {
      console.error(`[EventBus -> on -> ERROR] El listener para '${eventName}' no es una función.`);
      return;
    }

    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }
    
    this.listeners[eventName].push(callback);

    // Devuelve función unbind
    return () => this.off(eventName, callback);
  }

  /**
   * Desinscribe un callback de un evento.
   * @param {string} eventName 
   * @param {Function} callback 
   */
  off(eventName, callback) {
    if (!this.listeners[eventName]) return;
    
    this.listeners[eventName] = this.listeners[eventName].filter(cb => cb !== callback);
  }

  /**
   * Emite un evento, ejecutando todos los callbacks suscritos.
   * La emisión es asíncrona por defecto (Promises) para evitar cuellos de botella en la renderización UI (QA check).
   * @param {string} eventName 
   * @param {any} payload - Datos a enviar a los suscriptores
   */
  async emit(eventName, payload = null) {
    if (this.debug) {
      console.log(`📡 [EventBus -> emit] ${eventName}`, payload !== null ? payload : '');
    }

    if (!this.listeners[eventName]) return;

    // Ejecutar todos los listeners en paralelo pero que el Thread principal no se bloquee.
    const promises = this.listeners[eventName].map(callback => {
      return new Promise(resolve => {
        setTimeout(async () => {
          try {
            await callback(payload);
          } catch (e) {
            console.error(`[EventBus -> listener -> ERROR] Falló la ejecución en '${eventName}':`, e);
          }
          resolve();
        }, 0);
      });
    });

    await Promise.all(promises);
  }

  /**
   * Limpia todos los listeners. Útil para teardowns.
   */
  clear() {
    this.listeners = {};
    if (this.debug) console.log(`[EventBus -> clear] Limpieza total del bus`);
  }
}

export const EventBus = new EventBusCore();
