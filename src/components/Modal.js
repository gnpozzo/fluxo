'use strict';
/* ============================================================
   component-modal.html — v5.0.0
   Modal genérico reutilizable. Cada módulo instancia el suyo.
   Soporta: header, body, footer, tamaños, confirmación peligrosa.
   Se registra en window.App.Modal (clase exportada)
   ============================================================ */

// --- SECCIÓN 0: CLASE Modal ---

export class Modal {

  #id;
  #el       = null;
  #overlay  = null;
  #onConfirm = null;
  #onCancel  = null;

  /**
   * @param {string} id  ID único del modal (ej: 'modal-movimientos')
   */
  constructor(id) {
    this.#id = id;
    this.#build();
    App.log('Modal', 'constructor', `Modal "${id}" creado`);
  }

  // --- SECCIÓN 1: API PÚBLICA ---

  /**
   * Abre el modal con configuración opcional.
   * @param {Object} opts
   * @param {string}   opts.titulo
   * @param {string}   opts.body          HTML del cuerpo
   * @param {string}   [opts.confirmLabel='Guardar']
   * @param {string}   [opts.cancelLabel='Cancelar']
   * @param {boolean}  [opts.danger=false]  botón confirmar en rojo
   * @param {string}   [opts.size='md']    'sm'|'md'|'lg'|'xl'
   * @param {Function} [opts.onConfirm]
   * @param {Function} [opts.onCancel]
   */
  open({
    titulo       = '',
    icono        = null,
    body         = '',
    confirmLabel = 'Guardar',
    cancelLabel  = 'Cancelar',
    danger       = false,
    size         = 'md',
    onConfirm    = null,
    onCancel     = null
  } = {}) {
    this.#onConfirm = onConfirm;
    this.#onCancel  = onCancel;

    let titleHtml = titulo;
    if (icono && App.Icons.has(icono)) {
      titleHtml = `<span style="margin-right:8px; display:inline-flex; align-items:center; color:var(--primary);">${App.Icons.get(icono)}</span>` + titulo;
    }
    
    this.#el.querySelector('.modal-title').innerHTML      = titleHtml;
    this.#el.querySelector('.modal-body').innerHTML       = body;
    this.#el.querySelector('.modal-confirm').textContent  = confirmLabel;
    this.#el.querySelector('.modal-cancel').textContent   = cancelLabel;

    // Tamaño
    const dialog = this.#overlay.querySelector('.modal-dialog');
    dialog.className = `modal-dialog modal-${size}`;

    // Peligro
    const btnConfirm = this.#el.querySelector('.modal-confirm');
    if (btnConfirm) {
      btnConfirm.classList.toggle('btn-danger', danger);
      btnConfirm.classList.toggle('btn-primary', !danger);
    }

    // Mostrar
    this.#overlay.classList.add('modal-open');
    document.body.classList.add('modal-active');

    // Focus trap: primer input o botón confirmar
    setTimeout(() => {
      const firstInput = this.#el.querySelector('input, select, textarea');
      const targetFocus = firstInput || btnConfirm;
      if (targetFocus) targetFocus.focus();
    }, 50);

    App.log('Modal', 'open', `"${this.#id}" abierto`);
    return this;
  }

  /**
   * Cierra el modal sin ejecutar onConfirm.
   */
  close() {
    this.#overlay.classList.remove('modal-open');
    document.body.classList.remove('modal-active');
    this.#onConfirm = null;
    this.#onCancel  = null;
    App.log('Modal', 'close', `"${this.#id}" cerrado`);
    return this;
  }

  /**
   * Activa/desactiva el spinner de carga en el botón confirmar.
   * @param {boolean} loading
   */
  setLoading(loading) {
    const btn = this.#el.querySelector('.modal-confirm');
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading
      ? `<span class="spinner spinner-sm"></span> Procesando...`
      : btn.dataset.originalLabel || btn.textContent;
    if (!loading) btn.dataset.originalLabel = '';
    else btn.dataset.originalLabel = btn.textContent;
  }

  /**
   * Obtiene el formulario dentro del modal (si existe).
   * @returns {HTMLFormElement|null}
   */
  getForm() {
    return this.#el.querySelector('form');
  }

  /**
   * Retorna el elemento DOM del modal.
   * @returns {HTMLElement}
   */
  get el() { return this.#el; }

  // --- SECCIÓN 2: PRIVADOS ---

  /** Construye el HTML del modal e inserta en body */
  #build() {
    if (document.getElementById(this.#id)) {
      this.#overlay = document.getElementById(this.#id);
      this.#el      = this.#overlay.querySelector('.modal-content');
      return;
    }

    this.#overlay = document.createElement('div');
    this.#overlay.id        = this.#id;
    this.#overlay.className = 'modal-overlay';
    this.#overlay.setAttribute('role', 'dialog');
    this.#overlay.setAttribute('aria-modal', 'true');
    this.#overlay.setAttribute('aria-labelledby', `${this.#id}-title`);

    this.#overlay.innerHTML = `
      <div class="modal-dialog modal-md">
        <div class="modal-content">
          <header class="modal-header">
            <h2 class="modal-title" id="${this.#id}-title"></h2>
            <button class="modal-x btn-icon" aria-label="Cerrar">
              ${App.Icons.get('close', 'icon-md')}
            </button>
          </header>
          <div class="modal-body"></div>
          <footer class="modal-footer">
            <button class="modal-cancel  btn btn-ghost">Cancelar</button>
            <button class="modal-confirm btn btn-primary">Guardar</button>
          </footer>
        </div>
      </div>
    `;

    document.body.appendChild(this.#overlay);
    this.#el = this.#overlay.querySelector('.modal-content');

    // Listeners
    this.#overlay.querySelector('.modal-x').addEventListener('click',     () => this.#handleCancel());
    this.#overlay.querySelector('.modal-cancel').addEventListener('click', () => this.#handleCancel());
    this.#overlay.querySelector('.modal-confirm').addEventListener('click',() => this.#handleConfirm());

    // Click fuera cierra
    this.#overlay.addEventListener('click', (e) => {
      if (e.target === this.#overlay) this.#handleCancel();
    });

    // ESC cierra
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.#overlay.classList.contains('modal-open')) {
        this.#handleCancel();
      }
    });
  }

  #handleConfirm() {
    if (typeof this.#onConfirm === 'function') this.#onConfirm(this);
    else this.close();
  }

  #handleCancel() {
    if (typeof this.#onCancel === 'function') this.#onCancel(this);
    this.close();
  }
}

// Exportar clase al namespace para que los módulos la instancien
App.Modal = Modal;
App.log('component-modal', 'init', 'App.Modal (clase) registrada');