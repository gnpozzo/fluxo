# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **Backend:** Google Apps Script (GAS) — JavaScript V8, serverless, no Node.js
- **Base de datos:** Supabase (PostgreSQL) via REST/PostgREST — cliente en `Database.js`
- **Frontend:** HTML5 + Vanilla JS + CSS3 — sin framework, sin bundler, sin npm
- **Deploy:** GAS Webapp (`executeAs: USER_DEPLOYING`, `access: MYSELF`)
- **APIs externas:** rendimientos.co, dolarapi.com, FMP, Alpha Vantage (en `Utils.js`)

No existe paso de build. Los archivos `.html` son plantillas GAS incluidas con `<?!= include('nombre'); ?>` desde `index.html`. Todo corre en el navegador tal cual está escrito.

## Arquitectura

```
Browser → google.script.run (RPC) → GAS Functions → Supabase REST API → PostgreSQL
```

### Namespace global `App`

Todo el estado y servicios se registran bajo `window.App` (definido en `app-bootstrap.html`):

```
App.Store    → AppStore       — estado reactivo (cuenta activa, mes, módulos cargados)
App.Events   → EventBus       — Pub/Sub con CustomEvent (módulos NUNCA se llaman entre sí)
App.API      → GasApiClient   — wrapper de google.script.run con cache sessionStorage
App.Icons    → IconRegistry   — catálogo SVG semántico
App.Utils    → objeto puro    — formateo, escapeHtml, debounce, fechas
App.Toast    → ToastManager   — notificaciones success/error/warning/info
App.Modal    → clase Modal    — modal dinámico reutilizable (cada módulo instancia el suyo)
App.DataTable → clase DataTable — tabla con sort, search, paginación, event delegation
App.KpiCard  → clase KpiCard  — tarjeta KPI con skeleton y formato
App.Modules  → { movimientos, tarjetas, cc, ahorro, inversiones, admin }
```

### Fases de carga en `index.html`

Los scripts se incluyen en este orden obligatorio:

1. **Infraestructura**: `app-bootstrap` → `app-utils` → `app-store` → `app-events` → `app-api` → `app-icons`
2. **Componentes UI**: `component-toast` → `component-modal` → `component-datatable` → `component-kpi-card` → `component-form-validator`
3. **Prefetch**: `app-prefetch`
4. **Módulos**: `module-movimientos` → `module-tarjetas` → `module-cc` → `module-ahorro` → `module-inversiones` → `module-admin` → `module-dashboard`
5. **Init**: `app-init` — arranca la app con `window.addEventListener('load', () => new AppInit().boot())`

En fase 4 los módulos se **registran** (`App.Modules.x = new XModule()`) pero no inicializan. `init()` se llama en `AppInit.#initModulos()` después de recibir los datos iniciales del backend.

### Ciclo de vida de un módulo

Todos los módulos extienden `BaseModule` (`app-bootstrap.html`):

```
new XModule()       → solo registra en App.Modules (sin DOM)
mod.init()          → this.#modal = new App.Modal(id)
                       this._buildVista()    — crea HTML en el <div id="vista-X">
                       this._bindListeners() — event listeners sobre DOM ya existente
                       this._subscribeEvents()
mod.cargar()        → lazy load: App.API.cached(...) → _render(data) → markModuloLoaded
mod.destruir()      → App.Store.invalidateModulo(id) — fuerza recarga en próximo cargar()
```

`BaseModule._handleCreate/Update/Delete` llaman `App.API.invalidateAll()` antes de recargar — es obligatorio para que `App.API.cached()` no devuelva datos stale.

### Módulos del sistema

| Backend | Frontend | Módulo |
|---------|----------|--------|
| `API_Movimientos.js` | `module-movimientos.html` | Ingresos/Egresos |
| `API_Tarjetas.js` | `module-tarjetas.html` | Tarjetas de crédito |
| `API_CuentaCorriente.js` | `module-cc.html` | Gastos compartidos |
| `API_Ahorro.js` | `module-ahorro.html` | Ahorro ARS/USD |
| `API_Inversiones.js` | `module-inversiones.html` | Portfolio |
| `API_Admin.js` | `module-admin.html` | Configuración (abre como modal fullscreen) |
| `Database.js` | — | Cliente HTTP Supabase (`pgSelect`, `pgInsert`, etc.) |
| `Utils.js` | — | Helpers y llamadas a APIs externas |

### Backend: patrones de Database.js

Las funciones GAS usan helpers del cliente Supabase:

```javascript
pgSelect(tabla, filtros, columnas, orden)  // GET
pgInsert(tabla, datos)                      // POST
pgUpdate(tabla, filtros, datos)             // PATCH
pgDelete(tabla, filtros)                    // DELETE
PG.eq('valor'), PG.gt('valor'), PG.in([])  // constructores de filtros
```

**Nunca** `SELECT *` en producción — listar columnas explícitamente.

### Frontend: patrones clave

**Modal** — cada módulo crea su propia instancia:
```javascript
this.#modal = new App.Modal('modal-id-unico');
this.#modal.open({ titulo, body, confirmLabel, danger, size, onConfirm, onCancel });
```
`App.Modal.open()` busca `.modal-dialog` desde `this.#overlay` (no desde `this.#el`).

**Event delegation en tablas** — `App.DataTable` registra un listener en `tbody` que busca `[data-action]`. Los botones de acción usan `data-action="edit|delete"` y `data-id="..."`.

**Módulos sin `_buildVista()`** — `AdminModule` no tiene vista propia; abre directamente un modal fullscreen desde `_bindListeners()` que vincula `#btn-admin` del topbar.

**Cache API** — `App.API.cached(fnName, args, ttl)` guarda en sessionStorage. Siempre invalidar con `App.API.invalidateAll()` o `App.API.invalidatePattern(str)` después de operaciones de escritura antes de recargar datos.

## Configuración GAS

- **Script ID:** `1bnoWS3VU1Mu_pT-aheRN9VHILuwBMLziup9VQ1JY0Lpen5R8wGjzh8m3`
- **Timezone:** `America/Argentina/Buenos_Aires`
- **Runtime:** V8

**PropertiesService** (nunca hardcodear en código):
```
SUPABASE_URL          → URL del proyecto Supabase
SUPABASE_ANON_KEY     → service_role key (backend-only, nunca al browser)
OWNER_EMAIL           → guard de autenticación en operaciones destructivas
FMP_API_KEY           → Financial Modeling Prep (opcional)
ALPHA_VANTAGE_API_KEY → Alpha Vantage (opcional)
```

## Estándares de código

### Estructura de archivos frontend
```javascript
// --- SECCIÓN 0: CLASE XModule ---
// --- SECCIÓN 1: CICLO DE VIDA ---
// --- SECCIÓN 2: RENDER ---
// --- SECCIÓN 3: BUILD DOM ---
// --- SECCIÓN 4: MODAL ---
// --- SECCIÓN 5: CRUD ---
// --- SECCIÓN 6: LISTENERS ---
// --- SECCIÓN 7: HELPERS ---
// --- REGISTRO ---
App.Modules.x = new XModule();
```

### Reglas críticas
- `"use strict"`, `===`, `const`/`let` (nunca `var`)
- Logs: `App.log('Módulo', 'método', 'acción')` — formato `[Módulo -> método -> acción]`
- `google.script.run` solo via `App.API.call(fnName, ...args)` o `App.API.cached(...)`
- Los módulos no se llaman entre sí directamente — usar `App.Events.emit(evento, datos)`
- `SELECT *` prohibido en backend — columnas explícitas siempre

## Reglas de entrega

1. Listar archivos antes de escribir: "Archivos a modificar/crear: (Archivo X de N)"
2. Explicar la integración con módulos existentes antes de mostrar código
3. Entregar archivos **uno por uno** y esperar confirmación explícita
4. Al final de cada archivo preguntar: "¿Procedo con el siguiente archivo (nombre + X de Y)?"
5. **NUNCA** eliminar, resumir ni comentar líneas de código validadas
6. Al modificar un archivo: entregar el código **completo**
7. No modificar funciones que funcionan si no forman parte del requerimiento
