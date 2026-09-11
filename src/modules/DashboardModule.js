'use strict';
import Chart from 'chart.js/auto';
/* ============================================================
   module-dashboard.html — v6.0.0
   Dashboard unificado One-Page App.
   Muestra KPIs globales, acordeón de movimientos,
   tarjetas de crédito con modales, gastos compartidos y ahorro.
   ============================================================ */

export class DashboardModule extends BaseModule {

  get moduleId() { return 'dashboard'; }
  get vistaId()  { return 'vista-dashboard'; }

  get _createEndpoint() { return null; }
  get _updateEndpoint() { return null; }
  get _deleteEndpoint() { return null; }

  #movData     = [];
  #viewMode = 'detail'; // 'portfolio' | 'detail'
  #drilldownOpen = false;
  #drilldownFilter = 'ALL'; // 'ALL' | 'INGRESO' | 'EGRESO'
  #drilldownSearch = '';
  #donutChartInstance = null;
  #evolucionChartInstance = null;
  #moneyFlowChartInstance = null;
  #categoriesDonutInstance = null;
  #evolucionMode = 'ingresos_vs_gastos'; // 'ingresos_vs_gastos' | 'balance'
  #donutMetric = 'gastos'; // 'gastos' | 'ingresos'
  #recentsFilter = 'ALL'; // 'ALL' | 'INGRESO' | 'EGRESO'
  #recentsSearch = '';
  #ahorroTotal = 0;
  #inversionesTotal = 0;
  #evolucionMensual = [];
  #kpisData = {};

  get movData() { return this.#movData; }

  // --- SECCIÓN 1: CICLO DE VIDA ---

  init() {
    this._buildVista();
    this._bindListeners();
    this._subscribeEvents();
    App.log('DashboardModule', 'init', 'Dashboard unificado iniciado');
  }

  destruir() {
    this.#moneyFlowChartInstance?.destroy();
    this.#categoriesDonutInstance?.destroy();
    this.#donutChartInstance?.destroy();
    this.#evolucionChartInstance?.destroy();
    super.destruir();
  }

  async cargar() {
    await this.#cargarDetail();
  }

  async #cargarPortfolio() {
    const cuentas = App.Store.cuentas;
    const mes = App.Store.mes;
    if (!cuentas.length || !mes) return;

    // Show portfolio, hide detail
    const pEl = document.getElementById('dash-portfolio-view');
    const dEl = document.getElementById('dash-detail-view');
    if (pEl) pEl.style.display = '';
    if (dEl) dEl.style.display = 'none';

    const { fechaInicio, fechaFin } = this.#calcFechas(mes);
    const grid = document.getElementById('dash-portfolio-grid');
    if (!grid) return;

    const ICON_SVG = {
      home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
      briefcase: '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
      wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>',
      piggy: '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/>',
      building: '<rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M9 22v-4h6v4"/>',
      user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/>',
      star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'
    };

    grid.innerHTML = cuentas.map(c => {
      const iconSvg = ICON_SVG[c.icono] || ICON_SVG.home;
      return `
      <div class="portfolio-card" data-cuenta-id="${c.id_cuenta_principal}">
        <div class="portfolio-card-header">
          <span class="portfolio-card-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconSvg}</svg>
          </span>
          <span class="portfolio-card-name">${App.Utils.escapeHtml(c.nombre)}</span>
        </div>
        <div class="portfolio-card-kpis">
          <div class="portfolio-kpi">
            <span class="portfolio-kpi-label">Ingresos</span>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="portfolio-kpi-icon kpi-green"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></span>
              <span class="portfolio-kpi-val positivo" id="pf-ing-${c.id_cuenta_principal}">—</span>
            </div>
          </div>
          <div class="portfolio-kpi">
            <span class="portfolio-kpi-label">Gastos</span>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="portfolio-kpi-icon kpi-red"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg></span>
              <span class="portfolio-kpi-val negativo" id="pf-egr-${c.id_cuenta_principal}">—</span>
            </div>
          </div>
          <div class="portfolio-kpi portfolio-kpi-balance">
            <span class="portfolio-kpi-label">Balance</span>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="portfolio-kpi-icon kpi-blue"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></span>
              <span class="portfolio-kpi-val" id="pf-bal-${c.id_cuenta_principal}">—</span>
            </div>
          </div>
        </div>
        <div class="portfolio-card-footer">Ver detalle →</div>
      </div>`;
    }).join('');

    // Bind click
    grid.querySelectorAll('.portfolio-card').forEach(card => {
      card.addEventListener('click', () => {
        const cid = card.dataset.cuentaId;
        this.#enterDetailMode(cid);
      });
    });

    // Load KPIs for each account in parallel
    cuentas.forEach(async (c) => {
      try {
        const resp = await App.API.swr(
          'api_getDashboardData',
          [c.id_cuenta_principal, fechaInicio, fechaFin, c.requiere_ajuste_cc_tc ?? false],
          App.API.defaultTtl
        );
        const d = resp.data;
        if (d?.success) {
          const ingEl = document.getElementById(`pf-ing-${c.id_cuenta_principal}`);
          const egrEl = document.getElementById(`pf-egr-${c.id_cuenta_principal}`);
          const balEl = document.getElementById(`pf-bal-${c.id_cuenta_principal}`);
          if (ingEl) ingEl.textContent = App.Utils.formatearMoneda(d.kpis.ingresos);
          if (egrEl) egrEl.textContent = App.Utils.formatearMoneda(d.kpis.egresos);
          if (balEl) {
            balEl.textContent = App.Utils.formatearMoneda(d.kpis.resultado);
            balEl.className = 'portfolio-kpi-val ' + (d.kpis.resultado >= 0 ? 'positivo' : 'negativo');
          }
        }
      } catch (_) {}
    });
  }

  #enterDetailMode(cuentaId) {
    this.#viewMode = 'detail';
    App.Store.setCuenta(cuentaId);
    const sel = document.getElementById('selector-cuenta');
    if (sel) sel.value = cuentaId;
    const pEl = document.getElementById('dash-portfolio-view');
    const dEl = document.getElementById('dash-detail-view');
    if (pEl) pEl.style.display = 'none';
    if (dEl) dEl.style.display = '';
    this.#renderDetailNav(cuentaId);
    this.#cargarDetail();
    App.updateAccountSelectorVisibility();
  }

  #exitToPortfolio() {
    this.#viewMode = 'portfolio';
    this.#cargarPortfolio();
    App.updateAccountSelectorVisibility();
  }

  #renderDetailNav(cuentaId) {
    const nav = document.getElementById('dash-detail-nav');
    if (!nav) return;
    const cuentas = App.Store.cuentas;
    const current = cuentas.find(c => c.id_cuenta_principal === cuentaId);

    nav.innerHTML = `
      <button class="btn btn-ghost btn-sm dash-back-btn" id="dash-back-portfolio">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Portfolio
      </button>
      <div class="dash-detail-nav-center">
        <span class="dash-detail-nav-title">${App.Utils.escapeHtml(current?.nombre || '')}</span>
      </div>
    `;

    // Bind nav events
    document.getElementById('dash-back-portfolio')?.addEventListener('click', () => this.#exitToPortfolio());
  }

  async #cargarDetail() {
    const { cuenta, mes } = App.Store;
    if (!cuenta || !mes) return;

    const { fechaInicio, fechaFin } = this.#calcFechas(mes);
    const cuentaObj      = App.Store.cuentas.find(c => c.id_cuenta_principal === cuenta);
    const requiereAjuste = cuentaObj?.requiere_ajuste_cc_tc ?? false;

    // Toggle detailed module card scorecards based on active settings
    const cardTarjetas = document.getElementById('dash-card-tarjetas');
    const cardCC = document.getElementById('dash-card-cc');
    const cardAhorro = document.getElementById('dash-card-ahorro');
    const cardInversiones = document.getElementById('dash-card-inversiones');

    const hasTarjetas = (cuentaObj?.modulo_tarjetas_activo ?? true) || (window._appTarjetas || []).some(t => t.id_cuenta_principal === cuentaObj?.id_cuenta_principal);
    const hasAhorro = (cuentaObj?.modulo_ahorro_activo ?? true) || (window._appSubcuentas || []).some(s => s.id_cuenta_principal === cuentaObj?.id_cuenta_principal);

    if (cardTarjetas) cardTarjetas.style.display = hasTarjetas ? '' : 'none';
    if (cardCC) cardCC.style.display = (cuentaObj?.modulo_cc_activo ?? true) ? '' : 'none';
    if (cardAhorro) cardAhorro.style.display = hasAhorro ? '' : 'none';
    if (cardInversiones) cardInversiones.style.display = (cuentaObj?.modulo_inversiones_activo ?? true) ? '' : 'none';

    this.#mostrarKpiSkeletons();

    try {
      const resp = await App.API.swr(
        'api_getDashboardData',
        [cuenta, fechaInicio, fechaFin, requiereAjuste],
        App.API.defaultTtl,
        (freshData) => { if (freshData?.success) this._render(freshData); }
      );
      this._render(resp.data);
      
      if (hasTarjetas) {
        this.#loadTarjetas(cuenta, fechaInicio, fechaFin);
      }
      if (cuentaObj?.modulo_cc_activo) {
        this.#loadCC(cuenta, fechaInicio, fechaFin);
      }
      if (hasAhorro) {
        this.#loadAhorro(cuenta, fechaInicio, fechaFin);
      }
      if (cuentaObj?.modulo_inversiones_activo) {
        this.#loadInversiones(cuenta);
      }
    } catch (err) {
      App.error('DashboardModule', 'cargar', 'Error', err);
      App.Toast.error('Error al cargar dashboard: ' + (err.message || 'Error desconocido'));
    }
  }

  // --- SECCIÓN 2: RENDER PRINCIPAL ---

  _render(data) {
    if (!data?.success) return;

    const { kpis, movimientos } = data;

    const saldoValEl = document.getElementById('dash-saldo-val');
    const convValEl = document.getElementById('dash-conversion-val');
    const breakdownIngresosEl = document.getElementById('dash-breakdown-ingresos');
    const breakdownEgresosEl = document.getElementById('dash-breakdown-egresos');

    const curr = App.Store.monedaGlobal || 'ARS';
    const rate = App.Store.exchangeRate || 1540;

    if (saldoValEl) {
      saldoValEl.textContent = App.Utils.formatearMoneda(kpis.resultado);
      saldoValEl.classList.toggle('negativo', kpis.resultado < 0);
    }

    if (convValEl) {
      if (curr === 'ARS') {
        const usdEquiv = (kpis.resultado || 0) / (rate || 1540);
        convValEl.textContent = `≈ US$ ${Math.abs(usdEquiv).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      } else {
        const arsEquiv = (kpis.resultado || 0) * (rate || 1540);
        convValEl.textContent = `≈ $ ${Math.abs(arsEquiv).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ARS`;
      }
    }

    if (breakdownIngresosEl) {
      breakdownIngresosEl.textContent = App.Utils.formatearMoneda(kpis.ingresos);
    }
    if (breakdownEgresosEl) {
      breakdownEgresosEl.textContent = App.Utils.formatearMoneda(kpis.egresos);
    }

    this.#movData = movimientos || [];
    this.#evolucionMensual = data?.evolucionMensual || [];
    this.#kpisData = kpis || {};

    // Calculate trends vs previous month from evolucionMensual
    const hist = this.#evolucionMensual;
    const currentMes = App.Store.mes;
    const currIdx = hist.findIndex(h => h.mes === currentMes);
    let prev = null;
    if (currIdx > 0) {
      prev = hist[currIdx - 1];
    } else if (hist.length >= 2) {
      prev = hist[hist.length - 2];
    }

    const balTrendEl = document.getElementById('dash-balance-trend');
    if (balTrendEl) {
      if (prev && typeof prev.balance === 'number' && prev.balance !== 0) {
        const diff = (kpis.resultado || 0) - prev.balance;
        const pct = Math.abs(prev.balance) > 0 ? Math.min(Math.abs((diff / prev.balance) * 100), 999).toFixed(1) : 0;
        const isUp = diff >= 0;
        balTrendEl.className = `finset-trend-pill ${isUp ? 'trend-up' : 'trend-down'}`;
        balTrendEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="${isUp ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}"/></svg><span>${isUp ? '+' : '-'}${pct}%</span>`;
      } else {
        balTrendEl.className = 'finset-trend-pill trend-up';
        balTrendEl.innerHTML = '<span>Neto</span>';
      }
    }

    const ingTrendEl = document.getElementById('dash-ingresos-trend');
    if (ingTrendEl) {
      if (prev && prev.ingresos > 0) {
        const diff = (kpis.ingresos || 0) - prev.ingresos;
        const pct = Math.min(Math.abs((diff / prev.ingresos) * 100), 999).toFixed(1);
        const isUp = diff >= 0;
        ingTrendEl.className = `finset-trend-pill ${isUp ? 'trend-up' : 'trend-down'}`;
        ingTrendEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="${isUp ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}"/></svg><span>${isUp ? '+' : '-'}${pct}%</span>`;
      } else {
        ingTrendEl.className = 'finset-trend-pill trend-up';
        ingTrendEl.innerHTML = '<span>Ingresos</span>';
      }
    }

    const gasTrendEl = document.getElementById('dash-gastos-trend');
    if (gasTrendEl) {
      if (prev && prev.egresos > 0) {
        const diff = (kpis.egresos || 0) - prev.egresos;
        const pct = Math.min(Math.abs((diff / prev.egresos) * 100), 999).toFixed(1);
        const spentMore = diff > 0;
        gasTrendEl.className = `finset-trend-pill ${spentMore ? 'trend-down' : 'trend-up'}`;
        gasTrendEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="${spentMore ? '6 9 12 15 18 9' : '18 15 12 9 6 15'}"/></svg><span>${spentMore ? '+' : '-'}${pct}%</span>`;
      } else {
        gasTrendEl.className = 'finset-trend-pill trend-neutral';
        gasTrendEl.innerHTML = '<span>Gastos</span>';
      }
    }

    // Render FinSet Widgets
    this.#renderMoneyFlowChart();
    this.#renderTopCategoriesWidget();
    this.#renderRecentTransactions();

    if (this.#drilldownOpen) {
      this.#renderDrilldown();
    }
  }

  // --- SECCIÓN 3: BUILD DOM ---

  _buildVista() {
    const vista = document.getElementById(this.vistaId);
    if (!vista) return;

    vista.innerHTML = `
      <!-- MULTI-ACCOUNT PORTFOLIO VIEW -->
      <div id="dash-portfolio-view" style="display: none;">
        <div class="portfolio-header" style="margin-bottom:20px;">
          <h2 class="portfolio-title" style="font-size:1.4rem;font-weight:800;color:var(--texto);">Mis Cuentas</h2>
          <p class="portfolio-sub" style="font-size:0.85rem;color:var(--texto-3);">Selecciona una cuenta para ver su desglose patrimonial</p>
        </div>
        <div class="portfolio-grid" id="dash-portfolio-grid"></div>
      </div>

      <!-- SINGLE ACCOUNT DETAIL VIEW (FinSet Dashboard Grid) -->
      <div id="dash-detail-view">

        <!-- Navigation back to portfolio when in detail -->
        <div id="dash-detail-nav" class="dash-detail-nav" style="display:none;margin-bottom:18px;"></div>

        <div class="finset-dashboard">
          
          <!-- ═══ ROW 1: 4 TOP KPI CARDS ═══ -->
          <div class="finset-kpi-row" id="dash-kpi-grid">
            
            <!-- Card 1: Balance Total -->
            <div class="finset-kpi-card" id="dash-saldo-card">
              <div class="finset-kpi-header">
                <div class="finset-kpi-title-wrap">
                  <div class="finset-kpi-icon icon-navy">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>
                  </div>
                  <span class="finset-kpi-title">Balance Total</span>
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                  <button class="fhc-visibility-btn" id="btn-toggle-privacy" title="Ocultar/Mostrar saldo" aria-label="Alternar privacidad">
                    <svg id="icon-eye-open" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    <svg id="icon-eye-closed" class="hidden" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  </button>
                  <button class="finset-arrow-btn" id="btn-expand-balance" title="Ver movimientos">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
                  </button>
                </div>
              </div>
              <div class="finset-kpi-value" id="dash-saldo-val">$ 0,00</div>
              <div class="finset-kpi-footer">
                <span class="finset-kpi-subtext" id="dash-conversion-val">≈ US$ 0,00</span>
                <span class="finset-trend-pill trend-up" id="dash-balance-trend">
                  <span>Neto</span>
                </span>
              </div>
            </div>

            <!-- Card 2: Ingresos Totales -->
            <div class="finset-kpi-card" id="dash-kpi-card-ingresos">
              <div class="finset-kpi-header">
                <div class="finset-kpi-title-wrap">
                  <div class="finset-kpi-icon icon-green">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
                  </div>
                  <span class="finset-kpi-title">Ingresos Totales</span>
                </div>
                <button class="finset-arrow-btn" id="btn-expand-ingresos" title="Filtrar ingresos">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
                </button>
              </div>
              <div class="finset-kpi-value positivo" id="dash-breakdown-ingresos">$ 0,00</div>
              <div class="finset-kpi-footer">
                <span class="finset-kpi-subtext">Entradas del mes</span>
                <span class="finset-trend-pill trend-up" id="dash-ingresos-trend">
                  <span>Ingresos</span>
                </span>
              </div>
            </div>

            <!-- Card 3: Gastos Totales -->
            <div class="finset-kpi-card" id="dash-kpi-card-gastos">
              <div class="finset-kpi-header">
                <div class="finset-kpi-title-wrap">
                  <div class="finset-kpi-icon icon-red">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>
                  </div>
                  <span class="finset-kpi-title">Gastos Totales</span>
                </div>
                <button class="finset-arrow-btn" id="btn-expand-gastos" title="Filtrar gastos">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
                </button>
              </div>
              <div class="finset-kpi-value negativo" id="dash-breakdown-egresos">$ 0,00</div>
              <div class="finset-kpi-footer">
                <span class="finset-kpi-subtext">Consumos y débitos</span>
                <span class="finset-trend-pill trend-down" id="dash-gastos-trend">
                  <span>Gastos</span>
                </span>
              </div>
            </div>

            <!-- Card 4: Ahorro & Metas -->
            <div class="finset-kpi-card" id="dash-kpi-card-ahorro">
              <div class="finset-kpi-header">
                <div class="finset-kpi-title-wrap">
                  <div class="finset-kpi-icon icon-purple">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>
                  </div>
                  <span class="finset-kpi-title">Ahorro & Metas</span>
                </div>
                <button class="finset-arrow-btn" id="btn-expand-ahorro" title="Ver alcancías de ahorro">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
                </button>
              </div>
              <div class="finset-kpi-value" id="dash-ahorro-kpi-val">$ 0,00</div>
              <div class="finset-kpi-footer">
                <span class="finset-kpi-subtext">Alcancías y reservas</span>
                <span class="finset-trend-pill trend-neutral" id="dash-ahorro-trend">
                  <span>Metas</span>
                </span>
              </div>
            </div>

          </div>

          <!-- ═══ ROW 2: ANALYTICS & INSIGHTS (Money Flow + Top Categories) ═══ -->
          <div class="finset-grid-2col">
            
            <!-- Left (60%): Money Flow / Evolución Mensual -->
            <div class="finset-card" id="dash-widget-moneyflow">
              <div class="finset-card-header">
                <div class="finset-card-title-wrap">
                  <h3 class="finset-card-title">Flujo de Fondos</h3>
                  <span class="finset-card-subtitle">Evolución histórica últimos 6 meses</span>
                </div>
                <div class="fintech-pill-switch" id="dash-moneyflow-switch">
                  <button class="fintech-pill-btn active" data-mode="ingresos_vs_gastos">Ingresos vs Gastos</button>
                  <button class="fintech-pill-btn" data-mode="balance">Balance</button>
                </div>
              </div>
              <div style="position:relative; width:100%; height:230px; margin: 4px 0;">
                <canvas id="dash-moneyflow-canvas"></canvas>
              </div>
              <div class="finset-chart-summary" id="dash-moneyflow-summary"></div>
            </div>

            <!-- Right (40%): Top Categorías -->
            <div class="finset-card" id="dash-widget-categories">
              <div class="finset-card-header">
                <div class="finset-card-title-wrap">
                  <h3 class="finset-card-title">Top Categorías</h3>
                  <span class="finset-card-subtitle" id="dash-categories-subtitle">Distribución de gastos</span>
                </div>
                <div class="fintech-pill-switch" id="dash-categories-switch">
                  <button class="fintech-pill-btn active" data-metric="gastos">% Gastos</button>
                  <button class="fintech-pill-btn" data-metric="ingresos">% Ingresos</button>
                </div>
              </div>
              
              <div class="fintech-donut-wrapper" style="height:190px;">
                <canvas id="dash-categories-donut-canvas"></canvas>
                <div class="fintech-donut-center" id="dash-categories-donut-center">
                  <span class="fintech-donut-center-label" id="dash-donut-center-label">Total Gastos</span>
                  <span class="fintech-donut-center-val" id="dash-donut-center-val" style="color:var(--primary); font-size:1.1rem;">$ 0,00</span>
                </div>
              </div>

              <div class="fintech-legend-list" id="dash-categories-legend" style="margin-top:12px;"></div>
            </div>

          </div>

          <!-- ═══ ROW 3: OPERATIONS & MODULES (Recent Transactions + Fintech Widgets) ═══ -->
          <div class="finset-grid-2col">
            
            <!-- Left (60%): Movimientos Recientes -->
            <div class="finset-card" id="dash-widget-recents">
              <div class="finset-card-header">
                <div class="finset-card-title-wrap">
                  <h3 class="finset-card-title">Movimientos Recientes</h3>
                  <span class="finset-card-subtitle">Últimas operaciones del mes</span>
                </div>
                <div class="finset-card-actions">
                  <div class="dh-search-box" style="margin:0;">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input type="text" id="dash-recents-search" placeholder="Buscar..." class="finset-search-input">
                  </div>
                  <div class="dh-filter-tabs">
                    <button class="dh-tab-btn active" data-filter="ALL" id="dash-recents-tab-all">Todos</button>
                    <button class="dh-tab-btn" data-filter="INGRESO" id="dash-recents-tab-ing">Ingresos</button>
                    <button class="dh-tab-btn" data-filter="EGRESO" id="dash-recents-tab-egr">Gastos</button>
                  </div>
                  <button class="btn btn-ghost btn-sm" id="dash-recents-expand-btn" title="Ver consola completa de movimientos" style="font-weight:700;font-size:0.75rem;padding:4px 10px;gap:4px;">
                    <span>Ver todos</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
                  </button>
                </div>
              </div>

              <!-- Compact Recent List -->
              <div class="finset-recents-body" id="dash-recents-body"></div>
            </div>

            <!-- Right (40%): Módulos Fintech Rápidos -->
            <div class="finset-card" id="dash-widget-modules">
              <div class="finset-card-header">
                <div class="finset-card-title-wrap">
                  <h3 class="finset-card-title">Módulos Financieros</h3>
                  <span class="finset-card-subtitle">Tarjetas, cuentas y metas activas</span>
                </div>
              </div>

              <div class="finset-modules-stack">
                
                <!-- 1. Tarjetas de Crédito Bento Widget -->
                <div class="finset-submodule-card" id="dash-card-tarjetas">
                  <div class="fsc-header">
                    <div class="fsc-tag-wrap">
                      <div class="bc-icon icon-blue" style="width:28px;height:28px;border-radius:8px;">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                      </div>
                      <span style="font-weight:700;font-size:0.85rem;color:var(--texto);">Tarjetas de Crédito</span>
                    </div>
                    <button class="finset-arrow-btn" id="dash-tc-ver-consumos" title="Ver detalle en módulo Tarjetas">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  </div>

                  <!-- Interactive Plastic Card Carousel -->
                  <div class="bc-preview-wrap" style="padding: 10px 0 6px;">
                    <div class="dash-tc-carousel">
                      <button class="dash-tc-arrow" id="dash-tc-prev" disabled><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>
                      <div class="dash-tc-visual" id="dash-tc-visual"></div>
                      <button class="dash-tc-arrow" id="dash-tc-next" disabled><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>
                    </div>
                  </div>
                  <div class="bc-footer" id="dash-tc-subtotal" style="font-size:0.78rem;font-weight:600;color:var(--texto-2);margin-top:4px;">Subtotal: —</div>
                </div>

                <!-- 2. Gastos Compartidos (Cuentas Claras) -->
                <div class="finset-submodule-card" id="dash-card-cc">
                  <div class="fsc-header">
                    <div class="fsc-tag-wrap">
                      <div class="bc-icon icon-purple" style="width:28px;height:28px;border-radius:8px;">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      </div>
                      <div>
                        <div style="font-weight:700;font-size:0.85rem;color:var(--texto);">Gastos Compartidos</div>
                        <div style="font-size:0.72rem;color:var(--texto-3);">Saldo neto a liquidar</div>
                      </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;">
                      <span class="bc-value" id="dash-cc-saldo" style="font-size:1.05rem;font-weight:800;">—</span>
                      <button class="finset-arrow-btn" id="dash-cc-detail" title="Ver detalle de gastos compartidos">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                      </button>
                    </div>
                  </div>
                </div>

                <!-- 3. Chanchito (Alcancías / Ahorro) -->
                <div class="finset-submodule-card" id="dash-card-ahorro">
                  <div class="fsc-header">
                    <div class="fsc-tag-wrap">
                      <div class="bc-icon icon-yellow" style="width:28px;height:28px;border-radius:8px;">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>
                      </div>
                      <div>
                        <div style="font-weight:700;font-size:0.85rem;color:var(--texto);">Chanchito (Ahorro)</div>
                        <div style="font-size:0.72rem;color:var(--texto-3);">Fondo en alcancías para metas</div>
                      </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;">
                      <span class="bc-value positivo" id="dash-ahorro-total" style="font-size:1.05rem;font-weight:800;">—</span>
                      <button class="finset-arrow-btn" id="dash-ahorro-detail" title="Ver alcancías de ahorro">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                      </button>
                    </div>
                  </div>
                </div>

                <!-- 4. Inversiones -->
                <div class="finset-submodule-card" id="dash-card-inversiones">
                  <div class="fsc-header">
                    <div class="fsc-tag-wrap">
                      <div class="bc-icon icon-cyan" style="width:28px;height:28px;border-radius:8px;">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                      </div>
                      <div>
                        <div style="font-weight:700;font-size:0.85rem;color:var(--texto);">Inversiones</div>
                        <div style="font-size:0.72rem;color:var(--texto-3);">Cartera viva de activos</div>
                      </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;">
                      <span class="bc-value" id="dash-inversiones-valor" style="font-size:1.05rem;font-weight:800;">—</span>
                      <button class="finset-arrow-btn" id="dash-inversiones-detail" title="Ver portafolio de inversiones">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            </div>

          </div>

          <!-- ═══ EXPANDABLE FULL DRILLDOWN CONSOLE ═══ -->
          <div class="dash-hero-drilldown" id="dash-hero-drilldown" style="display: none;">
            <div class="dh-drilldown-header">
              <div class="dh-drilldown-left">
                <div class="dh-drilldown-badge" id="drilldown-badge">
                  <span class="dh-badge-dot"></span>
                  <span class="dh-badge-title" id="drilldown-title">Consola de Movimientos</span>
                </div>
                <div class="dh-drilldown-summary" id="drilldown-summary">—</div>
              </div>

              <div class="dh-drilldown-center">
                <div class="dh-filter-tabs">
                  <button class="dh-tab-btn active" data-filter="ALL" id="drilldown-tab-all">Todos</button>
                  <button class="dh-tab-btn" data-filter="INGRESO" id="drilldown-tab-ing">Ingresos</button>
                  <button class="dh-tab-btn" data-filter="EGRESO" id="drilldown-tab-egr">Gastos</button>
                </div>
              </div>

              <div class="dh-drilldown-right">
                <div class="dh-search-box">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input type="text" id="drilldown-search-input" placeholder="Buscar concepto o categoría..." autocomplete="off">
                </div>
                <button class="dh-close-btn" id="drilldown-close-btn" title="Cerrar consola de movimientos" aria-label="Cerrar">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>

            <!-- Layout Side-by-Side: Grilla a la izquierda + Analítica a la derecha -->
            <div class="analytics-side-layout dh-side-layout">
              <div class="analytics-main-col dh-side-main">
                <div class="dh-drilldown-body dh-drilldown-list" id="drilldown-body-container"></div>
              </div>
              <div class="analytics-side-col dh-side-analytics">
                <div class="table-card fintech-card" id="dash-drill-donut-wrap"></div>
                <div class="table-card fintech-card" id="dash-drill-evolucion-wrap"></div>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;
  }

  // --- SECCIÓN 4: LISTENERS ---

  _bindListeners() {
    // Privacy Toggle (Eye button)
    let isPrivacyActive = false;
    document.getElementById('btn-toggle-privacy')?.addEventListener('click', () => {
      isPrivacyActive = !isPrivacyActive;
      const saldoValEl = document.getElementById('dash-saldo-val');
      const convValEl = document.getElementById('dash-conversion-val');
      const eyeOpen = document.getElementById('icon-eye-open');
      const eyeClosed = document.getElementById('icon-eye-closed');

      eyeOpen?.classList.toggle('hidden', isPrivacyActive);
      eyeClosed?.classList.toggle('hidden', !isPrivacyActive);

      if (isPrivacyActive) {
        saldoValEl?.classList.add('privacy-masked');
        convValEl?.classList.add('privacy-masked');
      } else {
        saldoValEl?.classList.remove('privacy-masked');
        convValEl?.classList.remove('privacy-masked');
      }
    });

    // KPI Expand Buttons
    document.getElementById('btn-expand-balance')?.addEventListener('click', () => this.#openDrilldown('ALL'));
    document.getElementById('btn-expand-ingresos')?.addEventListener('click', () => this.#openDrilldown('INGRESO'));
    document.getElementById('btn-expand-gastos')?.addEventListener('click', () => this.#openDrilldown('EGRESO'));
    document.getElementById('btn-expand-ahorro')?.addEventListener('click', () => {
      document.querySelector('[data-vista="vista-ahorro"]')?.click();
    });

    // Money Flow switch
    document.getElementById('dash-moneyflow-switch')?.querySelectorAll('.fintech-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#dash-moneyflow-switch .fintech-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.#evolucionMode = btn.dataset.mode;
        this.#renderMoneyFlowChart();
      });
    });

    // Top Categories switch
    document.getElementById('dash-categories-switch')?.querySelectorAll('.fintech-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#dash-categories-switch .fintech-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.#donutMetric = btn.dataset.metric;
        this.#renderTopCategoriesWidget();
      });
    });

    // Recent Transactions Filters & Search
    document.getElementById('dash-recents-tab-all')?.addEventListener('click', () => this.#setRecentsFilter('ALL'));
    document.getElementById('dash-recents-tab-ing')?.addEventListener('click', () => this.#setRecentsFilter('INGRESO'));
    document.getElementById('dash-recents-tab-egr')?.addEventListener('click', () => this.#setRecentsFilter('EGRESO'));

    document.getElementById('dash-recents-search')?.addEventListener('input', (e) => {
      this.#recentsSearch = e.target.value;
      this.#renderRecentTransactions();
    });

    document.getElementById('dash-recents-expand-btn')?.addEventListener('click', () => {
      this.#toggleDrilldown(this.#recentsFilter);
    });

    // Tarjetas carousel
    document.getElementById('dash-tc-prev')?.addEventListener('click', (e) => { e.stopPropagation(); this.#navigateTc(-1); });
    document.getElementById('dash-tc-next')?.addEventListener('click', (e) => { e.stopPropagation(); this.#navigateTc(1); });
    document.getElementById('dash-tc-ver-consumos')?.addEventListener('click', () => {
      document.querySelector('[data-vista="vista-tarjetas"]')?.click();
    });

    // Gastos compartidos detail
    document.getElementById('dash-cc-detail')?.addEventListener('click', () => {
      document.querySelector('[data-vista="vista-cc"]')?.click();
    });

    // Alcancías (Chanchito) detail
    document.getElementById('dash-ahorro-detail')?.addEventListener('click', () => {
      document.querySelector('[data-vista="vista-ahorro"]')?.click();
    });

    // Inversiones detail
    document.getElementById('dash-inversiones-detail')?.addEventListener('click', () => {
      document.querySelector('[data-vista="vista-inversiones"]')?.click();
    });

    // Drilldown Controls
    document.getElementById('drilldown-close-btn')?.addEventListener('click', () => this.#closeDrilldown());
    document.getElementById('drilldown-tab-all')?.addEventListener('click', () => this.#setDrilldownFilter('ALL'));
    document.getElementById('drilldown-tab-ing')?.addEventListener('click', () => this.#setDrilldownFilter('INGRESO'));
    document.getElementById('drilldown-tab-egr')?.addEventListener('click', () => this.#setDrilldownFilter('EGRESO'));

    document.getElementById('drilldown-search-input')?.addEventListener('input', (e) => {
      this.#drilldownSearch = e.target.value;
      this.#renderDrilldown();
    });
  }

  _subscribeEvents() {
    App.Events.on('store:mes-changed', () => {
      this.cargar();
    });
    App.Events.on('store:cuenta-changed', () => {
      this.#cargarDetail();
      App.updateAccountSelectorVisibility();
    });
    App.Events.on('store:moneda-changed', () => {
      this.cargar();
    });
    App.Events.on('data:changed', () => {
      this.cargar();
    });
  }

  // --- SECCIÓN 5: HELPERS PRIVADOS ---

  #calcFechas(mes) {
    const [y, m] = mes.split('-').map(Number);
    const fechaInicio = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const fechaFin = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { fechaInicio, fechaFin };
  }

  #mostrarKpiSkeletons() {
    const saldoValEl = document.getElementById('dash-saldo-val');
    const breakdownIngresosEl = document.getElementById('dash-breakdown-ingresos');
    const breakdownEgresosEl = document.getElementById('dash-breakdown-egresos');
    if (saldoValEl) saldoValEl.textContent = '...';
    if (breakdownIngresosEl) breakdownIngresosEl.textContent = '...';
    if (breakdownEgresosEl) breakdownEgresosEl.textContent = '...';
  }

  // --- SECCIÓN 6: TARJETAS DE CRÉDITO ---

  async #loadTarjetas(cuenta, fechaInicio, fechaFin) {
    try {
      if (!window._appTarjetas || window._appTarjetas.length === 0) {
        try {
          const initData = await App.API.call('api_getInitialData');
          if (initData?.tarjetas) window._appTarjetas = initData.tarjetas;
        } catch (e) {}
      }

      const resp = await App.API.swr(
        'api_getConsumosTC',
        [cuenta, fechaInicio, fechaFin],
        App.API.defaultTtl,
        (fresh) => { if (fresh?.success) this.#renderTcCards(fresh); }
      );
      if (resp.data?.success) this.#renderTcCards(resp.data);
    } catch (e) { App.error('Dashboard', '#loadTarjetas', e.message, e); }
  }

  #renderTcCards(data) {
    const allTarjetas = window._appTarjetas || [];
    // Only show tarjetas belonging to the current account
    const tarjetas = allTarjetas.filter(t => t.id_cuenta_principal === App.Store.cuenta);

    // Build set of valid tarjeta IDs for this account
    const validTcIds = new Set(tarjetas.map(t => t.id_tarjeta));

    // Aggregate consumos by tarjeta — ONLY for tarjetas belonging to THIS account
    const consumosByTc = {};
    let totalGlobal = 0;
    let totalGlobalUsd = 0;
    (data.consumos || []).forEach(c => {
      if (!c.id_tarjeta && c.tarjeta_nombre) {
        const found = tarjetas.find(t => t.nombre.toLowerCase() === c.tarjeta_nombre.toLowerCase());
        if (found) c.id_tarjeta = found.id_tarjeta;
      }
      const tid = c.id_tarjeta;
      if (!validTcIds.has(tid)) return; // Skip consumos from other accounts' tarjetas
      if (!consumosByTc[tid]) consumosByTc[tid] = { total: 0, totalUsd: 0, count: 0, items: [] };
      if (c.moneda === 'USD') {
        consumosByTc[tid].totalUsd += Number(c.importe || 0);
        totalGlobalUsd += Number(c.importe || 0);
      } else {
        consumosByTc[tid].total += Number(c.importe || 0);
        totalGlobal += Number(c.importe || 0);
      }
      consumosByTc[tid].count++;
      consumosByTc[tid].items.push(c);
    });
    this._tcConsumos = consumosByTc;

    // Si hay tarjetas con total oficial de resumen para este mes, calcular totales consolidados considerando eso
    let totalConsolArs = 0;
    let totalConsolUsd = 0;
    tarjetas.forEach(t => {
      const isDueInMonth = (t.fecha_vencimiento_actual && t.fecha_vencimiento_actual.substring(0, 7) === App.Store.mes) ||
                           (t.fecha_cierre_actual && t.fecha_cierre_actual.substring(0, 7) === App.Store.mes);
      const cardSub = consumosByTc[t.id_tarjeta];
      const cardArs = (isDueInMonth && Number(t.total_resumen_ars || 0) > 0) ? Number(t.total_resumen_ars) : (cardSub?.total || 0);
      const cardUsd = (isDueInMonth && Number(t.total_resumen_usd || 0) > 0) ? Number(t.total_resumen_usd) : (cardSub?.totalUsd || 0);
      totalConsolArs += cardArs;
      totalConsolUsd += cardUsd;
    });

    if (totalConsolArs > 0 || totalConsolUsd > 0) {
      totalGlobal = totalConsolArs;
      totalGlobalUsd = totalConsolUsd;
    }

    // Consolidated card at index 0
    const consolidadoCard = {
      isConsolidado: true,
      id_tarjeta: '__consolidado__',
      nombre: 'Todas las tarjetas',
      banco: 'CONSOLIDADO',
      red: 'GLOBAL',
      color: 'blue',
      ultimos_4_digitos: 'ALL',
      totalArs: totalGlobal,
      totalUsd: totalGlobalUsd
    };

    if (tarjetas.length > 0) {
      this._tcList = [consolidadoCard, ...tarjetas];
    } else {
      this._tcList = [];
    }
    this._tcIndex = 0;

    // KPI total
    const totalEl = document.getElementById('dash-tc-total');
    if (totalEl) {
      let tText = App.Utils.formatearMoneda(totalGlobal);
      if (totalGlobalUsd > 0) {
        tText += ` (+ USD ${totalGlobalUsd.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
      }
      totalEl.textContent = tText;
    }

    // Enable arrows if > 1 tarjeta (meaning consolidado + at least 1 tarjeta, or 2+ cards)
    const prevBtn = document.getElementById('dash-tc-prev');
    const nextBtn = document.getElementById('dash-tc-next');
    const verBtn  = document.getElementById('dash-tc-ver-consumos');
    if (this._tcList.length > 1) {
      prevBtn && (prevBtn.disabled = false);
      nextBtn && (nextBtn.disabled = false);
    } else {
      prevBtn && (prevBtn.disabled = true);
      nextBtn && (nextBtn.disabled = true);
    }
    if (this._tcList.length > 0) {
      verBtn && (verBtn.disabled = false);
      this.#updateTcVisual();
    }
  }

  #navigateTc(dir) {
    const list = this._tcList || [];
    if (!list.length) return;
    this._tcIndex = (this._tcIndex + dir + list.length) % list.length;
    this.#updateTcVisual();

    // Enable/disable arrows
    const prevBtn = document.getElementById('dash-tc-prev');
    const nextBtn = document.getElementById('dash-tc-next');
    if (list.length <= 1) {
      prevBtn && (prevBtn.disabled = true);
      nextBtn && (nextBtn.disabled = true);
    } else {
      prevBtn && (prevBtn.disabled = false);
      nextBtn && (nextBtn.disabled = false);
    }
  }

  #updateTcVisual() {
    const tc = this._tcList?.[this._tcIndex];
    if (!tc) return;

    const isArs = App.Store.globalCurrency !== 'USD';
    const dolarOficial = App.Store.dolarOficial || 1535;

    const cardChip = `<div class="tc-card-chip"><div class="tc-card-chip-inner"></div></div>`;
    const contactlessWave = `<svg class="tc-card-contactless" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="display:block;">
      <path d="M5 8a9 9 0 0 1 0 8" opacity="0.3"/>
      <path d="M8 6a12 12 0 0 1 0 12" opacity="0.5"/>
      <path d="M11 4a15 15 0 0 1 0 16" opacity="0.7"/>
      <path d="M14 2a18 18 0 0 1 0 20"/>
    </svg>`;

    if (tc.isConsolidado) {
      const subtotal = tc.totalArs || 0;
      const subtotalUsd = tc.totalUsd || 0;

      let totalCardDisplay;
      if (isArs) {
        const totalConsolidado = subtotal + (subtotalUsd * dolarOficial);
        totalCardDisplay = App.Utils.formatearMoneda(totalConsolidado);
      } else {
        const totalUsdConsolidado = subtotalUsd + (dolarOficial > 0 ? (subtotal / dolarOficial) : 0);
        totalCardDisplay = `USD ${totalUsdConsolidado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }

      const cardHtml = `
        <div class="tc-card-pill" style="background:linear-gradient(135deg, #1D195D 0%, #0f0d36 100%); cursor:default; margin: 0 auto; user-select: none;">
          <div class="tc-card-shimmer"></div>
          
          <div class="tc-card-row tc-card-top">
            <span class="tc-card-issuer-name">CONSOLIDADO</span>
            <span style="font-size:0.7rem;font-weight:700;letter-spacing:0.05em;color:rgba(255,255,255,0.7);background:rgba(255,255,255,0.12);padding:2px 8px;border-radius:10px;">TODAS</span>
          </div>
          
          <div class="tc-card-row tc-card-middle">
            ${cardChip}
            ${contactlessWave}
          </div>

          <div class="tc-card-row tc-card-bottom">
            <div class="tc-card-bottom-left">
              <span class="tc-card-number">**** ALL</span>
              <span class="tc-card-amount">${totalCardDisplay}</span>
            </div>
            <div class="tc-card-bottom-right">
              <span style="font-family:'Inter', sans-serif; font-weight:800; font-size:0.75rem; letter-spacing:1px; color:#ffffff; opacity:0.85;">GLOBAL</span>
            </div>
          </div>
        </div>
      `;

      const visualEl = document.getElementById('dash-tc-visual');
      if (visualEl) visualEl.innerHTML = cardHtml;

      const subtotalEl = document.getElementById('dash-tc-subtotal');
      if (subtotalEl) {
        let txt = '';
        if (subtotalUsd > 0) {
          txt = `Total: ${App.Utils.formatearMoneda(subtotal)} + USD ${subtotalUsd.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
          if (isArs) {
            txt += ` (Oficial: $${dolarOficial.toLocaleString('es-AR')})`;
          }
        } else {
          txt = `Total acumulado: ${App.Utils.formatearMoneda(subtotal)}`;
        }
        subtotalEl.textContent = txt;
      }
      return;
    }

    const rawMarca = tc.marca || (tc.nombre || '').split(' ')[0] || 'Visa';
    const cardIssuer = ((tc.marca || tc.nombre || '').split(' ')[0] + ' ' + (tc.banco || 'SANTANDER')).toUpperCase();
    const last4 = tc.ultimos_4_digitos || tc.ultimos_4 || '••••';
    
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

    const brandLogoHtml = getBrandLogoHtml(tc.red || rawMarca);

    const cardData = this._tcConsumos?.[tc.id_tarjeta];
    let subtotal = cardData?.total || 0;
    let subtotalUsd = cardData?.totalUsd || 0;

    const isDueInMonth = (tc.fecha_vencimiento_actual && tc.fecha_vencimiento_actual.substring(0, 7) === App.Store.mes) ||
                         (tc.fecha_cierre_actual && tc.fecha_cierre_actual.substring(0, 7) === App.Store.mes);

    if (isDueInMonth && Number(tc.total_resumen_ars || 0) > 0) {
      subtotal = Number(tc.total_resumen_ars);
      subtotalUsd = Number(tc.total_resumen_usd || 0);
    } else if (subtotal === 0 && subtotalUsd === 0 && isDueInMonth) {
      subtotal = Number(tc.total_resumen_ars || 0);
      subtotalUsd = Number(tc.total_resumen_usd || 0);
    }

    let totalCardDisplay;
    if (isArs) {
      const totalConsolidado = subtotal + (subtotalUsd * dolarOficial);
      totalCardDisplay = App.Utils.formatearMoneda(totalConsolidado);
    } else {
      const totalUsdConsolidado = subtotalUsd + (dolarOficial > 0 ? (subtotal / dolarOficial) : 0);
      totalCardDisplay = `USD ${totalUsdConsolidado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    const cardHtml = `
      <div class="tc-card-pill" style="background:${gradient}; cursor:default; margin: 0 auto; user-select: none;">
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
            <span class="tc-card-amount">${totalCardDisplay}</span>
          </div>
          <div class="tc-card-bottom-right">
            ${brandLogoHtml}
          </div>
        </div>
      </div>
    `;

    const visualEl = document.getElementById('dash-tc-visual');
    if (visualEl) {
      visualEl.innerHTML = cardHtml;
    }

    // Show per-card subtotal footer with discrimination and due date
    const subtotalEl = document.getElementById('dash-tc-subtotal');
    if (subtotalEl) {
      let txt = '';
      if (subtotalUsd > 0) {
        txt = `${App.Utils.formatearMoneda(subtotal)} + USD ${subtotalUsd.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        if (isArs) {
          txt += ` (Oficial: $${dolarOficial.toLocaleString('es-AR')})`;
        }
      } else {
        txt = `Subtotal: ${App.Utils.formatearMoneda(subtotal)}`;
      }
      if (tc.fecha_vencimiento_actual) {
        const vtoFormatted = tc.fecha_vencimiento_actual.split('-').reverse().join('/');
        txt += ` • Vence ${vtoFormatted}`;
      }
      subtotalEl.textContent = txt;
    }
  }



  // --- SECCIÓN 7: GASTOS COMPARTIDOS ---

  async #loadCC(cuenta, fechaInicio, fechaFin) {
    const applyCC = (data) => {
      this._ccData = data;
      const saldo = data.kpis?.saldoNeto ?? 0;
      const el = document.getElementById('dash-cc-saldo');
      if (el) {
        el.textContent = App.Utils.formatearMoneda(saldo);
        el.className = 'dash-mc-kpi-value ' + (saldo >= 0 ? 'positivo' : 'negativo');
      }
    };
    try {
      const resp = await App.API.swr(
        'api_getConsumosCC', [cuenta, fechaInicio, fechaFin], App.API.defaultTtl,
        (fresh) => { if (fresh?.success) applyCC(fresh); }
      );
      if (resp.data?.success) applyCC(resp.data);
    } catch (e) { App.error('Dashboard', '#loadCC', e.message, e); }
  }



  // --- SECCIÓN 8: AHORRO ---

  #updateAhorroKpi() {
    const el = document.getElementById('dash-ahorro-kpi-val');
    const total = (this.#ahorroTotal || 0) + (this.#inversionesTotal || 0);
    if (el) el.textContent = App.Utils.formatearMoneda(total);
  }

  async #loadAhorro(cuenta, fechaInicio, fechaFin) {
    const applyAhorro = (data) => {
      this._ahorroData = data;
      const total = (data.kpis?.arsTotal || 0);
      this.#ahorroTotal = total;
      const el = document.getElementById('dash-ahorro-total');
      if (el) el.textContent = App.Utils.formatearMoneda(total);
      this.#updateAhorroKpi();
    };
    try {
      const resp = await App.API.swr(
        'api_getAhorros', [cuenta, fechaInicio, fechaFin], App.API.defaultTtl,
        (fresh) => { if (fresh?.success) applyAhorro(fresh); }
      );
      if (resp.data?.success) applyAhorro(resp.data);
    } catch (e) { App.error('Dashboard', '#loadAhorro', e.message, e); }
  }

  // --- SECCIÓN 8B: INVERSIONES ---

  async #loadInversiones(cuenta) {
    const applyInversiones = (data) => {
      this._inversionesData = data;
      const valorActual = (data.kpis?.valorActual || 0);
      this.#inversionesTotal = valorActual;
      const el = document.getElementById('dash-inversiones-valor');
      if (el) el.textContent = App.Utils.formatearMoneda(valorActual);
      this.#updateAhorroKpi();
    };
    try {
      const resp = await App.API.swr(
        'api_getPortfolio', [cuenta], App.API.defaultTtl,
        (fresh) => { if (fresh?.success) applyInversiones(fresh); }
      );
      if (resp.data?.success) applyInversiones(resp.data);
    } catch (e) { App.error('Dashboard', '#loadInversiones', e.message, e); }
  }

  // --- SECCIÓN 8B-2: FINSET WIDGETS RENDERING ---

  #setRecentsFilter(tipo) {
    this.#recentsFilter = tipo;
    ['all', 'ing', 'egr'].forEach(k => {
      const btn = document.getElementById(`dash-recents-tab-${k}`);
      if (btn) {
        const isAct = (k === 'all' && tipo === 'ALL') ||
                      (k === 'ing' && tipo === 'INGRESO') ||
                      (k === 'egr' && tipo === 'EGRESO');
        btn.classList.toggle('active', isAct);
      }
    });
    this.#renderRecentTransactions();
  }

  #renderMoneyFlowChart() {
    const canvas = document.getElementById('dash-moneyflow-canvas');
    if (!canvas) return;
    const hist = this.#evolucionMensual || [];
    if (!hist.length) return;

    this.#moneyFlowChartInstance?.destroy();
    const ctx = canvas.getContext('2d');
    const isIngVsGas = this.#evolucionMode === 'ingresos_vs_gastos';
    const labels = hist.map(e => App.Utils.formatearMes(e.mes));

    let datasets = [];
    if (isIngVsGas) {
      datasets = [
        {
          label: 'Ingresos',
          data: hist.map(e => Math.round(e.ingresos || 0)),
          backgroundColor: '#10B981',
          borderRadius: 6,
          barPercentage: 0.65,
          categoryPercentage: 0.8
        },
        {
          label: 'Gastos',
          data: hist.map(e => Math.round(e.egresos || 0)),
          backgroundColor: '#1D195D',
          borderRadius: 6,
          barPercentage: 0.65,
          categoryPercentage: 0.8
        }
      ];
    } else {
      datasets = [
        {
          label: 'Balance Neto',
          data: hist.map(e => Math.round(e.balance || 0)),
          backgroundColor: hist.map(e => (e.balance || 0) >= 0 ? '#10B981' : '#EF4444'),
          borderRadius: 6,
          barPercentage: 0.65,
          categoryPercentage: 0.85
        }
      ];
    }

    this.#moneyFlowChartInstance = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: isIngVsGas,
            position: 'top',
            align: 'end',
            labels: {
              boxWidth: 8,
              boxHeight: 8,
              usePointStyle: true,
              pointStyle: 'circle',
              font: { size: 11, family: 'Inter, sans-serif', weight: '600' },
              color: '#4B5563'
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => ` ${context.dataset.label || ''}: $ ${context.parsed.y.toLocaleString('es-AR')}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10, family: 'Inter, sans-serif' }, color: '#9CA3AF' }
          },
          y: {
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: {
              font: { size: 10, family: 'Inter, sans-serif' },
              color: '#9CA3AF',
              callback: (v) => '$ ' + (Math.abs(v) >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : (v / 1000).toFixed(0) + 'k')
            }
          }
        }
      }
    });

    // Update summary text
    const summaryEl = document.getElementById('dash-moneyflow-summary');
    if (summaryEl) {
      const avgIng = hist.reduce((a, b) => a + (b.ingresos || 0), 0) / hist.length;
      const avgGas = hist.reduce((a, b) => a + (b.egresos || 0), 0) / hist.length;
      summaryEl.innerHTML = `
        <span>Promedio mensual: Ingresos <strong>${App.Utils.formatearMoneda(avgIng)}</strong> • Gastos <strong>${App.Utils.formatearMoneda(avgGas)}</strong></span>
      `;
    }
  }

  #renderTopCategoriesWidget() {
    const isIngresos = this.#donutMetric === 'ingresos';
    const targetType = isIngresos ? 'INGRESO' : 'EGRESO';
    const canvas = document.getElementById('dash-categories-donut-canvas');
    const legendEl = document.getElementById('dash-categories-legend');
    const subEl = document.getElementById('dash-categories-subtitle');
    const centerValEl = document.getElementById('dash-donut-center-val');
    const centerLblEl = document.getElementById('dash-donut-center-label');

    if (subEl) subEl.textContent = isIngresos ? 'Distribución de ingresos' : 'Distribución de gastos';
    if (centerLblEl) centerLblEl.textContent = isIngresos ? 'Total Ingresos' : 'Total Gastos';

    const pool = (this.#movData || []).filter(m => m.tipo_mov === targetType);
    const totalMetric = pool.reduce((acc, m) => acc + Math.abs(Number(m.importe || 0)), 0);

    if (centerValEl) {
      centerValEl.textContent = App.Utils.formatearMoneda(totalMetric);
      centerValEl.className = 'fintech-donut-center-val ' + (isIngresos ? 'positivo' : 'negativo');
    }

    if (!pool.length || totalMetric <= 0) {
      this.#categoriesDonutInstance?.destroy();
      if (legendEl) {
        legendEl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--texto-3);font-size:0.85rem;">No hay registros en este período</div>`;
      }
      return;
    }

    const catMap = {};
    pool.forEach(m => {
      const cat = m.categoria_nombre || (isIngresos ? 'Ingreso' : 'General');
      const imp = Math.abs(Number(m.importe || 0));
      if (!catMap[cat]) catMap[cat] = { total: 0, count: 0 };
      catMap[cat].total += imp;
      catMap[cat].count += 1;
    });

    const sortedCats = Object.entries(catMap)
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
      const top5 = sortedCats.slice(0, 5);
      legendEl.innerHTML = top5.map((cat, idx) => {
        const color = palette[idx % palette.length];
        return `
          <div class="fintech-legend-item">
            <div class="fintech-legend-left" title="${App.Utils.escapeHtml(cat.name)}">
              <span class="fintech-legend-dot" style="background:${color};"></span>
              <span style="color:var(--texto);">${App.Utils.escapeHtml(cat.name)}</span>
            </div>
            <div class="fintech-legend-right">
              <span style="font-size:0.75rem;color:var(--texto-3);min-width:38px;text-align:right;">${cat.pct.toFixed(1)}%</span>
              <span class="${isIngresos ? 'positivo' : 'negativo'}" style="font-size:0.82rem;">${App.Utils.formatearMoneda(cat.total)}</span>
            </div>
          </div>
        `;
      }).join('');
    }

    if (canvas) {
      this.#categoriesDonutInstance?.destroy();
      const ctx = canvas.getContext('2d');
      this.#categoriesDonutInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: sortedCats.map(c => c.name),
          datasets: [{
            data: sortedCats.map(c => Math.round(c.total)),
            backgroundColor: sortedCats.map((_, i) => palette[i % palette.length]),
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

  #renderRecentTransactions() {
    const bodyEl = document.getElementById('dash-recents-body');
    if (!bodyEl) return;

    let list = this.#movData || [];
    if (this.#recentsFilter === 'INGRESO') {
      list = list.filter(m => m.tipo_mov === 'INGRESO');
    } else if (this.#recentsFilter === 'EGRESO') {
      list = list.filter(m => m.tipo_mov === 'EGRESO');
    }

    if (this.#recentsSearch.trim()) {
      const q = this.#recentsSearch.toLowerCase().trim();
      list = list.filter(m => {
        const desc = (m.descripcion || '').toLowerCase();
        const cat = (m.categoria_nombre || '').toLowerCase();
        const medio = (m.medio_pago || '').toLowerCase();
        return desc.includes(q) || cat.includes(q) || medio.includes(q);
      });
    }

    if (!list.length) {
      bodyEl.innerHTML = `
        <div style="padding: 28px 16px; text-align: center; color: var(--texto-3); font-size: 0.85rem;">
          No hay movimientos recientes registrados
        </div>
      `;
      return;
    }

    // Take top 6
    const recents = list.slice(0, 6);

    const getCategoryIconSvg = (catName, tipo) => {
      const cat = (catName || '').toLowerCase();
      if (tipo === 'INGRESO') {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
      }
      if (cat.includes('super') || cat.includes('alimen') || cat.includes('comida')) {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`;
      }
      if (cat.includes('serv') || cat.includes('luz') || cat.includes('gas') || cat.includes('internet')) {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
      }
      if (cat.includes('auto') || cat.includes('combust') || cat.includes('nafta') || cat.includes('viaje')) {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`;
      }
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 12V8H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>`;
    };

    bodyEl.innerHTML = recents.map(r => {
      const esIngreso = r.tipo_mov === 'INGRESO';
      const iconClass = esIngreso ? 'icon-green' : 'icon-subtle';
      const sign = esIngreso ? '+' : '-';
      const valClass = esIngreso ? 'positivo' : 'negativo';
      const catName = r.categoria_nombre || (esIngreso ? 'Ingreso' : 'General');
      const desc = r.descripcion || catName;
      const fechaStr = App.Utils.formatearFecha(r.fecha?.value || r.fecha);

      return `
        <div class="finset-recents-row" data-id="${r.id_movimiento || r.id}">
          <div class="finset-recents-icon ${iconClass}">
            ${getCategoryIconSvg(catName, r.tipo_mov)}
          </div>
          <div class="finset-recents-info">
            <span class="finset-recents-desc">${App.Utils.escapeHtml(desc)}</span>
            <span class="finset-recents-date">${fechaStr}</span>
          </div>
          <span class="finset-recents-cat">${App.Utils.escapeHtml(catName)}</span>
          <span class="finset-recents-amount ${valClass}">${sign} ${App.Utils.formatearMoneda(r.importe)}</span>
          <button class="finset-arrow-btn" style="width:24px;height:24px;border:none;" title="Ver detalle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      `;
    }).join('');

    bodyEl.querySelectorAll('.finset-recents-row').forEach(rowEl => {
      rowEl.addEventListener('click', () => {
        const id = rowEl.dataset.id;
        const row = this.#movData.find(m => (m.id_movimiento || m.id) == id);
        if (row) this.#abrirModalDetalleMov(row);
      });
    });
  }

  // --- SECCIÓN 8C: DRILL-DOWN DE MOVIMIENTOS EN VIVO ---

  #toggleDrilldown(tipo = 'ALL') {
    if (this.#drilldownOpen && (!tipo || this.#drilldownFilter === tipo)) {
      this.#closeDrilldown();
    } else {
      this.#openDrilldown(tipo || 'ALL');
    }
  }

  #openDrilldown(tipo = 'ALL') {
    this.#drilldownOpen = true;
    this.#drilldownFilter = tipo || 'ALL';
    this.#drilldownSearch = '';
    const searchInput = document.getElementById('drilldown-search-input');
    if (searchInput) searchInput.value = '';

    const el = document.getElementById('dash-hero-drilldown');
    if (el) {
      el.style.display = 'block';
      this.#renderDrilldown();
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const toggleRow = document.getElementById('dash-breakdown-toggle');
    if (toggleRow) toggleRow.classList.add('is-active');
    const arrowIcon = document.getElementById('dash-hero-arrow-icon');
    if (arrowIcon) arrowIcon.classList.add('rotated');
  }

  #closeDrilldown() {
    this.#drilldownOpen = false;
    const el = document.getElementById('dash-hero-drilldown');
    if (el) el.style.display = 'none';

    const toggleRow = document.getElementById('dash-breakdown-toggle');
    if (toggleRow) toggleRow.classList.remove('is-active');
    const arrowIcon = document.getElementById('dash-hero-arrow-icon');
    if (arrowIcon) arrowIcon.classList.remove('rotated');
  }

  #setDrilldownFilter(tipo) {
    this.#drilldownFilter = tipo;
    this.#renderDrilldown();
  }

  #renderDrilldown() {
    const drilldownEl = document.getElementById('dash-hero-drilldown');
    const bodyEl = document.getElementById('drilldown-body-container');
    const titleEl = document.getElementById('drilldown-title');
    const badgeEl = document.getElementById('drilldown-badge');
    const summaryEl = document.getElementById('drilldown-summary');
    if (!drilldownEl || !bodyEl) return;

    // Filter by type
    let filtered = this.#movData || [];
    if (this.#drilldownFilter === 'INGRESO') {
      filtered = filtered.filter(m => m.tipo_mov === 'INGRESO');
    } else if (this.#drilldownFilter === 'EGRESO') {
      filtered = filtered.filter(m => m.tipo_mov === 'EGRESO');
    }

    // Filter by live search text
    if (this.#drilldownSearch.trim()) {
      const q = this.#drilldownSearch.toLowerCase().trim();
      filtered = filtered.filter(m => {
        const desc = (m.descripcion || '').toLowerCase();
        const cat = (m.categoria_nombre || '').toLowerCase();
        const medio = (m.medio_pago || '').toLowerCase();
        return desc.includes(q) || cat.includes(q) || medio.includes(q);
      });
    }

    // Calculate sum of filtered
    const totalFiltered = filtered.reduce((acc, m) => acc + Number(m.importe || 0), 0);

    // Update Header Badge and Title
    if (badgeEl) {
      badgeEl.className = 'dh-drilldown-badge badge-' + this.#drilldownFilter.toLowerCase();
    }
    if (titleEl) {
      if (this.#drilldownFilter === 'INGRESO') titleEl.textContent = 'Movimientos: Ingresos';
      else if (this.#drilldownFilter === 'EGRESO') titleEl.textContent = 'Movimientos: Gastos';
      else titleEl.textContent = 'Todos los Movimientos';
    }
    if (summaryEl) {
      const countLabel = filtered.length === 1 ? '1 movimiento' : `${filtered.length} movimientos`;
      summaryEl.textContent = `${countLabel} • Total: ${App.Utils.formatearMoneda(totalFiltered)}`;
    }

    // Update active tab buttons
    ['all', 'ing', 'egr'].forEach(k => {
      const btn = document.getElementById(`drilldown-tab-${k}`);
      if (btn) {
        const isAct = (k === 'all' && this.#drilldownFilter === 'ALL') ||
                      (k === 'ing' && this.#drilldownFilter === 'INGRESO') ||
                      (k === 'egr' && this.#drilldownFilter === 'EGRESO');
        btn.classList.toggle('active', isAct);
      }
    });

    // Update active state on hero breakdown toggle & arrow
    const toggleRow = document.getElementById('dash-breakdown-toggle');
    if (toggleRow) toggleRow.classList.toggle('is-active', this.#drilldownOpen);
    const arrowIcon = document.getElementById('dash-hero-arrow-icon');
    if (arrowIcon) arrowIcon.classList.toggle('rotated', this.#drilldownOpen);

    if (filtered.length === 0) {
      bodyEl.innerHTML = `
        <div class="dh-empty-state">
          <div class="dh-empty-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          </div>
          <span>No se encontraron movimientos para esta selección</span>
        </div>
      `;
      return;
    }

    const getCategoryIconSvg = (catName, tipo) => {
      const cat = (catName || '').toLowerCase();
      if (tipo === 'INGRESO') {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
      }
      if (cat.includes('super') || cat.includes('alimen') || cat.includes('comida')) {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`;
      }
      if (cat.includes('serv') || cat.includes('luz') || cat.includes('gas') || cat.includes('internet')) {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
      }
      if (cat.includes('auto') || cat.includes('combust') || cat.includes('nafta') || cat.includes('viaje')) {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`;
      }
      if (cat.includes('salud') || cat.includes('farmacia')) {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`;
      }
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12V8H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>`;
    };

    const rowsHtml = filtered.map(r => {
      const esIngreso = r.tipo_mov === 'INGRESO';
      const iconClass = esIngreso ? 'icon-green' : 'icon-subtle';
      const sign = esIngreso ? '+' : '-';
      const valClass = esIngreso ? 'positivo' : 'negativo';
      const catName = r.categoria_nombre || (esIngreso ? 'Ingreso' : 'General');
      const desc = r.descripcion || catName;
      const fechaStr = App.Utils.formatearFecha(r.fecha?.value || r.fecha);
      const medio = r.medio_pago ? `<span class="dh-pill-medio">${App.Utils.escapeHtml(r.medio_pago)}</span>` : '';

      return `
        <div class="dh-drill-row" data-id="${r.id_movimiento || r.id}">
          <div class="dh-col-main">
            <div class="dh-item-icon ${iconClass}">
              ${getCategoryIconSvg(catName, r.tipo_mov)}
            </div>
            <div class="dh-col-desc-wrap">
              <span class="dh-row-desc">${App.Utils.escapeHtml(desc)}</span>
              <span class="dh-row-date">${fechaStr}</span>
            </div>
          </div>
          <div class="dh-col-cat">
            <span class="dh-cat-pill">${App.Utils.escapeHtml(catName)}</span>
          </div>
          <div class="dh-col-medio">
            ${medio}
          </div>
          <div class="dh-col-amount ${valClass}">
            ${sign} ${App.Utils.formatearMoneda(r.importe)}
          </div>
          <div class="dh-col-action">
            <button class="btn-icon-sm dh-row-btn" title="Ver detalle">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    bodyEl.innerHTML = `<div class="dh-rows-list">${rowsHtml}</div>`;

    bodyEl.querySelectorAll('.dh-drill-row').forEach(rowEl => {
      rowEl.addEventListener('click', () => {
        const id = rowEl.dataset.id;
        const row = this.#movData.find(m => (m.id_movimiento || m.id) == id);
        if (row) this.#abrirModalDetalleMov(row);
      });
    });

    this.#renderDrilldownAnalytics(filtered);
  }

  #renderDrilldownAnalytics(filtered) {
    this.#renderDrilldownDonut(filtered);
    this.#renderDrilldownEvolucion();
  }

  #renderDrilldownDonut(filtered) {
    const wrap = document.getElementById('dash-drill-donut-wrap');
    if (!wrap) return;

    if (this.#drilldownFilter === 'INGRESO') this.#donutMetric = 'ingresos';
    else if (this.#drilldownFilter === 'EGRESO') this.#donutMetric = 'gastos';

    const isIngresos = this.#donutMetric === 'ingresos';
    const targetType = isIngresos ? 'INGRESO' : 'EGRESO';
    
    // Agrupar a partir de los movimientos disponibles
    const pool = (this.#movData || []).filter(m => m.tipo_mov === targetType);
    const totalMetric = pool.reduce((acc, m) => acc + Math.abs(Number(m.importe || 0)), 0);

    if (pool.length === 0 || totalMetric <= 0) {
      wrap.innerHTML = `
        <div class="fintech-card-header">
          <h3 class="fintech-card-title">Top Categorías</h3>
          <div class="fintech-pill-switch" id="dash-drill-donut-switch">
            <button class="fintech-pill-btn ${!isIngresos ? 'active' : ''}" data-metric="gastos">% Gastos</button>
            <button class="fintech-pill-btn ${isIngresos ? 'active' : ''}" data-metric="ingresos">% Ingresos</button>
          </div>
        </div>
        <div style="padding:2rem 1rem;text-align:center;color:var(--texto-3);font-size:0.85rem;">
          No hay ${isIngresos ? 'ingresos' : 'gastos'} registrados en este período.
        </div>`;
      this.#bindDonutSwitch(filtered);
      return;
    }

    const catMap = {};
    pool.forEach(m => {
      const cat = m.categoria_nombre || (isIngresos ? 'Ingreso' : 'General');
      const imp = Math.abs(Number(m.importe || 0));
      if (!catMap[cat]) catMap[cat] = { total: 0, count: 0 };
      catMap[cat].total += imp;
      catMap[cat].count += 1;
    });

    const sortedCats = Object.entries(catMap)
      .map(([name, data]) => ({
        name,
        total: data.total,
        count: data.count,
        pct: (data.total / totalMetric) * 100
      }))
      .sort((a, b) => b.total - a.total);

    const palette = [
      '#1D195D', '#2563EB', '#0EA5E9', '#10B981', '#8B5CF6',
      '#F59E0B', '#F43F5E', '#4F46E5', '#64748B'
    ];

    wrap.innerHTML = `
      <div class="fintech-card-header">
        <div>
          <h3 class="fintech-card-title">Top Categorías</h3>
          <span style="font-size:0.75rem;color:var(--texto-3);">${isIngresos ? 'Distribución Ingresos' : 'Distribución Gastos'}</span>
        </div>
        <div class="fintech-pill-switch" id="dash-drill-donut-switch">
          <button class="fintech-pill-btn ${!isIngresos ? 'active' : ''}" data-metric="gastos">% Gastos</button>
          <button class="fintech-pill-btn ${isIngresos ? 'active' : ''}" data-metric="ingresos">% Ingresos</button>
        </div>
      </div>

      <div class="fintech-donut-wrapper">
        <canvas id="dash-drill-donut-canvas"></canvas>
        <div class="fintech-donut-center">
          <span class="fintech-donut-center-label">${isIngresos ? 'Total Ingresos' : 'Total Gastos'}</span>
          <span class="fintech-donut-center-val" style="color:var(--primary);">${App.Utils.formatearMoneda(totalMetric)}</span>
        </div>
      </div>

      <div class="fintech-legend-list">
        ${sortedCats.map((cat, idx) => {
          const color = palette[idx % palette.length];
          return `
            <div class="fintech-legend-item">
              <div class="fintech-legend-left" title="${App.Utils.escapeHtml(cat.name)}">
                <span class="fintech-legend-dot" style="background:${color};"></span>
                <span style="color:var(--texto);">${App.Utils.escapeHtml(cat.name)}</span>
              </div>
              <div class="fintech-legend-right">
                <span style="font-size:0.75rem;color:var(--texto-3);min-width:38px;text-align:right;">${cat.pct.toFixed(1)}%</span>
                <span class="${isIngresos ? 'positivo' : 'negativo'}" style="font-size:0.82rem;">${App.Utils.formatearMoneda(cat.total)}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    this.#bindDonutSwitch(filtered);

    const canvas = document.getElementById('dash-drill-donut-canvas');
    if (canvas) {
      this.#donutChartInstance?.destroy();
      const ctx = canvas.getContext('2d');
      this.#donutChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: sortedCats.map(c => c.name),
          datasets: [{
            data: sortedCats.map(c => Math.round(c.total)),
            backgroundColor: sortedCats.map((_, i) => palette[i % palette.length]),
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

  #bindDonutSwitch(filtered) {
    const wrap = document.getElementById('dash-drill-donut-wrap');
    if (!wrap) return;
    wrap.querySelectorAll('#dash-drill-donut-switch .fintech-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.#donutMetric = btn.dataset.metric;
        this.#renderDrilldownDonut(filtered);
      });
    });
  }

  #renderDrilldownEvolucion() {
    const wrap = document.getElementById('dash-drill-evolucion-wrap');
    if (!wrap) return;

    const hist = this.#evolucionMensual || [];
    if (!hist.length) {
      wrap.innerHTML = `
        <div class="fintech-card-header">
          <h3 class="fintech-card-title">Evolución Mensual</h3>
        </div>
        <div style="padding:1.5rem 1rem;text-align:center;color:var(--texto-3);font-size:0.82rem;">
          Cargando serie histórica...
        </div>`;
      return;
    }

    const isIngVsGas = this.#evolucionMode === 'ingresos_vs_gastos';

    wrap.innerHTML = `
      <div class="fintech-card-header">
        <div>
          <h3 class="fintech-card-title">Evolución Mensual</h3>
          <span style="font-size:0.75rem;color:var(--texto-3);">Variación últimos 6 meses</span>
        </div>
        <div class="fintech-pill-switch" id="dash-drill-evol-switch">
          <button class="fintech-pill-btn ${isIngVsGas ? 'active' : ''}" data-mode="ingresos_vs_gastos" title="Comparar Ingresos vs Gastos">Ingresos vs Gastos</button>
          <button class="fintech-pill-btn ${!isIngVsGas ? 'active' : ''}" data-mode="balance" title="Balance mensual neto">Balance</button>
        </div>
      </div>
      <div style="position:relative;width:100%;height:175px;display:flex;align-items:center;justify-content:center;margin:4px 0;">
        <canvas id="dash-drill-evolucion-canvas"></canvas>
      </div>
    `;

    wrap.querySelectorAll('#dash-drill-evol-switch .fintech-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.#evolucionMode = btn.dataset.mode;
        this.#renderDrilldownEvolucion();
      });
    });

    const canvas = document.getElementById('dash-drill-evolucion-canvas');
    if (!canvas) return;

    this.#evolucionChartInstance?.destroy();
    const ctx = canvas.getContext('2d');

    const labels = hist.map(e => App.Utils.formatearMes(e.mes));

    let datasets = [];
    if (isIngVsGas) {
      datasets = [
        {
          label: 'Ingresos',
          data: hist.map(e => Math.round(e.ingresos || 0)),
          backgroundColor: '#10B981',
          borderRadius: 5,
          barPercentage: 0.65,
          categoryPercentage: 0.8
        },
        {
          label: 'Gastos',
          data: hist.map(e => Math.round(e.egresos || 0)),
          backgroundColor: '#1D195D',
          borderRadius: 5,
          barPercentage: 0.65,
          categoryPercentage: 0.8
        }
      ];
    } else {
      datasets = [
        {
          label: 'Balance Neto',
          data: hist.map(e => Math.round(e.balance || 0)),
          backgroundColor: hist.map(e => (e.balance || 0) >= 0 ? '#10B981' : '#F43F5E'),
          borderRadius: 5,
          barPercentage: 0.7,
          categoryPercentage: 0.85
        }
      ];
    }

    this.#evolucionChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: isIngVsGas,
            position: 'top',
            align: 'end',
            labels: {
              boxWidth: 8,
              boxHeight: 8,
              usePointStyle: true,
              pointStyle: 'circle',
              font: { size: 10, family: 'Inter, sans-serif' },
              color: 'var(--texto-2)'
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const val = context.parsed.y || 0;
                return ` ${context.dataset.label || ''}: $ ${val.toLocaleString('es-AR')}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10, family: 'Inter, sans-serif' }, color: 'var(--texto-3)' }
          },
          y: {
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: {
              font: { size: 9, family: 'Inter, sans-serif' },
              color: 'var(--texto-3)',
              callback: (v) => '$ ' + (Math.abs(v) >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : (v / 1000).toFixed(0) + 'k')
            }
          }
        }
      }
    });
  }

  #abrirModalDetalleMov(row) {
    const esIngreso = row.tipo_mov === 'INGRESO';
    const colorClass = esIngreso ? 'positivo' : 'negativo';
    const medioPago = row.medio_pago || '—';

    const badges = [];
    if (row.recur_group_id?.startsWith('INSTL_')) badges.push('<span class="badge badge-recur">Cuotas</span>');
    else if (row.recur_group_id) badges.push('<span class="badge badge-recur">Recurrente</span>');
    if (row.split_group_id) badges.push('<span class="badge badge-split">Split</span>');
    if (row.id_consumo_tarjeta_origen) badges.push('<span class="badge badge-tc">Tarjeta</span>');
    if (row.id_transfer_ahorro) badges.push('<span class="badge badge-ahorro">Ahorro</span>');
    if (row.id_transfer_inversion) badges.push('<span class="badge badge-ahorro">Inversión</span>');

    const isAutoGenerated = !!row.id_consumo_tarjeta_origen || !!row.id_transfer_ahorro || !!row.id_transfer_inversion;

    const detailModal = new App.Modal('modal-dash-mov-detail');
    detailModal.open({
      titulo: row.descripcion,
      icono: esIngreso ? 'trending_up' : 'trending_down',
      size: 'md',
      body: `
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">Importe</span>
            <span class="detail-value detail-amount ${colorClass}">${App.Utils.formatearMoneda(row.importe)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Tipo</span>
            <span class="detail-value"><span class="tipo-mov tipo-${row.tipo_mov?.toLowerCase()}">${App.Utils.escapeHtml(row.tipo_mov)}</span></span>
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
            <span class="detail-label">Método de Pago</span>
            <span class="detail-value">${App.Utils.escapeHtml(medioPago)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Etiquetas</span>
            <span class="detail-value">${badges.length > 0 ? badges.join(' ') : '<span style="color:var(--texto-3)">Ninguna</span>'}</span>
          </div>
        </div>
        ${!isAutoGenerated ? `
        <div class="detail-actions">
          <button class="btn btn-ghost" id="dash-mov-edit">${App.Icons.get('edit', 'icon-sm')} Editar</button>
          <button class="btn btn-danger" id="dash-mov-delete">${App.Icons.get('delete', 'icon-sm')} Eliminar</button>
        </div>` : `
        <div style="margin-top:16px;padding:12px;background:var(--primary-tint);border-radius:var(--r);font-size:0.82rem;color:var(--texto-2)">
          ${App.Icons.get('info', 'icon-sm')} Este movimiento fue generado automáticamente. Editálo desde su módulo de origen.
        </div>`}
      `,
      confirmLabel: '',
      cancelLabel: 'Cerrar'
    });
    const cb = detailModal.el.querySelector('.modal-confirm');
    if (cb) cb.style.display = 'none';

    document.getElementById('dash-mov-edit')?.addEventListener('click', () => {
      detailModal.close();
      this.#abrirModalEdicionMov(row);
    });
    document.getElementById('dash-mov-delete')?.addEventListener('click', () => {
      detailModal.close();
      this.#eliminarMov(row);
    });
  }

  #abrirModalEdicionMov(row) {
    const modal = new App.Modal('modal-dash-mov-edit');
    const tipo = row.tipo_mov;
    const esIngreso = tipo === 'INGRESO';

    const categorias = window._appCategorias || [];
    const categoriasFiltradas = categorias.filter(c => c.tipo_mov === tipo && c.activa);
    const optsCateg = categoriasFiltradas.map(c => `<option value="${c.id_categoria}" ${row.id_categoria === c.id_categoria ? 'selected' : ''}>${App.Utils.escapeHtml(c.nombre)}</option>`).join('');

    const rawFecha = (row.fecha?.value || row.fecha || '').substring(0, 10);

    const body = `
      <form id="form-dash-mov-edit" class="form-grid">
        <input type="hidden" name="id_movimiento" value="${row.id_movimiento}">
        <div class="form-group">
          <label>Monto</label>
          <input class="input" type="number" name="importe" step="0.01" value="${row.importe}" required>
        </div>
        <div class="form-group">
          <label>Fecha</label>
          <input class="input" type="date" name="fecha" value="${rawFecha}" required>
        </div>
        <div class="form-group">
          <label>Categoría</label>
          <select class="input" name="id_categoria" required>${optsCateg}</select>
        </div>
        <div class="form-group">
          <label>Medio de Pago</label>
          <select class="input" name="medio_pago">
            <option value="transferencia" ${row.medio_pago === 'transferencia' ? 'selected' : ''}>Transferencia</option>
            <option value="efectivo" ${row.medio_pago === 'efectivo' ? 'selected' : ''}>Efectivo</option>
            <option value="debito" ${row.medio_pago === 'debito' ? 'selected' : ''}>Débito</option>
            ${!esIngreso ? `<option value="credito" ${row.medio_pago === 'credito' ? 'selected' : ''}>Tarjeta Crédito</option>` : ''}
          </select>
        </div>
        <div class="form-group full-width">
          <label>Descripción</label>
          <input class="input" type="text" name="descripcion" value="${App.Utils.escapeHtml(row.descripcion)}" required>
        </div>
      </form>
    `;

    modal.open({
      titulo: 'Editar Movimiento',
      body: body,
      confirmLabel: 'Actualizar',
      onConfirm: async (m) => {
        const fd = new FormData(m.getForm());
        const payload = {
          idCuenta: App.Store.cuenta,
          tipo: tipo,
          fecha: fd.get('fecha'),
          idCategoria: fd.get('id_categoria'),
          descripcion: fd.get('descripcion'),
          importe: Number(fd.get('importe')),
          medioPago: fd.get('medio_pago')
        };

        const esSerio = !!row.recur_group_id || !!row.split_group_id;
        const doUpdate = async (scope) => {
          m.setLoading(true);
          try {
            const req = {
              data: payload,
              original: {
                movimientoId: row.id_movimiento,
                recurGroupId: row.recur_group_id || null,
                splitGroupId: row.split_group_id || null,
                fecha: rawFecha
              },
              scope: scope
            };
            await App.API.call('api_updateMovimiento', req);
            App.Toast.success('Movimiento actualizado.');
            m.close();
            App.Events.emit('data:changed');
          } catch (err) {
            m.setLoading(false);
            App.Toast.error(err.message);
          }
        };

        if (esSerio) {
          const scopeModal = new App.Modal('modal-dash-scope');
          scopeModal.open({
            titulo: 'Editar serie',
            body: '<p>¿Deseas editar solo este movimiento o toda la serie?</p>',
            confirmLabel: 'Toda la serie',
            cancelLabel: 'Solo este',
            onConfirm: () => { scopeModal.close(); doUpdate('SERIES'); }
          });
          scopeModal.el.querySelector('.modal-cancel').onclick = () => { scopeModal.close(); doUpdate('SINGLE'); };
        } else {
          await doUpdate('SINGLE');
        }
      }
    });
  }

  async #eliminarMov(row) {
    const esSerio = !!row.recur_group_id || !!row.split_group_id;
    const doDelete = async (scope) => {
      try {
        const req = {
          id: row.id_movimiento,
          recurGroupId: row.recur_group_id || null,
          splitGroupId: row.split_group_id || null,
          fecha: row.fecha?.value || row.fecha,
          scope
        };
        await App.API.call('api_deleteMovimiento', req);
        App.Toast.success('Movimiento eliminado.');
        App.Events.emit('data:changed');
      } catch (err) {
        App.Toast.error(err.message);
      }
    };

    if (!esSerio) {
      if (confirm(`¿Eliminar ${row.descripcion}?`)) await doDelete('SINGLE');
    } else {
      const scopeModal = new App.Modal('modal-dash-del-scope');
      scopeModal.open({
        titulo: 'Eliminar serie',
        body: '<p>¿Deseas eliminar solo este movimiento o toda la serie?</p>',
        confirmLabel: 'Toda la serie',
        cancelLabel: 'Solo este',
        danger: true,
        onConfirm: () => { scopeModal.close(); doDelete('SERIES'); }
      });
      scopeModal.el.querySelector('.modal-cancel').onclick = () => { scopeModal.close(); doDelete('SINGLE'); };
    }
  }


}

// Registrar

App.log('module-dashboard', 'init', 'DashboardModule registrado');