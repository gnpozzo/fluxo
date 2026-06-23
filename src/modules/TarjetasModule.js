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
  #modalImportar = null;
  #tarjetas    = [];
  #categorias  = [];
  #cuentas     = [];
  #editData    = null;
  #allConsumos = [];
  #selectedTcId = null;
  #txListImportar = [];

  // --- SECCIÓN 1: CICLO DE VIDA ---

  init() {
    this.#modal = new App.Modal('modal-tarjetas');
    this.#modalImportar = new App.Modal('modal-tc-importar');
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

    // Filter consumos to only those from this account's tarjetas
    const validTcIds = new Set(this.#tarjetas.map(t => t.id_tarjeta));
    const filteredConsumos = (consumos || []).filter(c => validTcIds.has(c.id_tarjeta));

    // Recalculate KPIs from filtered data (don't trust backend if RPC leaks cross-account)
    let saldoTotal = 0, incidenciaPersonal = 0, incidenciaFamiliar = 0;
    filteredConsumos.forEach(c => {
      const imp = Number(c.importe || 0);
      saldoTotal += imp;
      if (c.imputado && c.cuenta_imputada_nombre !== 'Propios') {
        incidenciaFamiliar += imp;
      } else {
        incidenciaPersonal += imp;
      }
    });

    this.#kpiTotal?.setValue(saldoTotal);
    this.#kpiImputado?.setValue(incidenciaPersonal, { invertido: incidenciaPersonal < 0 });
    this.#kpiConsol?.setValue(incidenciaFamiliar, { invertido: false });

    // Store filtered consumos for card selector filtering
    this.#allConsumos = filteredConsumos;
    
    // Preserve selected card ID if it remains valid
    const validCard = this.#tarjetas.some(t => t.id_tarjeta === this.#selectedTcId);
    if (!validCard) {
      this.#selectedTcId = null;
    }

    // Build the card selector pills
    this.#renderCardSelector();

    this.#filterConsumosByCard();
    App.log('TarjetasModule', '_render', `${filteredConsumos.length} consumos (filtered from ${(consumos || []).length})`);
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
      <div class="module-view-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
          <line x1="1" y1="10" x2="23" y2="10"/>
        </svg>
        <span>Tarjetas de Crédito</span>
      </div>

      <!-- Card Selector Slider Wrapper -->
      <div class="tc-slider-container" style="position:relative; display:flex; align-items:center; justify-content:center; gap:16px; margin-bottom:var(--space-3); width:100%;">
        <button id="tc-slide-prev" class="tc-slide-arrow" aria-label="Tarjeta Anterior">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:16px; height:16px; display:block;">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        
        <div id="tc-card-selector" class="tc-card-list">
          <!-- Cards are dynamically rendered here -->
        </div>
        
        <button id="tc-slide-next" class="tc-slide-arrow" aria-label="Siguiente Tarjeta">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:16px; height:16px; display:block;">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </div>

      <div class="kpi-grid" id="tc-kpi-grid"></div>

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

    this.#renderAcciones();

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
              : `<span class="badge badge-neutro">Sin Imputar</span>` }
        ],
        emptyMsg  : 'No hay consumos para este período.',
        paginated : true,
        pageSize  : 25,
        onRowClick: ({ row }) => this.#abrirModalDetalle(row)
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
    const defaultTcId = data?.id_tarjeta || this.#selectedTcId || '';
    const optsT = this.#tarjetas
      .map(t => `<option value="${t.id_tarjeta}" ${t.id_tarjeta === defaultTcId ? 'selected' : ''}>
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
      idCuentaImputar: d.cuenta_imputar || ''
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
        
        if (btn.id === 'tc-btn-mes') {
          document.getElementById('tc-btn-mes')?.classList.replace('btn-ghost', 'btn-primary');
          document.getElementById('tc-btn-proy')?.classList.replace('btn-primary', 'btn-ghost');
          document.getElementById('tc-tabla-wrap')?.classList.remove('hidden');
          document.getElementById('tc-proy-wrap')?.classList.add('hidden');
        } else if (btn.id === 'tc-btn-proy') {
          document.getElementById('tc-btn-proy')?.classList.replace('btn-ghost', 'btn-primary');
          document.getElementById('tc-btn-mes')?.classList.replace('btn-primary', 'btn-ghost');
          document.getElementById('tc-proy-wrap')?.classList.remove('hidden');
          document.getElementById('tc-tabla-wrap')?.classList.add('hidden');
        } else if (btn.id === 'tc-slide-prev') {
          const selectorEl = document.getElementById('tc-card-selector');
          selectorEl?.scrollBy({ left: -240, behavior: 'smooth' });
        } else if (btn.id === 'tc-slide-next') {
          const selectorEl = document.getElementById('tc-card-selector');
          selectorEl?.scrollBy({ left: 240, behavior: 'smooth' });
        }
      });
    }

    // Update slider arrows on window resize if the view is active
    window.addEventListener('resize', () => {
      const vistaEl = document.getElementById(this.vistaId);
      if (vistaEl && vistaEl.classList.contains('active')) {
        this.#updateSliderArrows();
      }
    });
  }

  _subscribeEvents() {
    super._subscribeEvents();
    if (App.Events) {
      App.Events.on('ui:tab-changed', (payload) => {
        if (payload && payload.tabId === this.vistaId) {
          this.#updateSliderArrows();
        }
      });
    }
  }

  // --- SECCIÓN 7: DETAIL MODAL & HELPERS ---

  #abrirModalDetalle(row) {
    const badges = [];
    if (row.tipo_consumo === 'CUOTAS')     badges.push(`<span class="badge badge-recur">Cuota ${row.cuota_actual}/${row.cuota_total}</span>`);
    else if (row.tipo_consumo === 'RECURRENTE') badges.push('<span class="badge badge-recur">Recurrente</span>');
    if (row.imputado) badges.push('<span class="badge badge-tc">Imputado</span>');

    const detailModal = new App.Modal('modal-tc-detail');
    detailModal.open({
      titulo: row.descripcion,
      icono: 'card',
      size: 'md',
      body: `
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">Importe</span>
            <span class="detail-value detail-amount negativo">${App.Utils.formatearMoneda(row.importe)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Tarjeta</span>
            <span class="detail-value">${App.Utils.escapeHtml(row.tarjeta_nombre || '—')}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Fecha</span>
            <span class="detail-value">${App.Utils.formatearFecha(row.fecha?.value || row.fecha)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Categoría</span>
            <span class="detail-value">${App.Utils.escapeHtml(row.categoria_nombre || 'General')}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Imputación</span>
            <span class="detail-value">${row.imputado
              ? `<span class="badge ${row.cuenta_imputada_nombre === 'Propios' ? 'badge-tc' : 'badge-recur'}">${row.cuenta_imputada_nombre}</span>`
              : '<span class="badge badge-neutro">Sin Imputar</span>'}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Etiquetas</span>
            <span class="detail-value">${badges.length > 0 ? badges.join(' ') : '<span style="color:var(--texto-3)">Ninguna</span>'}</span>
          </div>
          ${row.descripcion ? `
          <div class="detail-item full-width">
            <span class="detail-label">Descripción</span>
            <span class="detail-value" style="font-weight:500">${App.Utils.escapeHtml(row.descripcion)}</span>
          </div>` : ''}
        </div>
        <div class="detail-actions">
          <button class="btn btn-ghost" id="detail-tc-edit">${App.Icons.get('edit', 'icon-sm')} Editar</button>
          <button class="btn btn-danger" id="detail-tc-delete">${App.Icons.get('delete', 'icon-sm')} Eliminar</button>
        </div>
      `,
      confirmLabel: '',
      cancelLabel: 'Cerrar'
    });
    const cb = detailModal.el.querySelector('.modal-confirm');
    if (cb) cb.style.display = 'none';

    document.getElementById('detail-tc-edit')?.addEventListener('click', () => {
      detailModal.close();
      this.#abrirModalEdicion(row);
    });
    document.getElementById('detail-tc-delete')?.addEventListener('click', () => {
      detailModal.close();
      this.#eliminar(row);
    });
  }

  #renderDescripcion(row) {
    const badges = [];
    if (row.tipo_consumo === 'CUOTAS')     badges.push(`<span class="badge badge-recur">Cuota ${row.cuota_actual}/${row.cuota_total}</span>`);
    else if (row.tipo_consumo === 'RECURRENTE') badges.push('<span class="badge badge-recur">Recurrente</span>');
    if (row.imputado) badges.push('<span class="badge badge-tc">Imputado</span>');
    return `${App.Utils.escapeHtml(row.descripcion)} ${badges.join(' ')}`;
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

    // Helper visual elements
    const getBrandLogoHtml = (brandName) => {
      const name = (brandName || '').toUpperCase();
      if (name.includes('VISA')) {
        return `<svg viewBox="0 0 48 16" width="36" height="12" fill="#ffffff" style="opacity:0.95; display:block;"><path d="M18.2 1.2L15.3 15h-2.8L9.7 4.1C9.2 3.6 8.7 3.3 8 3.2L5 3v-.4h4.6c.6 0 1.1.4 1.2 1L12 11.2l3.5-10h2.7zm9.6 9.4c0-2.5-3.5-2.6-3.5-3.7 0-.3.3-.7 1-.8.3 0 1.3-.1 2.4.4l.4-2.5C27.4 3.7 26.3 3.4 25 3.4c-2.8 0-4.8 1.5-4.8 3.6 0 2.8 3.9 3 3.9 4.5 0 .5-.5.9-1.2.9-1.6 0-2.7-.7-2.7-.7l-.4 2.6c.7.3 2.1.6 3.5.6 3 0 5.2-1.5 5.2-3.7zM38.8 15h2.4L43.3 1.2h-2.4L38.8 15zm-9.3-13.8L27.2 15h2.6l1.6-4.4h6.3l.6 4.4h2.3L37.2 1.2H29.5zm2.3 7.2l2-5.5 1.1 5.5H31.8zM4.6 1.2L.2 11.9v.2c.4 1.1 1.5 1.7 2.6 1.7H11L12.3 8 7.6 1.2H4.6z" /></svg>`;
      }
      if (name.includes('AMEX') || name.includes('AMERICAN')) {
        return `<div style="font-family:'Inter', sans-serif;font-weight:900;font-style:italic;font-size:0.75rem;letter-spacing:0.5px;color:#0070d2;background:#ffffff;padding:2px 4px;border-radius:2px;line-height:1;display:inline-block;box-shadow: 0 1px 3px rgba(0,0,0,0.2);">AMEX</div>`;
      }
      return `<svg viewBox="0 0 32 20" width="28" height="18" style="display:block;"><circle cx="10" cy="10" r="10" fill="#EB001B"/><circle cx="22" cy="10" r="10" fill="#F79E1B" opacity="0.85"/></svg>`;
    };

    const flameLogo = `<svg class="tc-card-issuer-logo" viewBox="0 0 32 32" fill="#ffffff" style="display:block;">
      <path d="M16.1 2C16 2.1 12.1 7.2 12.1 11.4c0 3.3 2 5.8 4 7.6 1.8 1.6 3.1 3.5 3.1 6.1 0 4.1-3.3 7.4-7.4 7.4S4.4 29.1 4.4 25c0-4.1 2.2-7.5 4.9-9.8 1-1 2.1-2 2.1-3.6 0-2.4-1.9-4-1.9-4 0 0 .9.8 1.4 1.7 1.2 2.1.5 4.3-.6 5.6-2.1 2.4-3.4 5.2-3.4 8.7 0 5.4 4.4 9.8 9.8 9.8s9.8-4.4 9.8-9.8c0-5.4-3.5-9.3-6.5-12.7C18.5 8.7 16.1 2 16.1 2z" />
    </svg>`;

    const contactlessWave = `<svg class="tc-card-contactless" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="display:block;">
      <path d="M5 8a9 9 0 0 1 0 8" opacity="0.3"/>
      <path d="M8 6a12 12 0 0 1 0 12" opacity="0.5"/>
      <path d="M11 4a15 15 0 0 1 0 16" opacity="0.7"/>
      <path d="M14 2a18 18 0 0 1 0 20"/>
    </svg>`;

    const cardChip = `<div class="tc-card-chip"><div class="tc-card-chip-inner"></div></div>`;

    // Calculate subtotal per card
    const subtotals = {};
    this.#allConsumos.forEach(c => {
      const tid = c.id_tarjeta;
      subtotals[tid] = (subtotals[tid] || 0) + Number(c.importe || 0);
    });

    // "Todas" / Consolidado premium card
    const isAllActive = !this.#selectedTcId;
    const totalConsol = this.#allConsumos.reduce((s, c) => s + Number(c.importe || 0), 0);
    const allPill = `<button class="tc-card-pill ${isAllActive ? 'active' : ''}"
      data-tc-filter="all"
      style="background: linear-gradient(135deg, #1D195D 0%, #0f0d36 100%)">
      <div class="tc-card-shimmer"></div>
      
      <div class="tc-card-row tc-card-top">
        <span class="tc-card-issuer-name">CONSOLIDADO</span>
        ${flameLogo}
      </div>
      
      <div class="tc-card-row tc-card-middle">
        ${cardChip}
        ${contactlessWave}
      </div>

      <div class="tc-card-row tc-card-bottom">
        <div class="tc-card-bottom-left">
          <span class="tc-card-number">**** ALL</span>
          <span class="tc-card-amount">${App.Utils.formatearMoneda(totalConsol)}</span>
        </div>
        <div class="tc-card-bottom-right">
          <div style="width:28px; height:18px;"></div>
        </div>
      </div>
    </button>`;

    const pills = this.#tarjetas.map(tc => {
      const isActive = this.#selectedTcId === tc.id_tarjeta;
      const last4 = tc.ultimos_4_digitos || tc.ultimos_4 || '••••';
      const sub = subtotals[tc.id_tarjeta] || 0;
      
      const cardIssuer = ((tc.marca || tc.nombre || '').split(' ')[0] + ' ' + (tc.banco || 'SANTANDER')).toUpperCase();
      
      let gradient;
      if (tc.color && tc.color.startsWith('#')) {
        gradient = `linear-gradient(135deg, ${tc.color} 0%, rgba(15, 23, 42, 0.85) 100%)`;
      } else {
        switch(tc.color) {
          case 'red':    gradient = 'linear-gradient(135deg, #c41e3a 0%, #60020f 100%)'; break;
          case 'orange': gradient = 'linear-gradient(135deg, #d35400 0%, #7e2a00 100%)'; break;
          case 'purple': gradient = 'linear-gradient(135deg, #7d26cd 0%, #3a006f 100%)'; break;
          case 'green':  gradient = 'linear-gradient(135deg, #1e7e34 0%, #0b3c15 100%)'; break;
          case 'dark':   gradient = 'linear-gradient(135deg, #343a40 0%, #1a1d20 100%)'; break;
          case 'black':  gradient = 'linear-gradient(135deg, #212529 0%, #000000 100%)'; break;
          case 'silver': gradient = 'linear-gradient(135deg, #a8b2c1 0%, #5a6268 100%)'; break;
          case 'gold':   gradient = 'linear-gradient(135deg, #daa520 0%, #8b6508 100%)'; break;
          case 'blue':
          default:
            gradient = 'linear-gradient(135deg, #1D195D 0%, #0c0a2a 100%)';
            break;
        }
      }

      return `<button class="tc-card-pill ${isActive ? 'active' : ''}"
        data-tc-filter="${tc.id_tarjeta}"
        style="background:${gradient}">
        <div class="tc-card-shimmer"></div>
        
        <div class="tc-card-row tc-card-top">
          <span class="tc-card-issuer-name">${App.Utils.escapeHtml(cardIssuer)}</span>
          ${flameLogo}
        </div>
        
        <div class="tc-card-row tc-card-middle">
          ${cardChip}
          ${contactlessWave}
        </div>

        <div class="tc-card-row tc-card-bottom">
          <div class="tc-card-bottom-left">
            <span class="tc-card-number">**** ${last4}</span>
            <span class="tc-card-amount">${App.Utils.formatearMoneda(sub)}</span>
          </div>
          <div class="tc-card-bottom-right">
            ${getBrandLogoHtml(tc.marca || tc.nombre)}
          </div>
        </div>
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

    this.#updateSliderArrows();
  }

  #filterConsumosByCard() {
    if (!this.#selectedTcId) {
      this.#table?.load(this.#allConsumos);
    } else {
      const filtered = this.#allConsumos.filter(c => c.id_tarjeta === this.#selectedTcId);
      this.#table?.load(filtered);
    }
  }

  #updateSliderArrows() {
    const list = document.getElementById('tc-card-selector');
    const prevBtn = document.getElementById('tc-slide-prev');
    const nextBtn = document.getElementById('tc-slide-next');
    if (!list || !prevBtn || !nextBtn) return;

    const hasOverflow = list.scrollWidth > list.clientWidth;
    if (hasOverflow) {
      prevBtn.classList.remove('hidden');
      nextBtn.classList.remove('hidden');
    } else {
      prevBtn.classList.add('hidden');
      nextBtn.classList.add('hidden');
    }
  }

  #renderAcciones() {
    const accContainer = document.getElementById('tc-acciones');
    if (!accContainer) return;
    accContainer.innerHTML = `
      <button id="tc-btn-importar" class="btn btn-ghost btn-sm" style="display:flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid var(--border-color)">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-sm"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Importar Resumen
      </button>
    `;
    
    document.getElementById('tc-btn-importar')?.addEventListener('click', () => this.#abrirModalImportar());
  }

  #abrirModalImportar() {
    this.#modalImportar.open({
      titulo: 'Importar Resumen de Tarjeta',
      icono: 'cloud_upload',
      size: 'xl',
      body: `
        <div id="tc-import-step-upload" style="display:flex; flex-direction:column; align-items:center; justify-content:center; border:2px dashed var(--border-color); border-radius:12px; padding:3rem 2rem; cursor:pointer; text-align:center; transition:border-color 0.2s; margin-bottom:1.5rem" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border-color)'">
          <div style="background:rgba(59, 130, 246, 0.1); border-radius:50%; padding:12px; margin-bottom:12px; display:inline-flex; align-items:center">
             <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-upload-cloud"><polyline points="16 16 12 12 8 16"></polyline><line x1="12" y1="12" x2="12" y2="21"></line><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"></path><polyline points="16 16 12 12 8 16"></polyline></svg>
          </div>
          <h4 style="margin:0 0 4px 0; font-size:1.1rem; color:var(--texto-1)">Arrastra tu archivo aquí o haz clic para seleccionarlo</h4>
          <p style="margin:0; font-size:0.85rem; color:var(--texto-3)">Soporta formatos PDF o XLSX (.xlsx)</p>
          <input type="file" id="tc-import-file-input" accept=".pdf,.xlsx" style="display:none">
        </div>

        <div id="tc-import-step-parsing" class="hidden" style="text-align:center; padding:3rem 1rem">
          <div class="loader-spinner" style="width:40px; height:40px; margin:0 auto 16px auto; border-top-color:var(--primary)"></div>
          <h4 style="margin:0 0 4px 0; color:var(--texto-1)">Analizando resumen con IA de Gemini...</h4>
          <p style="margin:0; font-size:0.85rem; color:var(--texto-3)">Esto puede demorar unos segundos. Estamos comparando y categorizando tus consumos.</p>
        </div>

        <div id="tc-import-step-results" class="hidden" style="display:flex; flex-direction:column; gap:1.5rem">
          <div class="card" style="padding:1rem; background:var(--bg-2); border:1px solid var(--border-color); border-radius:8px; display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:12px">
            <div>
              <span style="font-size:0.8rem; color:var(--texto-3); display:block">Cierre</span>
              <strong id="tc-res-cierre" style="font-size:0.95rem; color:var(--texto-1)">—</strong>
            </div>
            <div>
              <span style="font-size:0.8rem; color:var(--texto-3); display:block">Vencimiento</span>
              <strong id="tc-res-venc" style="font-size:0.95rem; color:var(--texto-1)">—</strong>
            </div>
            <div>
              <span style="font-size:0.8rem; color:var(--texto-3); display:block">Total Pesos</span>
              <strong id="tc-res-total-ars" style="font-size:0.95rem; color:var(--texto-1)">—</strong>
            </div>
            <div>
              <span style="font-size:0.8rem; color:var(--texto-3); display:block">Total Dólares</span>
              <strong id="tc-res-total-usd" style="font-size:0.95rem; color:var(--texto-1)">—</strong>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px">
            <div class="form-group">
              <label style="font-weight:500; margin-bottom:4px; display:block">Tarjeta Destino</label>
              <select class="input" id="tc-import-card-select"></select>
            </div>
            <div class="form-group">
              <label style="font-weight:500; margin-bottom:4px; display:block">Cuenta de Imputación (Débito)</label>
              <select class="input" id="tc-import-account-select"></select>
            </div>
          </div>

          <div>
            <h4 style="margin:0 0 8px 0; color:var(--texto-1)">Consumos Detectados (<span id="tc-import-count">0</span>)</h4>
            <div style="max-height:300px; overflow-y:auto; border:1px solid var(--border-color); border-radius:8px">
              <table class="table" style="width:100%; border-collapse:collapse; font-size:0.85rem" id="tc-import-table">
                <thead>
                  <tr style="background:var(--bg-2); border-bottom:1px solid var(--border-color); text-align:left">
                    <th style="padding:10px; width:40px; text-align:center"><input type="checkbox" id="tc-import-select-all" checked></th>
                    <th style="padding:10px">Fecha</th>
                    <th style="padding:10px; width:80px; text-align:center">Estado</th>
                    <th style="padding:10px">Descripción</th>
                    <th style="padding:10px; width:120px">Categoría</th>
                    <th style="padding:10px; width:100px">Plan / Tipo</th>
                    <th style="padding:10px; text-align:right">Importe</th>
                  </tr>
                </thead>
                <tbody id="tc-import-table-body"></tbody>
              </table>
            </div>
          </div>
        </div>
      `,
      confirmLabel: 'Importar Consumos',
      cancelLabel: 'Cancelar',
      onConfirm: (modal) => this.#confirmarImportacion(modal)
    });
    
    const btnConfirm = this.#modalImportar.el.querySelector('.modal-confirm');
    if (btnConfirm) btnConfirm.style.display = 'none';

    this.#setupImportEvents();
  }

  #setupImportEvents() {
    const uploadArea = document.getElementById('tc-import-step-upload');
    const fileInput = document.getElementById('tc-import-file-input');

    uploadArea?.addEventListener('click', () => fileInput?.click());

    uploadArea?.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = 'var(--primary)';
    });
    uploadArea?.addEventListener('dragleave', () => {
      uploadArea.style.borderColor = 'var(--border-color)';
    });
    uploadArea?.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        this.#handleImportFile(files[0]);
      }
    });

    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        this.#handleImportFile(file);
      }
    });
  }

  #handleImportFile(file) {
    const validTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (!validTypes.includes(file.type) && !file.name.endsWith('.xlsx')) {
      App.Toast.error('Por favor, selecciona únicamente archivos PDF o XLSX.');
      return;
    }

    document.getElementById('tc-import-step-upload').classList.add('hidden');
    document.getElementById('tc-import-step-parsing').classList.remove('hidden');

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1];
      const mimeType = file.type || (file.name.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');

      try {
        const resp = await App.API.call('parseStatement', { fileBase64: base64, mimeType });
        if (resp && resp.success && resp.payload) {
          this.#showImportResults(resp.payload);
        } else {
          throw new Error(resp?.error || 'Error al analizar el archivo.');
        }
      } catch (err) {
        App.Toast.error(err.message || 'Error al procesar el archivo con Gemini.');
        document.getElementById('tc-import-step-upload').classList.remove('hidden');
        document.getElementById('tc-import-step-parsing').classList.add('hidden');
      }
    };
    reader.onerror = () => {
      App.Toast.error('Error al leer el archivo local.');
      document.getElementById('tc-import-step-upload').classList.remove('hidden');
      document.getElementById('tc-import-step-parsing').classList.add('hidden');
    };
    reader.readAsDataURL(file);
  }

  #showImportResults(payload) {
    document.getElementById('tc-import-step-parsing').classList.add('hidden');
    document.getElementById('tc-import-step-results').classList.remove('hidden');

    const btnConfirm = this.#modalImportar.el.querySelector('.modal-confirm');
    if (btnConfirm) btnConfirm.style.display = '';

    const stInfo = payload.statement_info || {};
    document.getElementById('tc-res-cierre').textContent = App.Utils.formatearFecha(stInfo.fecha_cierre) || '—';
    document.getElementById('tc-res-venc').textContent = App.Utils.formatearFecha(stInfo.fecha_vencimiento) || '—';
    document.getElementById('tc-res-total-ars').textContent = App.Utils.formatearMoneda(stInfo.total_ars) || '—';
    document.getElementById('tc-res-total-usd').textContent = 'USD ' + (stInfo.total_usd?.toLocaleString('es-AR') || '0,00');

    const cardSelect = document.getElementById('tc-import-card-select');
    if (cardSelect) {
      cardSelect.innerHTML = this.#tarjetas.map(t => `
        <option value="${t.id_tarjeta}" ${t.id_tarjeta === payload.card_info?.id_tarjeta || t.ultimos_4_digitos === payload.card_info?.ultimos_4_digitos ? 'selected' : ''}>
          ${App.Utils.escapeHtml(t.nombre)} (${t.ultimos_4_digitos || '—'})
        </option>
      `).join('');
    }

    const accSelect = document.getElementById('tc-import-account-select');
    if (accSelect) {
      accSelect.innerHTML = this.#cuentas.map(c => `
        <option value="${c.id_cuenta_principal}" ${c.id_cuenta_principal === App.Store.cuenta ? 'selected' : ''}>
          ${App.Utils.escapeHtml(c.nombre)}
        </option>
      `).join('');
    }

    const txList = [];
    (payload.new_consumptions || []).forEach(tx => {
      txList.push({ ...tx, id: 'new_' + Math.random().toString(36).substr(2, 9), type: 'NEW' });
    });
    (payload.similar_different || []).forEach(diff => {
      txList.push({
        ...diff.statement_record,
        id: 'diff_' + Math.random().toString(36).substr(2, 9),
        type: 'DIFF',
        dbRecord: diff.db_record
      });
    });

    this.#txListImportar = txList;

    document.getElementById('tc-import-count').textContent = txList.length;

    const tbody = document.getElementById('tc-import-table-body');
    if (!tbody) return;

    if (txList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding:2rem; text-align:center; color:var(--texto-3)">No se detectaron transacciones para registrar.</td></tr>`;
      if (btnConfirm) btnConfirm.style.display = 'none';
      return;
    }

    tbody.innerHTML = txList.map((tx, idx) => {
      const isCuotas = tx.cuota_total && tx.cuota_total > 1;
      const typeSelect = `
        <select class="input" style="padding:4px; font-size:0.8rem; margin:0; width:100%" id="tx-type-${tx.id}">
          <option value="SIMPLE" ${!isCuotas ? 'selected' : ''}>Simple</option>
          <option value="CUOTAS" ${isCuotas ? 'selected' : ''}>Cuotas</option>
        </select>
      `;

      const badgeHtml = tx.type === 'DIFF'
        ? `<span style="display:inline-flex; align-items:center; justify-content:center; padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:600; background-color:rgba(245, 158, 11, 0.15); color:#F59E0B;" title="Reemplazará un consumo existente que tiene diferencias">Modifica</span>`
        : `<span style="display:inline-flex; align-items:center; justify-content:center; padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:600; background-color:rgba(16, 185, 129, 0.15); color:#10B981;" title="Nuevo consumo a registrar">Nuevo</span>`;

      const diffDescHtml = tx.type === 'DIFF' && tx.dbRecord
        ? `<small style="color:var(--texto-3); display:block; margin-top:2px; font-size:0.75rem;">(Reemplaza: "${App.Utils.escapeHtml(tx.dbRecord.descripcion)}" - ${App.Utils.formatearMoneda(tx.dbRecord.importe)})</small>`
        : '';

      return `
        <tr style="border-bottom:1px solid var(--border-color)">
          <td style="padding:10px; text-align:center">
            <input type="checkbox" class="tx-select-row" data-id="${tx.id}" checked>
          </td>
          <td style="padding:10px; white-space:nowrap">${App.Utils.formatearFecha(tx.fecha)}</td>
          <td style="padding:10px; text-align:center">${badgeHtml}</td>
          <td style="padding:10px">
            <input class="input" type="text" style="padding:4px 8px; font-size:0.8rem; margin:0; width:100%" id="tx-desc-${tx.id}" value="${App.Utils.escapeHtml(tx.descripcion)}">
            ${diffDescHtml}
          </td>
          <td style="padding:10px">
            <select class="input" style="padding:4px; font-size:0.8rem; margin:0; width:100%" id="tx-cat-${tx.id}">
              ${this.#categorias
                .filter(c => c.tipo_mov === 'EGRESO' && c.activa)
                .map(c => `<option value="${c.id_categoria}" ${c.id_categoria === tx.id_categoria ? 'selected' : ''}>${App.Utils.escapeHtml(c.nombre)}</option>`)
                .join('')}
            </select>
          </td>
          <td style="padding:10px">
            <div style="display:flex; flex-direction:column; gap:4px">
              ${typeSelect}
              <div id="tx-cuotas-div-${tx.id}" style="display:${isCuotas ? 'flex' : 'none'}; gap:4px; align-items:center">
                <input class="input" type="number" style="padding:4px; font-size:0.8rem; margin:0; width:45px" id="tx-cuota-act-${tx.id}" value="${tx.cuota_actual || 1}" min="1">
                <span style="font-size:0.75rem">/</span>
                <input class="input" type="number" style="padding:4px; font-size:0.8rem; margin:0; width:45px" id="tx-cuota-tot-${tx.id}" value="${tx.cuota_total || 12}" min="2">
              </div>
            </div>
          </td>
          <td style="padding:10px; text-align:right; font-weight:500" class="negativo">${App.Utils.formatearMoneda(tx.importe)}</td>
        </tr>
      `;
    }).join('');

    txList.forEach(tx => {
      const typeSel = document.getElementById(`tx-type-${tx.id}`);
      typeSel?.addEventListener('change', () => {
        const div = document.getElementById(`tx-cuotas-div-${tx.id}`);
        if (div) div.style.display = (typeSel.value === 'CUOTAS') ? 'flex' : 'none';
      });
    });

    const selectAllChk = document.getElementById('tc-import-select-all');
    selectAllChk?.addEventListener('change', () => {
      tbody.querySelectorAll('.tx-select-row').forEach(chk => {
        chk.checked = selectAllChk.checked;
      });
    });
  }

  async #confirmarImportacion(modal) {
    const resultsDiv = document.getElementById('tc-import-step-results');
    if (!resultsDiv || resultsDiv.classList.contains('hidden')) {
      return;
    }

    const tbody = document.getElementById('tc-import-table-body');
    if (!tbody) return;

    const checkedRowChks = tbody.querySelectorAll('.tx-select-row:checked');
    if (checkedRowChks.length === 0) {
      App.Toast.warning('Selecciona al menos un consumo para importar.');
      return;
    }

    const cardSelect = document.getElementById('tc-import-card-select');
    const accSelect = document.getElementById('tc-import-account-select');
    const targetCard = cardSelect ? cardSelect.value : null;
    const targetAccount = accSelect ? accSelect.value : null;

    if (!targetCard || !targetAccount) {
      App.Toast.warning('Selecciona la tarjeta y la cuenta de imputación.');
      return;
    }

    modal.setLoading(true);
    let importedCount = 0;

    try {
      for (const chk of checkedRowChks) {
        const txId = chk.dataset.id;
        const originalTx = this.#txListImportar.find(t => t.id === txId);
        if (!originalTx) continue;

        const desc = document.getElementById(`tx-desc-${txId}`).value;
        const cat = document.getElementById(`tx-cat-${txId}`).value;
        const type = document.getElementById(`tx-type-${txId}`).value;
        const cuotaAct = Number(document.getElementById(`tx-cuota-act-${txId}`).value || 1);
        const cuotaTot = Number(document.getElementById(`tx-cuota-tot-${txId}`).value || 1);

        if (originalTx.type === 'DIFF' && originalTx.dbRecord) {
          const { dbRecord } = originalTx;
          try {
            await App.API.call(this._deleteEndpoint, [
              dbRecord.id_consumo_tarjeta,
              dbRecord.recur_group_id ? 'SERIES' : 'SINGLE',
              dbRecord.recur_group_id || null,
              dbRecord.fecha || null
            ]);
          } catch (delErr) {
            console.warn('Failed to delete old diff record', delErr);
          }
        }

        const payloadData = {
          idCuenta: App.Store.cuenta,
          idTarjeta: targetCard,
          fecha: originalTx.fecha,
          idCategoria: cat,
          descripcion: desc,
          importe: originalTx.importe,
          tipoConsumo: type,
          cuotaActual: cuotaAct,
          cuotaTotal: cuotaTot,
          imputar: true,
          idCuentaImputar: targetAccount
        };

        await App.API.call(this._createEndpoint, payloadData);
        importedCount++;
      }

      App.Toast.success(`Importación finalizada con éxito! Se cargaron ${importedCount} consumos.`);
      App.API.invalidateAll();
      if (App.Events) App.Events.emit('data:changed');
      this.destruir();
      modal.close();
      await this.cargar();
    } catch (err) {
      App.Toast.error(err.message || 'Error al guardar consumos.');
    } finally {
      modal.setLoading(false);
    }
  }
}

// --- REGISTRO ---

App.log('module-tarjetas', 'init', 'TarjetasModule registrado');