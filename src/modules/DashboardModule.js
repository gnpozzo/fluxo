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

    const saldoValEl = document.getElementById('dash-saldo-val');
    const breakdownIngresosEl = document.getElementById('dash-breakdown-ingresos');
    const breakdownEgresosEl = document.getElementById('dash-breakdown-egresos');

    if (saldoValEl) {
      saldoValEl.textContent = App.Utils.formatearMoneda(kpis.resultado);
      saldoValEl.classList.toggle('negativo', kpis.resultado < 0);
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
      <!-- ═══ MOVIMIENTOS DEL MES (Acordeón) ═══ -->
      <div class="dash-section" id="dash-mov-section">
        <div class="dash-section-header" id="dash-mov-toggle">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="dash-section-icon" style="background:var(--primary-tint);color:var(--primary)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4m0 0L3 8m4-4 4 4"/><path d="M17 8v12m0 0 4-4m-4 4-4-4"/></svg>
            </span>
            <span class="dash-section-title">MOVIMIENTOS DEL MES</span>
          </div>
          <svg class="dash-chevron" id="dash-mov-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
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
              <div class="dash-tc-visual" id="dash-tc-visual" style="display:flex; justify-content:center; align-items:center;">
                <div class="tc-card-pill" style="background: linear-gradient(135deg, #1D195D 0%, #0c0a2a 100%); cursor: default; margin: 0 auto; user-select: none;">
                  <div class="tc-card-shimmer"></div>
                  <div class="tc-card-row tc-card-top">
                    <span class="tc-card-issuer-name">SANTANDER</span>
                    <svg class="tc-card-issuer-logo" viewBox="0 0 32 32" fill="#ffffff" style="display:block;">
                      <path d="M16.1 2C16 2.1 12.1 7.2 12.1 11.4c0 3.3 2 5.8 4 7.6 1.8 1.6 3.1 3.5 3.1 6.1 0 4.1-3.3 7.4-7.4 7.4S4.4 29.1 4.4 25c0-4.1 2.2-7.5 4.9-9.8 1-1 2.1-2 2.1-3.6 0-2.4-1.9-4-1.9-4 0 0 .9.8 1.4 1.7 1.2 2.1.5 4.3-.6 5.6-2.1 2.4-3.4 5.2-3.4 8.7 0 5.4 4.4 9.8 9.8 9.8s9.8-4.4 9.8-9.8c0-5.4-3.5-9.3-6.5-12.7C18.5 8.7 16.1 2 16.1 2z" />
                    </svg>
                  </div>
                  <div class="tc-card-row tc-card-middle">
                    <div class="tc-card-chip"><div class="tc-card-chip-inner"></div></div>
                    <svg class="tc-card-contactless" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="display:block;">
                      <path d="M5 8a9 9 0 0 1 0 8" opacity="0.3"/>
                      <path d="M8 6a12 12 0 0 1 0 12" opacity="0.5"/>
                      <path d="M11 4a15 15 0 0 1 0 16" opacity="0.7"/>
                      <path d="M14 2a18 18 0 0 1 0 20"/>
                    </svg>
                  </div>
                  <div class="tc-card-row tc-card-bottom">
                    <div class="tc-card-bottom-left">
                      <span class="tc-card-number">**** ••••</span>
                      <span class="tc-card-amount">$0,00</span>
                    </div>
                    <div class="tc-card-bottom-right">
                      <svg viewBox="0 0 48 16" width="36" height="12" fill="#ffffff" style="opacity:0.95; display:block;"><path d="M18.2 1.2L15.3 15h-2.8L9.7 4.1C9.2 3.6 8.7 3.3 8 3.2L5 3v-.4h4.6c.6 0 1.1.4 1.2 1L12 11.2l3.5-10h2.7zm9.6 9.4c0-2.5-3.5-2.6-3.5-3.7 0-.3.3-.7 1-.8.3 0 1.3-.1 2.4.4l.4-2.5C27.4 3.7 26.3 3.4 25 3.4c-2.8 0-4.8 1.5-4.8 3.6 0 2.8 3.9 3 3.9 4.5 0 .5-.5.9-1.2.9-1.6 0-2.7-.7-2.7-.7l-.4 2.6c.7.3 2.1.6 3.5.6 3 0 5.2-1.5 5.2-3.7zM38.8 15h2.4L43.3 1.2h-2.4L38.8 15zm-9.3-13.8L27.2 15h2.6l1.6-4.4h6.3l.6 4.4h2.3L37.2 1.2H29.5zm2.3 7.2l2-5.5 1.1 5.5H31.8zM4.6 1.2L.2 11.9v.2c.4 1.1 1.5 1.7 2.6 1.7H11L12.3 8 7.6 1.2H4.6z" /></svg>
                    </div>
                  </div>
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
    `;
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
    const full    = document.getElementById('dash-mov-table-full');
    if (!preview) return;

    const rows = this.#accordionOpen ? this.#movData : this.#movData.slice(0, 5);

    const tableHtml = `
      <table class="dash-table">
        <thead>
          <tr>
            <th>FECHA ▲</th>
            <th>TIPO ⇅</th>
            <th>CATEGORÍA ⇅</th>
            <th>DESCRIPCIÓN ⇅</th>
            <th style="text-align:right">IMPORTE</th>
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