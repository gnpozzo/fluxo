'use strict';
/* ============================================================
   component-datatable.html — v5.0.0
   Tabla de datos reutilizable con:
   - Skeleton loading, ordenamiento por columna, búsqueda client-side
   - Paginación, filas vacías, acciones por fila
   - Exportación CSV
   Se registra en window.App.DataTable (clase)
   ============================================================ */

// --- SECCIÓN 0: CLASE DataTable ---

export class DataTable {

  #container;
  #config;
  #data       = [];
  #filtered   = [];
  #sortCol    = null;
  #sortDir    = 'asc';
  #page       = 1;
  #pageSize   = 20;
  #searchTerm = '';

  /**
   * @param {string|HTMLElement} container  Selector o elemento contenedor
   * @param {Object}             config     Configuración de la tabla
   * @param {Array}              config.columns       Definición de columnas
   * @param {string}             [config.emptyMsg]    Mensaje cuando no hay datos
   * @param {boolean}            [config.searchable]  Habilitar búsqueda
   * @param {boolean}            [config.paginated]   Habilitar paginación
   * @param {number}             [config.pageSize]    Filas por página
   * @param {Function}           [config.onAction]    Callback para acciones
   */
  constructor(container, config = {}) {
    this.#container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    this.#config = {
      columns   : [],
      emptyMsg  : 'No hay datos para mostrar.',
      searchable: false,
      paginated : false,
      pageSize  : 20,
      onAction  : null,
      ...config
    };

    this.#pageSize = this.#config.pageSize;
    this.#render();
    App.log('DataTable', 'constructor', `Tabla creada en ${container}`);
  }

  // --- SECCIÓN 1: API PÚBLICA ---

  /**
   * Carga datos en la tabla y renderiza.
   * @param {Array} data
   */
  load(data) {
    this.#data     = Array.isArray(data) ? data : [];
    this.#page     = 1;
    this.#filtered = this.#applySearch(this.#data);
    this.#renderBody();
    this.#renderPagination();
    App.log('DataTable', 'load', `${this.#data.length} registros cargados`);
  }

  /**
   * Muestra el skeleton de carga.
   * @param {number} [rows=5]
   */
  showSkeleton(rows = 5) {
    const tbody = this.#container.querySelector('tbody');
    if (!tbody) return;
    const cols = this.#config.columns.length || 4;
    tbody.innerHTML = Array.from({ length: rows }, () =>
      `<tr class="skeleton-row">${Array.from({ length: cols }, () =>
        `<td><div class="skeleton skeleton-text"></div></td>`
      ).join('')}</tr>`
    ).join('');
  }

  /**
   * Aplica un filtro de búsqueda externo.
   * @param {string} term
   */
  search(term) {
    this.#searchTerm = term.toLowerCase().trim();
    this.#page       = 1;
    this.#filtered   = this.#applySearch(this.#data);
    this.#renderBody();
    this.#renderPagination();
  }

  /**
   * Exporta los datos actuales (filtrados) a CSV.
   * @param {string} [filename='exportacion.csv']
   */
  exportCsv(filename = 'exportacion.csv') {
    const cols   = this.#config.columns.filter(c => c.exportable !== false);
    const header = cols.map(c => `"${c.label}"`).join(',');
    const rows   = this.#filtered.map(row =>
      cols.map(c => {
        const val = c.exportValue ? c.exportValue(row) : (row[c.key] ?? '');
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(',')
    );
    const csv  = [header, ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    App.log('DataTable', 'exportCsv', `Exportado: ${filename} (${this.#filtered.length} filas)`);
  }

  /** Total de registros cargados */
  get totalRows()    { return this.#data.length; }
  /** Total de registros después del filtro */
  get filteredRows() { return this.#filtered.length; }

  // --- SECCIÓN 2: RENDER ---

  #render() {
    const { columns, searchable, paginated } = this.#config;

    let html = '';

    if (searchable) {
      html += `
        <div class="dt-toolbar">
          <div class="dt-search">
            ${App.Icons.get('search', 'icon-sm')}
            <input class="dt-search-input input" type="text" placeholder="Buscar..." aria-label="Buscar en tabla">
          </div>
          <div class="dt-toolbar-actions"></div>
        </div>`;
    }

    html += `
      <div class="table-responsive">
        <table class="table">
          <thead>
            <tr>
              ${columns.map(c => `
                <th class="${c.sortable ? 'sortable' : ''} ${c.align ? 'text-' + c.align : ''}"
                    data-key="${c.key || ''}"
                    ${c.width ? `style="width:${c.width}"` : ''}>
                  <span>${App.Utils.escapeHtml(c.label)}</span>
                  ${c.sortable ? `<span class="sort-icon">${App.Icons.get('chevronDown', 'icon-xs')}</span>` : ''}
                </th>
              `).join('')}
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    `;

    if (paginated) {
      html += `<div class="dt-pagination"></div>`;
    }

    this.#container.innerHTML = html;
    this.#bindListeners();
  }

  #renderBody() {
    const tbody   = this.#container.querySelector('tbody');
    const { columns, emptyMsg, paginated, onAction } = this.#config;

    const rows = paginated ? this.#currentPage() : this.#filtered;

    if (rows.length === 0) {
      tbody.innerHTML = `
        <tr class="dt-empty">
          <td colspan="${columns.length}" class="dt-empty-cell">
            ${App.Icons.get('info', 'icon-md')}
            <span>${emptyMsg}</span>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = rows.map((row, i) => `
      <tr data-index="${i}" class="dt-row">
        ${columns.map(c => {
          const val = c.render
            ? c.render(row)
            : App.Utils.escapeHtml(row[c.key] ?? '—');
          return `<td class="${c.align ? 'text-' + c.align : ''} ${c.className || ''}">${val}</td>`;
        }).join('')}
    `).join('');
    // (La delegación de eventos ahora se centraliza en #bindListeners para ser eficiente y prevenir memory leaks)
  }

  #renderPagination() {
    const pag = this.#container.querySelector('.dt-pagination');
    if (!pag) return;

    const total = this.#filtered.length;
    const pages = Math.ceil(total / this.#pageSize);

    if (pages <= 1) { pag.innerHTML = ''; return; }

    const start = (this.#page - 1) * this.#pageSize + 1;
    const end   = Math.min(this.#page * this.#pageSize, total);

    pag.innerHTML = `
      <span class="dt-pag-info">${start}–${end} de ${total}</span>
      <div class="dt-pag-controls">
        <button class="btn btn-icon dt-prev" ${this.#page === 1 ? 'disabled' : ''} aria-label="Anterior">
          ${App.Icons.get('chevronUp', 'icon-sm')}
        </button>
        <span class="dt-pag-current">${this.#page} / ${pages}</span>
        <button class="btn btn-icon dt-next" ${this.#page === pages ? 'disabled' : ''} aria-label="Siguiente">
          ${App.Icons.get('chevronDown', 'icon-sm')}
        </button>
      </div>
    `;

    pag.querySelector('.dt-prev')?.addEventListener('click', () => {
      if (this.#page > 1) { this.#page--; this.#renderBody(); this.#renderPagination(); }
    });
    pag.querySelector('.dt-next')?.addEventListener('click', () => {
      if (this.#page < pages) { this.#page++; this.#renderBody(); this.#renderPagination(); }
    });
  }

  // --- SECCIÓN 3: LÓGICA INTERNA ---

  #currentPage() {
    const start = (this.#page - 1) * this.#pageSize;
    return this.#filtered.slice(start, start + this.#pageSize);
  }

  #applySearch(data) {
    if (!this.#searchTerm) return [...data];
    return data.filter(row =>
      this.#config.columns.some(c => {
        if (!c.searchable && c.searchable !== undefined) return false;
        const val = row[c.key];
        return val !== null && val !== undefined &&
               String(val).toLowerCase().includes(this.#searchTerm);
      })
    );
  }

  #bindListeners() {
    // Búsqueda
    const input = this.#container.querySelector('.dt-search-input');
    if (input) {
      input.addEventListener('input', App.Utils.debounce((e) => {
        this.search(e.target.value);
      }, 250));
    }

    // Ordenamiento
    this.#container.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        if (this.#sortCol === key) {
          this.#sortDir = this.#sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.#sortCol = key;
          this.#sortDir = 'asc';
        }
        this.#filtered = this.#sortData(this.#filtered);
        this.#page     = 1;
        this.#renderBody();

        // Actualizar ícono de sort
        this.#container.querySelectorAll('th.sortable').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
        th.classList.add(`sort-${this.#sortDir}`);
      });
    });

    // Delegación centralizada para botones de acción por fila
    const tbody = this.#container.querySelector('tbody');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        
        const action = btn.dataset.action;
        const tr     = btn.closest('tr');
        const rowId  = btn.dataset.id ?? tr?.dataset.id;
        const rowIdx = Number(tr?.dataset.index);
        
        const rows = this.#config.paginated ? this.#currentPage() : this.#filtered;
        const rowData = rows[rowIdx];
        
        if (rowData && typeof this.#config.onAction === 'function') {
          this.#config.onAction({ action, id: rowId, row: rowData, originalEvent: e });
        }
      });
    }
  }

  #sortData(data) {
    const key = this.#sortCol;
    const dir = this.#sortDir === 'asc' ? 1 : -1;
    return [...data].sort((a, b) => {
      const va = a[key] ?? '';
      const vb = b[key] ?? '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'es-AR') * dir;
    });
  }
}

// Exportar clase al namespace
App.DataTable = DataTable;
App.log('component-datatable', 'init', 'App.DataTable (clase) registrada');