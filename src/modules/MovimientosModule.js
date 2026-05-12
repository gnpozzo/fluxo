'use strict';
/* ============================================================
   module-movimientos.html — v5.1.0
   Módulo Ingresos / Egresos.
   Extiende BaseModule. Carga lazy con cache sessionStorage.
   ============================================================ */

// --- SECCIÓN 0: CLASE MovimientosModule ---

export class MovimientosModule extends BaseModule {

  // ── Identidad ─────────────────────────────────────────────
  get moduleId() { return 'movimientos'; }
  get vistaId()  { return 'vista-movimientos'; }

  // ── Endpoints GAS ─────────────────────────────────────────
  get _createEndpoint() { return 'api_createMovimiento'; }
  get _updateEndpoint() { return 'api_updateMovimiento'; }
  get _deleteEndpoint() { return 'api_deleteMovimiento'; }

  // ── Estado interno ─────────────────────────────────────────
  #categorias  = [];
  #cuentas     = [];
  #table       = null;
  #kpiIngresos = null;
  #kpiEgresos  = null;
  #kpiResult   = null;
  #modal       = null;
  #editData    = null;

  // --- SECCIÓN 1: CICLO DE VIDA ---

  init() {
    this.#modal = new App.Modal('modal-movimientos');
    this._buildVista();
    this._bindListeners();
    this._subscribeEvents();
    App.log('MovimientosModule', 'init', 'Módulo iniciado');
  }

  async cargar() {
    if (App.Store.isModuloLoaded(this.moduleId)) return;

    const { cuenta, mes } = App.Store;
    if (!cuenta || !mes) return;

    const { fechaInicio, fechaFin } = this.#calcFechas(mes);
    const cuentaObj      = App.Store.cuentas.find(c => c.id_cuenta_principal === cuenta);
    const requiereAjuste = cuentaObj?.requiere_ajuste_cc_tc ?? false;

    this.#mostrarKpiSkeletons();
    this.#table?.showSkeleton(6);

    try {
      const resp = await App.API.swr(
        'api_getDashboardData',
        [cuenta, fechaInicio, fechaFin, requiereAjuste],
        App.API.defaultTtl,
        (freshData) => { if (freshData && freshData.success) this._render(freshData); }
      );
      this._render(resp.data);
      App.Store.markModuloLoaded(this.moduleId);
    } catch (err) {
      App.error('MovimientosModule', 'cargar', 'Error al cargar datos', err);
      App.Toast.error('Error al cargar movimientos: ' + (err.message || 'Error desconocido'));
    }
  }

  // --- SECCIÓN 2: RENDER ---

  _render(data) {
    if (!data || !data.success) {
      App.Toast.error(data?.error || 'Error al obtener datos.');
      return;
    }

    const { kpis, movimientos } = data;

    // Categorías y cuentas desde el estado global
    if (!this.#categorias.length) this.#categorias = window._appCategorias || [];
    if (!this.#cuentas.length)    this.#cuentas    = App.Store.cuentas     || [];

    // KPIs
    this.#kpiIngresos?.setValue(kpis.ingresos);
    this.#kpiEgresos?.setValue(kpis.egresos);
    this.#kpiResult?.setValue(kpis.resultado, {
      invertido: kpis.resultado < 0
    });

    // Tabla
    this.#table?.load(movimientos || []);
    App.log('MovimientosModule', '_render', `${(movimientos || []).length} movimientos`);
  }

  // --- SECCIÓN 3: BUILD DOM ---

  _buildVista() {
    const vista = document.getElementById(this.vistaId);
    if (!vista) return;

    vista.innerHTML = `
      <!-- KPIs -->
      <div class="kpi-grid" id="mov-kpi-grid"></div>

      <!-- Acciones -->
      <div class="section-header" style="margin-bottom:var(--space-3)">
        <div class="acciones-container" id="mov-acciones"></div>
        <div class="dt-search" id="mov-search-wrap">
          ${App.Icons.get('search', 'icon-sm')}
          <input id="mov-search" class="input" type="text"
                 placeholder="Buscar movimiento..." style="min-width:220px">
        </div>
      </div>

      <!-- Tabla -->
      <div class="table-card" id="mov-tabla-wrap"></div>
    `;

    // KPI Cards
    const grid = document.getElementById('mov-kpi-grid');
    this.#kpiIngresos = new App.KpiCard(grid, {
      titulo    : 'Ingresos',
      icono     : 'trending_up',
      colorClass: 'kpi-green',
      onFormat  : App.Utils.formatearMoneda
    });
    this.#kpiEgresos  = new App.KpiCard(grid, {
      titulo    : 'Egresos',
      icono     : 'trending_down',
      colorClass: 'kpi-red',
      onFormat  : (v) => App.Utils.formatearMoneda(Math.abs(v))
    });
    this.#kpiResult   = new App.KpiCard(grid, {
      titulo    : 'Resultado',
      icono     : 'scale',
      colorClass: 'kpi-blue',
      onFormat  : App.Utils.formatearMoneda
    });

    // Botones de acción eliminados en favor del FAB global
    const acciones = document.getElementById('mov-acciones');
    acciones.innerHTML = '';

    // DataTable
    this.#table = new App.DataTable(
      document.getElementById('mov-tabla-wrap'),
      {
        columns: [
          { key: 'fecha',           label: 'Fecha',      sortable: true,
            render: (r) => App.Utils.formatearFecha(r.fecha?.value || r.fecha) },
          { key: 'tipo_mov',        label: 'Tipo',
            render: (r) => `<span class="tipo-mov tipo-${r.tipo_mov?.toLowerCase()}">${App.Utils.escapeHtml(r.tipo_mov)}</span>` },
          { key: 'categoria_nombre',label: 'Categoría',  sortable: true,
            render: (r) => App.Utils.escapeHtml(r.categoria_nombre || 'General') },
          { key: 'descripcion',     label: 'Descripción', searchable: true,
            render: (r) => this.#renderDescripcion(r) },
          { key: 'importe',         label: 'Importe',    sortable: true, align: 'right',
            render: (r) => `<span class="${r.tipo_mov === 'EGRESO' ? 'negativo' : 'positivo'}">${App.Utils.formatearMoneda(r.importe)}</span>` }
        ],
        emptyMsg  : 'No hay movimientos para este período.',
        searchable: false,
        paginated : true,
        pageSize  : 25,
        onRowClick: ({ row }) => this.#abrirModalDetalle(row)
      }
    );
  }

  // --- SECCIÓN 4: MODAL ALTA/EDICIÓN ---
  
  abrirAlta(tipo) {
    this.#abrirModalAlta(tipo);
  }

  #abrirModalAlta(tipo) {
    this.#editData = null;
    const esIngreso = tipo === 'INGRESO';

    this.#modal.open({
      titulo      : esIngreso ? 'Nuevo Ingreso' : 'Nuevo Egreso',
      icono       : esIngreso ? 'trending_up' : 'trending_down',
      body        : this.#buildFormHtml(tipo, null),
      confirmLabel: esIngreso ? 'Guardar Ingreso' : 'Registrar Gasto',
      danger      : !esIngreso,
      size        : 'md',
      onConfirm   : (modal) => this.#guardar(modal)
    });
    this.#postOpenForm();
  }

  #abrirModalEdicion(row) {
    this.#editData = row;
    const tipo     = row.tipo_mov;
    const esIngreso = tipo === 'INGRESO';

    this.#modal.open({
      titulo      : 'Editar Movimiento',
      icono       : 'edit',
      body        : this.#buildFormHtml(tipo, row),
      confirmLabel: esIngreso ? 'Actualizar Ingreso' : 'Actualizar Gasto',
      danger      : !esIngreso,
      size        : 'md',
      onConfirm   : (modal) => this.#guardar(modal)
    });
    this.#postOpenForm();
  }

  #buildFormHtml(tipo, data) {
    const esIngreso = tipo === 'INGRESO';
    const colorClass = esIngreso ? 'monto-ingreso' : 'monto-egreso';
    const sign       = esIngreso ? '+' : '−';

    const categoriasFiltradas = this.#categorias
      .filter(c => c.tipo_mov === tipo && c.activa);

    const usuariosCC = window._appUsuariosCC || [];
    const optsU = usuariosCC
      .map(u => `<option value="${u.id_usuario}">${App.Utils.escapeHtml(u.nombre)}</option>`)
      .join('');

    const optsCateg = categoriasFiltradas
      .map(c => `<option value="${c.id_categoria}"
        ${data?.id_categoria === c.id_categoria ? 'selected' : ''}>
        ${App.Utils.escapeHtml(c.nombre)}
      </option>`)
      .join('');

    const rawFecha = data
      ? (data.fecha?.value || data.fecha || '').substring(0, 10)
      : new Date().toISOString().substring(0, 10);

    const importeVal = data?.importe || '';

    // Segunda columna del formulario varía según tipo
    const segundaColumna = esIngreso
      ? `<div class="form-group">
           <label>Cuenta de Destino</label>
           <select class="input" name="medio_pago">
             <option value="transferencia" ${data?.medio_pago === 'transferencia' || !data ? 'selected':''}>Cuenta Bancaria</option>
             <option value="efectivo"      ${data?.medio_pago === 'efectivo'      ? 'selected':''}>Efectivo</option>
             <option value="debito"        ${data?.medio_pago === 'debito'        ? 'selected':''}>Débito</option>
           </select>
         </div>`
      : `<div class="form-group">
           <label>Método de Pago</label>
           <select class="input" name="medio_pago">
             <option value="transferencia" ${data?.medio_pago === 'transferencia' || !data ? 'selected':''}>Transferencia</option>
             <option value="efectivo"      ${data?.medio_pago === 'efectivo'      ? 'selected':''}>Efectivo</option>
             <option value="debito"        ${data?.medio_pago === 'debito'        ? 'selected':''}>Débito</option>
             <option value="credito"       ${data?.medio_pago === 'credito'       ? 'selected':''}>Tarjeta Crédito</option>
           </select>
         </div>`;

    return `
      <form id="form-movimiento" class="form-grid">
        <input type="hidden" name="tipo" value="${tipo}">
        <input type="hidden" name="id_movimiento" value="${data?.id_movimiento || ''}">

        <!-- Fila 1: Monto (grande) + Fecha -->
        <div class="form-group ${colorClass}">
          <label>Monto <span class="required-mark">*</span></label>
          <div class="form-monto-wrap ${colorClass}">
            <span class="form-monto-sign">${sign}</span>
            <input class="input form-monto ${colorClass}" type="number"
                   name="importe" min="0.01" step="0.01"
                   value="${importeVal}" placeholder="0.00" required>
            <span class="form-monto-icon">$</span>
          </div>
        </div>

        <div class="form-group">
          <label>Fecha <span class="required-mark">*</span></label>
          <input class="input" type="date" name="fecha" value="${rawFecha}" required>
        </div>

        <!-- Fila 2: Categoría + Medio de pago / Cuenta destino -->
        <div class="form-group">
          <label>Categoría <span class="required-mark">*</span></label>
          <select class="input" name="id_categoria" required>
            <option value="">— Seleccionar —</option>
            ${optsCateg}
          </select>
        </div>

        ${segundaColumna}

        <!-- Fila 3: Descripción (ancho completo) -->
        <div class="form-group full-width">
          <label>Descripción <span class="required-mark">*</span></label>
          <textarea class="input" name="descripcion" rows="3"
                    placeholder="${esIngreso ? 'Sueldo del mes, proyecto web...' : 'Cena con amigos, expensas...'}"
                    style="resize:vertical"
                    required>${App.Utils.escapeHtml(data?.descripcion || '')}</textarea>
        </div>

        ${!data ? `
        <!-- Opciones adicionales solo en alta -->
        <div class="form-group full-width">
          <label>Tipo de repetición</label>
          <select class="input" name="tipo_consumo" id="mov-tipo-consumo">
            <option value="COMUN">Única vez (Contado)</option>
            <option value="CUOTAS">En Cuotas</option>
            <option value="RECURRENTE">Recurrente</option>
          </select>
        </div>

        <div id="mov-cuotas-opts" class="form-group full-width hidden">
          <label>Cuota actual / Total</label>
          <div style="display:flex;gap:var(--space-2)">
            <input class="input" type="number" name="cuota_actual" min="1" value="1" style="width:70px">
            <input class="input" type="number" name="cuota_total"  min="2" value="12" style="width:70px">
          </div>
        </div>

        <div id="mov-recur-opts" class="form-group full-width hidden">
          <label>Cantidad de períodos adicionales</label>
          <input class="input" type="number" name="periodos" min="2" max="120" value="12">
        </div>
        ${esIngreso ? `
        <div class="form-group full-width">
          <label class="form-switch">
            <input type="checkbox" class="toggle-switch" name="es_split" id="chk-split">
            <span style="font-size:.85rem;font-weight:500;color:var(--texto);text-transform:none;letter-spacing:0">Dividir entre cuentas (Split)</span>
          </label>
        </div>
        <div id="split-opts" class="form-group full-width hidden">
          <div class="form-grid" style="gap:var(--space-3); margin-bottom: var(--space-2);">
            <div class="form-group">
              <label>Cuenta de Distribución 1</label>
              <select class="input" name="split_cuenta_destino_1">
                <option value="">-- Ninguna --</option>
                ${this.#cuentas.filter(c => c.id_cuenta_principal !== App.Store.cuenta).map(c => `<option value="${c.id_cuenta_principal}">${App.Utils.escapeHtml(c.nombre)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Porcentaje (%) Destino 1</label>
              <input class="input" type="number" name="split_porcentaje_1" min="1" max="99" value="40">
            </div>
          </div>
          <div class="form-grid" style="gap:var(--space-3)">
            <div class="form-group">
              <label>Cuenta de Distribución 2</label>
              <select class="input" name="split_cuenta_destino_2">
                <option value="">-- Ninguna --</option>
                ${this.#cuentas.filter(c => c.id_cuenta_principal !== App.Store.cuenta).map(c => `<option value="${c.id_cuenta_principal}">${App.Utils.escapeHtml(c.nombre)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Porcentaje (%) Destino 2</label>
              <input class="input" type="number" name="split_porcentaje_2" min="1" max="99" value="">
            </div>
          </div>
          <p style="font-size:0.8rem;color:var(--texto-3);margin-top:4px;">El remanente (hasta completar 100%) quedará en la cuenta actual.</p>
        </div>` : `
        <div class="form-group full-width">
          <label class="form-switch">
            <input type="checkbox" class="toggle-switch" name="compartir" id="mov-chk-compartir">
            <span style="font-size:.85rem;font-weight:500;color:var(--texto);text-transform:none;letter-spacing:0">Compartir gasto</span>
          </label>
        </div>
        <div id="mov-compartir-opts" class="form-group full-width hidden">
           <div class="form-grid" style="gap:var(--space-3)">
             <div class="form-group">
               <label>Contacto <span class="required-mark">*</span></label>
               <select class="input" name="compartir_contacto">
                 <option value="">-- Seleccionar --</option>
                 ${optsU}
               </select>
             </div>
             <div class="form-group">
               <label>Mi porcentaje asumido (%)</label>
               <input class="input" type="number" name="compartir_porcentaje" min="1" max="99" value="50">
             </div>
           </div>
           <p style="font-size:0.8rem;color:var(--texto-3);margin-top:4px;margin-bottom:0">Se descontará el porcentaje restante como deuda a cobrar en Gastos Compartidos con el contacto seleccionado.</p>
        </div>
        `}
        ` : '<!-- Edición: sin opciones de serie -->'}
      </form>
    `;
  }

  #postOpenForm() {
    const selTipoConsumo = document.getElementById('mov-tipo-consumo');
    if (selTipoConsumo) {
      selTipoConsumo.addEventListener('change', () => {
        document.getElementById('mov-cuotas-opts')?.classList.toggle('hidden', selTipoConsumo.value !== 'CUOTAS');
        document.getElementById('mov-recur-opts')?.classList.toggle('hidden', selTipoConsumo.value !== 'RECURRENTE');
      });
    }
    const chkSplit = document.getElementById('chk-split');
    if (chkSplit) {
      chkSplit.addEventListener('change', () => {
        document.getElementById('split-opts')?.classList.toggle('hidden', !chkSplit.checked);
      });
    }
    const chkComp = document.getElementById('mov-chk-compartir');
    if (chkComp) {
      chkComp.addEventListener('change', () => {
        document.getElementById('mov-compartir-opts')?.classList.toggle('hidden', !chkComp.checked);
      });
    }
  }

  // --- SECCIÓN 5: CRUD ---

  async #guardar(modal) {
    const form = modal.getForm();
    if (!form) return;

    const fd    = new FormData(form);
    const datos = {};
    fd.forEach((v, k) => { datos[k] = v; });

    if (!datos.fecha || !datos.id_categoria || !datos.importe || Number(datos.importe) <= 0) {
      App.Toast.warning('Completá los campos obligatorios.');
      return;
    }

    if (!datos.descripcion?.trim()) {
      App.Toast.warning('La descripción es obligatoria.');
      return;
    }

    const esSplit = datos.es_split === 'on';
    const splitDestinos = [];
    if (esSplit) {
      const p1 = Number(datos.split_porcentaje_1 || 0);
      const c1 = datos.split_cuenta_destino_1;
      const p2 = Number(datos.split_porcentaje_2 || 0);
      const c2 = datos.split_cuenta_destino_2;

      if (c1 && p1 > 0) splitDestinos.push({ cuenta: c1, pct: p1 });
      if (c2 && p2 > 0) splitDestinos.push({ cuenta: c2, pct: p2 });

      const sumPct = splitDestinos.reduce((sum, d) => sum + d.pct, 0);
      if (sumPct >= 100) {
         App.Toast.error('La suma de porcentajes de distribución no puede ser >= 100%.');
         return;
      }
    }

    const payload = {
      idCuenta          : App.Store.cuenta,
      tipo              : datos.tipo,
      fecha             : datos.fecha,
      idCategoria       : datos.id_categoria,
      descripcion       : datos.descripcion,
      importe           : Number(datos.importe),
      medioPago         : datos.medio_pago || 'transferencia',
      tipoConsumo       : datos.tipo_consumo || 'COMUN', // COMUN, CUOTAS, RECURRENTE
      cuotaActual       : Number(datos.cuota_actual || 1),
      cuotaTotal        : Number(datos.cuota_total || 2),
      periodos          : Number(datos.periodos || 12),
      esSplit           : esSplit,
      splitDestinos     : splitDestinos
    };

    modal.setLoading(true);

    try {
      if (!this.#editData) {
        if (datos.compartir === 'on') {
          const ccPayload = {
            idCuenta: App.Store.cuenta,
            idCategoria: datos.id_categoria,
            fecha: datos.fecha,
            tipo: 'COMUN',
            descripcion: datos.descripcion,
            importe: Number(datos.importe),
            idUsuario: datos.compartir_contacto,
            pagador: 'YO',
            porcentajeImputado: Number(datos.compartir_porcentaje || 50),
            cuotaActual: 1,
            cuotaTotal: 1,
            periodos: 12
          };
          const respCC = await App.API.call('api_createConsumoCC', ccPayload);
          if (!respCC.success) throw new Error('Error al crear gasto compartido: ' + respCC.error);
          App.Store.markModuloLoaded('cc', false);
        }
        // _handleCreate ya cierra el modal, muestra toast, destruye y recarga
        await this._handleCreate(payload, modal);
      } else {
        const esSerio = !!this.#editData.recur_group_id || !!this.#editData.split_group_id;
        
        const doUpdate = async (scope) => {
          modal.setLoading(true);
          const req = {
            data     : payload,
            original : {
              movimientoId : this.#editData.id_movimiento,
              recurGroupId : this.#editData.recur_group_id || null,
              splitGroupId : this.#editData.split_group_id || null,
              fecha        : this.#editData.fecha?.value || this.#editData.fecha
            },
            scope: scope
          };
          try {
            await this._handleUpdate(this.#editData.id_movimiento, req, modal);
          } catch (err) {
             modal.setLoading(false);
             App.Toast.error(err.message || 'Error al guardar.');
          }
        };

        if (esSerio) {
          modal.setLoading(false);
          const confirmModal = new App.Modal('modal-mov-scope-edit');
          confirmModal.open({
            titulo      : 'Editar movimiento de serie',
            body        : `
              <p>Este movimiento pertenece a una serie. ¿Qué deseas actualizar?</p>
              <div style="display:flex;flex-direction:column;gap:var(--space-3);margin-top:var(--space-4)">
                <button class="btn btn-ghost" id="edit-single">Solo este movimiento</button>
                <button class="btn btn-primary" id="edit-series">Este y los futuros (Serie)</button>
              </div>`,
            confirmLabel: '',
            cancelLabel : 'Cancelar'
          });
          confirmModal.el.querySelector('.modal-confirm')?.remove();

          document.getElementById('edit-single')?.addEventListener('click', () => {
             confirmModal.close();
             doUpdate('SINGLE');
          });
          document.getElementById('edit-series')?.addEventListener('click', () => {
             confirmModal.close();
             doUpdate('SERIES');
          });
        } else {
          await doUpdate('SINGLE');
        }
      }
    } catch (err) {
      modal.setLoading(false);
      App.Toast.error(err.message || 'Error al procesar.');
    }
  }

  async #eliminar(row) {
    const esSerio = !!row.recur_group_id || !!row.split_group_id;
    if (!esSerio) {
      const confirmModal = new App.Modal('modal-mov-confirm-delete');
      confirmModal.open({
        titulo      : 'Confirmar eliminación',
        body        : `<p>¿Eliminar el movimiento <strong>${App.Utils.escapeHtml(row.descripcion)}</strong>?</p>`,
        confirmLabel: 'Eliminar',
        danger      : true,
        onConfirm   : async () => {
          try {
            await this._handleDelete(row.id_movimiento);
          } catch (_) {}
        }
      });
    } else {
      const confirmModal = new App.Modal('modal-mov-scope-delete');
      confirmModal.open({
        titulo      : 'Eliminar movimiento de serie',
        body        : `
          <p>Este movimiento pertenece a una serie. ¿Qué deseas hacer?</p>
          <div style="display:flex;flex-direction:column;gap:var(--space-3);margin-top:var(--space-4)">
            <button class="btn btn-ghost" id="del-single">Solo este movimiento</button>
            <button class="btn btn-danger" id="del-series">Toda la serie</button>
          </div>`,
        confirmLabel: '',
        cancelLabel : 'Cancelar',
        onConfirm   : null
      });
      confirmModal.el.querySelector('.modal-confirm')?.remove();

      const doDelete = async (scope) => {
        confirmModal.close();
        try {
          const req = {
            id          : row.id_movimiento,
            recurGroupId: row.recur_group_id || null,
            splitGroupId: row.split_group_id || null,
            fecha       : row.fecha?.value || row.fecha,
            scope
          };
          await App.API.call('api_deleteMovimiento', req);
          App.API.invalidatePattern('api_getDashboardData');
          if (App.Events) App.Events.emit('data:changed');
          App.Toast.success('Movimiento eliminado.');
          this.destruir();
          await this.cargar();
        } catch (err) {
          App.Toast.error('Error al eliminar: ' + err.message);
        }
      };

      document.getElementById('del-single')?.addEventListener('click', () => doDelete('SINGLE'));
      document.getElementById('del-series')?.addEventListener('click', () => doDelete('SERIES'));
    }
  }

  // --- SECCIÓN 6: LISTENERS ---

  _bindListeners() {
    const searchInput = document.getElementById('mov-search');
    if (searchInput) {
      searchInput.addEventListener('input', App.Utils.debounce((e) => {
        this.#table?.search(e.target.value);
      }, 250));
    }
  }

  // --- SECCIÓN 7: DETAIL MODAL ---

  #abrirModalDetalle(row) {
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

    const detailModal = new App.Modal('modal-mov-detail');
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
          ${row.descripcion ? `
          <div class="detail-item full-width">
            <span class="detail-label">Descripción</span>
            <span class="detail-value" style="font-weight:500">${App.Utils.escapeHtml(row.descripcion)}</span>
          </div>` : ''}
        </div>
        ${!isAutoGenerated ? `
        <div class="detail-actions">
          <button class="btn btn-ghost" id="detail-mov-edit">${App.Icons.get('edit', 'icon-sm')} Editar</button>
          <button class="btn btn-danger" id="detail-mov-delete">${App.Icons.get('delete', 'icon-sm')} Eliminar</button>
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

    document.getElementById('detail-mov-edit')?.addEventListener('click', () => {
      detailModal.close();
      this.#abrirModalEdicion(row);
    });
    document.getElementById('detail-mov-delete')?.addEventListener('click', () => {
      detailModal.close();
      this.#eliminar(row);
    });
  }

  // --- SECCIÓN 7b: RENDER HELPERS ---

  #renderDescripcion(row) {
    const badges = [];
    if (row.recur_group_id?.startsWith('INSTL_')) badges.push('<span class="badge badge-recur">Cuotas</span>');
    else if (row.recur_group_id)                  badges.push('<span class="badge badge-recur">Recurrente</span>');
    if (row.split_group_id) {
      const label = row.split_rol === 'ORIGEN' ? 'Split Salida'
                  : row.split_rol === 'DESTINO' ? 'Split Entrada' : 'Dividido';
      badges.push(`<span class="badge badge-split">${label}</span>`);
    }
    if (row.id_consumo_tarjeta_origen) badges.push('<span class="badge badge-tc">Tarjeta</span>');
    if (row.id_transfer_ahorro)        badges.push('<span class="badge badge-ahorro">Ahorro</span>');
    if (row.id_transfer_inversion)     badges.push('<span class="badge badge-ahorro">Inversión</span>');

    return `${App.Utils.escapeHtml(row.descripcion)} ${badges.join(' ')}`;
  }

  // --- SECCIÓN 8: SKELETONS ---

  #mostrarKpiSkeletons() {
    this.#kpiIngresos?.showSkeleton();
    this.#kpiEgresos?.showSkeleton();
    this.#kpiResult?.showSkeleton();
  }

  // --- SECCIÓN 9: PRIVADOS ---

  #calcFechas(mes) {
    const [y, mo] = mes.split('-').map(Number);
    const ultimo  = new Date(y, mo, 0).getDate();
    return {
      fechaInicio: `${y}-${String(mo).padStart(2, '0')}-01`,
      fechaFin   : `${y}-${String(mo).padStart(2, '0')}-${ultimo}`
    };
  }
}

// --- REGISTRO EN NAMESPACE ---

App.log('module-movimientos', 'init', 'MovimientosModule registrado');