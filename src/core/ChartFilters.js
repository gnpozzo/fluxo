import Chart from 'chart.js/auto';
import { chartFont } from './DesignSystem.js';
Chart.defaults.font.family = chartFont.family;
Chart.defaults.font.size = chartFont.size;

export const monthKey = row => String(row.fecha?.value || row.fecha || '').slice(0, 7);

// OR within a dimension, AND across dimensions. State never modifies source rows.
export class ChartFilters {
  selections = new Map();
  context = null;
  constructor(changed = () => {}) { this.changed = changed; }
  resetContext(context) {
    if (this.context !== context) { this.selections.clear(); this.context = context; }
  }
  get active() { return this.selections.size > 0; }
  has(dimension) { return this.selections.has(dimension); }
  selected(dimension, value) { return this.selections.get(dimension)?.has(value) || false; }
  pick(values, event = {}) {
    const additive = !!(event.native?.ctrlKey || event.native?.metaKey || event.ctrlKey || event.metaKey);
    for (const [dimension, value] of Object.entries(values)) {
      if (value == null) continue;
      const current = this.selections.get(dimension) || new Set();
      const next = additive ? new Set(current) : new Set();
      if (additive && next.has(value)) next.delete(value);
      else if (!(current.size === 1 && current.has(value) && !additive)) next.add(value);
      if (next.size) this.selections.set(dimension, next); else this.selections.delete(dimension);
    }
    this.changed();
  }
  clear(dimension) {
    if (dimension) this.selections.delete(dimension); else this.selections.clear();
    this.changed();
  }
  apply(rows, dimensions, except = []) {
    return (rows || []).filter(row => [...this.selections].every(([key, values]) => {
      if (except.includes(key) || !dimensions[key]) return true;
      const value = dimensions[key](row);
      return Array.isArray(value) ? value.some(item => values.has(item)) : values.has(value);
    }));
  }
  status(root) {
    if (!root) return;
    let panel = root.querySelector(':scope > .chart-filter-status');
    if (!panel) { panel = document.createElement('div'); panel.className = 'chart-filter-status'; root.prepend(panel); }
    panel.replaceChildren();
    const hint = document.createElement('span');
    hint.textContent = 'Filtrá desde los gráficos o sus etiquetas · Ctrl + clic para sumar'; panel.append(hint);
    for (const [dimension, values] of this.selections) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'chart-filter-chip';
      button.textContent = [...values].join(', ') + ' ×'; button.title = 'Quitar filtro: ' + dimension;
      button.onclick = () => this.clear(dimension); panel.append(button);
    }
    if (this.active) {
      const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'btn btn-ghost btn-sm';
      clear.textContent = 'Limpiar selección'; clear.onclick = () => this.clear(); panel.append(clear);
    }
  }
  legend(container, labels, dimension) {
    if (!container) return;
    container.querySelectorAll('.fintech-legend-item').forEach((old, index) => {
      const label = labels[index]; if (label == null) return;
      // Replacing the node removes legacy handlers that filtered only one widget.
      const item = old.cloneNode(true); old.replaceWith(item);
      item.setAttribute('role', 'button'); item.tabIndex = 0; item.dataset.uxKeyboard = 'true';
      item.setAttribute('aria-label', 'Filtrar: ' + label);
      item.setAttribute('aria-pressed', String(this.selected(dimension, label)));
      item.classList.toggle('chart-filter-selected', this.selected(dimension, label));
      item.onclick = event => this.pick({[dimension]: label}, event);
      item.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.pick({[dimension]: label}, event); } };
    });
  }
  chart(chart, {dimension, values, types}) {
    if (!chart) return;
    chart.options.onClick = (event, elements) => {
      let index = elements[0]?.index;
      if (index == null || values[index] == null) return;
      const choice = {[dimension]: values[index]};
      this.pick(choice, event);
    };
    chart.canvas.onclick = event => {
      if (!chart.ctx || chart.config.type !== 'bar') return;
      const bounds = chart.canvas.getBoundingClientRect();
      const x = (event.clientX-bounds.left)*chart.width/bounds.width;
      const y = (event.clientY-bounds.top)*chart.height/bounds.height;
      if (y <= chart.chartArea.bottom || x < chart.chartArea.left || x > chart.chartArea.right) return;
      const index = chart.scales.x.getValueForPixel(x);
      if (values[index] != null) this.pick({[dimension]:values[index]}, event);
    };
    if (types && chart.options.plugins.legend) chart.options.plugins.legend.onClick = (event, item) => {
      const tipo = types[item.datasetIndex]; if (tipo != null) this.pick({tipo}, event);
    };
    if (chart.config.type === 'bar') {
      chart.data.datasets.forEach(dataset => { dataset.borderWidth = values.map(value => this.selected(dimension, value) ? 3 : 0); dataset.borderColor = '#2563eb'; });
    }
    if (chart.config.type === 'doughnut') {
      const dataset = chart.data.datasets[0];
      dataset.borderWidth = values.map(value => this.selected(dimension, value) ? 5 : 2);
      dataset.borderColor = values.map(value => this.selected(dimension, value) ? '#2563eb' : '#ffffff');
    }
    chart.canvas.style.cursor = 'pointer';
    chart.stop();
    chart.update('none');
    this.status(chart.canvas.closest('.vista-container'));
  }
}

export const movementDimensions = { categoria: row => row.categoria_nombre || 'General', mes: monthKey, tipo: row => row.tipo_mov };
export function filteredEvolution(rows, buckets) {
  return (buckets || []).map(bucket => {
    const pool = (rows || []).filter(row => monthKey(row) === bucket.mes);
    const ingresos = pool.filter(row => row.tipo_mov === 'INGRESO').reduce((sum, row) => sum + Math.abs(Number(row.importe || 0)), 0);
    const egresos = pool.filter(row => row.tipo_mov === 'EGRESO' && !(row.is_pago_tc || row.id_categoria === 'CAT_PAGO_TC' || row.descripcion?.toLowerCase().startsWith('pago resumen:'))).reduce((sum, row) => sum + Math.abs(Number(row.importe || 0)), 0);
    return {...bucket, ingresos, egresos, balance: ingresos - egresos};
  });
}
