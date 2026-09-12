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
  #evolucionChartInstance = null;
  #proyeccionesData = [];
  #evolucionData = [];
  #currentView = 'mes';
  #moneyFlowPeriod = '6M';
  #catMetric = 'gastos';
  #consumosFilter = 'ALL';
  #consumosSearch = '';

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

    // Actualizar Scorecards FinSet
    // 1. ARS
    const valArsEl = document.getElementById('tc-kpi-val-ars');
    if (valArsEl) valArsEl.textContent = App.Utils.formatearMoneda(saldoTotal);

    // 2. USD
    let totalUsd = 0;
    filteredConsumos.forEach(c => {
      if (c.moneda === 'USD') totalUsd += Number(c.importe || 0);
    });
    this.#tarjetas.forEach(tc => {
      const isDueInMonth = (tc.fecha_vencimiento_actual && tc.fecha_vencimiento_actual.substring(0, 7) === App.Store.mes) ||
                           (tc.fecha_cierre_actual && tc.fecha_cierre_actual.substring(0, 7) === App.Store.mes);
      if (isDueInMonth && Number(tc.total_resumen_usd || 0) > 0) {
        totalUsd = Number(tc.total_resumen_usd);
      }
    });
    const valUsdEl = document.getElementById('tc-kpi-val-usd');
    const subUsdEl = document.getElementById('tc-kpi-sub-usd');
    if (valUsdEl) valUsdEl.textContent = 'US$ ' + totalUsd.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (subUsdEl) {
      const cotizOficial = App.Store.cotizaciones?.oficial?.venta || 0;
      subUsdEl.textContent = cotizOficial ? `Equiv. oficial: $ ${Math.round(totalUsd * cotizOficial).toLocaleString('es-AR')}` : 'Equiv. oficial: —';
    }

    // 3. Impuestos & Percepciones
    const taxConsumos = filteredConsumos.filter(c => this.#isTaxConsumo(c));
    const totalImpuestos = taxConsumos.reduce((acc, t) => acc + Number(t.importe || 0), 0);
    const valTaxesEl = document.getElementById('tc-kpi-val-taxes');
    if (valTaxesEl) valTaxesEl.textContent = App.Utils.formatearMoneda(totalImpuestos);

    // 4. Tope TC (Salud Financiera)
    this.#updateTopeKpi(saldoTotal);

    // Store filtered consumos for card selector filtering
    this.#allConsumos = filteredConsumos;
    
    // Preserve selected card ID if it remains valid
    const validCard = this.#tarjetas.some(t => t.id_tarjeta === this.#selectedTcId);
    if (!validCard) {
      this.#selectedTcId = null;
    }

    // Build the card selector pills
    this.#renderCardSelector();

    this.#filterConsumos();
    this.#renderMoneyFlowChart();
    App.log('TarjetasModule', '_render', `${filteredConsumos.length} consumos (filtered from ${(consumos || []).length})`);
  }

  _renderProyecciones(data) {
     this.#proyeccionesData = data?.proyeccion || [];
     this.#renderMoneyFlowChart();
  }

  // --- SECCIÓN 3: BUILD DOM ---

  _buildVista() {
    const vista = document.getElementById(this.vistaId);
    if (!vista) return;

    vista.innerHTML = `
      <!-- ═══ ROW 1: SCORECARDS FINSET ═══ -->
      <div class="finset-kpi-grid" id="tc-scorecards-grid" style="margin-bottom: 24px;">
        
        <!-- Card 1: Consumos Totales (ARS) -->
        <div class="finset-kpi-card" id="tc-card-kpi-ars">
          <div class="finset-kpi-header">
            <div class="finset-kpi-title-wrap">
              <div class="finset-kpi-icon icon-blue">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              </div>
              <span class="finset-kpi-title">Consumos del Mes</span>
            </div>
            <button class="finset-arrow-btn" id="tc-btn-filter-ars" title="Ver consumos">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <div class="finset-kpi-value" id="tc-kpi-val-ars">$ 0,00</div>
          <div class="finset-kpi-footer">
            <span class="finset-kpi-subtext" id="tc-kpi-sub-ars">Total a pagar en pesos</span>
            <span class="finset-trend-pill trend-up"><span>ARS</span></span>
          </div>
        </div>

        <!-- Card 2: Consumos en Dólares (USD) -->
        <div class="finset-kpi-card" id="tc-card-kpi-usd">
          <div class="finset-kpi-header">
            <div class="finset-kpi-title-wrap">
              <div class="finset-kpi-icon icon-cyan">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>
              </div>
              <span class="finset-kpi-title">Consumos en Dólares</span>
            </div>
          </div>
          <div class="finset-kpi-value" id="tc-kpi-val-usd">US$ 0,00</div>
          <div class="finset-kpi-footer">
            <span class="finset-kpi-subtext" id="tc-kpi-sub-usd">Equiv. oficial: —</span>
            <span class="finset-trend-pill trend-neutral"><span>USD</span></span>
          </div>
        </div>

        <!-- Card 3: Impuestos & Percepciones -->
        <div class="finset-kpi-card" id="tc-card-kpi-taxes">
          <div class="finset-kpi-header">
            <div class="finset-kpi-title-wrap">
              <div class="finset-kpi-icon icon-yellow">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              </div>
              <span class="finset-kpi-title">Impuestos & Cargos</span>
            </div>
          </div>
          <div class="finset-kpi-value" id="tc-kpi-val-taxes">$ 0,00</div>
          <div class="finset-kpi-footer">
            <span class="finset-kpi-subtext">PAIS, Ganancias y Sellos</span>
            <span class="finset-trend-pill trend-down"><span>Cargos</span></span>
          </div>
        </div>

        <!-- Card 4: Tope TC (Salud Financiera) -->
        <div class="finset-kpi-card" id="tc-card-kpi-tope" style="cursor:pointer;" title="Tope de tarjeta configurado (25% de ingresos)">
          <div class="finset-kpi-header">
            <div class="finset-kpi-title-wrap">
              <div class="finset-kpi-icon icon-purple">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              </div>
              <div style="display:flex; flex-direction:column; line-height:1.2;">
                <span class="finset-kpi-title">Tope Tarjetas</span>
                <span style="font-size:0.68rem; font-weight:600; color:var(--texto-3);" id="tc-tope-kpi-target">Tope: 25% de ingresos</span>
              </div>
            </div>
          </div>
          <div class="finset-kpi-value" id="tc-tope-kpi-val" style="font-size:1.35rem;">En rango</div>
          <div class="finset-goal-progress-wrap">
            <div class="finset-goal-progress-bar">
              <div class="finset-goal-progress-fill" id="tc-tope-progress-fill" style="width: 0%; background: var(--verde);"></div>
            </div>
          </div>
          <div class="finset-kpi-footer">
            <span class="finset-kpi-subtext" id="tc-tope-kpi-sub">0% de ingresos consumido</span>
            <span class="finset-trend-pill trend-up" id="tc-tope-status-pill"><span>Salud OK</span></span>
          </div>
        </div>

      </div>

      <!-- ═══ ROW 2: ANALYTICS & INSIGHTS (Money Flow + Top Categorías) ═══ -->
      <div class="finset-grid-2col" style="margin-bottom: 24px;">
        
        <!-- Left (60%): Evolución Mensual de Consumos -->
        <div class="finset-card" id="tc-widget-moneyflow">
          <div class="finset-card-header">
            <div class="finset-card-title-wrap">
              <h3 class="finset-card-title">Flujo de Fondos</h3>
              <span class="finset-card-subtitle" id="tc-moneyflow-sub">Evolución histórica últimos 6 meses</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <div class="fintech-pill-switch" id="tc-period-switch">
                <button class="fintech-pill-btn active" data-period="6M">6M</button>
                <button class="fintech-pill-btn" data-period="12M">12M</button>
                <button class="fintech-pill-btn" data-period="YTD">Año actual</button>
              </div>
            </div>
          </div>
          <div style="position:relative; width:100%; height:230px; margin: 4px 0;">
            <canvas id="tc-moneyflow-canvas"></canvas>
          </div>
          <div class="finset-chart-summary" id="tc-moneyflow-summary"></div>
        </div>

        <!-- Right (40%): Top Categorías (FinSet Side-by-Side) -->
        <div class="finset-card" id="tc-widget-categories">
          <div class="finset-card-header">
            <div class="finset-card-title-wrap">
              <h3 class="finset-card-title">Top Categorías</h3>
              <span class="finset-card-subtitle" id="tc-categories-subtitle">Distribución de consumos</span>
            </div>
            <div class="fintech-pill-switch" id="tc-cat-switch">
              <button class="fintech-pill-btn active" data-cat-view="gastos">% Consumos</button>
              <button class="fintech-pill-btn" data-cat-view="tarjeta">Por Tarjeta</button>
            </div>
          </div>
          <div class="finset-categories-side-wrap">
            <div class="fintech-legend-list" id="tc-categories-legend" style="margin-top:0;"></div>
            <div class="fintech-donut-wrapper" style="height:180px; margin:0;">
              <canvas id="tc-categories-donut-canvas"></canvas>
              <div class="fintech-donut-center" id="tc-categories-donut-center">
                <span class="fintech-donut-center-label" id="tc-donut-center-label">Total Consumos</span>
                <span class="fintech-donut-center-val" id="tc-donut-center-val" style="font-size:1.05rem;">$ 0,00</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- ═══ ROW 3: OPERATIONS & DRILLDOWN (Consumos + Panel de Tarjetas) ═══ -->
      <div class="finset-grid-2col" style="grid-template-columns: 1.45fr 0.95fr;">
        
        <!-- Left (60-65%): Grilla de Consumos (Mismo estilo que Movimientos) -->
        <div class="finset-card" id="tc-widget-consumos">
          <div class="finset-card-header" style="flex-wrap:wrap; gap:12px; align-items:center;">
            <div class="dh-drilldown-left" style="min-width:180px;">
              <div class="dh-drilldown-badge badge-all" id="tc-consumos-badge">
                <span class="dh-badge-dot"></span>
                <span class="dh-badge-title" id="tc-consumos-title">Todos los Consumos</span>
              </div>
              <div class="dh-drilldown-summary" id="tc-consumos-summary">—</div>
            </div>

            <div class="finset-card-actions" style="margin-left:auto; gap:10px; align-items:center;">
              <div class="dh-filter-tabs" id="tc-consumos-tabs">
                <button class="dh-tab-btn active" data-filter="ALL" id="tc-tab-all">Todos</button>
                <button class="dh-tab-btn" data-filter="CUOTAS" id="tc-tab-cuotas">En Cuotas</button>
                <button class="dh-tab-btn" data-filter="COMUN" id="tc-tab-comun">Pago Único</button>
              </div>

              <div class="dh-search-box" style="margin:0;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" id="tc-consumos-search" placeholder="Buscar..." class="finset-search-input" style="width:130px;">
              </div>

              <button class="btn btn-primary btn-sm" id="tc-btn-nuevo-inline" style="display:inline-flex;align-items:center;gap:6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                <span>Nuevo Consumo</span>
              </button>
            </div>
          </div>

          <!-- Lista de consumos interactiva -->
          <div class="dh-drilldown-list dh-side-main" id="tc-consumos-list" style="margin-top:12px; max-height:510px; overflow-y:auto; padding-right:4px;">
          </div>
        </div>

        <!-- Right (35-40%): Panel de Plásticos & Resumen Oficial -->
        <div class="finset-card" id="tc-widget-cards-panel">
          <div class="finset-card-header" style="justify-content:space-between; align-items:center;">
            <div class="finset-card-title-wrap">
              <h3 class="finset-card-title">Mis Tarjetas</h3>
              <span class="finset-card-subtitle" id="tc-card-panel-sub">Plásticos y resúmenes oficiales</span>
            </div>
            <button class="btn btn-secondary btn-sm" id="tc-btn-pagar-resumen" style="display:inline-flex;align-items:center;gap:6px;" title="Liquidar resumen y marcar consumos como saldados">
              💳 Pagar Resumen
            </button>
          </div>

          <!-- Interactive Plastic Card Slider -->
          <div class="tc-slider-container" style="position:relative; display:flex; align-items:center; justify-content:center; gap:8px; margin: 10px 0 14px; width:100%;">
            <button id="tc-slide-prev" class="tc-slide-arrow" aria-label="Tarjeta Anterior">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px; height:14px; display:block;">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            
            <div id="tc-card-selector" class="tc-card-list" style="display:flex; overflow-x:auto; scroll-behavior:smooth; gap:12px; padding:6px 2px; max-width: 250px;">
            </div>
            
            <button id="tc-slide-next" class="tc-slide-arrow" aria-label="Siguiente Tarjeta">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px; height:14px; display:block;">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>

          <!-- Selected Card Metadata -->
          <div id="tc-selected-card-info" style="padding:12px 14px; background:var(--fondo); border:1px solid var(--borde); border-radius:10px; margin-bottom:14px; font-size:0.8rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span style="color:var(--texto-3);">Cierre oficial: <strong id="tc-info-cierre" style="color:var(--texto);">—</strong></span>
              <span style="color:var(--texto-3);">Vencimiento: <strong id="tc-info-vto" style="color:var(--texto);">—</strong></span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="color:var(--texto-3);">Total resumen oficial:</span>
              <strong id="tc-info-total-oficial" style="color:var(--texto); font-size:0.88rem;">—</strong>
            </div>
          </div>

          <!-- Desglose de Impuestos -->
          <div id="tc-taxes-wrap"></div>
        </div>

      </div>
    `;
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
        
        if (btn.id === 'tc-btn-nuevo' || btn.id === 'tc-btn-nuevo-inline') {
          this.#abrirModalAlta();
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
        } else if (btn.id === 'tc-btn-filter-ars') {
          document.getElementById('tc-widget-consumos')?.scrollIntoView({ behavior: 'smooth' });
        }
      });

      // Filter tabs (Todos, En Cuotas, Pago Único)
      document.getElementById('tc-consumos-tabs')?.querySelectorAll('.dh-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#tc-consumos-tabs .dh-tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.#consumosFilter = btn.dataset.filter || 'ALL';
          this.#filterConsumos();
        });
      });

      // Search box
      document.getElementById('tc-consumos-search')?.addEventListener('input', (e) => {
        this.#consumosSearch = e.target.value || '';
        this.#filterConsumos();
      });

      // Period switch for Money Flow (6M, 12M, YTD)
      document.getElementById('tc-period-switch')?.querySelectorAll('.fintech-pill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#tc-period-switch .fintech-pill-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.#moneyFlowPeriod = btn.dataset.period || '6M';
          this.#renderMoneyFlowChart();
        });
      });

      // Categories switch (% Consumos vs Por Tarjeta)
      document.getElementById('tc-cat-switch')?.querySelectorAll('.fintech-pill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#tc-cat-switch .fintech-pill-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.#catMetric = btn.dataset.catView || 'gastos';
          this.#renderGraficos();
        });
      });

      // Card 4: Tope TC click to configure
      document.getElementById('tc-card-kpi-tope')?.addEventListener('click', () => {
        this.#abrirModalTopeTC();
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

    // Actualizar texto del botón Pagar Resumen según tarjeta seleccionada o Consolidado
    const btnPagar = document.getElementById('tc-btn-pagar-resumen');
    if (btnPagar) {
      if (this.#selectedTcId) {
        const activeCard = this.#tarjetas.find(t => t.id_tarjeta === this.#selectedTcId);
        btnPagar.innerHTML = `💳 Pagar Resumen (${App.Utils.escapeHtml(activeCard?.nombre || 'Tarjeta')})`;
        btnPagar.title = `Liquidar resumen de ${App.Utils.escapeHtml(activeCard?.nombre || 'Tarjeta')} y marcar consumos como saldados`;
      } else {
        btnPagar.innerHTML = '💳 Pagar Resumen (Consolidado)';
        btnPagar.title = 'Liquidar resúmenes de todas las tarjetas y marcar consumos como saldados';
      }
    }

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

    // Filtro por pestañas (ALL, CUOTAS, COMUN)
    let displayConsumos = regularConsumos;
    if (this.#consumosFilter === 'CUOTAS') {
      displayConsumos = displayConsumos.filter(c => c.tipo_consumo === 'CUOTAS' || Number(c.cuota_total) > 1);
    } else if (this.#consumosFilter === 'COMUN') {
      displayConsumos = displayConsumos.filter(c => c.tipo_consumo === 'COMUN' || (!c.cuota_total || Number(c.cuota_total) <= 1));
    }

    // Filtro por búsqueda de texto
    if (this.#consumosSearch && this.#consumosSearch.trim()) {
      const q = this.#consumosSearch.trim().toLowerCase();
      displayConsumos = displayConsumos.filter(c => {
        const desc = (c.descripcion || '').toLowerCase();
        const cat = (c.categoria_nombre || '').toLowerCase();
        const tc = (c.tarjeta_nombre || '').toLowerCase();
        return desc.includes(q) || cat.includes(q) || tc.includes(q);
      });
    }

    // Actualizar resumen y títulos
    const badgeTitleEl = document.getElementById('tc-consumos-title');
    const badgeEl = document.getElementById('tc-consumos-badge');
    const summaryEl = document.getElementById('tc-consumos-summary');

    if (badgeTitleEl) {
      if (this.#consumosFilter === 'CUOTAS') badgeTitleEl.textContent = 'Consumos en Cuotas';
      else if (this.#consumosFilter === 'COMUN') badgeTitleEl.textContent = 'Consumos Pago Único';
      else badgeTitleEl.textContent = 'Todos los Consumos';
    }
    if (badgeEl) {
      badgeEl.className = 'dh-drilldown-badge ' + (this.#consumosFilter === 'CUOTAS' ? 'badge-recur' : 'badge-all');
    }

    const totalDisplay = displayConsumos.reduce((acc, c) => acc + (c.moneda === 'USD' ? 0 : Number(c.importe || 0)), 0);
    if (summaryEl) {
      summaryEl.textContent = `${displayConsumos.length} ${displayConsumos.length === 1 ? 'consumo' : 'consumos'} • Total: ${App.Utils.formatearMoneda(totalDisplay)}`;
    }

    this.#renderConsumosList(displayConsumos);
    this.#renderImpuestosAccordion(taxConsumos);
    this.#renderGraficos();

    // Actualizar metadata de tarjeta seleccionada en el panel derecho
    const infoCard = this.#selectedTcId ? this.#tarjetas.find(t => t.id_tarjeta === this.#selectedTcId) : null;
    const infoCierre = document.getElementById('tc-info-cierre');
    const infoVto = document.getElementById('tc-info-vto');
    const infoTotal = document.getElementById('tc-info-total-oficial');
    if (infoCierre) infoCierre.textContent = infoCard?.fecha_cierre_actual ? App.Utils.formatearFecha(infoCard.fecha_cierre_actual) : '—';
    if (infoVto) infoVto.textContent = infoCard?.fecha_vencimiento_actual ? App.Utils.formatearFecha(infoCard.fecha_vencimiento_actual) : '—';
    if (infoTotal) {
      const oficialArs = infoCard ? Number(infoCard.total_resumen_ars || 0) : 0;
      infoTotal.textContent = oficialArs > 0 ? App.Utils.formatearMoneda(oficialArs) : App.Utils.formatearMoneda(totalDisplay);
    }
  }

  #renderConsumosList(items) {
    const listEl = document.getElementById('tc-consumos-list');
    if (!listEl) return;

    if (!items || items.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center; padding:3rem 1.5rem; color:var(--texto-3); font-size:0.875rem;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px; opacity:0.6;"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
          <div>No hay consumos registrados para el criterio seleccionado.</div>
        </div>
      `;
      return;
    }

    const getCatIconSvg = (catName) => {
      const cat = (catName || '').toLowerCase();
      if (cat.includes('super') || cat.includes('alimento') || cat.includes('comida')) {
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`;
      }
      if (cat.includes('serv') || cat.includes('luz') || cat.includes('gas') || cat.includes('internet') || cat.includes('digital')) {
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
      }
      if (cat.includes('auto') || cat.includes('combust') || cat.includes('nafta') || cat.includes('viaje')) {
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`;
      }
      if (cat.includes('salud') || cat.includes('farmacia')) {
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`;
      }
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`;
    };

    const rowsHtml = items.map(r => {
      const catName = r.categoria_nombre || 'General';
      const desc = r.descripcion || catName;
      const fechaStr = App.Utils.formatearFecha(r.fecha?.value || r.fecha);
      const isPaid = !!r.pagado;
      const id = r.id_consumo_tc || r.id_consumo_tarjeta;
      const tcName = r.tarjeta_nombre || 'TC';

      let badgesHtml = '';
      if (r.tipo_consumo === 'CUOTAS' || Number(r.cuota_total) > 1) {
        badgesHtml += `<span class="badge badge-recur" style="font-size:0.68rem; margin-left:4px;">Cuota ${r.cuota_actual || 1}/${r.cuota_total || 12}</span>`;
      } else if (r.tipo_consumo === 'RECURRENTE') {
        badgesHtml += `<span class="badge badge-recur" style="font-size:0.68rem; margin-left:4px;">Recurrente</span>`;
      }
      if (r.imputado && r.cuenta_imputada_nombre && r.cuenta_imputada_nombre !== 'Propios') {
        badgesHtml += `<span class="badge badge-tc" style="font-size:0.68rem; margin-left:4px;">${App.Utils.escapeHtml(r.cuenta_imputada_nombre)}</span>`;
      }

      const importeFmt = r.moneda === 'USD'
        ? 'USD ' + Number(r.importe || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : App.Utils.formatearMoneda(r.importe);

      return `
        <div class="dh-drill-row" data-id="${id}">
          <div class="dh-col-main">
            <div class="dh-item-icon icon-subtle">
              ${getCatIconSvg(catName)}
            </div>
            <div class="dh-col-desc-wrap">
              <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
                <span class="dh-row-desc">${App.Utils.escapeHtml(desc)}</span>
                ${badgesHtml}
              </div>
              <span class="dh-row-date">${fechaStr} • <strong style="color:var(--texto-2);">${App.Utils.escapeHtml(tcName)}</strong></span>
            </div>
          </div>
          <div class="dh-col-cat">
            <span class="dh-cat-pill">${App.Utils.escapeHtml(catName)}</span>
          </div>
          <div class="dh-col-medio">
            <button type="button" class="btn-toggle-pago ${isPaid ? 'pago-saldado' : 'pago-pendiente'}"
                    data-toggle-pago-tc="${id}"
                    title="${isPaid ? 'Saldado (Clic para marcar como pendiente)' : 'Pendiente (Clic para marcar como saldado)'}">
              ${isPaid ? '✓ Saldado' : '⏳ Pendiente'}
            </button>
          </div>
          <div class="dh-col-amount negativo">
            ${importeFmt}
          </div>
          <div class="dh-col-action">
            <button class="btn-icon-sm dh-row-btn" title="Ver detalle">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    listEl.innerHTML = `<div class="dh-rows-list">${rowsHtml}</div>`;

    // Row click listeners for detail modal
    listEl.querySelectorAll('.dh-drill-row').forEach(rowEl => {
      rowEl.addEventListener('click', (e) => {
        if (e.target.closest('.btn-toggle-pago')) return;
        const id = rowEl.dataset.id;
        const row = this.#allConsumos.find(c => (c.id_consumo_tc || c.id_consumo_tarjeta) == id);
        if (row) this.#abrirModalDetalle(row);
      });
    });
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
      <div class="tc-taxes-accordion" id="tc-taxes-accordion" style="margin-top:12px; border:1px solid var(--borde); border-radius:10px; overflow:hidden; background:var(--fondo);">
        <div class="tc-taxes-header" id="tc-taxes-toggle" role="button" tabindex="0" title="Ver desglose detallado de impuestos" style="padding:10px 14px; display:flex; align-items:center; justify-content:space-between; cursor:pointer; background:var(--bg-2); user-select:none;">
          <div class="tc-taxes-header-left" style="display:flex; align-items:center; gap:8px;">
            <span class="tc-taxes-icon">🏛️</span>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="tc-taxes-title" style="font-weight:600; font-size:0.8rem; color:var(--texto);">Impuestos del Resumen</span>
              <span class="tc-taxes-badge" style="font-size:0.7rem; padding:1px 6px; border-radius:10px; background:rgba(239,68,68,0.1); color:var(--rojo); font-weight:700;">${taxes.length} ${taxes.length === 1 ? 'ítem' : 'ítems'}</span>
            </div>
          </div>
          <div class="tc-taxes-header-right" style="display:flex; align-items:center; gap:8px;">
            <span class="tc-taxes-total-val negativo" style="font-weight:700; font-size:0.85rem;">${App.Utils.formatearMoneda(totalImpuestos)}</span>
            <svg class="tc-taxes-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="tc-taxes-body" style="padding:8px 12px; font-size:0.78rem; border-top:1px dashed var(--borde-1); display:none;" id="tc-taxes-content">
          ${taxes.map(t => `
            <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--borde-1);">
              <span style="color:var(--texto-2);">${App.Utils.escapeHtml(t.descripcion)}</span>
              <strong style="color:var(--rojo);">${App.Utils.formatearMoneda(t.importe)}</strong>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    const toggle = document.getElementById('tc-taxes-toggle');
    const content = document.getElementById('tc-taxes-content');
    if (toggle && content) {
      toggle.addEventListener('click', () => {
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? 'block' : 'none';
        const chevron = toggle.querySelector('.tc-taxes-chevron');
        if (chevron) chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
      });
    }
  }

  #renderMoneyFlowChart() {
    const canvas = document.getElementById('tc-moneyflow-canvas');
    if (!canvas) return;

    const currentMes = App.Store.mes || new Date().toISOString().substring(0, 7);
    const currentYear = currentMes.substring(0, 4);

    // Build timeline using this.#proyeccionesData
    let dataList = (this.#proyeccionesData || []).map(p => ({
      mes: p.mes,
      total: Number(p.total || 0),
      consumos: Number(p.subtotal_consumos !== undefined ? p.subtotal_consumos : p.total || 0),
      impuestos: Number(p.impuestos?.total_impuestos || 0)
    }));

    // If proyecciones are empty, build fallback from current month consumos
    if (!dataList.length) {
      const currTotal = (this.#allConsumos || []).reduce((acc, c) => acc + (c.moneda === 'USD' ? 0 : Number(c.importe || 0)), 0);
      dataList = [{ mes: currentMes, total: currTotal, consumos: currTotal, impuestos: 0 }];
    }

    // Filter by selected period
    let filtered = [];
    if (this.#moneyFlowPeriod === 'YTD') {
      filtered = dataList.filter(d => d.mes.startsWith(currentYear));
      if (!filtered.length) filtered = dataList.slice(0, 6);
    } else if (this.#moneyFlowPeriod === '12M') {
      filtered = dataList.slice(0, 12);
    } else { // 6M
      filtered = dataList.slice(0, 6);
    }

    const subEl = document.getElementById('tc-moneyflow-sub');
    if (subEl) {
      if (this.#moneyFlowPeriod === '6M') subEl.textContent = 'Evolución y vencimientos próximos 6 meses';
      else if (this.#moneyFlowPeriod === '12M') subEl.textContent = 'Proyección completa a 12 meses';
      else subEl.textContent = `Vencimientos del año ${currentYear}`;
    }

    this.#evolucionChartInstance?.destroy();
    const ctx = canvas.getContext('2d');
    const labels = filtered.map(d => App.Utils.formatearMes(d.mes));
    const totals = filtered.map(d => Math.round(d.total));

    this.#evolucionChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Total Resumen',
          data: totals,
          backgroundColor: '#1D195D',
          borderRadius: 5,
          barPercentage: 0.65,
          categoryPercentage: 0.8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => {
                const val = context.parsed.y || 0;
                return ` Resumen: $ ${val.toLocaleString('es-AR')}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11, family: 'Inter, sans-serif' }, color: 'var(--texto-3)' }
          },
          y: {
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: {
              font: { size: 10, family: 'Inter, sans-serif' },
              color: 'var(--texto-3)',
              callback: (v) => '$ ' + (v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : (v / 1000).toFixed(0) + 'k')
            }
          }
        }
      }
    });

    // Summary under chart
    const sumEl = document.getElementById('tc-moneyflow-summary');
    if (sumEl && filtered.length > 0) {
      const sumTotal = totals.reduce((a, b) => a + b, 0);
      const avg = sumTotal / filtered.length;
      const maxVal = Math.max(...totals);
      const maxItem = filtered.find(f => Math.round(f.total) === maxVal);
      sumEl.innerHTML = `
        <div class="finset-chart-summary-item">
          <span class="finset-chart-summary-label">Promedio mensual</span>
          <span class="finset-chart-summary-val">${App.Utils.formatearMoneda(avg)}</span>
        </div>
        <div class="finset-chart-summary-item">
          <span class="finset-chart-summary-label">Mes con mayor cargo</span>
          <span class="finset-chart-summary-val">${maxItem ? App.Utils.formatearMes(maxItem.mes) : '—'} (${App.Utils.formatearMoneda(maxVal)})</span>
        </div>
        <div class="finset-chart-summary-item">
          <span class="finset-chart-summary-label">Total proyectado (${this.#moneyFlowPeriod})</span>
          <span class="finset-chart-summary-val negativo">${App.Utils.formatearMoneda(sumTotal)}</span>
        </div>
      `;
    }
  }

  #renderGraficos() {
    const canvas = document.getElementById('tc-categories-donut-canvas');
    const legendEl = document.getElementById('tc-categories-legend');
    const centerValEl = document.getElementById('tc-donut-center-val');
    const centerLblEl = document.getElementById('tc-donut-center-label');
    const subEl = document.getElementById('tc-categories-subtitle');

    let pool = (this.#allConsumos || []).filter(c => !this.#isTaxConsumo(c));
    if (this.#selectedTcId) {
      pool = pool.filter(c => c.id_tarjeta === this.#selectedTcId);
    }

    const isByCard = this.#catMetric === 'tarjeta';
    if (subEl) subEl.textContent = isByCard ? 'Distribución por tarjeta' : 'Distribución por categorías';
    if (centerLblEl) centerLblEl.textContent = isByCard ? 'Por Tarjeta' : 'Total Consumos';

    const totalMetric = pool.reduce((acc, c) => acc + (c.moneda === 'USD' ? 0 : Number(c.importe || 0)), 0);
    if (centerValEl) {
      centerValEl.textContent = App.Utils.formatearMoneda(totalMetric);
    }

    if (!pool.length || totalMetric <= 0) {
      this.#chartInstance?.destroy();
      if (legendEl) {
        legendEl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--texto-3);font-size:0.85rem;">No hay consumos registrados</div>`;
      }
      return;
    }

    const groupMap = {};
    pool.forEach(c => {
      if (c.moneda === 'USD') return;
      const key = isByCard ? (c.tarjeta_nombre || 'Otras') : (c.categoria_nombre || 'General');
      const imp = Number(c.importe || 0);
      if (!groupMap[key]) groupMap[key] = { total: 0, count: 0 };
      groupMap[key].total += imp;
      groupMap[key].count += 1;
    });

    const sorted = Object.entries(groupMap)
      .map(([name, d]) => ({
        name,
        total: d.total,
        count: d.count,
        pct: (d.total / totalMetric) * 100
      }))
      .sort((a, b) => b.total - a.total);

    const palette = [
      '#1D195D', '#2563EB', '#0EA5E9', '#10B981', '#8B5CF6',
      '#F59E0B', '#EF4444', '#4F46E5', '#64748B'
    ];

    if (legendEl) {
      const top5 = sorted.slice(0, 5);
      legendEl.innerHTML = top5.map((item, idx) => {
        const color = palette[idx % palette.length];
        return `
          <div class="fintech-legend-item">
            <div class="fintech-legend-left" title="${App.Utils.escapeHtml(item.name)}">
              <span class="fintech-legend-dot" style="background:${color};"></span>
              <span style="color:var(--texto);">${App.Utils.escapeHtml(item.name)}</span>
            </div>
            <div class="fintech-legend-right">
              <span style="font-size:0.75rem;color:var(--texto-3);min-width:38px;text-align:right;">${item.pct.toFixed(1)}%</span>
              <span style="font-size:0.82rem;font-weight:600;color:var(--texto);">${App.Utils.formatearMoneda(item.total)}</span>
            </div>
          </div>
        `;
      }).join('');
    }

    if (canvas) {
      this.#chartInstance?.destroy();
      const ctx = canvas.getContext('2d');
      this.#chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: sorted.map(s => s.name),
          datasets: [{
            data: sorted.map(s => Math.round(s.total)),
            backgroundColor: sorted.map((_, i) => palette[i % palette.length]),
            borderColor: '#ffffff',
            borderWidth: 2,
            hoverOffset: 5
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '74%',
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const val = context.parsed || 0;
                  const pct = ((val / totalMetric) * 100).toFixed(1);
                  return ` ${context.label}: $ ${val.toLocaleString('es-AR')} (${pct}%)`;
                }
              }
            }
          }
        }
      });
    }
  }

  #updateTopeKpi(saldoTotal) {
    let tope = { topePorcentaje: 25 };
    try {
      const stored = localStorage.getItem('fluxo_tope_tc');
      if (stored) tope = JSON.parse(stored);
    } catch (_) {}

    const topePct = Number(tope.topePorcentaje) || 25;
    const targetEl = document.getElementById('tc-tope-kpi-target');
    if (targetEl) targetEl.textContent = `Tope: ${topePct}% de ingresos`;

    // Estimate user monthly income from store or movements
    const monthlyIncome = Number(App.Store.kpis?.ingresos || 0);
    const valEl = document.getElementById('tc-tope-kpi-val');
    const fillEl = document.getElementById('tc-tope-progress-fill');
    const subEl = document.getElementById('tc-tope-kpi-sub');
    const statusPill = document.getElementById('tc-tope-status-pill');

    if (monthlyIncome <= 0) {
      if (valEl) valEl.textContent = 'En rango';
      if (fillEl) fillEl.style.width = '15%';
      if (subEl) subEl.textContent = 'Configurá tus ingresos';
      if (statusPill) statusPill.innerHTML = '<span>Salud OK</span>';
      return;
    }

    const actualPct = (saldoTotal / monthlyIncome) * 100;
    const ratio = actualPct / topePct;
    const progressWidth = Math.min(100, Math.round(ratio * 100));

    if (fillEl) fillEl.style.width = `${progressWidth}%`;
    if (subEl) subEl.textContent = `${actualPct.toFixed(1)}% de ingresos consumido`;

    if (ratio <= 0.8) {
      if (valEl) { valEl.textContent = `${actualPct.toFixed(0)}%`; valEl.style.color = 'var(--verde)'; }
      if (fillEl) fillEl.style.background = 'var(--verde)';
      if (statusPill) { statusPill.className = 'finset-trend-pill trend-up'; statusPill.innerHTML = '<span>Salud OK</span>'; }
    } else if (ratio <= 1.0) {
      if (valEl) { valEl.textContent = `${actualPct.toFixed(0)}%`; valEl.style.color = 'var(--amarillo-text, #F59E0B)'; }
      if (fillEl) fillEl.style.background = 'var(--amarillo, #F59E0B)';
      if (statusPill) { statusPill.className = 'finset-trend-pill trend-neutral'; statusPill.innerHTML = '<span>Alerta</span>'; }
    } else {
      if (valEl) { valEl.textContent = `${actualPct.toFixed(0)}%`; valEl.style.color = 'var(--rojo)'; }
      if (fillEl) fillEl.style.background = 'var(--rojo)';
      if (statusPill) { statusPill.className = 'finset-trend-pill trend-down'; statusPill.innerHTML = '<span>Excedido</span>'; }
    }
  }

  #abrirModalTopeTC() {
    let tope = { topePorcentaje: 25 };
    try {
      const stored = localStorage.getItem('fluxo_tope_tc');
      if (stored) tope = JSON.parse(stored);
    } catch (_) {}

    const modal = new App.Modal('modal-tc-tope');
    modal.open({
      titulo: 'Configurar Tope de Tarjeta de Crédito',
      icono: 'credit_card',
      body: `
        <form id="form-tc-tope" style="display:flex; flex-direction:column; gap:14px;">
          <div>
            <label style="font-size:0.85rem; font-weight:600; color:var(--texto-2);">Tope de gasto con Tarjetas (% de tus ingresos)</label>
            <p style="font-size:0.8rem; color:var(--texto-3); margin:4px 0 8px;">Recomendación financiera: no superar el 25% - 30% de tus ingresos en cuotas y consumos con tarjeta.</p>
            <div style="display:flex; align-items:center; gap:8px;">
              <input class="input" type="number" name="topePorcentaje" min="5" max="100" step="1" value="${tope.topePorcentaje || 25}" required style="width:120px;">
              <span style="font-weight:700; color:var(--texto); font-size:1rem;">%</span>
            </div>
          </div>
        </form>
      `,
      confirmLabel: 'Guardar Tope',
      onConfirm: (m) => {
        const form = document.getElementById('form-tc-tope');
        if (!form) return;
        const fd = new FormData(form);
        const topePorcentaje = Number(fd.get('topePorcentaje')) || 25;
        const nuevoTope = { topePorcentaje, topeMonto: null };
        localStorage.setItem('fluxo_tope_tc', JSON.stringify(nuevoTope));
        App.Events.emit('tope_tc:updated', nuevoTope);
        App.Toast.success('Tope de tarjeta actualizado.');
        m.close();
        this._render({ success: true, consumos: this.#allConsumos });
      }
    });
  }

  async #confirmarPagarResumen() {
    const activeCard = this.#selectedTcId
      ? this.#tarjetas.find(t => t.id_tarjeta === this.#selectedTcId)
      : null;

    const nombreTc = activeCard?.nombre || 'todas las tarjetas (Consolidado)';
    const consumosAPagar = this.#selectedTcId
      ? (this.#allConsumos || []).filter(c => c.id_tarjeta === this.#selectedTcId)
      : (this.#allConsumos || []);

    let totalAPagar = 0;
    if (activeCard) {
      totalAPagar = (activeCard.total_resumen_ars && Number(activeCard.total_resumen_ars) > 0)
        ? Number(activeCard.total_resumen_ars)
        : consumosAPagar.reduce((acc, c) => acc + (c.moneda === 'USD' ? 0 : Number(c.importe || 0)), 0);
    } else {
      this.#tarjetas.forEach(tc => {
        const cardConsumos = (this.#allConsumos || []).filter(c => c.id_tarjeta === tc.id_tarjeta);
        const cardSum = cardConsumos.reduce((acc, c) => acc + (c.moneda === 'USD' ? 0 : Number(c.importe || 0)), 0);
        totalAPagar += (tc.total_resumen_ars && Number(tc.total_resumen_ars) > 0) ? Number(tc.total_resumen_ars) : cardSum;
      });
    }

    const modal = new App.Modal('modal-tc-pagar-resumen');
    modal.open({
      titulo: activeCard ? `Confirmar Pago: ${activeCard.nombre}` : 'Confirmar Pago de Resumen (Consolidado)',
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
            Se marcarán como <strong>Saldados</strong> los ${consumosAPagar.length} consumos del período actual${activeCard ? ' de ' + App.Utils.escapeHtml(activeCard.nombre) : ' de todas las tarjetas'}.
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