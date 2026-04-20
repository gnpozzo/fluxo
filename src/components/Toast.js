'use strict';
/* ============================================================
   component-toast.html — v5.0.0
   Sistema de notificaciones Toast (éxito, error, warning, info).
   Animado, auto-dismiss, stackable, accesible.
   Se registra en window.App.Toast
   ============================================================ */

// --- SECCIÓN 0: CLASE ToastManager ---

export class ToastManager {

  #container = null;
  #defaultDuration = 4000;  // ms

  constructor() {
    this.#mount();
    App.log('ToastManager', 'constructor', 'Toast manager listo');
  }

  // --- SECCIÓN 1: API PÚBLICA ---

  /**
   * Muestra un toast de éxito.
   * @param {string} mensaje
   * @param {number} [duration]
   */
  success(mensaje, duration = this.#defaultDuration) {
    this.#show('success', mensaje, duration);
  }

  /**
   * Muestra un toast de error.
   * @param {string} mensaje
   * @param {number} [duration]
   */
  error(mensaje, duration = this.#defaultDuration + 2000) {
    this.#show('error', mensaje, duration);
  }

  /**
   * Muestra un toast de advertencia.
   * @param {string} mensaje
   * @param {number} [duration]
   */
  warning(mensaje, duration = this.#defaultDuration) {
    this.#show('warning', mensaje, duration);
  }

  /**
   * Muestra un toast informativo.
   * @param {string} mensaje
   * @param {number} [duration]
   */
  info(mensaje, duration = this.#defaultDuration) {
    this.#show('info', mensaje, duration);
  }

  // --- SECCIÓN 2: PRIVADOS ---

  /** Crea e inyecta el contenedor de toasts en el DOM */
  #mount() {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.setAttribute('role', 'region');
      container.setAttribute('aria-label', 'Notificaciones');
      container.setAttribute('aria-live', 'polite');
      document.body.appendChild(container);
    }
    this.#container = container;
  }

  /**
   * Crea y muestra un toast.
   * @param {'success'|'error'|'warning'|'info'} tipo
   * @param {string} mensaje
   * @param {number} duration
   */
  #show(tipo, mensaje, duration) {
    const iconMap = {
      success : 'success',
      error   : 'error',
      warning : 'warning',
      info    : 'info'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;
    toast.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    toast.innerHTML = `
      <span class="toast-icon">${App.Icons.get(iconMap[tipo], 'icon-sm')}</span>
      <span class="toast-msg">${App.Utils.escapeHtml(mensaje)}</span>
      <button class="toast-close" aria-label="Cerrar notificación">
        ${App.Icons.get('close', 'icon-sm')}
      </button>
    `;

    // Cerrar al click
    toast.querySelector('.toast-close').addEventListener('click', () => {
      this.#dismiss(toast);
    });

    this.#container.appendChild(toast);

    // Forzar reflow para activar la animación de entrada
    toast.getBoundingClientRect();
    toast.classList.add('toast-visible');

    // Auto-dismiss
    const timer = setTimeout(() => this.#dismiss(toast), duration);

    // Pausar al hover
    toast.addEventListener('mouseenter', () => clearTimeout(timer));
    toast.addEventListener('mouseleave', () => {
      setTimeout(() => this.#dismiss(toast), 1500);
    });

    App.log('ToastManager', '#show', `[${tipo}] ${mensaje}`);
  }

  /**
   * Anima la salida y remueve el toast del DOM.
   * @param {HTMLElement} toast
   */
  #dismiss(toast) {
    if (!toast || toast.classList.contains('toast-leaving')) return;
    toast.classList.add('toast-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    // Fallback por si animationend no se dispara
    setTimeout(() => toast.remove(), 400);
  }
}

// --- REGISTRO EN NAMESPACE ---
App.Toast = new ToastManager();
App.log('component-toast', 'init', 'App.Toast registrado');