'use strict';
/* ============================================================
   app-store.js — v6.0.0
   Estado centralizado de la aplicación (AppStore).
   Se registra en window.App.Store
   ============================================================ */

export class AppStore {
  #state = {
    cuenta        : 'Gastos',
    mes           : null,
    cuentas       : [],
    meses         : [],
    modulosLoaded : new Set(),
    usuario       : null,
    globalCurrency: 'ARS',
    exchangeRate  : 1,
    version       : '6.0.0'
  };

  constructor() {
    // Evita crash si App.log no está disponible en este ms exacto
    if(window.App && window.App.log) App.log('AppStore', 'constructor', 'Inicializando store');
  }

  get cuenta()   { return this.#state.cuenta; }
  get mes()      { return this.#state.mes; }
  get cuentas()  { return [...this.#state.cuentas]; }
  get meses()    { return [...this.#state.meses]; }
  get version()  { return this.#state.version; }
  get usuario()  { return this.#state.usuario ? { ...this.#state.usuario } : null; }
  get globalCurrency() { return this.#state.globalCurrency; }
  get exchangeRate() { return this.#state.exchangeRate; }

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

  setCuenta(nuevaCuenta) {
    if (nuevaCuenta === this.#state.cuenta) return;
    App.log('AppStore', 'setCuenta', `${this.#state.cuenta} → ${nuevaCuenta}`);
    this.#state.cuenta = nuevaCuenta;
    this.#invalidarTodosModulos();
    if(App.Events) App.Events.emit('store:cuenta-changed', { cuenta: nuevaCuenta });
  }

  setGlobalCurrency(nuevaMoneda) {
    if (nuevaMoneda === this.#state.globalCurrency) return;
    App.log('AppStore', 'setGlobalCurrency', `${this.#state.globalCurrency} → ${nuevaMoneda}`);
    this.#state.globalCurrency = nuevaMoneda;
    this.#invalidarTodosModulos();
    if(App.Events) App.Events.emit('store:moneda-changed', { moneda: nuevaMoneda });
  }

  setExchangeRate(rate) {
    if (!rate || isNaN(rate)) return;
    this.#state.exchangeRate = Number(rate);
  }

  setMes(nuevoMes) {
    if (nuevoMes === this.#state.mes) return;
    App.log('AppStore', 'setMes', `${this.#state.mes} → ${nuevoMes}`);
    this.#state.mes = nuevoMes;
    this.#invalidarTodosModulos();
    if(App.Events) App.Events.emit('store:mes-changed', { mes: nuevoMes });
  }

  setCuentas(listaCuentas) {
    this.#state.cuentas = Array.isArray(listaCuentas) ? listaCuentas : [];
    if(App.Events) App.Events.emit('store:cuentas-loaded', { cuentas: this.cuentas });
  }

  setMeses(listaMeses) {
    this.#state.meses = Array.isArray(listaMeses) ? listaMeses : [];
    if(App.Events) App.Events.emit('store:meses-loaded', { meses: this.meses });
  }

  setUsuario(usuario) {
    this.#state.usuario = usuario ? { ...usuario } : null;
  }

  markModuloLoaded(moduloId) {
    this.#state.modulosLoaded.add(moduloId);
    if(window.App && window.App.log) App.log('AppStore', 'markModuloLoaded', moduloId);
  }

  invalidateModulo(moduloId) {
    this.#state.modulosLoaded.delete(moduloId);
  }

  isModuloLoaded(moduloId) {
    return this.#state.modulosLoaded.has(moduloId);
  }

  #invalidarTodosModulos() {
    this.#state.modulosLoaded.clear();
  }
}

// Registrar en el scope global de la app
if (window.App) {
  window.App.Store = new AppStore();
}