# 🌊 Manual Maestro y Documentación del Sistema — Fluxo Fintech Suite

Este documento contiene la **guía integral de arquitectura, credenciales, flujo de despliegue, estructura de base de datos y especificación funcional de módulos** de Fluxo. Está diseñado para que cualquier desarrollador, operador o agente de Inteligencia Artificial entienda el sistema al 100%, sepa dónde encontrar cada recurso y pueda operar, modificar la base de datos o actualizar el código sin necesidad de intervención manual por parte de los creadores originales.

---

## 📌 Índice General

1. [¿Qué es Fluxo y para qué sirve?](#1-qué-es-fluxo-y-para-qué-sirve)
2. [Arquitectura del Sistema & Stack Tecnológico](#2-arquitectura-del-sistema--stack-tecnológico)
3. [Detalle de Keys, Variables de Entorno y Credenciales](#3-detalle-de-keys-variables-de-entorno-y-credenciales)
   - [Supabase](#a-supabase-base-de-datos-auth--storage)
   - [Vercel](#b-vercel-hosting-serverless-functions--cicd)
   - [GitHub](#c-github-repositorio-y-control-de-versiones)
   - [Google Gemini AI](#d-google-gemini-ai-inteligencia-artificial)
   - [Telegram Bot](#e-telegram-bot-fluxobot)
4. [Paso a Paso: Cómo Realizar Cambios y Desplegar el Código](#4-paso-a-paso-cómo-realizar-cambios-y-desplegar-el-código)
5. [Gestión y Modificación de la Base de Datos (Supabase)](#5-gestión-y-modificación-de-la-base-de-datos-supabase)
6. [Desglose Funcional de Módulos (Qué hace cada uno)](#6-desglose-funcional-de-módulos-qué-hace-cada-uno)
   - [Dashboard (Panel de Control)](#módulo-1-dashboard-panel-de-control)
   - [Movimientos (Libro Contable & Flujo de Caja)](#módulo-2-movimientos-libro-contable--flujo-de-caja)
   - [Tarjetas de Crédito](#módulo-3-tarjetas-de-crédito)
   - [Gastos Compartidos (Cuentas Corrientes / Clearing)](#módulo-4-gastos-compartidos-cuentas-corrientes--clearing)
   - [Ahorro (Alcancías / Chanchitos)](#módulo-5-ahorro-alcancías--chanchitos)
   - [Inversiones (Portfolio Bursátil)](#módulo-6-inversiones-portfolio-bursátil)
   - [Presupuesto Mensual](#módulo-7-presupuesto-mensual)
   - [Administración / Configuración](#módulo-8-administración--configuración)
   - [FluxoBot (Telegram) & FluxoAI (Web)](#módulo-9-fluxobot-telegram--fluxoai-web)
7. [Reglas de Negocio y Criterios Contables Fundamentales](#7-reglas-de-negocio-y-criterios-contables-fundamentales)
8. [Estructura del Proyecto y Archivos Críticos](#8-estructura-del-proyecto-y-archivos-críticos)
9. [Solución de Problemas Frecuentes (Troubleshooting)](#9-solución-de-problemas-frecuentes-troubleshooting)

---

## 1. ¿Qué es Fluxo y para qué sirve?

**Fluxo** es una suite financiera integral y moderna (B2C/Family Office) diseñada para resolver la complejidad contable cotidiana de familias, profesionales y particulares en economías bimonetarias (**ARS** y **USD**).

### Problemas que resuelve:
1. **Flujo de caja bimonetario real**: Control estricto de dinero en cuentas bancarias, billeteras digitales y efectivo.
2. **Tarjetas de crédito sin desfasajes**: Control de consumos en cuotas futuras, imputación contable al mes de vencimiento real del resumen y lectura automatizada de resúmenes (PDF y Excel) con Inteligencia Artificial.
3. **Clearing de gastos compartidos**: División automática de cuentas entre convivientes o socios con compensación de deudas en un clic.
4. **Planificación de ahorro e inversión**: Bóvedas con metas y seguimiento de activos bursátiles (acciones, CEDEARs, bonos, cripto).
5. **Asistente IA proactivo**: Asesoramiento financiero cuantitativo en tiempo real (evaluación de compra contado vs. cuotas, impacto presupuestario) mediante Telegram y chat web.

---

## 2. Arquitectura del Sistema & Stack Tecnológico

Fluxo opera bajo una arquitectura desacoplada de alto rendimiento, serverless y libre de dependencias pesadas:

```
┌─────────────────────────────────────────────────────────────┐
│                    USUARIO / NAVEGADOR                      │
│        SPA Vanilla JavaScript (ES Modules) + Vite + CSS3    │
└──────────────┬──────────────────────────────▲───────────────┘
               │                              │
     Peticiones HTTP REST             Eventos Reactivos
               │                              │
┌──────────────▼──────────────────────────────┴───────────────┐
│                    VERCEL EDGE SERVERLESS                   │
│   Router Principal: api/index.js                            │
│   Microservicios: api_controllers/*.js                      │
│   Librerías Compartidas: api_lib/ (Auth, Supabase, Gemini)  │
└──────────────┬──────────────────────────────▲───────────────┘
               │                              │
         Supabase SDK                   Webhooks
               │                              │
┌──────────────▼──────────────────────────────┴───────────────┐
│                    SUPABASE (PostgreSQL 15)                 │
│   • Base de Datos Relacional                                │
│   • Autenticación (Supabase Auth / JWT)                     │
│   • Row Level Security (RLS) para aislamiento multi-tenant  │
└──────────────▲──────────────────────────────▲───────────────┘
               │                              │
   Ingesta de prompts            Mensajes de Telegram
               │                              │
┌──────────────┴──────────────┐ ┌─────────────┴───────────────┐
│     GOOGLE GEMINI AI        │ │       TELEGRAM BOT API      │
│  (Gemini 3.8 / Flash API)   │ │    (Webhook Serverless)     │
└─────────────────────────────┘ └─────────────────────────────┘
```

- **Frontend**: Vanilla JavaScript (ES2022+), Vite 5 como bundler ultra rápido (build en ~1s), Chart.js 4 para visualizaciones financieras, arquitectura modular sin frameworks pesados (React/Angular/Vue) garantizando tiempos de carga de primer byte inferiores a 300 ms.
- **Backend**: Node.js Serverless Functions en Vercel (`api/index.js` enruta a los controladores en `api_controllers/`).
- **Base de Datos**: PostgreSQL 15 provisto por Supabase con políticas RLS activas.
- **IA**: Google Gemini API (modelos Flash de ultra baja latencia con auto-descubrimiento dinámico de versiones).
- **Despliegue Continuo (CI/CD)**: GitHub conectado con Vercel. Cada `push` a la rama `main` dispara automáticamente la compilación y despliegue a producción.

---

## 3. Detalle de Keys, Variables de Entorno y Credenciales

Para que el sistema funcione en local o en la nube, se configuran las siguientes variables de entorno:

### A. Supabase (Base de Datos, Auth & Storage)
- **`SUPABASE_URL`**: URL base del proyecto en Supabase.
  - *Valor actual de producción*: `https://ltmpajstmrcmxezpfusn.supabase.co`
  - *Dónde encontrarlo*: Panel de Supabase $\rightarrow$ Proyecto $\rightarrow$ **Project Settings** $\rightarrow$ **API** $\rightarrow$ *Project URL*.
- **`SUPABASE_ANON_KEY`**: Llave pública anónima de Supabase. Posee permisos restringidos por Row Level Security (RLS). Se utiliza en el cliente y en endpoints no privilegiados.
  - *Dónde encontrarlo*: Panel de Supabase $\rightarrow$ **Project Settings** $\rightarrow$ **API** $\rightarrow$ *Project API keys* $\rightarrow$ `anon` / `public`.
- **`SUPABASE_SERVICE_ROLE_KEY`**: Llave secreta administrativa (`service_role`). Esta llave **bypassea todas las políticas RLS**. Es obligatoria en el backend serverless para tareas como sincronización en cascada, eliminación de series, bots y triggers internos.
  - *Dónde encontrarlo*: Panel de Supabase $\rightarrow$ **Project Settings** $\rightarrow$ **API** $\rightarrow$ *Project API keys* $\rightarrow$ `service_role` *(Secret)*.
  - ⚠️ **ADVERTENCIA**: Jamás debe exponerse al frontend ni commitearse en Git.

### B. Vercel (Hosting, Serverless Functions & CI/CD)
Vercel compila el frontend con Vite y aloja las serverless functions.
- **Configuración en Vercel Dashboard**:
  - Ir a [vercel.com](https://vercel.com) $\rightarrow$ Proyecto **Fluxo** $\rightarrow$ **Settings** $\rightarrow$ **Environment Variables**.
  - Asegurar que estén cargadas las siguientes variables para los entornos *Production*, *Preview* y *Development*:
    1. `SUPABASE_URL`
    2. `SUPABASE_ANON_KEY`
    3. `SUPABASE_SERVICE_ROLE_KEY`
    4. `GEMINI_API_KEY`
    5. `GEMINI_MODEL` (opcional, por defecto `gemini-3.8-flash`)
    6. `TELEGRAM_BOT_TOKEN`
    7. `TELEGRAM_WEBHOOK_SECRET`
- **Build & Output Settings en Vercel**:
  - *Framework Preset*: Vite
  - *Build Command*: `vite build`
  - *Output Directory*: `dist`
  - *Install Command*: `npm install`
  - *Node.js Version*: `20.x` o superior

### C. GitHub (Repositorio y Control de Versiones)
- **URL del Repositorio**: `https://github.com/gnpozzo/fluxo.git`
- **Rama principal de producción**: `main`
- **Autenticación Git**:
  - Mediante **Personal Access Token (Classic o Fine-grained)** con permisos de `repo` (`contents:write`), o clave **SSH** configurada en GitHub (`~/.ssh/id_ed25519`).
  - Al realizar `git push origin main`, GitHub notifica a Vercel vía webhook para iniciar el despliegue automático.

### D. Google Gemini AI (Inteligencia Artificial)
- **`GEMINI_API_KEY`**: Llave de API generada en [Google AI Studio](https://aistudio.google.com/).
  - Se utiliza para:
    1. Parseo automático e inteligente de resúmenes de tarjetas de crédito en PDF y Excel (`api_controllers/parseStatement.js`).
    2. Asesor financiero cuantitativo en el chat y en Telegram (`api_controllers/aiAdvisor.js`).
    3. Normalización y categorización semántica de gastos recurrentes.
- **`GEMINI_MODEL`**: Modelo preferido (por defecto `gemini-3.8-flash`). La librería `api_lib/gemini.js` implementa auto-descubrimiento dinámico de versiones superiores disponibles en la API de Google sin requerir cambios de código.

### E. Telegram Bot (FluxoBot)
- **`TELEGRAM_BOT_TOKEN`**: Token generado mediante `@BotFather` en Telegram al crear el bot.
- **`TELEGRAM_WEBHOOK_SECRET`**: Secreto de validación para asegurar que las llamadas entrantes a `/api/telegramWebhook` provengan legítimamente de los servidores de Telegram.
- **Webhook URL**: `https://<tu-dominio-de-vercel>/api/telegramWebhook`

---

## 4. Paso a Paso: Cómo Realizar Cambios y Desplegar el Código

Para que cualquier cambio realizado en la aplicación se refleje de inmediato en producción, sigue estrictamente este procedimiento:

### Paso 1: Abrir la terminal en la raíz del proyecto
```powershell
cd c:\Users\Gaston\node.js\Fluxo
```

### Paso 2: Verificar la compilación local (Evita enviar código roto)
Antes de commitear, ejecuta el bundler para asegurar que no hay errores de sintaxis ni módulos faltantes:
```powershell
npm run build
```
*Debe finalizar con `✓ built in X.XXs` sin arrojar errores.*

### Paso 3: Revisar el estado de archivos modificados
```powershell
git status
```

### Paso 4: Agregar los cambios al área de preparación (Staging)
```powershell
git add -A
```

### Paso 5: Crear el commit con un mensaje descriptivo
Usa la convención estándar (ej. `fix`, `feat`, `refactor`, `style`):
```powershell
git commit -m "fix(modulo): descripcion clara del cambio aplicado"
```

### Paso 6: Subir los cambios a GitHub (Push a Producción)
```powershell
git push origin main
```

### Paso 7: Despliegue Automático en Vercel
- En cuanto el comando `git push origin main` termina exitosamente, GitHub dispara el webhook hacia Vercel.
- Vercel descarga el commit, corre `npm run build` y publica la nueva versión en aproximadamente **30 a 50 segundos**.
- Para verificar los cambios en el navegador:
  - Abrir la web de Fluxo.
  - Realizar un **Hard Refresh** (**Ctrl + F5** en Windows o **Cmd + Shift + R** en Mac) para vaciar la caché de scripts antiguos del navegador.

---

## 5. Gestión y Modificación de la Base de Datos (Supabase)

Toda la base de datos reside en Supabase (PostgreSQL 15). No se requieren migraciones complejas por CLI; todo se puede gestionar desde la consola web:

### ¿Dónde ejecutar scripts SQL?
1. Ingresar a [supabase.com](https://supabase.com) con las credenciales del proyecto.
2. Ir a la sección **SQL Editor** (icono `>_` en la barra lateral izquierda).
3. Pegar la consulta o script y hacer clic en **Run** (Ctrl + Enter).

### Tablas Principales del Sistema:
| Tabla | Propósito |
|---|---|
| `cuentas_principales` | Cuentas bancarias o billeteras del usuario (ej: Santander, Mercado Pago, Efectivo). |
| `categorias` | Categorías de gastos e ingresos con su icono, color y tipo (`INGRESO`/`EGRESO`). |
| `movimientos` | Libro diario de transacciones (ingresos, egresos, recurrentes, cuotas, transferencias). |
| `tarjetas` | Plásticos de crédito registrados con sus fechas de cierre, vencimiento y límites. |
| `consumos_tc` | Registro detallado de consumos de tarjetas de crédito en ARS y USD con cuotas. |
| `cta_corriente_usuarios` | Contactos y personas registradas para división de gastos compartidos. |
| `cta_corriente_movimientos` | Gastos compartidos y transferencias de clearing de cuentas corrientes. |
| `ahorro_subcuentas` | Alcancías o chanchitos de ahorro en pesos y dólares con montos meta. |
| `ahorro_movimientos` | Depósitos y extracciones de cada alcancía vinculados a cuentas de origen. |
| `inversiones_activos` | Activos bursátiles en cartera (acciones, bonos, CEDEARs, cripto). |
| `inversiones_operaciones`| Compras, ventas y cobro de dividendos o rentas. |
| `presupuestos` | Límites presupuestarios mensuales por categoría. |
| `recordatorios` | Vencimientos de servicios y recordatorios de pago. |
| `bot_sessions` | Historial de conversación multi-turn y contexto de FluxoBot / Gemini. |
| `perfiles_usuario` | Preferencias de usuario y **reglas aprendidas de imputación automática**. |
| `logs` | Registro de eventos del sistema, conciliaciones y estados de pago. |

### Reglas para Modificar Tablas:
1. **Multi-tenancy (Aislamiento de Usuarios)**: Toda nueva tabla **debe** incluir la columna `user_id UUID REFERENCES auth.users(id)` o vincularse a una tabla que la contenga.
2. **Row Level Security (RLS)**: Cada tabla debe tener RLS activado:
   ```sql
   ALTER TABLE nombre_tabla ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Usuarios acceden a sus propios registros"
     ON nombre_tabla FOR ALL
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);
   ```
3. **Scripts de Referencia**: En la raíz del repositorio se encuentran scripts base como `setup_supabase_schema.sql` y `migration_multitenant_security.sql`.

---

## 6. Desglose Funcional de Módulos (Qué hace cada uno)

Fluxo está compuesto por módulos independientes bajo el patrón `BaseModule`. A continuación se detalla la responsabilidad de cada uno:

### Módulo 1: Dashboard (Panel de Control)
- **Objetivo**: Brindar una visión panorámica instantánea de la salud financiera del mes activo.
- **Funcionalidades**:
  - **KPIs Principales**: Ingresos del mes, Egresos totales, Resultado neto (Superávit/Déficit), Saldo de Tarjetas en ARS y USD.
  - **Gráfico de Flujo de Fondos**: Evolución acumulada y diaria del dinero.
  - **Evolución Histórica (6 Meses)**: Comparativa de ingresos vs. egresos de los últimos 6 meses.
  - **Distribución de Egresos**: Gráfico Donut moderno de gastos clasificados por categoría.
  - **Últimos Movimientos**: Tabla con acciones inmediatas para ver detalle, editar o eliminar. Si el registro pertenece a una serie, se abre el modal de confirmación unificado (*Solo este movimiento* vs. *Toda la serie*).

### Módulo 2: Movimientos (Libro Contable & Flujo de Caja)
- **Objetivo**: Administrar el 100% de los ingresos y egresos de dinero.
- **Funcionalidades**:
  - **Registro común**: Gastos o cobros puntuales.
  - **Recurrentes**: Permite fijar pagos con repeticiones periódicas (ej. 12, 24, 36 repeticiones). Se etiquetan con badge `Recurrente` (sin forzar formatos de cuota).
  - **En Cuotas**: Pagos fraccionados con seguimiento de cuota actual y total (ej. Cuota 1/6). Muestra badge especial `🏁 Última cuota` cuando se alcanza el final.
  - **Split de Gastos**: Distribución de un único desembolso entre varias cuentas (ej. 50% Personal, 50% Hogar).
  - **Control de Pago (Saldado vs. Pendiente)**: Botón interactivo para marcar si un egreso ya fue pagado o está pendiente de cancelación este mes.
  - **Optimistic UI (Zero Delay)**: Los modales se cierran al instante (0ms) y la interfaz actualiza los datos localmente mientras sincroniza con Supabase en segundo plano.

### Módulo 3: Tarjetas de Crédito
- **Objetivo**: Control minucioso de tarjetas de crédito físicas y virtuales, evitando sorpresas al momento del cierre.
- **Funcionalidades**:
  - **Bento Cards**: Visualización plástica de cada tarjeta con sus límites, fecha de cierre y fecha de vencimiento.
  - **Vistas**: Permite alternar entre una tarjeta específica o la vista *Consolidado*.
  - **Bimonetarismo Estricto**: Separación clara entre consumos en pesos (ARS) y dólares (USD).
  - **Imputación a Cuentas de Gasto**: Permite registrar consumos de tarjeta e imputarlos como egreso en una cuenta bancaria destino (ej. *Hogar*), generando el reintegro contable compensatorio al momento de pagar el resumen.
  - **Importador Inteligente de Resúmenes**: Sube archivos PDF o Excel de resúmenes (Visa, Mastercard, Mercado Pago) y **Gemini AI** extrae automáticamente todos los consumos, fechas, cuotas e impuestos.
  - **Modal de Confirmación Unificado**: Al editar o eliminar un consumo en cuotas o recurrente, un modal seguro consulta si se desea aplicar el cambio a *Solo este consumo* o a *Toda la serie*.
  - **Pagar Resumen**: Botón de liquidación oficial que cancela la deuda y genera el movimiento contable correspondiente.

### Módulo 4: Gastos Compartidos (Cuentas Corrientes / Clearing)
- **Objetivo**: Gestionar finanzas compartidas entre parejas, familiares, compañeros de departamento o socios.
- **Funcionalidades**:
  - Registro de contactos pagadores.
  - División porcentual de consumos (ej. 50/50, 70/30).
  - Saldo deudor o acreedor consolidado por persona.
  - Botón de **Liquidación/Clearing**: Genera los movimientos de compensación con un clic cuando una parte transfiere su saldo adeudado.

### Módulo 5: Ahorro (Alcancías / Chanchitos)
- **Objetivo**: Aislar dinero del saldo operativo para metas específicas (vacaciones, fondo de emergencia, compras grandes).
- **Funcionalidades**:
  - Creación de bóvedas bimonetarias (ARS / USD).
  - Indicador de progreso hacia el objetivo (% completado).
  - Depósitos (extraen de una cuenta principal y suman al chanchito).
  - Rescates (reintegran el dinero a la cuenta principal elegida).

### Módulo 6: Inversiones (Portfolio Bursátil)
- **Objetivo**: Seguimiento patrimonial de activos del mercado financiero.
- **Funcionalidades**:
  - Soporte de Acciones locales, CEDEARs, Bonos soberanos, Obligaciones Negociables (ONs) y Criptomonedas.
  - Registro de órdenes de compra, venta y cobro de rentas/dividendos.
  - Cálculo de precio promedio de compra (PPP), tenencia valorizada y rendimiento porcentual y nominal.

### Módulo 7: Presupuesto Mensual
- **Objetivo**: Fijar límites de gasto planificado por categoría para evitar desvíos.
- **Funcionalidades**:
  - Asignación de montos tope por categoría para el mes.
  - Barras de progreso de consumo presupuestario (Verde $\rightarrow$ Amarillo $\rightarrow$ Rojo en caso de exceso).
  - Estimación dinámica automatizada según reglas de negocio (ej. Supermercado como 25% de los ingresos percibidos).

### Módulo 8: Administración / Configuración
- **Objetivo**: Configuración del sistema y catálogos maestros.
- **Funcionalidades**:
  - Gestión de Cuentas Principales (nombre, moneda, tipo).
  - Gestión de Categorías (nombre, icono, color, tipo).
  - Gestión de Tarjetas de crédito (banco, color del plástico, fechas de corte).
  - Gestión de Contactos de Gastos Compartidos.
  - Preferencias de usuario y cambio de contraseña/seguridad.

### Módulo 9: FluxoBot (Telegram) & FluxoAI (Web)
- **Objetivo**: Interacción conversacional en lenguaje natural con la base de datos de Fluxo.
- **Funcionalidades**:
  - **Registro rápido de gastos**: *"Gasté 15.000 en verdulería con débito Santander"*.
  - **Asesoramiento cuantitativo en decisiones de compra**:
    - Ejemplo: *"¿Me conviene comprar una heladera de 900.000 al contado o en 3 cuotas de 400.000?"*
    - El bot analiza la liquidez actual, los compromisos futuros ya agendados para el mes siguiente, calcula la tasa implícita mensual y emite un veredicto tajante en la primera línea.
  - **Memoria persistente multi-turn**: Mantiene el hilo de conversación en `bot_sessions` para repreguntas y seguimiento.

---

## 7. Reglas de Negocio y Criterios Contables Fundamentales

Cualquier cambio de código debe preservar estas reglas contables:

1. **Fecha de Consumo vs. Fecha de Vencimiento de Tarjetas**:
   - Todo consumo de tarjeta de crédito se computa financieramente en el **mes de vencimiento del resumen** (cuando efectivamente sale el dinero de la cuenta), y no en la fecha de corte o compra.
2. **Eliminación y Edición de Series**:
   - Si un registro pertenece a una serie (recurrente o cuotas), el sistema **siempre** debe consultar el alcance de la modificación (*Solo este* vs. *Toda la serie*).
   - Al eliminar *Toda la serie*, se eliminan en cascada todos los registros que compartan el `recur_group_id` tanto en `movimientos` como en `consumos_tc`, sin dejar registros huérfanos.
3. **Sanitización de Descripciones**:
   - Los ingresos o gastos recurrentes no deben contener etiquetas residuales como `(Cuota 1/12)`. Las cuotas quedan reservadas exclusivamente para compras fraccionadas (`tipoConsumo === 'CUOTAS'`).
4. **Pago de Resúmenes de Tarjeta**:
   - Es una transferencia compensatoria de liquidez. No debe duplicar los gastos en las categorías estadísticas.

---

## 8. Estructura del Proyecto y Archivos Críticos

```plaintext
Fluxo/
├── api/                           # Entrypoint de Vercel Serverless
│   └── index.js                   # Router dinámico de endpoints
├── api_controllers/               # Controladores Backend (Microservicios)
│   ├── aiAdvisor.js               # Motor de IA y asesoramiento con Gemini
│   ├── createMovimiento.js        # Alta de ingresos/egresos con series y splits
│   ├── updateMovimiento.js        # Edición con alcance SINGLE o SERIES
│   ├── deleteMovimiento.js        # Eliminación individual o serie completa
│   ├── getDashboardData.js        # Feed consolidado del panel principal
│   ├── getConsumosTC.js           # Consulta y acotamiento de tarjetas
│   ├── createConsumoTC.js         # Alta de consumos en cuotas/recurrentes
│   ├── updateConsumoTC.js         # Edición de consumos de tarjeta
│   ├── deleteConsumoTC.js         # Eliminación de consumos y series TC
│   ├── parseStatement.js          # Ingesta OCR y parseo de resúmenes con IA
│   ├── togglePago.js              # Marcación de pagos y liquidación de resúmenes
│   └── telegramWebhook.js         # Webhook de FluxoBot en Telegram
├── api_lib/                       # Librerías Compartidas del Backend
│   ├── auth.js                    # Autenticación y resolución segura de cuentas
│   ├── gemini.js                  # Conexión y auto-descubrimiento de modelos Gemini
│   └── supabase.js                # Cliente Supabase (soporte anon y service_role)
├── src/                           # Código Fuente del Frontend
│   ├── components/                # Componentes Reutilizables (Modal, DataTable, etc.)
│   ├── core/                      # Núcleo de la SPA (AppBootstrap, AppStore, etc.)
│   ├── modules/                   # Módulos de Vista
│   │   ├── DashboardModule.js     # Lógica y render del Dashboard
│   │   ├── MovimientosModule.js   # Libro contable y optimizaciones de UI
│   │   ├── TarjetasModule.js      # Gestión de tarjetas y resúmenes
│   │   ├── CcModule.js            # Gastos Compartidos
│   │   ├── AhorroModule.js        # Alcancías
│   │   └── InversionesModule.js   # Inversiones bursátiles
│   └── styles/
│       └── main.css               # Sistema de diseño, temas y componentes
├── index.html                     # Shell principal de la SPA
├── package.json                   # Dependencias y scripts de construcción
├── vercel.json                    # Configuración de rutas, CORS y crons de Vercel
├── vite.config.js                 # Configuración de Vite
├── DOCUMENTACION_SISTEMA.md       # Este documento maestro
└── README.md                      # Resumen rápido del repositorio
```

---

## 9. Solución de Problemas Frecuentes (Troubleshooting)

### A. Los cambios hechos no se ven en la app web
1. Comprueba si se ejecutó `git push origin main`.
2. Revisa el dashboard de Vercel para confirmar que el deployment haya finalizado con estado `Ready` (verde).
3. Aplica **Hard Refresh** en el navegador (**Ctrl + F5**) para limpiar la caché de scripts locales.

### B. Error: "Missing Supabase variables in environment config"
- Asegúrate de que `SUPABASE_URL` y `SUPABASE_ANON_KEY` estén definidas tanto en el archivo `.env` local como en **Settings $\rightarrow$ Environment Variables** en Vercel.

### C. Error: "GEMINI_API_KEY no configurada en el servidor"
- Verifica en Vercel que la variable `GEMINI_API_KEY` esté configurada para el entorno de producción y redespliega.

### D. Al eliminar una serie no se eliminan todos los meses
- El backend utiliza `scope === 'SERIES'`. Si no se envía el `recurGroupId` en la petición, los controladores `deleteMovimiento.js` y `deleteConsumoTC.js` realizan un fallback automático a la base de datos para recuperar el grupo y purgar todos los registros vinculados.

---

*Documento actualizado y verificado para la versión 6.x de Fluxo.*
