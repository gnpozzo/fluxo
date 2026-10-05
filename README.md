# Fluxo — Gestión de finanzas personales

Fluxo organiza movimientos, tarjetas, gastos compartidos, ahorro e inversiones en ARS/USD. Incluye importación asistida de resúmenes y Gemini en la web y Telegram. Las marcas de pago son registros internos; no ejecutan transferencias bancarias.

## Estado de esta versión

Versión **6.2.0**, revisión del 5 de octubre de 2026 sobre `62007ea`.

- Corregidos aislamiento por usuario, referencias cruzadas y permisos/RPC de Supabase.
- Escrituras web transaccionales, rollback e idempotencia; cuotas y pagos separados por moneda.
- Eliminadas reparaciones automáticas al consultar datos y cotizaciones ficticias.
- Caché y contexto de IA por usuario, HTML sanitizado y módulos cargados bajo demanda.
- Migración **20261005192629** aplicada al proyecto Supabase de Fluxo.
- 16 pruebas automatizadas y 19 verificaciones PostgreSQL aprobadas. Fixtures descartadas por rollback.
- 10 comprobaciones HTTP en producción aprobadas: autenticación, alta, replay, conflicto, consulta y borrado. Cuenta QA y registros eliminados.
- Navegador: login, siete módulos, CSP, menú móvil y tema comprobados con API simulada.
- Build correcto; JavaScript principal **149 kB**, antes 585 kB. Vendors y módulos se descargan por separado.
- `npm audit`: **0 vulnerabilidades reportadas**. CI configurado para sintaxis, pruebas, build y audit; los runs de GitHub estaban en cola al verificar la entrega. Esos checks locales y el build Vercel aprobaron.

La conexión restringida, CRON_SECRET y SUPABASE_URL están configurados como secretos en Vercel para producción y previews. GitHub está integrado: main publica en https://fluxo-delta.vercel.app. Verificar READY y el commit desplegado después de cada push. El bot requiere completar el vínculo numérico con su usuario.

## Documentación

- [Documentación maestra](documentacion_maestra_fluxo.md): producto, arquitectura, correcciones, evidencia, operación y auditoría original.
- [Documentación anterior](DOCUMENTACION_SISTEMA.md): contexto histórico; contrastar con el código y la documentación maestra.
- [Manual de usuario](manual_de_usuario.md).

## Arquitectura

| Capa | Implementación |
| --- | --- |
| Frontend | SPA ES Modules, Vite 7, Chart.js y DOMPurify |
| Backend | Función Node.js de Vercel, router `api/index.js` |
| Identidad y datos | Supabase Auth/PostgreSQL; JWT+RLS para lecturas |
| Escrituras | Pooler PostgreSQL, rol limitado, transacción y claims del usuario |
| Integraciones | Gemini, Telegram y proveedores externos de precios |

Las lecturas usan mayormente POST por compatibilidad con la API histórica. Las operaciones contables reciben `Idempotency-Key`; la misma clave y payload devuelven el resultado confirmado, y un payload distinto produce 409.

## Desarrollo y comprobaciones

Node.js **24.x** y npm:

```powershell
npm ci
Copy-Item .env.example .env
# Completar las variables locales.
npm run dev
```

Vite sirve frontend y `/api/*` en `http://localhost:3000`. Carga `.env`, `.env.service` y `.env.db` para el servidor; solo `VITE_` puede exponerse al frontend. No usar ese prefijo para secretos.

```powershell
npm run check
npm test
npm run build
npm audit
npm run preview
```

`preview` sirve únicamente assets compilados. Para la prueba de navegador con API simulada, después del build:

```powershell
npm run test:browser
```

Requiere Chrome/Edge local o `BROWSER_PATH`. Las capturas quedan en `.audit.local/`, ignorado por Git.

La verificación PostgreSQL requiere un token administrativo en `.env.supabase`, como `SUPABASE_ACCESS_TOKEN=...`, y el esquema migrado:

```powershell
npm run test:integration
```

Crea una identidad CLI temporal y fixtures dentro de una transacción que revierte al terminar, incluso ante fallos. No ejecutarla de forma automática en CI ni contra otro proyecto sin revisar `scripts/supabase-management.js`.

## Variables del servidor

| Variable | Uso |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Auth y configuración pública del cliente |
| `DATABASE_URL` | Pooler y login restringido `fluxo_app`; obligatorio para escrituras |
| `SUPABASE_SERVICE_ROLE_KEY` | Sesiones del bot y recordatorios; exclusivamente servidor |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | IA; modelo opcional |
| `FMP_API_KEY` | Búsqueda de activos cuando corresponde |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_SECRET_TOKEN` | Bot y validación del webhook |
| `TELEGRAM_USER_LINKS` | JSON: ID numérico Telegram → UUID Supabase; sin vínculo no procesa operaciones |
| `CRON_SECRET` | Autoriza `/api/sendReminders` con Bearer |

`.env.example` contiene placeholders. Tokens de acceso a Supabase/Vercel son herramientas locales de administración, no variables públicas ni credenciales a incluir en el bundle. Todos los archivos `.env.*` reales están ignorados por Git.

## Migraciones y despliegue

La migración de esta revisión está en `supabase/migrations/20261005192629_fluxo_isolation_transactions_20261005.sql`. Fue instalada mediante Supabase Management y registrada en su historial. No borra los registros financieros existentes.

Los bootstrap SQL antiguos y `run_migration.js` están retirados y fallan explícitamente. La migración nueva presupone el esquema existente: todavía no constituye una instalación completa de una base vacía.

El login restringido tiene una contraseña local en `.env.db`. **Antes de promover código a producción**, cargar su `DATABASE_URL` en Vercel junto con `CRON_SECRET` y las credenciales de integraciones. No usar un login administrador como runtime de la aplicación.

Vercel compila `dist`, redirige `/api/*` al router y ejecuta el cron a las **09:00 UTC / 06:00 Argentina**. Confirmar estado READY, SHA desplegado, login y un flujo financiero tras publicar. Volver a un commit anterior no deshace una migración.

## Límites documentados

Los resúmenes aún usan totales actuales de la tarjeta; los históricos usan los consumos del período. Los días hábiles excluyen fines de semana, sin calendario de feriados. Las valuaciones sin precio/moneda/tasa confiable se muestran como no disponibles. Los timeouts de Telegram dejan entregas pendientes para conciliación; no se repiten ciegamente.

Las pruebas no equivalen a un pentest, una certificación bancaria ni una restauración de backups verificada. Consultar la documentación maestra antes de extender reglas contables o adoptar Fluxo para operación regulada.

## Revisión de experiencia de uso

Consultar [Análisis UX/UI](analisis_ux_ui_fluxo.md) para el inventario de controles, la propuesta de simplificación y criterios para preservar funcionalidades. El rediseño está propuesto; la corrección del reinicio de totales de tarjetas ya se aplicó en producción.
