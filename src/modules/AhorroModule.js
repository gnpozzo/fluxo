'use strict';
/* ============================================================
   module-ahorro.js — v6.0.0 (FinSet 3-Row Architecture)
   Módulo Ahorro ARS/USD (Chanchito).
   Extiende BaseModule. Carga lazy con cache sessionStorage.
   ============================================================ */

import Chart from 'chart.js/auto';

// --- SECCIÓN 0: CLASE AhorroModule ---

export class AhorroModule extends BaseModule {

  get moduleId() { return 'ahorro'; }
  get vistaId()  { return 'vista-ahorro'; }

  get _createEndpoint() { return 'api_createAhorro'; }
  get _updateEndpoint() { return 'api_updateAhorro'; }
  get _deleteEndpoint() { return 'api_deleteAhorro'; }

  #modal              = null;
  #vistaActual        = 'ARS'; // 'ARS' | 'USD'
  #tipoFiltro         = 'ALL'; // 'ALL' | 'DEPOSITO' | 'RETIRO'
  #busqueda           = '';
  #dataCompleta       = null;
  #cotizacion         = null;
  #editData           = null;
  #flowPeriod         = '6M';  // '6M' | '12M' | 'YTD'
  #chartInstance      = null;
  #donutChartInstance = null;
  #subcuentaFiltro    = null;

  // --- SECCIÓN 1: CICLO DE VIDA ---

  init() {
    this.#modal = new App.Modal('modal-ahorro');
    this._buildVista();
    this._bindListeners();
    this._subscribeEvents();
    App.log('AhorroModule', 'init', 'Módulo ahorro iniciado (FinSet)');
  }

  async cargar() {
    if (App.Store.isModuloLoaded(this.moduleId)) return;
    const { cuenta, mes } = App.Store;
    if (!cuenta || !mes) return;

    const { fechaInicio, fechaFin } = this.#calcFechas(mes);
    this.#mostrarKpiSkeletons();

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

  destruir() {
    if (this.#chartInstance) {
      this.#chartInstance.destroy();
      this.#chartInstance = null;
    }
    if (this.#donutChartInstance) {
      this.#donutChartInstance.destroy();
      this.#donutChartInstance = null;
    }
    super.destruir();
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
    const tasa = this.#cotizacion?.venta || App.Store.exchangeRate || 0;

    // Scorecard 1: ARS
    const valArsEl = document.getElementById('aho-kpi-val-ars');
    const subArsEl = document.getElementById('aho-kpi-sub-ars');
    if (valArsEl) valArsEl.textContent = App.Utils.formatearMoneda(kpis.arsTotal);
    if (subArsEl) {
      subArsEl.textContent = tasa ? `Eq: USD ${App.Utils.formatearMoneda(kpis.arsTotal / tasa, false)}` : 'Eq: —';
    }

    // Scorecard 2: USD
    const valUsdEl = document.getElementById('aho-kpi-val-usd');
    const subUsdEl = document.getElementById('aho-kpi-sub-usd');
    if (valUsdEl) valUsdEl.textContent = 'US$ ' + Number(kpis.usdTotal || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (subUsdEl) {
      subUsdEl.textContent = tasa ? `Eq: ARS ${App.Utils.formatearMoneda(kpis.usdTotal * tasa, false)} (1 USD = $${App.Utils.formatearMoneda(tasa, false)})` : 'Eq: —';
    }

    // Scorecard 3: Consolidado ARS
    const valConsolEl = document.getElementById('aho-kpi-val-consol');
    const subConsolEl = document.getElementById('aho-kpi-sub-consol');
    if (valConsolEl) valConsolEl.textContent = App.Utils.formatearMoneda(kpis.consolidadoArs);
    if (subConsolEl) {
      subConsolEl.textContent = this.#cotizacion?.fecha
        ? `Cotización: ${App.Utils.formatearFecha(this.#cotizacion.fecha)}`
        : 'Patrimonio en alcancías';
    }

    // Scorecard 4: Meta / Tasa de Ahorro
    const valMetaEl = document.getElementById('aho-kpi-val-meta');
    const subMetaEl = document.getElementById('aho-kpi-sub-meta');
    const fillMetaEl = document.getElementById('aho-meta-progress-fill');
    const transferencias = data.transferencias || [];
    const depositosMes = transferencias
      .filter(t => t.tipo_mov === 'DEPOSITO' && t.moneda === this.#vistaActual)
      .reduce((acc, t) => acc + Number(t.importe || 0), 0);
    const subcuentasCount = (data.subcuentas || []).length;
    
    if (valMetaEl) {
      valMetaEl.textContent = subcuentasCount > 0 ? `${subcuentasCount} ${subcuentasCount === 1 ? 'Alcancía' : 'Alcancías'}` : 'Sin metas';
    }
    if (subMetaEl) {
      subMetaEl.textContent = depositosMes > 0 
        ? `Depósitos del mes: ${this.#vistaActual === 'USD' ? App.Utils.formatearMonedaUSD(depositosMes) : App.Utils.formatearMoneda(depositosMes)}`
        : 'Sin depósitos este mes';
    }
    if (fillMetaEl) {
      fillMetaEl.style.width = depositosMes > 0 ? '75%' : '20%';
      fillMetaEl.style.background = depositosMes > 0 ? 'var(--verde)' : 'var(--amarillo-text)';
    }

    // Renderizar Gráficos y Lista
    this.#renderMoneyFlowChart();
    this.#renderDonutChart();
    this.#renderMisAlcancias();
    this.#filterAndRenderMovimientos();

    App.log('AhorroModule', '_render', 'Datos de ahorro renderizados');
  }

  // --- SECCIÓN 3: BUILD DOM (FinSet 3-Row Architecture) ---

  _buildVista() {
    const vista = document.getElementById(this.vistaId);
    if (!vista) return;

    vista.innerHTML = `
      <!-- ═══ ROW 1: SCORECARDS FINSET ═══ -->
      <div class="finset-kpi-grid" id="aho-scorecards-grid" style="margin-bottom: 24px;">
        
        <!-- Card 1: Ahorro en Pesos (ARS) -->
        <div class="finset-kpi-card" id="aho-card-kpi-ars">
          <div class="finset-kpi-header">
            <div class="finset-kpi-title-wrap">
              <div class="finset-kpi-icon icon-green">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>
              </div>
              <span class="finset-kpi-title">Ahorro en Pesos</span>
            </div>
            <button class="finset-arrow-btn" id="aho-btn-filter-ars" title="Ver ahorros en pesos">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <div class="finset-kpi-value" id="aho-kpi-val-ars">$ 0,00</div>
          <div class="finset-kpi-footer">
            <span class="finset-kpi-subtext" id="aho-kpi-sub-ars">Eq: —</span>
            <span class="finset-trend-pill trend-up"><span>ARS</span></span>
          </div>
        </div>

        <!-- Card 2: Ahorro en Dólares (USD) -->
        <div class="finset-kpi-card" id="aho-card-kpi-usd">
          <div class="finset-kpi-header">
            <div class="finset-kpi-title-wrap">
              <div class="finset-kpi-icon icon-cyan">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              </div>
              <span class="finset-kpi-title">Ahorro en Dólares</span>
            </div>
            <button class="finset-arrow-btn" id="aho-btn-filter-usd" title="Ver ahorros en dólares">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <div class="finset-kpi-value" id="aho-kpi-val-usd">US$ 0,00</div>
          <div class="finset-kpi-footer">
            <span class="finset-kpi-subtext" id="aho-kpi-sub-usd">Eq: —</span>
            <span class="finset-trend-pill trend-neutral"><span>USD</span></span>
          </div>
        </div>

        <!-- Card 3: Total Consolidado -->
        <div class="finset-kpi-card" id="aho-card-kpi-consol">
          <div class="finset-kpi-header">
            <div class="finset-kpi-title-wrap">
              <div class="finset-kpi-icon icon-purple">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>
              </div>
              <span class="finset-kpi-title">Total Consolidado</span>
            </div>
          </div>
          <div class="finset-kpi-value" id="aho-kpi-val-consol">$ 0,00</div>
          <div class="finset-kpi-footer">
            <span class="finset-kpi-subtext" id="aho-kpi-sub-consol">Patrimonio en alcancías</span>
            <span class="finset-trend-pill trend-up"><span>Patrimonio</span></span>
          </div>
        </div>

      </div>

      <!-- ═══ ROW 2: ANALYTICS & INSIGHTS (Money Flow + Distribución por Alcancías) ═══ -->
      <div class="finset-grid-2col" style="margin-bottom: 24px;">
        
        <!-- Left (60%): Evolución Mensual del Ahorro -->
        <div class="finset-card" id="aho-widget-moneyflow">
          <div class="finset-card-header">
            <div class="finset-card-title-wrap">
              <h3 class="finset-card-title">Flujo de Ahorro</h3>
              <span class="finset-card-subtitle" id="aho-moneyflow-sub">Evolución histórica últimos 6 meses</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <div class="fintech-pill-switch" id="aho-period-switch">
                <button class="fintech-pill-btn active" data-period="6M">6M</button>
                <button class="fintech-pill-btn" data-period="12M">12M</button>
                <button class="fintech-pill-btn" data-period="YTD">Año actual</button>
              </div>
            </div>
          </div>
          <div style="position:relative; width:100%; height:230px; margin: 4px 0;">
            <canvas id="aho-moneyflow-canvas"></canvas>
          </div>
          <div class="finset-chart-summary" id="aho-moneyflow-summary"></div>
        </div>

        <!-- Right (40%): Distribución por Alcancías (FinSet Side-by-Side) -->
        <div class="finset-card" id="aho-widget-categories">
          <div class="finset-card-header">
            <div class="finset-card-title-wrap">
              <h3 class="finset-card-title">Distribución por Alcancías</h3>
              <span class="finset-card-subtitle">Saldo acumulado por subcuenta</span>
            </div>
          </div>
          <div class="finset-categories-side-wrap">
            <div class="fintech-legend-list" id="aho-categories-legend" style="margin-top:0;"></div>
            <div class="fintech-donut-wrapper" style="height:180px; margin:0;">
              <canvas id="aho-categories-donut-canvas"></canvas>
              <div class="fintech-donut-center" id="aho-categories-donut-center">
                <span class="fintech-donut-center-label">Total Ahorrado</span>
                <span class="fintech-donut-center-val" id="aho-donut-center-val" style="font-size:1.05rem;">$ 0,00</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- ═══ ROW 3: OPERATIONS & DRILLDOWN (Grilla 60% + Alcancías 40%) ═══ -->
      <div class="finset-grid-2col" style="margin-bottom: 24px;">
        
        <!-- Left (60%): Grilla de Movimientos (Mismo ancho que Movimientos) -->
        <div class="finset-card" id="aho-widget-movimientos">
          <div class="finset-card-header" style="flex-wrap:wrap; gap:12px; align-items:center;">
            <div class="dh-drilldown-left" style="min-width:200px;">
              <div class="dh-drilldown-badge badge-all" id="aho-movimientos-badge">
                <span class="dh-badge-dot"></span>
                <span class="dh-badge-title" id="aho-movimientos-title">Todos los Movimientos de Ahorro</span>
              </div>
              <div class="dh-drilldown-summary" id="aho-movimientos-summary">—</div>
            </div>

            <div class="finset-card-actions" style="margin-left:auto; gap:10px; align-items:center;">
              <!-- Selector Moneda (ARS / USD) -->
              <div class="currency-pills" id="aho-currency-switch" style="display:flex;">
                <button class="currency-pill active" id="aho-btn-ars" data-moneda="ARS">ARS</button>
                <button class="currency-pill" id="aho-btn-usd" data-moneda="USD">USD</button>
              </div>

              <!-- Pestañas de Filtrado -->
              <div class="dh-filter-tabs" id="aho-movimientos-tabs">
                <button class="dh-tab-btn active" data-filter="ALL" id="aho-tab-all">Todos</button>
                <button class="dh-tab-btn" data-filter="DEPOSITO" id="aho-tab-deposito">Depósitos</button>
                <button class="dh-tab-btn" data-filter="RETIRO" id="aho-tab-retiro">Retiros</button>
              </div>

              <!-- Buscador -->
              <div class="dh-search-box" style="margin:0;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" id="aho-search-input" placeholder="Buscar ahorro..." class="finset-search-input" style="width:140px;">
              </div>

              <!-- Único Botón Contextual Primario -->
              <button class="btn btn-primary btn-sm" id="aho-btn-nuevo" style="display:inline-flex;align-items:center;gap:6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                <span>Nuevo Movimiento</span>
              </button>
            </div>
          </div>

          <!-- Lista de movimientos interactiva estilo movimientos -->
          <div class="dh-drilldown-list dh-side-main" id="aho-movimientos-list" style="margin-top:12px; max-height:510px; overflow-y:auto; padding-right:4px;">
          </div>
        </div>

        <!-- Right (40%): Mis Alcancías (Listado de Subcuentas con saldo y metas) -->
        <div class="finset-card" id="aho-widget-side-panel">
          <div class="finset-card-header" style="justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div class="finset-card-title-wrap">
              <h3 class="finset-card-title">Mis Alcancías</h3>
              <span class="finset-card-subtitle" id="aho-alcancias-subtitle">Objetivos y saldos por subcuenta</span>
            </div>
            <button class="btn btn-outline btn-xs" id="aho-btn-nueva-alcancia" style="display:inline-flex; align-items:center; gap:4px; font-size:0.75rem; padding:4px 10px; border-radius:6px;" title="Crear nueva subcuenta de ahorro">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <span>+ Alcancía</span>
            </button>
          </div>

          <!-- Badge de Filtro por Alcancía -->
          <div id="aho-alcancia-filter-badge" class="hidden" style="margin: 10px 0 6px; padding: 6px 10px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 8px; display: flex; align-items: center; justify-content: space-between; font-size: 0.78rem;">
            <span style="color: var(--primario); font-weight: 600;" id="aho-alcancia-filter-text">Filtrando por alcancía</span>
            <button id="aho-btn-clear-alcancia-filter" style="border: none; background: none; cursor: pointer; color: var(--texto-3); font-size: 0.9rem; font-weight: 700; padding: 0 4px;" title="Ver todas las alcancías">✕</button>
          </div>

          <!-- Listado dinámico de alcancías -->
          <div class="finset-modules-stack" id="aho-subcuentas-list" style="margin-top: 10px; max-height: 480px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;">
          </div>
        </div>

      </div>
    `;
  }

  // --- SECCIÓN 4: ANALYTICS & CHARTS ---

  #renderMoneyFlowChart() {
    const canvas = document.getElementById('aho-moneyflow-canvas');
    if (!canvas) return;

    if (this.#chartInstance) {
      this.#chartInstance.destroy();
      this.#chartInstance = null;
    }

    const transferencias = this.#dataCompleta?.transferencias || [];
    const isUSD = this.#vistaActual === 'USD';
    const fmt = isUSD ? App.Utils.formatearMonedaUSD : App.Utils.formatearMoneda;

    // Calcular rango de meses según #flowPeriod
    let count = 6;
    if (this.#flowPeriod === '12M') count = 12;
    else if (this.#flowPeriod === 'YTD') {
      const currentMonthNum = new Date().getMonth() + 1;
      count = Math.max(1, currentMonthNum);
    }

    const labels = [];
    const keys = [];
    const dateCursor = new Date();

    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(dateCursor.getFullYear(), dateCursor.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      keys.push(ym);
      const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      labels.push(monthNames[d.getMonth()]);
    }

    const depositosData = keys.map(k => {
      return transferencias
        .filter(t => t.moneda === this.#vistaActual && t.tipo_mov === 'DEPOSITO' && (t.fecha?.value || t.fecha || '').startsWith(k))
        .reduce((sum, t) => sum + Number(t.importe || 0), 0);
    });

    const retirosData = keys.map(k => {
      return transferencias
        .filter(t => t.moneda === this.#vistaActual && t.tipo_mov === 'RETIRO' && (t.fecha?.value || t.fecha || '').startsWith(k))
        .reduce((sum, t) => sum + Number(t.importe || 0), 0);
    });

    const totalDep = depositosData.reduce((a, b) => a + b, 0);
    const totalRet = retirosData.reduce((a, b) => a + b, 0);
    const neto = totalDep - totalRet;

    const summaryEl = document.getElementById('aho-moneyflow-summary');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <span>Depósitos: <strong style="color:var(--verde);">${fmt(totalDep)}</strong></span>
        <span style="margin:0 8px; color:var(--borde);">•</span>
        <span>Retiros: <strong style="color:var(--rojo);">${fmt(totalRet)}</strong></span>
        <span style="margin:0 8px; color:var(--borde);">•</span>
        <span>Ahorro Neto: <strong style="color:${neto >= 0 ? 'var(--verde)' : 'var(--rojo)'};">${fmt(neto)}</strong></span>
      `;
    }

    const ctx = canvas.getContext('2d');
    this.#chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Depósitos',
            data: depositosData,
            backgroundColor: '#10B981',
            borderRadius: 6,
            barPercentage: 0.5,
            categoryPercentage: 0.7
          },
          {
            label: 'Retiros',
            data: retirosData,
            backgroundColor: '#EF4444',
            borderRadius: 6,
            barPercentage: 0.5,
            categoryPercentage: 0.7
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              usePointStyle: true,
              pointStyle: 'circle',
              color: 'var(--texto-2)',
              font: { family: 'inherit', size: 11, weight: '600' }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(24, 24, 27, 0.95)',
            titleColor: '#fff',
            bodyColor: '#fff',
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (item) => ` ${item.dataset.label}: ${fmt(item.raw)}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: 'var(--texto-3)', font: { size: 11 } }
          },
          y: {
            grid: { color: 'rgba(128, 128, 128, 0.1)' },
            ticks: {
              color: 'var(--texto-3)',
              font: { size: 10 },
              callback: (v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v
            }
          }
        }
      }
    });
  }

  #renderDonutChart() {
    const canvas = document.getElementById('aho-categories-donut-canvas');
    if (!canvas) return;

    if (this.#donutChartInstance) {
      this.#donutChartInstance.destroy();
      this.#donutChartInstance = null;
    }

    const transferencias = this.#dataCompleta?.transferencias || [];
    const subcuentas = this.#dataCompleta?.subcuentas || [];
    const isUSD = this.#vistaActual === 'USD';
    const fmt = isUSD ? App.Utils.formatearMonedaUSD : App.Utils.formatearMoneda;

    // Calcular saldos reales por subcuenta acumulados
    const mapSubcuentas = {};
    subcuentas.forEach(s => {
      if (!s.moneda || s.moneda === this.#vistaActual) {
        mapSubcuentas[s.nombre] = Number(s.saldo || 0);
      }
    });

    transferencias
      .filter(t => t.moneda === this.#vistaActual)
      .forEach(t => {
        const nom = t.subcuenta_nombre || 'General';
        const imp = Number(t.importe || 0);
        if (t.tipo_mov === 'DEPOSITO') {
          mapSubcuentas[nom] = (mapSubcuentas[nom] || 0) + imp;
        } else if (t.tipo_mov === 'RETIRO') {
          mapSubcuentas[nom] = Math.max(0, (mapSubcuentas[nom] || 0) - imp);
        }
      });

    // Filtrar subcuentas con saldo > 0
    const activeEntries = Object.entries(mapSubcuentas).filter(([_, val]) => val > 0);
    const labels = activeEntries.map(([k]) => k);
    const dataVals = activeEntries.map(([_, v]) => v);
    const total = dataVals.reduce((a, b) => a + b, 0);

    const centerValEl = document.getElementById('aho-donut-center-val');
    if (centerValEl) centerValEl.textContent = fmt(total);

    const legendEl = document.getElementById('aho-categories-legend');
    const PALETTE = ['#10B981', '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];
    const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);

    if (!activeEntries.length || total <= 0) {
      if (legendEl) {
        legendEl.innerHTML = '<div style="text-align:center;padding:28px 8px;color:var(--texto-3);font-size:0.82rem;">No hay depósitos en este período</div>';
      }
      return;
    }

    if (legendEl) {
      legendEl.innerHTML = labels.map((lbl, i) => {
        const val = dataVals[i];
        const pct = ((val / total) * 100).toFixed(1);
        const isSelected = this.#subcuentaFiltro === lbl;
        return `
          <div class="fintech-legend-item ${isSelected ? 'active-filter' : ''}" 
               style="cursor:pointer; ${isSelected ? 'background:rgba(59,130,246,0.1); border-radius:6px; padding:4px 6px;' : ''}" 
               data-subcuenta="${App.Utils.escapeHtml(lbl)}">
            <div class="fintech-legend-left">
              <span class="fintech-legend-dot" style="background: ${colors[i]};"></span>
              <span class="fintech-legend-label" title="${App.Utils.escapeHtml(lbl)}">${App.Utils.escapeHtml(lbl)}</span>
            </div>
            <div class="fintech-legend-right">
              <span class="fintech-legend-pct">${pct}%</span>
              <span class="fintech-legend-amount" style="color: var(--texto); font-weight: 600;">${fmt(val)}</span>
            </div>
          </div>
        `;
      }).join('');

      legendEl.querySelectorAll('.fintech-legend-item').forEach(el => {
        el.addEventListener('click', () => {
          this.#filtrarPorAlcancía(el.dataset.subcuenta);
        });
      });
    }

    const ctx = canvas.getContext('2d');
    this.#donutChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: dataVals,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: 'var(--superficie)',
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
              label: (item) => ` ${item.label}: ${fmt(item.raw)} (${((item.raw / total) * 100).toFixed(1)}%)`
            }
          }
        },
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            const subcuentaSelected = labels[index];
            this.#filtrarPorAlcancía(subcuentaSelected);
          }
        }
      }
    });
  }

  #renderMisAlcancias() {
    const container = document.getElementById('aho-subcuentas-list');
    if (!container) return;

    const subcuentas = this.#dataCompleta?.subcuentas || [];
    const transferencias = this.#dataCompleta?.transferencias || [];
    const isUSD = this.#vistaActual === 'USD';
    const fmt = isUSD ? App.Utils.formatearMonedaUSD : App.Utils.formatearMoneda;

    // Calcular saldos y actividad por cada subcuenta
    const mapSaldos = {};
    const mapDepositosMes = {};
    transferencias
      .filter(t => t.moneda === this.#vistaActual)
      .forEach(t => {
        const nom = t.subcuenta_nombre || 'General';
        const imp = Number(t.importe || 0);
        if (t.tipo_mov === 'DEPOSITO') {
          mapSaldos[nom] = (mapSaldos[nom] || 0) + imp;
          mapDepositosMes[nom] = (mapDepositosMes[nom] || 0) + imp;
        } else if (t.tipo_mov === 'RETIRO') {
          mapSaldos[nom] = Math.max(0, (mapSaldos[nom] || 0) - imp);
        }
      });

    const relevantSubcuentas = subcuentas.filter(s => !s.moneda || s.moneda === this.#vistaActual);

    if (!relevantSubcuentas.length) {
      container.innerHTML = `
        <div style="text-align:center; padding:24px 12px; color:var(--texto-3);">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px; opacity:0.6;"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          <p style="font-weight:600; margin:0 0 4px; color:var(--texto-2); font-size:0.88rem;">No tenés alcancías en ${this.#vistaActual}</p>
          <p style="font-size:0.75rem; margin:0 0 12px;">Creá una alcancía con tu objetivo de ahorro para empezar.</p>
        </div>
      `;
      return;
    }

    const ICONS = ['icon-green', 'icon-blue', 'icon-purple', 'icon-yellow'];

    container.innerHTML = relevantSubcuentas.map((sc, idx) => {
      const nom = sc.nombre || 'Alcancía';
      const saldo = mapSaldos[nom] != null ? mapSaldos[nom] : Number(sc.saldo || 0);
      const meta = Number(sc.meta || sc.objetivo || 0);
      const depMes = mapDepositosMes[nom] || 0;
      const isSelected = this.#subcuentaFiltro === nom;
      const iconClass = ICONS[idx % ICONS.length];

      let progressHtml = '';
      if (meta > 0) {
        const pct = Math.min(100, Math.round((saldo / meta) * 100));
        progressHtml = `
          <div style="margin-top:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.72rem; color:var(--texto-3); margin-bottom:4px;">
              <span>Meta: ${fmt(meta)}</span>
              <strong style="color:var(--texto);">${pct}%</strong>
            </div>
            <div class="finset-goal-progress-wrap" style="margin:0;">
              <div class="finset-goal-progress-bar">
                <div class="finset-goal-progress-fill" style="width: ${pct}%; background: ${pct >= 100 ? 'var(--verde)' : 'var(--primario)'};"></div>
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="finset-submodule-card aho-subcuenta-card ${isSelected ? 'active-filter-card' : ''}" 
             data-subcuenta-nom="${App.Utils.escapeHtml(nom)}"
             style="cursor:pointer; transition:all 0.15s ease; ${isSelected ? 'border-color:var(--primario); background:rgba(59,130,246,0.05); box-shadow:0 0 0 1px var(--primario);' : ''}">
          <div class="fsc-header" style="align-items:center;">
            <div class="fsc-tag-wrap" style="align-items:center;">
              <div class="fsc-icon-box ${iconClass}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
              </div>
              <div class="fsc-text-block">
                <div class="fsc-title" style="font-size:0.88rem; font-weight:700; color:var(--texto);">${App.Utils.escapeHtml(nom)}</div>
                <div class="fsc-sub" style="font-size:0.72rem; color:var(--texto-3);">
                  ${depMes > 0 ? `Depósitos mes: +${fmt(depMes)}` : 'Sin depósitos este mes'}
                </div>
              </div>
            </div>
            <div class="fsc-right-block" style="text-align:right;">
              <span class="fsc-value" style="font-size:0.95rem; font-weight:700; color:var(--texto);">${fmt(saldo)}</span>
              <span style="font-size:0.68rem; font-weight:600; color:var(--texto-3); display:block;">${this.#vistaActual}</span>
            </div>
          </div>
          ${progressHtml}
        </div>
      `;
    }).join('');

    container.querySelectorAll('.aho-subcuenta-card').forEach(card => {
      card.addEventListener('click', () => {
        const nom = card.dataset.subcuentaNom;
        this.#filtrarPorAlcancía(nom);
      });
    });
  }

  #filtrarPorAlcancía(nombre) {
    if (this.#subcuentaFiltro === nombre) {
      this.#limpiarFiltroAlcancia();
      return;
    }
    this.#subcuentaFiltro = nombre;
    const badge = document.getElementById('aho-alcancia-filter-badge');
    const badgeText = document.getElementById('aho-alcancia-filter-text');
    if (badge) badge.classList.remove('hidden');
    if (badgeText) badgeText.textContent = `Filtrado por: ${nombre}`;

    this.#renderMisAlcancias();
    this.#renderDonutChart();
    this.#filterAndRenderMovimientos();
  }

  #limpiarFiltroAlcancia() {
    this.#subcuentaFiltro = null;
    const badge = document.getElementById('aho-alcancia-filter-badge');
    if (badge) badge.classList.add('hidden');

    this.#renderMisAlcancias();
    this.#renderDonutChart();
    this.#filterAndRenderMovimientos();
  }

  // --- SECCIÓN 5: FILTRADO Y GRILLA DE MOVIMIENTOS ---

  #filterAndRenderMovimientos() {
    const transferencias = this.#dataCompleta?.transferencias || [];
    const isUSD = this.#vistaActual === 'USD';
    const fmt = isUSD ? App.Utils.formatearMonedaUSD : App.Utils.formatearMoneda;

    // Filtro por moneda, tipo (ALL / DEPOSITO / RETIRO), subcuenta activa y búsqueda
    const filtered = transferencias.filter(t => {
      if (t.moneda !== this.#vistaActual) return false;
      if (this.#tipoFiltro !== 'ALL' && t.tipo_mov !== this.#tipoFiltro) return false;
      if (this.#subcuentaFiltro && (t.subcuenta_nombre || 'General') !== this.#subcuentaFiltro) return false;
      if (this.#busqueda) {
        const q = this.#busqueda.toLowerCase();
        const desc = (t.descripcion || '').toLowerCase();
        const sub = (t.subcuenta_nombre || '').toLowerCase();
        if (!desc.includes(q) && !sub.includes(q)) return false;
      }
      return true;
    });

    // Badge y resumen
    const badgeTitleEl = document.getElementById('aho-movimientos-title');
    const badgeEl = document.getElementById('aho-movimientos-badge');
    const summaryEl = document.getElementById('aho-movimientos-summary');

    if (badgeTitleEl) {
      const subTag = this.#subcuentaFiltro ? ` • ${this.#subcuentaFiltro}` : '';
      if (this.#tipoFiltro === 'DEPOSITO') badgeTitleEl.textContent = `Depósitos en ${this.#vistaActual}${subTag}`;
      else if (this.#tipoFiltro === 'RETIRO') badgeTitleEl.textContent = `Retiros en ${this.#vistaActual}${subTag}`;
      else badgeTitleEl.textContent = `Movimientos (${this.#vistaActual})${subTag}`;
    }
    if (badgeEl) {
      badgeEl.className = 'dh-drilldown-badge ' + (this.#tipoFiltro === 'DEPOSITO' ? 'badge-ing' : (this.#tipoFiltro === 'RETIRO' ? 'badge-egr' : 'badge-all'));
    }

    const totalDep = filtered.filter(t => t.tipo_mov === 'DEPOSITO').reduce((acc, t) => acc + Number(t.importe || 0), 0);
    const totalRet = filtered.filter(t => t.tipo_mov === 'RETIRO').reduce((acc, t) => acc + Number(t.importe || 0), 0);
    const saldoNeto = totalDep - totalRet;

    if (summaryEl) {
      summaryEl.textContent = `${filtered.length} ${filtered.length === 1 ? 'movimiento' : 'movimientos'} • Depósitos: ${fmt(totalDep)} • Retiros: ${fmt(totalRet)} • Neto: ${fmt(saldoNeto)}`;
    }

    this.#renderMovimientosList(filtered);
  }

  #renderMovimientosList(items) {
    const listEl = document.getElementById('aho-movimientos-list');
    if (!listEl) return;

    if (!items.length) {
      listEl.innerHTML = `
        <div style="text-align:center; padding:36px 16px; color:var(--texto-3);">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px; opacity:0.6;"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>
          <p style="font-weight:600; margin:0 0 4px; color:var(--texto-2);">No hay movimientos de ahorro</p>
          <p style="font-size:0.8rem; margin:0;">No se encontraron registros con los filtros aplicados.</p>
        </div>
      `;
      return;
    }

    const isUSD = this.#vistaActual === 'USD';
    const fmt = isUSD ? App.Utils.formatearMonedaUSD : App.Utils.formatearMoneda;

    listEl.innerHTML = items.map(t => {
      const isDep = t.tipo_mov === 'DEPOSITO';
      const iconBg = isDep ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)';
      const iconClr = isDep ? 'var(--verde)' : 'var(--rojo)';
      const sign = isDep ? '+' : '−';
      const clrClass = isDep ? 'monto-ingreso' : 'monto-egreso';
      const badgeCls = isDep ? 'dh-badge-ing' : 'dh-badge-egr';
      const badgeLabel = isDep ? 'Depósito' : 'Retiro';

      const fechaStr = App.Utils.formatearFecha(t.fecha?.value || t.fecha);
      const subcuentaNom = App.Utils.escapeHtml(t.subcuenta_nombre || 'Alcancía');
      const descStr = App.Utils.escapeHtml(t.descripcion || 'Sin descripción');

      return `
        <div class="dh-drill-row" data-aho-id="${t.id_ahorro}" style="display:flex; align-items:center; gap:12px; padding:10px 12px; border-bottom:1px solid var(--borde); cursor:pointer; transition:background 0.15s ease;">
          <div style="width:36px; height:36px; border-radius:10px; background:${iconBg}; color:${iconClr}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              ${isDep ? '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>' : '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>'}
            </svg>
          </div>

          <div style="flex:1; min-width:0;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:2px;">
              <span style="font-weight:600; font-size:0.88rem; color:var(--texto); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${subcuentaNom}</span>
              <span class="dh-item-badge ${badgeCls}" style="font-size:0.68rem; padding:2px 6px; border-radius:4px;">${badgeLabel}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px; font-size:0.75rem; color:var(--texto-3);">
              <span>${fechaStr}</span>
              <span>•</span>
              <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${descStr}</span>
            </div>
          </div>

          <div style="text-align:right; flex-shrink:0;">
            <div class="${clrClass}" style="font-weight:700; font-size:0.95rem;">
              ${sign} ${fmt(t.importe)}
            </div>
            <span style="font-size:0.7rem; color:var(--texto-3); font-weight:600;">${t.moneda || 'ARS'}</span>
          </div>

          <div class="dh-drill-actions" style="display:flex; align-items:center; gap:4px; margin-left:8px;" onclick="event.stopPropagation();">
            <button class="btn-icon-sm aho-btn-edit" data-id="${t.id_ahorro}" title="Editar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="btn-icon-sm aho-btn-delete" data-id="${t.id_ahorro}" title="Eliminar" style="color:var(--rojo);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Listeners en las filas
    listEl.querySelectorAll('.dh-drill-row').forEach(rowEl => {
      const id = rowEl.dataset.ahoId;
      const rowData = items.find(x => String(x.id_ahorro) === String(id));
      if (!rowData) return;

      rowEl.addEventListener('click', () => this.#abrirModalDetalle(rowData));

      rowEl.querySelector('.aho-btn-edit')?.addEventListener('click', () => {
        this.#abrirModalEdicion(rowData);
      });

      rowEl.querySelector('.aho-btn-delete')?.addEventListener('click', () => {
        this.#eliminar(rowData);
      });
    });
  }

  // --- SECCIÓN 6: MODAL DE ALTA / EDICIÓN ---

  abrirAlta(tipo = 'DEPOSITO') {
    this.#abrirModalAlta(tipo);
  }

  #abrirModalAlta(tipo) {
    this.#editData = null;
    this.#modal.open({
      titulo      : tipo === 'DEPOSITO' ? 'Nuevo Depósito de Ahorro' : 'Nuevo Retiro de Ahorro',
      icono       : tipo === 'DEPOSITO' ? 'trending_up' : 'trending_down',
      body        : this.#buildFormHtml(tipo, null),
      confirmLabel: tipo === 'DEPOSITO' ? 'Guardar Depósito' : 'Guardar Retiro',
      danger      : tipo === 'RETIRO',
      onConfirm   : (m) => this.#guardar(m)
    });
    this.#postOpenForm();
  }

  #abrirModalEdicion(row) {
    this.#editData = row;
    this.#modal.open({
      titulo      : row.tipo_mov === 'DEPOSITO' ? 'Editar Depósito' : 'Editar Retiro',
      icono       : 'edit',
      body        : this.#buildFormHtml(row.tipo_mov, row),
      confirmLabel: 'Actualizar',
      danger      : row.tipo_mov === 'RETIRO',
      onConfirm   : (m) => this.#guardar(m)
    });
    this.#postOpenForm();
  }

  #buildFormHtml(tipo, data) {
    const isDep = tipo === 'DEPOSITO';
    const rawFecha = data
      ? (data.fecha?.value || data.fecha || '').substring(0, 10)
      : new Date().toISOString().substring(0, 10);
    const moneda = data?.moneda || this.#vistaActual;

    // Subcuentas (viene en dataCompleta)
    const subcuentas = this.#dataCompleta?.subcuentas || [];
    const optsS = subcuentas
      .filter(s => !moneda || s.moneda === moneda)
      .map(s => `<option value="${s.id_subcuenta}" ${data?.id_subcuenta === s.id_subcuenta ? 'selected':''}>${App.Utils.escapeHtml(s.nombre)}</option>`)
      .join('');

    return `
      <!-- Selector Segmentado: Depósito vs Retiro -->
      <div class="modal-segmented-switch">
        <button type="button" class="modal-segmented-btn btn-aho-tipo-toggle ${isDep ? 'active btn-seg-green' : ''}" data-tipo="DEPOSITO">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
          Depósito
        </button>
        <button type="button" class="modal-segmented-btn btn-aho-tipo-toggle ${!isDep ? 'active btn-seg-red' : ''}" data-tipo="RETIRO">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>
          Retiro
        </button>
      </div>

      <form id="form-ahorro" class="form-grid">
        <input type="hidden" name="tipo" id="aho-form-tipo" value="${tipo}">
        <input type="hidden" name="id_ahorro" value="${data?.id_ahorro || ''}">

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
          <label>Subcuenta / Alcancía <span class="required-mark">*</span></label>
          <select class="input" name="id_subcuenta" id="aho-subcuenta" required>
            <option value="">-- Seleccionar alcancía --</option>
            ${optsS}
          </select>
        </div>

        <div class="form-group">
          <label>Importe <span class="required-mark">*</span></label>
          <input class="input" type="number" name="importe" min="0.01" step="0.01"
                 value="${data?.importe || ''}" required placeholder="0.00">
        </div>

        <div class="form-group">
          <label>Descripción</label>
          <input class="input" type="text" name="descripcion"
                 value="${App.Utils.escapeHtml(data?.descripcion || '')}" placeholder="Ej: Ahorro sueldo, Fondo viaje...">
        </div>
      </form>
    `;
  }

  #postOpenForm() {
    this.#modal.el.querySelectorAll('.btn-aho-tipo-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const nuevoTipo = btn.dataset.tipo;
        const isDep = nuevoTipo === 'DEPOSITO';
        
        // Actualizar switch visual
        this.#modal.el.querySelectorAll('.btn-aho-tipo-toggle').forEach(b => {
          b.className = `modal-segmented-btn btn-aho-tipo-toggle ${b.dataset.tipo === nuevoTipo ? (isDep ? 'active btn-seg-green' : 'active btn-seg-red') : ''}`;
        });

        const tipoHidden = this.#modal.el.querySelector('#aho-form-tipo');
        if (tipoHidden) tipoHidden.value = nuevoTipo;

        const confirmBtn = this.#modal.el.querySelector('.modal-confirm');
        if (confirmBtn) {
          confirmBtn.textContent = isDep ? 'Guardar Depósito' : 'Guardar Retiro';
          confirmBtn.className = `btn ${isDep ? 'btn-primary' : 'btn-danger'} modal-confirm`;
        }

        const titleSpan = `<span style="margin-right:8px; display:inline-flex; align-items:center; color:${isDep ? 'var(--verde)' : 'var(--rojo)'};">${App.Icons.get(isDep ? 'trending_up' : 'trending_down')}</span>${isDep ? 'Nuevo Depósito de Ahorro' : 'Nuevo Retiro de Ahorro'}`;
        const titleEl = this.#modal.el.querySelector('.modal-title');
        if (titleEl) titleEl.innerHTML = titleSpan;
      });
    });
  }

  // --- SECCIÓN 7: CRUD ---

  async #guardar(modal) {
    const form = modal.getForm();
    if (!form) return;
    const fd = new FormData(form);
    const d  = {};
    fd.forEach((v, k) => { d[k] = v; });

    const tipo = d.tipo || 'DEPOSITO';

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
      this.destruir();
      await this.cargar();
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

  // --- SECCIÓN 8: LISTENERS ---

  _bindListeners() {
    const vista = document.getElementById(this.vistaId);
    if (!vista) return;

    // Selector Moneda ARS / USD
    const btnArs = document.getElementById('aho-btn-ars');
    const btnUsd = document.getElementById('aho-btn-usd');
    const filterArs = document.getElementById('aho-btn-filter-ars');
    const filterUsd = document.getElementById('aho-btn-filter-usd');

    const switchCurrency = (moneda) => {
      this.#vistaActual = moneda;
      this.#subcuentaFiltro = null;
      document.getElementById('aho-alcancia-filter-badge')?.classList.add('hidden');
      btnArs?.classList.toggle('active', moneda === 'ARS');
      btnUsd?.classList.toggle('active', moneda === 'USD');
      this.#renderMoneyFlowChart();
      this.#renderDonutChart();
      this.#renderMisAlcancias();
      this.#filterAndRenderMovimientos();
    };

    btnArs?.addEventListener('click', () => switchCurrency('ARS'));
    btnUsd?.addEventListener('click', () => switchCurrency('USD'));
    filterArs?.addEventListener('click', () => switchCurrency('ARS'));
    filterUsd?.addEventListener('click', () => switchCurrency('USD'));

    // Botón Nueva Alcancía
    document.getElementById('aho-btn-nueva-alcancia')?.addEventListener('click', () => {
      this.#abrirModalNuevaAlcancia();
    });

    // Botón Limpiar Filtro Alcancía
    document.getElementById('aho-btn-clear-alcancia-filter')?.addEventListener('click', () => {
      this.#limpiarFiltroAlcancia();
    });

    // Pestañas de filtrado (Todos / Depósitos / Retiros)
    const tabs = document.getElementById('aho-movimientos-tabs');
    tabs?.addEventListener('click', (e) => {
      const btn = e.target.closest('.dh-tab-btn');
      if (!btn) return;
      tabs.querySelectorAll('.dh-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.#tipoFiltro = btn.dataset.filter;
      this.#filterAndRenderMovimientos();
    });

    // Buscador
    const searchInput = document.getElementById('aho-search-input');
    searchInput?.addEventListener('input', (e) => {
      this.#busqueda = e.target.value.trim();
      this.#filterAndRenderMovimientos();
    });

    // Switch Período Flujo (6M / 12M / Año actual)
    const periodSwitch = document.getElementById('aho-period-switch');
    periodSwitch?.addEventListener('click', (e) => {
      const btn = e.target.closest('.fintech-pill-btn');
      if (!btn) return;
      periodSwitch.querySelectorAll('.fintech-pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.#flowPeriod = btn.dataset.period;
      const subEl = document.getElementById('aho-moneyflow-sub');
      if (subEl) {
        if (this.#flowPeriod === '6M') subEl.textContent = 'Evolución histórica últimos 6 meses';
        else if (this.#flowPeriod === '12M') subEl.textContent = 'Evolución histórica últimos 12 meses';
        else subEl.textContent = 'Evolución acumulada año actual';
      }
      this.#renderMoneyFlowChart();
    });

    // Único Botón Contextual
    const btnNuevo = document.getElementById('aho-btn-nuevo');
    btnNuevo?.addEventListener('click', () => {
      this.#abrirModalAlta('DEPOSITO');
    });
  }

  #abrirModalNuevaAlcancia() {
    const modal = new App.Modal('modal-aho-nueva-subcuenta');
    const body = `
      <form id="form-nueva-subcuenta" class="form-grid">
        <div class="form-group full-width">
          <label>Nombre de la Alcancía <span class="required-mark">*</span></label>
          <input class="input" type="text" name="nombre" placeholder="Ej: Fondo de Emergencia, Vacaciones, Auto..." required>
        </div>
        <div class="form-group">
          <label>Moneda <span class="required-mark">*</span></label>
          <select class="input" name="moneda" required>
            <option value="ARS" ${this.#vistaActual === 'ARS' ? 'selected' : ''}>ARS (Pesos)</option>
            <option value="USD" ${this.#vistaActual === 'USD' ? 'selected' : ''}>USD (Dólares)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Meta / Objetivo (Opcional)</label>
          <input class="input" type="number" name="meta" min="0" step="1" placeholder="0.00">
        </div>
      </form>
    `;

    modal.open({
      titulo: 'Nueva Alcancía / Objetivo de Ahorro',
      icono: 'savings',
      body,
      confirmLabel: 'Crear Alcancía',
      onConfirm: async (m) => {
        const form = m.getForm();
        if (!form) return;
        const fd = new FormData(form);
        const nombre = fd.get('nombre')?.trim();
        const moneda = fd.get('moneda') || this.#vistaActual;
        const meta = Number(fd.get('meta')) || null;

        if (!nombre) {
          App.Toast.warning('Ingresá el nombre de la alcancía.');
          return;
        }

        m.setLoading(true);
        try {
          const res = await App.API.call('api_admin_saveAhorroSubcuenta', [{
            nombre,
            moneda,
            id_cuenta_principal: App.Store.cuenta,
            meta
          }]);
          if (res?.success) {
            App.Toast.success(`Alcancía "${nombre}" creada.`);
            m.close();
            App.API.invalidatePattern('api_getAhorros');
            this.destruir();
            await this.cargar();
          } else {
            throw new Error(res?.error || 'Error al guardar alcancía');
          }
        } catch (err) {
          App.Toast.error(err.message || 'Error al crear alcancía');
          m.setLoading(false);
        }
      }
    });
  }

  // --- SECCIÓN 9: HELPERS ---

  #abrirModalDetalle(row) {
    const isRetiro = row.tipo_mov === 'RETIRO';
    const clr = isRetiro ? 'var(--rojo)' : 'var(--verde)';
    const fmt = row.moneda === 'USD' ? App.Utils.formatearMonedaUSD : App.Utils.formatearMoneda;

    const html = `
      <div class="detail-modal">
        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--borde);">
          <span style="color:var(--texto-2)">Tipo</span>
          <strong style="color:${clr}">${App.Utils.escapeHtml(row.tipo_mov)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--borde);">
          <span style="color:var(--texto-2)">Subcuenta / Alcancía</span>
          <strong>${App.Utils.escapeHtml(row.subcuenta_nombre || '—')}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--borde);">
          <span style="color:var(--texto-2)">Fecha</span>
          <strong>${App.Utils.formatearFecha(row.fecha?.value || row.fecha)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--borde);">
          <span style="color:var(--texto-2)">Descripción</span>
          <strong>${App.Utils.escapeHtml(row.descripcion || '—')}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--borde);">
          <span style="color:var(--texto-2)">Importe</span>
          <strong style="color:${clr}">${fmt(row.importe)}</strong>
        </div>
      </div>
    `;

    const m = new App.Modal('modal-aho-detalle');
    m.open({
      titulo: 'Detalle de Ahorro',
      body: html,
      confirmLabel: 'Cerrar'
    });

    const footer = m.el.querySelector('.modal-footer');
    if (footer) {
      const cb = footer.querySelector('.modal-confirm');
      if (cb) cb.style.display = 'none';

      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-outline';
      editBtn.innerHTML = App.Icons.get('edit', 'icon-sm') + ' Editar';
      editBtn.onclick = () => {
         m.close();
         this.#abrirModalEdicion(row);
      };
      footer.prepend(editBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-outline btn-danger';
      delBtn.innerHTML = App.Icons.get('delete', 'icon-sm') + ' Eliminar';
      delBtn.onclick = () => {
         m.close();
         this.#eliminar(row);
      };
      footer.prepend(delBtn);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn btn-primary';
      closeBtn.textContent = 'Cerrar';
      closeBtn.onclick = () => m.close();
      footer.appendChild(closeBtn);
    }
  }

  #mostrarKpiSkeletons() {
    const valArsEl = document.getElementById('aho-kpi-val-ars');
    const valUsdEl = document.getElementById('aho-kpi-val-usd');
    const valConsolEl = document.getElementById('aho-kpi-val-consol');
    if (valArsEl) valArsEl.textContent = '...';
    if (valUsdEl) valUsdEl.textContent = '...';
    if (valConsolEl) valConsolEl.textContent = '...';
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