# 🌊 Fluxo — Asistente Financiero Personal Inteligente & Suite Fintech

Fluxo es una plataforma integral de gestión financiera personal y familiar, desarrollada bajo una arquitectura moderna, reactiva y bimonetaria (ARS/USD). Combina un libro contable mensual, seguimiento y liquidación precisa de tarjetas de crédito, clearing de gastos compartidos, bóvedas de ahorro (chanchitos), monitor de inversiones en tiempo real y un asistente de inteligencia artificial (FluxoBot en Telegram / FluxoAI) potenciado por Google Gemini.

---

## 📌 Índice
1. [Cómo Continuar el Proyecto desde Otra PC](#-cómo-continuar-el-proyecto-desde-otra-pc)
2. [Cómo Pasa el Contexto a Antigravity (IA) en la Nueva PC](#-cómo-pasa-el-contexto-a-antigravity-ia-en-la-nueva-pc)
3. [Arquitectura del Sistema](#-arquitectura-del-sistema)
4. [Estructura de Directorios](#-estructura-de-directorios)
5. [Variables de Entorno Requeridas (.env)](#-variables-de-entorno-requeridas-env)
6. [Reglas de Negocio y Criterios Contables Fundamentales](#-reglas-de-negocio-y-criterios-contables-fundamentales)
7. [Historial Completo de Versiones y Changelog Detallado](#-historial-completo-de-versiones-y-changelog-detallado)

---

## 💻 Cómo Continuar el Proyecto desde Otra PC

Dado que el código fuente y el historial de cambios se encuentran sincronizados en el repositorio de GitHub ([github.com/gnpozzo/fluxo](https://github.com/gnpozzo/fluxo.git)), **no necesitas copiar gigabytes de carpetas temporales ni `node_modules`**.

### Paso 1: Clonar o Descargar el Repositorio
En la nueva PC, abre una terminal (PowerShell, Bash o Git Bash) y ejecuta:
```bash
git clone https://github.com/gnpozzo/fluxo.git
cd fluxo
```
*(Alternativamente, si copias la carpeta `C:\Users\gpozzo\node.js\Fluxo`, asegúrate de **omitir la carpeta `node_modules`** para que la transferencia sea instantánea).*

### Paso 2: Crear el Archivo de Variables de Entorno (`.env`)
Por razones de seguridad estricta, los archivos `.env` y `.env.service` **están ignorados por Git** y nunca se suben a la nube. **Debes copiarlos manualmente desde la PC anterior** o crearlos en la raíz del proyecto en la nueva PC con los siguientes valores:

**Archivo `.env`:**
```ini
SUPABASE_URL=https://ltmpajstmrcmxezpfusn.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0bXBhanN0bXJjbXhlenBmdXNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDIxODQsImV4cCI6MjA4OTUxODE4NH0.5OijGzY6bj2pW_JXr0O4ztvYaN_6wiuzj9IXrbnkpOk
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key_aqui
GEMINI_API_KEY=tu_gemini_api_key_aqui
TELEGRAM_BOT_TOKEN=tu_telegram_bot_token_aqui
TELEGRAM_WEBHOOK_SECRET=tu_webhook_secret_aqui
```

### Paso 3: Instalar Dependencias
Asegúrate de tener instalado **Node.js 20+**. Luego ejecuta:
```bash
npm install
```

### Paso 4: Ejecutar en Entorno Local
Para iniciar el servidor de desarrollo de Vite:
```bash
npm run dev
```
La aplicación web estará disponible de inmediato en `http://localhost:5173`.

Para verificar la compilación de producción:
```bash
npm run build
```

---

## 🤖 Cómo Pasa el Contexto a Antigravity (IA) en la Nueva PC

Cuando abras este proyecto con **Antigravity** (o cualquier asistente de desarrollo asistido) en otra PC:

1. **Memoria del Agente**:
   La memoria de chat de sesiones anteriores reside localmente en la máquina de origen (`C:\Users\<usuario>\.gemini\antigravity`). En una nueva PC, Antigravity inicia una sesión nueva.
2. **Cómo recupera el 100% del contexto**:
   Antigravity inspecciona la estructura del repositorio al iniciar. Al leer este `README.md`, el archivo `manual_de_usuario.md` y el historial de commits recientes (`git log`), **el agente comprende inmediatamente todo el modelo de datos, las decisiones de diseño tomadas, las reglas de negocio y el estado actual del código**, exactamente igual a como si hubiera estado en la conversación previa.
3. **Prompt de inicio recomendado para la nueva PC**:
   Cuando abras la conversación en la nueva máquina, simplemente puedes escribirle al asistente:
   > *"Hola, estoy continuando el proyecto Fluxo desde esta máquina. Por favor lee el README.md y el historial de git para situarte en el contexto y estado actual."*

---

## 🏛️ Arquitectura del Sistema

Fluxo opera bajo una arquitectura desacoplada de alto rendimiento:

```
[ Frontend: SPA Vanilla JS + Vite + Chart.js ]
      │                                   ▲
      ▼ Fetch / REST                      │ Webhook Updates
[ Vercel Edge Serverless Functions ]  [ Telegram Bot ]
 (api_controllers / api_lib)              │ (Gemini 2.5 AI)
      │                                   │
      ▼ Client SDK / RLS                  ▼
   [ Supabase PostgreSQL 15 (Auth + Data + Sessions) ]
```

1. **Frontend (SPA Modular)**:
   - Construido en **Vanilla JavaScript ES Modules**, sin frameworks pesados, garantizando tiempos de carga inferiores a 300 ms.
   - Componentes reactivos nativos (`DataTable`, `KpiCard`, `Modal`, `Toast`, `Store`).
   - Visualización analítica con **Chart.js**: Anillos Donut modernos (`cutout: 72%`) y series temporales agrupadas.
   - Estilizado con CSS3 Fintech (variables de diseño, modo oscuro, tokens de espaciado y tipografía Inter).
2. **Backend Serverless (Vercel Node.js Functions)**:
   - Ubicado en `api_controllers/` y enrutado dinámicamente mediante `api/index.js` y `vercel.json`.
   - Conexión a base de datos centralizada y autenticada en `api_lib/supabase.js` y `api_lib/auth.js`.
3. **Base de Datos (Supabase PostgreSQL)**:
   - Esquema relacional con políticas RLS (*Row Level Security*) para aislamiento multi-tenant.
   - Tablas clave: `cuentas_principales`, `categorias`, `movimientos`, `tarjetas`, `consumos_tc`, `cta_corriente_usuarios`, `ahorro_subcuentas`, `inversiones_movimientos`, `recordatorios`, `bot_sessions`, `logs`.
4. **Inteligencia Artificial & Bot de Telegram**:
   - Webhook serverless en `api_controllers/telegramWebhook.js`.
   - Motor de lenguaje natural con **Google Gemini** para clasificación de intenciones, extracción de entidades y asesoramiento financiero cuantitativo.
   - Historial de diálogo multi-turn persistente en la tabla `bot_sessions`.

---

## 📂 Estructura de Directorios

```plaintext
Fluxo/
├── api/                           # Punto de entrada serverless para Vercel
│   └── index.js
├── api_controllers/               # Controladores de backend Node.js (Microservicios)
│   ├── getDashboardData.js        # KPIs, lista de movimientos y serie histórica de 6 meses
│   ├── getConsumosTC.js           # Consulta y acotamiento estricto de consumos de tarjetas
│   ├── togglePago.js              # Marcación de pagos saldados y liquidación de resúmenes
│   ├── telegramWebhook.js         # FluxoBot: procesamiento de mensajes, PDF y asesoramiento Gemini
│   └── ...                        # ABM de cuentas, categorías, ahorros, inversiones y clearing
├── api_lib/                       # Librerías auxiliares compartidas (Supabase, Auth)
├── src/                           # Código fuente del Frontend
│   ├── index.html                 # Shell de la SPA
│   ├── app.js                     # Inicializador, enrutador y Store reactivo global
│   ├── modules/                   # Módulos de vista independientes
│   │   ├── BaseModule.js          # Clase base con ciclo de vida (init, cargar, render)
│   │   ├── MovimientosModule.js   # Libro contable + analítica side-by-side (Dona + Evolución)
│   │   ├── TarjetasModule.js      # Bento cards plásticas + grilla + dona por categoría
│   │   ├── CuentasCorrientesModule.js # Clearing de gastos compartidos
│   │   ├── AhorroModule.js        # Bóvedas / Chanchitos ARS y USD
│   │   ├── InversionesModule.js   # Portfolio y cotizaciones bursátiles en tiempo real
│   │   └── PresupuestoModule.js   # Planificación mensual de gastos
│   ├── components/                # Componentes UI (DataTable, Modal, KpiCard, Toast)
│   └── styles/
│       └── main.css               # Sistema de diseño, layout side-by-side y componentes fintech
├── manual_de_usuario.md           # Manual exhaustivo de todas las funciones de la app
├── Manual_de_Usuario_Fluxo_For_Dummies.pdf # Manual imprimible ilustrado para usuarios
├── package.json                   # Dependencias y scripts de construcción
├── vercel.json                    # Configuración de despliegue serverless y CORS
└── README.md                      # Esta documentación técnica y guía de desarrollo
```

---

## ⚖️ Reglas de Negocio y Criterios Contables Fundamentales

Cualquier cambio de código o interacción con FluxoBot debe respetar estas directrices contables:

1. **Imputación de Consumos de Tarjeta de Crédito**:
   - Todo consumo de tarjeta de crédito se imputa contablemente al **mes de vencimiento del resumen** (no al mes en que se efectuó la compra). Esto se debe a que el pago está diferido y el impacto de flujo de caja ocurre en el vencimiento.
2. **Liquidación de Resumen de Tarjeta (Individual vs Consolidado)**:
   - Si se selecciona una tarjeta específica (ej. *Santander Visa*), el botón `💳 Pagar Resumen (Santander Visa)` liquida **únicamente** la deuda de esa tarjeta ($1.196.675,09 para Santander Visa en sep 2026).
   - Si se selecciona la vista *Consolidado*, liquida en lote todas las tarjetas con deuda del período.
   - El débito bancario por pago de resumen es un movimiento financiero de compensación; no debe duplicar los gastos en los gráficos de categorías.
3. **Pólizas de Seguro "La Segunda"**:
   - Si el gasto se imputa a la cuenta **Hogar** (familiar), la categoría obligatoria es **Vivienda** (póliza seguro de casa).
   - Si se imputa a la cuenta **Personal**, la categoría obligatoria es **Transporte** (póliza seguro automotor).
4. **Presupuesto Dinámico en Porcentajes**:
   - **Supermercado**: Se estima como el **25%** de los ingresos totales percibidos en la cuenta.
   - **Verdulería**: Se estima dividiendo el presupuesto de Supermercado por **5,5**.
5. **Control de Pagos (Saldados vs Pendientes)**:
   - Todo egreso posee un estado de pago (`pagado: true/false`). Los saldados representan erogaciones ya canceladas; los pendientes representan cuentas a pagar antes de fin de mes.
6. **FluxoBot en Telegram (Tono y Ejecución)**:
   - **Ultra-conciso**: Máximo 2 párrafos (menos de 90 palabras). Respuestas al grano, sin rellenos teóricos.
   - **Veredicto primero**: Ante consultas de compra ($90.000 contado vs $120.000 en 3 cuotas), responder en la primera línea con el veredicto y respaldarlo con la tasa implícita y la liquidez/compromisos del mes objetivo (*"el mes que viene"* $\rightarrow$ octubre).

---

## 📜 Historial Completo de Versiones y Changelog Detallado

### [v6.2.0] — 11 de Septiembre de 2026
#### 🤖 FluxoBot: Reingeniería de Inteligencia Artificial & Asesor Financiero
- **Memoria Conversacional Persistente Multi-Turn**:
  - Se eliminó el borrado accidental y prematuro de la tabla `bot_sessions` en consultas y registros.
  - Se implementó una ventana deslizante de los últimos 12 mensajes con timeout de 4 horas.
  - La llamada a Gemini para responder consultas ahora incluye el historial previo de conversación, eliminando la pérdida de contexto en preguntas de seguimiento.
- **Nuevo Intent de Consulta Cuantitativa (`consejo_financiero`)**:
  - Detección de decisiones de compra (ej: contado vs cuotas).
  - **Inteligencia temporal**: Si el usuario pregunta por *"el mes que viene"*, el bot analiza automáticamente el mes objetivo siguiente (octubre) en lugar del mes actual (septiembre).
  - Extracción y cotejo contra base de datos en tiempo real:
    - Liquidez actual y balance neto acumulado.
    - Compromisos fijos ya agendados para el mes de la compra (cuotas de tarjetas de crédito fijadas + egresos recurrentes).
    - Cálculo matemático de la tasa de recargo implícita (ej: +33,3% total, ~10% mensual) contrastada contra tasas de referencia de mercado (~3% mensual).
- **Protocolo de Concisión Estricta**:
  - Respuestas limitadas a menos de 90 palabras, veredicto en la primera línea y eliminación total de introducciones o discursos teóricos.
  - Saludos breves de una línea sin catálogos automáticos a menos que se invoque `/ayuda`.
- **Reglas de Negocio Automatizadas**:
  - Incorporación en el prompt de sistema del seguro "La Segunda" (Hogar $\rightarrow$ Vivienda, Personal $\rightarrow$ Transporte), presupuesto dinámico de Supermercado y Verdulería, y vencimiento de tarjetas.

---

### [v6.1.0] — 11 de Septiembre de 2026
#### 💳 Auditoría Contable y Liquidación Exacta de Tarjetas de Crédito
- **Acotamiento Temporal Estricto en Consumos TC**:
  - En [`api_controllers/getConsumosTC.js`](file:///c:/Users/gpozzo/node.js/Fluxo/api_controllers/getConsumosTC.js), se corrigió una consulta sin cota inferior que traía 7 consumos históricos de 2025 al período de septiembre 2026, corrigiendo la deuda de $1.542.273,62 (38 consumos erróneos) al valor contable real de **$1.196.675,09** (31 consumos válidos para Santander Visa).
- **Liquidación Individual vs Consolidada**:
  - Refactorización de `pagar_resumen` en [`api_controllers/togglePago.js`](file:///c:/Users/gpozzo/node.js/Fluxo/api_controllers/togglePago.js):
    - Al seleccionar una tarjeta individual, se liquida únicamente esa tarjeta por su monto exacto (`total_resumen_ars`).
    - Al seleccionar consolidado, liquida todas las tarjetas activas con deuda en lote.
- **Botón y Modal Dinámico en Frontend**:
  - Actualización del botón de acción: `💳 Pagar Resumen (Santander Visa)` o `💳 Pagar Resumen (Consolidado)`.
  - El modal de confirmación desglosa con exactitud el total a debitar y la cantidad de consumos afectados.

---

### [v6.0.0] — 11 de Septiembre de 2026
#### 📊 Rediseño Analítico Fintech Side-by-Side
- **Arquitectura de 2 Columnas Side-by-Side**:
  - Layout permanente: grilla de datos a la izquierda (~65%) y panel de analítica continua a la derecha (~35%) en `.analytics-side-layout`.
- **Módulo Movimientos**:
  - **Top Categorías**: Gráfico Donut de 72% cutout con paleta vibrante (`#06b6d4`, `#10b981`, `#3b82f6`, etc.), switch pill `[ % Gastos | % Ingresos ]` y leyenda vertical con indicadores de color, importe y porcentaje.
  - **Evolución Mensual**: Gráfico de serie temporal de 6 meses provisto por [`api_controllers/getDashboardData.js`](file:///c:/Users/gpozzo/node.js/Fluxo/api_controllers/getDashboardData.js), con switch `[ Ingresos vs Gastos | Balance ]`.
- **Módulo Tarjetas de Crédito**:
  - Eliminación del botón toggle de vista y adopción del layout side-by-side continuo.
  - El gráfico de dona se recalcula en tiempo real al alternar entre tarjetas o filtros de imputación.

---

### [v5.2.0] — 10 de Septiembre de 2026
#### ✅ Control de Pagos & Asistente Telegram PDF
- **Gestor de Pagos Saldados vs Pendientes**:
  - Marcación individual de movimientos y consumos como Saldados (`✓`) o Pendientes (`⏳`).
  - Barra de control financiero en el encabezado de Movimientos con porcentaje de avance y montos pendientes.
- **Importación Inteligente de Resúmenes PDF**:
  - Asistente guiado paso a paso por Telegram para subir el resumen bancario en PDF, extraer consumos con Gemini y conciliar imputaciones.

---

### [v5.1.0] — 09 de Septiembre de 2026
#### ⚖️ Presupuestos Dinámicos & Normalización de UI
- Implementación de presupuestos dinámicos calculados como porcentaje sobre los ingresos de la cuenta (25% Supermercado, Verdulería / 5.5).
- Normalización tipográfica con la fuente Inter y resolución de lints visuales.

---

### [v5.0.0] — Agosto / Septiembre de 2026
#### ⚡ Migración Arquitectónica: De Google Apps Script a Supabase & Vercel
- Reemplazo absoluto del backend de Google Apps Script por Supabase PostgreSQL 15 nativo y Edge Functions en Vercel.
- Adopción de políticas RLS para aislamiento multi-tenant y eliminación de demoras de ejecución de hojas de cálculo.

---

### [v4.0.0] — 2026
#### 🌐 Módulos Avanzados Fintech
- **Tarjetas Bento**: Visualización de tarjetas plásticas con chip, contactless, marca y cálculo de percepciones impositivas (Sellos, IVA Digital, Ganancias RG 5617, IIBB).
- **Clearing de Gastos Compartidos (CC)**: Gestión de saldos deudores/acreedores con contactos.
- **Chanchitos de Ahorro**: Bóvedas bimonetarias ARS/USD en bancos o brokers.
- **Monitor Global de Inversiones**: Seguimiento en tiempo real de bonos soberanos (AL30), CEDEARs, ONs y cotizaciones de Dólar MEP, CCL y Blue.

---

### [v3.0.0] — 2026
#### 💵 Motor Bimonetario Global
- Soporte para transacciones en pesos argentinos (ARS) y dólares estadounidenses (USD).
- Conversión bimonetaria global en tiempo real mediante consumo de APIs de cambio oficial y financiero.

---

### [v2.0.0] — 2026
#### 🖥️ Transición a Aplicación Web (SPA)
- Migración de planillas electrónicas a una Single Page Application moderna con diseño fintech, tabla dinámica con ordenamiento, filtrado y paginación.

---

### [v1.0.0] — 2025
#### 🌱 Fundación del Proyecto
- Creación de la solución original de control financiero personal y familiar basada en Google Sheets y Google Apps Script.
