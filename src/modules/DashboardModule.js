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

  // --- SECCIÓN 1: CICLO DE VIDA ---

  init() {
    this._buildVista();
    this._bindListeners();
    this._subscribeEvents();
    App.log('DashboardModule', 'init', 'Dashboard unificado iniciado');
  }

  async cargar() {
    const { cuenta, mes } = App.Store;
    if (!cuenta || !mes) return;

    const { fechaInicio, fechaFin } = this.#calcFechas(mes);
    const cuentaObj      = App.Store.cuentas.find(c => c.id_cuenta_principal === cuenta);
    const requiereAjuste = cuentaObj?.requiere_ajuste_cc_tc ?? false;

    this.#mostrarKpiSkeletons();

    try {
      // 1) Dashboard data (movimientos + KPIs)
      const resp = await App.API.swr(
        'api_getDashboardData',
        [cuenta, fechaInicio, fechaFin, requiereAjuste],
        App.API.defaultTtl,
        (freshData) => { if (freshData?.success) this._render(freshData); }
      );
      this._render(resp.data);

      // 2) Tarjetas TC silently
      this.#loadTarjetas(cuenta, fechaInicio, fechaFin);

      // 3) Gastos Compartidos silently
      this.#loadCC(cuenta, fechaInicio, fechaFin);

      // 4) Ahorro silently
      this.#loadAhorro(cuenta, fechaInicio, fechaFin);

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
      <!-- ═══ KPIs PRINCIPALES ═══ -->
      <div class="kpi-grid" id="dash-kpi-grid"></div>

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
      const tc = this._tcList?.[this._tcIndex];
      if (tc) this.#openTcModal(tc.id_tarjeta, tc.nombre || tc.marca);
    });

    // CC detail => abre modal con tabla de consumos CC
    document.getElementById('dash-cc-detail')?.addEventListener('click', () => this.#openCcModal());

    // Ahorro detail => abre modal con subcuentas
    document.getElementById('dash-ahorro-detail')?.addEventListener('click', () => this.#openAhorroModal());
  }

  _subscribeEvents() {
    App.Events.on('store:mes-changed',    () => { App.Store.clearModuloLoaded(this.moduleId); this.cargar(); });
    App.Events.on('store:cuenta-changed', () => { App.Store.clearModuloLoaded(this.moduleId); this.cargar(); });
    App.Events.on('data:changed',   () => { App.Store.clearModuloLoaded(this.moduleId); this.cargar(); });
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

    const rows = this.#accordionOpen ? this.#movData : this.#movData.slice(0, 10);

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
    const marca = (tc.marca || '').toUpperCase();
    const isVisa = marca.includes('VISA');
    const gradient = isVisa
      ? 'linear-gradient(135deg, #1a1f71 0%, #2d5bab 100%)'
      : 'linear-gradient(135deg, #1a1a2e 0%, #c41e3a 100%)';

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

  #openTcModal(tarjetaId, tarjetaNombre) {
    const consumos = this._tcConsumos?.[tarjetaId]?.items || [];
    const modalTC = new App.Modal('modal-dash-tc');
    modalTC.open({
      titulo: `Consumos — ${tarjetaNombre}`,
      size: 'lg',
      body: `
        <table class="dash-table">
          <thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th style="text-align:right">Importe</th></tr></thead>
          <tbody>
            ${consumos.length === 0
              ? '<tr><td colspan="4" style="text-align:center;color:var(--texto-3);padding:24px">Sin consumos este mes</td></tr>'
              : consumos.map(c => `
                <tr>
                  <td>${App.Utils.formatearFecha(c.fecha?.value || c.fecha)}</td>
                  <td>${App.Utils.escapeHtml(c.descripcion || '')}${c.cuota_actual && c.cuotas_total ? ` <span style="font-size:0.78rem;color:var(--texto-3)">(${c.cuota_actual}/${c.cuotas_total})</span>` : ''}</td>
                  <td>${App.Utils.escapeHtml(c.categoria_nombre || 'General')}</td>
                  <td style="text-align:right">${App.Utils.formatearMoneda(c.importe)}</td>
                </tr>
              `).join('')}
          </tbody>
        </table>
      `,
      confirmLabel: '',
      cancelLabel: 'Cerrar'
    });
    const cb = modalTC.el.querySelector('.modal-confirm');
    if (cb) cb.style.display = 'none';
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

  #openCcModal() {
    const consumos = this._ccData?.consumos || [];
    const kpis = this._ccData?.kpis || {};

    // Agrupar por usuario para mostrar saldos
    const porUsuario = {};
    const usuarios = window._appUsuariosCC || [];
    consumos.forEach(c => {
      const uid = c.id_usuario || '_sin_asignar';
      if (!porUsuario[uid]) {
        const usr = usuarios.find(u => u.id_usuario === uid);
        porUsuario[uid] = { nombre: usr?.nombre || c.nombre_usuario || 'Sin asignar', saldo: 0, items: [] };
      }
      const miParte = (Number(c.importe || 0) * Number(c.porcentaje_imputado || 100)) / 100;
      if (c.pagador === 'YO') porUsuario[uid].saldo += miParte;
      else porUsuario[uid].saldo -= miParte;
      porUsuario[uid].items.push(c);
    });

    const m = new App.Modal('modal-dash-cc');
    m.open({
      titulo: 'Gastos Compartidos del Mes',
      size: 'lg',
      body: `
        <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
          <div style="padding:8px 14px;background:var(--verde-tint);border-radius:var(--r);flex:1;min-width:120px;">
            <span style="font-size:0.72rem;color:var(--verde-text);font-weight:600;text-transform:uppercase;">Pagué yo</span>
            <strong style="display:block;font-size:1.1rem;margin-top:2px;color:var(--texto);">${App.Utils.formatearMoneda(kpis.gastoYo || 0)}</strong>
          </div>
          <div style="padding:8px 14px;background:var(--rojo-tint);border-radius:var(--r);flex:1;min-width:120px;">
            <span style="font-size:0.72rem;color:var(--rojo);font-weight:600;text-transform:uppercase;">Pagó otro</span>
            <strong style="display:block;font-size:1.1rem;margin-top:2px;color:var(--texto);">${App.Utils.formatearMoneda(kpis.gastoOtro || 0)}</strong>
          </div>
          <div style="padding:8px 14px;background:${(kpis.saldoNeto || 0) >= 0 ? 'var(--verde-tint)' : 'var(--rojo-tint)'};border-radius:var(--r);flex:1;min-width:120px;">
            <span style="font-size:0.72rem;color:var(--texto-3);font-weight:600;text-transform:uppercase;">Saldo Neto</span>
            <strong style="display:block;font-size:1.1rem;margin-top:2px;color:var(--texto);" class="${(kpis.saldoNeto || 0) >= 0 ? 'positivo' : 'negativo'}">${App.Utils.formatearMoneda(kpis.saldoNeto || 0)}</strong>
          </div>
        </div>
        <table class="dash-table">
          <thead><tr><th>Fecha</th><th>Pagador</th><th>Categoría</th><th>Descripción</th><th style="text-align:right">Total</th><th style="text-align:right">Mi parte</th></tr></thead>
          <tbody>
            ${consumos.length === 0
              ? '<tr><td colspan="6" style="text-align:center;color:var(--texto-3);padding:24px">Sin gastos compartidos este mes</td></tr>'
              : consumos.map(c => {
                  const miParte = (Number(c.importe || 0) * Number(c.porcentaje_imputado || 100)) / 100;
                  return `
                <tr>
                  <td>${App.Utils.formatearFecha(c.fecha?.value || c.fecha)}</td>
                  <td>${App.Utils.escapeHtml(c.pagador || '—')}</td>
                  <td>${App.Utils.escapeHtml(c.categoria_nombre || 'General')}</td>
                  <td>${App.Utils.escapeHtml(c.descripcion || '')}</td>
                  <td style="text-align:right">${App.Utils.formatearMoneda(c.importe)}</td>
                  <td style="text-align:right" class="negativo">${App.Utils.formatearMoneda(miParte)}</td>
                </tr>`;
                }).join('')}
          </tbody>
        </table>
      `,
      confirmLabel: '',
      cancelLabel: 'Cerrar'
    });
    const cb = m.el.querySelector('.modal-confirm');
    if (cb) cb.style.display = 'none';
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

  #openAhorroModal() {
    const data = this._ahorroData;
    const subcuentas = data?.subcuentas || [];
    const transferencias = data?.transferencias || [];
    const kpis = data?.kpis || {};

    // Enriquecer subcuentas con movimientos y saldos del período
    const enrichedSubs = subcuentas.map(sc => {
      const movs = transferencias.filter(t => t.id_subcuenta === sc.id_subcuenta);
      let saldo = 0;
      movs.forEach(m => {
        const imp = Number(m.importe || 0);
        if (m.tipo_transfer === 'DEPOSITO') saldo += imp;
        else if (m.tipo_transfer === 'RETIRO') saldo -= imp;
        else saldo += imp; // default
      });
      return { ...sc, movimientos: movs, saldo };
    });

    const m = new App.Modal('modal-dash-ahorro');
    m.open({
      titulo: '🐷 Mis Alcancías',
      size: 'lg',
      body: `
        <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
          <div style="padding:8px 14px;background:var(--verde-tint);border-radius:var(--r);flex:1;min-width:120px;">
            <span style="font-size:0.72rem;color:var(--verde-text);font-weight:600;text-transform:uppercase;">ARS</span>
            <strong style="display:block;font-size:1.1rem;margin-top:2px;color:var(--texto);">${App.Utils.formatearMoneda(kpis.arsTotal || 0)}</strong>
          </div>
          <div style="padding:8px 14px;background:var(--primary-tint);border-radius:var(--r);flex:1;min-width:120px;">
            <span style="font-size:0.72rem;color:var(--primary);font-weight:600;text-transform:uppercase;">USD</span>
            <strong style="display:block;font-size:1.1rem;margin-top:2px;color:var(--texto);">${App.Utils.formatearMonedaUSD(kpis.usdTotal || 0)}</strong>
          </div>
          <div style="padding:8px 14px;background:var(--amarillo-tint);border-radius:var(--r);flex:1;min-width:120px;">
            <span style="font-size:0.72rem;color:var(--amarillo-text);font-weight:600;text-transform:uppercase;">Consolidado</span>
            <strong style="display:block;font-size:1.1rem;margin-top:2px;color:var(--texto);">${App.Utils.formatearMoneda(kpis.consolidadoArs || 0)}</strong>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${enrichedSubs.length === 0
            ? '<p style="text-align:center;color:var(--texto-3);padding:24px">No hay alcancías configuradas</p>'
            : enrichedSubs.map(sc => `
              <div class="dash-ahorro-sub">
                <div class="dash-ahorro-sub-header">
                  <span style="font-weight:600;font-size:0.95rem">${App.Utils.escapeHtml(sc.nombre || 'Alcancía')} <small style="color:var(--texto-3)">(${sc.moneda || 'ARS'})</small></span>
                  <span style="font-weight:700;font-size:1.1rem">${sc.moneda === 'USD' ? App.Utils.formatearMonedaUSD(sc.saldo) : App.Utils.formatearMoneda(sc.saldo)}</span>
                </div>
                ${sc.movimientos && sc.movimientos.length > 0 ? `
                  <table class="dash-table" style="font-size:0.82rem;margin-top:8px">
                    <thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th style="text-align:right">Importe</th></tr></thead>
                    <tbody>${sc.movimientos.map(mv => `
                      <tr>
                        <td>${App.Utils.formatearFecha(mv.fecha?.value || mv.fecha)}</td>
                        <td><span class="tipo-mov tipo-${mv.tipo_transfer === 'DEPOSITO' ? 'ingreso' : 'egreso'}">${mv.tipo_transfer || '—'}</span></td>
                        <td>${App.Utils.escapeHtml(mv.descripcion || '')}</td>
                        <td style="text-align:right">${sc.moneda === 'USD' ? App.Utils.formatearMonedaUSD(mv.importe) : App.Utils.formatearMoneda(mv.importe)}</td>
                      </tr>
                    `).join('')}</tbody>
                  </table>
                ` : '<p style="color:var(--texto-3);font-size:0.82rem;padding:8px 0">Sin movimientos este mes</p>'}
              </div>
            `).join('')}
        </div>
      `,
      confirmLabel: '',
      cancelLabel: 'Cerrar'
    });
    const cb = m.el.querySelector('.modal-confirm');
    if (cb) cb.style.display = 'none';
  }
}

// Registrar

App.log('module-dashboard', 'init', 'DashboardModule registrado');