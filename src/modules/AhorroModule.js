'use strict';
/* ============================================================
   module-ahorro.html — v5.0.0
   Módulo Ahorro ARS/USD.
   Extiende BaseModule. Carga lazy con cache sessionStorage.
   ============================================================ */

// --- SECCIÓN 0: CLASE AhorroModule ---

export class AhorroModule extends BaseModule {

  get moduleId() { return 'ahorro'; }
  get vistaId()  { return 'vista-ahorro'; }

  get _createEndpoint() { return 'api_createAhorro'; }
  get _updateEndpoint() { return 'api_updateAhorro'; }
  get _deleteEndpoint() { return 'api_deleteAhorro'; }

  #table        = null;
  #kpiArs       = null;
  #kpiUsd       = null;
  #kpiConsol    = null;
  #modal        = null;
  #vistaActual  = 'ARS'; // 'ARS' | 'USD'
  #dataCompleta = null;
  #cotizacion   = null;
  #editData     = null;

  // --- SECCIÓN 1: CICLO DE VIDA ---

  init() {
    this.#modal = new App.Modal('modal-ahorro');
    this._buildVista();
    this._bindListeners();
    this._subscribeEvents();
    App.log('AhorroModule', 'init', 'Módulo ahorro iniciado');
  }

  async cargar() {
    if (App.Store.isModuloLoaded(this.moduleId)) return;
    const { cuenta, mes } = App.Store;
    if (!cuenta || !mes) return;

    const { fechaInicio, fechaFin } = this.#calcFechas(mes);
    this.#mostrarKpiSkeletons();
    this.#table?.showSkeleton(5);

    try {
      const resp = await App.API.swr(
        'api_getAhorros',
        [cuenta, fechaInicio, fechaFin],
        App.API.defaultTtl,
        (freshData) => { if (freshData && freshData.success) this._render(freshData); }
      );
      this._render(resp.data);
      App.Store.markModuloLoaded(this.moduleId);
    } catch (err) {
      App.error('AhorroModule', 'cargar', 'Error', err);
      App.Toast.error('Error al cargar ahorros: ' + err.message);
    }
  }

  // --- SECCIÓN 2: RENDER ---

  _render(data) {
    if (!data || !data.success) {
      App.Toast.error(data?.error || 'Error al obtener datos de ahorro.');
      return;
    }

    this.#dataCompleta = data;
    this.#cotizacion   = data.cotizacion;

    const { kpis } = data;
    const tasa      = this.#cotizacion?.venta || 0;

    this.#kpiArs?.setValue(kpis.arsTotal, {
      subtitulo: tasa ? `Eq: USD ${App.Utils.formatearMoneda(kpis.arsTotal / tasa, false)}` : ''
    });
    this.#kpiUsd?.setValue(kpis.usdTotal, {
      subtitulo: tasa ? `Eq: ARS ${App.Utils.formatearMoneda(kpis.usdTotal * tasa, false)} (1 USD = $${App.Utils.formatearMoneda(tasa, false)})` : ''
    });
    this.#kpiConsol?.setValue(kpis.consolidadoArs, {
      subtitulo: this.#cotizacion?.fecha
        ? `Cotización: ${App.Utils.formatearFecha(this.#cotizacion.fecha)}`
        : ''
    });

    this.#setVista(this.#vistaActual);
    App.log('AhorroModule', '_render', 'Datos de ahorro renderizados');
  }

  // --- SECCIÓN 3: BUILD DOM ---

  _buildVista() {
    const vista = document.getElementById(this.vistaId);
    if (!vista) return;

    vista.innerHTML = `
      <div class="kpi-grid" id="aho-kpi-grid"></div>

      <div class="section-header" style="margin-bottom:var(--space-3)">
        <div class="acciones-container" id="aho-acciones"></div>
        <div class="selector-vista-container">
          <button id="aho-btn-ars" class="btn btn-primary btn-vista active">ARS</button>
          <button id="aho-btn-usd" class="btn btn-ghost btn-vista">USD</button>
        </div>
      </div>

      <div class="table-card" id="aho-tabla-wrap"></div>
    `;

    const grid = document.getElementById('aho-kpi-grid');
    this.#kpiArs    = new App.KpiCard(grid, { titulo: 'Ahorro ARS', icono: 'savings', colorClass: 'kpi-green',  onFormat: App.Utils.formatearMoneda });
    this.#kpiUsd    = new App.KpiCard(grid, { titulo: 'Ahorro USD', icono: 'savings', colorClass: 'kpi-blue',   onFormat: App.Utils.formatearMonedaUSD });
    this.#kpiConsol = new App.KpiCard(grid, { titulo: 'Consolidado ARS', icono: 'investment', colorClass: 'kpi-purple', onFormat: App.Utils.formatearMoneda });

    document.getElementById('aho-acciones').innerHTML = `
      <button id="aho-btn-deposito" class="btn btn-success">
        ${App.Icons.get('add', 'icon-sm')} Depósito
      </button>
      <button id="aho-btn-retiro" class="btn btn-danger">
        ${App.Icons.get('trending_down', 'icon-sm')} Retiro
      </button>
    `;

    this.#table = new App.DataTable(
      document.getElementById('aho-tabla-wrap'),
      {
        columns: [
          { key: 'fecha',           label: 'Fecha',    sortable: true,
            render: (r) => App.Utils.formatearFecha(r.fecha?.value || r.fecha) },
          { key: 'tipo_mov',        label: 'Tipo',
            render: (r) => `<span class="tipo-mov tipo-${r.tipo_mov?.toLowerCase()}">${App.Utils.escapeHtml(r.tipo_mov)}</span>` },
          { key: 'subcuenta_nombre',label: 'Subcuenta', sortable: true,
            render: (r) => App.Utils.escapeHtml(r.subcuenta_nombre || '—') },
          { key: 'descripcion',     label: 'Descripción', searchable: true,
            render: (r) => App.Utils.escapeHtml(r.descripcion || '') },
          { key: 'importe',         label: 'Importe',  sortable: true, align: 'right',
            render: (r) => {
              const fmt = r.moneda === 'USD' ? App.Utils.formatearMonedaUSD : App.Utils.formatearMoneda;
              const cls = r.tipo_mov === 'RETIRO' ? 'negativo' : 'positivo';
              return `<span class="${cls}">${fmt(r.importe)}</span>`;
            }},
          { key: '_acciones', label: '', align: 'right', exportable: false,
            render: (r) => this.#renderAcciones(r) }
        ],
        emptyMsg : 'No hay movimientos de ahorro para este período.',
        paginated: true,
        pageSize : 25,
        onAction : ({ action, row }) => this.#handleAccion(action, row)
      }
    );
  }

  // --- SECCIÓN 4: CAMBIO DE VISTA ARS/USD ---

  #setVista(moneda) {
    this.#vistaActual = moneda;
    const transferencias = this.#dataCompleta?.transferencias || [];
    const filtradas      = transferencias.filter(t => t.moneda === moneda);
    this.#table?.load(filtradas);

    document.getElementById('aho-btn-ars')?.classList.toggle('btn-primary', moneda === 'ARS');
    document.getElementById('aho-btn-ars')?.classList.toggle('btn-ghost',   moneda !== 'ARS');
    document.getElementById('aho-btn-usd')?.classList.toggle('btn-primary', moneda === 'USD');
    document.getElementById('aho-btn-usd')?.classList.toggle('btn-ghost',   moneda !== 'USD');
  }

  // --- SECCIÓN 5: MODAL ---

  #abrirModalAlta(tipo) {
    this.#editData = null;
    this.#modal.open({
      titulo      : tipo === 'DEPOSITO' ? 'Nuevo Depósito' : 'Nuevo Retiro',
      body        : this.#buildFormHtml(tipo, null),
      confirmLabel: 'Guardar',
      danger      : tipo === 'RETIRO',
      onConfirm   : (m) => this.#guardar(m, tipo)
    });
  }

  #abrirModalEdicion(row) {
    this.#editData = row;
    this.#modal.open({
      titulo      : 'Editar movimiento de ahorro',
      body        : this.#buildFormHtml(row.tipo_mov, row),
      confirmLabel: 'Actualizar',
      onConfirm   : (m) => this.#guardar(m, row.tipo_mov)
    });
  }

  #buildFormHtml(tipo, data) {
    const rawFecha = data
      ? (data.fecha?.value || data.fecha || '').substring(0, 10)
      : new Date().toISOString().substring(0, 10);
    const moneda   = data?.moneda || this.#vistaActual;

    // Subcuentas (viene en dataCompleta)
    const subcuentas = this.#dataCompleta?.subcuentas || [];
    const optsS      = subcuentas
      .filter(s => !moneda || s.moneda === moneda)
      .map(s => `<option value="${s.id_subcuenta}" ${data?.id_subcuenta === s.id_subcuenta ? 'selected':''}>${App.Utils.escapeHtml(s.nombre)}</option>`)
      .join('');

    return `
      <form id="form-ahorro" class="form-grid">
        <input type="hidden" name="tipo"       value="${tipo}">
        <input type="hidden" name="id_ahorro"  value="${data?.id_ahorro || ''}">

        <div class="form-group">
          <label>Fecha <span class="required-mark">*</span></label>
          <input class="input" type="date" name="fecha" value="${rawFecha}" required>
        </div>

        <div class="form-group">
          <label>Moneda <span class="required-mark">*</span></label>
          <select class="input" name="moneda" id="aho-moneda">
            <option value="ARS" ${moneda === 'ARS' ? 'selected':''}>ARS</option>
            <option value="USD" ${moneda === 'USD' ? 'selected':''}>USD</option>
          </select>
        </div>

        <div class="form-group full-width">
          <label>Subcuenta <span class="required-mark">*</span></label>
          <select class="input" name="id_subcuenta" id="aho-subcuenta">
            <option value="">-- Seleccionar --</option>
            ${optsS}
          </select>
        </div>

        <div class="form-group">
          <label>Importe <span class="required-mark">*</span></label>
          <input class="input" type="number" name="importe" min="0.01" step="0.01"
                 value="${data?.importe || ''}" required>
        </div>

        <div class="form-group">
          <label>Descripción</label>
          <input class="input" type="text" name="descripcion"
                 value="${App.Utils.escapeHtml(data?.descripcion || '')}">
        </div>
      </form>
    `;
  }

  // --- SECCIÓN 6: CRUD ---

  async #guardar(modal, tipo) {
    const form = modal.getForm();
    if (!form) return;
    const fd = new FormData(form);
    const d  = {};
    fd.forEach((v, k) => { d[k] = v; });

    if (!d.fecha || !d.id_subcuenta || !d.importe || Number(d.importe) <= 0) {
      App.Toast.warning('Completá los campos obligatorios.');
      return;
    }

    const payload = {
      idCuenta    : App.Store.cuenta,
      tipo        : tipo,
      fecha       : d.fecha,
      moneda      : d.moneda,
      idSubcuenta : d.id_subcuenta,
      importe     : Number(d.importe),
      descripcion : d.descripcion || ''
    };

    modal.setLoading(true);
    try {
      if (!this.#editData) {
        await this._handleCreate(payload, modal);
      } else {
        const req = { data: payload, original: { id: this.#editData.id_ahorro }, scope: 'SINGLE' };
        await this._handleUpdate(this.#editData.id_ahorro, req, modal);
      }
    } catch (_) {
      modal.setLoading(false);
    }
  }

  async #eliminar(row) {
    const confirmModal = new App.Modal('modal-aho-del-confirm');
    confirmModal.open({
      titulo      : 'Eliminar movimiento de ahorro',
      body        : `<p>¿Eliminar este movimiento de <strong>${App.Utils.formatearMoneda(row.importe)}</strong>?</p>`,
      confirmLabel: 'Eliminar',
      danger      : true,
      onConfirm   : async () => {
        try {
          await this._handleDelete(row.id_ahorro);
          this.destruir();
          await this.cargar();
        } catch (_) {}
      }
    });
  }

  // --- SECCIÓN 7: LISTENERS ---

  _bindListeners() {
    const vista = document.getElementById(this.vistaId);
    if (vista) {
      vista.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.id === 'aho-btn-deposito') this.#abrirModalAlta('DEPOSITO');
        else if (btn.id === 'aho-btn-retiro') this.#abrirModalAlta('RETIRO');
        else if (btn.id === 'aho-btn-ars') this.#setVista('ARS');
        else if (btn.id === 'aho-btn-usd') this.#setVista('USD');
      });
    }
  }

  // --- SECCIÓN 8: HELPERS ---

  #renderAcciones(row) {
    return `
      <div style="display:flex;gap:4px;justify-content:flex-end">
        <button class="btn-accion" data-action="edit" data-id="${row.id_ahorro}">
          ${App.Icons.get('edit', 'icon-sm')}
        </button>
        <button class="btn-accion btn-danger" data-action="delete" data-id="${row.id_ahorro}">
          ${App.Icons.get('delete', 'icon-sm')}
        </button>
      </div>`;
  }

  #handleAccion(action, row) {
    if (action === 'edit')   this.#abrirModalEdicion(row);
    if (action === 'delete') this.#eliminar(row);
  }

  #mostrarKpiSkeletons() {
    this.#kpiArs?.showSkeleton();
    this.#kpiUsd?.showSkeleton();
    this.#kpiConsol?.showSkeleton();
  }

  #calcFechas(mes) {
    const [y, mo] = mes.split('-').map(Number);
    const ultimo  = new Date(y, mo, 0).getDate();
    return {
      fechaInicio: `${y}-${String(mo).padStart(2, '0')}-01`,
      fechaFin   : `${y}-${String(mo).padStart(2, '0')}-${ultimo}`
    };
  }
}

// --- REGISTRO ---

App.log('module-ahorro', 'init', 'AhorroModule registrado');