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

  #kpiIngresos = null;
  #kpiEgresos  = null;
  #kpiResult   = null;
  #movData     = [];
  #accordionOpen = false;
  #viewMode = 'portfolio'; // 'portfolio' | 'detail'

  // --- SECCIÓN 1: CICLO DE VIDA ---

  init() {
    this._buildVista();
    this._bindListeners();
    this._subscribeEvents();
    App.log('DashboardModule', 'init', 'Dashboard unificado iniciado');
  }

  async cargar() {
    if (this.#viewMode === 'portfolio') {
      await this.#cargarPortfolio();
    } else {
      await this.#cargarDetail();
    }
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

    // Update nav
    this.#renderDetailNav(cuenta);

    // Render Quick Action Bar based on active modules in this account
    const navContainer = document.getElementById('dash-modules-nav');
    if (navContainer && cuentaObj) {
      const activeModules = [];
      if (cuentaObj.modulo_tarjetas_activo) {
        activeModules.push({
          id: 'tarjetas',
          label: 'Tarjetas',
          vista: 'vista-tarjetas',
          color: 'var(--rojo)',
          bg: 'var(--rojo-tint)',
          svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`
        });
      }
      if (cuentaObj.modulo_cc_activo) {
        activeModules.push({
          id: 'cc',
          label: 'Gastos Comp.',
          vista: 'vista-cc',
          color: 'var(--verde)',
          bg: 'var(--verde-tint)',
          svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
        });
      }
      if (cuentaObj.modulo_ahorro_activo) {
        activeModules.push({
          id: 'ahorro',
          label: 'Ahorro',
          vista: 'vista-ahorro',
          color: 'var(--amarillo-text)',
          bg: 'var(--amarillo-tint)',
          svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>`
        });
      }
      if (cuentaObj.modulo_inversiones_activo) {
        activeModules.push({
          id: 'inversiones',
          label: 'Inversiones',
          vista: 'vista-inversiones',
          color: 'var(--cyan, #0ea5e9)',
          bg: 'rgba(14, 165, 233, 0.1)',
          svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`
        });
      }

      navContainer.innerHTML = activeModules.map(m => `
        <button class="dash-modules-nav-btn" data-vista="${m.vista}">
          <div class="dash-modules-nav-icon" style="background:${m.bg}; color:${m.color};">
            ${m.svg}
          </div>
          <span class="dash-modules-nav-label">${m.label}</span>
        </button>
      `).join('');

      // Bind click event for each navigation button
      navContainer.querySelectorAll('.dash-modules-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const vista = btn.dataset.vista;
          document.querySelector(`[data-vista="${vista}"]`)?.click();
        });
      });
    }

    // Toggle detailed module card scorecards based on active settings
    const cardTarjetas = document.getElementById('dash-card-tarjetas');
    const cardCC = document.getElementById('dash-card-cc');
    const cardAhorro = document.getElementById('dash-card-ahorro');
    const cardInversiones = document.getElementById('dash-card-inversiones');

    if (cardTarjetas) cardTarjetas.style.display = cuentaObj?.modulo_tarjetas_activo ? '' : 'none';
    if (cardCC) cardCC.style.display = cuentaObj?.modulo_cc_activo ? '' : 'none';
    if (cardAhorro) cardAhorro.style.display = cuentaObj?.modulo_ahorro_activo ? '' : 'none';
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
      
      if (cuentaObj?.modulo_tarjetas_activo) {
        this.#loadTarjetas(cuenta, fechaInicio, fechaFin);
      }
      if (cuentaObj?.modulo_cc_activo) {
        this.#loadCC(cuenta, fechaInicio, fechaFin);
      }
      if (cuentaObj?.modulo_ahorro_activo) {
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

    this.#kpiIngresos?.setValue(kpis.ingresos);
    this.#kpiEgresos?.setValue(kpis.egresos);
    this.#kpiResult?.setValue(kpis.resultado, { invertido: false });
       setTimeout(() => { if (window.renderChart) window.renderChart(kpis); }, 100);

    this.#movData = movimientos || [];
    this.#renderMovTable();
  }

  // --- SECCIÓN 3: BUILD DOM ---

  _buildVista() {
    const vista = document.getElementById(this.vistaId);
    if (!vista) return;

    vista.innerHTML = `
      <!-- ═══ PORTFOLIO VIEW ═══ -->
      <div id="dash-portfolio-view">
        <div class="portfolio-header">
          <h2 class="portfolio-title">Mi Portfolio</h2>
          <p class="portfolio-subtitle">Seleccioná una cuenta para ver el detalle</p>
        </div>
        <div class="portfolio-grid" id="dash-portfolio-grid"></div>
      </div>

      <!-- ═══ DETAIL VIEW (hidden initially) ═══ -->
      <div id="dash-detail-view" style="display:none">
      <div id="dash-detail-nav" class="dash-detail-nav"></div>
      <!-- ═══ KPIs PRINCIPALES ═══ -->
      <div class="kpi-grid" id="dash-kpi-grid"></div>

      <!-- ═══ BARRA DE ACCESO RÁPIDO A MÓDULOS ═══ -->
      <div class="dash-modules-nav" id="dash-modules-nav"></div>

      <!-- ═══ MOVIMIENTOS DEL MES (Acordeón) ═══ -->
      <div class="dash-section" id="dash-mov-section">
        <div class="dash-section-header" id="dash-mov-toggle">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="dash-section-icon" style="background:var(--primary-tint);color:var(--primary)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4m0 0L3 8m4-4 4 4"/><path d="M17 8v12m0 0 4-4m-4 4-4-4"/></svg>
            </span>
            <span class="dash-section-title">MOVIMIENTOS DEL MES</span>
          </div>
          <svg class="dash-chevron" id="dash-mov-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
        <div class="dash-section-body" id="dash-mov-body">
          <div id="dash-mov-table-preview"></div>
          <div id="dash-mov-table-full" class="hidden"></div>
          <button id="dash-mov-ver-mas" class="btn btn-ghost btn-sm" style="margin:12px auto;display:block">
            Ver todos los movimientos ▼
          </button>
        </div>
      </div>

      <!-- ═══ MÓDULOS SECUNDARIOS ═══ -->
      <div class="dash-cards-row" id="dash-modules-row">
        <!-- Tarjetas de Crédito -->
        <div class="dash-module-card" id="dash-card-tarjetas">
          <div class="dash-mc-header">
            <span class="dash-section-icon" style="background:var(--rojo-tint);color:var(--rojo)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></span>
            <span class="dash-mc-title">TARJETAS</span>
          </div>
          <div class="dash-mc-body">
            <div class="dash-mc-kpi-row" style="margin-bottom:12px"><div><span class="dash-mc-kpi-label">Total consumos</span><span class="dash-mc-kpi-value negativo" id="dash-tc-total">—</span></div></div>
            <div class="dash-tc-carousel">
              <button class="dash-tc-arrow" id="dash-tc-prev" disabled><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>
              <div class="dash-tc-visual" id="dash-tc-visual">
                <div class="dash-tc-plastic">
                  <div class="dash-tc-plastic-top"><svg width="28" height="20" viewBox="0 0 28 20" fill="#FFD700"><rect width="28" height="20" rx="3"/></svg><span class="dash-tc-plastic-brand" id="dash-tc-brand">—</span></div>
                  <div class="dash-tc-plastic-number" id="dash-tc-number">•••• •••• •••• ••••</div>
                  <div class="dash-tc-plastic-bottom"><span id="dash-tc-holder">—</span><span id="dash-tc-vto">—</span></div>
                </div>
              </div>
              <button class="dash-tc-arrow" id="dash-tc-next" disabled><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>
            </div>
            <div style="text-align:center;margin-top:8px;font-size:0.85rem;font-weight:600;color:var(--texto-2)" id="dash-tc-subtotal">Subtotal: —</div>
            <button id="dash-tc-ver-consumos" class="btn btn-ghost btn-sm" style="width:100%;margin-top:10px" disabled>Ver consumos de esta tarjeta</button>
          </div>
        </div>
        <!-- Gastos Compartidos -->
        <div class="dash-module-card" id="dash-card-cc">
          <div class="dash-mc-header">
            <span class="dash-section-icon" style="background:var(--verde-tint);color:var(--verde)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
            <span class="dash-mc-title">GASTOS COMPARTIDOS</span>
          </div>
          <div class="dash-mc-body">
            <div class="dash-mc-kpi-row"><div><span class="dash-mc-kpi-label">Saldo neto</span><span class="dash-mc-kpi-value" id="dash-cc-saldo">—</span></div></div>
            <button id="dash-cc-detail" class="btn btn-ghost btn-sm" style="width:100%;margin-top:10px">Ver detalle</button>
          </div>
        </div>
        <!-- Ahorro / Chanchito -->
        <div class="dash-module-card" id="dash-card-ahorro">
          <div class="dash-mc-header">
            <span class="dash-section-icon" style="background:var(--amarillo-tint);color:var(--amarillo-text)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg></span>
            <span class="dash-mc-title">CHANCHITO</span>
          </div>
          <div class="dash-mc-body">
            <div class="dash-mc-kpi-row"><div><span class="dash-mc-kpi-label">Total ahorros</span><span class="dash-mc-kpi-value" id="dash-ahorro-total">—</span></div></div>
            <button id="dash-ahorro-detail" class="btn btn-ghost btn-sm" style="width:100%;margin-top:10px">Ver alcancías</button>
          </div>
        </div>
        <!-- Inversiones -->
        <div class="dash-module-card" id="dash-card-inversiones">
          <div class="dash-mc-header">
            <span class="dash-section-icon" style="background:rgba(14, 165, 233, 0.1);color:var(--cyan, #0ea5e9)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span>
            <span class="dash-mc-title">INVERSIONES</span>
          </div>
          <div class="dash-mc-body">
            <div class="dash-mc-kpi-row"><div><span class="dash-mc-kpi-label">Valor actual</span><span class="dash-mc-kpi-value" id="dash-inversiones-valor">—</span></div></div>
            <button id="dash-inversiones-detail" class="btn btn-ghost btn-sm" style="width:100%;margin-top:10px">Ver inversiones</button>
          </div>
        </div>
      </div>

      <!-- ═══ RESUMEN IA ═══ -->
      <div class="ai-summary-card" id="dash-ai-summary">
        <div class="ai-summary-header">
          <div class="ai-summary-icon">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 2L14.09 8.26L20 9.27L15.5 13.14L16.82 19.02L12 16.24L7.18 19.02L8.5 13.14L4 9.27L9.91 8.26L12 2Z" fill="#9B72CB" stroke="none"/>
            </svg>
          </div>
          <span class="ai-summary-title">Análisis de tu cartera</span>
          <span class="ai-summary-badge gemini-sparkle-anim">✨ Próximamente</span>
        </div>
        <div class="ai-summary-body">
          <p>Pronto, la IA analizará tu composición de cartera, patrones de gastos y oportunidades de ahorro para darte recomendaciones personalizadas.</p>
          <p style="font-size:0.82rem;color:var(--texto-3);font-style:italic">Powered by Gemini AI — integración en desarrollo.</p>
        </div>
      </div>
      </div><!-- /dash-detail-view -->
    `;

    // KPI Cards
    const grid = document.getElementById('dash-kpi-grid');
    this.#kpiIngresos = new App.KpiCard(grid, {
      titulo: 'Ingresos', icono: 'trending_up', colorClass: 'kpi-green',
      onFormat: App.Utils.formatearMoneda
    });
    this.#kpiEgresos = new App.KpiCard(grid, {
      titulo: 'Egresos', icono: 'trending_down', colorClass: 'kpi-red',
      onFormat: (v) => App.Utils.formatearMoneda(Math.abs(v))
    });
    this.#kpiResult = new App.KpiCard(grid, {
      titulo: 'Balance Total', icono: 'scale', colorClass: 'kpi-blue',
      onFormat: App.Utils.formatearMoneda
    });
  }

  // --- SECCIÓN 4: LISTENERS ---

  _bindListeners() {
    // Acordeón movimientos
    document.getElementById('dash-mov-toggle')?.addEventListener('click', () => {
      const body = document.getElementById('dash-mov-body');
      const chev = document.getElementById('dash-mov-chevron');
      body?.classList.toggle('collapsed');
      chev?.classList.toggle('rotated');
    });

    // Ver más movimientos
    document.getElementById('dash-mov-ver-mas')?.addEventListener('click', () => {
      this.#accordionOpen = !this.#accordionOpen;
      this.#renderMovTable();
      const btn = document.getElementById('dash-mov-ver-mas');
      if (btn) btn.textContent = this.#accordionOpen ? 'Ver menos ▲' : 'Ver todos los movimientos ▼';
    });

    // Tarjetas carousel
    document.getElementById('dash-tc-prev')?.addEventListener('click', () => this.#navigateTc(-1));
    document.getElementById('dash-tc-next')?.addEventListener('click', () => this.#navigateTc(1));
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
      // Reload whichever view is active
      this.cargar();
    });
    App.Events.on('store:cuenta-changed', () => {
      // When account changes externally (topbar selector), go to detail mode
      if (this.#viewMode === 'portfolio') {
        this.#viewMode = 'detail';
        const pEl = document.getElementById('dash-portfolio-view');
        const dEl = document.getElementById('dash-detail-view');
        if (pEl) pEl.style.display = 'none';
        if (dEl) dEl.style.display = '';
      }
      this.#renderDetailNav(App.Store.cuenta);
      this.#cargarDetail();
      App.updateAccountSelectorVisibility();
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
    this.#kpiIngresos?.showSkeleton();
    this.#kpiEgresos?.showSkeleton();
    this.#kpiResult?.showSkeleton();
  }

  #renderMovTable() {
    const preview = document.getElementById('dash-mov-table-preview');
    const full    = document.getElementById('dash-mov-table-full');
    if (!preview) return;

    const rows = this.#accordionOpen ? this.#movData : this.#movData.slice(0, 5);

    const tableHtml = `
      <table class="dash-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Tipo</th>
            <th>Categoría</th>
            <th>Descripción</th>
            <th style="text-align:right">Importe</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length === 0
            ? '<tr><td colspan="5" style="text-align:center;color:var(--texto-3);padding:24px">No hay movimientos en el período</td></tr>'
            : rows.map(r => `
              <tr class="clickable-row" data-id="${r.id_movimiento || r.id}">
                <td>${App.Utils.formatearFecha(r.fecha?.value || r.fecha)}</td>
                <td><span class="tipo-mov tipo-${(r.tipo_mov || '').toLowerCase()}">${App.Utils.escapeHtml(r.tipo_mov || '')}</span></td>
                <td>${App.Utils.escapeHtml(r.categoria_nombre || 'General')}</td>
                <td>${App.Utils.escapeHtml(r.descripcion || '')}${r.es_recurrente ? ' <span class="badge-recurrente">Recurrente</span>' : ''}</td>
                <td style="text-align:right" class="${r.tipo_mov === 'EGRESO' ? 'negativo' : 'positivo'}">${App.Utils.formatearMoneda(r.importe)}</td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    `;
    preview.innerHTML = tableHtml;

    // Click listeners
    preview.querySelectorAll('.clickable-row').forEach(rowEl => {
      rowEl.addEventListener('click', () => {
        const id = rowEl.dataset.id;
        const row = this.#movData.find(m => (m.id_movimiento || m.id) == id);
        if (row) this.#abrirModalDetalleMov(row);
      });
    });

    const btn = document.getElementById('dash-mov-ver-mas');
    if (btn) btn.style.display = this.#movData.length > 10 ? 'block' : 'none';
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
    const marca = (tc.marca || tc.nombre || '').toUpperCase();
    
    let gradient;
    if (tc.color && tc.color.startsWith('#')) {
      gradient = `linear-gradient(135deg, ${tc.color} 0%, rgba(0,0,0,0.6) 150%)`;
    } else {
      switch(tc.color) {
        case 'red':    gradient = 'linear-gradient(135deg, #1a1a2e 0%, #c41e3a 100%)'; break;
        case 'orange': gradient = 'linear-gradient(135deg, #d35400 0%, #e67e22 100%)'; break;
        case 'purple': gradient = 'linear-gradient(135deg, #4a235a 0%, #8e44ad 100%)'; break;
        case 'green':  gradient = 'linear-gradient(135deg, #145a32 0%, #27ae60 100%)'; break;
        case 'dark':   gradient = 'linear-gradient(135deg, #2c3e50 0%, #4ca1af 100%)'; break;
        case 'black':  gradient = 'linear-gradient(135deg, #000000 0%, #1a1a1a 100%)'; break;
        case 'silver': gradient = 'linear-gradient(135deg, #bdc3c7 0%, #e2e2e2 100%)'; break;
        case 'gold':   gradient = 'linear-gradient(135deg, #b8860b 0%, #ffd700 100%)'; break;
        case 'blue':
        default:
          if (!tc.color && marca.includes('MASTER')) {
             gradient = 'linear-gradient(135deg, #1a1a2e 0%, #c41e3a 100%)';
          } else {
             gradient = 'linear-gradient(135deg, #1a1f71 0%, #2d5bab 100%)';
          }
          break;
      }
    }

    const plastic = document.querySelector('.dash-tc-plastic');
    if (plastic) plastic.style.background = gradient;

    const brandEl = document.getElementById('dash-tc-brand');
    if (brandEl) brandEl.textContent = marca;

    const numberEl = document.getElementById('dash-tc-number');
    const last4 = tc.ultimos_4 || '••••';
    if (numberEl) numberEl.textContent = `•••• •••• •••• ${last4}`;

    const holderEl = document.getElementById('dash-tc-holder');
    if (holderEl) holderEl.textContent = tc.nombre || 'Titular';

    const vtoEl = document.getElementById('dash-tc-vto');
    if (vtoEl) vtoEl.textContent = tc.vencimiento || '—/—';

    // Show per-card subtotal
    const subtotalEl = document.getElementById('dash-tc-subtotal');
    const cardData = this._tcConsumos?.[tc.id_tarjeta];
    const subtotal = cardData?.total || 0;
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