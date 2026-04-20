# Sistema de Gestión Financiera — Manual de Usuario

Este manual incluye de manera detallada todas las principales funcionalidades de la aplicación de Gestión Financiera, pensada para administrar cuentas, egresos, tarjetas, inversiones, ahorros y cuentas corrientes personales. 

Se encuentra dividida en módulos accesibles desde la **barra lateral principal**.

---

## 1. Menú Principal (Navegación Lateral)

El menú principal a la izquierda te permite navegar fácilmente entre las grandes áreas de la aplicación. 

### 1.1 Movimientos
Es el libro contable diario de la aplicación.
*   **Listado de Movimientos:** Visualiza todos los ingresos y egresos registrados en el mes seleccionado. Muestra la fecha, concepto, categoría, importe y tipo de movimiento.
*   **Tipos de Gasto:** Puedes asentar tres tipos estandarizados de consumos: *Al contado* (impactan solo este mes), *En Cuotas* (con indicador de progreso cuota X/Y, finalizan automáticamente) y *Recurrentes* (suscripciones, seguros, alquileres; se repiten todos los meses hasta su baja).
*   **Añadir Nuevo:** Puedes registrar "Nuevos Ingresos" o "Nuevos Egresos". Esto incluye también el soporte para **Ingresos Distribuidos Multi-Cuenta (Split %)**: al percibir un salario, podrás dividir dinámicamente un % hacia el Presupuesto Familiar y otro % hacia tu ahorros u otras cuentas, validado para no superar el 100%. 
*   **Gestión en Lote (CRUD avanzado):** Al editar o borrar un movimiento que forma parte de una serie (Cuotas o Recurrente), el sistema te permitirá elegir entre modificar "Solo este movimiento" o "Toda la serie a futuro".

### 1.2 Tarjetas (de Crédito)
Módulo dedicado a visualizar los futuros compromisos de pago en tus tarjetas, tratándolas como un **medio de pago transversal** a todas tus cuentas.
*   **Visión Neteada y Real:** Visualiza tu deuda total de tarjeta, pero con la capacidad de aislar qué porcentaje pertenece a la cuenta actual (ej., cuánto gastaste vos) y cuánto es deuda contraída pagando gastos de otros presupuestos (ej. familiar).
*   **Detalle por Tarjeta:** Despliega cuotas, compras de ciclo único, débitos automáticos y consumos asociados a la tarjeta para evaluar cuánto hay que pagar antes del vencimiento.

### 1.3 Gastos Compartidos (Cuentas Corrientes)
Organiza los saldos (deudas o créditos) que tienes con terceros (ej: Contacto Bichi, familiares, amigos).
*   **Saldos por Persona:** Resumen por cada 'Contacto' listando quién debe a quién y el balance actual (saldo a tu favor o saldo a pagar).
*   **Distribución Proporcional (% de Split):** Al registrar un gasto directo en Movimientos o en este módulo, puedes indicar qué porcentaje asumís vos y qué porcentaje pagó, o se le imputará como deuda, a ese contacto. Un poderoso motor de *clearing* interno.

### 1.4 Ahorro (Chanchito Bimonetario)
Módulo para el control de fondos apartados y patrimonio líquido. 
*   **Subcuentas / Bóvedas:** Puedes dividir tus ahorros en distintas bolsas definiendo en qué moneda transaccionan (ARS vs USD) y dónde se alojan físicamente (Liquidez, Broker X, Billetera Y, Efectivo Bajo Colchón).
*   **Valorización Dinámica:** Visualiza la consolidación de tus ahorros bimonetarios con una referencia del equivalente en moneda original integrando el concepto de "Posición Neta".

### 1.5 Inversiones
Permite seguir el rendimiento de distintas herramientas de inversión o instrumentos bursátiles.
*   **Portfolio (Tickers y Activos):** Muestra los tickers, cantidad y su valorización actual.
*   **Cargas/Retiros:** En esta sección puedes asentar si sumaste capital (compraste) a una inversión o si hiciste un retiro, actualizando las curvas de rendimiento.
*   **Monitor Global de Mercados:** Vista integrada con datos en tiempo real (caché de 10 min) que agrupa cinco categorías de instrumentos financieros:
    *   **🌎 Mundo:** Indicadores globales agrupados por sector (Índices, Tasas UST, Energía, Metales, Agro, Crypto, Monedas). Incluye S&P 500, Nasdaq 100, Dow Jones, WTI, Oro, Bitcoin, EUR/USD y más. Fuente: Yahoo Finance vía rendimientos.co.
    *   **🏛️ Bonos Soberanos USD:** Tabla con tickers de bonos argentinos en dólares (AL29, AL30, GD30, GD35, etc.), precio USD, bid/ask, variación % y volumen. Fuente: data912.
    *   **📜 LECAPs / BONCAPs:** Tarjetas con los principales instrumentos de renta fija en pesos (Letras Capitalizables y Bonos Capitalizables), mostrando ticker, precio, tipo y spread bid/ask. Fuente: data912.
    *   **🏢 Obligaciones Negociables (ONs):** Tabla de ONs corporativas en USD con precio, bid/ask y variación %. Fuente: data912.
    *   **📊 CEDEARs:** Los 40 CEDEARs más operados del día ordenados por volumen, con precio ARS, variación %, volumen y spread. Fuente: data912.
*   **Cotizaciones del Dólar:** En la cabecera del módulo se muestran cuatro indicadores clave: Dólar MEP, Dólar CCL, Dólar Blue y Riesgo País, actualizados automáticamente.

---

## 2. Barra Superior (Topbar)

Siempre presente en la parte superior, provee acceso a configuraciones transversales al sistema:

*   **Selector de Meses:** Dado que los reportes son periódicos, te permite avanzar o retroceder de mes calendario. Todos los movimientos y reportes se actualizarán al mes escogido.
*   **Selector de Entorno Presupuestario (Multi-Cuenta):** El núcleo duro del sistema te permite saltar ágilmente entre, por ejemplo, los tableros del "Presupuesto Personal", "Presupuesto Familiar" o "Negocio Propio". Todo el contenido del resto de módulos se regenera apuntando al entorno selecto sin perder trazabilidad intercompany (cruces entres presupuestos).
*   **Switch ARS / USD (Bimonetario Global):** Un interruptor de moneda que convierte todos los importes de la aplicación entre Pesos Argentinos y Dólares en tiempo real, utilizando la cotización del Dólar MEP obtenida de rendimientos.co al inicio de la sesión. Al activarse, todos los KPIs, tablas y reportes se re-renderizan automáticamente con los importes convertidos.
*   **🔔 Centro de Notificaciones:** Icono de campana con badge indicador. Muestra alertas mensuales relevantes tales como:
    *   Última cuota de un consumo en tarjeta de crédito (el sistema detecta automáticamente cuándo una serie de cuotas finaliza en el mes actual).
    *   Nuevo consumo que impacta al mes siguiente (primeros vencimientos de compras recientes).
*   **🌙 Modo Claro / Oscuro:** Botón de tema para alternar la paleta de colores de la aplicación.
*   **Configuración (⚙️ Ícono del Panel de Configuración):** Abre las opciones maestras (abm de administraciones) para el comportamiento estático de la app.

---

## 3. Panel de Configuración (Administrador)

Al hacer clic en la tuerca ⚙️ (arriba a la derecha), se abre un panel flotante de uso indispensable para setear por primera vez la app y luego mantener el sistema:

### 3.1 Cuentas (Movimientos)
*   *Qué hace:* Define las "billeteras" reales o bancos en donde descansa el dinero. (Ej: Efectivo, BBVA, Macro, MercadoPago).
*   *Acciones:* Crear, editar y establecer en qué monedas opera cada cuenta, o si requiere ajuste por diferencia de tipo de cambio.

### 3.2 Tarjetas
*   *Qué hace:* Actúa como creador/editor de tus plásticos.
*   *Acciones:* Vincular cada tarjeta a una cuenta origen; asignar banco emisor, últimos 4 números para identificarlas, especificar los días típicos de cierre de resumen y cuándo cae el vencimiento, así como marcarlas "Inactivas" en caso de baja o extravío.

### 3.3 Categorías
*   *Qué hace:* Tu "diccionario" propio de gastos. (Ej: Sueldo, Supermercado, Alquiler, Salidas).
*   *Acciones:* Crear nuevas categorías y etiquetarlas explícitamente como "Ingreso" o "Egreso".

### 3.4 Subcuentas Ahorro
*   *Qué hace:* Configura las distintas "alcancías" para el módulo ahorro. (Ej. Ahorros Pesos, Ahorros USD).
*   *Acciones:* Crear estas cajas o eliminarlas según la estructura de ahorros actualizadas.

### 3.5 Contactos (Gastos Compartidos)
*   *Qué hace:* Registra el listado de tus contactos o terceros habituales con los que compartes contabilidad (ej. esposa).
*   *Acciones:* Agregar personas a las cuales frecuentemente les cobras, les debes o con quienes divides gastos frecuentemente.


---

## 4. Tablero Principal (Dashboard y KPIs)

Al ingresar o encontrarse en el inicio de la aplicación, serás recibido por el **Tablero Principal**, diseñado para darte un resumen visual e interpretativo del estado de tus finanzas en el mes actual.

### 4.1 Tarjetas de Indicadores (KPIs)
En la parte superior, se visualizan las métricas vitales del mes en curso:
*   **Balance Mensual:** Refleja el resultado operativo (Total Ingresos menos Total Egresos del entorno presupuestario seleccionado).
*   **Total de Ingresos y Egresos:** Sumatoria rápida que te ayuda a mantener el margen controlado.
*   **Ahorro Generado:** Indicador rápido de qué parte de tu capital se ha resguardado en el mes vigente.
*   **Compromisos de Tarjeta:** Estimación rápida o consolidada del pago a enfrentar en el próximo cierre.

### 4.2 Gráficos y Reportes
*   **Evolución:** Gráficos intuitivos para comprender la distribución de las finanzas y el ritmo o tendencia de los gastos frente a tus ingresos.

---

## 5. Fuentes de Datos Externos

La aplicación se integra con las siguientes fuentes de datos financieros en tiempo real:

| Fuente | Datos | Uso |
|---|---|---|
| **rendimientos.co** | Indicadores globales, LECAPs, ONs, Bonos Soberanos, CEDEARs | Monitor Global de Inversiones |
| **dolarapi.com** | Cotizaciones Dólar (oficial, MEP, CCL, Blue) | Cabecera de Inversiones + Switch Bimonetario |
| **data912.com** | Precios en tiempo real de instrumentos argentinos | Backend de rendimientos.co |
| **Yahoo Finance** | S&P 500, Nasdaq, commodities, crypto, FX | Backend de rendimientos.co |

---

## 6. Flujo de Trabajo Sugerido (Día a Día)

Para sacar el máximo provecho de la herramienta, se recomienda la siguiente rutina de uso:

1.  **Día de Cobro (Ingresos):** Registra tu sueldo o ingresos extras desde la sección *Movimientos -> Añadir*. Utiliza la función de **Carga Multi-Cuenta (Split)** si necesitas por ejemplo, enviar un porcentaje automático al Presupuesto Familiar y el saldo retenerlo en el Presupuesto Personal.
2.  **Registrar Consumos (Egresos):** Carga todas tus compras. En caso de usar financiación, no olvides seleccionar "En Cuotas" especificando la cantidad de pagos. La herramienta se encargará de proyectar dicho gasto en los meses futuros automáticamente.
3.  **Gastos Compartidos (Cuentas Corrientes):** Cuando pagues algo por otra persona (o paguen algo por ti), crea un ingreso/egreso proporcional asintiendo qué contacto está involucrado y qué porcentaje asume cada uno. Luego dirígete al módulo *Gastos Compartidos* para liquidar y compensar los saldos ("Clearing").
4.  **Consultar Mercados:** Ingresa al módulo *Inversiones → Monitor Global* para revisar cotizaciones de bonos, CEDEARs, LECAPs y mercados internacionales antes de tomar decisiones.
5.  **Revisión y Ajuste (Fin de mes):** Acude a tu *Dashboard* para observar el Balance Mensual. Revisa las 🔔 notificaciones para enterarte de cuotas que finalizan. Dirígete al módulo *Ahorro* y/o *Inversiones* para actualizar las diferencias de cambio o rendimientos generados por tus ahorros capitalizados.
