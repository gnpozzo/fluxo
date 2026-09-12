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
    'vista-tarjetas'    : 'tarjetas',
    'vista-cc'          : 'cc',
    'vista-ahorro'      : 'ahorro',
    'vista-inversiones' : 'inversiones'
  };

  #modalNotificaciones = null;
  #modalRecordatorio    = null;

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
        const remember = document.getElementById('login-remember')?.checked !== false;
        await App.Auth.login(email, pwd, remember);
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
          const fullName = document.getElementById('login-name')?.value?.trim() || '';
          if (!email || pwd.length < 6) {
             App.Toast.error('Ingresa un email y una contraseña (mín. 6 chars)');
             regBtn.disabled = false;
             regBtn.innerHTML = 'Crear Cuenta';
             return;
          }
          await App.Auth.signUp(email, pwd, fullName);
          
          if (App.Auth.session) {
             overlay.style.display = 'none';
             document.querySelector('.main-wrapper').style.display = '';
             document.getElementById('app-sidebar').style.display = 'flex';
             this.#mostrarLoader();
             this.#proceedWithBoot();
          } else {
             App.Toast.success('Registrado con éxito. Revisa tu casilla para verificar tu cuenta e ingresar.');
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
          const remember = document.getElementById('login-remember')?.checked !== false;
          await App.Auth.loginWithGoogle(remember);
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
      // Carga inicial de datos maestros inmediata
      const initialDataPromise = App.API.cached('api_getInitialData', [], 30_000)
        .catch(err => {
          App.warn('AppInit', 'getInitialData failed:', err.message);
          return null;
        });

      // Cotizaciones Dólar en segundo plano (no bloquea la visualización inicial de saldos)
      App.API.cached('api_getDolarCotizaciones', [], 10 * 60_000)
        .then(pDolar => {
          if (pDolar && pDolar.success) {
            if (pDolar.bolsa) App.Store.setExchangeRate(pDolar.bolsa.venta);
            if (pDolar.oficial) App.Store.setDolarOficial(pDolar.oficial.venta);
          }
        })
        .catch(err => {
          App.warn('AppInit', 'getDolarCotizaciones notice:', err.message);
        });

      const initialData = await initialDataPromise;

      const defaultCuentas = [
        { id_cuenta_principal: 'Principal', nombre: 'Principal', es_predeterminada: true, activa: true, modulo_tarjetas_activo: true, modulo_cc_activo: true, modulo_ahorro_activo: true, modulo_inversiones_activo: true }
      ];

      const cuentas = initialData?.cuentas?.length ? initialData.cuentas : defaultCuentas;
      const meses = initialData?.meses?.length ? initialData.meses : [];

      // Llenar Store con datos maestros
      App.Store.setCuentas(cuentas);
      if (meses.length) App.Store.setMeses(meses);

      // Cachear categorías y tarjetas en los módulos
      window._appCategorias = initialData?.categorias || [];
      window._appTarjetas   = initialData?.tarjetas   || [];
      window._appUsuariosCC = initialData?.usuarios_cc || [];
      window._appSubcuentas = initialData?.subcuentas || [];

      // Configurar cuenta inicial
      const cuentaPred = cuentas.find(c => c.es_predeterminada) || cuentas[0];
      if (cuentaPred) {
        App.Store.setCuenta(cuentaPred.id_cuenta_principal);
      }

      // Configurar selectores del DOM
      this.#syncSelectorDom(cuentas);
      if (meses.length) this.#syncMesDom(meses);

      // Configurar Account Selector
      this.#setupAccountSelector(cuentas);
      
      // Configurar Quick Add global
      this.#setupQuickAdd();

      // Configurar credentials dropdown
      this.#setupCredentialsDropdown();

      // Actualizar visibilidad de tabs según config de la cuenta
      this.#actualizarVisibilidadTabs(cuentaPred);

      // Cargar info de usuario en paralelo (no bloquea UI)
      this.#cargarUsuario();

      // Configurar Currency Pills (Bimonetario)
      this.#setupCurrencyPills();

      // Configurar Global Saldo Card
      this.#setupGlobalSaldoCard();

      // Configurar Centro de Notificaciones
      this.#setupNotifications();
      this.#cargarNotificaciones();

      // Inicializar Asistente Gemini AI
      if (App.Gemini) {
        App.Gemini.init();
      }

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

      // Bind mobile sidebar toggle
      const btnSidebarToggle = document.getElementById('sidebar-toggle');
      const sidebarEl = document.getElementById('app-sidebar');
      const backdropEl = document.getElementById('sidebar-backdrop');
      btnSidebarToggle?.addEventListener('click', () => {
        sidebarEl?.classList.toggle('sidebar-open');
        backdropEl?.classList.toggle('open');
      });
      backdropEl?.addEventListener('click', () => {
        sidebarEl?.classList.remove('sidebar-open');
        backdropEl?.classList.remove('open');
      });

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

    // Control Subview Breadcrumb / Back Bar visibility (shown on sub-modules)
    const subviewNavBar = document.getElementById('subview-nav-bar');
    const subviewTitle = document.getElementById('subview-breadcrumb-title');
    if (subviewNavBar) {
      const isDashboard = (vistaId === 'vista-dashboard');
      subviewNavBar.style.display = isDashboard ? 'none' : 'flex';
      if (!isDashboard && subviewTitle) {
        const titles = {
          'vista-tarjetas': 'Tarjetas de Crédito',
          'vista-cc': 'Gastos Compartidos',
          'vista-ahorro': 'Chanchito (Ahorro)',
          'vista-inversiones': 'Inversiones',
          'vista-admin': 'Configuración'
        };
        subviewTitle.textContent = titles[vistaId] || 'Módulo';
      }
    }

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

    // Renderizar botonera adaptativa de módulos
    this.#renderModulesNav(vistaId);

    // Mostrar/ocultar panel hero global según la vista (oculto en ajustes)
    const heroPanel = document.getElementById('header-hero-panel');
    if (heroPanel) {
      heroPanel.classList.toggle('hidden', vistaId === 'vista-admin');
    }

    // Mostrar/ocultar saldo card (solo se muestra en el Dashboard)
    const saldoCard = document.getElementById('dash-saldo-card');
    if (saldoCard) {
      saldoCard.classList.toggle('hidden', vistaId !== 'vista-dashboard');
    }

    // Floating Action Buttons contextual visibility:
    // En el Dashboard principal ya están las Acciones Directas en el Hero.
    // En las pantallas internas (Tarjetas, Gastos Compartidos, Chanchito, Inversiones)
    // el FAB flota para permitir registrar consumos rápidamente sin volver al inicio.
    const fabGroup = document.getElementById('fab-group');
    if (fabGroup) {
      const shouldHide = (vistaId === 'vista-dashboard' || vistaId === 'vista-admin');
      fabGroup.classList.toggle('hidden-contextual', shouldHide);
    }

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
      welcomeBar.classList.toggle('integrated', vistaId === 'vista-dashboard');
    }

    App.Events.emit('ui:tab-changed', { tabId: vistaId });
    App.updateAccountSelectorVisibility(vistaId);
    App.log('AppInit', '#navegarTab', vistaId);
  }

  // --- SECCIÓN 3: ACCOUNT SELECTOR ---

  #setupAccountSelector(cuentas) {
    if (!cuentas || cuentas.length === 0) return;

    const selectWrap = document.getElementById('account-select-ui');
    const selectEl   = document.getElementById('selector-cuenta');
    if (!selectEl) return;

    if (cuentas.length > 0 && selectWrap) {
      selectEl.addEventListener('change', (e) => {
        App.Store.setCuenta(e.target.value);
      });

      App.Events.on('store:cuenta-changed', (payload) => {
        const nuevaId = payload.cuenta;
        selectEl.value = nuevaId;

        const cuentaObj = cuentas.find(c => c.id_cuenta_principal === nuevaId);
        if (cuentaObj) {
          this.#actualizarVisibilidadTabs(cuentaObj);
          this.#renderModulesNav(this.#tabActivo);

          // Clear ALL loaded module caches so data reloads with the new account
          Object.keys(this.#tabMap).forEach(v => {
            const mid = this.#tabMap[v];
            if (mid) App.Store.invalidateModulo(mid);
          });

          this.#cargarNotificaciones(); // Refrescar notificaciones

          // Recargar módulo activo con la nueva cuenta
          const modId = this.#tabMap[this.#tabActivo];
          if (modId && App.Modules[modId]) {
            App.Modules[modId].destruir();
            App.Modules[modId].cargar();
          }
        }
      });
    }
  }

  // --- SECCIÓN 3B: CURRENCY PILLS ---

  #setupCurrencyPills() {
    const container = document.getElementById('currency-pills');
    const pillArs = document.getElementById('pill-ars');
    const pillUsd = document.getElementById('pill-usd');
    if (!container || !pillArs || !pillUsd) return;

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

    container.addEventListener('click', (e) => {
      const pill = e.target.closest('.currency-pill');
      if (pill) {
        setActivePill(pill.dataset.currency);
      } else {
        // Toggling currency if clicked on the track/knob area
        const currentCurrency = App.Store.currency || 'ARS';
        setActivePill(currentCurrency === 'ARS' ? 'USD' : 'ARS');
      }
    });
  }

  // --- SECCIÓN 3C: GLOBAL SALDO CARD ---

  #setupGlobalSaldoCard() {
    const card = document.getElementById('dash-saldo-card');
    if (!card) return;
    card.addEventListener('click', () => {
      const breakdown = document.getElementById('dash-saldo-breakdown');
      const chevron = document.getElementById('dash-saldo-chevron');
      const isExpanded = breakdown?.classList.toggle('collapsed') === false;
      chevron?.classList.toggle('rotated', isExpanded);
      card.setAttribute('aria-expanded', isExpanded);
    });
  }

  // --- SECCIÓN 3D: ADAPTIVE MODULES NAVIGATION ---

  #renderModulesNav(vistaId) {
    const navContainer = document.getElementById('dash-modules-nav');
    if (!navContainer) return;

    const cuentaId = App.Store.cuenta;
    if (!cuentaId) {
      navContainer.innerHTML = '';
      return;
    }

    const cuentaObj = App.Store.cuentas.find(c => c.id_cuenta_principal === cuentaId);
    if (!cuentaObj) {
      navContainer.innerHTML = '';
      return;
    }

    const modules = [];

    // Dashboard button always placed first when navigating inside other modules
    if (vistaId !== 'vista-dashboard') {
      modules.push({
        id: 'dashboard',
        label: 'Dashboard',
        vista: 'vista-dashboard',
        color: 'var(--primary)',
        bg: 'var(--primary-tint)',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`
      });
    }

    const hasTarjetas = (window._appTarjetas || []).some(t => t.id_cuenta_principal === cuentaObj.id_cuenta_principal);
    const hasAhorro = (window._appSubcuentas || []).some(s => s.id_cuenta_principal === cuentaObj.id_cuenta_principal);

    if (hasTarjetas && vistaId !== 'vista-tarjetas') {
      modules.push({
        id: 'tarjetas',
        label: 'Tarjetas',
        vista: 'vista-tarjetas',
        color: 'var(--rojo)',
        bg: 'var(--rojo-tint)',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`
      });
    }

    if (cuentaObj.modulo_cc_activo && vistaId !== 'vista-cc') {
      modules.push({
        id: 'cc',
        label: 'Gastos compartidos',
        vista: 'vista-cc',
        color: 'var(--verde)',
        bg: 'var(--verde-tint)',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
      });
    }

    if (hasAhorro && vistaId !== 'vista-ahorro') {
      modules.push({
        id: 'ahorro',
        label: 'Chanchito',
        vista: 'vista-ahorro',
        color: 'var(--amarillo-text)',
        bg: 'var(--amarillo-tint)',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>`
      });
    }

    if (cuentaObj.modulo_inversiones_activo && vistaId !== 'vista-inversiones') {
      modules.push({
        id: 'inversiones',
        label: 'Inversiones',
        vista: 'vista-inversiones',
        color: 'var(--cyan, #0ea5e9)',
        bg: 'rgba(14, 165, 233, 0.1)',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`
      });
    }

    navContainer.innerHTML = modules.map(m => `
      <button class="dash-modules-nav-btn" data-vista="${m.vista}">
        <div class="dash-modules-nav-icon" style="background:${m.bg}; color:${m.color};">
          ${m.svg}
        </div>
        <span class="dash-modules-nav-label">${m.label}</span>
      </button>
    `).join('');

    navContainer.querySelectorAll('.dash-modules-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.#navegarTab(btn.dataset.vista);
      });
    });
  }

  // --- SECCIÓN 4: TABS ---

  #actualizarVisibilidadTabs(cuentaObj) {
    if (!cuentaObj) return;
    const hasTarjetas = (window._appTarjetas || []).some(t => t.id_cuenta_principal === cuentaObj.id_cuenta_principal);
    const hasAhorro = (window._appSubcuentas || []).some(s => s.id_cuenta_principal === cuentaObj.id_cuenta_principal);

    const modulos = [
      { tab: 'tab-btn-tarjetas',   active: hasTarjetas },
      { tab: 'tab-btn-cc',         active: cuentaObj.modulo_cc_activo },
      { tab: 'tab-btn-ahorro',     active: hasAhorro },
      { tab: 'tab-btn-inversiones',active: cuentaObj.modulo_inversiones_activo }
    ];
    modulos.forEach(({ tab, active }) => {
      const btn = document.getElementById(tab);
      if (btn) btn.style.display = active ? '' : 'none';
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
        titulo: '¿Qué vas a registrar?',
        icono: 'add',
        size: 'sm',
        body: `<div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">
          <button style="${rs}" ${hv} onclick="window._qaClose(); App.Modules.movimientos?.abrirAlta('EGRESO')">${iw(icons.egr,'var(--rojo-tint)','var(--rojo)')}<span style="flex:1">Gasto al Contado</span>${chev}</button>
          <button style="${rs}" ${hv} onclick="window._qaClose(); App.Modules.tarjetas?.abrirAlta()">${iw(icons.tc,'#eff6ff','#2563eb')}<span style="flex:1">Consumo en Tarjeta</span>${chev}</button>
          <button style="${rs}" ${hv} onclick="window._qaClose(); App.Modules.movimientos?.abrirAlta('INGRESO')">${iw(icons.ing,'var(--verde-tint)','var(--verde)')}<span style="flex:1">Nuevo Ingreso / Sueldo</span>${chev}</button>
          <button style="${rs}" ${hv} onclick="window._qaClose(); App.Modules.cc?.abrirAlta()">${iw(icons.cc,'#f5f3ff','#7c3aed')}<span style="flex:1">Gasto Compartido (Clearing)</span>${chev}</button>
          <button style="${rs}" ${hv} onclick="window._qaClose(); App.Modules.ahorro?.abrirAlta()">${iw(icons.ah,'var(--amarillo-tint)','var(--amarillo-text)')}<span style="flex:1">Guardar en Chanchito</span>${chev}</button>
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

    // Bind subview back button and breadcrumb parent
    document.getElementById('btn-subview-back')?.addEventListener('click', () => {
      this.#navegarTab('vista-dashboard');
    });
    document.getElementById('subview-bc-parent')?.addEventListener('click', () => {
      this.#navegarTab('vista-dashboard');
    });

    // Bind logo to return to dashboard
    const headerLogo = document.getElementById('app-header-logo');
    if (headerLogo) {
      headerLogo.addEventListener('click', () => {
        this.#navegarTab('vista-dashboard');
      });
    }

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

  #getReadNotificationIds() {
    try {
      const read = localStorage.getItem('fluxo_read_notifications');
      return read ? JSON.parse(read) : [];
    } catch (e) {
      return [];
    }
  }

  #markNotificationAsRead(id) {
    try {
      const read = this.#getReadNotificationIds();
      if (!read.includes(id)) {
        read.push(id);
        localStorage.setItem('fluxo_read_notifications', JSON.stringify(read));
      }
    } catch (e) {
      console.error('Error marking notification as read:', e);
    }
  }

  #actualizarBadgeNotifications() {
    const badge = document.getElementById('badge-notifications');
    if (!badge) return;
    const readIds = this.#getReadNotificationIds();
    const unread = this.#notificacionesMes.filter(n => !readIds.includes(n.id));
    badge.style.display = unread.length > 0 ? 'block' : 'none';
  }

  #renderNotificationsDropdown() {
    const dropdown = document.getElementById('notifications-dropdown');
    if (!dropdown) return;

    const readIds = this.#getReadNotificationIds();
    const unread = this.#notificacionesMes.filter(n => !readIds.includes(n.id));

    let bodyHtml = '';
    if (unread.length === 0) {
      bodyHtml = '<div style="padding:24px; color:var(--texto-3); text-align:center; font-size:0.85rem;">No hay nuevas notificaciones</div>';
    } else {
      bodyHtml = unread.map(n => `
        <div class="notification-item" data-id="${n.id}">
          <div class="notification-icon-wrapper ${n.tipo === 'info' ? 'info' : 'ingreso'}">
            ${App.Icons?.get(n.icono, 'icon-md') || ''}
          </div>
          <div class="notification-content">
            <h4 class="notification-title">${App.Utils.escapeHtml(n.titulo)}</h4>
            <p class="notification-message">${App.Utils.escapeHtml(n.mensaje)}</p>
            <div class="notification-amount">${App.Utils.formatearMoneda(n.importe)}</div>
          </div>
          <div class="notification-badge-unread"></div>
        </div>
      `).join('');
    }

    dropdown.innerHTML = `
      <div class="notifications-dropdown-header">
        <span>Notificaciones</span>
        <span style="font-size:0.8rem; font-weight:normal; color:var(--texto-2);">${unread.length} pendientes</span>
      </div>
      <div class="notifications-dropdown-body">
        ${bodyHtml}
      </div>
      <div class="notifications-dropdown-footer">
        <button class="btn-notifications-center" id="btn-notifications-center">Centro de notificaciones</button>
      </div>
    `;

    // Bind event listeners to notification items
    dropdown.querySelectorAll('.notification-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = item.dataset.id;
        this.#markNotificationAsRead(id);
        App.Toast.success('Notificación marcada como leída');
        this.#actualizarBadgeNotifications();
        this.#renderNotificationsDropdown();
      });
    });

    // Bind event listener to footer button
    document.getElementById('btn-notifications-center')?.addEventListener('click', () => {
      dropdown.classList.remove('open');
      this.#abrirCentroNotificaciones();
    });
  }

  #abrirCentroNotificaciones() {
    const cuenta = App.Store.cuenta;
    if (!cuenta) return;

    if (!this.#modalNotificaciones) {
      this.#modalNotificaciones = new App.Modal('modal-notifications');
    }
    const m = this.#modalNotificaciones;

    const baseHtml = `
      <div class="notif-center-nav">
        <button class="notif-nav-btn active" id="notif-tab-reminders" data-notif-tab="reminders">
          ${App.Icons?.get('clock', 'icon-sm') || '🔔'} Recordatorios Programados
        </button>
        <button class="notif-nav-btn" id="notif-tab-history" data-notif-tab="history">
          ${App.Icons?.get('info', 'icon-sm') || '📋'} Historial de Alertas
        </button>
      </div>
      <div id="notif-content-area" style="min-height:320px; max-height:480px; overflow-y:auto; padding-right:4px;">
        <div style="padding:40px; text-align:center;"><div class="spinner"></div><p style="margin-top:12px;color:var(--texto-3);">Cargando recordatorios...</p></div>
      </div>
    `;

    m.open({
      titulo: 'Centro de Notificaciones',
      icono: 'info',
      body: baseHtml,
      size: 'lg',
      confirmLabel: '',
      cancelLabel: 'Cerrar'
    });

    const cb = m.el.querySelector('.modal-confirm');
    if (cb) cb.style.display = 'none';
    const xb = m.el.querySelector('.modal-cancel');
    if (xb) { xb.classList.replace('btn-ghost', 'btn-outline'); xb.style.borderRadius = 'var(--r)'; }

    // Bind tab clicks
    const btnReminders = m.el.querySelector('#notif-tab-reminders');
    const btnHistory = m.el.querySelector('#notif-tab-history');

    const switchTab = (tab) => {
      if (tab === 'reminders') {
        btnReminders?.classList.add('active');
        btnHistory?.classList.remove('active');
        this.#cargarTabRecordatorios(m);
      } else {
        btnHistory?.classList.add('active');
        btnReminders?.classList.remove('active');
        this.#cargarTabHistorial(m);
      }
    };

    btnReminders?.addEventListener('click', () => switchTab('reminders'));
    btnHistory?.addEventListener('click', () => switchTab('history'));

    // Start with reminders
    this.#cargarTabRecordatorios(m);
  }

  async #cargarTabRecordatorios(m) {
    const area = m.el.querySelector('#notif-content-area');
    if (!area) return;
    area.innerHTML = '<div style="padding:40px; text-align:center;"><div class="spinner"></div><p style="margin-top:12px;color:var(--texto-3);">Cargando recordatorios activos...</p></div>';

    try {
      const cuenta = App.Store.cuenta;
      const res = await App.API.call('admin_getRecordatorios', cuenta);
      const list = res?.data || [];

      let listHtml = '';
      if (list.length === 0) {
        listHtml = `
          <div style="text-align:center; padding:36px 16px; color:var(--texto-3); border:1px dashed var(--borde); border-radius:var(--r);">
            <div style="font-size:2rem; margin-bottom:8px;">🔔</div>
            <p style="margin:0 0 6px; font-weight:600; color:var(--texto-2);">No tenés recordatorios configurados</p>
            <p style="font-size:0.8rem; margin:0 0 16px;">Podés programar alertas automáticas para fechas de vencimiento de resúmenes, cierres y pagos periódicos.</p>
            <button class="btn btn-primary btn-sm" id="btn-nuevo-recordatorio-empty">
              ${App.Icons?.get('add', 'icon-sm') || '+'} Crear mi primer recordatorio
            </button>
          </div>
        `;
      } else {
        listHtml = list.map(r => {
          const isActiva = r.activa !== false;
          const fechaFormateada = r.fecha_proxima ? App.Utils.formatearFecha(r.fecha_proxima) : 'Fecha sin definir';
          const freqLabel = r.frecuencia === 'MENSUAL' ? 'Mensual' : (r.frecuencia === 'UNICA' ? 'Única vez' : (r.frecuencia || 'Periódica'));

          return `
            <div class="reminder-card ${!isActiva ? 'inactive' : ''}" data-id="${r.id_recordatorio}">
              <div class="reminder-card-content">
                <p class="reminder-msg">${App.Utils.escapeHtml(r.mensaje)}</p>
                <div class="reminder-meta">
                  <span>📅 Próximo: <strong>${fechaFormateada}</strong></span>
                  <span>🔄 ${App.Utils.escapeHtml(freqLabel)}</span>
                  <span>📡 Canales: ${App.Utils.escapeHtml(r.canales || 'App')}</span>
                </div>
              </div>
              <div class="reminder-actions">
                <label class="toggle-switch" title="${isActiva ? 'Desactivar recordatorio' : 'Activar recordatorio'}">
                  <input type="checkbox" class="reminder-toggle-check" data-id="${r.id_recordatorio}" ${isActiva ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
                <button class="btn-icon reminder-btn-edit" data-id="${r.id_recordatorio}" title="Editar recordatorio">
                  ${App.Icons?.get('edit', 'icon-sm') || '✏️'}
                </button>
                <button class="btn-icon reminder-btn-delete" data-id="${r.id_recordatorio}" title="Eliminar recordatorio" style="color:var(--rojo);">
                  ${App.Icons?.get('delete', 'icon-sm') || '🗑️'}
                </button>
              </div>
            </div>
          `;
        }).join('');
      }

      area.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <div>
            <h4 style="margin:0; font-size:0.95rem; font-weight:700; color:var(--texto);">Recordatorios y Notificaciones Activas</h4>
            <span style="font-size:0.75rem; color:var(--texto-3);">${list.length} configurados</span>
          </div>
          <button class="btn btn-primary btn-sm" id="btn-nuevo-recordatorio">
            ${App.Icons?.get('add', 'icon-sm') || '+'} Nuevo Recordatorio
          </button>
        </div>
        <div class="reminders-list-container">
          ${listHtml}
        </div>
      `;

      // Bind actions
      area.querySelector('#btn-nuevo-recordatorio')?.addEventListener('click', () => {
        this.#abrirModalFormRecordatorio(null, m);
      });
      area.querySelector('#btn-nuevo-recordatorio-empty')?.addEventListener('click', () => {
        this.#abrirModalFormRecordatorio(null, m);
      });

      // Toggle switch
      area.querySelectorAll('.reminder-toggle-check').forEach(chk => {
        chk.addEventListener('change', async (e) => {
          const id = e.target.dataset.id;
          const target = list.find(it => it.id_recordatorio === id);
          if (!target) return;
          const newStatus = e.target.checked;
          try {
            await App.API.call('admin_saveRecordatorio', { ...target, activa: newStatus });
            App.Toast.success(newStatus ? 'Recordatorio activado' : 'Recordatorio pausado');
            const card = area.querySelector(`.reminder-card[data-id="${id}"]`);
            if (card) card.classList.toggle('inactive', !newStatus);
          } catch (err) {
            e.target.checked = !newStatus; // revert
            App.Toast.error('Error al actualizar recordatorio: ' + err.message);
          }
        });
      });

      // Edit buttons
      area.querySelectorAll('.reminder-btn-edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const target = list.find(it => it.id_recordatorio === id);
          if (target) this.#abrirModalFormRecordatorio(target, m);
        });
      });

      // Delete buttons
      area.querySelectorAll('.reminder-btn-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          if (!confirm('¿Seguro que deseas eliminar este recordatorio?')) return;
          try {
            await App.API.call('admin_deleteRecordatorio', { id_recordatorio: id });
            App.Toast.success('Recordatorio eliminado');
            this.#cargarTabRecordatorios(m);
          } catch (err) {
            App.Toast.error('Error al eliminar: ' + err.message);
          }
        });
      });

    } catch (err) {
      console.error('Error cargando recordatorios:', err);
      area.innerHTML = `<p class="negativo" style="text-align:center; padding:24px;">Error al cargar recordatorios: ${App.Utils.escapeHtml(err.message)}</p>`;
    }
  }

  async #cargarTabHistorial(m) {
    const area = m.el.querySelector('#notif-content-area');
    if (!area) return;
    area.innerHTML = '<div style="padding:40px; text-align:center;"><div class="spinner"></div><p style="margin-top:12px;color:var(--texto-3);">Cargando historial de notificaciones...</p></div>';

    const cuenta = App.Store.cuenta;
    const baseMonth = App.Store.mes || new Date().toISOString().substring(0, 7);
    const [y, mo] = baseMonth.split('-').map(Number);
    const months = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(y, mo - 1 - i, 1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      months.push(`${yyyy}-${mm}`);
    }

    try {
      const responses = await Promise.all(months.map(month => App.API.call('api_getNotificaciones', cuenta, month).catch(() => null)));
      let allNotif = [];
      responses.forEach(res => {
        if (res && res.success && Array.isArray(res.data)) {
          allNotif = allNotif.concat(res.data);
        }
      });

      // Deduplicate
      const seen = new Set();
      allNotif = allNotif.filter(n => {
        if (seen.has(n.id)) return false;
        seen.add(n.id);
        return true;
      });

      // Sort descending by date
      allNotif.sort((a, b) => {
        const dateA = a.fecha || '0000-00-00';
        const dateB = b.fecha || '0000-00-00';
        return dateB.localeCompare(dateA);
      });

      const readIds = this.#getReadNotificationIds();

      let contentHtml = '';
      if (allNotif.length === 0) {
        contentHtml = '<div style="padding:24px; color:var(--texto-3); text-align:center;">No hay alertas ni avisos registrados en los últimos 6 meses.</div>';
      } else {
        contentHtml = '<div style="display:flex; flex-direction:column; gap:10px;">' +
          allNotif.map(n => {
            const isRead = readIds.includes(n.id);
            return `
              <div class="notification-item ${isRead ? 'read-in-history' : ''}" style="border:1px solid var(--borde); border-radius:var(--r); padding:12px; background:var(--superficie); display:flex; gap:12px; align-items:center; cursor:pointer;" data-id="${n.id}">
                <div class="notification-icon-wrapper ${n.tipo === 'info' ? 'info' : 'ingreso'}">
                  ${App.Icons?.get(n.icono, 'icon-md') || ''}
                </div>
                <div style="flex-grow:1">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h4 style="margin:0; font-size:0.9rem; color:var(--texto); font-weight:700;">${App.Utils.escapeHtml(n.titulo)}</h4>
                    <span style="font-size:0.75rem; color:var(--texto-3);">${App.Utils.formatearFecha(n.fecha)}</span>
                  </div>
                  <p style="margin:4px 0 0; font-size:0.8rem; color:var(--texto-2); line-height:1.3;">${App.Utils.escapeHtml(n.mensaje)}</p>
                  ${n.importe ? `
                  <div style="margin-top:6px; font-weight:600; font-size:0.85rem; color:${n.tipo === 'info' ? 'var(--color-info)' : 'var(--color-success)'}">
                    ${App.Utils.formatearMoneda(n.importe)}
                  </div>` : ''}
                </div>
                ${!isRead ? '<div class="notification-badge-unread"></div>' : ''}
              </div>
            `;
          }).join('') +
          '</div>';
      }

      area.innerHTML = contentHtml;
      area.querySelectorAll('.notification-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.dataset.id;
          const currentRead = this.#getReadNotificationIds();
          if (!currentRead.includes(id)) {
            this.#markNotificationAsRead(id);
            App.Toast.success('Notificación marcada como leída');
            this.#actualizarBadgeNotifications();
            item.classList.add('read-in-history');
            item.querySelector('.notification-badge-unread')?.remove();
          }
        });
      });
    } catch (err) {
      console.error('Error loading notification history:', err);
      area.innerHTML = `<p class="negativo" style="text-align:center;">Error al cargar el historial: ${App.Utils.escapeHtml(err.message)}</p>`;
    }
  }

  #abrirModalFormRecordatorio(recordatorio = null, parentModal = null) {
    if (!this.#modalRecordatorio) {
      this.#modalRecordatorio = new App.Modal('modal-edit-recordatorio');
    }
    const isEdit = !!recordatorio;
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 3);
    const dateVal = recordatorio?.fecha_proxima ? String(recordatorio.fecha_proxima).substring(0, 10) : defaultDate.toISOString().substring(0, 10);

    const formHtml = `
      <form id="form-recordatorio-edit" style="display:flex; flex-direction:column; gap:14px;">
        <div class="form-group">
          <label style="font-size:0.82rem; font-weight:600; color:var(--texto-2); margin-bottom:4px; display:block;">Mensaje del recordatorio *</label>
          <textarea class="input" name="mensaje" rows="3" required placeholder="Ej: Vencimiento de tarjeta Visa o pago de servicio..." style="resize:vertical;">${App.Utils.escapeHtml(recordatorio?.mensaje || '')}</textarea>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div class="form-group">
            <label style="font-size:0.82rem; font-weight:600; color:var(--texto-2); margin-bottom:4px; display:block;">Próxima Fecha de Alerta *</label>
            <input type="date" class="input" name="fecha_proxima" value="${dateVal}" required>
          </div>
          <div class="form-group">
            <label style="font-size:0.82rem; font-weight:600; color:var(--texto-2); margin-bottom:4px; display:block;">Frecuencia</label>
            <select class="input" name="frecuencia">
              <option value="MENSUAL" ${recordatorio?.frecuencia === 'MENSUAL' ? 'selected' : ''}>Mensual</option>
              <option value="UNICA" ${recordatorio?.frecuencia === 'UNICA' ? 'selected' : ''}>Una sola vez</option>
              <option value="DIAS_HABILES" ${recordatorio?.frecuencia === 'DIAS_HABILES' ? 'selected' : ''}>Días Hábiles</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label style="font-size:0.82rem; font-weight:600; color:var(--texto-2); margin-bottom:4px; display:block;">Canal de Notificación</label>
          <select class="input" name="canales">
            <option value="app,telegram" ${(recordatorio?.canales || '').includes('telegram') ? 'selected' : ''}>App Fluxo + Bot de Telegram</option>
            <option value="app" ${recordatorio?.canales === 'app' ? 'selected' : ''}>Solo App Fluxo</option>
          </select>
        </div>
        <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
          <input type="checkbox" id="chk-notif-activa" name="activa" ${recordatorio?.activa !== false ? 'checked' : ''} style="width:auto; cursor:pointer;">
          <label for="chk-notif-activa" style="font-size:0.84rem; font-weight:600; cursor:pointer; color:var(--texto);">Recordatorio activo</label>
        </div>
      </form>
    `;

    this.#modalRecordatorio.open({
      titulo: isEdit ? 'Editar Recordatorio' : 'Nuevo Recordatorio',
      icono: 'clock',
      body: formHtml,
      confirmLabel: 'Guardar',
      cancelLabel: 'Cancelar',
      size: 'md',
      onConfirm: async (subM) => {
        const form = subM.el.querySelector('#form-recordatorio-edit');
        if (!form) return;
        const fd = new FormData(form);
        const mensaje = fd.get('mensaje')?.trim();
        const fecha_proxima = fd.get('fecha_proxima');
        const frecuencia = fd.get('frecuencia');
        const canales = fd.get('canales');
        const activa = fd.get('activa') === 'on';

        if (!mensaje || !fecha_proxima) {
          App.Toast.warning('Por favor completá todos los campos requeridos');
          return;
        }

        subM.setLoading(true);
        try {
          const payload = {
            ...(recordatorio || {}),
            id_cuenta_principal: App.Store.cuenta,
            mensaje,
            fecha_proxima,
            frecuencia,
            canales,
            activa
          };
          await App.API.call('admin_saveRecordatorio', payload);
          App.Toast.success(isEdit ? 'Recordatorio actualizado' : 'Recordatorio creado con éxito');
          subM.close();
          if (parentModal) {
            this.#cargarTabRecordatorios(parentModal);
          }
        } catch (err) {
          subM.setLoading(false);
          App.Toast.error('Error al guardar recordatorio: ' + err.message);
        }
      }
    });
  }

  #setupNotifications() {
    const btnNotif = document.getElementById('btn-notifications');
    const dropdown = document.getElementById('notifications-dropdown');
    if (!btnNotif || !dropdown) return;

    btnNotif.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('credentials-dropdown')?.classList.remove('open');
      document.getElementById('topbar-avatar')?.setAttribute('aria-expanded', 'false');

      const isOpen = dropdown.classList.toggle('open');
      if (isOpen) {
        this.#renderNotificationsDropdown();
      }
    });

    document.addEventListener('click', (e) => {
      if (!btnNotif.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
      }
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
         this.#actualizarBadgeNotifications();
      })
      .catch((e) => { console.error('Error notificaciones:', e); });
  }

  async #cargarUsuario() {
    try {
      // 1. Obtener usuario inmediatamente desde la sesión activa de Supabase en memoria
      let user = App.Auth?.user;
      if (!user && App.Auth?.supabase) {
        const { data } = await App.Auth.supabase.auth.getUser();
        user = data?.user;
        if (user && App.Auth) App.Auth.user = user;
      }

      let email = user?.email || '';
      let metadata = user?.user_metadata || {};

      // 2. Si aún no está en memoria, consultar backend
      if (!email) {
        const res = await App.API.call('api_getUserInfo');
        if (res?.success) {
          email = res.email || '';
          metadata = res.user_metadata || {};
        }
      }

      if (email) {
        let fullName = metadata.full_name || metadata.name;
        if (!fullName) {
          const usernamePart = email.split('@')[0];
          fullName = usernamePart.split(/[._-]/).filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
        }
        const primerNombre = fullName.split(' ')[0] || fullName;

        // Saludo en topbar
        const elWelcome = document.getElementById('welcome-name');
        if (elWelcome) {
          elWelcome.textContent = `Hola, ${primerNombre}`;
        }

        // Nombre en topbar (accesibilidad)
        const elNombre = document.getElementById('user-info-container');
        if (elNombre) {
          elNombre.textContent = fullName;
          elNombre.title       = email;
        }

        // Tooltip del avatar
        const tooltip = document.getElementById('avatar-tooltip');
        if (tooltip) {
          tooltip.innerHTML = `<strong>${App.Utils.escapeHtml(fullName)}</strong><br>${App.Utils.escapeHtml(email)}`;
        }

        // Poblar datos en el Dropdown de perfil
        const dName = document.getElementById('dropdown-user-name');
        const dEmail = document.getElementById('dropdown-user-email');
        if (dName) dName.textContent = fullName;
        if (dEmail) dEmail.textContent = email;

        // Avatar: Imagen con foto o iniciales
        const elAvatar = document.getElementById('topbar-avatar');
        if (elAvatar) {
          const avatarUrl = metadata.avatar_url || metadata.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=1D195D&color=fff&bold=true`;
          elAvatar.innerHTML = `<img src="${avatarUrl}" alt="Avatar" onerror="this.outerHTML='<span style=\\'font-weight:700;font-size:0.85rem;\\'>${(primerNombre||'U')[0].toUpperCase()}</span>'">`;
        }

        App.Store.setUsuario({ email: email, name: fullName });
      }
    } catch (err) {
      console.warn('[AppInit] Error al cargar usuario:', err);
    }
  }

  #setupCredentialsDropdown() {
    const avatar = document.getElementById('topbar-avatar');
    const dropdown = document.getElementById('credentials-dropdown');
    
    if (avatar && dropdown) {
      avatar.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('notifications-dropdown')?.classList.remove('open');
        const isOpen = dropdown.classList.toggle('open');
        avatar.setAttribute('aria-expanded', isOpen);

        if (isOpen) {
          // Re-sincronizar credenciales si el dropdown tiene valor por defecto
          const dName = document.getElementById('dropdown-user-name');
          if (!dName || dName.textContent === '—' || !dName.textContent.trim()) {
            this.#cargarUsuario();
          }
          const themeText = document.getElementById('dropdown-theme-text');
          if (themeText) {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            themeText.textContent = currentTheme === 'dark' ? 'Modo claro' : 'Modo oscuro';
          }
        }
      });

      avatar.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          avatar.click();
        }
      });

      document.addEventListener('click', (e) => {
        if (!avatar.contains(e.target) && !dropdown.contains(e.target)) {
          dropdown.classList.remove('open');
          avatar.setAttribute('aria-expanded', 'false');
        }
      });
      
      document.getElementById('dropdown-opt-config')?.addEventListener('click', () => {
        dropdown.classList.remove('open');
        document.getElementById('btn-admin')?.click();
      });

      document.getElementById('dropdown-opt-theme')?.addEventListener('click', () => {
        dropdown.classList.remove('open');
        if (typeof window.toggleAppTheme === 'function') {
          window.toggleAppTheme();
        } else {
          document.getElementById('btn-theme-toggle')?.click();
        }
      });

      document.getElementById('dropdown-opt-about')?.addEventListener('click', () => {
        dropdown.classList.remove('open');
        if (App.Modal) {
          const m = new App.Modal('modal-about');
          m.open({
            titulo: 'Acerca de Fluxo',
            body: `
              <div style="text-align:center;padding:20px 10px;">
                <img src="/Fluxo-logo-azul.png" alt="Fluxo Logo" style="width:170px;margin-bottom:16px;object-fit:contain;" class="modal-logo">
                <p style="font-weight:600;margin-bottom:8px;">Fluxo — Gestión Inteligente de Finanzas</p>
                <p style="font-size:0.85rem;color:var(--texto-2);margin-bottom:20px;">Versión 6.0.0 (Rediseño Mobile-First)</p>
                <div style="border-top:1px solid var(--borde);padding-top:16px;font-size:0.82rem;color:var(--texto-2);">
                  <p>Desarrollado con amor para la gestión financiera personal y familiar.</p>
                  <p style="margin-top:8px;">© ${new Date().getFullYear()} Fluxo Inc.</p>
                </div>
              </div>
            `,
            confirmLabel: 'Aceptar',
            cancelLabel: 'Cerrar'
          });
        } else if (App.Toast) {
          App.Toast.info('Fluxo v6.0.0 — Gestión Inteligente de Finanzas');
        }
      });

      document.getElementById('dropdown-opt-logout')?.addEventListener('click', () => {
        dropdown.classList.remove('open');
        document.getElementById('btn-logout')?.click();
      });
    }
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