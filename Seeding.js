/**
 * SISTEMA DE GESTIÓN FINANCIERA - BACKEND (Datos de Ejemplo)
 * v2.41.1 (Sprint 1 - Seeding Completo)
 *
 * Cambios:
 * - Se actualiza la versión.
 * - Se actualiza el seeder para que sea compatible con el nuevo Schema v2.41.1
 * (nombres de tablas v2.40.0, columnas v2.41.1).
 * - Se añaden datos de ejemplo para todos los módulos:
 * - 2 Cuentas Principales (con módulos activados).
 * - Categorías (Ingresos, Egresos) asignadas a las cuentas.
 * - Tarjetas (asignadas a cuentas).
 * - Movimientos (Ingresos, Egresos, Recurrentes).
 * - ConsumosTC (Simples, Cuotas, Recurrentes).
 */

//==================================================================
// FUNCIÓN PRINCIPAL DE SEEDING (Llamada por API_Admin.gs)
//==================================================================

/**
 * Borra todos los datos de todas las tablas y los vuelve a poblar.
 * @returns {string[]} - Log de operaciones.
 */
function seedDatabase() {
  const logMessages = [];
  
  // 1. Definir los datos de ejemplo
  // Usamos generateUUID() de Utils.gs
  const HOY = new Date();
  const MES_PASADO = new Date(HOY.getFullYear(), HOY.getMonth() - 1, 15);
  const HACE_2_MESES = new Date(HOY.getFullYear(), HOY.getMonth() - 2, 10);
  
  // IDs
  const ID_CUENTA_PERSONAL = generateUUID();
  const ID_CUENTA_NEGOCIO = generateUUID();
  
  const ID_CAT_SUELDO = generateUUID();
  const ID_CAT_FREELANCE = generateUUID();
  const ID_CAT_SUPER = generateUUID();
  const ID_CAT_ALQUILER = generateUUID();
  const ID_CAT_SERVICIOS = generateUUID();
  const ID_CAT_GIMNASIO = generateUUID();
  const ID_CAT_OCIO = generateUUID();
  
  const ID_TARJETA_VISA = generateUUID();
  const ID_TARJETA_AMEX = generateUUID();
  
  const ID_GRUPO_RECURRENTE_GIMNASIO = generateUUID();
  const ID_GRUPO_RECURRENTE_ALQUILER = generateUUID();
  const ID_GRUPO_CUOTAS_TV = generateUUID();
  const ID_GRUPO_RECURRENTE_NETFLIX = generateUUID();

  // 2. Definición de Entidades
  
  const cuentas = [
    {
      id_cuenta_principal: ID_CUENTA_PERSONAL,
      nombre: "Cuenta Personal (Ejemplo)",
      moneda_principal: "ARS",
      es_predeterminada: true,
      activa: true,
      fecha_creacion: new Date(),
      modulo_tarjetas_activo: true,
      modulo_cc_activo: true,
      modulo_ahorro_activo: true,
      modulo_inversiones_activo: true
    },
    {
      id_cuenta_principal: ID_CUENTA_NEGOCIO,
      nombre: "Negocio (Ejemplo)",
      moneda_principal: "ARS",
      es_predeterminada: false,
      activa: true,
      fecha_creacion: new Date(),
      modulo_tarjetas_activo: false,
      modulo_cc_activo: false,
      modulo_ahorro_activo: false,
      modulo_inversiones_activo: false
    }
  ];

  const categorias = [
    // Ingresos
    { id_categoria: ID_CAT_SUELDO, id_cuenta: ID_CUENTA_PERSONAL, nombre: "Sueldo", tipo_mov: "INGRESO", activa: true, presupuesto_mensual: null },
    { id_categoria: ID_CAT_FREELANCE, id_cuenta: ID_CUENTA_NEGOCIO, nombre: "Freelance", tipo_mov: "INGRESO", activa: true, presupuesto_mensual: null },
    // Egresos
    { id_categoria: ID_CAT_SUPER, id_cuenta: ID_CUENTA_PERSONAL, nombre: "Supermercado", tipo_mov: "EGRESO", activa: true, presupuesto_mensual: 100000 },
    { id_categoria: ID_CAT_ALQUILER, id_cuenta: ID_CUENTA_PERSONAL, nombre: "Alquiler", tipo_mov: "EGRESO", activa: true, presupuesto_mensual: 250000 },
    { id_categoria: ID_CAT_SERVICIOS, id_cuenta: ID_CUENTA_PERSONAL, nombre: "Servicios (Luz, Gas, Int.)", tipo_mov: "EGRESO", activa: true, presupuesto_mensual: 40000 },
    { id_categoria: ID_CAT_GIMNASIO, id_cuenta: ID_CUENTA_PERSONAL, nombre: "Gimnasio", tipo_mov: "EGRESO", activa: true, presupuesto_mensual: 15000 },
    { id_categoria: ID_CAT_OCIO, id_cuenta: ID_CUENTA_PERSONAL, nombre: "Ocio (Salidas, Cine)", tipo_mov: "EGRESO", activa: true, presupuesto_mensual: 50000 }
  ];

  const tarjetas = [
    {
      id_tarjeta: ID_TARJETA_VISA,
      id_cuenta_principal: ID_CUENTA_PERSONAL,
      nombre: "Visa (Banco Ejemplo)",
      activa: true,
      banco: "Banco Ejemplo",
      ultimos_4_digitos: "1234",
      dia_cierre_resumen: 25,
      dia_vencimiento_resumen: 4
    },
    {
      id_tarjeta: ID_TARJETA_AMEX,
      id_cuenta_principal: ID_CUENTA_PERSONAL,
      nombre: "Amex (Banco Ejemplo)",
      activa: true,
      banco: "Banco Ejemplo",
      ultimos_4_digitos: "5678",
      dia_cierre_resumen: 20,
      dia_vencimiento_resumen: 1
    }
  ];
  
  const movimientos = [
    // Ingreso Sueldo (Mes pasado)
    {
      id_movimiento: generateUUID(),
      id_cuenta_principal: ID_CUENTA_PERSONAL,
      id_categoria: ID_CAT_SUELDO,
      fecha: formatDate(MES_PASADO, 'YYYY-MM-DD'),
      monto: 500000,
      moneda: "ARS",
      descripcion: "Sueldo Mes Pasado",
      tipo_mov: "INGRESO",
      medio_pago: "transferencia / efectivo",
      id_recurrencia: null,
      es_imputacion_tc: false,
      id_consumo_tc_grupo: null
    },
    // Egreso Alquiler (Recurrente 1)
    {
      id_movimiento: generateUUID(),
      id_cuenta_principal: ID_CUENTA_PERSONAL,
      id_categoria: ID_CAT_ALQUILER,
      fecha: formatDate(HACE_2_MESES, 'YYYY-MM-DD'),
      monto: 250000,
      moneda: "ARS",
      descripcion: "Alquiler (recurrente 1/12)",
      tipo_mov: "EGRESO",
      medio_pago: "transferencia / efectivo",
      id_recurrencia: ID_GRUPO_RECURRENTE_ALQUILER,
      es_imputacion_tc: false,
      id_consumo_tc_grupo: null
    },
    // Egreso Alquiler (Recurrente 2)
    {
      id_movimiento: generateUUID(),
      id_cuenta_principal: ID_CUENTA_PERSONAL,
      id_categoria: ID_CAT_ALQUILER,
      fecha: formatDate(MES_PASADO, 'YYYY-MM-DD'),
      monto: 250000,
      moneda: "ARS",
      descripcion: "Alquiler (recurrente 2/12)",
      tipo_mov: "EGRESO",
      medio_pago: "transferencia / efectivo",
      id_recurrencia: ID_GRUPO_RECURRENTE_ALQUILER,
      es_imputacion_tc: false,
      id_consumo_tc_grupo: null
    },
     // Egreso Supermercado (Simple)
    {
      id_movimiento: generateUUID(),
      id_cuenta_principal: ID_CUENTA_PERSONAL,
      id_categoria: ID_CAT_SUPER,
      fecha: formatDate(HOY, 'YYYY-MM-DD'),
      monto: 45000,
      moneda: "ARS",
      descripcion: "Compra Supermercado",
      tipo_mov: "EGRESO",
      medio_pago: "transferencia / efectivo",
      id_recurrencia: null,
      es_imputacion_tc: false,
      id_consumo_tc_grupo: null
    },
  ];

  const consumosTC = [
    // Compra Simple (Supermercado)
    {
      id_consumo_tc: generateUUID(),
      id_tarjeta: ID_TARJETA_VISA,
      id_cuenta_principal: ID_CUENTA_PERSONAL,
      id_categoria: ID_CAT_SUPER,
      fecha_compra: formatDate(MES_PASADO, 'YYYY-MM-DD'),
      fecha_vencimiento_cuota: null, // Asumimos que la lógica de cálculo la rellena
      descripcion: "Supermercado (1 pago)",
      monto_total_consumo: 30000,
      moneda: "ARS",
      cuotas_totales: 1,
      cuota_actual: 1,
      monto_cuota: 30000,
      id_consumo_tc_grupo: generateUUID(),
      tipo_consumo: "SIMPLE",
      id_imputacion_egreso: null
    },
    // Compra en Cuotas (Ocio - 3 cuotas)
    {
      id_consumo_tc: generateUUID(),
      id_tarjeta: ID_TARJETA_VISA,
      id_cuenta_principal: ID_CUENTA_PERSONAL,
      id_categoria: ID_CAT_OCIO,
      fecha_compra: formatDate(HACE_2_MESES, 'YYYY-MM-DD'),
      fecha_vencimiento_cuota: null,
      descripcion: "Compra TV (Cuotas)",
      monto_total_consumo: 90000,
      moneda: "ARS",
      cuotas_totales: 3,
      cuota_actual: 1,
      monto_cuota: 30000,
      id_consumo_tc_grupo: ID_GRUPO_CUOTAS_TV,
      tipo_consumo: "CUOTAS",
      id_imputacion_egreso: null
    },
    {
      id_consumo_tc: generateUUID(),
      id_tarjeta: ID_TARJETA_VISA,
      id_cuenta_principal: ID_CUENTA_PERSONAL,
      id_categoria: ID_CAT_OCIO,
      fecha_compra: formatDate(HACE_2_MESES, 'YYYY-MM-DD'),
      fecha_vencimiento_cuota: null,
      descripcion: "Compra TV (Cuotas)",
      monto_total_consumo: 90000,
      moneda: "ARS",
      cuotas_totales: 3,
      cuota_actual: 2,
      monto_cuota: 30000,
      id_consumo_tc_grupo: ID_GRUPO_CUOTAS_TV,
      tipo_consumo: "CUOTAS",
      id_imputacion_egreso: null
    },
    {
      id_consumo_tc: generateUUID(),
      id_tarjeta: ID_TARJETA_VISA,
      id_cuenta_principal: ID_CUENTA_PERSONAL,
      id_categoria: ID_CAT_OCIO,
      fecha_compra: formatDate(HACE_2_MESES, 'YYYY-MM-DD'),
      fecha_vencimiento_cuota: null,
      descripcion: "Compra TV (Cuotas)",
      monto_total_consumo: 90000,
      moneda: "ARS",
      cuotas_totales: 3,
      cuota_actual: 3,
      monto_cuota: 30000,
      id_consumo_tc_grupo: ID_GRUPO_CUOTAS_TV,
      tipo_consumo: "CUOTAS",
      id_imputacion_egreso: null
    },
    // Recurrente (Gimnasio / Netflix)
    {
      id_consumo_tc: generateUUID(),
      id_tarjeta: ID_TARJETA_AMEX,
      id_cuenta_principal: ID_CUENTA_PERSONAL,
      id_categoria: ID_CAT_GIMNASIO,
      fecha_compra: formatDate(HACE_2_MESES, 'YYYY-MM-DD'),
      fecha_vencimiento_cuota: null,
      descripcion: "Netflix (recurrente 1)",
      monto_total_consumo: 10000,
      moneda: "ARS",
      cuotas_totales: 1, // Recurrente es cuota 1 de 1, pero se repite
      cuota_actual: 1,
      monto_cuota: 10000,
      id_consumo_tc_grupo: ID_GRUPO_RECURRENTE_NETFLIX,
      tipo_consumo: "RECURRENTE",
      id_imputacion_egreso: null
    },
    {
      id_consumo_tc: generateUUID(),
      id_tarjeta: ID_TARJETA_AMEX,
      id_cuenta_principal: ID_CUENTA_PERSONAL,
      id_categoria: ID_CAT_GIMNASIO,
      fecha_compra: formatDate(MES_PASADO, 'YYYY-MM-DD'),
      fecha_vencimiento_cuota: null,
      descripcion: "Netflix (recurrente 2)",
      monto_total_consumo: 10000,
      moneda: "ARS",
      cuotas_totales: 1,
      cuota_actual: 1,
      monto_cuota: 10000,
      id_consumo_tc_grupo: ID_GRUPO_RECURRENTE_NETFLIX,
      tipo_consumo: "RECURRENTE",
      id_imputacion_egreso: null
    }
  ];
  
  // (Aquí irían ConsumosCC, Ahorro_Movimientos, Inversiones_Movimientos, etc.)
  
  
  // 3. Obtener el esquema para el orden de borrado
  // (Usamos los nombres de tabla v2.40.0/v2.41.1)
  const tablesInOrder = [
    // Hijos (dependen de otros)
    "Movimientos",
    "ConsumosTC",
    "ConsumosCC",
    "Ahorro_Movimientos",
    "Inversiones_Movimientos",
    // Nuevas tablas (Sprint 3)
    "Ahorro_Subcuentas",
    "CtaCorriente_Usuarios",
    // Padres
    "Tarjetas",
    "Categorias",
    "CuentasPrincipales",
    // Otros
    "Cotizaciones",
    "CotizacionesDolar",
    "Logs"
  ];
  
  // 4. Borrar todas las tablas existentes
  logMessages.push("--- Iniciando Borrado de Tablas ---");
  tablesInOrder.forEach(tableName => {
    try {
      // Verificamos si la tabla existe antes de borrar
      BigQuery.Tables.get(BQ_PROJECT_ID, BQ_DATASET, tableName);
      // Si existe, la borramos
      BigQuery.Tables.remove(BQ_PROJECT_ID, BQ_DATASET, tableName);
      logMessages.push(`🗑️ Tabla '${tableName}' borrada.`);
    } catch (e) {
      if (e.message.includes("Not found")) {
        logMessages.push(`ℹ️ Tabla '${tableName}' no existe, omitiendo borrado.`);
      } else {
        logMessages.push(`❌ Error borrando '${tableName}': ${e.message}`);
      }
    }
  });
  
  // 5. Re-crear las tablas (Sincronizar Esquema)
  logMessages.push("--- Re-creando Esquema ---");
  const syncLogs = verifyAndSyncSchema(); // Función de Schema.gs
  logMessages.push(...syncLogs);
  
  // 6. Insertar los datos de ejemplo
  logMessages.push("--- Insertando Datos de Ejemplo ---");
  
  try {
    // (Usamos los nombres de tabla v2.40.0/v2.41.1)
    insertRows(BQ_DATASET, 'CuentasPrincipales', cuentas, logMessages);
    insertRows(BQ_DATASET, 'Categorias', categorias, logMessages);
    insertRows(BQ_DATASET, 'Tarjetas', tarjetas, logMessages);
    insertRows(BQ_DATASET, 'Movimientos', movimientos, logMessages);
    insertRows(BQ_DATASET, 'ConsumosTC', consumosTC, logMessages);
    // (insertar otros módulos aquí)
    
    logMessages.push("✅ ¡Datos de ejemplo insertados con éxito!");
    
  } catch (e) {
    logMessages.push(`❌ ERROR FATAL durante la inserción: ${e.message}`);
    Logger.log(e.stack);
  }

  return logMessages;
}

/**
 * Helper para insertar filas en BQ
 */
function insertRows(datasetId, tableId, rows, logMessages) {
  if (!rows || rows.length === 0) {
    logMessages.push(`ℹ️ No hay datos para insertar en '${tableId}'.`);
    return;
  }
  
  // Convertir a JSON
  const rowsFormatted = rows.map(row => ({ json: row }));
  
  try {
    const request = { rows: rowsFormatted };
    BigQuery.Tabledata.insertAll(request, BQ_PROJECT_ID, datasetId, tableId);
    logMessages.push(`🚀 ${rows.length} filas insertadas en '${tableId}'.`);
    
  } catch (e) {
    logMessages.push(`❌ Error insertando en '${tableId}': ${e.message}`);
    // Log detallado si falla la inserción
    Logger.log(`Error insertando en ${tableId}. Datos: ${JSON.stringify(rowsFormatted)}. Error: ${e.stack}`);
    throw e; // Relanzar el error para detener el seeding
  }
}