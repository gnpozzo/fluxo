'use strict';
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
  #accordionOpen = false;
  #viewMode = 'detail'; // 'portfolio' | 'detail'

  get movData() { return this.#movData; }

  // --- SECCIÓN 1: CICLO DE VIDA ---

  init() {
    this._buildVista();
    this._bindListeners();
    this._subscribeEvents();
    App.log('DashboardModule', 'init', 'Dashboard unificado iniciado');
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
            <span class="portfolio-kpi-label">Egresos</span>
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

    const hasTarjetas = (window._appTarjetas || []).some(t => t.id_cuenta_principal === cuentaObj?.id_cuenta_principal);
    const hasAhorro = (window._appSubcuentas || []).some(s => s.id_cuenta_principal === cuentaObj?.id_cuenta_principal);

    if (cardTarjetas) cardTarjetas.style.display = hasTarjetas ? '' : 'none';
    if (cardCC) cardCC.style.display = cuentaObj?.modulo_cc_activo ? '' : 'none';
    if (cardAhorro) cardAhorro.style.display = hasAhorro ? '' : 'none';
    if (cardInversiones) cardInversiones.style.display = cuentaObj?.modulo_inversiones_activo ? '' : 'none';

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

    setTimeout(() => { if (window.renderChart) window.renderChart(kpis); }, 100);

    this.#movData = movimientos || [];
    this.#renderMovTable();
  }

  // --- SECCIÓN 3: BUILD DOM ---

  _buildVista() {
    const vista = document.getElementById(this.vistaId);
    if (!vista) return;

    vista.innerHTML = `
      <!-- ═══ TOP ROW: HERO PATRIMONIAL & ACCIONES RÁPIDAS ═══ -->
      <div class="dash-hero-grid">
        
        <!-- Hero Saldo Card -->
        <div class="fintech-hero-card" id="dash-saldo-card">
          <div class="fhc-header">
            <div class="fhc-title-wrap">
              <span class="fhc-badge">Patrimonio Disponible</span>
              <span class="fhc-subtitle">Balance y flujo mensual</span>
            </div>
            <button class="fhc-visibility-btn" id="btn-toggle-privacy" title="Ocultar/Mostrar saldo" aria-label="Alternar privacidad">
              <svg id="icon-eye-open" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg id="icon-eye-closed" class="hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            </button>
          </div>

          <div class="fhc-body">
            <div class="fhc-main-amount" id="dash-saldo-val">$ 0,00</div>
            <div class="fhc-conversion-text" id="dash-conversion-val">≈ US$ 0,00</div>
          </div>

          <div class="fhc-breakdown-row">
            <div class="fhc-stat-box fhc-stat-ing">
              <div class="fhc-stat-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
              </div>
              <div class="fhc-stat-info">
                <span class="fhc-stat-label">Ingresos</span>
                <span class="fhc-stat-val positivo" id="dash-breakdown-ingresos">$ 0,00</span>
              </div>
            </div>

            <div class="fhc-stat-divider"></div>

            <div class="fhc-stat-box fhc-stat-egr">
              <div class="fhc-stat-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>
              </div>
              <div class="fhc-stat-info">
                <span class="fhc-stat-label">Egresos</span>
                <span class="fhc-stat-val negativo" id="dash-breakdown-egresos">$ 0,00</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Quick Actions Panel -->
        <div class="fintech-actions-card">
          <div class="fac-header">
            <span class="fac-title">Acciones Directas</span>
          </div>
          <div class="fac-grid">
            <button class="fac-btn" id="qa-btn-gasto" onclick="App.Modules.movimientos?.abrirAlta('EGRESO')">
              <div class="fac-btn-icon icon-red">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>
              </div>
              <span class="fac-btn-label">Gasto</span>
            </button>

            <button class="fac-btn" id="qa-btn-ingreso" onclick="App.Modules.movimientos?.abrirAlta('INGRESO')">
              <div class="fac-btn-icon icon-green">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
              </div>
              <span class="fac-btn-label">Ingreso</span>
            </button>

            <button class="fac-btn" id="qa-btn-tc" onclick="App.Modules.tarjetas?.abrirAlta()">
              <div class="fac-btn-icon icon-blue">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              </div>
              <span class="fac-btn-label">Tarjeta</span>
            </button>

            <button class="fac-btn" id="qa-btn-cc" onclick="App.Modules.cc?.abrirAlta()">
              <div class="fac-btn-icon icon-purple">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <span class="fac-btn-label">Compartido</span>
            </button>

            <button class="fac-btn" id="qa-btn-ahorro" onclick="App.Modules.ahorro?.abrirAlta()">
              <div class="fac-btn-icon icon-yellow">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>
              </div>
              <span class="fac-btn-label">Ahorrar</span>
            </button>

            <button class="fac-btn" id="qa-btn-inversiones" onclick="document.querySelector('[data-vista=vista-inversiones]')?.click()">
              <div class="fac-btn-icon icon-cyan">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              </div>
              <span class="fac-btn-label">Invertir</span>
            </button>
          </div>
        </div>

      </div>

      <!-- ═══ BENTO GRID: 4 MÓDULOS DE RESUMEN PATRIMONIAL ═══ -->
      <div class="dash-bento-section">
        <div class="dbs-header">
          <h3 class="dbs-title">Tus Pilares Patrimoniales</h3>
          <span class="dbs-subtitle">Resumen y estado de tus cuentas activas</span>
        </div>

        <div class="dash-bento-grid" id="dash-modules-row">
          
          <!-- 1. Tarjetas de Crédito -->
          <div class="bento-card bento-card-tarjetas" id="dash-card-tarjetas">
            <div class="bc-top">
              <div class="bc-icon icon-blue">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              </div>
              <span class="bc-tag">Tarjetas</span>
              <button class="bc-arrow-btn" id="dash-tc-ver-consumos" title="Ver detalle de tarjetas">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
            <div class="bc-main">
              <span class="bc-label">Total consumos del ciclo</span>
              <span class="bc-value negativo" id="dash-tc-total">—</span>
            </div>
            <div class="bc-preview-wrap">
              <div class="dash-tc-carousel">
                <button class="dash-tc-arrow" id="dash-tc-prev" disabled><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>
                <div class="dash-tc-visual" id="dash-tc-visual">
                  <div class="tc-card-pill" style="background: linear-gradient(135deg, #1D195D 0%, #0c0a2a 100%);">
                    <div class="tc-card-shimmer"></div>
                    <div class="tc-card-row tc-card-top">
                      <span class="tc-card-issuer-name">SANTANDER</span>
                      <svg class="tc-card-issuer-logo" viewBox="0 0 32 32" fill="#ffffff" width="16" height="16"><path d="M16.1 2C16 2.1 12.1 7.2 12.1 11.4c0 3.3 2 5.8 4 7.6 1.8 1.6 3.1 3.5 3.1 6.1 0 4.1-3.3 7.4-7.4 7.4S4.4 29.1 4.4 25c0-4.1 2.2-7.5 4.9-9.8 1-1 2.1-2 2.1-3.6 0-2.4-1.9-4-1.9-4 0 0 .9.8 1.4 1.7 1.2 2.1.5 4.3-.6 5.6-2.1 2.4-3.4 5.2-3.4 8.7 0 5.4 4.4 9.8 9.8 9.8s9.8-4.4 9.8-9.8c0-5.4-3.5-9.3-6.5-12.7C18.5 8.7 16.1 2 16.1 2z"/></svg>
                    </div>
                    <div class="tc-card-row tc-card-bottom">
                      <span class="tc-card-number">**** ••••</span>
                      <span class="tc-card-amount">$0,00</span>
                    </div>
                  </div>
                </div>
                <button class="dash-tc-arrow" id="dash-tc-next" disabled><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>
              </div>
            </div>
            <div class="bc-footer" id="dash-tc-subtotal">Subtotal: —</div>
          </div>

          <!-- 2. Gastos Compartidos (Clearing) -->
          <div class="bento-card bento-card-cc" id="dash-card-cc">
            <div class="bc-top">
              <div class="bc-icon icon-purple">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <span class="bc-tag">Clearing</span>
              <button class="bc-arrow-btn" id="dash-cc-detail" title="Ver detalle de gastos compartidos">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
            <div class="bc-main">
              <span class="bc-label">Saldo neto a liquidar</span>
              <span class="bc-value" id="dash-cc-saldo">—</span>
            </div>
            <div class="bc-desc-box">
              <span class="bc-desc-text">Balance consolidado de deudas y créditos con convivientes.</span>
            </div>
            <div class="bc-footer bc-footer-link" onclick="document.querySelector('[data-vista=vista-cc]')?.click()">Ver conciliación →</div>
          </div>

          <!-- 3. Chanchito (Ahorros) -->
          <div class="bento-card bento-card-ahorro" id="dash-card-ahorro">
            <div class="bc-top">
              <div class="bc-icon icon-yellow">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>
              </div>
              <span class="bc-tag">Chanchito</span>
              <button class="bc-arrow-btn" id="dash-ahorro-detail" title="Ver alcancías de ahorro">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
            <div class="bc-main">
              <span class="bc-label">Fondo de reserva acumulado</span>
              <span class="bc-value positivo" id="dash-ahorro-total">—</span>
            </div>
            <div class="bc-desc-box">
              <span class="bc-desc-text">Ahorro líquido separado en alcancías para metas programadas.</span>
            </div>
            <div class="bc-footer bc-footer-link" onclick="document.querySelector('[data-vista=vista-ahorro]')?.click()">Ver alcancías →</div>
          </div>

          <!-- 4. Inversiones -->
          <div class="bento-card bento-card-inversiones" id="dash-card-inversiones">
            <div class="bc-top">
              <div class="bc-icon icon-cyan">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              </div>
              <span class="bc-tag">Inversiones</span>
              <button class="bc-arrow-btn" id="dash-inversiones-detail" title="Ver portafolio de inversiones">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
            <div class="bc-main">
              <span class="bc-label">Valuación de cartera viva</span>
              <span class="bc-value" id="dash-inversiones-valor">—</span>
            </div>
            <div class="bc-desc-box">
              <span class="bc-desc-text">Rendimiento en LECAPs, ONs en dólares y CEDEARs.</span>
            </div>
            <div class="bc-footer bc-footer-link" onclick="document.querySelector('[data-vista=vista-inversiones]')?.click()">Ver portafolio →</div>
          </div>

        </div>
      </div>

      <!-- ═══ FEED MODERNO: ÚLTIMAS TRANSACCIONES ═══ -->
      <div class="dash-feed-section" id="dash-mov-section">
        <div class="dfs-header">
          <div class="dfs-title-wrap">
            <div class="dfs-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </div>
            <div>
              <h3 class="dfs-title">Últimos Movimientos</h3>
              <span class="dfs-subtitle">Transacciones del período seleccionado</span>
            </div>
          </div>
          <button id="dash-mov-ver-mas" class="dfs-all-btn">
            <span>Ver todos los movimientos</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>

        <div class="dfs-body" id="dash-mov-body">
          <div id="dash-mov-table-preview" class="fintech-feed-container"></div>
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

    // Ver más movimientos
    document.getElementById('dash-mov-ver-mas')?.addEventListener('click', () => {
      this.#accordionOpen = !this.#accordionOpen;
      this.#renderMovTable();
      const btn = document.getElementById('dash-mov-ver-mas');
      if (btn) {
        btn.querySelector('span').textContent = this.#accordionOpen ? 'Mostrar menos' : 'Ver todos los movimientos';
        btn.querySelector('svg')?.classList.toggle('rotated', this.#accordionOpen);
      }
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

  #renderMovTable() {
    const preview = document.getElementById('dash-mov-table-preview');
    if (!preview) return;

    const rows = this.#accordionOpen ? this.#movData : this.#movData.slice(0, 5);

    if (rows.length === 0) {
      preview.innerHTML = `
        <div class="dfs-empty">
          <div class="dfs-empty-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          </div>
          <span>No hay movimientos registrados en este período</span>
        </div>
      `;
      const btn = document.getElementById('dash-mov-ver-mas');
      if (btn) btn.style.display = 'none';
      return;
    }

    const getCategoryIconSvg = (catName, tipo) => {
      const cat = (catName || '').toLowerCase();
      if (tipo === 'INGRESO') {
        return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
      }
      if (cat.includes('super') || cat.includes('alimen') || cat.includes('comida')) {
        return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`;
      }
      if (cat.includes('serv') || cat.includes('luz') || cat.includes('gas') || cat.includes('internet')) {
        return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
      }
      if (cat.includes('auto') || cat.includes('combust') || cat.includes('nafta') || cat.includes('viaje')) {
        return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`;
      }
      if (cat.includes('salud') || cat.includes('farmacia')) {
        return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`;
      }
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12V8H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>`;
    };

    const feedHtml = `
      <div class="dfs-list">
        ${rows.map(r => {
          const esIngreso = r.tipo_mov === 'INGRESO';
          const iconClass = esIngreso ? 'icon-green' : 'icon-subtle';
          const sign = esIngreso ? '+' : '-';
          const valClass = esIngreso ? 'positivo' : 'negativo';
          const catName = r.categoria_nombre || (esIngreso ? 'Ingreso' : 'General');
          const desc = r.descripcion || catName;
          const fechaStr = App.Utils.formatearFecha(r.fecha?.value || r.fecha);

          return `
            <div class="dfs-item clickable-row" data-id="${r.id_movimiento || r.id}">
              <div class="dfs-item-left">
                <div class="dfs-item-icon ${iconClass}">
                  ${getCategoryIconSvg(catName, r.tipo_mov)}
                </div>
                <div class="dfs-item-text">
                  <span class="dfs-item-desc">${App.Utils.escapeHtml(desc)}</span>
                  <div class="dfs-item-meta">
                    <span class="dfs-item-cat">${App.Utils.escapeHtml(catName)}</span>
                    <span class="dfs-meta-dot">•</span>
                    <span class="dfs-item-date">${fechaStr}</span>
                    ${r.es_recurrente ? '<span class="dfs-badge-recur">Recurrente</span>' : ''}
                  </div>
                </div>
              </div>
              <div class="dfs-item-right">
                <span class="dfs-item-amount ${valClass}">${sign} ${App.Utils.formatearMoneda(r.importe)}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    preview.innerHTML = feedHtml;

    // Click listeners for transactions
    preview.querySelectorAll('.clickable-row').forEach(rowEl => {
      rowEl.addEventListener('click', () => {
        const id = rowEl.dataset.id;
        const row = this.#movData.find(m => (m.id_movimiento || m.id) == id);
        if (row) this.#abrirModalDetalleMov(row);
      });
    });

    const btn = document.getElementById('dash-mov-ver-mas');
    if (btn) btn.style.display = this.#movData.length > 5 ? 'flex' : 'none';
  }

  // --- SECCIÓN 6: TARJETAS DE CRÉDITO ---

  async #loadTarjetas(cuenta, fechaInicio, fechaFin) {
    try {
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
    this._tcList = tarjetas;
    this._tcIndex = 0;

    // Build set of valid tarjeta IDs for this account
    const validTcIds = new Set(tarjetas.map(t => t.id_tarjeta));

    // Aggregate consumos by tarjeta — ONLY for tarjetas belonging to THIS account
    const consumosByTc = {};
    let totalGlobal = 0;
    (data.consumos || []).forEach(c => {
      const tid = c.id_tarjeta;
      if (!validTcIds.has(tid)) return; // Skip consumos from other accounts' tarjetas
      if (!consumosByTc[tid]) consumosByTc[tid] = { total: 0, count: 0, items: [] };
      consumosByTc[tid].total += Number(c.importe || 0);
      consumosByTc[tid].count++;
      consumosByTc[tid].items.push(c);
      totalGlobal += Number(c.importe || 0);
    });
    this._tcConsumos = consumosByTc;

    // KPI total
    const totalEl = document.getElementById('dash-tc-total');
    if (totalEl) totalEl.textContent = App.Utils.formatearMoneda(totalGlobal);

    // Enable arrows if > 1 tarjeta
    const prevBtn = document.getElementById('dash-tc-prev');
    const nextBtn = document.getElementById('dash-tc-next');
    const verBtn  = document.getElementById('dash-tc-ver-consumos');
    if (tarjetas.length > 1) {
      nextBtn && (nextBtn.disabled = false);
    }
    if (tarjetas.length > 0) {
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
    const brandLogoHtml = getBrandLogoHtml(rawMarca);

    const cardData = this._tcConsumos?.[tc.id_tarjeta];
    const subtotal = cardData?.total || 0;

    const cardHtml = `
      <div class="tc-card-pill" style="background:${gradient}; cursor:default; margin: 0 auto; user-select: none;">
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
            <span class="tc-card-amount">${App.Utils.formatearMoneda(subtotal)}</span>
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

    // Show per-card subtotal
    const subtotalEl = document.getElementById('dash-tc-subtotal');
    if (subtotalEl) {
      subtotalEl.textContent = `Subtotal: ${App.Utils.formatearMoneda(subtotal)}`;
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

  async #loadAhorro(cuenta, fechaInicio, fechaFin) {
    const applyAhorro = (data) => {
      this._ahorroData = data;
      const total = (data.kpis?.arsTotal || 0);
      const el = document.getElementById('dash-ahorro-total');
      if (el) el.textContent = App.Utils.formatearMoneda(total);
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
      const el = document.getElementById('dash-inversiones-valor');
      if (el) el.textContent = App.Utils.formatearMoneda(valorActual);
    };
    try {
      const resp = await App.API.swr(
        'api_getPortfolio', [cuenta], App.API.defaultTtl,
        (fresh) => { if (fresh?.success) applyInversiones(fresh); }
      );
      if (resp.data?.success) applyInversiones(resp.data);
    } catch (e) { App.error('Dashboard', '#loadInversiones', e.message, e); }
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