'use strict';
/* ============================================================
   app-init.html — v6.0.0
   Arranque de la aplicación.
   - Carga datos iniciales (cuentas, categorías, tarjetas)
   - Configura el AccountToggle
   - Inicializa todos los módulos
   - Activa tab inicial + prefetch paralelo
   Reemplaza: javascript-main.html
   ============================================================ */

// --- SECCIÓN 0: CLASE AppInit ---

class AppInit {

  #tabActivo = 'vista-dashboard';

  /** Mapa de tabs: vistaId → módulo en App.Modules */
  #tabMap = {
    'vista-dashboard'   : 'dashboard',
    'vista-movimientos' : 'movimientos',
    'vista-tarjetas'    : 'tarjetas',
    'vista-cc'          : 'cc',
    'vista-ahorro'      : 'ahorro',
    'vista-inversiones' : 'inversiones'
  };

  // --- SECCIÓN 1: ARRANQUE ---

  async boot() {
    App.log('AppInit', 'boot', `v${App.VERSION} — Iniciando`);

    this.#mostrarLoader();
    this.#setDefaultMes();

    try {
      // Carga inicial: datos maestros y cotización Dólar
      const [initialData, pDolar] = await Promise.all([
        App.API.cached('api_getInitialData', [], 24 * 60 * 60 * 1000),
        App.API.cached('api_getDolarCotizaciones', [], 10 * 60_000)
      ]);

      // Si tenemos cotización, la guardamos en el state
      if (pDolar && pDolar.success && pDolar.bolsa) {
        App.Store.setExchangeRate(pDolar.bolsa.venta);
      }

      if (!initialData?.success) {
        App.Toast.error(initialData?.error || 'Error al cargar datos iniciales.');
        this.#ocultarLoader();
        return;
      }

      // Llenar Store con datos maestros
      App.Store.setCuentas(initialData.cuentas || []);
      App.Store.setMeses(initialData.meses   || []);

      // Cachear categorías y tarjetas en los módulos (disponibles en el Store via data)
      // Los módulos los recibirán en su primera respuesta de backend,
      // pero los guardamos globalmente para acceso rápido
      window._appCategorias = initialData.categorias || [];
      window._appTarjetas   = initialData.tarjetas   || [];
      window._appUsuariosCC = initialData.usuarios_cc || [];

      // Configurar cuenta inicial
      const cuentaPred = (initialData.cuentas || []).find(c => c.es_predeterminada) || initialData.cuentas?.[0];
      if (cuentaPred) {
        App.Store.setCuenta(cuentaPred.id_cuenta_principal);
      }

      // Configurar selectores del DOM (por compatibilidad con código legacy si hubiera)
      this.#syncSelectorDom(initialData.cuentas);
      this.#syncMesDom(initialData.meses);

      // Configurar Account Selector
      this.#setupAccountSelector(initialData.cuentas);
      
      // Configurar Quick Add global
      this.#setupQuickAdd();

      // Actualizar visibilidad de tabs según config de la cuenta
      this.#actualizarVisibilidadTabs(cuentaPred);

      // Cargar info de usuario en paralelo (no bloquea UI)
      this.#cargarUsuario();

      // Configurar Currency Pills (Bimonetario)
      this.#setupCurrencyPills();

      // Configurar Centro de Notificaciones
      this.#setupNotifications();
      this.#cargarNotificaciones();

      // Inicializar todos los módulos
      this.#initModulos();

      this.#ocultarLoader();

      // Navegar al tab inicial (Dashboard unificado)
      this.#navegarTab('vista-dashboard');

      // Prefetch paralelo en background (sin bloquear UI)
      if (App.Prefetch) {
         App.Prefetch.run({ silent: true }).catch(() => {});
      }

      App.log('AppInit', 'boot', 'Inicialización completada');

    } catch (err) {
      App.error('AppInit', 'boot', 'Error fatal en boot', err);
      App.Toast.error('Error al iniciar la aplicación: ' + err.message);
      this.#ocultarLoader();
    }
  }

  // --- SECCIÓN 2: NAVEGACIÓN ---

  #navegarTab(vistaId) {
    // Ocultar todos los paneles de contenido
    document.querySelectorAll('.vista-container').forEach(v => v.classList.remove('active'));

    // Desactivar todos los nav items del sidebar
    document.querySelectorAll('.nav-item[data-vista]').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });

    // Activar panel de contenido
    document.getElementById(vistaId)?.classList.add('active');

    // Activar nav item correspondiente
    const navBtn = document.querySelector(`[data-vista="${vistaId}"]`);
    if (navBtn) {
      navBtn.classList.add('active');
      navBtn.setAttribute('aria-selected', 'true');
    }

    this.#tabActivo = vistaId;
    const moduloId  = this.#tabMap[vistaId];

    if (moduloId && App.Modules[moduloId]) {
      App.Modules[moduloId].cargar();
    }

    // Close sidebar on mobile after navigation
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    sidebar?.classList.remove('sidebar-open');
    backdrop?.classList.remove('open');

    // Show/hide welcome bar based on active module
    const welcomeBar = document.getElementById('welcome-bar');
    if (welcomeBar) {
      // Show welcome bar on dashboard, hide on admin
      welcomeBar.style.display = (vistaId === 'vista-admin') ? 'none' : '';
    }

    App.Events.emit('ui:tab-changed', { tabId: vistaId });
    App.log('AppInit', '#navegarTab', vistaId);
  }

  // --- SECCIÓN 3: ACCOUNT SELECTOR ---

  #setupAccountSelector(cuentas) {
    if (!cuentas || cuentas.length === 0) return;

    const selectWrap = document.getElementById('account-select-ui');
    const selectEl   = document.getElementById('selector-cuenta');
    if (!selectEl) return;

    if (cuentas.length > 0 && selectWrap) {
      selectWrap.style.display = 'flex';
      
      selectEl.addEventListener('change', (e) => {
        const nuevaId = e.target.value;
        const cuentaObj = cuentas.find(c => c.id_cuenta_principal === nuevaId);
        if (cuentaObj) {
          App.Store.setCuenta(nuevaId);
          this.#actualizarVisibilidadTabs(cuentaObj);
          
          this.#cargarNotificaciones(); // Refrescar notificaciones

          // Recargar módulo actual con la nueva cuenta
          const modId = this.#tabMap[this.#tabActivo];
          if (modId && App.Modules[modId]) {
            App.Modules[modId].cargar();
          }
        }
      });
    }
  }

  // --- SECCIÓN 3B: CURRENCY PILLS ---

  #setupCurrencyPills() {
    const pillArs = document.getElementById('pill-ars');
    const pillUsd = document.getElementById('pill-usd');
    if (!pillArs || !pillUsd) return;

    // Inicializar estado (ARS activo por defecto)
    App.Store.setGlobalCurrency('ARS');

    const setActivePill = (currency) => {
      App.Store.setGlobalCurrency(currency);
      pillArs.classList.toggle('active', currency === 'ARS');
      pillUsd.classList.toggle('active', currency === 'USD');

      // Recargar módulo actual con nueva moneda
      const modId = this.#tabMap[this.#tabActivo];
      if (modId && App.Modules[modId]) {
        App.Modules[modId].cargar();
      }
    };

    pillArs.addEventListener('click', () => setActivePill('ARS'));
    pillUsd.addEventListener('click', () => setActivePill('USD'));
  }

  // --- SECCIÓN 4: TABS ---

  #actualizarVisibilidadTabs(cuentaObj) {
    if (!cuentaObj) return;
    const modulos = [
      { tab: 'tab-btn-tarjetas',   flag: 'modulo_tarjetas_activo'    },
      { tab: 'tab-btn-cc',         flag: 'modulo_cc_activo'          },
      { tab: 'tab-btn-ahorro',     flag: 'modulo_ahorro_activo'      },
      { tab: 'tab-btn-inversiones',flag: 'modulo_inversiones_activo' }
    ];
    modulos.forEach(({ tab, flag }) => {
      const btn = document.getElementById(tab);
      if (btn) btn.style.display = cuentaObj[flag] ? '' : 'none';
    });
  }

  // --- SECCIÓN 5: QUICK ADD (Universal) ---

  #setupQuickAdd() {
    const btnQa = document.getElementById('btn-fab-quick-add');
    if (!btnQa) return;

    const closeQA = () => { document.getElementById('modal-quick-add')?.classList.remove('modal-open'); document.body.classList.remove('modal-active'); };
    window._qaClose = closeQA;

    const chev = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:var(--texto-3)"><polyline points="9 18 15 12 9 6"/></svg>`;
    const rs = 'display:flex;align-items:center;gap:14px;padding:14px 18px;border-radius:var(--r);cursor:pointer;background:var(--fondo);border:1px solid var(--borde);transition:all .15s;text-align:left;width:100%;font-family:inherit;font-size:.93rem;font-weight:500;color:var(--texto)';
    const iw = (svg, bg, clr) => `<span style="width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:var(--r-sm);background:${bg};color:${clr};flex-shrink:0">${svg}</span>`;
    const hv = 'onmouseover="this.style.borderColor=\'var(--primary)\';this.style.boxShadow=\'0 2px 8px rgba(0,0,0,.06)\'" onmouseout="this.style.borderColor=\'var(--borde)\';this.style.boxShadow=\'none\'"';

    const icons = {
      ing: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>',
      egr: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>',
      tc:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
      cc:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      ah:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>'
    };

    btnQa.addEventListener('click', () => {
      const m = new App.Modal('modal-quick-add');
      m.open({
        titulo: '¿Qué tipo de movimiento?',
        size: 'sm',
        body: `<div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">
          <button style="${rs}" ${hv} onclick="window._qaClose(); App.Modules.movimientos?.abrirAlta('INGRESO')">${iw(icons.ing,'var(--verde-tint)','var(--verde)')}<span style="flex:1">Cargar Ingreso</span>${chev}</button>
          <button style="${rs}" ${hv} onclick="window._qaClose(); App.Modules.movimientos?.abrirAlta('EGRESO')">${iw(icons.egr,'var(--rojo-tint)','var(--rojo)')}<span style="flex:1">Cargar Gasto</span>${chev}</button>
          <button style="${rs}" ${hv} onclick="window._qaClose(); App.Modules.tarjetas?.abrirAlta()">${iw(icons.tc,'#eff6ff','#2563eb')}<span style="flex:1">Consumo en Tarjeta</span>${chev}</button>
          <button style="${rs}" ${hv} onclick="window._qaClose(); App.Modules.cc?.abrirAlta()">${iw(icons.cc,'#f5f3ff','#7c3aed')}<span style="flex:1">Gasto Compartido</span>${chev}</button>
          <button style="${rs}" ${hv} onclick="window._qaClose(); App.Modules.ahorro?.abrirAlta()">${iw(icons.ah,'var(--amarillo-tint)','var(--amarillo-text)')}<span style="flex:1">Cargar Ahorro</span>${chev}</button>
        </div>`,
        confirmLabel: '',
        cancelLabel: 'Cancelar'
      });
      const cb = m.el.querySelector('.modal-confirm');
      if (cb) cb.style.display = 'none';
      const xb = m.el.querySelector('.modal-cancel');
      if (xb) { xb.classList.replace('btn-ghost', 'btn-outline'); xb.style.borderRadius = 'var(--r)'; }
    });
  }

  // --- SECCIÓN 5: INICIALIZAR MÓDULOS ---

  #initModulos() {
    Object.values(App.Modules).forEach(mod => {
      if (typeof mod.init === 'function') {
        try { mod.init(); } catch (e) {
          App.error('AppInit', '#initModulos', `Error en ${mod.moduleId}`, e);
        }
      }
    });

    // Bind sidebar nav items (data-vista)
    document.querySelectorAll('[data-vista]').forEach(btn => {
      btn.addEventListener('click', () => this.#navegarTab(btn.dataset.vista));
    });

    // Botón Admin (no es tab) - Lo vincula module-admin.html
    // document.getElementById('btn-admin')
    //  ?.addEventListener('click', () => App.Modules.admin?.cargar());

    App.log('AppInit', '#initModulos', `${Object.keys(App.Modules).length} módulos inicializados`);
  }

  // --- SECCIÓN 6: SINCRONIZACIÓN DOM LEGACY ---

  /** Mantiene el <select id="selector-cuenta"> sincronizado por si algún código legacy lo usa */
  #syncSelectorDom(cuentas, selectedId = null) {
    const sel = document.getElementById('selector-cuenta');
    if (!sel) return;
    sel.innerHTML = '';
    (cuentas || []).forEach(c => {
      const opt = new Option(c.nombre, c.id_cuenta_principal);
      if (selectedId ? c.id_cuenta_principal === selectedId : c.es_predeterminada) {
        opt.selected = true;
      }
      sel.add(opt);
    });
  }

  #syncMesDom(meses) {
    const sel = document.getElementById('selector-mes');
    if (!sel) return;
    // El selector de mes ya tiene su valor establecido por #setDefaultMes()
    // Solo poblamos las opciones si el select necesita lista
  }

  // --- SECCIÓN 7: HELPERS ---

  #setDefaultMes() {
    const ahora = new Date();
    const mes   = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    const sel   = document.getElementById('selector-mes');
    if (sel) sel.value = mes;
    App.Store.setMes(mes);

    // Listener del selector de mes
    sel?.addEventListener('change', (e) => {
      App.Store.setMes(e.target.value || null);
      this.#cargarNotificaciones(); // Refrescar notificaciones
      this.#updateWelcomeSubtitle(); // Update subtitle with new month
      
      const tabId = this.#tabActivo;
      const modId = this.#tabMap[tabId];
      if (modId && App.Modules[modId]) {
        App.Modules[modId].cargar();
      }
    });

    // Set initial subtitle
    this.#updateWelcomeSubtitle();
    App.log('AppInit', '#setDefaultMes', mes);
  }

  #updateWelcomeSubtitle() {
    const el = document.getElementById('welcome-subtitle');
    if (!el) return;
    const mes = App.Store.mes;
    if (!mes) { el.textContent = 'Resumen de tu patrimonio'; return; }
    const [y, m] = mes.split('-').map(Number);
    const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    el.textContent = `Resumen de tu patrimonio al ${meses[m - 1] || ''} ${y}`;
  }

  #notificacionesMes = [];

  #setupNotifications() {
    const btnNotif = document.getElementById('btn-notifications');
    if (!btnNotif) return;

    btnNotif.addEventListener('click', () => {
      const m = new App.Modal('modal-notifications');
      let bodyHtml = '<div style="padding:10px 0; color:var(--texto-3); text-align:center;">No hay notificaciones para este mes.</div>';
      
      if (this.#notificacionesMes && this.#notificacionesMes.length > 0) {
        bodyHtml = '<div style="display:flex; flex-direction:column; gap:12px;">' + 
          this.#notificacionesMes.map(n => `
            <div style="display:flex; gap:12px; padding:12px; border-radius:var(--r); background:var(--superficie); border:1px solid var(--borde);">
              <div style="width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; background: ${n.tipo==='info'?'var(--color-info-bg)':'var(--color-success-bg)'}; color: ${n.tipo==='info'?'var(--color-info)':'var(--color-success)'}">
                ${App.Icons?.get(n.icono, 'icon-md') || ''}
              </div>
              <div style="flex-grow:1">
                <h4 style="margin:0; font-size:0.9rem; color:var(--texto);">${n.titulo}</h4>
                <p style="margin:4px 0 0; font-size:0.8rem; color:var(--texto-2);">${n.mensaje}</p>
                <div style="margin-top:6px; font-weight:600; font-size:0.85rem; color:${n.tipo==='info'?'var(--color-info)':'var(--color-success)'}">
                  ${App.Utils.formatearMoneda(n.importe)}
                </div>
              </div>
            </div>
          `).join('') +
        '</div>';
      }

      m.open({
        titulo: 'Centro de Notificaciones',
        body: bodyHtml,
        confirmLabel: '',
        cancelLabel: 'Cerrar'
      });
      // hide confirm btn
      const cb = m.el.querySelector('.modal-confirm');
      if (cb) cb.style.display = 'none';
      const xb = m.el.querySelector('.modal-cancel');
      if (xb) { xb.classList.replace('btn-ghost', 'btn-outline'); xb.style.borderRadius = 'var(--r)'; }
    });
  }

  #cargarNotificaciones() {
    const cuenta = App.Store.cuenta;
    const mes = App.Store.mes;
    if (!cuenta || !mes) return;

    App.API.call('api_getNotificaciones', cuenta, mes)
      .then(res => {
         if (res && res.success) {
           this.#notificacionesMes = res.data || [];
         } else {
           this.#notificacionesMes = [];
         }
         const badge = document.getElementById('badge-notifications');
         if (badge) {
           badge.style.display = this.#notificacionesMes.length > 0 ? 'block' : 'none';
         }
      })
      .catch((e) => { console.error('Error notificaciones:', e); });
  }

  async #cargarUsuario() {
    try {
      const res = await App.API.call('api_getUserInfo');
      if (res?.success) {
        // Formatear nombre: "gaston.pozzo" -> "Gaston Pozzo"
        const usernamePart = res.email.split('@')[0];
        const nombre = usernamePart.split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
        const primerNombre = nombre.split(' ')[0] || nombre;

        // Welcome greeting
        const elWelcome = document.getElementById('welcome-name');
        if (elWelcome) {
          elWelcome.textContent = `Hola, ${primerNombre}`;
        }

        // Nombre en topbar (hidden but accessible)
        const elNombre = document.getElementById('user-info-container');
        if (elNombre) {
          elNombre.textContent = nombre;
          elNombre.title       = res.email;
        }

        // Avatar: Imagen con iniciales
        const elAvatar = document.getElementById('topbar-avatar');
        if (elAvatar) {
          elAvatar.innerHTML = `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(nombre)}&background=0F172A&color=fff&bold=true" alt="Avatar">`;
          elAvatar.title       = res.email;
          elAvatar.style.border = 'none';
          elAvatar.style.background = 'transparent';
        }

        App.Store.setUsuario({ email: res.email });
      }
    } catch (_) {}
  }

  #mostrarLoader() {
    document.getElementById('loader-overlay')?.classList.remove('hidden');
  }

  #ocultarLoader() {
    document.getElementById('loader-overlay')?.classList.add('hidden');
  }
}

// --- ARRANQUE ---
window.addEventListener('load', () => {
  new AppInit().boot();
});

// Actualizar versión en sidebar footer
window.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('footer-version');
  if (el) el.textContent = `v${App.VERSION} · ${new Date().getFullYear()}`;
});

App.log('app-init', 'cargado', `v${App.VERSION}`);