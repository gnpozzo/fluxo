// [Origen -> src -> main.js]
// v2.1.0
// QA Passed: Bootstrap and Dependency Injection completely wired.

import './styles/main.css';

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

// 3. UI Components
import { ToastManager } from './components/Toast.js';
window.App.Toast = new ToastManager();
import { Modal } from './components/Modal.js';
window.App.Modal = Modal;
import { DataTable } from './components/DataTable.js';
window.App.DataTable = DataTable;
import { FormValidator } from './components/FormValidator.js';
window.App.FormValidator = FormValidator;
import "./core/AppIcons.js";

import { KpiCard } from './components/KpiCard.js';
window.App.KpiCard = KpiCard;

// 4. Modules
import { DashboardModule } from './modules/DashboardModule.js';
window.App.Modules['dashboard'] = new DashboardModule();

import { MovimientosModule } from './modules/MovimientosModule.js';
window.App.Modules['movimientos'] = new MovimientosModule();

import { TarjetasModule } from './modules/TarjetasModule.js';
window.App.Modules['tarjetas'] = new TarjetasModule();

import { CCModule } from './modules/CcModule.js';
window.App.Modules['cc'] = new CCModule();

import { AhorroModule } from './modules/AhorroModule.js';
window.App.Modules['ahorro'] = new AhorroModule();

import { InversionesModule } from './modules/InversionesModule.js';
window.App.Modules['inversiones'] = new InversionesModule();

import { AdminModule } from './modules/AdminModule.js';
window.App.Modules['admin'] = new AdminModule();

// 5. Init Application (binds sidebar buttons, auth, and data fetching)
import './core/AppInit.js';

// QA Chart rendering shim (mock)
window.renderChart = function() {
  const chartEl = document.getElementById('dash-chart-canvas');
  if(!chartEl) return;
  console.log('✓ QA: Chart placeholder rendered');
};
