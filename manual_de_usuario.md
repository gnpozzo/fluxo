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
- **Accesos Rápidos a Módulos**: Botones directos a Tarjetas, Movimientos, Gastos Compartidos, Ahorro e Inversiones.

---

## 4. Módulo de Movimientos (Libro Diario)

Es el registro contable detallado de todos los ingresos y gastos de la cuenta activa.

### 4.1 Barra de Control de Pagos
En la parte superior se visualiza:
- **Gastos Saldados (Abonados)**: Importe total y porcentaje (`X%`) en verde.
- **Gastos Pendientes de Pago**: Importe total y porcentaje (`Y%`) en ámbar.
- **Barra de Progreso Visual**: Representación proporcional de la liquidez ya comprometida vs. pendiente.

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

### 4.3 Tabla de Movimientos y Acciones
- **Columna "Estado Pago"**: Badge interactivo que permite alternar con un solo clic entre:
  - `✓ Saldado`: Gasto ya cancelado o debitado.
  - `⏳ Pendiente`: Gasto previsto pendiente de pago.
- **Memoria de Navegación**: Al editar o eliminar un movimiento desde la página 2, 3 o posterior de la grilla, la tabla conserva la página activa y restaura el scroll exacto de la pantalla, resaltando suavemente la fila editada.

### 4.4 Vista "Análisis Gráfico" (No Invasiva)
Mediante el selector `[ 📋 Movimientos | 📊 Análisis Gráfico ]`:
- **Gráfico Doughnut (Chart.js)**: Distribución de gastos por categoría.
- **Doble Métrica Analítica por Categoría**:
  - **% sobre Gastos Totales**: Proporción que representa la categoría dentro del total de egresos.
  - **% sobre Ingresos Percibidos**: Impacto de la categoría sobre el dinero total que ingresó en el mes (útil para evaluar reglas como 50/30/20).

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

## 9. Asistente Inteligente (FluxoAI)

Chatbot financiero inteligente integrado en panel lateral:
- **Experiencia de Conversación Progresiva (Estilo WhatsApp)**:
  - Al abrirse, la ventana se posiciona directamente en el último mensaje de la conversación.
  - Al deslizar hacia arriba (`scrollTop <= 40px`), carga de 10 en 10 los mensajes anteriores manteniendo fija la posición de pantalla.
- **Asesoría Financiera Personalizada**:
  - Analiza la salud financiera con la regla 50/30/20 evaluando los porcentajes de cada categoría sobre gastos y sobre ingresos.
  - Alertas sobre compromisos pendientes de pago antes de los vencimientos.
- **Extracción de Movimientos desde Archivos**:
  - Al adjuntar facturas, tickets o resúmenes bancarios (PDF/imágenes), extrae las transacciones y ofrece un botón directo para incorporar todos los movimientos a la cuenta en 1 clic.
- **Notificaciones Proactivas y Bot de Telegram**: Envío automático de alertas de cierres y vencimientos de resúmenes de tarjeta.

---

## 10. Panel de Configuración y Administración (⚙️)

Accesible desde el ícono de engranaje:
1. **Cuentas Principales**: Alta, edición y configuración de módulos activos por cuenta.
2. **Tarjetas de Crédito**: Gestión de plásticos, límites, fechas de cierre/vencimiento y cuenta vinculada.
3. **Categorías**: Catálogo personalizado de ingresos y gastos.
4. **Subcuentas de Ahorro**: Gestión de bolsas del chanchito.
5. **Contactos**: Directorio para cuentas corrientes compartidas.
6. **Recordatorios**: Configuración de alertas automáticas para Telegram y Web.
