'use strict';
import Chart from 'chart.js/auto';
/* ============================================================
   module-cc.js — v6.0.0 (FinSet Design)
   Módulo Cuenta Corriente (gastos compartidos).
   Extiende BaseModule. Arquitectura FinSet de 3 filas.
   ============================================================ */

// --- SECCIÓN 0: CLASE CCModule ---

export class CCModule extends BaseModule {

  get moduleId() { return 'cc'; }
  get vistaId()  { return 'vista-cc'; }

  get _createEndpoint() { return 'api_createConsumoCC'; }
  get _updateEndpoint() { return 'api_updateConsumoCC'; }
  get _deleteEndpoint() { return 'api_deleteConsumoCC'; }

  #modal      = null;
  #categorias = [];
  #usuarios   = [];
  #editData   = null;
  #allConsumos = [];
  #moneyFlowPeriod = '6M';
  #consumosFilter = 'ALL'; // 'ALL' | 'YO' | 'OTRO'
  #consumosSearch = '';
  #categoriesChartInstance = null;
  #moneyFlowChartInstance = null;

  // --- SECCIÓN 1: CICLO DE VIDA ---

  init() {
    this.#modal = new App.Modal('modal-cc');
    this._buildVista();
    this._bindListeners();
    this._subscribeEvents();
    App.log('CCModule', 'init', 'Módulo CC iniciado');
  }

  async cargar() {
    if (App.Store.isModuloLoaded(this.moduleId)) return;
    const { cuenta, mes } = App.Store;
    if (!cuenta || !mes) return;

    const { fechaInicio, fechaFin } = this.#calcFechas(mes);

    try {
      const [resp, respUsers] = await Promise.all([
        App.API.swr(
          'api_getConsumosCC',
          [cuenta, fechaInicio, fechaFin],
          App.API.defaultTtl,
          (freshData) => { if (freshData && freshData.success) this._render(freshData); }
        ),
        App.API.call('api_admin_getCtaCorrienteUsuarios').catch(() => null)
      ]);

      if (respUsers?.success) {
        this.#usuarios = respUsers.data || [];
        window._appUsuariosCC = this.#usuarios;
      }

      this._render(resp.data);
      App.Store.markModuloLoaded(this.moduleId);
    } catch (err) {
      App.error('CCModule', 'cargar', 'Error', err);
      App.Toast.error('Error al cargar gastos compartidos: ' + err.message);
    }
  }

  // --- SECCIÓN 2: RENDER ---

  _render(data) {
    if (!data || !data.success) {
      App.Toast.error(data?.error || 'Error al obtener datos.');
      return;
    }

    const { kpis, consumos } = data;

    // Categorías y usuarios desde globales
    this.#categorias = (window._appCategorias && window._appCategorias.length > 0) ? window._appCategorias : this.#categorias;
    this.#usuarios = window._appUsuariosCC || [];
    this.#allConsumos = consumos || [];

    // Scorecards FinSet
    const gastoYo = Number(kpis?.gastoYo || 0);
    const gastoOtro = Number(kpis?.gastoOtro || 0);
    const saldoNeto = Number(kpis?.saldoNeto || 0);
    const totalCompartido = gastoYo + gastoOtro;

    // 1. Mis Gastos
    const valYoEl = document.getElementById('cc-kpi-val-yo');
    if (valYoEl) valYoEl.textContent = App.Utils.formatearMoneda(gastoYo);

    // 2. Sus Gastos
    const valOtroEl = document.getElementById('cc-kpi-val-otro');
    if (valOtroEl) valOtroEl.textContent = App.Utils.formatearMoneda(gastoOtro);

    // 3. Saldo Neto
    const valNetoEl = document.getElementById('cc-kpi-val-neto');
    const pillNetoEl = document.getElementById('cc-kpi-pill-neto');
    const subNetoEl = document.getElementById('cc-kpi-sub-neto');
    if (valNetoEl) {
      valNetoEl.textContent = App.Utils.formatearMoneda(Math.abs(saldoNeto));
      valNetoEl.className = 'finset-kpi-value ' + (saldoNeto > 0 ? 'positivo' : (saldoNeto < 0 ? 'negativo' : ''));
    }
    if (pillNetoEl) {
      if (saldoNeto > 0) {
        pillNetoEl.className = 'finset-trend-pill trend-up';
        pillNetoEl.innerHTML = '<span>A favor</span>';
      } else if (saldoNeto < 0) {
        pillNetoEl.className = 'finset-trend-pill trend-down';
        pillNetoEl.innerHTML = '<span>En contra</span>';
      } else {
        pillNetoEl.className = 'finset-trend-pill trend-neutral';
        pillNetoEl.innerHTML = '<span>Equilibrado</span>';
      }
    }
    if (subNetoEl) {
      subNetoEl.textContent = saldoNeto > 0 ? 'Te deben' : (saldoNeto < 0 ? 'Debes liquidar' : 'Cuentas al día');
    }

    // 4. Total Compartido & Subcards
    const valTotalEl = document.getElementById('cc-kpi-val-total');
    if (valTotalEl) valTotalEl.textContent = App.Utils.formatearMoneda(totalCompartido);

    const subTotalEl = document.getElementById('cc-subcard-total');
    if (subTotalEl) subTotalEl.textContent = App.Utils.formatearMoneda(totalCompartido);

    const subLiqEl = document.getElementById('cc-subcard-liquidacion');
    if (subLiqEl) {
      if (saldoNeto > 0) {
        subLiqEl.innerHTML = `<span style="color:var(--verde);font-weight:700;">+${App.Utils.formatearMoneda(saldoNeto)}</span> (A favor)`;
      } else if (saldoNeto < 0) {
        subLiqEl.innerHTML = `<span style="color:var(--rojo);font-weight:700;">-${App.Utils.formatearMoneda(Math.abs(saldoNeto))}</span> (A pagar)`;
      } else {
        subLiqEl.innerHTML = `<span style="color:var(--texto-2);font-weight:700;">$ 0,00</span> (Al día)`;
      }
    }

    const subContEl = document.getElementById('cc-subcard-contactos');
    if (subContEl) {
      const distinctUsers = new Set(this.#allConsumos.map(c => c.contacto_nombre || c.usuario_nombre).filter(Boolean));
      subContEl.textContent = distinctUsers.size > 0 ? `${distinctUsers.size} activos` : 'Sin contactos';
    }

    this.#filterConsumos();
    this.#renderMoneyFlowChart();
    this.#renderGraficos();
    App.log('CCModule', '_render', `${this.#allConsumos.length} gastos CC`);
  }

  // --- SECCIÓN 3: BUILD DOM ---

  _buildVista() {
    const vista = document.getElementById(this.vistaId);
    if (!vista) return;

    vista.innerHTML = `
      <!-- ═══ ROW 1: SCORECARDS FINSET (3 Columns) ═══ -->
      <div class="finset-kpi-grid" id="cc-scorecards-grid" style="margin-bottom: 24px;">
        
        <!-- Card 1: Mis Gastos -->
        <div class="finset-kpi-card" id="cc-card-kpi-yo">
          <div class="finset-kpi-header">
            <div class="finset-kpi-title-wrap">
              <div class="finset-kpi-icon icon-blue">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 12V8H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>
              </div>
              <span class="finset-kpi-title">Mis Gastos</span>
            </div>
            <button class="finset-arrow-btn" id="cc-btn-filter-yo" title="Ver mis gastos">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <div class="finset-kpi-value" id="cc-kpi-val-yo">$ 0,00</div>
          <div class="finset-kpi-footer">
            <span class="finset-kpi-subtext">Aportado por mí este mes</span>
            <span class="finset-trend-pill trend-up"><span>Aportado</span></span>
          </div>
        </div>

        <!-- Card 2: Sus Gastos -->
        <div class="finset-kpi-card" id="cc-card-kpi-otro">
          <div class="finset-kpi-header">
            <div class="finset-kpi-title-wrap">
              <div class="finset-kpi-icon icon-purple">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <span class="finset-kpi-title">Sus Gastos</span>
            </div>
            <button class="finset-arrow-btn" id="cc-btn-filter-otro" title="Ver sus gastos">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <div class="finset-kpi-value" id="cc-kpi-val-otro">$ 0,00</div>
          <div class="finset-kpi-footer">
            <span class="finset-kpi-subtext">Aportado por contacto</span>
            <span class="finset-trend-pill trend-neutral"><span>Contacto</span></span>
          </div>
        </div>

        <!-- Card 3: Saldo Neto -->
        <div class="finset-kpi-card" id="cc-card-kpi-neto">
          <div class="finset-kpi-header">
            <div class="finset-kpi-title-wrap">
              <div class="finset-kpi-icon icon-green">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>
              </div>
              <span class="finset-kpi-title">Saldo Neto</span>
            </div>
          </div>
          <div class="finset-kpi-value" id="cc-kpi-val-neto">$ 0,00</div>
          <div class="finset-kpi-footer">
            <span class="finset-kpi-subtext" id="cc-kpi-sub-neto">Diferencia a liquidar</span>
            <span class="finset-trend-pill trend-neutral" id="cc-kpi-pill-neto"><span>Equilibrado</span></span>
          </div>
        </div>

      </div>

      <!-- ═══ ROW 2: ANALYTICS & INSIGHTS (Money Flow + Top Categorías) ═══ -->
      <div class="finset-grid-2col" style="margin-bottom: 24px;">
        
        <!-- Left (60%): Evolución Mensual de Gastos Compartidos -->
        <div class="finset-card" id="cc-widget-moneyflow">
          <div class="finset-card-header">
            <div class="finset-card-title-wrap">
              <h3 class="finset-card-title">Flujo de Fondos Compartidos</h3>
              <span class="finset-card-subtitle" id="cc-moneyflow-sub">Evolución histórica últimos 6 meses</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <div class="fintech-pill-switch" id="cc-period-switch">
                <button class="fintech-pill-btn active" data-period="6M">6M</button>
                <button class="fintech-pill-btn" data-period="12M">12M</button>
                <button class="fintech-pill-btn" data-period="YTD">Año actual</button>
              </div>
            </div>
          </div>
          <div style="position:relative; width:100%; height:230px; margin: 4px 0;">
            <canvas id="cc-moneyflow-canvas"></canvas>
          </div>
          <div class="finset-chart-summary" id="cc-moneyflow-summary"></div>
        </div>

        <!-- Right (40%): Top Categorías Compartidas (FinSet Side-by-Side) -->
        <div class="finset-card" id="cc-widget-categories">
          <div class="finset-card-header">
            <div class="finset-card-title-wrap">
              <h3 class="finset-card-title">Top Categorías</h3>
              <span class="finset-card-subtitle" id="cc-categories-subtitle">Distribución de gastos conjuntos</span>
            </div>
          </div>
          <div class="finset-categories-side-wrap">
            <div class="fintech-legend-list" id="cc-categories-legend" style="margin-top:0;"></div>
            <div class="fintech-donut-wrapper" style="height:180px; margin:0;">
              <canvas id="cc-categories-donut-canvas"></canvas>
              <div class="fintech-donut-center" id="cc-categories-donut-center">
                <span class="fintech-donut-center-label">Total Conjunto</span>
                <span class="fintech-donut-center-val" id="cc-donut-center-val" style="font-size:1.05rem;">$ 0,00</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- ═══ ROW 3: OPERATIONS & DRILLDOWN (Grilla 60% + Liquidación 40%) ═══ -->
      <div class="finset-grid-2col" style="margin-bottom: 24px;">
        
        <!-- Left (60%): Grilla de Gastos (Mismo ancho que Movimientos) -->
        <div class="finset-card" id="cc-widget-consumos">
          <div class="finset-card-header" style="flex-wrap:wrap; gap:12px; align-items:center;">
            <div class="dh-drilldown-left" style="min-width:200px;">
              <div class="dh-drilldown-badge badge-all" id="cc-consumos-badge">
                <span class="dh-badge-dot"></span>
                <span class="dh-badge-title" id="cc-consumos-title">Todos los Gastos Compartidos</span>
              </div>
              <div class="dh-drilldown-summary" id="cc-consumos-summary">—</div>
            </div>

            <div class="finset-card-actions" style="margin-left:auto; gap:10px; align-items:center;">
              <div class="dh-filter-tabs" id="cc-consumos-tabs">
                <button class="dh-tab-btn active" data-filter="ALL" id="cc-tab-all">Todos</button>
                <button class="dh-tab-btn" data-filter="YO" id="cc-tab-yo">Pagué Yo</button>
                <button class="dh-tab-btn" data-filter="OTRO" id="cc-tab-otro">Pagó Contacto</button>
              </div>

              <div class="dh-search-box" style="margin:0;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" id="cc-consumos-search" placeholder="Buscar gasto..." class="finset-search-input" style="width:140px;">
              </div>

              <button class="btn btn-primary btn-sm" id="cc-btn-nuevo" style="display:inline-flex;align-items:center;gap:6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                <span>Nuevo Gasto</span>
              </button>
            </div>
          </div>

          <!-- Lista de gastos interactiva estilo movimientos -->
          <div class="dh-drilldown-list dh-side-main" id="cc-consumos-list" style="margin-top:12px; max-height:510px; overflow-y:auto; padding-right:4px;">
          </div>
        </div>

        <!-- Right (40%): Panel de Liquidación & Contactos -->
        <div class="finset-card" id="cc-widget-side-panel">
          <div class="finset-card-header" style="justify-content:space-between; align-items:center;">
            <div class="finset-card-title-wrap">
              <h3 class="finset-card-title">Liquidación & Contactos</h3>
              <span class="finset-card-subtitle">Balances y cuentas claras</span>
            </div>
          </div>

          <div class="finset-modules-stack" style="margin-top: 10px;">
            <!-- 1. Total Compartido -->
            <div class="finset-submodule-card">
              <div class="fsc-header">
                <div class="fsc-tag-wrap">
                  <div class="fsc-icon-box icon-yellow">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
                  </div>
                  <div class="fsc-text-block">
                    <div class="fsc-title">Total Compartido</div>
                    <div class="fsc-sub">Volumen total conjunto</div>
                  </div>
                </div>
                <div class="fsc-right-block">
                  <span class="fsc-value" id="cc-subcard-total">$ 0,00</span>
                </div>
              </div>
            </div>

            <!-- 2. Estado de Liquidación -->
            <div class="finset-submodule-card">
              <div class="fsc-header">
                <div class="fsc-tag-wrap">
                  <div class="fsc-icon-box icon-green">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>
                  </div>
                  <div class="fsc-text-block">
                    <div class="fsc-title">Estado de Liquidación</div>
                    <div class="fsc-sub">Balance neto del período</div>
                  </div>
                </div>
                <div class="fsc-right-block">
                  <span class="fsc-value" id="cc-subcard-liquidacion" style="font-size:0.85rem;">Al día</span>
                </div>
              </div>
            </div>

            <!-- 3. Contactos Activos -->
            <div class="finset-submodule-card">
              <div class="fsc-header">
                <div class="fsc-tag-wrap">
                  <div class="fsc-icon-box icon-purple">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  </div>
                  <div class="fsc-text-block">
                    <div class="fsc-title">Contactos con División</div>
                    <div class="fsc-sub">Personas involucradas</div>
                  </div>
                </div>
                <div class="fsc-right-block">
                  <span class="fsc-value" id="cc-subcard-contactos">0 activos</span>
                </div>
              </div>
            </div>
          </div>
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
      titulo      : 'Nuevo gasto compartido',
      icono       : 'users',
      body        : this.#buildFormHtml(null),
      confirmLabel: 'Guardar',
      onConfirm   : (m) => this.#guardar(m)
    });
    this.#bindFormListeners();
  }

  #abrirModalEdicion(row) {
    this.#editData = row;
    this.#modal.open({
      titulo      : 'Editar gasto compartido',
      icono       : 'edit',
      body        : this.#buildFormHtml(row),
      confirmLabel: 'Actualizar',
      onConfirm   : (m) => this.#guardar(m)
    });
    this.#bindFormListeners();
  }

  #buildFormHtml(data) {
    const optsC = this.#categorias
      .filter(c => c.activa)
      .map(c => `<option value="${c.id_categoria}" ${data?.id_categoria === c.id_categoria ? 'selected':''}>${App.Utils.escapeHtml(c.nombre)}</option>`)
      .join('');

    const otherUsers = this.#usuarios.filter(u => u.id_cuenta_principal === App.Store.cuenta && !u.es_yo && !u.nombre.toLowerCase().includes('(yo)'));
    const optsU = otherUsers
      .map(u => `<option value="${u.id_usuario}" ${data?.id_usuario === u.id_usuario ? 'selected':''}>${App.Utils.escapeHtml(u.nombre)}</option>`)
      .join('');

    const rawFecha  = data
      ? (data.fecha?.value || data.fecha || '').substring(0, 10)
      : new Date().toISOString().substring(0, 10);
    const tipoCons  = data?.tipo_consumo || 'COMUN';

    return `
      <form id="form-cc" class="form-grid">
        <input type="hidden" name="id_consumo" value="${data?.id_consumo_cc || ''}">

        <div class="form-group">
          <label>Fecha <span class="required-mark">*</span></label>
          <input class="input" type="date" name="fecha" value="${rawFecha}" required>
        </div>

        <div class="form-group">
          <label>Contacto (Cuenta Corriente) <span class="required-mark">*</span></label>
          <select class="input" name="id_usuario" required>
            <option value="">-- Seleccionar Contacto --</option>
            ${optsU}
          </select>
        </div>

        <div class="form-group">
          <label>Quién pagó el gasto? <span class="required-mark">*</span></label>
          <select class="input" name="pagador" required>
            <option value="YO"   ${data?.pagador === 'YO'   || !data ? 'selected':''}>Lo pagué YO</option>
            <option value="OTRO" ${data?.pagador === 'OTRO' ? 'selected':''}>Lo pagó el Contacto</option>
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
          <select class="input" name="tipo_consumo" id="cc-tipo-consumo">
            <option value="COMUN"     ${tipoCons === 'COMUN'     ? 'selected':''}>Común</option>
            <option value="CUOTAS"    ${tipoCons === 'CUOTAS'    ? 'selected':''}>En cuotas</option>
            <option value="RECURRENTE"${tipoCons === 'RECURRENTE'? 'selected':''}>Recurrente</option>
          </select>
        </div>

        <div class="form-group full-width">
          <label>Descripción <span class="required-mark">*</span></label>
          <input class="input" type="text" name="descripcion"
                 value="${App.Utils.escapeHtml(data?.descripcion || '')}" required>
        </div>

        <div class="form-group">
          <label>Importe total <span class="required-mark">*</span></label>
          <input class="input" type="number" name="importe" min="0.01" step="0.01"
                 value="${data?.importe_total || ''}" required>
        </div>

        <div id="cc-cuotas-opts" class="form-group ${tipoCons !== 'CUOTAS' ? 'hidden' : ''}">
          <label>Cuota actual / Total</label>
          <div style="display:flex;gap:var(--space-2)">
            <input class="input" type="number" name="cuota_actual" min="1" value="${data?.cuota_actual || 1}" style="width:60px">
            <input class="input" type="number" name="cuota_total"  min="2" value="${data?.cuota_total  || 12}" style="width:60px">
          </div>
        </div>

        <div id="cc-recur-opts" class="form-group ${tipoCons !== 'RECURRENTE' ? 'hidden' : ''}">
          <label>Períodos</label>
          <input class="input" type="number" name="periodos" min="2" max="60" value="${data?.periodos || 12}">
        </div>

        <div class="form-group full-width">
          <label class="form-switch">
            <input type="checkbox" class="toggle-switch" name="usa_porcentaje"
                   id="cc-chk-porc" ${data?.usa_porcentaje ? 'checked' : ''}>
            <span>Usar porcentaje personalizado</span>
          </label>
        </div>
        <div id="cc-porc-opts" class="form-group full-width ${!data?.usa_porcentaje ? 'hidden' : ''}">
          <label>Mi porcentaje (%)</label>
          <input class="input" type="number" name="porcentaje_yo" min="1" max="99" value="${data?.porcentaje_yo || 50}">
        </div>
      </form>
    `;
  }

  #bindFormListeners() {
    const tipoSel = document.getElementById('cc-tipo-consumo');
    tipoSel?.addEventListener('change', () => {
      document.getElementById('cc-cuotas-opts')?.classList.toggle('hidden', tipoSel.value !== 'CUOTAS');
      document.getElementById('cc-recur-opts')?.classList.toggle('hidden', tipoSel.value !== 'RECURRENTE');
    });
    const chkPorc = document.getElementById('cc-chk-porc');
    chkPorc?.addEventListener('change', () => {
      document.getElementById('cc-porc-opts')?.classList.toggle('hidden', !chkPorc.checked);
    });
  }

  // --- SECCIÓN 5: CRUD ---

  async #guardar(modal) {
    const form = modal.getForm();
    if (!form) return;
    const fd = new FormData(form);
    const d  = {};
    fd.forEach((v, k) => { d[k] = v; });

    if (!d.fecha || !d.pagador || !d.id_categoria || !d.importe || Number(d.importe) <= 0) {
      App.Toast.warning('Completá todos los campos obligatorios.');
      return;
    }

    const payload = {
      idCuenta      : App.Store.cuenta,
      fecha         : d.fecha,
      idUsuario     : d.id_usuario,
      pagador       : d.pagador,
      idCategoria   : d.id_categoria,
      descripcion   : d.descripcion,
      importe       : Number(d.importe),
      tipoConsumo   : d.tipo_consumo || 'COMUN',
      cuotaActual   : Number(d.cuota_actual  || 1),
      cuotaTotal    : Number(d.cuota_total   || 1),
      periodos      : Number(d.periodos      || 12),
      usaPorcentaje : d.usa_porcentaje === 'on',
      porcentajeYo  : Number(d.porcentaje_yo || 50)
    };

    modal.setLoading(true);
    try {
      if (!this.#editData) {
        await this._handleCreate(payload, modal);
      } else {
        const req = {
          data    : payload,
          original: {
            consumoId   : this.#editData.id_consumo_cc,
            recurGroupId: this.#editData.recur_group_id || null,
            fecha       : this.#editData.fecha?.value || this.#editData.fecha
          },
          scope: 'SINGLE'
        };
        await this._handleUpdate(this.#editData.id_consumo_cc, req, modal);
      }
    } catch (_) {
      modal.setLoading(false);
    }
  }

  async #eliminar(row) {
    const confirmModal = new App.Modal('modal-cc-del-confirm');
    confirmModal.open({
      titulo      : 'Eliminar gasto',
      body        : `<p>¿Eliminar <strong>${App.Utils.escapeHtml(row.descripcion)}</strong>?</p>`,
      confirmLabel: 'Eliminar',
      danger      : true,
      onConfirm   : async () => {
        try {
          await this._handleDelete(row.id_consumo_cc);
          this.destruir();
          await this.cargar();
        } catch (_) {}
      }
    });
  }

  // --- SECCIÓN 6: LISTENERS ---

  _bindListeners() {
    const vista = document.getElementById(this.vistaId);
    if (!vista) return;

    vista.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      if (btn.id === 'cc-btn-nuevo') {
        this.#abrirModalAlta();
      } else if (btn.id === 'cc-btn-filter-yo') {
        this.#setFilter('YO');
      } else if (btn.id === 'cc-btn-filter-otro') {
        this.#setFilter('OTRO');
      }
    });

    // Filter tabs
    document.getElementById('cc-consumos-tabs')?.querySelectorAll('.dh-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.#setFilter(btn.dataset.filter || 'ALL');
      });
    });

    // Search input
    document.getElementById('cc-consumos-search')?.addEventListener('input', (e) => {
      this.#consumosSearch = e.target.value || '';
      this.#filterConsumos();
    });

    // Period switch for Money Flow
    document.getElementById('cc-period-switch')?.querySelectorAll('.fintech-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#cc-period-switch .fintech-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.#moneyFlowPeriod = btn.dataset.period || '6M';
        this.#renderMoneyFlowChart();
      });
    });
  }

  #setFilter(filterType) {
    this.#consumosFilter = filterType;
    document.querySelectorAll('#cc-consumos-tabs .dh-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === filterType);
    });
    this.#filterConsumos();
    document.getElementById('cc-widget-consumos')?.scrollIntoView({ behavior: 'smooth' });
  }

  // --- SECCIÓN 7: FILTRO Y RENDER DE GRILLA ---

  #filterConsumos() {
    let filtered = this.#allConsumos || [];

    if (this.#consumosFilter === 'YO') {
      filtered = filtered.filter(c => c.pagador === 'YO');
    } else if (this.#consumosFilter === 'OTRO') {
      filtered = filtered.filter(c => c.pagador !== 'YO');
    }

    if (this.#consumosSearch && this.#consumosSearch.trim()) {
      const q = this.#consumosSearch.trim().toLowerCase();
      filtered = filtered.filter(c => {
        const desc = (c.descripcion || '').toLowerCase();
        const cat = (c.categoria_nombre || '').toLowerCase();
        const pag = (c.pagador || '').toLowerCase();
        return desc.includes(q) || cat.includes(q) || pag.includes(q);
      });
    }

    const badgeTitleEl = document.getElementById('cc-consumos-title');
    const badgeEl = document.getElementById('cc-consumos-badge');
    const summaryEl = document.getElementById('cc-consumos-summary');

    if (badgeTitleEl) {
      if (this.#consumosFilter === 'YO') badgeTitleEl.textContent = 'Mis Gastos Aportados';
      else if (this.#consumosFilter === 'OTRO') badgeTitleEl.textContent = 'Gastos Aportados por Contacto';
      else badgeTitleEl.textContent = 'Todos los Gastos Compartidos';
    }
    if (badgeEl) {
      badgeEl.className = 'dh-drilldown-badge ' + (this.#consumosFilter === 'YO' ? 'badge-ing' : (this.#consumosFilter === 'OTRO' ? 'badge-recur' : 'badge-all'));
    }

    const totalDisplay = filtered.reduce((acc, c) => acc + Number(c.importe_total || c.importe || 0), 0);
    const miParteDisplay = filtered.reduce((acc, c) => acc + Number(c.mi_parte || 0), 0);

    if (summaryEl) {
      summaryEl.textContent = `${filtered.length} ${filtered.length === 1 ? 'gasto' : 'gastos'} • Total: ${App.Utils.formatearMoneda(totalDisplay)} (Mi parte: ${App.Utils.formatearMoneda(miParteDisplay)})`;
    }

    this.#renderConsumosList(filtered);
  }

  #renderConsumosList(items) {
    const listEl = document.getElementById('cc-consumos-list');
    if (!listEl) return;

    if (!items || items.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center; padding:3rem 1.5rem; color:var(--texto-3); font-size:0.875rem;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px; opacity:0.6;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          <div>No hay gastos compartidos registrados para el criterio seleccionado.</div>
        </div>
      `;
      return;
    }

    const getCatIconSvg = (catName) => {
      const cat = (catName || '').toLowerCase();
      if (cat.includes('super') || cat.includes('alimento') || cat.includes('comida')) {
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`;
      }
      if (cat.includes('serv') || cat.includes('luz') || cat.includes('gas') || cat.includes('internet')) {
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
      }
      if (cat.includes('auto') || cat.includes('combust') || cat.includes('viaje')) {
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`;
      }
      if (cat.includes('salud') || cat.includes('farmacia')) {
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`;
      }
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>`;
    };

    const rowsHtml = items.map(r => {
      const catName = r.categoria_nombre || 'General';
      const desc = r.descripcion || catName;
      const fechaStr = App.Utils.formatearFecha(r.fecha?.value || r.fecha);
      const isYo = r.pagador === 'YO';
      const pagadorLabel = isYo ? 'Pagué Yo' : (r.pagador_nombre || 'Contacto');
      const miParte = Number(r.mi_parte || 0);
      const impTotal = Number(r.importe_total || r.importe || 0);

      let badgesHtml = '';
      if (r.tipo_consumo === 'CUOTAS' || Number(r.cuota_total) > 1) {
        badgesHtml += `<span class="badge badge-recur" style="font-size:0.68rem; margin-left:4px;">Cuota ${r.cuota_actual || 1}/${r.cuota_total || 12}</span>`;
      } else if (r.tipo_consumo === 'RECURRENTE') {
        badgesHtml += `<span class="badge badge-recur" style="font-size:0.68rem; margin-left:4px;">Recurrente</span>`;
      }
      if (r.usa_porcentaje && r.porcentaje_yo) {
        badgesHtml += `<span class="badge badge-neutro" style="font-size:0.68rem; margin-left:4px;">${r.porcentaje_yo}%</span>`;
      }

      return `
        <div class="dh-drill-row" data-id="${r.id_consumo_cc}" style="cursor:pointer;">
          <div class="dh-col-main">
            <div class="dh-item-icon ${isYo ? 'icon-green' : 'icon-subtle'}">
              ${getCatIconSvg(catName)}
            </div>
            <div class="dh-col-desc-wrap">
              <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
                <span class="dh-row-desc">${App.Utils.escapeHtml(desc)}</span>
                ${badgesHtml}
              </div>
              <span class="dh-row-date">${fechaStr} • <span class="badge ${isYo ? 'badge-tc' : 'badge-recur'}" style="font-size:0.7rem;">${App.Utils.escapeHtml(pagadorLabel)}</span></span>
            </div>
          </div>
          <div class="dh-col-cat">
            <span class="dh-cat-pill">${App.Utils.escapeHtml(catName)}</span>
          </div>
          <div class="dh-col-medio" style="text-align:right;">
            <span style="font-size:0.75rem; color:var(--texto-3);">Total: ${App.Utils.formatearMoneda(impTotal)}</span>
          </div>
          <div class="dh-col-amount negativo" style="text-align:right;">
            <span style="display:block; font-size:0.9rem; font-weight:700;">${App.Utils.formatearMoneda(miParte)}</span>
            <span style="display:block; font-size:0.7rem; color:var(--texto-3); font-weight:500;">Mi parte</span>
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
      rowEl.addEventListener('click', () => {
        const id = rowEl.dataset.id;
        const row = this.#allConsumos.find(c => c.id_consumo_cc == id);
        if (row) this.#abrirModalDetalle(row);
      });
    });
  }

  // --- SECCIÓN 8: ANALYTICS CHARTS ---

  #renderMoneyFlowChart() {
    const canvas = document.getElementById('cc-moneyflow-canvas');
    if (!canvas) return;

    const currentMes = App.Store.mes || new Date().toISOString().substring(0, 7);
    const currentYear = currentMes.substring(0, 4);

    // Group monthly evolution of shared expenses from current dataset
    const monthMap = {};
    (this.#allConsumos || []).forEach(c => {
      const rawDate = c.fecha?.value || c.fecha || '';
      const m = rawDate.substring(0, 7) || currentMes;
      if (!monthMap[m]) monthMap[m] = { yo: 0, otro: 0, total: 0 };
      const imp = Number(c.importe_total || c.importe || 0);
      monthMap[m].total += imp;
      if (c.pagador === 'YO') monthMap[m].yo += imp;
      else monthMap[m].otro += imp;
    });

    // If only current month is in dataset, generate timeline with empty prior months
    const [cy, cm] = currentMes.split('-').map(Number);
    const months = [];
    const count = this.#moneyFlowPeriod === 'YTD' ? cm : (this.#moneyFlowPeriod === '12M' ? 12 : 6);

    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(cy, cm - 1 - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({
        mes: ym,
        yo: monthMap[ym]?.yo || 0,
        otro: monthMap[ym]?.otro || 0,
        total: monthMap[ym]?.total || (ym === currentMes ? (this.#allConsumos.reduce((a,b)=>a+Number(b.importe_total||b.importe||0),0)) : 0)
      });
    }

    const subEl = document.getElementById('cc-moneyflow-sub');
    if (subEl) {
      if (this.#moneyFlowPeriod === '6M') subEl.textContent = 'Evolución histórica últimos 6 meses';
      else if (this.#moneyFlowPeriod === '12M') subEl.textContent = 'Evolución histórica último año (12 meses)';
      else subEl.textContent = `Gastos compartidos del año en curso (${currentYear})`;
    }

    this.#moneyFlowChartInstance?.destroy();
    const ctx = canvas.getContext('2d');
    const labels = months.map(m => App.Utils.formatearMes(m.mes));

    this.#moneyFlowChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Mis Gastos',
            data: months.map(m => Math.round(m.yo)),
            backgroundColor: '#10B981',
            borderRadius: 4,
            barPercentage: 0.65,
            categoryPercentage: 0.8
          },
          {
            label: 'Sus Gastos',
            data: months.map(m => Math.round(m.otro)),
            backgroundColor: '#8B5CF6',
            borderRadius: 4,
            barPercentage: 0.65,
            categoryPercentage: 0.8
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { boxWidth: 10, font: { size: 10, family: 'Inter, sans-serif' } }
          },
          tooltip: {
            callbacks: {
              label: (context) => ` ${context.dataset.label}: $ ${context.parsed.y.toLocaleString('es-AR')}`
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

    const sumEl = document.getElementById('cc-moneyflow-summary');
    if (sumEl) {
      const sumYo = months.reduce((a, b) => a + b.yo, 0);
      const sumOtro = months.reduce((a, b) => a + b.otro, 0);
      const sumTotal = sumYo + sumOtro;
      sumEl.innerHTML = `
        <div class="finset-chart-summary-item">
          <span class="finset-chart-summary-label">Total Aportado Yo</span>
          <span class="finset-chart-summary-val positivo">${App.Utils.formatearMoneda(sumYo)}</span>
        </div>
        <div class="finset-chart-summary-item">
          <span class="finset-chart-summary-label">Total Aportado Contacto</span>
          <span class="finset-chart-summary-val">${App.Utils.formatearMoneda(sumOtro)}</span>
        </div>
        <div class="finset-chart-summary-item">
          <span class="finset-chart-summary-label">Total Acumulado (${this.#moneyFlowPeriod})</span>
          <span class="finset-chart-summary-val" style="font-weight:700;">${App.Utils.formatearMoneda(sumTotal)}</span>
        </div>
      `;
    }
  }

  #renderGraficos() {
    const canvas = document.getElementById('cc-categories-donut-canvas');
    const legendEl = document.getElementById('cc-categories-legend');
    const centerValEl = document.getElementById('cc-donut-center-val');

    const pool = this.#allConsumos || [];
    const totalMetric = pool.reduce((acc, c) => acc + Number(c.importe_total || c.importe || 0), 0);

    if (centerValEl) centerValEl.textContent = App.Utils.formatearMoneda(totalMetric);

    if (!pool.length || totalMetric <= 0) {
      this.#categoriesChartInstance?.destroy();
      if (legendEl) {
        legendEl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--texto-3);font-size:0.85rem;">No hay registros compartidos en este período</div>`;
      }
      return;
    }

    const catMap = {};
    pool.forEach(c => {
      const cat = c.categoria_nombre || 'General';
      const imp = Number(c.importe_total || c.importe || 0);
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
              <span style="font-size:0.82rem;font-weight:600;color:var(--texto);">${App.Utils.formatearMoneda(cat.total)}</span>
            </div>
          </div>
        `;
      }).join('');
    }

    if (canvas) {
      this.#categoriesChartInstance?.destroy();
      const ctx = canvas.getContext('2d');
      this.#categoriesChartInstance = new Chart(ctx, {
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

  // --- SECCIÓN 9: DETAIL MODAL & HELPERS ---

  #abrirModalDetalle(row) {
    const badges = [];
    if (row.tipo_consumo === 'CUOTAS')     badges.push(`<span class="badge badge-recur">Cuota ${row.cuota_actual}/${row.cuota_total}</span>`);
    if (row.tipo_consumo === 'RECURRENTE') badges.push('<span class="badge badge-recur">Recurrente</span>');

    const miParte = Number(row.mi_parte || 0);
    const importeTotal = Number(row.importe_total || row.importe || 0);
    const isYo = row.pagador === 'YO';

    const detailModal = new App.Modal('modal-cc-detail');
    detailModal.open({
      titulo: row.descripcion,
      icono: 'users',
      size: 'md',
      body: `
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">Importe Total</span>
            <span class="detail-value detail-amount">${App.Utils.formatearMoneda(importeTotal)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Mi Parte</span>
            <span class="detail-value detail-amount negativo">${App.Utils.formatearMoneda(miParte)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Fecha</span>
            <span class="detail-value">${App.Utils.formatearFecha(row.fecha?.value || row.fecha)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Pagador</span>
            <span class="detail-value"><span class="badge ${isYo ? 'badge-tc' : 'badge-recur'}">${isYo ? 'Pagué Yo' : (row.pagador_nombre || 'Contacto')}</span></span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Categoría</span>
            <span class="detail-value">${App.Utils.escapeHtml(row.categoria_nombre || 'General')}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Etiquetas</span>
            <span class="detail-value">${badges.length > 0 ? badges.join(' ') : '<span style="color:var(--texto-3)">Ninguna</span>'}</span>
          </div>
        </div>
        <div class="detail-actions">
          <button class="btn btn-ghost" id="detail-cc-edit">${App.Icons.get('edit', 'icon-sm')} Editar</button>
          <button class="btn btn-danger" id="detail-cc-delete">${App.Icons.get('delete', 'icon-sm')} Eliminar</button>
        </div>
      `,
      confirmLabel: '',
      cancelLabel: 'Cerrar'
    });
    const cb = detailModal.el.querySelector('.modal-confirm');
    if (cb) cb.style.display = 'none';

    document.getElementById('detail-cc-edit')?.addEventListener('click', () => {
      detailModal.close();
      this.#abrirModalEdicion(row);
    });
    document.getElementById('detail-cc-delete')?.addEventListener('click', () => {
      detailModal.close();
      this.#eliminar(row);
    });
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

App.log('module-cc', 'init', 'CCModule registrado');