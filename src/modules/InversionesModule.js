'use strict';
/* ============================================================
   module-inversiones.js — v6.0.0 (FinSet 3-Row Architecture)
   Módulo Portfolio de Inversiones & Monitor Global.
   Extiende BaseModule. Sin filtro de mes (portfolio global).
   ============================================================ */

import Chart from 'chart.js/auto';

// --- SECCIÓN 0: CLASE InversionesModule ---

export class InversionesModule extends BaseModule {

  get moduleId() { return 'inversiones'; }
  get vistaId()  { return 'vista-inversiones'; }

  get _createEndpoint() { return 'api_createInversion'; }

  #modal              = null;
  #editData           = null;
  #cotizDolar         = null;
  #portfolioData      = null;
  #flowPeriod         = '6M'; // '6M' | '12M' | 'YTD'
  #tipoFiltro         = 'ALL'; // 'ALL' | 'COMPRA' | 'VENTA'
  #busqueda           = '';
  #chartInstance      = null;
  #donutChartInstance = null;
  #selectedAssetClass = null;

  // --- SECCIÓN 1: CICLO DE VIDA ---

  init() {
    this.#modal = new App.Modal('modal-inversiones');
    this._buildVista();
    this._bindListeners();
    this._subscribeEvents();
    App.log('InversionesModule', 'init', 'Módulo inversiones iniciado (FinSet)');
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

  /** Inversiones no usa filtro de mes, solo de cuenta */
  async cargar() {
    if (App.Store.isModuloLoaded(this.moduleId)) return;
    const { cuenta } = App.Store;
    if (!cuenta) return;

    this.#mostrarKpiSkeletons();

    try {
      const [portfolioData, dolarData, marketData] = await Promise.all([
        App.API.cached('api_getPortfolio',        [cuenta]),
        App.API.cached('api_getDolarCotizaciones', [],       5 * 60_000), // 5 min
        App.API.cached('api_getMarketData',        [],       2 * 60_000)  // 2 min
      ]);
      this.#cotizDolar = dolarData;
      this._renderTickerCarousel(marketData, dolarData);
      this._renderMarketData(marketData);
      this._render(portfolioData);
      App.Store.markModuloLoaded(this.moduleId);
    } catch (err) {
      App.error('InversionesModule', 'cargar', 'Error', err);
      App.Toast.error('Error al cargar inversiones: ' + err.message);
    }
  }

  // --- SECCIÓN 2: RENDER ---

  _render(data) {
    if (!data || !data.success) {
      App.Toast.error(data?.error || 'Error al obtener portfolio.');
      return;
    }

    this.#portfolioData = data;
    const { kpis, portfolio } = data;

    // Scorecard 1: Valor actual
    const valValorEl = document.getElementById('inv-kpi-val-valor');
    const subValorEl = document.getElementById('inv-kpi-sub-valor');
    if (valValorEl) valValorEl.textContent = App.Utils.formatearMoneda(kpis.valorActual);
    if (subValorEl) subValorEl.textContent = `Costo invertido: ${App.Utils.formatearMoneda(kpis.costoTotal)}`;

    // Scorecard 2: Costo Total
    const valCostoEl = document.getElementById('inv-kpi-val-costo');
    if (valCostoEl) valCostoEl.textContent = App.Utils.formatearMoneda(kpis.costoTotal);

    // Scorecard 3: Ganancia P&L
    const valResultEl = document.getElementById('inv-kpi-val-result');
    const pillResultEl = document.getElementById('inv-kpi-pill-result');
    const subResultEl = document.getElementById('inv-kpi-sub-result');
    const ganancia = Number(kpis.gananciaTotal || 0);
    const rend = Number(kpis.rendimientoPorc || 0);

    if (valResultEl) {
      valResultEl.textContent = App.Utils.formatearMoneda(ganancia);
      valResultEl.style.color = ganancia > 0 ? 'var(--verde)' : (ganancia < 0 ? 'var(--rojo)' : 'var(--texto)');
    }
    if (pillResultEl) {
      pillResultEl.className = 'finset-trend-pill ' + (ganancia >= 0 ? 'trend-up' : 'trend-down');
      pillResultEl.innerHTML = `<span>${ganancia >= 0 ? '+' : ''}${rend.toFixed(2)}%</span>`;
    }
    if (subResultEl) {
      subResultEl.textContent = ganancia >= 0 ? 'Rendimiento positivo acumulado' : 'Rendimiento negativo acumulado';
    }

    // Side Panel: Rendimiento Global % & FX
    const sideRendEl = document.getElementById('inv-side-val-rend');
    const sideFillRendEl = document.getElementById('inv-side-rend-progress-fill');
    const sidePillRendEl = document.getElementById('inv-side-pill-rend');
    if (sideRendEl) {
      sideRendEl.textContent = `${rend >= 0 ? '+' : ''}${rend.toFixed(2)}%`;
      sideRendEl.style.color = rend >= 0 ? 'var(--verde)' : 'var(--rojo)';
    }
    if (sideFillRendEl) {
      const pctWidth = Math.min(100, Math.max(10, Math.abs(rend) * 2));
      sideFillRendEl.style.width = `${pctWidth}%`;
      sideFillRendEl.style.background = rend >= 0 ? 'var(--verde)' : 'var(--rojo)';
    }
    if (sidePillRendEl) {
      sidePillRendEl.className = 'finset-trend-pill ' + (rend >= 0 ? 'trend-up' : 'trend-down');
    }

    if (this.#cotizDolar) {
      const mepEl = document.getElementById('inv-side-val-mep');
      const blueEl = document.getElementById('inv-side-val-blue');
      const cclEl = document.getElementById('inv-side-val-ccl');
      if (mepEl && this.#cotizDolar.bolsa?.venta) mepEl.textContent = `$ ${App.Utils.formatearMoneda(this.#cotizDolar.bolsa.venta, false)}`;
      if (blueEl && this.#cotizDolar.blue?.venta) blueEl.textContent = `$ ${App.Utils.formatearMoneda(this.#cotizDolar.blue.venta, false)}`;
      if (cclEl && this.#cotizDolar.contadoconliqui?.venta) cclEl.textContent = `$ ${App.Utils.formatearMoneda(this.#cotizDolar.contadoconliqui.venta, false)}`;
    }

    const geminiCard = document.getElementById('inv-side-card-gemini');
    if (geminiCard) {
      geminiCard.onclick = () => {
        window.App?.Gemini?.consultarInstrumento?.({
          symbol: 'PORTFOLIO',
          name: 'Mi Portafolio Global',
          price: App.Utils.formatearMoneda(kpis.valorActual),
          tipo: 'PORTFOLIO'
        });
      };
    }

    // Renderizar Gráficos y Listas
    this.#renderMoneyFlowChart();
    this.#renderDonutChart();
    this.#renderEstrategiaCartera();
    this.#filterAndRenderOperaciones();

    App.log('InversionesModule', '_render', `${(portfolio || []).length} operaciones cargadas`);
  }

  _renderTickerCarousel(md, dl) {
    const infoDiv = document.getElementById('inv-dolar-info');
    if (!infoDiv) return;

    let items = md?.tickerItems || [];
    if (!items.length && dl?.success) {
      items = [
        { symbol: 'USD MEP', name: 'Dólar MEP', price: '$ ' + App.Utils.formatearMoneda(dl.bolsa?.venta || 0, false), pct_change: 0, badge: 'FX', tipo: 'dolar' },
        { symbol: 'USD CCL', name: 'Dólar CCL', price: '$ ' + App.Utils.formatearMoneda(dl.contadoconliqui?.venta || 0, false), pct_change: 0, badge: 'FX', tipo: 'dolar' },
        { symbol: 'USD BLUE', name: 'Dólar Blue', price: '$ ' + App.Utils.formatearMoneda(dl.blue?.venta || 0, false), pct_change: 0, badge: 'FX', tipo: 'dolar' },
        { symbol: 'RIESGO PAÍS', name: 'Riesgo País', price: (dl.risk_country || '—') + ' pb', pct_change: 0, badge: 'ARG', tipo: 'riesgo' }
      ];
    }

    if (!items.length) {
      infoDiv.innerHTML = '';
      return;
    }

    const cardsHtml = items.map(it => {
      const pct = Number(it.pct_change || 0);
      let varHtml = '';
      if (it.tipo === 'dolar') {
        varHtml = `<span class="ticker-badge" style="font-size:0.65rem">FX</span>`;
      } else if (it.tipo === 'riesgo') {
        varHtml = `<span class="ticker-badge" style="font-size:0.65rem; background:var(--amarillo-tint); color:var(--amarillo-text)">EMBI+</span>`;
      } else {
        const cls = pct > 0 ? 'positivo' : (pct < 0 ? 'negativo' : 'neutro');
        const arrow = pct > 0 ? '▲' : (pct < 0 ? '▼' : '•');
        const sign = pct > 0 ? '+' : '';
        varHtml = `<span class="ticker-var ${cls}">${arrow} ${sign}${pct.toFixed(2)}%</span>`;
      }

      return `
        <div class="ticker-card" style="cursor:pointer;" data-symbol="${App.Utils.escapeHtml(it.symbol)}" data-name="${App.Utils.escapeHtml(it.name || it.symbol)}" data-price="${it.price}" title="${App.Utils.escapeHtml(it.name || it.symbol)} — Clic para consultar con FluxoAI">
          <div class="ticker-card-top">
            <span class="ticker-card-symbol">${App.Utils.escapeHtml(it.symbol)}</span>
            <span class="ticker-badge">${it.badge || 'MKT'}</span>
          </div>
          <div class="ticker-card-bottom">
            <span class="ticker-card-price">${it.price}</span>
            ${varHtml}
          </div>
        </div>
      `;
    }).join('');

    infoDiv.innerHTML = `
      <div class="broker-ticker-container" style="width:100%;">
        <div class="broker-ticker-header">
          <div class="broker-ticker-title">
            <span class="broker-ticker-pulse"></span>
            <span>Mercado Bursátil en Vivo</span>
          </div>
          <div class="broker-ticker-controls">
            <button class="broker-ticker-btn" id="ticker-btn-left" title="Desplazar a la izquierda" aria-label="Desplazar izquierda">◀</button>
            <button class="broker-ticker-btn" id="ticker-btn-pause" title="Pausar / Reanudar autoscroll" aria-label="Pausar autoscroll">⏸</button>
            <button class="broker-ticker-btn" id="ticker-btn-right" title="Desplazar a la derecha" aria-label="Desplazar derecha">▶</button>
          </div>
        </div>
        <div class="broker-ticker-track-wrapper" id="broker-ticker-wrapper">
          <div class="broker-ticker-track" id="broker-ticker-track">
            ${cardsHtml}
          </div>
        </div>
      </div>
    `;

    // Bind controls and autoscroll
    const wrapper = document.getElementById('broker-ticker-wrapper');
    const btnLeft = document.getElementById('ticker-btn-left');
    const btnRight = document.getElementById('ticker-btn-right');
    const btnPause = document.getElementById('ticker-btn-pause');

    if (wrapper) {
      btnLeft?.addEventListener('click', () => {
        if (wrapper.scrollLeft <= 5) {
          wrapper.scrollTo({ left: wrapper.scrollWidth - wrapper.clientWidth, behavior: 'smooth' });
        } else {
          wrapper.scrollBy({ left: -240, behavior: 'smooth' });
        }
      });

      btnRight?.addEventListener('click', () => {
        if (wrapper.scrollLeft + wrapper.clientWidth >= wrapper.scrollWidth - 10) {
          wrapper.scrollTo({ left: 0, behavior: 'smooth' });
        } else {
          wrapper.scrollBy({ left: 240, behavior: 'smooth' });
        }
      });

      wrapper.querySelectorAll('.ticker-card').forEach(card => {
        card.addEventListener('click', () => {
          const sym = card.dataset.symbol;
          const nom = card.dataset.name;
          const precio = card.dataset.price;
          window.App?.Gemini?.consultarInstrumento({ symbol: sym, name: nom, price: precio });
        });
      });

      let isPaused = false;
      const scrollStep = () => {
        if (!isPaused && wrapper) {
          if (wrapper.scrollLeft + wrapper.clientWidth >= wrapper.scrollWidth - 3) {
            wrapper.scrollLeft = 0;
          } else {
            wrapper.scrollLeft += 1;
          }
        }
      };

      const timer = setInterval(scrollStep, 35);
      wrapper.addEventListener('mouseenter', () => { isPaused = true; });
      wrapper.addEventListener('mouseleave', () => { if (btnPause?.textContent !== '▶') isPaused = false; });

      btnPause?.addEventListener('click', () => {
        if (isPaused) {
          isPaused = false;
          btnPause.textContent = '⏸';
        } else {
          isPaused = true;
          btnPause.textContent = '▶';
        }
      });
    }
  }

  _renderMarketData(md) {
    if (!md || !md.success) return;
    const wrap = document.getElementById('inv-mercados-wrap');
    if (!wrap) return;

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
      <div style="padding:16px 20px 4px;display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--borde);">
        ${tabsHtml}
      </div>
      <div id="monitor-panels" style="padding:18px 20px 20px;">
    `;

    html += `<div class="monitor-panel" data-monitor-panel="mundo">${this.#buildMundoPanel(md.mundo || [])}</div>`;
    html += `<div class="monitor-panel hidden" data-monitor-panel="soberanos">${this.#buildSoberanosPanel(md.soberanos || [])}</div>`;
    html += `<div class="monitor-panel hidden" data-monitor-panel="lecaps">${this.#buildLecapsPanel(md.lecaps || [])}</div>`;
    html += `<div class="monitor-panel hidden" data-monitor-panel="ons">${this.#buildOnsPanel(md.ons || [])}</div>`;
    html += `<div class="monitor-panel hidden" data-monitor-panel="cedears">${this.#buildCedearsPanel(md.cedears || [])}</div>`;
    html += `</div>`;

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

    wrap.querySelectorAll('[data-inv-symbol]').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const sym = el.dataset.invSymbol;
        const nom = el.dataset.invName || sym;
        const precio = el.dataset.invPrice || '';
        const tipo = el.dataset.invTipo || '';
        window.App?.Gemini?.consultarInstrumento({ symbol: sym, name: nom, price: precio, tipo });
      });
    });
  }

  // --- BUILDERS DE PANELES DE MERCADO ---

  #buildMundoPanel(arr) {
    if (!arr.length) return '<p style="color:var(--texto-3);text-align:center;padding:32px;">Sin datos de mercado disponibles.</p>';
    const grupos = {};
    arr.forEach(m => {
      const g = m.group || 'Otros';
      if (!grupos[g]) grupos[g] = [];
      grupos[g].push(m);
    });

    let html = '';
    for (const [grupo, items] of Object.entries(grupos)) {
      html += `<div style="margin-bottom:18px;">
        <h4 style="margin:0 0 10px;color:var(--texto-2);font-size:0.78rem;text-transform:uppercase;letter-spacing:.06em;font-weight:700;">${App.Utils.escapeHtml(grupo)}</h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;">`;
      items.forEach(m => {
        const clr = (m.change || 0) >= 0 ? 'var(--verde)' : 'var(--rojo)';
        const arrow = (m.change || 0) >= 0 ? '▲' : '▼';
        const pct = m.change != null ? m.change.toFixed(2) : '0.00';
        const priceStr = m.price != null ? new Intl.NumberFormat('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}).format(m.price) : '—';
        html += `<div data-inv-symbol="${App.Utils.escapeHtml(m.name)}" data-inv-name="${App.Utils.escapeHtml(m.name)}" data-inv-price="${priceStr}" data-inv-tipo="Mundo" title="Clic para consultar con FluxoAI" style="padding:12px 14px;border:1px solid var(--borde);border-radius:var(--r);background:var(--superficie);box-shadow:var(--sombra-sm);cursor:pointer;transition:transform .15s ease;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span style="font-size:1.1rem;">${m.icon || ''}</span>
            <span style="font-weight:600;font-size:0.82rem;color:var(--texto-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${App.Utils.escapeHtml(m.name)}</span>
          </div>
          <div style="font-size:1.15rem;font-weight:700;color:var(--texto);">${priceStr}</div>
          <div style="font-size:0.76rem;font-weight:700;color:${clr};margin-top:3px;">${arrow} ${m.change >= 0 ? '+' : ''}${pct}%</div>
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
      const sym = App.Utils.escapeHtml(b.symbol || '');
      const priceStr = 'US$ ' + Number(b.price_usd || 0).toFixed(2);
      html += `<tr data-inv-symbol="${sym}" data-inv-name="Bono Soberano ${sym}" data-inv-price="${priceStr}" data-inv-tipo="Bono Soberano" title="Clic para consultar ${sym} con FluxoAI" style="cursor:pointer;">
        <td><strong>${sym}</strong></td>
        <td style="text-align:right;font-weight:600;">${priceStr}</td>
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
      const sym = App.Utils.escapeHtml(l.symbol || '');
      html += `<div data-inv-symbol="${sym}" data-inv-name="${tipo} ${sym}" data-inv-price="$ ${priceStr}" data-inv-tipo="${tipo}" title="Clic para consultar ${sym} con FluxoAI" style="padding:14px 16px;border:1px solid var(--borde);border-radius:var(--r);background:var(--superficie);border-left:3px solid ${accent};cursor:pointer;transition:transform .15s ease;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:700;font-size:0.95rem;color:var(--texto);">${sym}</span>
          <span style="font-size:0.65rem;font-weight:600;padding:2px 6px;border-radius:4px;background:${accent}22;color:${accent};">${tipo}</span>
        </div>
        <div style="font-size:1.25rem;font-weight:800;margin-top:6px;color:${accent};">$ ${priceStr}</div>
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
      const priceStr = 'US$ ' + price.toFixed(2);
      html += `<tr data-inv-symbol="${sym}" data-inv-name="Obligación Negociable ${sym}" data-inv-price="${priceStr}" data-inv-tipo="ON" title="Clic para consultar ${sym} con FluxoAI" style="cursor:pointer;">
        <td><strong style="color:var(--verde);">${sym}</strong></td>
        <td style="text-align:right;font-weight:600;">${priceStr}</td>
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
      const sym = App.Utils.escapeHtml(c.symbol || '');
      const priceStr = '$ ' + price.toLocaleString('es-AR', {minimumFractionDigits:2,maximumFractionDigits:2});
      html += `<tr data-inv-symbol="${sym}" data-inv-name="CEDEAR ${sym}" data-inv-price="${priceStr}" data-inv-tipo="CEDEAR" title="Clic para consultar ${sym} con FluxoAI" style="cursor:pointer;">
        <td><strong>${sym}</strong></td>
        <td style="text-align:right;font-weight:600;">${priceStr}</td>
        <td style="text-align:right;font-weight:700;color:${clr};">${Number(c.pct_change || 0) >= 0 ? '+' : ''}${pct}%</td>
        <td style="text-align:right;color:var(--texto-3);">${vol}</td>
        <td style="text-align:right;color:var(--texto-3);">${Number(c.px_bid || 0).toFixed(2)}</td>
        <td style="text-align:right;color:var(--texto-3);">${Number(c.px_ask || 0).toFixed(2)}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
    return html;
  }

  // --- SECCIÓN 3: BUILD DOM (FinSet 3-Row Architecture) ---

  _buildVista() {
    const vista = document.getElementById(this.vistaId);
    if (!vista) return;

    vista.innerHTML = `
      <!-- ═══ ROW 1: SCORECARDS FINSET ═══ -->
      <div class="finset-kpi-grid" id="inv-scorecards-grid" style="margin-bottom: 24px;">
        
        <!-- Card 1: Valor Actual -->
        <div class="finset-kpi-card" id="inv-card-kpi-valor">
          <div class="finset-kpi-header">
            <div class="finset-kpi-title-wrap">
              <div class="finset-kpi-icon icon-blue">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              </div>
              <span class="finset-kpi-title">Valor Actual</span>
            </div>
          </div>
          <div class="finset-kpi-value" id="inv-kpi-val-valor">$ 0,00</div>
          <div class="finset-kpi-footer">
            <span class="finset-kpi-subtext" id="inv-kpi-sub-valor">Costo: $ 0,00</span>
            <span class="finset-trend-pill trend-up"><span>Portfolio</span></span>
          </div>
        </div>

        <!-- Card 2: Costo Total Invertido -->
        <div class="finset-kpi-card" id="inv-card-kpi-costo">
          <div class="finset-kpi-header">
            <div class="finset-kpi-title-wrap">
              <div class="finset-kpi-icon icon-purple">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>
              </div>
              <span class="finset-kpi-title">Costo Invertido</span>
            </div>
          </div>
          <div class="finset-kpi-value" id="inv-kpi-val-costo">$ 0,00</div>
          <div class="finset-kpi-footer">
            <span class="finset-kpi-subtext">Capital histórico colocado</span>
            <span class="finset-trend-pill trend-neutral"><span>Costo</span></span>
          </div>
        </div>

        <!-- Card 3: Ganancia P&L -->
        <div class="finset-kpi-card" id="inv-card-kpi-result">
          <div class="finset-kpi-header">
            <div class="finset-kpi-title-wrap">
              <div class="finset-kpi-icon icon-green">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>
              </div>
              <span class="finset-kpi-title">Ganancia (P&L)</span>
            </div>
          </div>
          <div class="finset-kpi-value" id="inv-kpi-val-result">$ 0,00</div>
          <div class="finset-kpi-footer">
            <span class="finset-kpi-subtext" id="inv-kpi-sub-result">Resultado acumulado</span>
            <span class="finset-trend-pill trend-up" id="inv-kpi-pill-result"><span>0.00%</span></span>
          </div>
        </div>

      </div>

      <!-- ═══ ROW 2: ANALYTICS & INSIGHTS (Evolución + Asset Allocation) ═══ -->
      <div class="finset-grid-2col" style="margin-bottom: 24px;">
        
        <!-- Left (60%): Evolución Mensual del Portfolio -->
        <div class="finset-card" id="inv-widget-moneyflow">
          <div class="finset-card-header">
            <div class="finset-card-title-wrap">
              <h3 class="finset-card-title">Flujo de Inversiones</h3>
              <span class="finset-card-subtitle" id="inv-moneyflow-sub">Evolución histórica últimos 6 meses</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <div class="fintech-pill-switch" id="inv-period-switch">
                <button class="fintech-pill-btn active" data-period="6M">6M</button>
                <button class="fintech-pill-btn" data-period="12M">12M</button>
                <button class="fintech-pill-btn" data-period="YTD">Año actual</button>
              </div>
            </div>
          </div>
          <div style="position:relative; width:100%; height:230px; margin: 4px 0;">
            <canvas id="inv-moneyflow-canvas"></canvas>
          </div>
          <div class="finset-chart-summary" id="inv-moneyflow-summary"></div>
        </div>

        <!-- Right (40%): Asset Allocation (FinSet Side-by-Side) -->
        <div class="finset-card" id="inv-widget-categories">
          <div class="finset-card-header">
            <div class="finset-card-title-wrap">
              <h3 class="finset-card-title">Asset Allocation</h3>
              <span class="finset-card-subtitle">Distribución por activo</span>
            </div>
          </div>
          <div class="finset-categories-side-wrap">
            <div class="fintech-legend-list" id="inv-categories-legend" style="margin-top:0;"></div>
            <div class="fintech-donut-wrapper" style="height:180px; margin:0;">
              <canvas id="inv-categories-donut-canvas"></canvas>
              <div class="fintech-donut-center" id="inv-categories-donut-center">
                <span class="fintech-donut-center-label">Total Invertido</span>
                <span class="fintech-donut-center-val" id="inv-donut-center-val" style="font-size:1.05rem;">$ 0,00</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- Live Ticker de Mercados & Dólar -->
      <div id="inv-dolar-info" style="margin-bottom: 24px;"></div>

      <!-- ═══ ROW 3: OPERATIONS & POSICIONES + ESTRATEGIA (FinSet 2-Col Grid) ═══ -->
      <div class="finset-grid-2col" style="margin-bottom: 24px;">
        
        <!-- Left (60%): Posiciones & Operaciones / Monitor -->
        <div class="finset-card" id="inv-widget-operaciones">
          <div class="finset-card-header" style="flex-wrap:wrap; gap:12px; align-items:center;">
            <div class="dh-drilldown-left" style="min-width:180px;">
              <div class="dh-drilldown-badge badge-all" id="inv-operaciones-badge">
                <span class="dh-badge-dot"></span>
                <span class="dh-badge-title" id="inv-operaciones-title">Posiciones & Operaciones</span>
              </div>
              <div class="dh-drilldown-summary" id="inv-operaciones-summary">—</div>
            </div>

            <div class="finset-card-actions" style="margin-left:auto; gap:8px; align-items:center; flex-wrap:wrap;">
              <!-- Switch Portfolio vs Monitor -->
              <div class="currency-pills" id="inv-view-switch" style="display:flex;">
                <button class="currency-pill active" id="inv-btn-portfolio" data-view="portfolio">Mi Portfolio</button>
                <button class="currency-pill" id="inv-btn-mercados" data-view="mercados">Monitor Global</button>
              </div>

              <div id="inv-portfolio-controls" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <!-- Pestañas de Filtrado -->
                <div class="dh-filter-tabs" id="inv-operaciones-tabs">
                  <button class="dh-tab-btn active" data-filter="ALL" id="inv-tab-all">Todos</button>
                  <button class="dh-tab-btn" data-filter="COMPRA" id="inv-tab-compras">Compras</button>
                  <button class="dh-tab-btn" data-filter="VENTA" id="inv-tab-ventas">Ventas</button>
                </div>

                <!-- Buscador -->
                <div class="dh-search-box" style="margin:0;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input type="text" id="inv-search-input" placeholder="Buscar ticker..." class="finset-search-input" style="width:110px;">
                </div>

                <!-- Botón Contextual Primario -->
                <button class="btn btn-primary btn-sm" id="inv-btn-nuevo" style="display:inline-flex;align-items:center;gap:6px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  <span>+ Operación</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Lista de operaciones interactiva estilo movimientos -->
          <div class="dh-drilldown-list dh-side-main" id="inv-operaciones-list" style="margin-top:12px; max-height:510px; overflow-y:auto; padding-right:4px;">
          </div>

          <!-- Contenedor del Monitor Global de Mercados -->
          <div class="hidden" id="inv-mercados-wrap" style="margin-top:12px;">
             <div style="padding:2rem;color:var(--texto-3);text-align:center">Cargando mercados...</div>
          </div>
        </div>

        <!-- Right (40%): Estrategia & Cartera (Activos de la cartera filtrables por la dona) -->
        <div class="finset-card" id="inv-widget-side-panel">
          <div class="finset-card-header" style="justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div class="finset-card-title-wrap">
              <h3 class="finset-card-title">Estrategia & Cartera</h3>
              <span class="finset-card-subtitle" id="inv-cartera-subtitle">Activos y tenencias en cartera</span>
            </div>
            <span class="finset-trend-pill trend-neutral" id="inv-cartera-count-pill"><span>0 activos</span></span>
          </div>

          <!-- Badge de Filtro por Porción de la Dona -->
          <div id="inv-asset-filter-badge" class="hidden" style="margin: 10px 0 6px; padding: 6px 10px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 8px; display: flex; align-items: center; justify-content: space-between; font-size: 0.78rem;">
            <span style="color: var(--primario); font-weight: 600;" id="inv-asset-filter-text">Filtrando por tipo</span>
            <button id="inv-btn-clear-asset-filter" style="border: none; background: none; cursor: pointer; color: var(--texto-3); font-size: 0.85rem; font-weight: 700; padding: 0 4px;" title="Ver todos los activos">✕ Ver todos</button>
          </div>

          <!-- Listado dinámico de activos de la cartera -->
          <div class="finset-modules-stack" id="inv-activos-cartera-list" style="margin-top: 10px; max-height: 480px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;">
          </div>
        </div>

      </div>
    `;
  }

  // --- SECCIÓN 4: ANALYTICS & CHARTS ---

  #renderMoneyFlowChart() {
    const canvas = document.getElementById('inv-moneyflow-canvas');
    if (!canvas) return;

    if (this.#chartInstance) {
      this.#chartInstance.destroy();
      this.#chartInstance = null;
    }

    const portfolio = this.#portfolioData?.portfolio || [];

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

    const comprasData = keys.map(k => {
      return portfolio
        .filter(p => p.tipo_op === 'COMPRA' && (p.fecha?.value || p.fecha || '').startsWith(k))
        .reduce((sum, p) => sum + (Number(p.cantidad || 0) * Number(p.precio || 0)), 0);
    });

    const ventasData = keys.map(k => {
      return portfolio
        .filter(p => p.tipo_op === 'VENTA' && (p.fecha?.value || p.fecha || '').startsWith(k))
        .reduce((sum, p) => sum + (Number(p.cantidad || 0) * Number(p.precio || 0)), 0);
    });

    const totalComp = comprasData.reduce((a, b) => a + b, 0);
    const totalVent = ventasData.reduce((a, b) => a + b, 0);
    const netoInvertido = totalComp - totalVent;

    const summaryEl = document.getElementById('inv-moneyflow-summary');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <span>Compras: <strong style="color:var(--verde);">${App.Utils.formatearMoneda(totalComp)}</strong></span>
        <span style="margin:0 8px; color:var(--borde);">•</span>
        <span>Ventas: <strong style="color:var(--rojo);">${App.Utils.formatearMoneda(totalVent)}</strong></span>
        <span style="margin:0 8px; color:var(--borde);">•</span>
        <span>Flujo Neto: <strong>${App.Utils.formatearMoneda(netoInvertido)}</strong></span>
      `;
    }

    const ctx = canvas.getContext('2d');
    this.#chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Compras',
            data: comprasData,
            backgroundColor: '#10B981',
            borderRadius: 6,
            barPercentage: 0.5,
            categoryPercentage: 0.7
          },
          {
            label: 'Ventas',
            data: ventasData,
            backgroundColor: '#3B82F6',
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
              label: (item) => ` ${item.dataset.label}: ${App.Utils.formatearMoneda(item.raw)}`
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

  #clasificarInstrumento(ticker) {
    const t = (ticker || '').toUpperCase().trim();
    
    // 1. Bonos Soberanos / Bopreales
    if (/^(AL|GD|AE|TX|T2X|TO|BP|DICP|PARP|CUAP)[0-9]*/.test(t)) {
      return 'Bonos Soberanos';
    }
    // 2. Letras & LECAPs / BONCAPs
    if (/^(S[0-9]{2}|X[0-9]{2}|T[0-9]{2}|B[0-9]{2})[A-Z][0-9]/.test(t) || t.startsWith('LECAP')) {
      return 'Letras & LECAPs';
    }
    // 3. Obligaciones Negociables (ONs)
    const KNOWN_ONS = ['YCA6O', 'YFC2O', 'TLC1O', 'IRCFO', 'MRCEO', 'CP17O', 'MGC9O', 'CS38O', 'VSC3O', 'RUC5O', 'ON'];
    if (KNOWN_ONS.includes(t) || /^(YC|YF|TL|IR|MR|CS|CP|RU|TE|BA|VT)[A-Z0-9]{2,4}/.test(t) || t.endsWith('O')) {
      return 'Obligaciones Negociables';
    }
    // 4. Criptomonedas
    if (['BTC', 'ETH', 'USDT', 'USDC', 'SOL', 'ADA', 'BNB', 'DAI'].includes(t)) {
      return 'Criptomonedas';
    }
    // 5. CEDEARs
    const KNOWN_CEDEARS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'SPY', 'QQQ', 'DIA', 'KO', 'DIS', 'BABA', 'MELI', 'GLOB', 'V', 'WMT', 'JNJ', 'PFE', 'XOM', 'CVX', 'AMD', 'INTC', 'NFLX', 'PYPL', 'SPOT', 'UBER', 'ABNB', 'COIN', 'SHOP', 'SQ', 'IBM', 'GE', 'BA', 'CAT', 'MCD', 'NKE', 'PG', 'JPM', 'GS', 'BAC', 'C', 'WFC', 'DESP', 'BIOX', 'VIST', 'TEN', 'ARCO'];
    if (KNOWN_CEDEARS.includes(t) || KNOWN_CEDEARS.includes(t.replace(/D$/, ''))) {
      return 'CEDEARs';
    }
    // 6. Acciones Argentinas
    const ACCIONES_ARG = ['GGAL', 'YPFD', 'PAMP', 'BMA', 'TXAR', 'ALUA', 'CRES', 'TGSU2', 'TGNO4', 'EDN', 'TRAN', 'VALO', 'BYMA', 'SUPV', 'MIRG', 'CEPU', 'LOMA', 'COME', 'BBAR', 'TECO2', 'IRSA', 'AGRO', 'MOLI', 'AUSO'];
    if (ACCIONES_ARG.includes(t)) {
      return 'Acciones Argentinas';
    }

    return 'Otros Activos';
  }

  #calcularTenenciasActivas() {
    const portfolio = this.#portfolioData?.portfolio || [];
    const cotizDolar = this.#cotizDolar?.bolsa?.venta || this.#cotizDolar?.blue?.venta || 1540;

    const tenencias = {};
    portfolio.forEach(mov => {
      const ticker = (mov.ticker || '').toUpperCase().trim();
      if (!ticker) return;

      if (!tenencias[ticker]) {
        tenencias[ticker] = {
          ticker,
          tipoInstrumento: this.#clasificarInstrumento(ticker),
          cantidad: 0,
          costoTotalArs: 0,
          cantCompra: 0,
          moneda: mov.moneda || 'ARS',
          precioActual: Number(mov.precio_actual || mov.precio || 0)
        };
      }

      const cant = Number(mov.cantidad || 0);
      const precio = Number(mov.precio || 0);
      let impArs = cant * precio;
      if (mov.moneda === 'USD') impArs *= cotizDolar;

      if (mov.tipo_op === 'COMPRA') {
        tenencias[ticker].cantidad += cant;
        tenencias[ticker].costoTotalArs += impArs;
        tenencias[ticker].cantCompra += cant;
      } else if (mov.tipo_op === 'VENTA') {
        tenencias[ticker].cantidad -= cant;
      }

      if (mov.precio_actual && Number(mov.precio_actual) > 0) {
        tenencias[ticker].precioActual = Number(mov.precio_actual);
      }
    });

    const activos = [];
    Object.values(tenencias).forEach(t => {
      if (t.cantidad <= 0.0001) return;

      const precioPromArs = t.cantCompra > 0 ? t.costoTotalArs / t.cantCompra : 0;
      const costoActualArs = precioPromArs * t.cantidad;

      let valorActualArs = t.cantidad * t.precioActual;
      if (t.moneda === 'USD') valorActualArs *= cotizDolar;

      const gananciaArs = valorActualArs - costoActualArs;
      const rendPct = costoActualArs > 0 ? (gananciaArs / costoActualArs) * 100 : 0;

      activos.push({
        ticker: t.ticker,
        tipoInstrumento: t.tipoInstrumento,
        cantidad: t.cantidad,
        moneda: t.moneda,
        precioProm: t.moneda === 'USD' ? (precioPromArs / cotizDolar) : precioPromArs,
        precioActual: t.precioActual,
        costoTotalArs: costoActualArs,
        valorActualArs: valorActualArs,
        gananciaArs: gananciaArs,
        rendPct: rendPct
      });
    });

    return activos.sort((a, b) => b.valorActualArs - a.valorActualArs);
  }

  #renderDonutChart() {
    const canvas = document.getElementById('inv-categories-donut-canvas');
    if (!canvas) return;

    if (this.#donutChartInstance) {
      this.#donutChartInstance.destroy();
      this.#donutChartInstance = null;
    }

    const activos = this.#calcularTenenciasActivas();
    const mapTipos = {};

    activos.forEach(a => {
      const tipo = a.tipoInstrumento || 'Otros Activos';
      mapTipos[tipo] = (mapTipos[tipo] || 0) + a.valorActualArs;
    });

    const activeEntries = Object.entries(mapTipos).sort((a, b) => b[1] - a[1]);
    const labels = activeEntries.map(([k]) => k);
    const dataVals = activeEntries.map(([_, v]) => Math.round(v));
    const total = dataVals.reduce((a, b) => a + b, 0);

    const centerValEl = document.getElementById('inv-donut-center-val');
    if (centerValEl) centerValEl.textContent = App.Utils.formatearMoneda(total);

    const legendEl = document.getElementById('inv-categories-legend');
    const PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16', '#6366F1'];
    const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);

    if (!activeEntries.length || total <= 0) {
      if (legendEl) {
        legendEl.innerHTML = '<div style="text-align:center;padding:28px 8px;color:var(--texto-3);font-size:0.82rem;">Sin posiciones activas en cartera</div>';
      }
      return;
    }

    if (legendEl) {
      legendEl.innerHTML = labels.map((lbl, i) => {
        const val = dataVals[i];
        const pct = ((val / total) * 100).toFixed(1);
        const isSelected = this.#selectedAssetClass === lbl;
        return `
          <div class="fintech-legend-item ${isSelected ? 'active-filter' : ''}" 
               style="cursor:pointer; ${isSelected ? 'background:rgba(59,130,246,0.1); border-radius:6px; padding:4px 6px;' : ''}" 
               data-asset-class="${App.Utils.escapeHtml(lbl)}"
               title="Clic para filtrar activos de ${App.Utils.escapeHtml(lbl)}">
            <div class="fintech-legend-left">
              <span class="fintech-legend-dot" style="background: ${colors[i]};"></span>
              <span class="fintech-legend-label">${App.Utils.escapeHtml(lbl)}</span>
            </div>
            <div class="fintech-legend-right">
              <span class="fintech-legend-pct">${pct}%</span>
              <span class="fintech-legend-amount" style="color: var(--texto); font-weight: 600;">${App.Utils.formatearMoneda(val)}</span>
            </div>
          </div>
        `;
      }).join('');

      legendEl.querySelectorAll('.fintech-legend-item').forEach(el => {
        el.addEventListener('click', () => {
          this.#filtrarPorTipoActivo(el.dataset.assetClass);
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
          hoverOffset: 6
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
              label: (item) => ` ${item.label}: ${App.Utils.formatearMoneda(item.raw)} (${((item.raw / total) * 100).toFixed(1)}%)`
            }
          }
        },
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            const tipoSelected = labels[index];
            this.#filtrarPorTipoActivo(tipoSelected);
          }
        }
      }
    });
  }

  #renderEstrategiaCartera() {
    const container = document.getElementById('inv-activos-cartera-list');
    const countPill = document.getElementById('inv-cartera-count-pill');
    if (!container) return;

    let activos = this.#calcularTenenciasActivas();

    if (this.#selectedAssetClass) {
      activos = activos.filter(a => a.tipoInstrumento === this.#selectedAssetClass);
    }

    if (countPill) {
      countPill.innerHTML = `<span>${activos.length} ${activos.length === 1 ? 'activo' : 'activos'}</span>`;
    }

    if (!activos.length) {
      container.innerHTML = `
        <div style="text-align:center; padding:28px 12px; color:var(--texto-3);">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px; opacity:0.6;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <p style="font-weight:600; margin:0 0 4px; color:var(--texto-2); font-size:0.88rem;">Sin activos para mostrar</p>
          <p style="font-size:0.75rem; margin:0;">${this.#selectedAssetClass ? `No hay posiciones activas en ${this.#selectedAssetClass}.` : 'No hay activos en cartera actualmente.'}</p>
        </div>
      `;
      return;
    }

    const BADGES = {
      'CEDEARs': 'badge-ing',
      'Bonos Soberanos': 'badge-recur',
      'Obligaciones Negociables': 'badge-all',
      'Letras & LECAPs': 'badge-ing',
      'Acciones Argentinas': 'badge-recur',
      'Criptomonedas': 'badge-egr',
      'Otros Activos': 'badge-all'
    };

    container.innerHTML = activos.map(a => {
      const badgeCls = BADGES[a.tipoInstrumento] || 'badge-all';
      const plSign = a.gananciaArs >= 0 ? '+' : '';
      const plColor = a.gananciaArs >= 0 ? 'var(--verde)' : 'var(--rojo)';
      const fmt = a.moneda === 'USD' ? App.Utils.formatearMonedaUSD : App.Utils.formatearMoneda;

      return `
        <div class="finset-submodule-card inv-activo-card" 
             data-inv-ticker="${App.Utils.escapeHtml(a.ticker)}"
             data-inv-name="${App.Utils.escapeHtml(a.ticker)}"
             data-inv-price="${fmt(a.precioActual)}"
             data-inv-tipo="${App.Utils.escapeHtml(a.tipoInstrumento)}"
             title="Clic para consultar análisis de ${App.Utils.escapeHtml(a.ticker)} con FluxoAI"
             style="cursor:pointer; transition:all 0.15s ease;">
          <div class="fsc-header" style="align-items:center;">
            <div class="fsc-tag-wrap" style="align-items:center;">
              <div class="fsc-icon-box icon-blue">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              </div>
              <div class="fsc-text-block">
                <div style="display:flex; align-items:center; gap:6px;">
                  <strong style="font-size:0.92rem; color:var(--texto);">${App.Utils.escapeHtml(a.ticker)}</strong>
                  <span class="dh-item-badge ${badgeCls}" style="font-size:0.65rem; padding:1px 5px; border-radius:4px;">${App.Utils.escapeHtml(a.tipoInstrumento)}</span>
                </div>
                <div class="fsc-sub" style="font-size:0.72rem; color:var(--texto-3); margin-top:2px;">
                  ${Number(a.cantidad).toLocaleString('es-AR')} un. @ ${fmt(a.precioActual)}
                </div>
              </div>
            </div>
            <div class="fsc-right-block" style="text-align:right;">
              <div class="fsc-value" style="font-size:0.95rem; font-weight:700; color:var(--texto);">${App.Utils.formatearMoneda(a.valorActualArs)}</div>
              <div style="font-size:0.72rem; font-weight:700; color:${plColor};">
                ${plSign}${App.Utils.formatearMoneda(a.gananciaArs)} (${plSign}${a.rendPct.toFixed(1)}%)
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.inv-activo-card').forEach(card => {
      card.addEventListener('click', () => {
        const sym = card.dataset.invTicker;
        const nom = card.dataset.invName;
        const precio = card.dataset.invPrice;
        const tipo = card.dataset.invTipo;
        window.App?.Gemini?.consultarInstrumento({ symbol: sym, name: nom, price: precio, tipo });
      });
    });
  }

  #filtrarPorTipoActivo(tipo) {
    if (this.#selectedAssetClass === tipo) {
      this.#limpiarFiltroTipoActivo();
      return;
    }
    this.#selectedAssetClass = tipo;
    const badge = document.getElementById('inv-asset-filter-badge');
    const badgeText = document.getElementById('inv-asset-filter-text');
    if (badge) badge.classList.remove('hidden');
    if (badgeText) badgeText.textContent = `Filtrado por: ${tipo}`;

    this.#renderDonutChart();
    this.#renderEstrategiaCartera();
  }

  #limpiarFiltroTipoActivo() {
    this.#selectedAssetClass = null;
    const badge = document.getElementById('inv-asset-filter-badge');
    if (badge) badge.classList.add('hidden');

    this.#renderDonutChart();
    this.#renderEstrategiaCartera();
  }

  // --- SECCIÓN 5: FILTRADO Y LISTA DE OPERACIONES ---

  #filterAndRenderOperaciones() {
    const portfolio = this.#portfolioData?.portfolio || [];

    const filtered = portfolio.filter(p => {
      if (this.#tipoFiltro !== 'ALL' && p.tipo_op !== this.#tipoFiltro) return false;
      if (this.#busqueda) {
        const q = this.#busqueda.toLowerCase();
        const sym = (p.ticker || '').toLowerCase();
        if (!sym.includes(q)) return false;
      }
      return true;
    });

    const badgeTitleEl = document.getElementById('inv-operaciones-title');
    const badgeEl = document.getElementById('inv-operaciones-badge');
    const summaryEl = document.getElementById('inv-operaciones-summary');

    if (badgeTitleEl) {
      if (this.#tipoFiltro === 'COMPRA') badgeTitleEl.textContent = 'Operaciones de Compra';
      else if (this.#tipoFiltro === 'VENTA') badgeTitleEl.textContent = 'Operaciones de Venta';
      else badgeTitleEl.textContent = 'Posiciones & Operaciones';
    }
    if (badgeEl) {
      badgeEl.className = 'dh-drilldown-badge ' + (this.#tipoFiltro === 'COMPRA' ? 'badge-ing' : (this.#tipoFiltro === 'VENTA' ? 'badge-egr' : 'badge-all'));
    }

    const totalVol = filtered.reduce((acc, p) => acc + (Number(p.cantidad || 0) * Number(p.precio || 0)), 0);
    const totalPL = filtered.reduce((acc, p) => acc + Number(p.ganancia || 0), 0);

    if (summaryEl) {
      summaryEl.textContent = `${filtered.length} ${filtered.length === 1 ? 'operación' : 'operaciones'} • Volumen: ${App.Utils.formatearMoneda(totalVol)} • P&L: ${App.Utils.formatearMoneda(totalPL)}`;
    }

    this.#renderOperacionesList(filtered);
  }

  #renderOperacionesList(items) {
    const listEl = document.getElementById('inv-operaciones-list');
    if (!listEl) return;

    if (!items.length) {
      listEl.innerHTML = `
        <div style="text-align:center; padding:36px 16px; color:var(--texto-3);">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px; opacity:0.6;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <p style="font-weight:600; margin:0 0 4px; color:var(--texto-2);">No hay operaciones registradas</p>
          <p style="font-size:0.8rem; margin:0;">No se encontraron registros con los filtros aplicados.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = items.map(r => {
      const isCompra = r.tipo_op === 'COMPRA';
      const iconBg = isCompra ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.12)';
      const iconClr = isCompra ? 'var(--verde)' : '#3b82f6';
      const badgeCls = isCompra ? 'dh-badge-ing' : 'dh-badge-recur';
      const badgeLabel = isCompra ? 'Compra' : 'Venta';

      const sym = App.Utils.escapeHtml(r.ticker || '—');
      const fechaStr = App.Utils.formatearFecha(r.fecha?.value || r.fecha);
      const fmt = r.moneda === 'USD' ? App.Utils.formatearMonedaUSD : App.Utils.formatearMoneda;
      const totalOperacion = Number(r.cantidad || 0) * Number(r.precio || 0);

      let plHtml = '—';
      if (r.ganancia !== null && r.ganancia !== undefined) {
        const plCls = r.ganancia >= 0 ? 'positivo' : 'negativo';
        const sign = r.ganancia >= 0 ? '+' : '';
        plHtml = `<span class="${plCls}" style="font-weight:700;">${sign}${App.Utils.formatearMoneda(r.ganancia)}</span>`;
      }

      return `
        <div class="dh-drill-row" data-inv-id="${r.id_operacion}" style="display:flex; align-items:center; gap:12px; padding:10px 12px; border-bottom:1px solid var(--borde); cursor:pointer; transition:background 0.15s ease;">
          <div style="width:36px; height:36px; border-radius:10px; background:${iconBg}; color:${iconClr}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              ${isCompra ? '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>' : '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>'}
            </svg>
          </div>

          <div style="flex:1; min-width:0;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:2px;">
              <span style="font-weight:700; font-size:0.92rem; color:var(--texto);">${sym}</span>
              <span class="dh-item-badge ${badgeCls}" style="font-size:0.68rem; padding:2px 6px; border-radius:4px;">${badgeLabel}</span>
              <span style="font-size:0.75rem; color:var(--texto-3);">${r.moneda || 'ARS'}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px; font-size:0.75rem; color:var(--texto-3);">
              <span>${fechaStr}</span>
              <span>•</span>
              <span>${Number(r.cantidad || 0).toLocaleString('es-AR')} un. @ ${fmt(r.precio)}</span>
              ${r.precio_actual ? `<span>• Act: ${fmt(r.precio_actual)}</span>` : ''}
            </div>
          </div>

          <div style="text-align:right; flex-shrink:0;">
            <div style="font-weight:700; font-size:0.95rem; color:var(--texto);">
              ${fmt(totalOperacion)}
            </div>
            <div style="font-size:0.75rem;">
              P&L: ${plHtml}
            </div>
          </div>

          <div class="dh-drill-actions" style="display:flex; align-items:center; gap:4px; margin-left:8px;" onclick="event.stopPropagation();">
            <button class="btn-icon-sm inv-btn-delete" data-id="${r.id_operacion}" title="Eliminar" style="color:var(--rojo);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.dh-drill-row').forEach(rowEl => {
      const id = rowEl.dataset.invId;
      const rowData = items.find(x => String(x.id_operacion) === String(id));
      if (!rowData) return;

      rowEl.addEventListener('click', () => this.#abrirModalDetalle(rowData));

      rowEl.querySelector('.inv-btn-delete')?.addEventListener('click', () => {
        this.#eliminarOperacion(rowData);
      });
    });
  }

  // --- SECCIÓN 6: MODAL DE ALTA ---

  abrirAlta(tipo = 'COMPRA') {
    this.#abrirModalAlta(tipo);
  }

  #abrirModalAlta(tipo = 'COMPRA') {
    this.#editData = null;
    this.#modal.open({
      titulo      : tipo === 'COMPRA' ? 'Nueva Compra de Inversión' : 'Nueva Venta de Inversión',
      icono       : 'investment',
      body        : this.#buildFormHtml(tipo, null),
      confirmLabel: 'Guardar Operación',
      size        : 'lg',
      onConfirm   : (m) => this.#guardar(m)
    });
    this.#postOpenForm();
    this.#bindTickerSearch();
  }

  #buildFormHtml(tipo, data) {
    const isCompra = tipo === 'COMPRA';
    const tasas = this.#cotizDolar;
    const usdInfo = tasas
      ? `<small style="color:var(--texto-3)">USD Blue: $${App.Utils.formatearMoneda(tasas.blue?.venta, false)}</small>`
      : '';

    return `
      <!-- Selector Segmentado: Compra vs Venta -->
      <div class="modal-segmented-switch">
        <button type="button" class="modal-segmented-btn btn-inv-tipo-toggle ${isCompra ? 'active btn-seg-green' : ''}" data-tipo="COMPRA">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
          Compra
        </button>
        <button type="button" class="modal-segmented-btn btn-inv-tipo-toggle ${!isCompra ? 'active btn-seg-red' : ''}" data-tipo="VENTA">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>
          Venta
        </button>
      </div>

      <form id="form-inv" class="form-grid">
        <input type="hidden" name="tipo_op" id="inv-form-tipo" value="${tipo}">
        <input type="hidden" name="id_operacion" value="${data?.id_operacion || ''}">

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
                 autocomplete="off" required placeholder="Ej: GGAL, AAPL, AL30...">
          <div id="inv-ticker-suggestions" class="suggestions-container hidden"></div>
        </div>

        <div class="form-group">
          <label>Moneda <span class="required-mark">*</span></label>
          <select class="input" name="moneda">
            <option value="ARS" ${data?.moneda === 'ARS' ? 'selected':''}>ARS</option>
            <option value="USD" ${data?.moneda === 'USD' ? 'selected':'selected'}>USD</option>
          </select>
        </div>

        <div class="form-group">
          <label>Cantidad <span class="required-mark">*</span></label>
          <input class="input" type="number" name="cantidad" min="0.0001" step="0.0001"
                 value="${data?.cantidad || ''}" required placeholder="0.00">
        </div>

        <div class="form-group full-width">
          <label>Precio unitario <span class="required-mark">*</span></label>
          <div>
            <input class="input" type="number" name="precio" min="0.0001" step="0.0001"
                   value="${data?.precio || ''}" required placeholder="0.00">
            ${usdInfo}
          </div>
        </div>
      </form>
    `;
  }

  #postOpenForm() {
    this.#modal.el.querySelectorAll('.btn-inv-tipo-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const nuevoTipo = btn.dataset.tipo;
        const isCompra = nuevoTipo === 'COMPRA';

        this.#modal.el.querySelectorAll('.btn-inv-tipo-toggle').forEach(b => {
          b.className = `modal-segmented-btn btn-inv-tipo-toggle ${b.dataset.tipo === nuevoTipo ? (isCompra ? 'active btn-seg-green' : 'active btn-seg-red') : ''}`;
        });

        const tipoHidden = this.#modal.el.querySelector('#inv-form-tipo');
        if (tipoHidden) tipoHidden.value = nuevoTipo;

        const confirmBtn = this.#modal.el.querySelector('.modal-confirm');
        if (confirmBtn) {
          confirmBtn.textContent = isCompra ? 'Guardar Compra' : 'Guardar Venta';
          confirmBtn.className = `btn ${isCompra ? 'btn-primary' : 'btn-danger'} modal-confirm`;
        }

        const titleSpan = `<span style="margin-right:8px; display:inline-flex; align-items:center; color:${isCompra ? 'var(--verde)' : 'var(--rojo)'};">${App.Icons.get(isCompra ? 'trending_up' : 'trending_down')}</span>${isCompra ? 'Nueva Compra de Inversión' : 'Nueva Venta de Inversión'}`;
        const titleEl = this.#modal.el.querySelector('.modal-title');
        if (titleEl) titleEl.innerHTML = titleSpan;
      });
    });
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

  // --- SECCIÓN 7: CRUD ---

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
      tipoOp   : d.tipo_op || 'COMPRA',
      fecha    : d.fecha,
      ticker   : d.ticker.toUpperCase().trim(),
      moneda   : d.moneda,
      cantidad : Number(d.cantidad),
      precio   : Number(d.precio)
    };

    modal.setLoading(true);
    try {
      await this._handleCreate(payload, modal);
      App.API.invalidatePattern('api_getPortfolio');
      this.destruir();
      await this.cargar();
    } catch (_) {
      modal.setLoading(false);
    }
  }

  // --- SECCIÓN 8: LISTENERS ---

  _bindListeners() {
    const vista = document.getElementById(this.vistaId);
    if (!vista) return;

    // Switch de vista Portfolio vs Monitor Global
    const btnPort = document.getElementById('inv-btn-portfolio');
    const btnMerc = document.getElementById('inv-btn-mercados');
    const portList = document.getElementById('inv-operaciones-list');
    const mercWrap = document.getElementById('inv-mercados-wrap');
    const portControls = document.getElementById('inv-portfolio-controls');

    btnPort?.addEventListener('click', () => {
      btnPort.classList.add('active');
      btnMerc.classList.remove('active');
      portList?.classList.remove('hidden');
      portControls?.classList.remove('hidden');
      mercWrap?.classList.add('hidden');
    });

    btnMerc?.addEventListener('click', () => {
      btnMerc.classList.add('active');
      btnPort.classList.remove('active');
      mercWrap?.classList.remove('hidden');
      portList?.classList.add('hidden');
      portControls?.classList.add('hidden');
    });

    // Botón Limpiar Filtro Tipo de Activo
    document.getElementById('inv-btn-clear-asset-filter')?.addEventListener('click', () => {
      this.#limpiarFiltroTipoActivo();
    });

    // Pestañas de filtrado (Todos / Compras / Ventas)
    const tabs = document.getElementById('inv-operaciones-tabs');
    tabs?.addEventListener('click', (e) => {
      const btn = e.target.closest('.dh-tab-btn');
      if (!btn) return;
      tabs.querySelectorAll('.dh-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.#tipoFiltro = btn.dataset.filter;
      this.#filterAndRenderOperaciones();
    });

    // Buscador de Ticker
    const searchInput = document.getElementById('inv-search-input');
    searchInput?.addEventListener('input', (e) => {
      this.#busqueda = e.target.value.trim();
      this.#filterAndRenderOperaciones();
    });

    // Switch Período Flujo (6M / 12M / Año actual)
    const periodSwitch = document.getElementById('inv-period-switch');
    periodSwitch?.addEventListener('click', (e) => {
      const btn = e.target.closest('.fintech-pill-btn');
      if (!btn) return;
      periodSwitch.querySelectorAll('.fintech-pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.#flowPeriod = btn.dataset.period;
      const subEl = document.getElementById('inv-moneyflow-sub');
      if (subEl) {
        if (this.#flowPeriod === '6M') subEl.textContent = 'Evolución histórica últimos 6 meses';
        else if (this.#flowPeriod === '12M') subEl.textContent = 'Evolución histórica últimos 12 meses';
        else subEl.textContent = 'Evolución acumulada año actual';
      }
      this.#renderMoneyFlowChart();
    });

    // Único Botón Contextual Primario
    const btnNuevo = document.getElementById('inv-btn-nuevo');
    btnNuevo?.addEventListener('click', () => {
      this.#abrirModalAlta('COMPRA');
    });
  }

  _subscribeEvents() {
    App.Events.on('store:cuenta-changed', () => {
      this.destruir();
      this.cargar();
    });
  }

  // --- SECCIÓN 9: HELPERS ---

  #abrirModalDetalle(row) {
    const isCompra = row.tipo_op === 'COMPRA';
    const clr = isCompra ? 'var(--verde)' : '#3b82f6';
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
          <strong>${Number(row.cantidad || 0).toLocaleString('es-AR')}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--borde);">
          <span style="color:var(--texto-2)">Precio Compra</span>
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
        } finally {
          m.close();
        }
      }
    });
  }

  #mostrarKpiSkeletons() {
    const valValorEl = document.getElementById('inv-kpi-val-valor');
    const valCostoEl = document.getElementById('inv-kpi-val-costo');
    const valResultEl = document.getElementById('inv-kpi-val-result');
    const valRendEl = document.getElementById('inv-kpi-val-rend');
    if (valValorEl) valValorEl.textContent = '...';
    if (valCostoEl) valCostoEl.textContent = '...';
    if (valResultEl) valResultEl.textContent = '...';
    if (valRendEl) valRendEl.textContent = '...';
  }
}

// --- REGISTRO ---

App.log('module-inversiones', 'init', 'InversionesModule registrado');