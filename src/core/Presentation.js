// Presentation only: existing elements keep their IDs and operation listeners.
let fieldSequence = 0;
const filterModals = new Map();

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

function filters(root, ids) {
  const selects = ids.map(id => root.querySelector('#' + id)).filter(Boolean);
  if (!selects.length || selects[0].closest('.ux-filter-storage')) return;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'btn btn-outline btn-sm ux-filter-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.innerHTML = App.Icons.get('filter', 'icon-sm') + '<span>Filtros</span><span class="ux-filter-count" hidden></span>';
  selects[0].before(trigger);
  const storage = document.createElement('div');
  storage.className = 'ux-filter-storage'; storage.hidden = true;
  trigger.after(storage);
  const defaults = selects.map(select => select.value);
  selects.forEach(select => storage.append(select));
  const badge = trigger.querySelector('.ux-filter-count');
  const update = () => {
    const count = selects.filter((select, i) => select.value !== defaults[i]).length;
    badge.hidden = count === 0; badge.textContent = String(count);
    trigger.setAttribute('aria-label', count ? 'Filtros, ' + count + ' activos' : 'Filtros');
  };
  selects.forEach(select => select.addEventListener('change', update));
  trigger.addEventListener('click', () => {
    update();
    const modalId = 'modal-filtros-' + root.id;
    let modal = filterModals.get(modalId);
    if (!modal) { modal = new App.Modal(modalId); filterModals.set(modalId, modal); }
    const drafts = selects.map(select => {
      const draft = select.cloneNode(true);
      draft.id = select.id + '-draft'; draft.className = 'input'; draft.value = select.value;
      return draft;
    });
    modal.open({
      titulo: 'Filtros', icono: 'filter', size: 'sm', confirmLabel: 'Aplicar filtros',
      body: '<div class="ux-filter-modal-fields"></div>',
      onConfirm: () => {
        selects.forEach((select, i) => {
          select.value = drafts[i].value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        update(); modal.close();
      }
    });
    const fields = modal.el.querySelector('.ux-filter-modal-fields');
    drafts.forEach((draft, i) => {
      const group = document.createElement('div'); group.className = 'form-group';
      const label = document.createElement('label'); label.htmlFor = draft.id;
      label.textContent = selects[i].title || 'Filtro';
      group.append(label, draft); fields.append(group);
    });
    const reset = document.createElement('button');
    reset.type = 'button'; reset.className = 'btn btn-ghost btn-sm'; reset.textContent = 'Limpiar filtros';
    reset.addEventListener('click', () => drafts.forEach((draft, i) => { draft.value = defaults[i]; }));
    fields.append(reset); drafts[0]?.focus();
  });
  update();
}

export function enhanceView(root, moduleId) {
  if (!root) return;
  root.classList.add('ux-view');
  filters(root, ['dash-mov-cat-filter', 'dash-mov-medio-filter']);
  filters(root, ['tc-cat-filter', 'tc-cuenta-filter']);
  const vaciar = root.querySelector('#tc-btn-vaciar-inline');
  if (vaciar) {
    vaciar.textContent = 'Vaciar consumos';
    vaciar.className = 'btn btn-outline btn-sm ux-danger';
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

}
