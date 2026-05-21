'use strict';
/* ============================================================
   module-admin.html — v5.1.0
   Panel de Configuración (modal fullscreen con sidebar interno).
   Secciones: Cuentas, Tarjetas, Categorías, Subcuentas Ahorro,
              Usuarios CC.
   ============================================================ */

// --- SECCIÓN 0: CLASE AdminModule ---

export class AdminModule extends BaseModule {

  get moduleId() { return 'admin'; }
  get vistaId()  { return 'vista-admin'; }

  #modal         = null;
  #seccionActiva = 'cuentas';

  #secciones = [
    { id: 'cuentas',    label: 'Cuentas',          icono: 'movimientos', fn: () => this.#renderCuentas()    },
    { id: 'tarjetas',   label: 'Tarjetas',         icono: 'card',        fn: () => this.#renderTarjetas()   },
    { id: 'categorias', label: 'Categorías',       icono: 'filter',      fn: () => this.#renderCategorias() },
    { id: 'ahorro',     label: 'Alcancías',icono: 'ahorro_coin', fn: () => this.#renderAhorroSubs() },
    { id: 'cc',         label: 'Contactos (Gastos Compartidos)', icono: 'wallet', fn: () => this.#renderUsuariosCC() }
  ];

  // --- SECCIÓN 1: CICLO DE VIDA ---

  init() {
    this.#modal = new App.Modal('modal-admin-main');
    this._bindListeners();
    App.log('AdminModule', 'init', 'Módulo admin iniciado');
  }

  /** Admin no tiene vista propia — se abre como modal de pantalla completa */
  async cargar() {
    this.#abrirPanel();
  }

  _buildVista() {}
  _subscribeEvents() {}

  // --- SECCIÓN 2: PANEL ADMIN ---

  #abrirPanel() {
    this.#modal.open({
      titulo      : 'Configuración',
      body        : this.#buildPanelHtml(),
      size        : 'xl',
      confirmLabel: '',
      cancelLabel : 'Cerrar',
      onCancel    : () => this.#modal.close()
    });

    // Ocultar el footer completo ya que la X de la barra de título es suficiente
    const footer = this.#modal.el.querySelector('.modal-footer');
    if (footer) footer.style.display = 'none';

    this.#activarSeccion(this.#seccionActiva);
  }

  #buildPanelHtml() {
    const navItems = this.#secciones
      .map(s => `
        <button class="admin-nav-btn ${s.id === this.#seccionActiva ? 'active' : ''}"
                data-seccion="${s.id}">
          ${App.Icons.get(s.icono, 'icon-sm')}
          ${App.Utils.escapeHtml(s.label)}
        </button>
      `).join('');

    return `
      <div class="admin-layout-container" style="min-height:480px">
        <aside class="admin-sidebar">
          <div style="padding:8px 12px 6px;font-size:.65rem;font-weight:700;
                      color:var(--texto-3);text-transform:uppercase;letter-spacing:.08em">
            Configuración
          </div>
          ${navItems}
        </aside>
        <main class="admin-content-area" id="admin-content"></main>
      </div>
    `;
  }

  #activarSeccion(id) {
    this.#seccionActiva = id;

    // Actualizar nav activo
    this.#modal.el.querySelectorAll('.admin-nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.seccion === id);
      // Vincular nav buttons
      btn.onclick = () => this.#activarSeccion(btn.dataset.seccion);
    });

    const content = document.getElementById('admin-content');
    if (!content) return;
    content.innerHTML = `
      <div class="skeleton skeleton-text" style="width:180px;margin-bottom:16px;height:1.2rem"></div>
      <div class="skeleton skeleton-text" style="margin-bottom:8px"></div>
      <div class="skeleton skeleton-text" style="width:80%;margin-bottom:8px"></div>
      <div class="skeleton skeleton-text" style="width:60%"></div>`;

    const seccion = this.#secciones.find(s => s.id === id);
    seccion?.fn();
  }

  // --- SECCIÓN 3: SECCIONES ---

  async #renderCuentas() {
    const content = document.getElementById('admin-content');
    try {
      const response = await App.API.cached('api_admin_getCuentasPrincipales', [], 2 * 60_000);
      const cuentas = response?.data || [];
      content.innerHTML = `
        <div class="section-header">
          <h2 style="margin:0">Cuentas Principales</h2>
          <button id="adm-btn-nueva-cuenta" class="btn btn-primary">
            ${App.Icons.get('add', 'icon-sm')} Nueva cuenta
          </button>
        </div>
        <div class="table-card">
          <table class="table">
            <thead><tr>
              <th>Nombre</th><th>Moneda</th><th>Estado</th><th></th>
            </tr></thead>
            <tbody>
              ${cuentas.map(c => `
                <tr>
                  <td>${App.Utils.escapeHtml(c.nombre)}</td>
                  <td>${App.Utils.escapeHtml(c.moneda_principal || c.moneda || 'ARS')}</td>
                  <td>${c.activa
                    ? '<span class="badge tipo-ingreso">Activa</span>'
                    : '<span class="badge badge-neutro">Inactiva</span>'}</td>
                  <td class="text-right">
                    <button class="btn-accion" onclick="App.Modules.admin._editCuenta('${c.id_cuenta_principal}')" title="Editar">
                      ${App.Icons.get('edit', 'icon-sm')}
                    </button>
                    <button class="btn-accion btn-danger" onclick="App.Modules.admin._deleteCuenta('${c.id_cuenta_principal}')" title="Eliminar">
                      ${App.Icons.get('delete', 'icon-sm')}
                    </button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;
      document.getElementById('adm-btn-nueva-cuenta')
        ?.addEventListener('click', () => this._editCuenta(null));
    } catch (err) {
      content.innerHTML = `<p class="negativo">Error: ${App.Utils.escapeHtml(err.message)}</p>`;
    }
  }

  async #renderTarjetas() {
    const content = document.getElementById('admin-content');
    try {
      const response = await App.API.cached('api_admin_getTarjetas', [], 2 * 60_000);
      const tarjetas = response?.data || [];
      content.innerHTML = `
        <div class="section-header">
          <h2 style="margin:0">Tarjetas de Crédito</h2>
          <button id="adm-btn-nueva-tc" class="btn btn-primary">
            ${App.Icons.get('add', 'icon-sm')} Nueva tarjeta
          </button>
        </div>
        <div class="table-card">
          <table class="table">
            <thead><tr><th>Nombre</th><th>Banco</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              ${tarjetas.map(t => `
                <tr>
                  <td>${App.Utils.escapeHtml(t.nombre)}</td>
                  <td>${App.Utils.escapeHtml(t.banco || '—')}</td>
                  <td>${t.activa
                    ? '<span class="badge tipo-ingreso">Activa</span>'
                    : '<span class="badge badge-neutro">Inactiva</span>'}</td>
                  <td class="text-right">
                    <button class="btn-accion" onclick="App.Modules.admin._editTarjeta('${t.id_tarjeta}')" title="Editar">
                      ${App.Icons.get('edit', 'icon-sm')}
                    </button>
                    <button class="btn-accion btn-danger" onclick="App.Modules.admin._deleteTarjeta('${t.id_tarjeta}')" title="Eliminar">
                      ${App.Icons.get('delete', 'icon-sm')}
                    </button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;
      document.getElementById('adm-btn-nueva-tc')
        ?.addEventListener('click', () => this._editTarjeta(null));
    } catch (err) {
      content.innerHTML = `<p class="negativo">Error: ${App.Utils.escapeHtml(err.message)}</p>`;
    }
  }

  async #renderCategorias() {
    const content = document.getElementById('admin-content');
    try {
      const response = await App.API.cached('api_admin_getCategorias', [], 2 * 60_000);
      const cats = response?.data || [];
      content.innerHTML = `
        <div class="section-header">
          <h2 style="margin:0">Categorías</h2>
          <button id="adm-btn-nueva-cat" class="btn btn-primary">
            ${App.Icons.get('add', 'icon-sm')} Nueva
          </button>
        </div>
        <div class="table-card">
          <table class="table">
            <thead><tr><th>Nombre</th><th>Tipo</th><th>Activa</th><th></th></tr></thead>
            <tbody>
              ${cats.map(c => `
                <tr>
                  <td>${App.Utils.escapeHtml(c.nombre)}</td>
                  <td><span class="tipo-mov tipo-${c.tipo_mov?.toLowerCase()}">${App.Utils.escapeHtml(c.tipo_mov)}</span></td>
                  <td>${c.activa ? '✓' : '—'}</td>
                  <td class="text-right">
                    <button class="btn-accion" onclick="App.Modules.admin._editCategoria('${c.id_categoria}')" title="Editar">
                      ${App.Icons.get('edit', 'icon-sm')}
                    </button>
                    <button class="btn-accion btn-danger" onclick="App.Modules.admin._deleteCategoria('${c.id_categoria}')" title="Eliminar">
                      ${App.Icons.get('delete', 'icon-sm')}
                    </button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;
      document.getElementById('adm-btn-nueva-cat')
        ?.addEventListener('click', () => this._editCategoria(null));
    } catch (err) {
      content.innerHTML = `<p class="negativo">Error: ${App.Utils.escapeHtml(err.message)}</p>`;
    }
  }

  async #renderAhorroSubs() {
    const content = document.getElementById('admin-content');
    try {
      const response = await App.API.cached('api_admin_getAhorroSubcuentas', [], 2 * 60_000);
      const subs = response?.data || [];
      const rCuentas = await App.API.cached('api_admin_getCuentasPrincipales', [], 2 * 60_000);
      const cuentas = rCuentas?.data || [];
      content.innerHTML = `
        <div class="section-header">
          <h2 style="margin:0">Alcancías</h2>
          <button id="adm-btn-nueva-sub" class="btn btn-primary">
            ${App.Icons.get('add', 'icon-sm')} Nueva
          </button>
        </div>
        <div class="table-card">
          <table class="table">
            <thead><tr><th>Nombre</th><th>Cuenta Asociada</th><th>Moneda</th><th></th></tr></thead>
            <tbody>
              ${subs.map(s => {
                const cObj = cuentas.find(c => c.id_cuenta_principal === s.id_cuenta_principal);
                const cuentaNombre = cObj ? cObj.nombre : '—';
                return `
                <tr>
                  <td>${App.Utils.escapeHtml(s.nombre)}</td>
                  <td>${App.Utils.escapeHtml(cuentaNombre)}</td>
                  <td>${App.Utils.escapeHtml(s.moneda || 'ARS')}</td>
                  <td class="text-right">
                    <button class="btn-accion" onclick="App.Modules.admin._editSubcuenta('${s.id_subcuenta}')" title="Editar">
                      ${App.Icons.get('edit', 'icon-sm')}
                    </button>
                    <button class="btn-accion btn-danger" onclick="App.Modules.admin._deleteSubcuenta('${s.id_subcuenta}')" title="Eliminar">
                      ${App.Icons.get('delete', 'icon-sm')}
                    </button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
      document.getElementById('adm-btn-nueva-sub')
        ?.addEventListener('click', () => this._editSubcuenta(null));
    } catch (err) {
      content.innerHTML = `<p class="negativo">Error: ${App.Utils.escapeHtml(err.message)}</p>`;
    }
  }

  async #renderUsuariosCC() {
    const content = document.getElementById('admin-content');
    try {
      const response = await App.API.cached('api_admin_getCtaCorrienteUsuarios', [], 2 * 60_000);
      const users = response?.data || [];
      content.innerHTML = `
        <div class="section-header">
          <h2 style="margin:0">Contactos (Gastos Compartidos)</h2>
          <button id="adm-btn-nuevo-usr" class="btn btn-primary">
            ${App.Icons.get('add', 'icon-sm')} Nuevo
          </button>
        </div>
        <div class="table-card">
          <table class="table">
            <thead><tr><th>Nombre</th><th></th></tr></thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td>${App.Utils.escapeHtml(u.nombre)}</td>
                  <td class="text-right">
                    <button class="btn-accion" onclick="App.Modules.admin._editUsuarioCC('${u.id_usuario}')" title="Editar">
                      ${App.Icons.get('edit', 'icon-sm')}
                    </button>
                    <button class="btn-accion btn-danger" onclick="App.Modules.admin._deleteUsuarioCC('${u.id_usuario}')" title="Eliminar">
                      ${App.Icons.get('delete', 'icon-sm')}
                    </button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;
      document.getElementById('adm-btn-nuevo-usr')
        ?.addEventListener('click', () => this._editUsuarioCC(null));
    } catch (err) {
      content.innerHTML = `<p class="negativo">Error: ${App.Utils.escapeHtml(err.message)}</p>`;
    }
  }

  // --- SECCIÓN 4: EDICIÓN (modal secundario) ---

  async _editCuenta(id) {
    const m = new App.Modal('modal-adm-cuenta');
    let data = null;
    if (id) {
      const response = await App.API.cached('api_admin_getCuentasPrincipales', [], 0);
      data = (response?.data || []).find(c => c.id_cuenta_principal === id);
    }
    m.open({
      titulo      : id ? 'Editar Cuenta' : 'Nueva Cuenta',
      body        : `
        <form id="form-adm-cuenta" class="form-grid">
          <input type="hidden" name="id_cuenta_principal" value="${data?.id_cuenta_principal || ''}">
          <div class="form-group full-width">
            <label>Nombre <span class="required-mark">*</span></label>
            <input class="input" name="nombre" value="${App.Utils.escapeHtml(data?.nombre || '')}" required>
          </div>
          <div class="form-group">
            <label>Moneda <span class="required-mark">*</span></label>
            <select class="input" name="moneda_principal">
              <option value="ARS" ${data?.moneda_principal === 'ARS' ? 'selected':''}>ARS</option>
              <option value="USD" ${data?.moneda_principal === 'USD' ? 'selected':''}>USD</option>
            </select>
          </div>
          <div class="form-group">
            <label>Ícono</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${[
                {v:'home', svg:'<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'},
                {v:'briefcase', svg:'<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>'},
                {v:'wallet', svg:'<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>'},
                {v:'piggy', svg:'<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/>'},
                {v:'building', svg:'<rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><line x1="8" y1="6" x2="8" y2="6"/><line x1="12" y1="6" x2="12" y2="6"/><line x1="16" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8" y2="10"/><line x1="12" y1="10" x2="12" y2="10"/><line x1="16" y1="10" x2="16" y2="10"/>'},
                {v:'user', svg:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'},
                {v:'globe', svg:'<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/>'},
                {v:'star', svg:'<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'}
              ].map(ic => `
                <label style="cursor:pointer;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:10px;border:2px solid ${data?.icono === ic.v ? 'var(--primary)' : 'var(--borde)'};background:${data?.icono === ic.v ? 'var(--primary-tint)' : 'var(--fondo)'};transition:all .15s" title="${ic.v}">
                  <input type="radio" name="icono" value="${ic.v}" ${(data?.icono === ic.v || (!data?.icono && ic.v === 'home')) ? 'checked' : ''} style="display:none">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic.svg}</svg>
                </label>
              `).join('')}
            </div>
          </div>
          <div class="form-group">
            <label class="form-switch" style="margin-top:28px">
              <input type="checkbox" class="toggle-switch" name="activa" ${!data || data.activa ? 'checked':''}>
              <span style="font-size:.85rem;font-weight:500;color:var(--texto);text-transform:none;letter-spacing:0">Activa</span>
            </label>
          </div>
        </form>`,
      confirmLabel: id ? 'Actualizar' : 'Crear',
      onConfirm   : async (modal) => {
        const fd = new FormData(modal.getForm());
        const d  = {};
        fd.forEach((v, k) => { d[k] = v; });
        if (!d.nombre) { App.Toast.warning('El nombre es obligatorio.'); return; }
        d.activa = (d.activa === 'on');
        modal.setLoading(true);
        try {
          await App.API.call('api_admin_saveCuentaPrincipal', d);
          App.API.invalidatePattern('api_admin_getCuentasPrincipales');
          App.Toast.success('Cuenta guardada.');
          modal.close();
          this.#renderCuentas();
        } catch (err) { modal.setLoading(false); App.Toast.error(err.message); }
      }
    });
  }

  async _editTarjeta(id) {
    const m = new App.Modal('modal-adm-tc');
    let data = null;
    let cuentas = [];
    try {
      const pCuentas = await App.API.cached('api_admin_getCuentasPrincipales', [], 0);
      cuentas = pCuentas?.data || [];
    } catch(e) {}
    
    if (id) {
      const response = await App.API.cached('api_admin_getTarjetas', [], 0);
      data = (response?.data || []).find(t => t.id_tarjeta === id);
    }
    m.open({
      titulo      : id ? 'Editar Tarjeta' : 'Nueva Tarjeta',
      body        : `
        <form id="form-adm-tc" class="form-grid">
          <input type="hidden" name="id_tarjeta" value="${data?.id_tarjeta || ''}">
          
          <div class="form-group full-width">
            <label>Cuenta Asociada <span class="required-mark">*</span></label>
            <select class="input" name="id_cuenta_principal" required>
              <option value="" disabled ${!data ? 'selected' : ''}>Seleccione una cuenta</option>
              ${cuentas.map(c => `<option value="${c.id_cuenta_principal}" ${data?.id_cuenta_principal === c.id_cuenta_principal ? 'selected' : ''}>${App.Utils.escapeHtml(c.nombre)}</option>`).join('')}
            </select>
          </div>

          <div class="form-group full-width">
            <label>Nombre <span class="required-mark">*</span></label>
            <input class="input" name="nombre" value="${App.Utils.escapeHtml(data?.nombre || '')}" required>
          </div>
          
          <div class="form-group half-width">
            <label>Banco</label>
            <input class="input" name="banco" value="${App.Utils.escapeHtml(data?.banco || '')}">
          </div>

          <div class="form-group half-width">
            <label>Últimos 4 dígitos</label>
            <input class="input" type="number" name="ultimos_4_digitos" value="${App.Utils.escapeHtml(data?.ultimos_4_digitos || '')}">
          </div>

          <div class="form-group half-width">
            <label>Día Cierre <span class="required-mark">*</span></label>
            <input class="input" type="number" name="dia_cierre_resumen" min="1" max="31" value="${data?.dia_cierre_resumen || ''}" required>
          </div>

          <div class="form-group half-width">
            <label>Día Vencimiento <span class="required-mark">*</span></label>
            <input class="input" type="number" name="dia_vencimiento_resumen" min="1" max="31" value="${data?.dia_vencimiento_resumen || ''}" required>
          </div>

          <div class="form-group full-width">
            <label>Color de Tarjeta</label>
            <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
              ${['blue','red','orange','purple','green','dark','black','silver','gold'].map(col => `
                <label style="cursor:pointer;display:flex;align-items:center;gap:4px">
                  <input type="radio" name="color" value="${col}" ${data?.color === col || (!data && col === 'blue') ? 'checked' : ''}>
                  <div style="width:24px;height:16px;border-radius:4px;border:1px solid rgba(0,0,0,0.2);background:var(--card-${col}, ${
                    col === 'blue' ? 'linear-gradient(135deg, #1a1f71, #2d5bab)' :
                    col === 'red' ? 'linear-gradient(135deg, #1a1a2e, #c41e3a)' :
                    col === 'orange' ? 'linear-gradient(135deg, #d35400, #e67e22)' :
                    col === 'purple' ? 'linear-gradient(135deg, #4a235a, #8e44ad)' :
                    col === 'green' ? 'linear-gradient(135deg, #145a32, #27ae60)' :
                    col === 'dark' ? 'linear-gradient(135deg, #2c3e50, #4ca1af)' :
                    col === 'black' ? 'linear-gradient(135deg, #000000, #1a1a1a)' :
                    col === 'silver' ? 'linear-gradient(135deg, #bdc3c7, #e2e2e2)' :
                    'linear-gradient(135deg, #b8860b, #ffd700)'
                  })"></div>
                </label>
              `).join('')}
              <label style="cursor:pointer;display:flex;align-items:center;gap:4px;margin-left:8px;border-left:1px solid var(--borde);padding-left:12px">
                <input type="radio" name="color" value="custom" ${(data?.color && data.color.startsWith('#')) ? 'checked' : ''}>
                <span style="font-size:0.8rem;color:var(--texto-2)">Hex:</span>
                <input type="color" name="color_custom" value="${(data?.color && data.color.startsWith('#')) ? data.color : '#3b82f6'}" style="width:28px;height:24px;padding:0;border:none;border-radius:4px;cursor:pointer;background:transparent">
              </label>
            </div>
          </div>

          <div class="form-group">
            <label class="form-switch">
              <input type="checkbox" class="toggle-switch" name="activa" ${!data || data.activa ? 'checked':''}>
              <span style="font-size:.85rem;font-weight:500;color:var(--texto);text-transform:none;letter-spacing:0">Activa</span>
            </label>
          </div>
        </form>`,
      confirmLabel: id ? 'Actualizar' : 'Crear',
      onConfirm   : async (modal) => {
        const fd = new FormData(modal.getForm());
        const d  = {};
        fd.forEach((v, k) => { d[k] = v; });
        if (!d.id_cuenta_principal) { App.Toast.warning('La cuenta asociada es obligatoria.'); return; }
        if (!d.nombre) { App.Toast.warning('El nombre es obligatorio.'); return; }
        d.activa = (d.activa === 'on');
        
        if (d.color === 'custom') {
          d.color = d.color_custom;
        }
        delete d.color_custom;
        modal.setLoading(true);
        try {
          await App.API.call('api_admin_saveTarjeta', d);
          App.API.invalidatePattern('api_admin_getTarjetas');
          App.Toast.success('Tarjeta guardada.');
          modal.close();
          this.#renderTarjetas();
        } catch (err) { modal.setLoading(false); App.Toast.error(err.message); }
      }
    });
  }

  async _editCategoria(id) {
    const m = new App.Modal('modal-adm-cat');
    let data = null;
    if (id) {
      const response = await App.API.cached('api_admin_getCategorias', [], 0);
      data = (response?.data || []).find(c => c.id_categoria === id);
    }
    m.open({
      titulo      : id ? 'Editar Categoría' : 'Nueva Categoría',
      body        : `
        <form id="form-adm-cat" class="form-grid">
          <input type="hidden" name="id_categoria" value="${data?.id_categoria || ''}">
          <div class="form-group full-width">
            <label>Nombre <span class="required-mark">*</span></label>
            <input class="input" name="nombre" value="${App.Utils.escapeHtml(data?.nombre || '')}" required>
          </div>
          <div class="form-group">
            <label>Tipo de movimiento</label>
            <select class="input" name="tipo_mov">
              <option value="INGRESO" ${data?.tipo_mov === 'INGRESO' ? 'selected':''}>Ingreso</option>
              <option value="EGRESO"  ${!data || data?.tipo_mov === 'EGRESO' ? 'selected':''}>Egreso</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-switch">
              <input type="checkbox" class="toggle-switch" name="activa" ${!data || data.activa ? 'checked':''}>
              <span style="font-size:.85rem;font-weight:500;color:var(--texto);text-transform:none;letter-spacing:0">Activa</span>
            </label>
          </div>
        </form>`,
      confirmLabel: id ? 'Actualizar' : 'Crear',
      onConfirm   : async (modal) => {
        const fd = new FormData(modal.getForm());
        const d  = {};
        fd.forEach((v, k) => { d[k] = v; });
        if (!d.nombre) { App.Toast.warning('El nombre es obligatorio.'); return; }
        d.activa = (d.activa === 'on' || d.activa === true);
        modal.setLoading(true);
        try {
          await App.API.call('api_admin_saveCategoria', d);
          App.API.invalidatePattern('api_admin_getCategorias');
          App.Toast.success('Categoría guardada.');
          modal.close();
          this.#renderCategorias();
        } catch (err) { modal.setLoading(false); App.Toast.error(err.message); }
      }
    });
  }

  async _editSubcuenta(id) {
    const m = new App.Modal('modal-adm-sub');
    let data = null;
    let cuentas = [];
    try {
      const pCuentas = await App.API.cached('api_admin_getCuentasPrincipales', [], 0);
      cuentas = pCuentas?.data || [];
    } catch(e) {}

    if (id) {
      const response = await App.API.cached('api_admin_getAhorroSubcuentas', [], 0);
      data = (response?.data || []).find(s => s.id_subcuenta === id);
    }
    m.open({
      titulo      : id ? 'Editar Alcancía' : 'Nueva Alcancía',
      body        : `
        <form id="form-adm-sub" class="form-grid">
          <input type="hidden" name="id_subcuenta" value="${data?.id_subcuenta || ''}">
          
          <div class="form-group full-width">
            <label>Cuenta Asociada <span class="required-mark">*</span></label>
            <select class="input" name="id_cuenta_principal" required>
              <option value="" disabled ${!data ? 'selected' : ''}>Seleccione una cuenta</option>
              ${cuentas.map(c => `<option value="${c.id_cuenta_principal}" ${data?.id_cuenta_principal === c.id_cuenta_principal ? 'selected' : ''}>${App.Utils.escapeHtml(c.nombre)}</option>`).join('')}
            </select>
          </div>

          <div class="form-group full-width">
            <label>Nombre <span class="required-mark">*</span></label>
            <input class="input" name="nombre" value="${App.Utils.escapeHtml(data?.nombre || '')}" required>
          </div>
          
          <div class="form-group half-width">
            <label>Moneda</label>
            <select class="input" name="moneda">
              <option value="ARS" ${data?.moneda === 'ARS' ? 'selected':''}>ARS</option>
              <option value="USD" ${data?.moneda === 'USD' ? 'selected':''}>USD</option>
            </select>
          </div>
        </form>`,
      confirmLabel: id ? 'Actualizar' : 'Crear',
      onConfirm   : async (modal) => {
        const fd = new FormData(modal.getForm());
        const d  = {};
        fd.forEach((v, k) => { d[k] = v; });
        if (!d.id_cuenta_principal) { App.Toast.warning('La cuenta asociada es obligatoria.'); return; }
        if (!d.nombre) { App.Toast.warning('El nombre es obligatorio.'); return; }
        modal.setLoading(true);
        try {
          await App.API.call('api_admin_saveAhorroSubcuenta', d);
          App.API.invalidatePattern('api_admin_getAhorroSubcuentas');
          App.Toast.success('Alcancía guardada.');
          modal.close();
          this.#renderAhorroSubs();
        } catch (err) { modal.setLoading(false); App.Toast.error(err.message); }
      }
    });
  }

  async _editUsuarioCC(id) {
    const m = new App.Modal('modal-adm-usr');
    let data = null;
    if (id) {
      const response = await App.API.cached('api_admin_getCtaCorrienteUsuarios', [], 0);
      data = (response?.data || []).find(u => u.id_usuario === id);
    }
    m.open({
      titulo      : id ? 'Editar Usuario CC' : 'Nuevo Usuario CC',
      body        : `
        <form id="form-adm-usr" class="form-grid">
          <input type="hidden" name="id_usuario" value="${data?.id_usuario || ''}">
          <div class="form-group full-width">
            <label>Nombre <span class="required-mark">*</span></label>
            <input class="input" name="nombre" value="${App.Utils.escapeHtml(data?.nombre || '')}" required>
          </div>
        </form>`,
      confirmLabel: id ? 'Actualizar' : 'Crear',
      onConfirm   : async (modal) => {
        const fd = new FormData(modal.getForm());
        const d  = {};
        fd.forEach((v, k) => { d[k] = v; });
        if (!d.nombre) { App.Toast.warning('El nombre es obligatorio.'); return; }
        modal.setLoading(true);
        try {
          await App.API.call('api_admin_saveCtaCorrienteUsuario', d);
          App.API.invalidatePattern('api_admin_getCtaCorrienteUsuarios');
          App.Toast.success('Usuario guardado.');
          modal.close();
          this.#renderUsuariosCC();
        } catch (err) { modal.setLoading(false); App.Toast.error(err.message); }
      }
    });
  }

  // --- SECCIÓN 4B: ELIMINACIÓN ---

  async _deleteCuenta(id) {
    if (!confirm('¿Seguro que deseas eliminar esta cuenta?')) return;
    try {
      await App.API.call('api_admin_deleteCuentaPrincipal', id);
      App.API.invalidatePattern('api_admin_getCuentasPrincipales');
      App.Toast.success('Cuenta eliminada.');
      this.#renderCuentas();
    } catch (e) { App.Toast.error(e.message); }
  }

  async _deleteTarjeta(id) {
    if (!confirm('¿Seguro que deseas eliminar esta tarjeta?')) return;
    try {
      await App.API.call('api_admin_deleteTarjeta', id);
      App.API.invalidatePattern('api_admin_getTarjetas');
      App.Toast.success('Tarjeta eliminada.');
      this.#renderTarjetas();
    } catch (e) { App.Toast.error(e.message); }
  }

  async _deleteCategoria(id) {
    if (!confirm('¿Seguro que deseas eliminar esta categoría?')) return;
    try {
      await App.API.call('api_admin_deleteCategoria', id);
      App.API.invalidatePattern('api_admin_getCategorias');
      App.Toast.success('Categoría eliminada.');
      this.#renderCategorias();
    } catch (e) { App.Toast.error(e.message); }
  }

  async _deleteSubcuenta(id) {
    if (!confirm('¿Seguro que deseas eliminar esta alcancía?')) return;
    try {
      await App.API.call('api_admin_deleteAhorroSubcuenta', id);
      App.API.invalidatePattern('api_admin_getAhorroSubcuentas');
      App.Toast.success('Alcancía eliminada.');
      this.#renderAhorroSubs();
    } catch (e) { App.Toast.error(e.message); }
  }

  async _deleteUsuarioCC(id) {
    if (!confirm('¿Seguro que deseas eliminar este usuario?')) return;
    try {
      await App.API.call('api_admin_deleteCtaCorrienteUsuario', id);
      App.API.invalidatePattern('api_admin_getCtaCorrienteUsuarios');
      App.Toast.success('Usuario eliminado.');
      this.#renderUsuariosCC();
    } catch (e) { App.Toast.error(e.message); }
  }

  // --- SECCIÓN 5: LISTENERS ---

  _bindListeners() {
    // El botón admin está en el topbar — se vincula aquí para no depender del orden de init
    document.getElementById('btn-admin')
      ?.addEventListener('click', () => this.#abrirPanel());
  }
}

// --- REGISTRO ---

App.log('module-admin', 'init', 'AdminModule registrado');