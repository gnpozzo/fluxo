'use strict';
/* ============================================================
   component-kpi-card.html — v5.0.0
   Tarjeta KPI reutilizable para dashboards y cabeceras de módulo.
   Soporta: valor, variación, ícono, skeleton, click.
   Se registra en window.App.KpiCard (clase)
   ============================================================ */

// --- SECCIÓN 0: CLASE KpiCard ---

export class KpiCard {

  #container;
  #config;
  #el = null;

  /**
   * @param {string|HTMLElement} container  Selector o elemento contenedor
   * @param {Object} config
   * @param {string}   config.titulo           Título de la KPI
   * @param {string}   [config.icono]          Clave del IconRegistry
   * @param {string}   [config.colorClass]     Clase CSS de color ('kpi-green' | 'kpi-red' | 'kpi-blue' | 'kpi-purple')
   * @param {Function} [config.onFormat]       Función de formateo del valor
   * @param {Function} [config.onClick]        Callback al hacer click en la card
   */
  constructor(container, config = {}) {
    this.#container = typeof container === 'string'
      ? document.querySelector(container)
      : container;
    this.#config = {
      titulo     : '',
      icono      : 'wallet',
      colorClass : 'kpi-blue',
      onFormat   : (v) => App.Utils.formatearMoneda(v),
      onClick    : null,
      ...config
    };
    this.#build();
  }

  // --- SECCIÓN 1: API PÚBLICA ---

  /**
   * Actualiza el valor mostrado en la card.
   * @param {number|string} valor
   * @param {Object} [opts]
   * @param {number} [opts.variacion]      Porcentaje de variación (±)
   * @param {string} [opts.subtitulo]      Texto secundario
   * @param {boolean}[opts.invertirColor]  Negativo=bueno (ej: deuda)
   */
  setValue(valor, { variacion = null, subtitulo = '', invertirColor = false } = {}) {
    const formatted = this.#config.onFormat(valor);
    const valEl     = this.#el.querySelector('.kpi-value');
    const varEl     = this.#el.querySelector('.kpi-variation');
    const subEl     = this.#el.querySelector('.kpi-subtitle');

    valEl.textContent = formatted;
    valEl.classList.remove('skeleton', 'skeleton-text');

    if (variacion !== null) {
      const cls = App.Utils.classeVariacion(variacion, invertirColor);
      varEl.className  = `kpi-variation kpi-var-${cls}`;
      varEl.textContent = App.Utils.formatearPorcentaje(variacion);
      varEl.style.display = '';
    } else {
      varEl.style.display = 'none';
    }

    if (subtitulo) {
      subEl.textContent    = subtitulo;
      subEl.style.display  = '';
    } else {
      subEl.style.display  = 'none';
    }

    App.log('KpiCard', 'setValue', `"${this.#config.titulo}" → ${formatted}`);
  }

  /**
   * Muestra skeleton de carga.
   */
  showSkeleton() {
    const valEl = this.#el.querySelector('.kpi-value');
    valEl.innerHTML = `<div class="skeleton skeleton-text" style="width:80px;height:1.5rem"></div>`;
  }

  /**
   * Muestra un estado de error.
   * @param {string} [msg='Error']
   */
  showError(msg = 'Error') {
    const valEl = this.#el.querySelector('.kpi-value');
    valEl.innerHTML = `<span class="kpi-error">${App.Utils.escapeHtml(msg)}</span>`;
  }

  // --- SECCIÓN 2: PRIVADOS ---

  #build() {
    const { titulo, icono, colorClass, onClick } = this.#config;

    const card = document.createElement('div');
    card.className = `kpi-card ${colorClass}`;
    if (typeof onClick === 'function') {
      card.classList.add('kpi-clickable');
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.addEventListener('click', () => onClick(this));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick(this);
      });
    }

    card.innerHTML = `
      <div class="kpi-icon-wrap">
        ${App.Icons.get(icono, 'icon-lg')}
      </div>
      <div class="kpi-content">
        <span class="kpi-label">${App.Utils.escapeHtml(titulo)}</span>
        <span class="kpi-value skeleton skeleton-text" style="width:80px;height:1.5rem"></span>
        <span class="kpi-subtitle" style="display:none"></span>
        <span class="kpi-variation" style="display:none"></span>
      </div>
    `;

    this.#container.appendChild(card);
    this.#el = card;
  }
}

// Exportar clase al namespace

App.log('component-kpi-card', 'init', 'App.KpiCard (clase) registrada');