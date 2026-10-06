// A shared operations + analytics layout. Moving nodes preserves their listeners.
const observers = new WeakMap();
const sections = {
  dashboard: ['dash', 'dash-widget-movimientos', 'dash-mov-list'],
  tarjetas: ['tc', 'tc-widget-consumos', 'tc-consumos-list'],
  cc: ['cc', 'cc-widget-consumos', 'cc-consumos-list'],
  ahorro: ['aho', 'aho-widget-movimientos', 'aho-movimientos-list'],
  inversiones: ['inv', 'inv-widget-operaciones', 'inv-operaciones-list']
};

export function mountAnalyticsLayout(root, moduleId) {
  const section = sections[moduleId];
  if (!section) return;
  const [prefix, mainId, listId] = section;
  const main = root.querySelector('#' + mainId);
  const categories = root.querySelector('#' + prefix + '-widget-categories');
  const evolution = root.querySelector('#' + prefix + '-widget-moneyflow');
  const list = root.querySelector('#' + listId);
  if (!main || !categories || !evolution || !list || main.closest('.ux-analytics-layout')) return;
  observers.get(root)?.disconnect();
  const chartsParent = evolution.parentElement, auxiliary = main.parentElement;
  const layout = document.createElement('div'); layout.className = 'ux-analytics-layout';
  const aside = document.createElement('aside'); aside.className = 'ux-analytics-charts';
  aside.setAttribute('aria-label', 'Gráficos');
  chartsParent.before(layout);
  main.classList.add('ux-operations-card'); list.classList.add('ux-operations-scroll');
  list.tabIndex = 0; list.setAttribute('role', 'region'); list.setAttribute('aria-label', 'Listado de operaciones');
  layout.append(main, aside); aside.append(categories, evolution);
  chartsParent.remove();
  auxiliary.classList.add('ux-auxiliary-panels');
  if (!auxiliary.children.length) auxiliary.remove();

  const syncHeight = () => {
    // Natural page flow on narrow screens; one bounded scroll area on desktop.
    const height = aside.getBoundingClientRect().height;
    const value = window.matchMedia('(min-width: 1201px)').matches && height > 0 ? `${Math.ceil(height)}px` : '';
    if (main.style.height !== value) main.style.height = value;
  };
  const observer = new ResizeObserver(syncHeight);
  observer.observe(aside); observer.observe(root);
  observers.set(root, observer); syncHeight();
}
