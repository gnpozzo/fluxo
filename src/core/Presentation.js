// Presentation only: existing elements keep their IDs and operation listeners.
let fieldSequence = 0;

export function labelFields(root) {
  if (!root?.querySelectorAll) return;
  for (const label of root.querySelectorAll('label:not([for])')) {
    if (label.querySelector('input,select,textarea')) continue;
    const sibling = label.nextElementSibling;
    const field = sibling?.matches('input,select,textarea') ? sibling : sibling?.querySelector('input,select,textarea');
    if (!field || ['hidden', 'radio', 'checkbox'].includes(field.type)) continue;
    field.id ||= `fluxo-field-${++fieldSequence}`;
    label.htmlFor = field.id;
  }
  for (const field of root.querySelectorAll('input[placeholder]')) {
    if (!field.labels?.length && !field.hasAttribute('aria-label')) field.setAttribute('aria-label', field.placeholder);
  }
}

function disclosure(className, title) {
  const details = document.createElement('details');
  details.className = className;
  const summary = document.createElement('summary');
  summary.textContent = title;
  details.append(summary);
  return details;
}

function filters(root, ids) {
  const selects = ids.map(id => root.querySelector(`#${id}`)).filter(Boolean);
  if (!selects.length || selects[0].closest('.ux-filters')) return;
  const details = disclosure('ux-filters', 'Filtros');
  selects[0].before(details);
  const body = document.createElement('div');
  body.className = 'ux-filter-body';
  details.append(body);
  const defaults = selects.map(select => select.value);
  for (const select of selects) { select.setAttribute('aria-label', select.title || 'Filtrar'); body.append(select); }
  const reset = document.createElement('button');
  reset.type = 'button'; reset.className = 'btn btn-outline btn-sm'; reset.textContent = 'Limpiar filtros';
  body.append(reset);
  const update = () => {
    const count = selects.filter((select, i) => select.value !== defaults[i]).length;
    details.querySelector('summary').textContent = count ? `Filtros · ${count} activos` : 'Filtros';
    reset.disabled = count === 0;
  };
  selects.forEach(select => select.addEventListener('change', update));
  reset.addEventListener('click', () => {
    selects.forEach((select, i) => { select.value = defaults[i]; select.dispatchEvent(new Event('change', { bubbles: true })); });
    update();
  });
  details.addEventListener('toggle', update);
  update();
}

const charts = {
  dashboard: ['dash-widget-moneyflow', 'dash-widget-categories'],
  tarjetas: ['tc-widget-moneyflow', 'tc-widget-categories'],
  cc: ['cc-widget-moneyflow', 'cc-widget-categories'],
  ahorro: ['aho-widget-moneyflow', 'aho-widget-categories'],
  inversiones: ['inv-widget-moneyflow', 'inv-widget-categories'],
  movimientos: ['mov-donut-wrap', 'mov-evolucion-wrap']
};

export function enhanceView(root, moduleId) {
  if (!root) return;
  root.classList.add('ux-view');
  const widgets = (charts[moduleId] || []).map(id => root.querySelector(`#${id}`)).filter(Boolean);
  if (widgets.length && !root.querySelector('.ux-analysis')) {
    const analysis = disclosure('ux-analysis', 'Análisis · evolución y distribución');
    const grid = document.createElement('div'); grid.className = 'ux-analysis-grid'; analysis.append(grid);
    for (const widget of widgets) {
      const oldParent = widget.parentElement;
      grid.append(widget);
      if (oldParent !== root && !oldParent.children.length) oldParent.remove();
    }
    (moduleId==='dashboard'?root.querySelector('#dash-detail-view') || root:root).append(analysis);
    analysis.addEventListener('toggle', () => { if (analysis.open) window.dispatchEvent(new Event('resize')); });
  }
  filters(root, ['dash-mov-cat-filter', 'dash-mov-medio-filter']);
  filters(root, ['tc-cat-filter', 'tc-cuenta-filter']);
  const vaciar = root.querySelector('#tc-btn-vaciar-inline');
  if (vaciar && !vaciar.closest('.ux-more')) {
    const more = disclosure('ux-more', 'Más opciones');
    vaciar.before(more); more.append(vaciar);
    vaciar.textContent = 'Vaciar consumos…'; vaciar.className = 'btn btn-outline btn-sm ux-danger';
    root.querySelector('.tc-header-sep')?.remove();
  }
  for (const [id, text, primary] of [
    ['tc-btn-nuevo-inline', 'Nuevo consumo', true], ['tc-btn-importar-inline', 'Importar resumen', false]
  ]) {
    const button = root.querySelector(`#${id}`);
    if (button) { button.textContent = text; button.className = `btn btn-${primary ? 'primary' : 'outline'} btn-sm`; }
  }
  // A secondary duplicate currency control is no longer needed.
  const localCurrency = root.querySelector('#aho-btn-ars')?.parentElement;
  if (localCurrency) localCurrency.hidden = true;
  keyboardButtons(root);
  labelFields(root);
}

function keyboardButtons(root) {
  for(const el of [...(root.matches?.('[role=button][tabindex="0"]') ? [root] : []), ...root.querySelectorAll('[role=button][tabindex="0"]')]){
    if(el.dataset.uxKeyboard) continue;
    el.dataset.uxKeyboard='true';
    el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();el.click();}});
  }
}

export function installPresentation() {
  // Modal content is created after the module's initial build.
  const observer = new MutationObserver(records => {
    for (const record of records) for (const added of record.addedNodes) {
      if (added.nodeType === Node.ELEMENT_NODE) { labelFields(added); keyboardButtons(added); }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') document.querySelectorAll('.ux-filters[open],.ux-more[open]').forEach(el => { el.open = false; });
  });
}
