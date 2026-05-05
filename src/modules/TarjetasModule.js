'use strict';
/* ============================================================
   module-tarjetas.html — v5.0.0
   Módulo Tarjetas de Crédito.
   Extiende BaseModule. Carga lazy con cache sessionStorage.
   ============================================================ */

// --- SECCIÓN 0: CLASE TarjetasModule ---

export class TarjetasModule extends BaseModule {

  get moduleId() { return 'tarjetas'; }
  get vistaId()  { return 'vista-tarjetas'; }

  get _createEndpoint() { return 'api_createConsumoTC'; }
  get _updateEndpoint() { return 'api_updateConsumoTC'; }
  get _deleteEndpoint() { return 'api_deleteConsumoTC'; }

  #table       = null;
  #kpiTotal    = null;
  #kpiImputado = null;
  #kpiConsol   = null;
  #modal       = null;
  #tarjetas    = [];
  #categorias  = [];
  #cuentas     = [];
  #editData    = null;
  #allConsumos = [];
  #selectedTcId = null;

  // --- SECCIÓN 1: CICLO DE VIDA ---

  init() {
    this.#modal = new App.Modal('modal-tarjetas');
    this._buildVista();
    this._bindListeners();
    this._subscribeEvents();
    App.log('TarjetasModule', 'init', 'Módulo iniciado');
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
        'api_getConsumosTC',
        [cuenta, fechaInicio, fechaFin],
        App.API.defaultTtl,
        (freshData) => { if (freshData && freshData.success) this._render(freshData); }
      );
      this._render(resp.data);
      App.Store.markModuloLoaded(this.moduleId);

      // Fetch proyecciones silently
      App.API.swr(
        'api_getProyeccionTC',
        [cuenta, mes],
        App.API.defaultTtl,
        (freshProy) => { if (freshProy && freshProy.success) this._renderProyecciones(freshProy); }
      ).then(r => { if(r.data && r.data.success) this._renderProyecciones(r.data); });

    } catch (err) {
      App.error('TarjetasModule', 'cargar', 'Error', err);
      App.Toast.error('Error al cargar tarjetas: ' + err.message);
    }
  }

  // --- SECCIÓN 2: RENDER ---

  _render(data) {
    if (!data || !data.success) {
      App.Toast.error(data?.error || 'Error al obtener datos.');
      return;
    }

    const { kpis, consumos } = data;

    // Tarjetas, categorías y cuentas desde globales (cargados en boot por api_getInitialData)
    // IMPORTANT: Filter tarjetas by current cuenta principal
    const allTarjetas = window._appTarjetas || [];
    this.#tarjetas = allTarjetas.filter(t => t.id_cuenta_principal === App.Store.cuenta);
    if (!this.#categorias.length) this.#categorias = window._appCategorias || [];
    if (!this.#cuentas.length)    this.#cuentas    = App.Store.cuentas     || [];

    this.#kpiTotal?.setValue(kpis.saldoTotal);
    this.#kpiImputado?.setValue(kpis.incidenciaPersonal, { invertido: kpis.incidenciaPersonal < 0 });
    this.#kpiConsol?.setValue(kpis.incidenciaFamiliar, { invertido: false });

    // Store all consumos for filtering
    this.#allConsumos = consumos || [];
    this.#selectedTcId = null;

    // Build the card selector pills
    this.#renderCardSelector();

    this.#table?.load(consumos || []);
    App.log('TarjetasModule', '_render', `${(consumos || []).length} consumos`);
  }

  _renderProyecciones(data) {
     const wrap = document.getElementById('tc-proy-wrap');
     if (!wrap) return;
     if (!data.proyeccion || data.proyeccion.length === 0) {
        wrap.innerHTML = `<div style="padding: 2rem;text-align:center;color:var(--texto-3)">No hay proyecciones futuras.</div>`;
        return;
     }

     const rows = data.proyeccion.map(p => `
        <div style="display:flex; justify-content:space-between; padding:var(--space-3); border-bottom:1px solid var(--border-color);">
           <strong style="font-size:1.1rem; color:var(--texto-1)">${App.Utils.formatearMes(p.mes)}</strong>
           <span class="negativo" style="font-size:1.1rem">${App.Utils.formatearMoneda(p.total)}</span>
        </div>
     `).join('');

     wrap.innerHTML = `
        <div style="padding:var(--space-3); border-bottom:1px solid var(--border-color); display:flex; align-items:center; gap:var(--space-2)">
          <div style="flex-grow:1">
            <h3 style="margin:0;color:var(--texto-1)">Proyección a 12 meses</h3>
            <p style="margin:0;color:var(--texto-3);font-size:0.85rem">Totales consolidados pendientes de facturación en todos tus plásticos.</p>
          </div>
          ${App.Icons.get('trending_up', 'icon-md', { style: 'color:var(--kpi-amber)' })}
        </div>
        <div>${rows}</div>
     `;
  }

  // --- SECCIÓN 3: BUILD DOM ---

  _buildVista() {
    const vista = document.getElementById(this.vistaId);
    if (!vista) return;

    vista.innerHTML = `
      <div class="kpi-grid" id="tc-kpi-grid"></div>

      <!-- Card Selector -->
      <div id="tc-card-selector" style="display:flex;gap:10px;overflow-x:auto;padding:4px 0;margin-bottom:var(--space-3)"></div>

      <div class="section-header" style="margin-bottom:var(--space-3)">
        <div class="acciones-container" id="tc-acciones"></div>
        <div class="selector-vista-container">
          <button id="tc-btn-mes" class="btn btn-primary btn-vista active">Consumos del Mes</button>
          <button id="tc-btn-proy" class="btn btn-ghost btn-vista">Proyecciones</button>
        </div>
      </div>
      <div class="table-card" id="tc-tabla-wrap"></div>
      <div class="table-card hidden" id="tc-proy-wrap">
         <div style="padding:1rem;color:var(--texto-3);text-align:center">Cargando proyecciones...</div>
      </div>
    `;

    const grid = document.getElementById('tc-kpi-grid');
    this.#kpiTotal    = new App.KpiCard(grid, { titulo: 'Deuda Total',         icono: 'credit_card', colorClass: 'kpi-red',    onFormat: App.Utils.formatearMoneda });
    this.#kpiImputado = new App.KpiCard(grid, { titulo: 'Incidencia Personal', icono: 'person',      colorClass: 'kpi-blue',   onFormat: App.Utils.formatearMoneda });
    this.#kpiConsol   = new App.KpiCard(grid, { titulo: 'Incidencia Externa',  icono: 'groups',      colorClass: 'kpi-amber',  onFormat: App.Utils.formatearMoneda });

    document.getElementById('tc-acciones').innerHTML = `
      <button id="tc-btn-nuevo" class="btn btn-primary">
        ${App.Icons.get('add', 'icon-sm')} Cargar Consumo
      </button>
    `;

    this.#table = new App.DataTable(
      document.getElementById('tc-tabla-wrap'),
      {
        columns: [
          { key: 'fecha',           label: 'Fecha',     sortable: true,
            render: (r) => App.Utils.formatearFecha(r.fecha?.value || r.fecha) },
          { key: 'tarjeta_nombre',  label: 'Tarjeta',   sortable: true,
            render: (r) => App.Utils.escapeHtml(r.tarjeta_nombre || '—') },
          { key: 'categoria_nombre',label: 'Categoría', sortable: true,
            render: (r) => App.Utils.escapeHtml(r.categoria_nombre || 'General') },
          { key: 'descripcion',     label: 'Descripción', searchable: true,
            render: (r) => this.#renderDescripcion(r) },
          { key: 'importe',         label: 'Importe',   sortable: true, align: 'right',
            render: (r) => `<span class="negativo">${App.Utils.formatearMoneda(r.importe)}</span>` },
          { key: 'imputacion',      label: 'Imputación',
            render: (r) => r.imputado
              ? `<span class="badge ${r.cuenta_imputada_nombre === 'Propios' ? 'badge-tc' : 'badge-recur'}">${r.cuenta_imputada_nombre}</span>`
              : `<span class="badge badge-neutro">Sin Imputar</span>` },
          { key: '_acciones',       label: '', align: 'right', exportable: false,
            render: (r) => this.#renderAcciones(r) }
        ],
        emptyMsg  : 'No hay consumos para este período.',
        paginated : true,
        pageSize  : 25,
        onAction  : ({ action, row }) => this.#handleAccion(action, row)
      }
    );
  }

  // --- SECCIÓN 4: MODAL ---

  abrirAlta() {
    this.#abrirModalAlta();
  }

  #abrirModalAlta() {
    this.#editData = null;
    this.#modal.open({
      titulo      : 'Nuevo Consumo TC',
      icono       : 'card',
      body        : this.#buildFormHtml(null),
      confirmLabel: 'Guardar',
      onConfirm   : (m) => this.#guardar(m)
    });
    this.#bindFormListeners();
  }

  #abrirModalEdicion(row) {
    this.#editData = row;
    this.#modal.open({
      titulo      : 'Editar Consumo',
      icono       : 'edit',
      body        : this.#buildFormHtml(row),
      confirmLabel: 'Actualizar',
      onConfirm   : (m) => this.#guardar(m)
    });
    this.#bindFormListeners();
  }

  #buildFormHtml(data) {
    const optsT = this.#tarjetas
      .map(t => `<option value="${t.id_tarjeta}" ${data?.id_tarjeta === t.id_tarjeta ? 'selected' : ''}>
        ${App.Utils.escapeHtml(t.nombre)}
      </option>`).join('');

    const optsC = this.#categorias
      .filter(c => c.tipo_mov === 'EGRESO' && c.activa)
      .map(c => `<option value="${c.id_categoria}" ${data?.id_categoria === c.id_categoria ? 'selected' : ''}>
        ${App.Utils.escapeHtml(c.nombre)}
      </option>`).join('');

    const rawFecha = data
      ? (data.fecha?.value || data.fecha || '').substring(0, 10)
      : new Date().toISOString().substring(0, 10);

    const tipoConsumo = data?.tipo_consumo || 'COMUN';

    return `
      <form id="form-tc" class="form-grid">
        <input type="hidden" name="id_consumo" value="${data?.id_consumo_tc || ''}">

        <div class="form-group">
          <label>Fecha <span class="required-mark">*</span></label>
          <input class="input" type="date" name="fecha" value="${rawFecha}" required>
        </div>

        <div class="form-group">
          <label>Tarjeta <span class="required-mark">*</span></label>
          <select class="input" name="id_tarjeta" required>
            <option value="">-- Seleccionar --</option>
            ${optsT}
          </select>
        </div>

        <div class="form-group">
          <label>Categoría <span class="required-mark">*</span></label>
          <select class="input" name="id_categoria" required>
            <option value="">-- Seleccionar --</option>
            ${optsC}
          </select>
        </div>

        <div class="form-group">
          <label>Tipo de consumo</label>
          <select class="input" name="tipo_consumo" id="tc-tipo-consumo">
            <option value="COMUN"     ${tipoConsumo === 'COMUN'     ? 'selected' : ''}>Común</option>
            <option value="CUOTAS"    ${tipoConsumo === 'CUOTAS'    ? 'selected' : ''}>En cuotas</option>
            <option value="RECURRENTE"${tipoConsumo === 'RECURRENTE'? 'selected' : ''}>Recurrente</option>
          </select>
        </div>

        <div class="form-group full-width">
          <label>Descripción <span class="required-mark">*</span></label>
          <input class="input" type="text" name="descripcion"
                 value="${App.Utils.escapeHtml(data?.descripcion || '')}" required>
        </div>

        <div class="form-group">
          <label id="lbl-tc-importe">Importe <span class="required-mark">*</span></label>
          <input class="input" type="number" name="importe" min="0.01" step="0.01"
                 value="${data?.importe || ''}" required>
        </div>

        <div id="tc-cuotas-opts" class="form-group ${tipoConsumo !== 'CUOTAS' ? 'hidden' : ''}">
          <label>Cuota actual / Total</label>
          <div style="display:flex;gap:var(--space-2)">
            <input class="input" type="number" name="cuota_actual" min="1"
                   value="${data?.cuota_actual || 1}" style="width:60px">
            <input class="input" type="number" name="cuota_total"  min="2"
                   value="${data?.cuota_total  || 12}" style="width:60px">
          </div>
        </div>

        <div id="tc-recur-opts" class="form-group ${tipoConsumo !== 'RECURRENTE' ? 'hidden' : ''}">
          <label>Períodos</label>
          <input class="input" type="number" name="periodos" min="2" max="60" value="${data?.periodos || 12}">
        </div>

        ${!data ? `
        <div class="form-group full-width">
          <label class="form-switch">
            <input type="checkbox" class="toggle-switch" name="imputar" id="tc-chk-imputar">
            <span>Imputar a cuenta de gastos</span>
          </label>
        </div>
        <div id="tc-imputar-opts" class="form-group full-width hidden">
          <label>Cuenta destino</label>
          <select class="input" name="cuenta_imputar">
            ${this.#cuentas
              .map(c => `<option value="${c.id_cuenta_principal}">${App.Utils.escapeHtml(c.nombre)}</option>`)
              .join('')}
          </select>
        </div>
        <div class="form-group full-width">
          <label class="form-switch">
            <input type="checkbox" class="toggle-switch" name="compartir" id="tc-chk-compartir">
            <span>Compartir gasto</span>
          </label>
        </div>
        <div id="tc-compartir-opts" class="form-group full-width hidden">
           <label>Contacto pagador alternativo</label>
           <!-- Si pago yo y se lo reclamo a ella, dejo mi porcentaje en 50, y lo mando al CC de mi cuenta. -->
           <p style="font-size:0.8rem;color:var(--texto-3);margin-top:0">Se creará automáticamente en Gastos Compartidos. Cargas qué % asumes vos del gasto.</p>
           <label>Mi porcentaje asumido (%)</label>
           <input class="input" type="number" name="compartir_porcentaje" min="1" max="99" value="50">
        </div>
        <div id="tc-imputar-opts" class="form-group full-width hidden">
          <label>Cuenta destino</label>
          <select class="input" name="cuenta_imputar">
            ${this.#cuentas
              .map(c => `<option value="${c.id_cuenta_principal}">${App.Utils.escapeHtml(c.nombre)}</option>`)
              .join('')}
          </select>
        </div>` : ''}
      </form>
    `;
  }

  #bindFormListeners() {
    const tipoSel = document.getElementById('tc-tipo-consumo');
    tipoSel?.addEventListener('change', () => {
      document.getElementById('tc-cuotas-opts')?.classList.toggle('hidden', tipoSel.value !== 'CUOTAS');
      document.getElementById('tc-recur-opts')?.classList.toggle('hidden', tipoSel.value !== 'RECURRENTE');
    });
    const chkImp = document.getElementById('tc-chk-imputar');
    chkImp?.addEventListener('change', () => {
      document.getElementById('tc-imputar-opts')?.classList.toggle('hidden', !chkImp.checked);
    });
  }

  // --- SECCIÓN 5: CRUD ---

  async #guardar(modal) {
    const form = modal.getForm();
    if (!form) return;
    const fd = new FormData(form);
    const d  = {};
    fd.forEach((v, k) => { d[k] = v; });

    if (!d.fecha || !d.id_tarjeta || !d.id_categoria || !d.descripcion || !d.importe || Number(d.importe) <= 0) {
      App.Toast.warning('Completá todos los campos obligatorios.');
      return;
    }

    const payload = {
      idCuenta    : App.Store.cuenta,
      idTarjeta   : d.id_tarjeta,
      fecha       : d.fecha,
      idCategoria : d.id_categoria,
      descripcion : d.descripcion,
      importe     : Number(d.importe),
      tipoConsumo : d.tipo_consumo || 'COMUN',
      cuotaActual : Number(d.cuota_actual || 1),
      cuotaTotal  : Number(d.cuota_total  || 1),
      periodos    : Number(d.periodos     || 12),
      imputar     : d.imputar === 'on',
      cuentaImputar: d.cuenta_imputar || ''
    };

    modal.setLoading(true);
    try {
      if (!this.#editData) {
        if (d.compartir === 'on') {
          const ccPayload = {
            idCuenta: App.Store.cuenta,
            idCategoria: d.id_categoria,
            fecha: d.fecha,
            tipo: d.tipo_consumo || 'COMUN',
            descripcion: d.descripcion + ' (Tarjeta)',
            importe: Number(d.importe),
            pagador: 'YO',
            porcentajeImputado: Number(d.compartir_porcentaje || 50),
            cuotaActual: Number(d.cuota_actual || 1),
            cuotaTotal: Number(d.cuota_total || 1),
            periodos: Number(d.periodos || 12)
          };
          const respCC = await App.API.call('api_createConsumoCC', ccPayload);
          if (!respCC.success) throw new Error('Error al crear gasto compartido: ' + respCC.error);
          App.Store.markModuloLoaded('cc', false);
        }
        await this._handleCreate(payload, modal);
      } else {
        const req = {
          data    : payload,
          original: {
            consumoId   : this.#editData.id_consumo_tc,
            recurGroupId: this.#editData.recur_group_id || null,
            fecha       : this.#editData.fecha?.value || this.#editData.fecha
          },
          scope: 'SINGLE'
        };
        await this._handleUpdate(this.#editData.id_consumo_tc, req, modal);
      }
    } catch (_) {
      modal.setLoading(false);
    }
  }

  async #eliminar(row) {
    const confirmModal = new App.Modal('modal-tc-del-confirm');
    confirmModal.open({
      titulo      : 'Eliminar consumo',
      body        : `<p>¿Eliminar <strong>${App.Utils.escapeHtml(row.descripcion)}</strong>?</p>`,
      confirmLabel: 'Eliminar',
      danger      : true,
      onConfirm   : async () => {
        try {
          await this._handleDelete(row.id_consumo_tc);
          this.destruir();
          await this.cargar();
        } catch (_) {}
      }
    });
  }

  // --- SECCIÓN 6: LISTENERS ---

  _bindListeners() {
    const vista = document.getElementById(this.vistaId);
    if (vista) {
      vista.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        
        if (btn.id === 'tc-btn-nuevo') {
          this.#abrirModalAlta();
        } else if (btn.id === 'tc-btn-mes') {
          document.getElementById('tc-btn-mes')?.classList.replace('btn-ghost', 'btn-primary');
          document.getElementById('tc-btn-proy')?.classList.replace('btn-primary', 'btn-ghost');
          document.getElementById('tc-tabla-wrap')?.classList.remove('hidden');
          document.getElementById('tc-proy-wrap')?.classList.add('hidden');
        } else if (btn.id === 'tc-btn-proy') {
          document.getElementById('tc-btn-proy')?.classList.replace('btn-ghost', 'btn-primary');
          document.getElementById('tc-btn-mes')?.classList.replace('btn-primary', 'btn-ghost');
          document.getElementById('tc-proy-wrap')?.classList.remove('hidden');
          document.getElementById('tc-tabla-wrap')?.classList.add('hidden');
        }
      });
    }
  }

  // --- SECCIÓN 7: HELPERS ---

  #renderDescripcion(row) {
    const badges = [];
    if (row.tipo_consumo === 'CUOTAS')     badges.push(`<span class="badge badge-recur">Cuota ${row.cuota_actual}/${row.cuota_total}</span>`);
    else if (row.tipo_consumo === 'RECURRENTE') badges.push('<span class="badge badge-recur">Recurrente</span>');
    if (row.imputado) badges.push('<span class="badge badge-tc">Imputado</span>');
    return `${App.Utils.escapeHtml(row.descripcion)} ${badges.join(' ')}`;
  }

  #renderAcciones(row) {
    return `
      <div style="display:flex;gap:4px;justify-content:flex-end">
        <button class="btn-accion" data-action="edit" data-id="${row.id_consumo_tc}">
          ${App.Icons.get('edit', 'icon-sm')}
        </button>
        <button class="btn-accion btn-danger" data-action="delete" data-id="${row.id_consumo_tc}">
          ${App.Icons.get('delete', 'icon-sm')}
        </button>
      </div>`;
  }

  #handleAccion(action, row) {
    if (action === 'edit')   this.#abrirModalEdicion(row);
    if (action === 'delete') this.#eliminar(row);
  }

  #mostrarKpiSkeletons() {
    this.#kpiTotal?.showSkeleton();
    this.#kpiImputado?.showSkeleton();
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

  #renderCardSelector() {
    const wrap = document.getElementById('tc-card-selector');
    if (!wrap) return;

    if (this.#tarjetas.length === 0) {
      wrap.innerHTML = '';
      return;
    }

    // Calculate subtotal per card
    const subtotals = {};
    this.#allConsumos.forEach(c => {
      const tid = c.id_tarjeta;
      subtotals[tid] = (subtotals[tid] || 0) + Number(c.importe || 0);
    });

    // "Todas" pill
    const allPill = `<button class="tc-card-pill ${!this.#selectedTcId ? 'active' : ''}"
      data-tc-filter="all"
      style="display:flex;flex-direction:column;align-items:flex-start;padding:10px 16px;border-radius:var(--r);border:2px solid ${!this.#selectedTcId ? 'var(--primary)' : 'var(--borde)'};background:${!this.#selectedTcId ? 'var(--primary-tint)' : 'var(--superficie)'};cursor:pointer;min-width:140px;transition:all .15s;font-family:inherit">
      <span style="font-size:0.78rem;font-weight:600;color:var(--texto)">Todas las tarjetas</span>
      <span style="font-size:1rem;font-weight:700;color:var(--texto);margin-top:2px">${App.Utils.formatearMoneda(this.#allConsumos.reduce((s, c) => s + Number(c.importe || 0), 0))}</span>
    </button>`;

    const pills = this.#tarjetas.map(tc => {
      const isActive = this.#selectedTcId === tc.id_tarjeta;
      const last4 = tc.ultimos_4 || '••••';
      const sub = subtotals[tc.id_tarjeta] || 0;
      return `<button class="tc-card-pill ${isActive ? 'active' : ''}"
        data-tc-filter="${tc.id_tarjeta}"
        style="display:flex;flex-direction:column;align-items:flex-start;padding:10px 16px;border-radius:var(--r);border:2px solid ${isActive ? 'var(--primary)' : 'var(--borde)'};background:${isActive ? 'var(--primary-tint)' : 'var(--superficie)'};cursor:pointer;min-width:140px;transition:all .15s;font-family:inherit">
        <span style="font-size:0.78rem;font-weight:600;color:var(--texto)">${App.Utils.escapeHtml(tc.nombre || tc.marca)}</span>
        <span style="font-size:0.68rem;color:var(--texto-3)">•••• ${last4}</span>
        <span style="font-size:1rem;font-weight:700;color:var(--texto);margin-top:2px">${App.Utils.formatearMoneda(sub)}</span>
      </button>`;
    }).join('');

    wrap.innerHTML = allPill + pills;

    // Bind click events
    wrap.querySelectorAll('[data-tc-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.tcFilter;
        this.#selectedTcId = val === 'all' ? null : val;
        this.#renderCardSelector();
        this.#filterConsumosByCard();
      });
    });
  }

  #filterConsumosByCard() {
    if (!this.#selectedTcId) {
      this.#table?.load(this.#allConsumos);
    } else {
      const filtered = this.#allConsumos.filter(c => c.id_tarjeta === this.#selectedTcId);
      this.#table?.load(filtered);
    }
  }
}

// --- REGISTRO ---

App.log('module-tarjetas', 'init', 'TarjetasModule registrado');