'use strict';
/* ============================================================
   app-store.html — v5.0.0
   Estado centralizado de la aplicación (AppStore).
   Patrón: estado privado + métodos explícitos + eventos.
   Se registra en window.App.Store
   ============================================================ */

// --- SECCIÓN 0: CLASE AppStore ---

class AppStore {

  #state = {
    cuenta        : 'Gastos',   // cuenta activa
    mes           : null,       // 'YYYY-MM' | null = todos
    cuentas       : [],         // lista de cuentas disponibles
    meses         : [],         // lista de meses disponibles
    modulosLoaded : new Set(),  // IDs de módulos ya cargados
    usuario       : null,       // datos del usuario (si aplica)
    globalCurrency: 'ARS',      // 'ARS' o 'USD' (bimonetario)
    exchangeRate  : 1,          // Cotización USD de referencia
    version       : typeof APP_VERSION !== 'undefined' ? APP_VERSION : '5.0.0'
  };

  constructor() {
    App.log('AppStore', 'constructor', 'Inicializando store');
  }

  // --- SECCIÓN 1: GETTERS ---

  get cuenta()   { return this.#state.cuenta; }
  get mes()      { return this.#state.mes; }
  get cuentas()  { return [...this.#state.cuentas]; }
  get meses()    { return [...this.#state.meses]; }
  get version()  { return this.#state.version; }
  get usuario()  { return this.#state.usuario ? { ...this.#state.usuario } : null; }
  get globalCurrency() { return this.#state.globalCurrency; }
  get exchangeRate() { return this.#state.exchangeRate; }

  /** Snapshot inmutable del estado completo */
  getSnapshot() {
    return {
      cuenta  : this.#state.cuenta,
      mes     : this.#state.mes,
      cuentas : [...this.#state.cuentas],
      meses   : [...this.#state.meses],
      version : this.#state.version,
      usuario : this.#state.usuario ? { ...this.#state.usuario } : null,
      globalCurrency: this.#state.globalCurrency,
      exchangeRate: this.#state.exchangeRate
    };
  }

  // --- SECCIÓN 2: SETTERS CON EVENTOS ---

  /**
   * Cambia la cuenta activa. Invalida todos los módulos y emite evento.
   * @param {string} nuevaCuenta
   */
  setCuenta(nuevaCuenta) {
    if (nuevaCuenta === this.#state.cuenta) return;
    App.log('AppStore', 'setCuenta', `${this.#state.cuenta} → ${nuevaCuenta}`);
    this.#state.cuenta = nuevaCuenta;
    this.#invalidarTodosModulos();
    App.Events.emit('store:cuenta-changed', { cuenta: nuevaCuenta });
  }

  /**
   * Cambia la moneda global de visualización. Invalida módulos.
   * @param {string} nuevaMoneda 'ARS' o 'USD'
   */
  setGlobalCurrency(nuevaMoneda) {
    if (nuevaMoneda === this.#state.globalCurrency) return;
    App.log('AppStore', 'setGlobalCurrency', `${this.#state.globalCurrency} → ${nuevaMoneda}`);
    this.#state.globalCurrency = nuevaMoneda;
    this.#invalidarTodosModulos();
    App.Events.emit('store:moneda-changed', { moneda: nuevaMoneda });
  }

  /**
   * Actualiza la cotización del dólar de referencia
   * @param {number} rate
   */
  setExchangeRate(rate) {
    if (!rate || isNaN(rate)) return;
    this.#state.exchangeRate = Number(rate);
  }

  /**
   * Cambia el mes activo. Invalida todos los módulos y emite evento.
   * @param {string|null} nuevoMes  'YYYY-MM' o null
   */
  setMes(nuevoMes) {
    if (nuevoMes === this.#state.mes) return;
    App.log('AppStore', 'setMes', `${this.#state.mes} → ${nuevoMes}`);
    this.#state.mes = nuevoMes;
    this.#invalidarTodosModulos();
    App.Events.emit('store:mes-changed', { mes: nuevoMes });
  }

  /**
   * Establece las cuentas disponibles (llamado al iniciar la app).
   * @param {Array<{id:string, nombre:string}>} listaCuentas
   */
  setCuentas(listaCuentas) {
    this.#state.cuentas = Array.isArray(listaCuentas) ? listaCuentas : [];
    App.Events.emit('store:cuentas-loaded', { cuentas: this.cuentas });
  }

  /**
   * Establece los meses disponibles.
   * @param {string[]} listaMeses  array de 'YYYY-MM'
   */
  setMeses(listaMeses) {
    this.#state.meses = Array.isArray(listaMeses) ? listaMeses : [];
    App.Events.emit('store:meses-loaded', { meses: this.meses });
  }

  /**
   * Establece datos del usuario autenticado.
   * @param {Object} usuario
   */
  setUsuario(usuario) {
    this.#state.usuario = usuario ? { ...usuario } : null;
  }

  // --- SECCIÓN 3: GESTIÓN DE MÓDULOS LAZY ---

  /**
   * Marca un módulo como cargado.
   * @param {string} moduloId
   */
  markModuloLoaded(moduloId) {
    this.#state.modulosLoaded.add(moduloId);
    App.log('AppStore', 'markModuloLoaded', moduloId);
  }

  /**
   * Invalida un módulo (fuerza recarga en próxima visita).
   * @param {string} moduloId
   */
  invalidateModulo(moduloId) {
    this.#state.modulosLoaded.delete(moduloId);
    App.log('AppStore', 'invalidateModulo', moduloId);
  }

  /**
   * Verifica si un módulo ya fue cargado.
   * @param {string} moduloId
   * @returns {boolean}
   */
  isModuloLoaded(moduloId) {
    return this.#state.modulosLoaded.has(moduloId);
  }

  // --- SECCIÓN 4: PRIVADOS ---

  #invalidarTodosModulos() {
    this.#state.modulosLoaded.clear();
    App.log('AppStore', '#invalidarTodosModulos', 'Todos los módulos invalidados');
  }
}

// --- REGISTRO EN NAMESPACE ---
App.Store = new AppStore();
App.log('app-store', 'init', 'App.Store registrado');