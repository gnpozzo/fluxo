'use strict';
/* ============================================================
   component-form-validator.html — v5.0.0
   Validador de formularios reutilizable.
   Valida en tiempo real y al submit, sin dependencias externas.
   Se registra en window.App.FormValidator (clase)
   ============================================================ */

// --- SECCIÓN 0: CLASE FormValidator ---

export class FormValidator {

  #form;
  #rules    = {};
  #errors   = {};
  #touched  = new Set();

  /**
   * @param {HTMLFormElement|string} form  Elemento form o selector
   * @param {Object} rules                 { fieldName: [ ...reglas ] }
   */
  constructor(form, rules = {}) {
    this.#form  = typeof form === 'string' ? document.querySelector(form) : form;
    this.#rules = rules;
    this.#bindRealtime();
    App.log('FormValidator', 'constructor', `Validador iniciado en #${this.#form?.id}`);
  }

  // --- SECCIÓN 1: REGLAS BUILT-IN ---

  static rules = {
    required: (msg = 'Este campo es obligatorio') => ({
      validate: (v) => v !== null && v !== undefined && String(v).trim() !== '',
      message : msg
    }),
    minLength: (n, msg) => ({
      validate: (v) => !v || String(v).length >= n,
      message : msg || `Mínimo ${n} caracteres`
    }),
    maxLength: (n, msg) => ({
      validate: (v) => !v || String(v).length <= n,
      message : msg || `Máximo ${n} caracteres`
    }),
    number: (msg = 'Debe ser un número válido') => ({
      validate: (v) => !v || App.Utils.isNumero(v),
      message : msg
    }),
    positive: (msg = 'Debe ser mayor a 0') => ({
      validate: (v) => !v || Number(v) > 0,
      message : msg
    }),
    min: (n, msg) => ({
      validate: (v) => !v || Number(v) >= n,
      message : msg || `Mínimo ${n}`
    }),
    max: (n, msg) => ({
      validate: (v) => !v || Number(v) <= n,
      message : msg || `Máximo ${n}`
    }),
    email: (msg = 'Email inválido') => ({
      validate: (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      message : msg
    }),
    date: (msg = 'Fecha inválida') => ({
      validate: (v) => !v || !isNaN(new Date(v).getTime()),
      message : msg
    }),
    custom: (fn, msg = 'Valor inválido') => ({
      validate: fn,
      message : msg
    })
  };

  // --- SECCIÓN 2: API PÚBLICA ---

  /**
   * Valida todo el formulario.
   * @returns {boolean} true si es válido
   */
  validate() {
    this.#errors = {};
    const data   = this.getData();

    for (const [field, fieldRules] of Object.entries(this.#rules)) {
      const value = data[field];
      for (const rule of fieldRules) {
        if (!rule.validate(value)) {
          this.#errors[field] = rule.message;
          break;
        }
      }
    }

    this.#renderErrors();
    const valid = Object.keys(this.#errors).length === 0;
    App.log('FormValidator', 'validate', `${valid ? 'OK' : 'FALLÓ'} — errores: ${JSON.stringify(this.#errors)}`);
    return valid;
  }

  /**
   * Obtiene los datos del formulario como objeto plano.
   * @returns {Object}
   */
  getData() {
    const data = {};
    new FormData(this.#form).forEach((v, k) => { data[k] = v.trim ? v.trim() : v; });

    // Incluir checkboxes no marcados (FormData los omite)
    this.#form.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (!(cb.name in data)) data[cb.name] = false;
      else data[cb.name] = cb.checked;
    });

    return data;
  }

  /**
   * Limpia todos los errores visuales.
   */
  clearErrors() {
    this.#errors = {};
    this.#touched.clear();
    this.#form.querySelectorAll('.input-error').forEach(el => {
      el.classList.remove('input-error');
    });
    this.#form.querySelectorAll('.field-error-msg').forEach(el => el.remove());
  }

  /**
   * Resetea el formulario y limpia errores.
   */
  reset() {
    this.#form.reset();
    this.clearErrors();
  }

  /**
   * Rellena el formulario con un objeto de datos.
   * @param {Object} data
   */
  populate(data) {
    for (const [key, val] of Object.entries(data)) {
      const el = this.#form.elements[key];
      if (!el) continue;
      if (el.type === 'checkbox') { el.checked = Boolean(val); }
      else { el.value = val ?? ''; }
    }
  }

  /** @returns {Object}  errores actuales */
  get errors() { return { ...this.#errors }; }

  // --- SECCIÓN 3: PRIVADOS ---

  #bindRealtime() {
    this.#form.querySelectorAll('input, select, textarea').forEach(field => {
      field.addEventListener('blur', () => {
        this.#touched.add(field.name);
        this.#validateField(field.name);
      });
      field.addEventListener('input', () => {
        if (this.#touched.has(field.name)) {
          this.#validateField(field.name);
        }
      });
    });
  }

  #validateField(fieldName) {
    const fieldRules = this.#rules[fieldName];
    if (!fieldRules) return;

    const data  = this.getData();
    const value = data[fieldName];
    delete this.#errors[fieldName];

    for (const rule of fieldRules) {
      if (!rule.validate(value)) {
        this.#errors[fieldName] = rule.message;
        break;
      }
    }

    this.#renderFieldError(fieldName);
  }

  #renderErrors() {
    // Limpiar errores anteriores
    this.#form.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    this.#form.querySelectorAll('.field-error-msg').forEach(el => el.remove());

    for (const [field, msg] of Object.entries(this.#errors)) {
      this.#renderFieldError(field, msg);
    }
  }

  #renderFieldError(fieldName, msg = this.#errors[fieldName]) {
    const el = this.#form.elements[fieldName];
    if (!el) return;

    // Limpiar estado anterior del campo
    el.classList.remove('input-error');
    el.parentElement?.querySelector('.field-error-msg')?.remove();

    if (!msg) return;

    el.classList.add('input-error');
    const errEl       = document.createElement('span');
    errEl.className   = 'field-error-msg';
    errEl.textContent = msg;
    errEl.setAttribute('role', 'alert');
    el.insertAdjacentElement('afterend', errEl);
  }
}

// Exportar clase al namespace
App.FormValidator = FormValidator;
App.log('component-form-validator', 'init', 'App.FormValidator (clase) registrada');