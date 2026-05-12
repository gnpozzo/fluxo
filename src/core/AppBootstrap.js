'use strict';
/* ================================================================
   SISTEMA DE GESTIÓN FINANCIERA
   app-bootstrap.js — v6.0.0
   Capa 1: Namespace global + Clase abstracta BaseModule
   ================================================================ */

const APP_VERSION    = '6.0.0';
const APP_NAME       = 'Fluxo';
const APP_DEBUG      = true;   // false en producción

window.App = {
  VERSION : APP_VERSION,
  NAME    : APP_NAME,

  Store   : null,
  Events  : null,
  API     : null,
  Icons   : null,
  Utils   : null,
  Toast   : null,
  Modal   : null,
  Modules : {}
};

App.log = function log(origin, action, payload) {
  if (!APP_DEBUG) return;
  const tag = `[${origin} -> ${action}]`;
  if (payload !== undefined) {
    console.log(tag, payload);
  } else {
    console.log(tag);
  }
};

App.warn = function warn(origin, action, payload) {
  const tag = `[${origin} -> ${action} -> WARN]`;
  console.warn(tag, payload ?? '');
};

App.error = function error(origin, action, payload) {
  const tag = `[${origin} -> ${action} -> ERROR]`;
  console.error(tag, payload ?? '');
};

export class BaseModule {
  get moduleId() { throw new Error(`[BaseModule] moduleId no definido en ${this.constructor.name}`); }
  get vistaId() { throw new Error(`[BaseModule] vistaId no definido en ${this.constructor.name}`); }
  get _createEndpoint() { return null; }
  get _updateEndpoint() { return null; }
  get _deleteEndpoint() { return null; }

  init() {
    App.log(this.moduleId, 'init', 'Registrando listeners y suscripciones');
    this._bindListeners();
    this._subscribeEvents();
  }

  async cargar() {
    if (App.Store.isModuloLoaded(this.moduleId)) {
      App.log(this.moduleId, 'cargar', 'Ya cargado, omitiendo');
      return;
    }
    App.log(this.moduleId, 'cargar', 'Iniciando carga de datos');
    this._showSkeleton();

    try {
      const data = await this._fetchData();
      this._render(data);
      App.Store.markModuloLoaded(this.moduleId);
      App.log(this.moduleId, 'cargar', 'Carga completada');
    } catch (err) {
      App.error(this.moduleId, 'cargar', err);
      // Evitar crash si no existe Events
      if(App.Events) App.Events.emit('module:load-error', { moduleId: this.moduleId, error: err });
      if (App.Toast) App.Toast.error(err.message || 'Error al cargar el módulo.');
    }
  }

  mostrar() {
    const vista = document.getElementById(this.vistaId);
    if (vista) vista.classList.add('active');
  }

  ocultar() {
    const vista = document.getElementById(this.vistaId);
    if (vista) vista.classList.remove('active');
  }

  destruir() {
    App.log(this.moduleId, 'destruir', 'Invalidando estado');
    App.Store.invalidateModulo(this.moduleId);
  }

  async _handleCreate(formData, modal) {
    if (!this._createEndpoint) return;
    try {
      modal?.setLoading(true);
      await App.API.call(this._createEndpoint, formData);
      modal?.close();
      if (App.Toast) App.Toast.success('Registro creado exitosamente.');
      App.API.invalidateAll();
      if (App.Events) App.Events.emit('data:changed');
      this.destruir();
      await this.cargar();
    } catch (err) {
      if (App.Toast) App.Toast.error(err.message || 'Error al crear el registro.');
    } finally {
      modal?.setLoading(false);
    }
  }

  async _handleUpdate(id, formData, modal, scope = 'SINGLE') {
    if (!this._updateEndpoint) return;
    try {
      modal?.setLoading(true);
      await App.API.call(this._updateEndpoint, id, formData, scope);
      modal?.close();
      if (App.Toast) App.Toast.success('Registro actualizado.');
      App.API.invalidateAll();
      if (App.Events) App.Events.emit('data:changed');
      this.destruir();
      await this.cargar();
    } catch (err) {
      if (App.Toast) App.Toast.error(err.message || 'Error al actualizar el registro.');
    } finally {
      modal?.setLoading(false);
    }
  }

  async _handleDelete(id, scope = 'SINGLE') {
    if (!this._deleteEndpoint) return;
    try {
      await App.API.call(this._deleteEndpoint, id, scope);
      if (App.Toast) App.Toast.success('Registro eliminado.');
      App.API.invalidateAll();
      if (App.Events) App.Events.emit('data:changed');
      this.destruir();
      await this.cargar();
    } catch (err) {
      if (App.Toast) App.Toast.error(err.message || 'Error al eliminar el registro.');
    }
  }

  async _fetchData() { throw new Error(`[${this.moduleId}] _fetchData no implementado`); }
  _render(data) { throw new Error(`[${this.moduleId}] _render no implementado`); }
  _bindListeners() {}
  _unbindListeners() {}

  _subscribeEvents() {
    const recargar = () => { this.destruir(); this.cargar(); };
    if(App.Events) {
      App.Events.on('store:cuenta-changed', recargar);
      App.Events.on('store:mes-changed',    recargar);
      App.Events.on('data:changed',         recargar);
    }
  }

  _showSkeleton(filas = 5, columnas = 6) {
    const tbody = document.querySelector(`#${this.vistaId} tbody`);
    if (!tbody) return;
    const skeletonRow = `
      <tr class="skeleton-row">
        ${'<td><div class="skeleton-line"></div></td>'.repeat(columnas)}
      </tr>`;
    tbody.innerHTML = skeletonRow.repeat(filas);
  }
}

// Attach BaseModule globally to preserve compatibility
window.BaseModule = BaseModule;

App.log('app-bootstrap', 'init', `Namespace App v${APP_VERSION} registrado`);
