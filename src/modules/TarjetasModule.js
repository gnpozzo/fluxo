'use strict';
import Chart from 'chart.js/auto';
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
  #selectedCuentaId = '';
  #txListImportar = [];
  #lastStatementPayload = null;
  #savedViewPosition = null;
  #chartInstance = null;
  #currentView = 'mes';

  preserveViewOnUpdate(id) {
    const scrollEl = document.querySelector('.main-content');
    this.#savedViewPosition = {
      scroll: scrollEl ? scrollEl.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0),
      page: this.#table?.page || 1,
      rowId: id || this.#editData?.id_consumo_tc || this.#editData?.id_consumo_tarjeta || null
    };
  }

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
    const cuenta = App.Store.cuenta;
    const mes = App.Store.mes;
    if (!cuenta || !mes) return;

    if (!window._appTarjetas || window._appTarjetas.length === 0) {
      try {
        const initData = await App.API.call('api_getInitialData');
        if (initData?.tarjetas) window._appTarjetas = initData.tarjetas;
        if (initData?.categorias) window._appCategorias = initData.categorias;
      } catch (e) {
        console.warn('Fallback getInitialData failed in TarjetasModule', e);
      }
    }

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
    this.#categorias = (window._appCategorias && window._appCategorias.length > 0) ? window._appCategorias : this.#categorias;
    if (!this.#cuentas.length)    this.#cuentas    = App.Store.cuentas     || [];

    // Map id_tarjeta based on tarjeta_nombre if missing (e.g. from RPC responses)
    (consumos || []).forEach(c => {
      if (!c.id_tarjeta && c.tarjeta_nombre) {
        const found = this.#tarjetas.find(t => t.nombre.toLowerCase() === c.tarjeta_nombre.toLowerCase());
        if (found) c.id_tarjeta = found.id_tarjeta;
      }
    });

    // Filter consumos to only those from this account's tarjetas
    const validTcIds = new Set(this.#tarjetas.map(t => t.id_tarjeta));
    const filteredConsumos = (consumos || []).filter(c => validTcIds.has(c.id_tarjeta));

    // Recalculate KPIs from filtered data (don't trust backend if RPC leaks cross-account)
    let saldoTotal = 0, incidenciaPersonal = 0, incidenciaFamiliar = 0;
    filteredConsumos.forEach(c => {
      if (c.moneda === 'USD') return;
      const imp = Number(c.importe || 0);
      saldoTotal += imp;
      if (c.imputado && c.cuenta_imputada_nombre !== 'Propios') {
        incidenciaFamiliar += imp;
      } else {
        incidenciaPersonal += imp;
      }
    });

    // Si hay tarjetas con total_resumen_ars cargado para este mes, usar el total oficial del resumen
    let totalResumenArs = 0;
    this.#tarjetas.forEach(tc => {
      const isDueInMonth = (tc.fecha_vencimiento_actual && tc.fecha_vencimiento_actual.substring(0, 7) === App.Store.mes) ||
                           (tc.fecha_cierre_actual && tc.fecha_cierre_actual.substring(0, 7) === App.Store.mes);
      if (isDueInMonth && Number(tc.total_resumen_ars || 0) > 0) {
        totalResumenArs += Number(tc.total_resumen_ars);
      }
    });

    if (totalResumenArs > 0) {
      saldoTotal = totalResumenArs;
      incidenciaPersonal = totalResumenArs - incidenciaFamiliar;
    }

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

    this.#renderToolbarFiltros();
    this.#filterConsumos();
    App.log('TarjetasModule', '_render', `${filteredConsumos.length} consumos (filtered from ${(consumos || []).length})`);
  }

  _renderProyecciones(data) {
     const wrap = document.getElementById('tc-proy-wrap');
     if (!wrap) return;
     if (!data.proyeccion || data.proyeccion.length === 0) {
        wrap.innerHTML = `<div style="padding:2.5rem 1.5rem;text-align:center;color:var(--texto-3);font-size:0.875rem;">No hay proyecciones futuras para mostrar.</div>`;
        return;
     }

     const rows = data.proyeccion.map((p, idx) => {
        const imp = p.impuestos || {};
        const hasTaxes = (imp.total_impuestos || 0) > 0;
        const taxDetailId = `tc-proy-tax-${idx}`;

        return `
        <div class="tc-proy-row" style="border-bottom:1px solid var(--borde); font-size:0.875rem; transition:background-color 0.15s ease;">
           <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 18px; flex-wrap:wrap; gap:8px;">
              <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                 <span style="font-weight:600; color:var(--texto); font-size:0.875rem; min-width:130px;">${App.Utils.escapeHtml(App.Utils.formatearMes(p.mes))}</span>
                 <span style="font-size:0.8rem; color:var(--texto-2);">Consumos: <strong>${App.Utils.formatearMoneda(p.subtotal_consumos !== undefined ? p.subtotal_consumos : p.total)}</strong></span>
                 ${hasTaxes ? `
                 <button type="button" class="tc-proy-tax-badge" onclick="const el = document.getElementById('${taxDetailId}'); el?.classList.toggle('open'); this.classList.toggle('active');" title="Ver desglose de impuestos estimados">
                    <span>🏛️ + Impuestos: ${App.Utils.formatearMoneda(imp.total_impuestos)}</span>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                 </button>
                 ` : ''}
              </div>
              <div style="display:flex; align-items:center; gap:10px;">
                 <span style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--texto-3);">Total Resumen</span>
                 <span class="negativo" style="font-weight:700; font-size:0.95rem;">${App.Utils.formatearMoneda(p.total)}</span>
              </div>
           </div>

           ${hasTaxes ? `
           <div class="tc-proy-tax-detail" id="${taxDetailId}">
              <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:10px; padding:10px 18px 14px 18px; background:var(--bg-2); border-top:1px dashed var(--borde-1); font-size:0.8rem;">
                 <div><span style="color:var(--texto-3);">Sellos Prov. (0,10%):</span> <strong style="color:var(--texto);">${App.Utils.formatearMoneda(imp.sellos || 0)}</strong></div>
                 ${imp.iva_digital > 0 ? `<div><span style="color:var(--texto-3);">IVA Serv. Digitales (21%):</span> <strong style="color:var(--texto);">${App.Utils.formatearMoneda(imp.iva_digital)}</strong></div>` : ''}
                 ${imp.ganancias_rg5617 > 0 ? `<div><span style="color:var(--texto-3);">Percep. Ganancias (30%):</span> <strong style="color:var(--texto);">${App.Utils.formatearMoneda(imp.ganancias_rg5617)}</strong></div>` : ''}
                 ${imp.iibb_santafe > 0 ? `<div><span style="color:var(--texto-3);">Percep. IIBB (3%):</span> <strong style="color:var(--texto);">${App.Utils.formatearMoneda(imp.iibb_santafe)}</strong></div>` : ''}
              </div>
           </div>
           ` : ''}
        </div>
        `;
     }).join('');

     wrap.innerHTML = `
        <div style="padding:14px 18px; border-bottom:1px solid var(--borde); background:var(--fondo); display:flex; align-items:center; justify-content:space-between; gap:var(--space-3);">
          <div>
            <h4 style="margin:0 0 2px 0; color:var(--texto); font-size:0.82rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">Proyección a 12 meses</h4>
            <p style="margin:0; color:var(--texto-2); font-size:0.8rem;">Incluye cálculo dinámico de Sellos (0,10%) y percepciones sobre servicios digitales (IVA 21%, RG 5617 30%, IIBB 3%).</p>
          </div>
          ${App.Icons.get('trending_up', 'icon-md', { style: 'color:var(--kpi-amber);' })}
        </div>
        <div style="background:var(--superficie);">${rows}</div>
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

      <div class="section-header" style="margin-bottom:var(--space-3);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div class="acciones-container" id="tc-acciones"></div>
        <div class="selector-vista-container">
          <button id="tc-btn-mes" class="btn btn-primary btn-vista active">Consumos del Mes</button>
          <button id="tc-btn-proy" class="btn btn-ghost btn-vista">Proyecciones</button>
          <button id="tc-btn-graficos" class="btn btn-ghost btn-vista">Gráficos</button>
          <button id="tc-btn-pagar-resumen" class="btn btn-secondary btn-sm" style="margin-left:8px;display:inline-flex;align-items:center;gap:6px;" title="Liquidar resumen y marcar consumos como saldados">💳 Pagar Resumen</button>
        </div>
      </div>
      <div class="table-card" id="tc-tabla-wrap"></div>
      <div id="tc-taxes-wrap" style="margin-top:var(--space-3)"></div>
      <div class="table-card hidden" id="tc-proy-wrap">
         <div style="padding:1rem;color:var(--texto-3);text-align:center">Cargando proyecciones...</div>
      </div>
      <div class="table-card hidden" id="tc-graficos-wrap"></div>
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
          {
            key: 'fecha',
            label: 'Fecha',
            sortable: true,
            sortValue: (r) => new Date(r.fecha?.value || r.fecha || '2000-01-01').getTime(),
            render: (r) => App.Utils.formatearFecha(r.fecha?.value || r.fecha)
          },
          {
            key: 'tarjeta_nombre',
            label: 'Tarjeta',
            sortable: true,
            sortValue: (r) => r.tarjeta_nombre || '',
            render: (r) => App.Utils.escapeHtml(r.tarjeta_nombre || '—')
          },
          {
            key: 'categoria_nombre',
            label: 'Categoría',
            sortable: true,
            sortValue: (r) => r.categoria_nombre || '',
            render: (r) => App.Utils.escapeHtml(r.categoria_nombre || 'General')
          },
          {
            key: 'descripcion',
            label: 'Descripción',
            sortable: true,
            searchable: true,
            sortValue: (r) => r.descripcion || '',
            searchValue: (r) => `${r.descripcion || ''} ${r.categoria_nombre || ''} ${r.tarjeta_nombre || ''} ${r.cuenta_imputada_nombre || ''}`,
            render: (r) => this.#renderDescripcion(r)
          },
          {
            key: 'importe',
            label: 'Importe',
            sortable: true,
            align: 'right',
            sortValue: (r) => Number(r.importe || 0),
            render: (r) => `<span class="negativo">${r.moneda === 'USD' ? 'USD ' + Number(r.importe || 0).toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : App.Utils.formatearMoneda(r.importe)}</span>`
          },
          {
            key: 'imputacion',
            label: 'Imputación',
            sortable: true,
            sortValue: (r) => !r.imputado ? 'AAA_SIN_IMPUTAR' : (r.es_incidencia_externa ? (r.cuenta_imputada_nombre || 'Externa') : 'Personal'),
            render: (r) => {
              if (!r.imputado) return `<span class="badge badge-neutro">Sin Imputar</span>`;
              if (r.es_incidencia_externa) {
                return `<span class="badge badge-recur" title="Imputado a cuenta ${App.Utils.escapeHtml(r.cuenta_imputada_nombre || '')}">🏛️ ${App.Utils.escapeHtml(r.cuenta_imputada_nombre || 'Externa')}</span>`;
              }
              return `<span class="badge badge-tc">Personal</span>`;
            }
          },
          {
            key: 'pagado',
            label: 'Estado Pago',
            sortable: true,
            align: 'center',
            sortValue: (r) => r.pagado ? 1 : 0,
            render: (r) => {
              const isPaid = !!r.pagado;
              return `
                <button type="button" class="btn-toggle-pago ${isPaid ? 'pago-saldado' : 'pago-pendiente'}"
                        data-toggle-pago-tc="${r.id_consumo_tc || r.id_consumo_tarjeta}"
                        title="${isPaid ? 'Saldado (Clic para marcar como pendiente)' : 'Pendiente (Clic para marcar como saldado)'}">
                  ${isPaid ? '✓ Saldado' : '⏳ Pendiente'}
                </button>
              `;
            }
          }
        ],
        emptyMsg          : 'No hay consumos para este período.',
        searchable        : true,
        searchPlaceholder : 'Buscar consumo o comercio...',
        paginated         : true,
        pageSize          : 25,
        onRowClick        : ({ row }) => this.#abrirModalDetalle(row)
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
    const scrollEl = document.querySelector('.main-content');
    this.#savedViewPosition = {
      scroll: scrollEl ? scrollEl.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0),
      page: this.#table?.page || 1,
      rowId: row.id_consumo_tc || row.id_consumo_tarjeta
    };
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

    const categoriesList = (window._appCategorias && window._appCategorias.length > 0) ? window._appCategorias : this.#categorias;
    const optsC = categoriesList
      .filter(c => c.tipo_mov === 'EGRESO' && c.activa)
      .map(c => `<option value="${c.id_categoria}" ${data?.id_categoria === c.id_categoria ? 'selected' : ''}>
        ${App.Utils.escapeHtml(c.nombre)}
      </option>`).join('');

    const rawFecha = App.Utils.toInputDate(data?.fecha?.value || data?.fecha);

    const tipoConsumo = data?.tipo_consumo || (data?.recur_group_id?.startsWith('REC_') ? 'RECURRENTE' : (Number(data?.cuota_total) > 1 ? 'CUOTAS' : 'COMUN'));

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

        <div class="form-group full-width">
          <label class="form-switch">
            <input type="checkbox" class="toggle-switch" name="imputar" id="tc-chk-imputar" ${data ? (data.imputado !== false ? 'checked' : '') : 'checked'}>
            <span>Imputar a cuenta de gastos</span>
          </label>
        </div>
        <div id="tc-imputar-opts" class="form-group full-width ${data && data.imputado === false ? 'hidden' : ''}">
          <label>Cuenta destino</label>
          <select class="input" name="cuenta_imputar">
            ${this.#cuentas
              .map(c => `<option value="${c.id_cuenta_principal}" ${(data?.id_cuenta_imputada || App.Store.cuenta) === c.id_cuenta_principal ? 'selected' : ''}>${App.Utils.escapeHtml(c.nombre)}</option>`)
              .join('')}
          </select>
        </div>

        ${!data ? `
        <div class="form-group full-width">
          <label class="form-switch">
            <input type="checkbox" class="toggle-switch" name="compartir" id="tc-chk-compartir">
            <span>Compartir gasto</span>
          </label>
        </div>
        <div id="tc-compartir-opts" class="form-group full-width hidden">
           <label>Contacto pagador alternativo</label>
           <p style="font-size:0.8rem;color:var(--texto-3);margin-top:0">Se creará automáticamente en Gastos Compartidos. Cargas qué % asumes vos del gasto.</p>
           <label>Mi porcentaje asumido (%)</label>
           <input class="input" type="number" name="compartir_porcentaje" min="1" max="99" value="50">
        </div>` : ''}

        ${data && (data.recur_group_id || tipoConsumo === 'CUOTAS' || tipoConsumo === 'RECURRENTE') ? `
        <div class="form-group full-width" style="background:var(--bg-2);padding:10px 14px;border-radius:var(--radius-md);margin-top:6px;border:1px solid var(--borde-1);">
          <label style="font-weight:600;font-size:0.85rem;display:block;margin-bottom:6px;color:var(--texto-1)">Alcance de la modificación</label>
          <div style="display:flex;gap:16px;font-size:0.85rem;">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="radio" name="update_scope" value="SERIES" checked> A esta y cuotas/meses futuros
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="radio" name="update_scope" value="SINGLE"> Solo a este mes
            </label>
          </div>
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
    const chkComp = document.getElementById('tc-chk-compartir');
    chkComp?.addEventListener('change', () => {
      document.getElementById('tc-compartir-opts')?.classList.toggle('hidden', !chkComp.checked);
    });
  }

  // --- SECCIÓN 5: CRUD ---

  async #guardar(modal) {
    const form = modal.getForm();
    if (!form) return;
    const fd = new FormData(form);
    const d  = {};
    fd.forEach((v, k) => { d[k] = v; });

    const cleanImporte = Number(String(d.importe || '').replace(',', '.'));
    if (!d.fecha || !d.id_tarjeta || !d.id_categoria || !d.descripcion || isNaN(cleanImporte) || cleanImporte <= 0) {
      App.Toast.warning('Completá todos los campos obligatorios.');
      return;
    }

    const payload = {
      idCuenta    : App.Store.cuenta,
      idTarjeta   : d.id_tarjeta,
      fecha       : App.Utils.toInputDate(d.fecha),
      idCategoria : d.id_categoria,
      descripcion : d.descripcion,
      importe     : cleanImporte,
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
            fecha: App.Utils.toInputDate(d.fecha),
            tipo: d.tipo_consumo || 'COMUN',
            descripcion: d.descripcion + ' (Tarjeta)',
            importe: cleanImporte,
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
        const reqScope = d.update_scope || (this.#editData.recur_group_id ? 'SERIES' : 'SINGLE');
        const req = {
          data    : payload,
          original: {
            consumoId   : this.#editData.id_consumo_tc || this.#editData.id_consumo_tarjeta,
            recurGroupId: this.#editData.recur_group_id || null,
            fecha       : App.Utils.toInputDate(this.#editData.fecha?.value || this.#editData.fecha)
          },
          scope: reqScope
        };
        await this._handleUpdate(this.#editData.id_consumo_tc || this.#editData.id_consumo_tarjeta, req, modal, reqScope);
      }
    } catch (_) {
      modal.setLoading(false);
    }
  }

  async #eliminar(row) {
    const scrollEl = document.querySelector('.main-content');
    this.#savedViewPosition = {
      scroll: scrollEl ? scrollEl.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0),
      page: this.#table?.page || 1,
      rowId: null
    };
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
          this.#currentView = 'mes';
          const btnMes = document.getElementById('tc-btn-mes');
          const btnProy = document.getElementById('tc-btn-proy');
          const btnGraf = document.getElementById('tc-btn-graficos');
          btnMes?.classList.add('active', 'btn-primary');
          btnMes?.classList.remove('btn-ghost');
          btnProy?.classList.remove('active', 'btn-primary');
          btnProy?.classList.add('btn-ghost');
          btnGraf?.classList.remove('active', 'btn-primary');
          btnGraf?.classList.add('btn-ghost');
          document.getElementById('tc-tabla-wrap')?.classList.remove('hidden');
          document.getElementById('tc-taxes-wrap')?.classList.remove('hidden');
          document.getElementById('tc-proy-wrap')?.classList.add('hidden');
          document.getElementById('tc-graficos-wrap')?.classList.add('hidden');
        } else if (btn.id === 'tc-btn-proy') {
          this.#currentView = 'proy';
          const btnMes = document.getElementById('tc-btn-mes');
          const btnProy = document.getElementById('tc-btn-proy');
          const btnGraf = document.getElementById('tc-btn-graficos');
          btnProy?.classList.add('active', 'btn-primary');
          btnProy?.classList.remove('btn-ghost');
          btnMes?.classList.remove('active', 'btn-primary');
          btnMes?.classList.add('btn-ghost');
          btnGraf?.classList.remove('active', 'btn-primary');
          btnGraf?.classList.add('btn-ghost');
          document.getElementById('tc-proy-wrap')?.classList.remove('hidden');
          document.getElementById('tc-tabla-wrap')?.classList.add('hidden');
          document.getElementById('tc-taxes-wrap')?.classList.add('hidden');
          document.getElementById('tc-graficos-wrap')?.classList.add('hidden');
        } else if (btn.id === 'tc-btn-graficos') {
          this.#currentView = 'graficos';
          const btnMes = document.getElementById('tc-btn-mes');
          const btnProy = document.getElementById('tc-btn-proy');
          const btnGraf = document.getElementById('tc-btn-graficos');
          btnGraf?.classList.add('active', 'btn-primary');
          btnGraf?.classList.remove('btn-ghost');
          btnMes?.classList.remove('active', 'btn-primary');
          btnMes?.classList.add('btn-ghost');
          btnProy?.classList.remove('active', 'btn-primary');
          btnProy?.classList.add('btn-ghost');
          document.getElementById('tc-graficos-wrap')?.classList.remove('hidden');
          document.getElementById('tc-tabla-wrap')?.classList.add('hidden');
          document.getElementById('tc-taxes-wrap')?.classList.add('hidden');
          document.getElementById('tc-proy-wrap')?.classList.add('hidden');
          this.#renderGraficos();
        } else if (btn.id === 'tc-btn-pagar-resumen') {
          this.#confirmarPagarResumen();
        } else if (btn.dataset.togglePagoTc) {
          e.stopPropagation();
          const id = btn.dataset.togglePagoTc;
          if (id) this.#togglePagoTc(id, btn);
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
              ? (row.es_incidencia_externa
                  ? `<span class="badge badge-recur">🏛️ ${App.Utils.escapeHtml(row.cuenta_imputada_nombre || 'Externa')}</span>`
                  : '<span class="badge badge-tc">Personal</span>')
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
    if (row.imputado) {
      if (row.es_incidencia_externa) {
        badges.push(`<span class="badge badge-recur">🏛️ ${App.Utils.escapeHtml(row.cuenta_imputada_nombre || 'Externa')}</span>`);
      } else {
        badges.push('<span class="badge badge-tc">Personal</span>');
      }
    }
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
        return `<span style="font-family:'Inter', sans-serif; font-weight:900; font-style:italic; font-size:1.15rem; letter-spacing:1.5px; color:#ffffff; line-height:1; text-shadow:0 1px 2px rgba(0,0,0,0.3);">VISA</span>`;
      }
      if (name.includes('AMEX') || name.includes('AMERICAN')) {
        return `<div style="font-family:'Inter', sans-serif;font-weight:900;font-style:italic;font-size:0.75rem;letter-spacing:0.5px;color:#0070d2;background:#ffffff;padding:2px 5px;border-radius:2px;line-height:1;display:inline-block;box-shadow: 0 1px 3px rgba(0,0,0,0.2);">AMEX</div>`;
      }
      return `<svg viewBox="0 0 32 20" width="28" height="18" style="display:block;"><circle cx="10" cy="10" r="10" fill="#EB001B"/><circle cx="22" cy="10" r="10" fill="#F79E1B" opacity="0.85"/></svg>`;
    };

    const contactlessWave = `<svg class="tc-card-contactless" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="display:block;">
      <path d="M5 8a9 9 0 0 1 0 8" opacity="0.3"/>
      <path d="M8 6a12 12 0 0 1 0 12" opacity="0.5"/>
      <path d="M11 4a15 15 0 0 1 0 16" opacity="0.7"/>
      <path d="M14 2a18 18 0 0 1 0 20"/>
    </svg>`;

    const cardChip = `<div class="tc-card-chip"><div class="tc-card-chip-inner"></div></div>`;

    // Calculate subtotal per card (bimonetario)
    const subtotalsArs = {};
    const subtotalsUsd = {};
    this.#allConsumos.forEach(c => {
      const tid = c.id_tarjeta;
      if (c.moneda === 'USD') {
        subtotalsUsd[tid] = (subtotalsUsd[tid] || 0) + Number(c.importe || 0);
      } else {
        subtotalsArs[tid] = (subtotalsArs[tid] || 0) + Number(c.importe || 0);
      }
    });

    // "Todas" / Consolidado premium card
    const isAllActive = !this.#selectedTcId;
    let totalConsolArs = 0;
    let totalConsolUsd = 0;
    this.#tarjetas.forEach(tc => {
      const subArs = subtotalsArs[tc.id_tarjeta] || 0;
      const subUsd = subtotalsUsd[tc.id_tarjeta] || 0;
      const isDueInMonth = (tc.fecha_vencimiento_actual && tc.fecha_vencimiento_actual.substring(0, 7) === App.Store.mes) ||
                           (tc.fecha_cierre_actual && tc.fecha_cierre_actual.substring(0, 7) === App.Store.mes);
      totalConsolArs += (isDueInMonth && Number(tc.total_resumen_ars || 0) > 0) ? Number(tc.total_resumen_ars) : subArs;
      totalConsolUsd += (isDueInMonth && Number(tc.total_resumen_usd || 0) > 0) ? Number(tc.total_resumen_usd) : subUsd;
    });

    const consolUsdHtml = totalConsolUsd > 0
      ? `<span style="display:block; font-size:0.78rem; font-weight:600; opacity:0.9; margin-top:2px;">+ USD ${totalConsolUsd.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`
      : '';

    const allPill = `<button class="tc-card-pill ${isAllActive ? 'active' : ''}"
      data-tc-filter="all"
      style="background: linear-gradient(135deg, #1D195D 0%, #0f0d36 100%)">
      <div class="tc-card-shimmer"></div>
      
      <div class="tc-card-row tc-card-top">
        <span class="tc-card-issuer-name">CONSOLIDADO</span>
        <div style="width:28px; height:18px;"></div>
      </div>
      
      <div class="tc-card-row tc-card-middle">
        ${cardChip}
        ${contactlessWave}
      </div>

      <div class="tc-card-row tc-card-bottom">
        <div class="tc-card-bottom-left">
          <span class="tc-card-number">**** ALL</span>
          <span class="tc-card-amount">${App.Utils.formatearMoneda(totalConsolArs)}</span>
          ${consolUsdHtml}
        </div>
        <div class="tc-card-bottom-right">
          <div style="width:28px; height:18px;"></div>
        </div>
      </div>
    </button>`;

    const pills = this.#tarjetas.map(tc => {
      const isActive = this.#selectedTcId === tc.id_tarjeta;
      const last4 = tc.ultimos_4_digitos || tc.ultimos_4 || '••••';
      const subArs = subtotalsArs[tc.id_tarjeta] || 0;
      const subUsd = subtotalsUsd[tc.id_tarjeta] || 0;

      const isDueInMonth = (tc.fecha_vencimiento_actual && tc.fecha_vencimiento_actual.substring(0, 7) === App.Store.mes) ||
                           (tc.fecha_cierre_actual && tc.fecha_cierre_actual.substring(0, 7) === App.Store.mes);

      const displayArs = (isDueInMonth && Number(tc.total_resumen_ars || 0) > 0) ? Number(tc.total_resumen_ars) : (subArs > 0 ? subArs : 0);
      const displayUsd = (isDueInMonth && Number(tc.total_resumen_usd || 0) > 0) ? Number(tc.total_resumen_usd) : (subUsd > 0 ? subUsd : 0);
      
      const cardIssuer = ((tc.banco || tc.nombre || '').split(' ')[0] || 'BANCO').toUpperCase();
      const brandLogo = getBrandLogoHtml(tc.red || tc.marca || tc.nombre);
      
      const usdHtml = displayUsd > 0
        ? `<span style="display:block; font-size:0.78rem; font-weight:600; opacity:0.9; margin-top:2px;">+ USD ${displayUsd.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`
        : '';
      
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
          <div style="width:28px; height:18px;"></div>
        </div>
        
        <div class="tc-card-row tc-card-middle">
          ${cardChip}
          ${contactlessWave}
        </div>

        <div class="tc-card-row tc-card-bottom">
          <div class="tc-card-bottom-left">
            <span class="tc-card-number">**** ${last4}</span>
            <span class="tc-card-amount">${App.Utils.formatearMoneda(displayArs)}</span>
            ${usdHtml}
          </div>
          <div class="tc-card-bottom-right">
            ${brandLogo}
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
        this.#filterConsumos();
      });
    });

    this.#updateSliderArrows();
  }

  #isTaxConsumo(c) {
    const desc = (c.descripcion || '').toLowerCase();
    return (
      desc.includes('impuesto de sellos') ||
      desc.includes('sellos') ||
      desc.includes('iibb percep') ||
      desc.includes('iva rg 4240') ||
      desc.includes('db.rg 5617') ||
      desc.includes('percep-sant') ||
      desc.startsWith('db.rg') ||
      desc.startsWith('iva rg') ||
      desc.startsWith('iibb') ||
      desc.startsWith('impuesto')
    );
  }

  #filterConsumos() {
    let filtered = this.#allConsumos || [];
    if (this.#selectedTcId) {
      filtered = filtered.filter(c => c.id_tarjeta === this.#selectedTcId);
    }
    if (this.#selectedCuentaId) {
      if (this.#selectedCuentaId === 'sin_imputar') {
        filtered = filtered.filter(c => !c.imputado);
      } else if (this.#selectedCuentaId === 'personal') {
        filtered = filtered.filter(c => c.imputado && (!c.es_incidencia_externa || c.id_cuenta_imputada === App.Store.cuenta));
      } else {
        filtered = filtered.filter(c => c.id_cuenta_imputada === this.#selectedCuentaId);
      }
    }

    // Separar impuestos de la liquidación de los consumos habituales
    const regularConsumos = filtered.filter(c => !this.#isTaxConsumo(c));
    const taxConsumos = filtered.filter(c => this.#isTaxConsumo(c));

    const targetPage = this.#savedViewPosition?.page;
    if (targetPage) {
      this.#table?.load(regularConsumos, { page: targetPage });
    } else {
      this.#table?.load(regularConsumos);
    }
    this.#renderImpuestosAccordion(taxConsumos);

    // Restaurar ubicación de pantalla y resaltar consumo modificado
    if (this.#savedViewPosition) {
      const { scroll, rowId } = this.#savedViewPosition;
      this.#savedViewPosition = null;
      const restore = () => {
        const sc = document.querySelector('.main-content');
        if (sc && scroll > 0) sc.scrollTop = scroll;
        if (window.scrollY > 0 || scroll > 0) window.scrollTo(0, scroll);
        if (rowId) {
          const rowEl = document.querySelector(`tr[data-id="${rowId}"]`);
          if (rowEl) {
            rowEl.classList.add('dt-row-highlight');
            setTimeout(() => rowEl.classList.remove('dt-row-highlight'), 2500);
          }
        }
      };
      restore();
      requestAnimationFrame(restore);
      setTimeout(restore, 50);
      setTimeout(restore, 150);
    }
  }

  #renderImpuestosAccordion(taxes) {
    const wrap = document.getElementById('tc-taxes-wrap');
    if (!wrap) return;
    if (!taxes || taxes.length === 0) {
      wrap.innerHTML = '';
      return;
    }

    const totalImpuestos = taxes.reduce((acc, t) => acc + Number(t.importe || 0), 0);
    wrap.innerHTML = `
      <div class="tc-taxes-accordion" id="tc-taxes-accordion">
        <div class="tc-taxes-header" id="tc-taxes-toggle" role="button" tabindex="0" title="Ver desglose detallado de impuestos">
          <div class="tc-taxes-header-left">
            <span class="tc-taxes-icon">🏛️</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="tc-taxes-title">Impuestos y Percepciones del Resumen</span>
              <span class="tc-taxes-badge">${taxes.length} ${taxes.length === 1 ? 'ítem' : 'ítems'}</span>
            </div>
          </div>
          <div class="tc-taxes-header-right">
            <span class="tc-taxes-total-label">Total Impuestos:</span>
            <span class="tc-taxes-total-val negativo">${App.Utils.formatearMoneda(totalImpuestos)}</span>
            <svg class="tc-taxes-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="tc-taxes-body">
          <div class="table-responsive">
            <table class="table" style="margin:0;width:100%;font-family:inherit;">
              <thead>
                <tr style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--texto-3);border-bottom:1px solid var(--borde);">
                  <th style="padding:10px 16px;text-align:left;">Fecha</th>
                  <th style="padding:10px 16px;text-align:left;">Concepto Impositivo</th>
                  <th style="padding:10px 16px;text-align:right;">Importe</th>
                </tr>
              </thead>
              <tbody>
                ${taxes.map(t => `
                  <tr style="border-bottom:1px solid var(--borde-1);">
                    <td style="padding:10px 16px;font-size:0.82rem;color:var(--texto-2);">${App.Utils.formatearFecha(t.fecha)}</td>
                    <td style="padding:10px 16px;font-size:0.84rem;font-weight:500;color:var(--texto);">${App.Utils.escapeHtml(t.descripcion)}</td>
                    <td style="padding:10px 16px;font-size:0.84rem;font-weight:600;text-align:right;color:var(--rojo);">${App.Utils.formatearMoneda(t.importe)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const toggle = document.getElementById('tc-taxes-toggle');
    const accordion = document.getElementById('tc-taxes-accordion');
    if (toggle && accordion) {
      toggle.addEventListener('click', () => {
        accordion.classList.toggle('open');
      });
    }
  }

  #renderGraficos() {
    const wrap = document.getElementById('tc-graficos-wrap');
    if (!wrap) return;

    let filtered = (this.#allConsumos || []).filter(c => !this.#isTaxConsumo(c));
    if (this.#selectedTcId) {
      filtered = filtered.filter(c => c.id_tarjeta === this.#selectedTcId);
    }
    if (this.#selectedCuentaId) {
      if (this.#selectedCuentaId === 'sin_imputar') {
        filtered = filtered.filter(c => !c.imputado);
      } else if (this.#selectedCuentaId === 'personal') {
        filtered = filtered.filter(c => c.imputado && (!c.es_incidencia_externa || c.id_cuenta_imputada === App.Store.cuenta));
      } else {
        filtered = filtered.filter(c => c.id_cuenta_imputada === this.#selectedCuentaId);
      }
    }

    const totalConsumos = filtered.reduce((acc, c) => acc + (c.moneda === 'USD' ? 0 : Number(c.importe || 0)), 0);

    if (filtered.length === 0 || totalConsumos <= 0) {
      wrap.innerHTML = `<div style="padding:2.5rem 1.5rem;text-align:center;color:var(--texto-3);font-size:0.875rem;">No hay consumos en este período para graficar.</div>`;
      return;
    }

    const catMap = {};
    filtered.forEach(c => {
      if (c.moneda === 'USD') return;
      const cat = c.categoria_nombre || 'General';
      const imp = Number(c.importe || 0);
      if (!catMap[cat]) catMap[cat] = { total: 0, count: 0, personal: 0, externa: 0 };
      catMap[cat].total += imp;
      catMap[cat].count += 1;
      if (c.imputado && c.es_incidencia_externa) catMap[cat].externa += imp;
      else catMap[cat].personal += imp;
    });

    const sortedCats = Object.entries(catMap)
      .map(([name, data]) => ({
        name,
        total: data.total,
        count: data.count,
        personal: data.personal,
        externa: data.externa,
        pct: ((data.total / totalConsumos) * 100)
      }))
      .sort((a, b) => b.total - a.total);

    const palette = [
      '#4361EE', '#7209B7', '#F72585', '#4CC9F0', '#2EC4B6',
      '#FF9F1C', '#E71D36', '#06D6A0', '#118AB2', '#8338EC'
    ];

    const labels = sortedCats.map(c => c.name);
    const dataValues = sortedCats.map(c => Math.round(c.total));
    const bgColors = sortedCats.map((_, i) => palette[i % palette.length]);

    const activeCardName = this.#selectedTcId
      ? (this.#tarjetas.find(t => t.id_tarjeta === this.#selectedTcId)?.nombre || 'Tarjeta Seleccionada')
      : 'Consolidado Todas las Tarjetas';

    wrap.innerHTML = `
      <div style="padding:20px 24px;border-bottom:1px solid var(--borde);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div>
          <h3 style="margin:0 0 4px 0;font-size:1.05rem;color:var(--texto);font-weight:700;">Distribución de Consumos — ${App.Utils.escapeHtml(activeCardName)}</h3>
          <p style="margin:0;font-size:0.82rem;color:var(--texto-2);">
            Desglose de consumos del resumen por categoría e incidencia personal vs externa.
          </p>
        </div>
        <div>
          <span style="font-size:0.8rem;background:var(--primary-tint);color:var(--primary);padding:4px 10px;border-radius:var(--r-full);font-weight:600;">
            Total: ${App.Utils.formatearMoneda(totalConsumos)}
          </span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:24px;padding:24px;align-items:center;">
        <div style="position:relative;max-width:360px;margin:0 auto;width:100%;height:320px;display:flex;align-items:center;justify-content:center;">
          <canvas id="tc-chart-canvas"></canvas>
        </div>

        <div style="display:flex;flex-direction:column;gap:12px;max-height:420px;overflow-y:auto;padding-right:6px;">
          ${sortedCats.map((cat, idx) => {
            const color = bgColors[idx];
            return `
              <div style="background:var(--superficie);border:1px solid var(--borde);border-radius:var(--r);padding:10px 14px;display:flex;flex-direction:column;gap:6px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;"></span>
                    <strong style="color:var(--texto);font-size:0.85rem;">${App.Utils.escapeHtml(cat.name)}</strong>
                    <span style="font-size:0.75rem;color:var(--texto-3);">(${cat.count})</span>
                  </div>
                  <strong class="negativo" style="font-size:0.9rem;">${App.Utils.formatearMoneda(cat.total)}</strong>
                </div>

                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:0.78rem;">
                  <div style="flex:1;display:flex;align-items:center;gap:6px;">
                    <div style="flex:1;height:6px;background:var(--bg-2);border-radius:3px;overflow:hidden;">
                      <div style="width:${cat.pct.toFixed(1)}%;height:100%;background:${color};"></div>
                    </div>
                    <strong style="min-width:42px;text-align:right;color:var(--texto);">${cat.pct.toFixed(1)}%</strong>
                  </div>
                  ${cat.externa > 0 ? `
                    <span style="font-size:0.72rem;color:var(--kpi-amber);background:var(--bg-2);padding:2px 6px;border-radius:4px;" title="Incidencia externa">
                      🏛️ ${App.Utils.formatearMoneda(cat.externa)}
                    </span>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    const canvas = document.getElementById('tc-chart-canvas');
    if (canvas) {
      this.#chartInstance?.destroy();
      const ctx = canvas.getContext('2d');
      this.#chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [{
            data: dataValues,
            backgroundColor: bgColors,
            borderColor: 'var(--superficie)',
            borderWidth: 2,
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const val = context.parsed || 0;
                  const pct = ((val / totalConsumos) * 100).toFixed(1);
                  return ` ${context.label}: $ ${val.toLocaleString('es-AR')} (${pct}%)`;
                }
              }
            }
          }
        }
      });
    }
  }

  async #confirmarPagarResumen() {
    const activeCard = this.#selectedTcId
      ? this.#tarjetas.find(t => t.id_tarjeta === this.#selectedTcId)
      : null;

    const nombreTc = activeCard?.nombre || 'todas las tarjetas (Consolidado)';
    const consumosAPagar = this.#selectedTcId
      ? (this.#allConsumos || []).filter(c => c.id_tarjeta === this.#selectedTcId)
      : (this.#allConsumos || []);

    const totalAPagar = consumosAPagar.reduce((acc, c) => acc + (c.moneda === 'USD' ? 0 : Number(c.importe || 0)), 0);

    const modal = new App.Modal('modal-tc-pagar-resumen');
    modal.open({
      titulo: 'Confirmar Pago de Resumen',
      icono: 'credit_card',
      body: `
        <div style="text-align:center;padding:12px 0;">
          <p style="margin:0 0 10px 0;font-size:0.95rem;color:var(--texto);">
            ¿Confirmás el pago del resumen de <strong>${App.Utils.escapeHtml(nombreTc)}</strong>?
          </p>
          <div style="font-size:1.4rem;font-weight:800;color:var(--verde);margin-bottom:12px;">
            ${App.Utils.formatearMoneda(totalAPagar)}
          </div>
          <p style="font-size:0.82rem;color:var(--texto-2);line-height:1.4;margin:0;">
            Se marcarán como <strong>Saldados</strong> los ${consumosAPagar.length} consumos del período actual.
          </p>
        </div>
      `,
      confirmLabel: 'Confirmar Pago',
      onConfirm: async (m) => {
        m.setLoading(true);
        try {
          const ids = consumosAPagar.map(c => c.id_consumo_tc || c.id_consumo_tarjeta).filter(Boolean);
          const resp = await App.API.fetch('/api/togglePago', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'pagar_resumen',
              idTarjeta: this.#selectedTcId || '',
              mes: App.Store?.mes || '',
              ids
            })
          });
          m.close();
          if (resp && resp.success) {
            if (App.Toast) App.Toast.success(`Resumen liquidado: ${resp.updatedCount || consumosAPagar.length} consumos marcados como Saldados`);
            App.API.invalidateAll();
            if (App.Events) App.Events.emit('data:changed');
            this.destruir();
            await this.cargar();
          } else {
            throw new Error(resp?.error || 'Error al procesar el pago');
          }
        } catch (err) {
          m.setLoading(false);
          if (App.Toast) App.Toast.error(err.message || 'Error al liquidar resumen');
        }
      }
    });
  }

  async #togglePagoTc(id, btn) {
    btn.disabled = true;
    btn.style.opacity = '0.6';
    try {
      const resp = await App.API.fetch('/api/togglePago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', id })
      });
      if (resp && resp.success) {
        if (App.Toast) App.Toast.success(resp.pagado ? 'Consumo marcado como Saldado' : 'Consumo marcado como Pendiente');
        App.API.invalidateAll();
        if (App.Events) App.Events.emit('data:changed');
        this.destruir();
        await this.cargar();
      } else {
        throw new Error(resp?.error || 'Error al actualizar');
      }
    } catch (err) {
      btn.disabled = false;
      btn.style.opacity = '1';
      if (App.Toast) App.Toast.error(err.message || 'Error al cambiar estado de pago');
    }
  }

  #renderToolbarFiltros() {
    if (!this.#table) return;
    const cuentasList = this.#cuentas && this.#cuentas.length > 0 ? this.#cuentas : (App.Store.cuentas || []);
    const opts = cuentasList.map(c => `
      <option value="${c.id_cuenta_principal}" ${this.#selectedCuentaId === c.id_cuenta_principal ? 'selected' : ''}>
        ${App.Utils.escapeHtml(c.nombre)}
      </option>
    `).join('');

    const html = `
      <div style="display:flex;align-items:center;gap:8px;">
        <label for="tc-filter-cuenta" style="font-size:0.8rem;color:var(--texto-2);font-weight:600;white-space:nowrap;">Cuenta:</label>
        <select id="tc-filter-cuenta" class="input" style="padding:6px 10px;font-size:0.82rem;height:34px;border-radius:var(--r-sm);background:var(--fondo);color:var(--texto);border:1px solid var(--borde);cursor:pointer;">
          <option value="">Todas las cuentas</option>
          ${opts}
          <option value="sin_imputar" ${this.#selectedCuentaId === 'sin_imputar' ? 'selected' : ''}>Sin Imputar</option>
        </select>
      </div>
    `;

    this.#table.setToolbarActions(html);

    const sel = document.getElementById('tc-filter-cuenta');
    if (sel) {
      sel.addEventListener('change', (e) => {
        this.#selectedCuentaId = e.target.value;
        this.#filterConsumos();
      });
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
      <button id="tc-btn-nuevo" class="btn btn-primary">
        ${App.Icons.get('add', 'icon-sm')} Nuevo consumo
      </button>
      <button id="tc-btn-importar" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-sm"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Importar resumen
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
                    <th style="padding:10px; width:120px">Imputar en</th>
                    <th style="padding:10px; width:110px">Plan / Tipo</th>
                    <th style="padding:10px; text-align:right">Importe</th>
                  </tr>
                </thead>
                <tbody id="tc-import-table-body"></tbody>
              </table>
            </div>
          </div>

          <div id="tc-import-recurrentes-ausentes-section" class="hidden" style="border:1px solid rgba(245, 158, 11, 0.3); background:rgba(245, 158, 11, 0.05); border-radius:8px; padding:12px">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px">
              <span style="font-size:1.1rem">⚠️</span>
              <strong style="color:var(--texto-1); font-size:0.9rem">Servicios recurrentes no detectados en este resumen</strong>
            </div>
            <p style="font-size:0.8rem; color:var(--texto-3); margin:0 0 10px 0">
              La IA detectó que estos consumos habituales no figuran en este resumen. Marca la casilla si deseas cancelar el servicio y dar de baja sus proyecciones futuras (la decisión final siempre es tuya):
            </p>
            <div style="max-height:160px; overflow-y:auto; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-1)">
              <table class="table" style="width:100%; border-collapse:collapse; font-size:0.8rem">
                <thead>
                  <tr style="background:var(--bg-2); border-bottom:1px solid var(--border-color); text-align:left">
                    <th style="padding:6px 10px; width:40px; text-align:center">Baja</th>
                    <th style="padding:6px 10px">Descripción</th>
                    <th style="padding:6px 10px; text-align:right">Último Importe</th>
                    <th style="padding:6px 10px">Sugerencia IA</th>
                  </tr>
                </thead>
                <tbody id="tc-import-recur-ausentes-body"></tbody>
              </table>
            </div>
          </div>

          <div id="tc-import-unmatched-section" class="hidden" style="border:1px solid rgba(59, 130, 246, 0.3); background:rgba(59, 130, 246, 0.05); border-radius:8px; padding:12px">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px">
              <span style="font-size:1.1rem">ℹ️</span>
              <strong style="color:var(--texto-1); font-size:0.9rem">Consumos agendados previamente no encontrados en el resumen</strong>
            </div>
            <p style="font-size:0.8rem; color:var(--texto-3); margin:0 0 10px 0">
              Consumos registrados para este período que no figuran en el extracto oficial. Desmárcalos si deseas conservarlos, o déjalos marcados para depurarlos del período:
            </p>
            <div style="max-height:160px; overflow-y:auto; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-1)">
              <table class="table" style="width:100%; border-collapse:collapse; font-size:0.8rem">
                <thead>
                  <tr style="background:var(--bg-2); border-bottom:1px solid var(--border-color); text-align:left">
                    <th style="padding:6px 10px; width:40px; text-align:center">Eliminar</th>
                    <th style="padding:6px 10px">Fecha</th>
                    <th style="padding:6px 10px">Descripción</th>
                    <th style="padding:6px 10px; text-align:right">Importe</th>
                  </tr>
                </thead>
                <tbody id="tc-import-unmatched-body"></tbody>
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
    this.#lastStatementPayload = payload;
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
    (payload.exact_matches || []).forEach(match => {
      txList.push({
        ...match,
        id: 'match_' + Math.random().toString(36).substr(2, 9),
        type: 'MATCH'
      });
    });

    this.#txListImportar = txList;

    const newCount = txList.filter(t => t.type === 'NEW').length;
    const diffCount = txList.filter(t => t.type === 'DIFF').length;
    const matchCount = txList.filter(t => t.type === 'MATCH').length;

    const countEl = document.getElementById('tc-import-count');
    if (countEl) {
      countEl.innerHTML = `${txList.length} <span style="font-size:0.8rem; font-weight:normal; color:var(--texto-3)">(${newCount} nuevos, ${diffCount} modificaciones, ${matchCount} ya registrados)</span>`;
    }

    const tbody = document.getElementById('tc-import-table-body');
    if (!tbody) return;

    if (txList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding:2rem; text-align:center; color:var(--texto-3)">No se detectaron transacciones para registrar.</td></tr>`;
      if (btnConfirm) btnConfirm.style.display = 'none';
      return;
    }

    tbody.innerHTML = txList.map((tx, idx) => {
      const isCuotas = tx.cuota_total && tx.cuota_total > 1;
      const isMatch = tx.type === 'MATCH';
      const isDiff = tx.type === 'DIFF';
      const isChecked = !isMatch;
      const tipo = tx.tipo_consumo || (isCuotas ? 'CUOTAS' : 'SIMPLE');

      const typeSelect = `
        <select class="input" style="padding:4px; font-size:0.8rem; margin:0; width:100%" id="tx-type-${tx.id}">
          <option value="SIMPLE" ${tipo === 'SIMPLE' ? 'selected' : ''}>Simple</option>
          <option value="CUOTAS" ${tipo === 'CUOTAS' ? 'selected' : ''}>Cuotas</option>
          <option value="RECURRENTE" ${tipo === 'RECURRENTE' ? 'selected' : ''}>Recurrente</option>
        </select>
      `;

      const sugerenciaHtml = tx.sugerencia_ia ? `
        <div style="font-size:0.7rem; color:var(--primario, #6366f1); margin-top:2px; display:flex; align-items:center; gap:3px" title="${App.Utils.escapeHtml(tx.sugerencia_ia)}">
          <span>✨</span>
          <span>${App.Utils.escapeHtml(tx.sugerencia_ia)}</span>
        </div>
      ` : '';

      const defaultAccountId = tx.id_cuenta_imputar || App.Store.cuenta;
      const accSelectHtml = `
        <select class="input" style="padding:4px; font-size:0.8rem; margin:0; width:100%" id="tx-acc-${tx.id}">
          ${this.#cuentas.map(c => `
            <option value="${c.id_cuenta_principal}" ${c.id_cuenta_principal === defaultAccountId ? 'selected' : ''}>
              ${App.Utils.escapeHtml(c.nombre)}
            </option>
          `).join('')}
        </select>
      `;

      let badgeHtml = '';
      if (isDiff) {
        badgeHtml = `<span style="display:inline-flex; align-items:center; justify-content:center; padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:600; background-color:rgba(245, 158, 11, 0.15); color:#F59E0B;" title="Reemplazará un consumo existente que tiene diferencias">Modifica</span>`;
      } else if (isMatch) {
        badgeHtml = `<span style="display:inline-flex; align-items:center; justify-content:center; padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:600; background-color:rgba(107, 114, 128, 0.15); color:#9CA3AF;" title="Ya existe en la base de datos (desmarcado para no duplicar)">Ya registrado</span>`;
      } else {
        badgeHtml = `<span style="display:inline-flex; align-items:center; justify-content:center; padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:600; background-color:rgba(16, 185, 129, 0.15); color:#10B981;" title="Nuevo consumo a registrar">Nuevo</span>`;
      }

      let diffDescHtml = '';
      if (isDiff && tx.dbRecord) {
        diffDescHtml = `<small style="color:var(--texto-3); display:block; margin-top:2px; font-size:0.75rem;">(Reemplaza: "${App.Utils.escapeHtml(tx.dbRecord.descripcion)}" - ${App.Utils.formatearMoneda(tx.dbRecord.importe)})</small>`;
      } else if (isMatch) {
        diffDescHtml = `<small style="color:var(--texto-3); display:block; margin-top:2px; font-size:0.75rem;">(Ya existe en la base de datos — desmarcado para no duplicar)</small>`;
      }

      const importeFmt = tx.moneda === 'USD'
        ? `USD ${Number(tx.importe || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : App.Utils.formatearMoneda(tx.importe);

      return `
        <tr style="border-bottom:1px solid var(--border-color); ${isMatch ? 'opacity:0.75;' : ''}">
          <td style="padding:10px; text-align:center">
            <input type="checkbox" class="tx-select-row" data-id="${tx.id}" ${isChecked ? 'checked' : ''}>
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
            ${accSelectHtml}
          </td>
          <td style="padding:10px">
            <div style="display:flex; flex-direction:column; gap:4px">
              ${typeSelect}
              ${sugerenciaHtml}
              <div id="tx-cuotas-div-${tx.id}" style="display:${isCuotas ? 'flex' : 'none'}; gap:4px; align-items:center; margin-top:2px">
                <input class="input" type="number" style="padding:4px; font-size:0.8rem; margin:0; width:45px" id="tx-cuota-act-${tx.id}" value="${tx.cuota_actual || 1}" min="1">
                <span style="font-size:0.75rem">/</span>
                <input class="input" type="number" style="padding:4px; font-size:0.8rem; margin:0; width:45px" id="tx-cuota-tot-${tx.id}" value="${tx.cuota_total || 12}" min="2">
              </div>
            </div>
          </td>
          <td style="padding:10px; text-align:right; font-weight:500" class="negativo">${importeFmt}</td>
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

    // Renderizar servicios recurrentes no detectados en este resumen
    const recurAusentesSec = document.getElementById('tc-import-recurrentes-ausentes-section');
    const recurAusentesBody = document.getElementById('tc-import-recur-ausentes-body');
    if (recurAusentesSec && recurAusentesBody) {
      const ausentes = payload.recurrentes_ausentes || [];
      if (ausentes.length > 0) {
        recurAusentesSec.classList.remove('hidden');
        recurAusentesBody.innerHTML = ausentes.map(r => `
          <tr style="border-bottom:1px solid var(--border-color)">
            <td style="padding:6px 10px; text-align:center">
              <input type="checkbox" class="tx-baja-recur-row" data-group-id="${r.recur_group_id}">
            </td>
            <td style="padding:6px 10px">
              <strong>${App.Utils.escapeHtml(r.descripcion)}</strong>
            </td>
            <td style="padding:6px 10px; text-align:right; font-weight:500" class="negativo">
              ${r.moneda === 'USD' ? 'USD ' + Number(r.importe || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 }) : App.Utils.formatearMoneda(r.importe)}
            </td>
            <td style="padding:6px 10px; color:#F59E0B; font-size:0.75rem">
              ✨ ${App.Utils.escapeHtml(r.sugerencia_ia || 'Sugerencia: Dar de baja')}
            </td>
          </tr>
        `).join('');
      } else {
        recurAusentesSec.classList.add('hidden');
        recurAusentesBody.innerHTML = '';
      }
    }

    // Renderizar consumos agendados previamente no encontrados en el extracto
    const unmatchedSec = document.getElementById('tc-import-unmatched-section');
    const unmatchedBody = document.getElementById('tc-import-unmatched-body');
    if (unmatchedSec && unmatchedBody) {
      const unms = payload.unmatched_db_consumptions || [];
      if (unms.length > 0) {
        unmatchedSec.classList.remove('hidden');
        unmatchedBody.innerHTML = unms.map(u => `
          <tr style="border-bottom:1px solid var(--border-color)">
            <td style="padding:6px 10px; text-align:center">
              <input type="checkbox" class="tx-unmatched-del-row" data-id="${u.id_consumo_tarjeta}" checked>
            </td>
            <td style="padding:6px 10px; white-space:nowrap">${App.Utils.formatearFecha(u.fecha)}</td>
            <td style="padding:6px 10px">${App.Utils.escapeHtml(u.descripcion)}</td>
            <td style="padding:6px 10px; text-align:right; font-weight:500" class="negativo">
              ${u.moneda === 'USD' ? 'USD ' + Number(u.importe || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 }) : App.Utils.formatearMoneda(u.importe)}
            </td>
          </tr>
        `).join('');
      } else {
        unmatchedSec.classList.add('hidden');
        unmatchedBody.innerHTML = '';
      }
    }

    const selectAllChk = document.getElementById('tc-import-select-all');
    if (selectAllChk) {
      selectAllChk.checked = txList.length > 0 && txList.every(t => t.type !== 'MATCH');
      selectAllChk.addEventListener('change', () => {
        tbody.querySelectorAll('.tx-select-row').forEach(chk => {
          chk.checked = selectAllChk.checked;
        });
      });
    }
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

    try {
      // 1. Recolectar consumos a eliminar (modificaciones previas + desmarques no correspondientes)
      const consumosAEliminar = [];
      for (const chk of checkedRowChks) {
        const txId = chk.dataset.id;
        const originalTx = this.#txListImportar.find(t => t.id === txId);
        if (originalTx?.type === 'DIFF' && originalTx.dbRecord?.id_consumo_tarjeta) {
          consumosAEliminar.push(originalTx.dbRecord.id_consumo_tarjeta);
        }
      }
      document.querySelectorAll('.tx-unmatched-del-row:checked').forEach(chk => {
        if (chk.dataset.id) consumosAEliminar.push(chk.dataset.id);
      });

      // 2. Recolectar bajas de recurrencias confirmadas por el usuario
      const bajasRecurrencias = [];
      document.querySelectorAll('.tx-baja-recur-row:checked').forEach(chk => {
        if (chk.dataset.groupId) bajasRecurrencias.push(chk.dataset.groupId);
      });

      // 3. Construir batch con todos los consumos seleccionados
      const batchConsumos = [];
      for (const chk of checkedRowChks) {
        const txId = chk.dataset.id;
        const originalTx = this.#txListImportar.find(t => t.id === txId);
        if (!originalTx) continue;

        const desc = document.getElementById(`tx-desc-${txId}`).value;
        const cat = document.getElementById(`tx-cat-${txId}`).value;
        const rowAcc = document.getElementById(`tx-acc-${txId}`)?.value || targetAccount;
        const type = document.getElementById(`tx-type-${txId}`).value;
        const cuotaAct = Number(document.getElementById(`tx-cuota-act-${txId}`).value || 1);
        const cuotaTot = Number(document.getElementById(`tx-cuota-tot-${txId}`).value || 1);

        batchConsumos.push({
          descripcion: desc,
          idCategoria: cat,
          idCuentaImputar: rowAcc,
          importe: Number(originalTx.importe || 0),
          moneda: originalTx.moneda || 'ARS',
          fecha: originalTx.fecha,
          tipoConsumo: type,
          cuotaActual: cuotaAct,
          cuotaTotal: cuotaTot,
          recur_group_id: originalTx.recur_group_id || null
        });
      }

      // 4. Ejecutar guardado atómico en una sola llamada batch
      const batchPayload = {
        batch: true,
        idCuenta: App.Store.cuenta,
        idTarjeta: targetCard,
        idCuentaImputar: targetAccount,
        imputar: true,
        statementInfo: this.#lastStatementPayload?.statement_info || null,
        consumos: batchConsumos,
        consumosAEliminar: consumosAEliminar,
        bajasRecurrencias: bajasRecurrencias
      };

      await App.API.call(this._createEndpoint, batchPayload);

      // Check which month the imported transactions belong to
      const sampleTx = batchConsumos[0];
      const txMonth = sampleTx?.fecha ? sampleTx.fecha.substring(0, 7) : null;

      let msg = `¡Importación finalizada con éxito! Se cargaron ${batchConsumos.length} consumos.`;
      if (txMonth && txMonth !== App.Store.mes) {
        const [y, m] = txMonth.split('-');
        const dateObj = new Date(parseInt(y), parseInt(m) - 1, 1);
        const mesNombre = dateObj.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
        msg += ` (Quedaron registrados en el período ${mesNombre})`;
      }
      App.Toast.success(msg, 7000);
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