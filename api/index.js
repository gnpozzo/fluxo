import admin_deleteAhorroSubcuenta from './_controllers/admin_deleteAhorroSubcuenta.js';
import admin_deleteCategoria from './_controllers/admin_deleteCategoria.js';
import admin_deleteCtaCorrienteUsuario from './_controllers/admin_deleteCtaCorrienteUsuario.js';
import admin_deleteCuentaPrincipal from './_controllers/admin_deleteCuentaPrincipal.js';
import admin_deleteTarjeta from './_controllers/admin_deleteTarjeta.js';
import admin_getAhorroSubcuentas from './_controllers/admin_getAhorroSubcuentas.js';
import admin_getCategorias from './_controllers/admin_getCategorias.js';
import admin_getCtaCorrienteUsuarios from './_controllers/admin_getCtaCorrienteUsuarios.js';
import admin_getCuentasPrincipales from './_controllers/admin_getCuentasPrincipales.js';
import admin_getTarjetas from './_controllers/admin_getTarjetas.js';
import admin_saveAhorroSubcuenta from './_controllers/admin_saveAhorroSubcuenta.js';
import admin_saveCategoria from './_controllers/admin_saveCategoria.js';
import admin_saveCtaCorrienteUsuario from './_controllers/admin_saveCtaCorrienteUsuario.js';
import admin_saveCuentaPrincipal from './_controllers/admin_saveCuentaPrincipal.js';
import admin_saveTarjeta from './_controllers/admin_saveTarjeta.js';
import createAhorro from './_controllers/createAhorro.js';
import createConsumoCC from './_controllers/createConsumoCC.js';
import createConsumoTC from './_controllers/createConsumoTC.js';
import createInversion from './_controllers/createInversion.js';
import createMovimiento from './_controllers/createMovimiento.js';
import deleteAhorro from './_controllers/deleteAhorro.js';
import deleteConsumoCC from './_controllers/deleteConsumoCC.js';
import deleteConsumoTC from './_controllers/deleteConsumoTC.js';
import deleteInversion from './_controllers/deleteInversion.js';
import deleteMovimiento from './_controllers/deleteMovimiento.js';
import getAhorros from './_controllers/getAhorros.js';
import getConfig from './_controllers/getConfig.js';
import getConsumosCC from './_controllers/getConsumosCC.js';
import getConsumosTC from './_controllers/getConsumosTC.js';
import getDashboardData from './_controllers/getDashboardData.js';
import getDolarCotizaciones from './_controllers/getDolarCotizaciones.js';
import getInitialData from './_controllers/getInitialData.js';
import getMarketData from './_controllers/getMarketData.js';
import getNotificaciones from './_controllers/getNotificaciones.js';
import getPortfolio from './_controllers/getPortfolio.js';
import getProyeccionTC from './_controllers/getProyeccionTC.js';
import getUserInfo from './_controllers/getUserInfo.js';
import updateAhorro from './_controllers/updateAhorro.js';
import updateConsumoCC from './_controllers/updateConsumoCC.js';
import updateConsumoTC from './_controllers/updateConsumoTC.js';
import updateMovimiento from './_controllers/updateMovimiento.js';


export default async function handler(req, res) {
  const endpoint = req.query?.endpoint || req.url.split('?')[0].split('/').pop();
  
  switch(endpoint) {
    case 'admin_deleteAhorroSubcuenta': return await admin_deleteAhorroSubcuenta(req, res);
    case 'admin_deleteCategoria': return await admin_deleteCategoria(req, res);
    case 'admin_deleteCtaCorrienteUsuario': return await admin_deleteCtaCorrienteUsuario(req, res);
    case 'admin_deleteCuentaPrincipal': return await admin_deleteCuentaPrincipal(req, res);
    case 'admin_deleteTarjeta': return await admin_deleteTarjeta(req, res);
    case 'admin_getAhorroSubcuentas': return await admin_getAhorroSubcuentas(req, res);
    case 'admin_getCategorias': return await admin_getCategorias(req, res);
    case 'admin_getCtaCorrienteUsuarios': return await admin_getCtaCorrienteUsuarios(req, res);
    case 'admin_getCuentasPrincipales': return await admin_getCuentasPrincipales(req, res);
    case 'admin_getTarjetas': return await admin_getTarjetas(req, res);
    case 'admin_saveAhorroSubcuenta': return await admin_saveAhorroSubcuenta(req, res);
    case 'admin_saveCategoria': return await admin_saveCategoria(req, res);
    case 'admin_saveCtaCorrienteUsuario': return await admin_saveCtaCorrienteUsuario(req, res);
    case 'admin_saveCuentaPrincipal': return await admin_saveCuentaPrincipal(req, res);
    case 'admin_saveTarjeta': return await admin_saveTarjeta(req, res);
    case 'createAhorro': return await createAhorro(req, res);
    case 'createConsumoCC': return await createConsumoCC(req, res);
    case 'createConsumoTC': return await createConsumoTC(req, res);
    case 'createInversion': return await createInversion(req, res);
    case 'createMovimiento': return await createMovimiento(req, res);
    case 'deleteAhorro': return await deleteAhorro(req, res);
    case 'deleteConsumoCC': return await deleteConsumoCC(req, res);
    case 'deleteConsumoTC': return await deleteConsumoTC(req, res);
    case 'deleteInversion': return await deleteInversion(req, res);
    case 'deleteMovimiento': return await deleteMovimiento(req, res);
    case 'getAhorros': return await getAhorros(req, res);
    case 'getConfig': return await getConfig(req, res);
    case 'getConsumosCC': return await getConsumosCC(req, res);
    case 'getConsumosTC': return await getConsumosTC(req, res);
    case 'getDashboardData': return await getDashboardData(req, res);
    case 'getDolarCotizaciones': return await getDolarCotizaciones(req, res);
    case 'getInitialData': return await getInitialData(req, res);
    case 'getMarketData': return await getMarketData(req, res);
    case 'getNotificaciones': return await getNotificaciones(req, res);
    case 'getPortfolio': return await getPortfolio(req, res);
    case 'getProyeccionTC': return await getProyeccionTC(req, res);
    case 'getUserInfo': return await getUserInfo(req, res);
    case 'updateAhorro': return await updateAhorro(req, res);
    case 'updateConsumoCC': return await updateConsumoCC(req, res);
    case 'updateConsumoTC': return await updateConsumoTC(req, res);
    case 'updateMovimiento': return await updateMovimiento(req, res);

    default:
      return res.status(404).json({ success: false, error: 'Endpoint not found: ' + endpoint });
  }
}
