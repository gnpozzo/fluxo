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

    // Check Auth Session
    const isLogged = await App.Auth.init();
    if (!isLogged) {
      this.#ocultarLoader();
      this.#showLoginUI();
      return;
    }
    
    this.#proceedWithBoot();
  }

  #showLoginUI() {
    const overlay = document.getElementById('login-overlay');
    const form = document.getElementById('form-login');
    const btn = form.querySelector('button[type="submit"]');
    
    overlay.style.display = 'flex';
    document.querySelector('.main-wrapper').style.display = 'none';
    document.getElementById('app-sidebar').style.display = 'none';

    form.onsubmit = async (e) => {
      e.preventDefault();
      btn.disabled = true;
      btn.innerHTML = '<div class="loader-spinner" style="width:20px;height:20px;"></div> Ingresando...';
      try {
        const email = document.getElementById('login-email').value;
        const pwd = document.getElementById('login-password').value;
        await App.Auth.login(email, pwd);
        overlay.style.display = 'none';
        document.querySelector('.main-wrapper').style.display = '';
        document.getElementById('app-sidebar').style.display = 'flex';
        this.#mostrarLoader();
        this.#proceedWithBoot();
      } catch (err) {
        App.Toast.error(err.message || 'Credenciales incorrectas');
        btn.disabled = false;
        btn.innerHTML = 'Ingresar';
      }
    };

    const regBtn = document.getElementById('btn-register-submit');
    if (regBtn) {
      regBtn.onclick = async () => {
        regBtn.disabled = true;
        regBtn.innerHTML = 'Creando...';
        try {
          const email = document.getElementById('login-email').value;
          const pwd = document.getElementById('login-password').value;
          if (!email || pwd.length < 6) {
             App.Toast.error('Ingresa un email y una contraseña (mín. 6 chars)');
             regBtn.disabled = false;
             regBtn.innerHTML = 'Crear Cuenta';
             return;
          }
          await App.Auth.signUp(email, pwd);
          
          if (App.Auth.session) {
             overlay.style.display = 'none';
             document.querySelector('.main-wrapper').style.display = '';
             document.getElementById('app-sidebar').style.display = 'flex';
             this.#mostrarLoader();
             this.#proceedWithBoot();
          } else {
             App.Toast.success('Registrado con éxito. Revisa tu casilla de inicio.');
             regBtn.disabled = false;
             regBtn.innerHTML = 'Crear Cuenta';
          }
        } catch (err) {
          App.Toast.error(err.message || 'Error al crear cuenta');
          regBtn.disabled = false;
          regBtn.innerHTML = 'Crear Cuenta';
        }
      };
    }

    const goBtn = document.getElementById('btn-google-login');
    if (goBtn) {
      goBtn.onclick = async () => {
        goBtn.disabled = true;
        goBtn.innerHTML = 'Conectando con Google...';
        try {
          await App.Auth.loginWithGoogle();
          // The page will redirect to Google's OAuth, no further logic needed here.
        } catch (err) {
          App.Toast.error(err.message || 'Error con Google Auth');
          goBtn.disabled = false;
          goBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Google';
        }
      };
    }
  }

  async #proceedWithBoot() {
    // Always initialize modules (binds navigation buttons) first, so UI isn't dead on DB errors
    this.#initModulos();

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
        App.Toast.error(initialData?.error || 'Error al cargar datos iniciales. Revisa tu base de datos.');
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

      this.#ocultarLoader();

      // Navegar al tab inicial (Dashboard unificado)
      this.#navegarTab('vista-dashboard');

      // Prefetch paralelo en background (sin bloquear UI)
      if (App.Prefetch) {
         App.Prefetch.run({ silent: true }).catch(() => {});
      }

      App.log('AppInit', 'boot', 'Inicialización completada');

      // Bind logout
      const btnLogout = document.getElementById('btn-logout');
      if (btnLogout) {
         btnLogout.addEventListener('click', async () => {
           if(confirm('¿Seguro que quieres cerrar sesión?')) {
             await App.Auth.logout();
             window.location.reload();
           }
         });
      }

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
          
          // Clear ALL loaded module caches so data reloads with the new account
          Object.keys(this.#tabMap).forEach(v => {
            const mid = this.#tabMap[v];
            if (mid) App.Store.clearModuloLoaded(mid);
          });

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
        icono: 'add',
        size: 'sm',
        body: `<div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">
          <button style="${rs}" ${hv} onclick="window._qaClose(); App.Modules.movimientos?.abrirAlta('INGRESO')">${iw(icons.ing,'var(--verde-tint)','var(--verde)')}<span style="flex:1">Cargar Ingreso</span>${chev}</button>
          <button style="${rs}" ${hv} onclick="window._qaClose(); App.Modules.movimientos?.abrirAlta('EGRESO')">${iw(icons.egr,'var(--rojo-tint)','var(--rojo)')}<span style="flex:1">Cargar Gasto</span>${chev}</button>
          <button style="${rs}" ${hv} onclick="window._qaClose(); App.Modules.tarjetas?.abrirAlta()">${iw(icons.tc,'#eff6ff','#2563eb')}<span style="flex:1">Consumo en Tarjeta</span>${chev}</button>
          <button style="${rs}" ${hv} onclick="window._qaClose(); App.Modules.cc?.abrirAlta()">${iw(icons.cc,'#f5f3ff','#7c3aed')}<span style="flex:1">Gasto Compartido</span>${chev}</button>
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

    // Botón Admin — NO navega a ningún tab, simplemente abre el modal admin.
    const adminBtn = document.getElementById('btn-admin');
    if (adminBtn) {
      adminBtn.addEventListener('click', () => {
        if (App.Modules.admin) {
          App.Modules.admin.cargar();
        }
      });
    }

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
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(() => new AppInit().boot(), 1);
} else {
  window.addEventListener('DOMContentLoaded', () => {
    new AppInit().boot();
  });
  window.addEventListener('load', () => {
    // Fallback if DOMContentLoaded is missed
    if (!window._appInitBooted) {
      new AppInit().boot();
    }
  });
}

// Set a flag to prevent double boot
const originalBoot = AppInit.prototype.boot;
AppInit.prototype.boot = async function() {
  if (window._appInitBooted) return;
  window._appInitBooted = true;
  return originalBoot.apply(this, arguments);
};

// Actualizar versión en sidebar footer
window.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('footer-version');
  if (el) el.textContent = `v${App.VERSION} · ${new Date().getFullYear()}`;
});

App.log('app-init', 'cargado', `v${App.VERSION}`);