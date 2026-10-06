// [Origen -> src -> main.js]
// v2.1.0
// QA Passed: Bootstrap and Dependency Injection completely wired.

import './styles/main.css';
import './core/Shell.js';

// 1. Initialize namespace and BaseModule
import { BaseModule } from './core/AppBootstrap.js';

// 2. Load Core Services
import { EventBus } from './core/EventBus.js';
window.App.Events = EventBus;

import { Auth } from './core/Auth.js';
window.App.Auth = Auth;

import { API } from './core/AppAPI.js';
window.App.API = API;

import './core/AppStore.js';
import './core/AppUtils.js';
import './core/AppGemini.js';

// 3. UI Components
import { ToastManager } from './components/Toast.js';
if (!window.App.Toast) window.App.Toast = new ToastManager();
import { Modal } from './components/Modal.js';
window.App.Modal = Modal;
import { DataTable } from './components/DataTable.js';
window.App.DataTable = DataTable;
import { FormValidator } from './components/FormValidator.js';
window.App.FormValidator = FormValidator;
import "./core/AppIcons.js";

import { KpiCard } from './components/KpiCard.js';
window.App.KpiCard = KpiCard;

// Modules are loaded when opened; login and core do not download every screen.
import { lazyModule } from './core/LazyModule.js';
window.App.Modules.dashboard=lazyModule('dashboard',()=>import('./modules/DashboardModule.js'),'DashboardModule');
window.App.Modules.movimientos=lazyModule('movimientos',()=>import('./modules/MovimientosModule.js'),'MovimientosModule');
window.App.Modules.tarjetas=lazyModule('tarjetas',()=>import('./modules/TarjetasModule.js'),'TarjetasModule');
window.App.Modules.cc=lazyModule('cc',()=>import('./modules/CcModule.js'),'CCModule');
window.App.Modules.ahorro=lazyModule('ahorro',()=>import('./modules/AhorroModule.js'),'AhorroModule');
window.App.Modules.inversiones=lazyModule('inversiones',()=>import('./modules/InversionesModule.js'),'InversionesModule');
window.App.Modules.admin=lazyModule('admin',()=>import('./modules/AdminModule.js'),'AdminModule');

// 5. Init Application (binds sidebar buttons, auth, and data fetching)
import './core/AppInit.js';
import { installPresentation } from './core/Presentation.js';
installPresentation();
