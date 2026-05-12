'use strict';
/* ============================================================
   module-inversiones.html — v5.0.0
   Módulo Portfolio de Inversiones.
   Extiende BaseModule. Sin filtro de mes (portfolio global).
   ============================================================ */

// --- SECCIÓN 0: CLASE InversionesModule ---

export class InversionesModule extends BaseModule {

  get moduleId() { return 'inversiones'; }
  get vistaId()  { return 'vista-inversiones'; }

  get _createEndpoint() { return 'api_createInversion'; }

  #table     = null;
  #kpiValor  = null;
  #kpiCosto  = null;
  #kpiResult = null;
  #modal     = null;
  #editData  = null;
  #cotizDolar = null;

  // --- SECCIÓN 1: CICLO DE VIDA ---

  init() {
    this.#modal = new App.Modal('modal-inversiones');
    this._buildVista();
    this._bindListeners();
    this._subscribeEvents();
    App.log('InversionesModule', 'init', 'Módulo inversiones iniciado');
  }

  /** Inversiones no usa filtro de mes, solo de cuenta */
  async cargar() {
    if (App.Store.isModuloLoaded(this.moduleId)) return;
    const { cuenta } = App.Store;
    if (!cuenta) return;

    this.#mostrarKpiSkeletons();
    this.#table?.showSkeleton(5);

    try {
      const [portfolioData, dolarData, marketData] = await Promise.all([
        App.API.cached('api_getPortfolio',        [cuenta]),
        App.API.cached('api_getDolarCotizaciones', [],       10 * 60_000), // 10 min
        App.API.cached('api_getMarketData',        [],       10 * 60_000)  // 10 min
      ]);
      this.#cotizDolar = dolarData;
      this._renderDolarInfo(dolarData);
      this._renderMarketData(marketData);
      this._render(portfolioData);
      App.Store.markModuloLoaded(this.moduleId);
    } catch (err) {
      App.error('InversionesModule', 'cargar', 'Error', err);
      App.Toast.error('Error al cargar inversiones: ' + err.message);
    }
  }

  // --- SECCIÓN 2: RENDER ---

  _renderDolarInfo(dl) {
    if (!dl || !dl.success) return;
    const infoDiv = document.getElementById('inv-dolar-info');
    if (!infoDiv) return;
    infoDiv.innerHTML = `
      <div style="padding:8px 14px; border-radius:var(--r); background:var(--superficie); border:1px solid var(--borde); min-width:140px;">
         <span style="color:var(--texto-3); font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; font-weight:600;">Dólar MEP</span>
         <strong style="display:block;color:var(--texto);font-size:1.1rem;margin-top:2px;">$${App.Utils.formatearMoneda(dl.bolsa?.venta || 0, false)}</strong>
      </div>
      <div style="padding:8px 14px; border-radius:var(--r); background:var(--superficie); border:1px solid var(--borde); min-width:140px;">
         <span style="color:var(--texto-3); font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; font-weight:600;">Dólar CCL</span>
         <strong style="display:block;color:var(--texto);font-size:1.1rem;margin-top:2px;">$${App.Utils.formatearMoneda(dl.contadoconliqui?.venta || 0, false)}</strong>
      </div>
      <div style="padding:8px 14px; border-radius:var(--r); background:var(--superficie); border:1px solid var(--borde); min-width:140px;">
         <span style="color:var(--texto-3); font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; font-weight:600;">Dólar Blue</span>
         <strong style="display:block;color:var(--texto);font-size:1.1rem;margin-top:2px;">$${App.Utils.formatearMoneda(dl.blue?.venta || 0, false)}</strong>
      </div>
      <div style="padding:8px 14px; border-radius:var(--r); background:var(--superficie); border:1px solid var(--borde); min-width:140px;">
         <span style="color:var(--texto-3); font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; font-weight:600;">Riesgo País</span>
         <strong style="display:block;color:var(--texto);font-size:1.1rem;margin-top:2px;">${dl.risk_country || '—'} pb</strong>
      </div>
    `;
  }

  _renderMarketData(md) {
    if (!md || !md.success) return;
    const wrap = document.getElementById('inv-mercados-wrap');
    if (!wrap) return;

    // Sub-tabs para cada categoría de instrumentos
    const TABS = [
      { id: 'mundo',     label: 'Mundo',     icon: '🌎' },
      { id: 'soberanos', label: 'Bonos Sober.', icon: '🏛️' },
      { id: 'lecaps',    label: 'LECAPs',    icon: '📜' },
      { id: 'ons',       label: 'ONs',       icon: '🏢' },
      { id: 'cedears',   label: 'CEDEARs',   icon: '📊' }
    ];

    const tabsHtml = TABS.map(t =>
      `<button class="monitor-tab ${t.id === 'mundo' ? 'active' : ''}" data-monitor-tab="${t.id}"
              style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;
                     border:1px solid var(--borde);border-radius:var(--r);cursor:pointer;
                     font-size:0.82rem;font-weight:600;font-family:inherit;
                     background:${t.id === 'mundo' ? 'var(--primary)' : 'var(--superficie)'};
                     color:${t.id === 'mundo' ? '#fff' : 'var(--texto-2)'};
                     transition:all .15s ease;white-space:nowrap;">
        <span>${t.icon}</span>${t.label}
      </button>`
    ).join('');

    let html = `
      <div style="padding:20px 24px 4px;display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--borde);">
        ${tabsHtml}
      </div>
      <div id="monitor-panels" style="padding:20px 24px 24px;">
    `;

    // --- PANEL: MUNDO ---
    html += `<div class="monitor-panel" data-monitor-panel="mundo">`;
    html += this.#buildMundoPanel(md.mundo || []);
    html += `</div>`;

    // --- PANEL: SOBERANOS ---
    html += `<div class="monitor-panel hidden" data-monitor-panel="soberanos">`;
    html += this.#buildSoberanosPanel(md.soberanos || []);
    html += `</div>`;

    // --- PANEL: LECAPS ---
    html += `<div class="monitor-panel hidden" data-monitor-panel="lecaps">`;
    html += this.#buildLecapsPanel(md.lecaps || []);
    html += `</div>`;

    // --- PANEL: ONs ---
    html += `<div class="monitor-panel hidden" data-monitor-panel="ons">`;
    html += this.#buildOnsPanel(md.ons || []);
    html += `</div>`;

    // --- PANEL: CEDEARS ---
    html += `<div class="monitor-panel hidden" data-monitor-panel="cedears">`;
    html += this.#buildCedearsPanel(md.cedears || []);
    html += `</div>`;

    html += `</div>`; // cierra monitor-panels

    wrap.innerHTML = html;

    // Bind sub-tabs
    wrap.querySelectorAll('.monitor-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        wrap.querySelectorAll('.monitor-tab').forEach(b => {
          b.style.background = 'var(--superficie)';
          b.style.color = 'var(--texto-2)';
        });
        btn.style.background = 'var(--primary)';
        btn.style.color = '#fff';
        wrap.querySelectorAll('.monitor-panel').forEach(p => p.classList.add('hidden'));
        wrap.querySelector(`[data-monitor-panel="${btn.dataset.monitorTab}"]`)?.classList.remove('hidden');
      });
    });
  }

  // --- BUILDERS DE CADA PANEL ---

  #buildMundoPanel(arr) {
    if (!arr.length) return '<p style="color:var(--texto-3);text-align:center;padding:32px;">Sin datos de mercado disponibles.</p>';

    // Agrupar por grupo (Índices, Tasas, Energía, Metales, Agro, Crypto, Monedas)
    const grupos = {};
    arr.forEach(m => {
      const g = m.group || 'Otros';
      if (!grupos[g]) grupos[g] = [];
      grupos[g].push(m);
    });

    let html = '';
    for (const [grupo, items] of Object.entries(grupos)) {
      html += `<div style="margin-bottom:20px;">
        <h4 style="margin:0 0 10px;color:var(--texto-2);font-size:0.8rem;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">${App.Utils.escapeHtml(grupo)}</h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;">`;
      items.forEach(m => {
        const clr = (m.change || 0) >= 0 ? 'var(--verde)' : 'var(--rojo)';
        const arrow = (m.change || 0) >= 0 ? '▲' : '▼';
        const pct = m.change != null ? m.change.toFixed(2) : '0.00';
        const priceStr = m.price != null ? new Intl.NumberFormat('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}).format(m.price) : '—';
        html += `<div style="padding:12px 14px;border:1px solid var(--borde);border-radius:var(--r);background:var(--superficie);box-shadow:var(--sombra-sm);">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span style="font-size:1.1rem;">${m.icon || ''}</span>
            <span style="font-weight:600;font-size:0.82rem;color:var(--texto-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${App.Utils.escapeHtml(m.name)}</span>
          </div>
          <div style="font-size:1.2rem;font-weight:700;color:var(--texto);">${priceStr}</div>
          <div style="font-size:0.78rem;font-weight:700;color:${clr};margin-top:3px;">${arrow} ${m.change >= 0 ? '+' : ''}${pct}%</div>
        </div>`;
      });
      html += `</div></div>`;
    }
    return html;
  }

  #buildSoberanosPanel(arr) {
    if (!arr.length) return '<p style="color:var(--texto-3);text-align:center;padding:32px;">Sin datos de bonos soberanos disponibles.</p>';
    let html = `<div style="overflow-x:auto;">
      <table class="table" style="min-width:600px;">
        <thead><tr>
          <th>Ticker</th><th style="text-align:right">Precio USD</th>
          <th style="text-align:right">Bid</th><th style="text-align:right">Ask</th>
          <th style="text-align:right">Var %</th><th style="text-align:right">Volumen</th>
        </tr></thead><tbody>`;
    arr.forEach(b => {
      const clr = (b.pct_change || 0) >= 0 ? 'var(--verde)' : 'var(--rojo)';
      const pct = b.pct_change != null ? Number(b.pct_change).toFixed(2) : '0.00';
      html += `<tr>
        <td><strong>${App.Utils.escapeHtml(b.symbol)}</strong></td>
        <td style="text-align:right;font-weight:600;">US$ ${Number(b.price_usd || 0).toFixed(2)}</td>
        <td style="text-align:right;color:var(--texto-3);">${Number(b.bid || 0).toFixed(2)}</td>
        <td style="text-align:right;color:var(--texto-3);">${Number(b.ask || 0).toFixed(2)}</td>
        <td style="text-align:right;font-weight:700;color:${clr};">${Number(b.pct_change) >= 0 ? '+' : ''}${pct}%</td>
        <td style="text-align:right;color:var(--texto-3);">${b.volume ? Number(b.volume).toLocaleString('es-AR') : '—'}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
    return html;
  }

  #buildLecapsPanel(arr) {
    if (!arr.length) return '<p style="color:var(--texto-3);text-align:center;padding:32px;">Sin datos de LECAPs disponibles.</p>';
    let html = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;">`;
    arr.forEach(l => {
      const tipo = l.type || 'LECAP';
      const accent = tipo === 'BONCAP' ? 'var(--amarillo-text)' : 'var(--primary)';
      const priceStr = l.price ? Number(l.price).toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2}) : '—';
      html += `<div style="padding:14px 16px;border:1px solid var(--borde);border-radius:var(--r);background:var(--superficie);border-left:3px solid ${accent};">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:700;font-size:0.95rem;color:var(--texto);">${App.Utils.escapeHtml(l.symbol)}</span>
          <span style="font-size:0.65rem;font-weight:600;padding:2px 6px;border-radius:4px;background:${accent}22;color:${accent};">${tipo}</span>
        </div>
        <div style="font-size:1.3rem;font-weight:800;margin-top:6px;color:${accent};">$ ${priceStr}</div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:0.75rem;color:var(--texto-3);">
          <span>Bid: ${Number(l.bid || 0).toFixed(2)}</span>
          <span>Ask: ${Number(l.ask || 0).toFixed(2)}</span>
        </div>
      </div>`;
    });
    html += `</div>`;
    return html;
  }

  #buildOnsPanel(arr) {
    if (!arr.length) return '<p style="color:var(--texto-3);text-align:center;padding:32px;">Sin datos de ONs disponibles.</p>';
    let html = `<div style="overflow-x:auto;">
      <table class="table" style="min-width:550px;">
        <thead><tr>
          <th>Ticker</th><th style="text-align:right">Precio</th>
          <th style="text-align:right">Bid</th><th style="text-align:right">Ask</th>
          <th style="text-align:right">Var %</th>
        </tr></thead><tbody>`;
    arr.forEach(o => {
      const price = parseFloat(o.c) || 0;
      const pct = o.pct_change != null ? Number(o.pct_change).toFixed(2) : '0.00';
      const clr = Number(o.pct_change || 0) >= 0 ? 'var(--verde)' : 'var(--rojo)';
      const sym = App.Utils.escapeHtml(o.symbol || '');
      html += `<tr>
        <td><strong style="color:var(--verde);">${sym}</strong></td>
        <td style="text-align:right;font-weight:600;">US$ ${price.toFixed(2)}</td>
        <td style="text-align:right;color:var(--texto-3);">${Number(o.px_bid || 0).toFixed(2)}</td>
        <td style="text-align:right;color:var(--texto-3);">${Number(o.px_ask || 0).toFixed(2)}</td>
        <td style="text-align:right;font-weight:700;color:${clr};">${Number(o.pct_change || 0) >= 0 ? '+' : ''}${pct}%</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
    return html;
  }

  #buildCedearsPanel(arr) {
    if (!arr.length) return '<p style="color:var(--texto-3);text-align:center;padding:32px;">Sin datos de CEDEARs disponibles.</p>';
    // Ordenar por volumen desc para mostrar los más operados
    const sorted = [...arr].filter(c => parseFloat(c.c) > 0).sort((a,b) => (Number(b.v)||0) - (Number(a.v)||0)).slice(0, 40);
    let html = `<div style="overflow-x:auto;">
      <table class="table" style="min-width:650px;">
        <thead><tr>
          <th>Ticker</th><th style="text-align:right">Precio ARS</th>
          <th style="text-align:right">Var %</th><th style="text-align:right">Volumen</th>
          <th style="text-align:right">Bid</th><th style="text-align:right">Ask</th>
        </tr></thead><tbody>`;
    sorted.forEach(c => {
      const price = parseFloat(c.c) || 0;
      const pct = c.pct_change != null ? Number(c.pct_change).toFixed(2) : '0.00';
      const clr = Number(c.pct_change || 0) >= 0 ? 'var(--verde)' : 'var(--rojo)';
      const vol = c.v ? Number(c.v).toLocaleString('es-AR') : '—';
      html += `<tr>
        <td><strong>${App.Utils.escapeHtml(c.symbol)}</strong></td>
        <td style="text-align:right;font-weight:600;">$ ${price.toLocaleString('es-AR', {minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td style="text-align:right;font-weight:700;color:${clr};">${Number(c.pct_change || 0) >= 0 ? '+' : ''}${pct}%</td>
        <td style="text-align:right;color:var(--texto-3);">${vol}</td>
        <td style="text-align:right;color:var(--texto-3);">${Number(c.px_bid || 0).toFixed(2)}</td>
        <td style="text-align:right;color:var(--texto-3);">${Number(c.px_ask || 0).toFixed(2)}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
    return html;
  }

  _render(data) {
    if (!data || !data.success) {
      App.Toast.error(data?.error || 'Error al obtener portfolio.');
      return;
    }

    const { kpis, portfolio } = data;

    this.#kpiValor?.setValue(kpis.valorActual, {
      subtitulo: `Costo: ${App.Utils.formatearMoneda(kpis.costoTotal)}`
    });
    this.#kpiCosto?.setValue(kpis.costoTotal);
    this.#kpiResult?.setValue(kpis.gananciaTotal, {
      variacion : kpis.rendimientoPorc,
      invertido : false
    });

    this.#table?.load(portfolio || []);
    App.log('InversionesModule', '_render', `${(portfolio || []).length} posiciones`);
  }

  // --- SECCIÓN 3: BUILD DOM ---

  _buildVista() {
    const vista = document.getElementById(this.vistaId);
    if (!vista) return;

    vista.innerHTML = `
      <div class="kpi-grid" id="inv-kpi-grid"></div>

      <!-- Cotizaciones del Dólar -->
      <div id="inv-dolar-info" style="margin-bottom:var(--space-4); display:flex; gap:12px; flex-wrap:wrap;"></div>

      <div class="section-header" style="margin-bottom:var(--space-3)">
        <div class="acciones-container" id="inv-acciones">
          <button id="inv-btn-nuevo" class="btn btn-primary">
            ${App.Icons.get('add', 'icon-sm')} Nueva operación
          </button>
        </div>
        <div class="selector-vista-container">
          <button id="inv-btn-portfolio" class="btn btn-primary btn-vista active">Mi Portfolio</button>
          <button id="inv-btn-mercados" class="btn btn-ghost btn-vista">Monitor Global</button>
        </div>
      </div>

      <div class="table-card" id="inv-tabla-wrap"></div>
      
      <!-- Contenedor del Monitor -->
      <div class="table-card hidden" id="inv-mercados-wrap">
         <div style="padding:1rem;color:var(--texto-3);text-align:center">Cargando mercados...</div>
      </div>
    `;

    const grid = document.getElementById('inv-kpi-grid');
    this.#kpiValor  = new App.KpiCard(grid, { titulo: 'Valor actual',  icono: 'investment', colorClass: 'kpi-blue',   onFormat: App.Utils.formatearMoneda });
    this.#kpiCosto  = new App.KpiCard(grid, { titulo: 'Costo total',   icono: 'wallet',     colorClass: 'kpi-purple', onFormat: App.Utils.formatearMoneda });
    this.#kpiResult = new App.KpiCard(grid, { titulo: 'Ganancia',      icono: 'trending_up',colorClass: 'kpi-green',  onFormat: App.Utils.formatearMoneda });

    this.#table = new App.DataTable(
      document.getElementById('inv-tabla-wrap'),
      {
        columns: [
          { key: 'fecha',         label: 'Fecha',     sortable: true,
            render: (r) => App.Utils.formatearFecha(r.fecha?.value || r.fecha) },
          { key: 'tipo_op',       label: 'Operación', sortable: true,
            render: (r) => `<span class="tipo-mov tipo-${r.tipo_op === 'COMPRA' ? 'ingreso' : 'egreso'}">${App.Utils.escapeHtml(r.tipo_op)}</span>` },
          { key: 'ticker',        label: 'Ticker',    sortable: true,
            render: (r) => `<strong>${App.Utils.escapeHtml(r.ticker)}</strong>` },
          { key: 'cantidad',      label: 'Cantidad',  align: 'right',
            render: (r) => App.Utils.formatearMoneda(r.cantidad, false) },
          { key: 'precio',        label: 'Precio',    align: 'right',
            render: (r) => {
              const fmt = r.moneda === 'USD' ? App.Utils.formatearMonedaUSD : App.Utils.formatearMoneda;
              return fmt(r.precio);
            }},
          { key: 'precio_actual', label: 'Precio actual', align: 'right',
            render: (r) => {
              if (!r.precio_actual) return '—';
              const fmt = r.moneda === 'USD' ? App.Utils.formatearMonedaUSD : App.Utils.formatearMoneda;
              return fmt(r.precio_actual);
            }},
          { key: 'ganancia',      label: 'P&L',       align: 'right',
            render: (r) => {
              if (r.ganancia === null || r.ganancia === undefined) return '—';
              const cls = r.ganancia >= 0 ? 'positivo' : 'negativo';
              return `<span class="${cls}">${App.Utils.formatearMoneda(r.ganancia)}</span>`;
            }}
        ],
        emptyMsg: 'No hay operaciones en el portfolio.',
        paginated: true,
        pageSize : 25,
        onRowClick: (row) => this.#abrirModalDetalle(row)
      }
    );
  }

  // --- SECCIÓN 4: MODAL ---

  #abrirModalAlta() {
    this.#editData = null;
    this.#modal.open({
      titulo      : 'Nueva operación de inversión',
      icono       : 'investment',
      body        : this.#buildFormHtml(null),
      confirmLabel: 'Guardar',
      size        : 'lg',
      onConfirm   : (m) => this.#guardar(m)
    });
    this.#bindTickerSearch();
  }

  #buildFormHtml(data) {
    const tasas = this.#cotizDolar;
    const usdInfo = tasas
      ? `<small style="color:var(--color-text-muted)">USD Blue: $${App.Utils.formatearMoneda(tasas.blue?.venta, false)}</small>`
      : '';

    return `
      <form id="form-inv" class="form-grid">
        <input type="hidden" name="id_operacion" value="${data?.id_operacion || ''}">

        <div class="form-group">
          <label>Tipo de operación <span class="required-mark">*</span></label>
          <select class="input" name="tipo_op" required>
            <option value="COMPRA" ${data?.tipo_op === 'COMPRA' ? 'selected':''}>Compra</option>
            <option value="VENTA"  ${data?.tipo_op === 'VENTA'  ? 'selected':''}>Venta</option>
          </select>
        </div>

        <div class="form-group">
          <label>Fecha <span class="required-mark">*</span></label>
          <input class="input" type="date" name="fecha"
                 value="${data ? (data.fecha?.value || data.fecha || '').substring(0,10) : new Date().toISOString().substring(0,10)}"
                 required>
        </div>

        <div class="form-group" style="position:relative">
          <label>Ticker <span class="required-mark">*</span></label>
          <input class="input" type="text" name="ticker" id="inv-ticker"
                 value="${App.Utils.escapeHtml(data?.ticker || '')}"
                 autocomplete="off" required placeholder="Ej: GGAL, AAPL">
          <div id="inv-ticker-suggestions" class="suggestions-container hidden"></div>
        </div>

        <div class="form-group">
          <label>Moneda</label>
          <select class="input" name="moneda">
            <option value="ARS" ${data?.moneda === 'ARS' ? 'selected':''}>ARS</option>
            <option value="USD" ${data?.moneda === 'USD' ? 'selected':'selected'}>USD</option>
          </select>
        </div>

        <div class="form-group">
          <label>Cantidad <span class="required-mark">*</span></label>
          <input class="input" type="number" name="cantidad" min="0.0001" step="0.0001"
                 value="${data?.cantidad || ''}" required>
        </div>

        <div class="form-group">
          <label>Precio unitario <span class="required-mark">*</span></label>
          <div>
            <input class="input" type="number" name="precio" min="0.0001" step="0.0001"
                   value="${data?.precio || ''}" required>
            ${usdInfo}
          </div>
        </div>
      </form>
    `;
  }

  #bindTickerSearch() {
    const input      = document.getElementById('inv-ticker');
    const sugestBox  = document.getElementById('inv-ticker-suggestions');
    if (!input || !sugestBox) return;

    const buscar = App.Utils.debounce(async (query) => {
      if (query.length < 2) { sugestBox.classList.add('hidden'); return; }
      try {
        const results = await App.API.call('api_searchTickers', query);
        if (!results || results.length === 0) { sugestBox.classList.add('hidden'); return; }
        sugestBox.innerHTML = results
          .slice(0, 8)
          .map(t => `<div data-ticker="${App.Utils.escapeHtml(t.symbol)}">
            <strong>${App.Utils.escapeHtml(t.symbol)}</strong>
            — ${App.Utils.escapeHtml(t.name || '')}
          </div>`)
          .join('');
        sugestBox.classList.remove('hidden');
        sugestBox.querySelectorAll('div').forEach(el => {
          el.addEventListener('click', () => {
            input.value = el.dataset.ticker;
            sugestBox.classList.add('hidden');
          });
        });
      } catch (_) {
        sugestBox.classList.add('hidden');
      }
    }, 350);

    input.addEventListener('input', (e) => buscar(e.target.value));
    document.addEventListener('click', (e) => {
      if (!input.contains(e.target)) sugestBox.classList.add('hidden');
    }, { once: false });
  }

  // --- SECCIÓN 5: CRUD ---

  async #guardar(modal) {
    const form = modal.getForm();
    if (!form) return;
    const fd = new FormData(form);
    const d  = {};
    fd.forEach((v, k) => { d[k] = v; });

    if (!d.fecha || !d.ticker || !d.cantidad || !d.precio || Number(d.cantidad) <= 0 || Number(d.precio) <= 0) {
      App.Toast.warning('Completá todos los campos obligatorios.');
      return;
    }

    const payload = {
      idCuenta : App.Store.cuenta,
      tipoOp   : d.tipo_op,
      fecha    : d.fecha,
      ticker   : d.ticker.toUpperCase().trim(),
      moneda   : d.moneda,
      cantidad : Number(d.cantidad),
      precio   : Number(d.precio)
    };

    modal.setLoading(true);
    try {
      await this._handleCreate(payload, modal);
    } catch (_) {
      modal.setLoading(false);
    }
  }

  // --- SECCIÓN 6: LISTENERS ---

  _bindListeners() {
    const vista = document.getElementById(this.vistaId);
    if (vista) {
      vista.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.id === 'inv-btn-nuevo') this.#abrirModalAlta();
        else if (btn.id === 'inv-btn-portfolio') {
          document.getElementById('inv-btn-portfolio')?.classList.replace('btn-ghost', 'btn-primary');
          document.getElementById('inv-btn-mercados')?.classList.replace('btn-primary', 'btn-ghost');
          document.getElementById('inv-tabla-wrap')?.classList.remove('hidden');
          document.getElementById('inv-mercados-wrap')?.classList.add('hidden');
        } else if (btn.id === 'inv-btn-mercados') {
          document.getElementById('inv-btn-mercados')?.classList.replace('btn-ghost', 'btn-primary');
          document.getElementById('inv-btn-portfolio')?.classList.replace('btn-primary', 'btn-ghost');
          document.getElementById('inv-mercados-wrap')?.classList.remove('hidden');
          document.getElementById('inv-tabla-wrap')?.classList.add('hidden');
        }
      });
    }
  }

  /** Inversiones no invalida por cambio de mes */
  _subscribeEvents() {
    App.Events.on('store:cuenta-changed', () => {
      this.destruir();
      this.cargar();
    });
    // Sin mes-changed: portfolio es global
  }

  // --- SECCIÓN 7: HELPERS ---

  #abrirModalDetalle(row) {
    const isCompra = row.tipo_op === 'COMPRA';
    const clr = isCompra ? 'var(--verde)' : 'var(--rojo)';
    const fmt = row.moneda === 'USD' ? App.Utils.formatearMonedaUSD : App.Utils.formatearMoneda;
    
    let resultHtml = '';
    if (row.ganancia !== null && row.ganancia !== undefined) {
       const resClr = row.ganancia >= 0 ? 'var(--verde)' : 'var(--rojo)';
       resultHtml = `<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--borde);">
         <span style="color:var(--texto-2)">P&L</span>
         <strong style="color:${resClr}">${App.Utils.formatearMoneda(row.ganancia)}</strong>
       </div>`;
    }

    const html = `
      <div class="detail-modal">
        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--borde);">
          <span style="color:var(--texto-2)">Operación</span>
          <strong style="color:${clr}">${App.Utils.escapeHtml(row.tipo_op)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--borde);">
          <span style="color:var(--texto-2)">Ticker</span>
          <strong>${App.Utils.escapeHtml(row.ticker)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--borde);">
          <span style="color:var(--texto-2)">Fecha</span>
          <strong>${App.Utils.formatearFecha(row.fecha?.value || row.fecha)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--borde);">
          <span style="color:var(--texto-2)">Cantidad</span>
          <strong>${App.Utils.formatearMoneda(row.cantidad, false)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--borde);">
          <span style="color:var(--texto-2)">Precio</span>
          <strong>${fmt(row.precio)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--borde);">
          <span style="color:var(--texto-2)">Precio Actual</span>
          <strong>${row.precio_actual ? fmt(row.precio_actual) : '—'}</strong>
        </div>
        ${resultHtml}
      </div>
    `;

    const m = new App.Modal('modal-inv-detalle');
    m.open({
      titulo: 'Detalle de Inversión',
      body: html,
      confirmLabel: 'Cerrar'
    });

    const footer = m.el.querySelector('.modal-footer');
    if (footer) {
      const cb = footer.querySelector('.modal-confirm');
      if (cb) cb.style.display = 'none';

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-outline btn-danger';
      delBtn.innerHTML = App.Icons.get('delete', 'icon-sm') + ' Eliminar';
      delBtn.onclick = () => {
         m.close();
         this.#eliminarOperacion(row);
      };
      footer.prepend(delBtn);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn btn-primary';
      closeBtn.textContent = 'Cerrar';
      closeBtn.onclick = () => m.close();
      footer.appendChild(closeBtn);
    }
  }

  #eliminarOperacion(row) {
      const m = new App.Modal('modal-inv-del-confirm');
      m.open({
        titulo      : 'Eliminar operación',
        body        : `<p>¿Eliminar operación de <strong>${App.Utils.escapeHtml(row.ticker)}</strong>?</p>`,
        confirmLabel: 'Eliminar',
        danger      : true,
        onConfirm   : async () => {
          try {
            await App.API.call('api_deleteInversion', row.id_operacion);
            App.API.invalidatePattern('api_getPortfolio');
            App.Toast.success('Operación eliminada.');
            this.destruir();
            await this.cargar();
          } catch (err) {
            App.Toast.error('Error: ' + err.message);
          }
        }
      });
  }

  #mostrarKpiSkeletons() {
    this.#kpiValor?.showSkeleton();
    this.#kpiCosto?.showSkeleton();
    this.#kpiResult?.showSkeleton();
  }
}

// --- REGISTRO ---

App.log('module-inversiones', 'init', 'InversionesModule registrado');