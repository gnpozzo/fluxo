'use strict';
/* ============================================================
   module-cc.html — v5.0.0
   Módulo Cuenta Corriente (gastos compartidos).
   Extiende BaseModule. Carga lazy con cache sessionStorage.
   ============================================================ */

// --- SECCIÓN 0: CLASE CCModule ---

export class CCModule extends BaseModule {

  get moduleId() { return 'cc'; }
  get vistaId()  { return 'vista-cc'; }

  get _createEndpoint() { return 'api_createConsumoCC'; }
  get _updateEndpoint() { return 'api_updateConsumoCC'; }
  get _deleteEndpoint() { return 'api_deleteConsumoCC'; }

  #table      = null;
  #kpiYo      = null;
  #kpiOtro    = null;
  #kpiNeto    = null;
  #modal      = null;
  #categorias = [];
  #usuarios   = [];
  #editData   = null;

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
    this.#mostrarKpiSkeletons();
    this.#table?.showSkeleton(5);

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

    // Categorías y usuarios desde globales (cargados en boot o refrescados en cargar)
    if (!this.#categorias.length) this.#categorias = window._appCategorias || [];
    this.#usuarios = window._appUsuariosCC || [];

    this.#kpiYo?.setValue(kpis.gastoYo);
    this.#kpiOtro?.setValue(kpis.gastoOtro);
    this.#kpiNeto?.setValue(kpis.saldoNeto, { invertido: kpis.saldoNeto < 0 });

    this.#table?.load(consumos || []);
    App.log('CCModule', '_render', `${(consumos || []).length} gastos CC`);
  }

  // --- SECCIÓN 3: BUILD DOM ---

  _buildVista() {
    const vista = document.getElementById(this.vistaId);
    if (!vista) return;

    vista.innerHTML = `
      <div class="module-view-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        <span>Gastos compartidos</span>
      </div>

      <div class="kpi-grid" id="cc-kpi-grid"></div>
      <div class="section-header" style="margin-bottom:var(--space-3)">
        <div class="acciones-container" id="cc-acciones"></div>
      </div>
      <div class="table-card" id="cc-tabla-wrap"></div>
    `;

    const grid = document.getElementById('cc-kpi-grid');
    this.#kpiYo   = new App.KpiCard(grid, { titulo: 'Mis gastos',   icono: 'wallet',   colorClass: 'kpi-blue',  onFormat: App.Utils.formatearMoneda });
    this.#kpiOtro = new App.KpiCard(grid, { titulo: 'Sus gastos',   icono: 'wallet',   colorClass: 'kpi-purple',onFormat: App.Utils.formatearMoneda });
    this.#kpiNeto = new App.KpiCard(grid, { titulo: 'Saldo neto',   icono: 'investment',colorClass: 'kpi-green', onFormat: App.Utils.formatearMoneda });

    document.getElementById('cc-acciones').innerHTML = '';

    this.#table = new App.DataTable(
      document.getElementById('cc-tabla-wrap'),
      {
        columns: [
          { key: 'fecha',           label: 'Fecha',     sortable: true,
            render: (r) => App.Utils.formatearFecha(r.fecha?.value || r.fecha) },
          { key: 'pagador',         label: 'Pagador',   sortable: true,
            render: (r) => App.Utils.escapeHtml(r.pagador || '—') },
          { key: 'categoria_nombre',label: 'Categoría', sortable: true,
            render: (r) => App.Utils.escapeHtml(r.categoria_nombre || 'General') },
          { key: 'descripcion',     label: 'Descripción', searchable: true,
            render: (r) => this.#renderDescripcion(r) },
          { key: 'importe_total',   label: 'Total',     sortable: true, align: 'right',
            render: (r) => App.Utils.formatearMoneda(r.importe_total) },
          { key: 'mi_parte',        label: 'Mi parte',  align: 'right',
            render: (r) => `<span class="negativo">${App.Utils.formatearMoneda(r.mi_parte)}</span>` }
        ],
        emptyMsg: 'No hay gastos compartidos para este período.',
        paginated: true,
        pageSize : 25,
        onRowClick: ({ row }) => this.#abrirModalDetalle(row)
      }
    );
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
    if (vista) {
      vista.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.id === 'cc-btn-nuevo') this.#abrirModalAlta();
      });
    }
  }

  // --- SECCIÓN 7: DETAIL MODAL & HELPERS ---

  #abrirModalDetalle(row) {
    const badges = [];
    if (row.tipo_consumo === 'CUOTAS')     badges.push(`<span class="badge badge-recur">Cuota ${row.cuota_actual}/${row.cuota_total}</span>`);
    if (row.tipo_consumo === 'RECURRENTE') badges.push('<span class="badge badge-recur">Recurrente</span>');

    const miParte = Number(row.mi_parte || 0);
    const importeTotal = Number(row.importe_total || row.importe || 0);

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
            <span class="detail-value">${App.Utils.escapeHtml(row.pagador || '—')}</span>
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

  #renderDescripcion(row) {
    const badges = [];
    if (row.tipo_consumo === 'CUOTAS')     badges.push(`<span class="badge badge-recur">Cuota ${row.cuota_actual}/${row.cuota_total}</span>`);
    if (row.tipo_consumo === 'RECURRENTE') badges.push('<span class="badge badge-recur">Recurrente</span>');
    return `${App.Utils.escapeHtml(row.descripcion)} ${badges.join(' ')}`;
  }

  #mostrarKpiSkeletons() {
    this.#kpiYo?.showSkeleton();
    this.#kpiOtro?.showSkeleton();
    this.#kpiNeto?.showSkeleton();
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