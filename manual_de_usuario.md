# Fluxo — Manual de Usuario Completo y Actualizado

**Fluxo** es una plataforma integral de gestión financiera personal y familiar, diseñada con arquitectura multi-tenant, soporte bimonetario nativo (ARS / USD) y asistencia financiera inteligente impulsada por IA (FluxoAI / Gemini).

---

## 1. Visión General y Filosofía de Diseño

Fluxo organiza las finanzas a través de tres pilares fundamentales:
1. **Entornos Presupuestarios (Multi-Cuenta)**: Permite separar la contabilidad en cuentas lógicas independientes (ej. `Personal`, `Hogar`, `Negocio`) manteniendo trazabilidad completa en operaciones cruzadas (clearing y reintegros).
2. **Criterio de Devengamiento vs. Pago Diferido**:
   - Los gastos en efectivo o transferencia se imputan al día de la transacción.
   - **Regla de Oro en Tarjetas de Crédito**: Los consumos realizados con tarjeta de crédito se imputan **siempre a la fecha de vencimiento del resumen** (`stVto`), difiriendo el egreso de liquidez al período en que efectivamente se produce la salida de fondos.
3. **Control Dual de Pagos (Saldados vs. Pendientes)**: Visión clara entre los compromisos devengados y aquellos que ya fueron efectivamente cancelados en el mes.

---

## 2. Barra Superior (Topbar Global)

Accesible desde cualquier sección de la app:
- **Selector de Cuenta / Entorno**: Alterna entre cuentas principales (ej. `Personal`, `Hogar`). Todo el dashboard, movimientos, gráficos y KPIs se reconfiguran en tiempo real para la cuenta seleccionada.
- **Selector de Mes / Período**: Navega hacia meses pasados o proyecciones futuras (formato `Mes de AAAA`).
- **Switch Bimonetario (ARS / USD)**: Convierte todos los valores visibles de la aplicación utilizando la cotización del Dólar MEP en tiempo real (vía APIs de mercado).
- **Botón FluxoAI (`✨ FluxoAI` / `✦ FluxoAI`)**: Despliega el panel lateral de asistencia inteligente estilo WhatsApp.
- **Centro de Notificaciones (`🔔` con badge)**: Alertas automáticas de vencimientos de resúmenes de tarjeta, fechas de cierre y finalización de cuotas.
- **Acceso Rápido a Configuración (`⚙️` / `Ajustes` en header)**: Abre el panel de administración maestra del sistema.

---

## 3. Módulo Dashboard (Inicio)

Pantalla de inicio que consolida el estado patrimonial del mes seleccionado:
- **Tarjetas de Métricas Vitales (KPIs)**:
  - **Ingresos Totales**: Suma de sueldos, aportes y otros créditos del mes.
  - **Gastos Totales**: Suma de egresos, desagregados visualmente en **Saldados** y **Pendientes**.
  - **Balance / Resultado Neto**: Diferencia entre ingresos y gastos (`Ingresos - Gastos`).
- **Carrusel de Mercados en Vivo**: Cotizaciones instantáneas de Dólar MEP, CCL, Blue, Riesgo País e instrumentos financieros.
- **Accesos Rápidos a Módulos**: Botones a los módulos habilitados de la cuenta. Los movimientos se consultan y cargan desde Resumen.

---

## 4. Movimientos dentro de Resumen

Es el registro contable detallado de todos los ingresos y gastos de la cuenta activa.

### 4.1 Organización y estado
Los registros se organizan en Ingresos y Gastos; dentro de cada grupo aparecen las categorías y sus movimientos. Usá búsqueda o Filtros para acotar la lista. Cada fila abre su detalle con clic o Enter, y Nuevo movimiento abre el formulario de alta.

Para gastos por débito, transferencia o efectivo, presioná Pendiente para marcar Pagado, o Pagado para volver a Pendiente. Los consumos de tarjeta de crédito se saldan al registrar el pago de su resumen. El estado es un registro interno y no ejecuta pagos bancarios.

### 4.2 Carga de Movimientos (Modal de Alta)
- **Tipo de Movimiento**:
  - `Ingreso`: Ingreso de dinero. Admite **Split Multi-Cuenta (%)** para distribuir un salario entre Personal y Hogar de manera automática.
  - `Gasto`: Salida de fondos.
- **Modalidad de Cálculo de Monto**:
  - **Monto Fijo**: Carga tradicional de importe en moneda seleccionada.
  - **% sobre Ingresos de la Cuenta**: Calcula dinámicamente el monto en función de los ingresos percibidos en el mes de la cuenta destino.
    - Botones predeterminados:
      - `25% (Super)`: Presupuesto para supermercado (25% de los ingresos de la cuenta).
      - `÷ 5.5 (Verdu)`: Presupuesto para verdulería (supermercado / 5.5 = 4.55% de los ingresos).
      - `1%`, `5%`, `10%` y campo numérico libre para cualquier porcentaje.
    - Muestra en tiempo real el total de ingresos de la cuenta y el monto exacto calculado antes de guardar.
- **Frecuencia / Tipo de Egresos**:
  - `Simple / Contado`: Impacta exclusivamente en la fecha indicada.
  - `En Cuotas`: Solicita número de cuota actual y cuotas totales (ej. 1/6), proyectando automáticamente los meses subsiguientes.
  - `Recurrente`: Gastos fijos continuos (servicios, alquiler, cuotas de colegios) que se replican mensualmente.

### 4.3 Badges y detalle
La modalidad aparece en un único badge: Simple, Recurrente, Cuota x/y o Última cuota. La descripción no repite el número de cuota. Abrí el detalle desde la fila para editar o eliminar, con los alcances disponibles para series y distribuciones.

### 4.4 Gráficos con filtros cruzados
La dona y las barras mensuales se ven junto a los movimientos. Clic en una categoría, mes o leyenda filtra los gráficos y la lista; Ctrl+clic (Cmd en Mac) suma/quita selecciones. Categorías y meses se combinan. Quitá chips o usá Limpiar selección para restaurar la vista.

---

## 5. Módulo de Tarjetas de Crédito

Administra plásticos bancarios y compras financiadas como medio de pago transversal.

### 5.1 Bento Cards de Plásticos
- Despliegue visual de cada tarjeta (ej. Visa Santander, Amex) con estética de plástico bancario, últimos 4 dígitos, saldo en ARS y saldo en USD.
- Opción `CONSOLIDADO` para ver la deuda acumulada de todas las tarjetas.
- **KPIs del Resumen**: Deuda Total, Incidencia Personal (lo que gastaste vos) e Incidencia Externa (gastos imputados a otras cuentas como Hogar).

### 5.2 Regla de Imputación al Vencimiento
- Al cargar o importar consumos de tarjeta, la fecha del consumo se establece en la **fecha de vencimiento del resumen** (`stVto`), difiriendo el gasto al período en que efectivamente se liquida.

### 5.3 Botón "💳 Pagar Resumen"
- Cuando el resumen cuenta con saldo pendiente, se habilita el botón de pago.
- Al confirmar:
  1. Registra un **EGRESO** en la cuenta de la tarjeta (Personal) por el total liquidado (`Pago Resumen: Visa Santander`).
  2. Confirma los **INGRESOS** por reintegros provenientes de Hogar por consumos familiares pagados con la tarjeta.
  3. Asegura en Hogar los **EGRESOS** correspondientes a esos consumos imputados.
  4. Marca todos los consumos del período como **Saldados ✓**.

### 5.4 Importación Inteligente de Resúmenes en PDF
- Permite subir el archivo PDF oficial emitido por el banco (ej. Visa Santander).
- El motor de IA extrae automáticamente:
  - Fechas de cierre y vencimiento.
  - Saldo en ARS y USD, y pago mínimo.
  - Lista completa de consumos discriminando cuotas (X/Y), compras en un pago, impuestos asociados (IVA, Sellos, Percepciones) y débitos automáticos.
  - Recuerda reglas de imputación aprendidas (ej. seguros, combustible, streaming).

### 5.5 Gráficos por Categoría en Tarjetas
- Switch `[ Gráficos ]` que despliega el gráfico Doughnut de consumos por rubro y el desglose de incidencia personal vs externa.

---

## 6. Módulo de Gastos Compartidos (Cuentas Corrientes)

Controla los saldos a favor o en contra con terceros (pareja, familiares, socios):
- **Listado de Contactos**: Balance neto con cada persona (verde = te debe, rojo = le debés).
- **Registro de Consumos Compartidos**: Permite dividir gastos indicando porcentajes o montos directos.
- **Liquidación / Clearing**: Opción para saldar deudas registrando movimientos de compensación en cuenta.

---

## 7. Módulo de Ahorro (Chanchito Bimonetario)

Gestión de fondos de reserva y patrimonio líquido:
- **Bóvedas / Subcuentas**: Creación de alcancías en ARS o USD (ej. Fondo de Emergencia, Vacaciones, Ahorro Inmobiliario).
- **Ingreso y Retiro de Fondos**: Transferencia de saldos entre la cuenta principal y el chanchito.

---

## 8. Módulo de Inversiones

Seguimiento de cartera y cotizaciones financieras:
- **Cartera de Activos**: Tickers de acciones, CEDEARs, Bonos Soberanos, LECAPs y Obligaciones Negociables.
- **Monitor Global de Mercados**:
  - Dólar MEP, CCL, Blue y Riesgo País actualizados.
  - Cotizaciones en vivo de bonos argentinos (AL30, GD30, etc.), tasas de LECAPs y rendimientos de ONs en dólares.
  - Índices globales y commodities (S&P 500, Nasdaq, Petróleo, Oro, Cripto).

---

## 9. Asistente Inteligente (FluxoAI / Gemini 3.8 Flash)

Chatbot financiero inteligente integrado en panel lateral, potenciado por **Google Gemini 3.8 Flash** (el último modelo disponible de Google de ultra alta velocidad y comprensión multimodal):
- **Motor de Inteligencia de Última Generación**:
  - Utiliza de forma nativa **Gemini 3.8 Flash** como modelo primario con redundancia en cascada en la serie 3.x Flash (`3.8` → `3.6` → `3.5` → `3.0`), garantizando respuestas ultra rápidas (< 2s) y máxima precisión de análisis.
- **Experiencia de Conversación Progresiva (Estilo WhatsApp)**:
  - Al abrirse, la ventana se posiciona directamente en el último mensaje de la conversación.
  - Al deslizar hacia arriba (`scrollTop <= 40px`), carga de 10 en 10 los mensajes anteriores manteniendo fija la posición de pantalla.
- **Asesoría Financiera Personalizada**:
  - Analiza la salud financiera con la regla 50/30/20 evaluando los porcentajes de cada categoría sobre gastos y sobre ingresos.
  - Alertas sobre compromisos pendientes de pago antes de los vencimientos.
- **Extracción de Movimientos desde Archivos**:
  - Al adjuntar facturas, tickets o resúmenes bancarios (PDF/imágenes), extrae las transacciones y ofrece un botón directo para incorporar todos los movimientos a la cuenta en 1 clic.
- **Notificaciones Proactivas y Bot de Telegram**: Envío automático de alertas de cierres y vencimientos de resúmenes de tarjeta vía webhook con Gemini 3.8 Flash.

---

## 10. Panel de Configuración y Administración (⚙️)

Accesible desde el ícono de engranaje:
1. **Cuentas Principales**: Alta, edición y configuración de módulos activos por cuenta.
2. **Tarjetas de Crédito**: Gestión de plásticos, límites, fechas de cierre/vencimiento y cuenta vinculada.
3. **Categorías**: Catálogo personalizado de ingresos y gastos.
4. **Subcuentas de Ahorro**: Gestión de bolsas del chanchito.
5. **Contactos**: Directorio para cuentas corrientes compartidas.
6. **Recordatorios**: Configuración de alertas automáticas para Telegram y Web.

## Consistencia visual — 6.6.0, 6 de octubre de 2026

Resumen, Tarjetas, Gastos compartidos, Ahorro e Inversiones comparten el mismo componente de distribución: indicadores arriba, operaciones a la izquierda y Top Categorías y evolución a la derecha. Los paneles específicos, como el carrusel de tarjetas, continúan debajo. En escritorio (más de 1200 px), el alto del listado coincide con la columna de gráficos y las operaciones tienen scroll propio. En tablet y celular el contenido recupera el flujo de página; los gráficos pasan a dos columnas o una según el ancho.

Los importes de grupos, categorías y filas comparten el borde derecho; los indicadores y resúmenes usan cifras tabulares y alineación derecha. La tipografía se centraliza en Inter con respaldo del sistema, escala de 12/14/16/20/28 px para anotaciones, cuerpo, títulos, encabezados e indicadores. Los gráficos usan la misma familia y escala; se conservan los estilos de marca de los plásticos. Espaciado, radios, controles y tarjetas usan variables compartidas.

Se mantienen filtros cruzados, Ctrl/Cmd+clic, estados de pago, detalle de filas y habilitación por cuenta. Pruebas de navegador cubren las cinco secciones a cuatro anchos, coherencia de fuentes, igualdad de alturas, scroll de un listado de 40 gastos y alineación de importes. Esta actualización no cambia datos ni requiere migraciones.
