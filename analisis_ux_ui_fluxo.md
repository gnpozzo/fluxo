# Análisis UX/UI de Fluxo

Fecha: 5 de octubre de 2026. Versión examinada: `54138a0`.

## Conclusión

Fluxo conserva funciones valiosas, pero presenta demasiados controles y métricas con la misma jerarquía. La simplificación debe mejorar el orden, la claridad del contexto y el acceso a acciones; no eliminar capacidades financieras. Recomiendo una navegación estable, una acción principal por sección, filtros secundarios desplegables y formularios que revelen opciones según la operación.

El problema más urgente es la confianza en los números: un saldo bancario importado no es equivalente a la suma de consumos ni al monto pendiente de pago. Las etiquetas deben distinguir esas magnitudes. Una barra decorativa tampoco debe representar progreso financiero.

## Alcance y evidencia

- Inspección del código de las siete clases de módulos, navegación, encabezado, formularios, chat y configuración.
- Revisión de la aplicación autenticada en producción: Dashboard, Tarjetas, Gastos compartidos, Ahorro e Inversiones, en la cuenta Personal; comparación con la navegación de Hogar.
- Captura aportada por el usuario y verificación del reinicio de tarjetas directamente en Supabase y en la interfaz.
- Revisión de formularios e importación desde el código. No se cargaron operaciones ni se enviaron consultas con información financiera durante esta auditoría.
- La revisión móvil parte del código responsive y de las comprobaciones de 390 px realizadas en la estabilización anterior. Este documento no afirma una nueva auditoría completa en dispositivos físicos.
- Es una evaluación heurística, no un estudio con usuarios ni una certificación WCAG. Las prioridades son juicio profesional; no hay medición de frecuencia de uso ni telemetría que pruebe qué botones se utilizan más.

## Corrección realizada: saldos antiguos después del vaciado

`tarjetas.total_resumen_ars` y `tarjetas.total_resumen_usd` conservaban importes independientes de `consumos_tc`. El borrado directo anterior vació consumos y movimientos, pero omitió esos campos. La lógica normal de `deleteConsumoTC` ya contempla restablecerlos al vaciar todo; la operación administrativa anterior no utilizó ese controlador.

Se respaldaron las tres tarjetas, se verificó que no había operaciones nuevas y se restablecieron ambos totales a cero dentro de una transacción. Se conservaron tarjetas, límites, cuentas y fechas. La web confirmó cero en el plástico Visa Santander, indicadores ARS/USD, total y proyección. No se necesita ocultar indiscriminadamente el resumen oficial cuando no existen consumos: un resumen importado puede ser válido aunque todavía no se hayan detallado todas sus operaciones.

Respaldo privado e ignorado por Git: `.audit.local/production-reset-20261005-card-statements-backup.json`. Evidencia visual: `.audit.local/tarjetas-reset-verificado.png`.

## Arquitectura de navegación propuesta

Mantener visibles, en el mismo orden: **Resumen, Movimientos, Tarjetas, Compartidos, Ahorro e Inversiones**. Configuración permanece separada al pie. Movimientos puede reutilizar la lista actual y su lógica; separar su acceso no significa duplicar operaciones ni mantener dos implementaciones de formularios.

Hoy Tarjetas y Ahorro desaparecen si la cuenta no tiene tarjetas o alcancías, y Compartidos/Inversiones dependen de banderas de la cuenta (`AppInit.#actualizarVisibilidadTabs`). Esto produce un menú diferente al cambiar de cuenta e impide descubrir cómo empezar. Propuesta: mantener las secciones de producto visibles y ofrecer un estado vacío con contexto y acción de configuración. Si un módulo se deshabilitó explícitamente, explicar cómo activarlo; no confundir falta de datos con falta de permiso.

El encabezado debe mostrar título de sección y contexto **Cuenta · Mes · Moneda**. El saludo genérico «¡Hola, Usuario!» no identifica la sección y contradice el nombre que sí aparece en el perfil. Eliminar la frase promocional persistente y usar ese espacio para contexto operativo.

## Inventario de controles y decisiones

| Control actual | Decisión propuesta | Funcionalidad que se conserva |
|---|---|---|
| Menú lateral y botón contraer | Mantener; navegación estable | Acceso a todos los módulos, versión compacta |
| Logo que vuelve al Dashboard | Mantener como acceso secundario | Volver al resumen |
| Selector global de cuenta | Mantener siempre visible y con etiqueta | Separación Personal/Hogar y contexto de operaciones |
| Selector de mes | Mantener en vistas mensuales | Historia y vencimientos; explicar el período de otras vistas |
| ARS/USD global | Mantener como selector de visualización | No cambiar implícitamente la moneda de una operación |
| ARS/USD adicional de Ahorro | Unificar con el global | Mismo filtro; evitar dos estados de moneda contradictorios |
| `Nuevo` global con seis destinos | Mantener como acceso transversal discreto | Crear operaciones desde cualquier sección |
| Alta local de cada sección | Mantener como acción principal con texto | Acceso directo y contexto preseleccionado |
| Engranaje del encabezado, Configuración lateral y opción de perfil | Consolidar Configuración en un destino y acceso principal | Todas las entidades y preferencias siguen disponibles |
| Avatar | Mantener perfil, tema y cerrar sesión | Identidad, privacidad y sesión |
| FluxoAI | Mantener un acceso persistente | Chat, adjuntos, historial y acciones propuestas |
| Campana | Mantener con contador real y estado vacío útil | Recordatorios y avisos; no mostrar urgencia ficticia |
| Tabs Todos/Ingresos/Gastos, Todos/Cuotas/Único | Mantener cuando hay datos | Filtros frecuentes, comprensibles y reversibles |
| Búsqueda | Mantener; ampliar área útil | Buscar sin truncar el texto ingresado |
| Categoría, medio de pago, cuenta imputada | Agrupar bajo `Filtros` | Todas las combinaciones; mostrar cantidad de filtros activos |
| Flechas pequeñas en indicadores | Mantener acceso mediante `Ver detalle` o tarjeta accesible | Explorar registros asociados sin iconos ambiguos |
| Carrusel de plásticos | Sustituir selección principal por selector de tarjeta | Todas/una tarjeta; plástico compacto como representación secundaria |
| `+` de nuevo consumo | Reemplazar por `Nuevo consumo` | La misma alta con una etiqueta reconocible |
| Importar resumen | Mantener como acción secundaria con texto | PDF/XLSX y revisión previa |
| Papelera de vaciar junto a alta e importar | Mover a `Más opciones` | Vaciado por mes, futuros e histórico, con confirmación de alcance |
| Pagar resumen | Renombrar `Registrar pago` | Registro contable; no dar a entender una transferencia bancaria |
| Selectores de período 6M/12M/Año | Mantener dentro de Análisis | Misma exploración, menos controles antes de operar |
| Donas y gráficos repetidos | Mover a bloque Análisis desplegable | Evolución, distribución y comparaciones |
| Impuestos del resumen | Mantener como desglose contextual | Conceptos reales, importes y monedas; no lista fiscal fija |
| Compra/Venta de inversiones | Mantener selector corto con etiquetas | Dos operaciones distintas y su validación |
| Monitor Global | Separar de la lista de operaciones, acceso secundario | Cotizaciones; evitar mezclar datos externos con tenencias |
| Nueva alcancía, meta y tope TC | Mantener junto al objeto correspondiente | Configuración financiera con explicación de su efecto |
| Editar/eliminar de registros | Mantener en menú contextual accesible | Edición simple o de serie y eliminación con alcance |
| Bot Telegram | Mantener como canal alternativo | Consultas y registro; confirmación clara de entidad, cuenta y moneda |

No recomiendo sustituir todos los dropdowns por botones: dos o tres opciones exclusivas funcionan bien como segmentos; listas de cuentas, categorías, contactos o tarjetas necesitan selectores. Usar búsqueda en el selector cuando la lista lo justifique. No ocultar cuenta, moneda ni importe dentro de opciones avanzadas.

## Recomendaciones por sección

### Resumen y Movimientos

El Dashboard mezcla panorama, análisis, registro, metas y navegación a otros módulos. Los gráficos aparecen antes de la lista operativa y las tarjetas de módulos repiten navegación y datos.

Propuesta: mostrar primero neto del período, ingresos, gastos y próximos vencimientos; luego movimientos recientes con `Ver todos`. Mantener el desglose de balance, privacidad, filtros y meta. Los gráficos quedan bajo `Análisis del período`. En Movimientos, una lista más amplia con búsqueda, tabs y Filtros conserva edición, recurrencia, cuotas, división, cuenta destino y gastos compartidos.

`Balance Total` es ambiguo si representa ingresos menos egresos del mes. Nombrarlo `Neto del mes` cuando ese sea el cálculo, y reservar `Saldo de cuenta` para un saldo acumulado con base definida. ARS y USD se muestran separados; las conversiones requieren fuente y fecha.

### Tarjetas

La pantalla actual antepone tres indicadores y dos gráficos a los consumos; el plástico controla indirectamente la selección. El importe se repite en indicador, plástico, total y proyección sin explicar su origen.

Orden recomendado: selector de tarjeta y mes → importe del resumen/pendiente con moneda y vencimiento → `Nuevo consumo`, `Importar resumen`, `Registrar pago` → consumos → análisis opcional. Conservar el plástico compacto; no usarlo como única forma de seleccionar ni como única superficie de saldo.

Distinguir: **consumos registrados**, **total del resumen importado** y **pagos registrados**. Cuando el total oficial difiere del detalle, mostrar la diferencia y un acceso para revisar, no forzar igualdad ficticia. No impedir importar o registrar un total oficial por estar vacía la lista.

El botón de pago sigue visible con todo en cero. Debe presentar un estado sin importe pendiente y explicar por qué no corresponde registrar un pago. La verificación debe considerar ambas monedas y pagos existentes, no únicamente el total ARS del plástico.

### Compartidos

Priorizar `Te deben` / `Debés` y el selector de contacto. `Mis Gastos`, `Sus Gastos`, `Saldo Neto`, aportes del gráfico y estado de período repiten magnitudes con nombres distintos.

Conservar quién pagó, porcentaje asumido, persona, lista y liquidación. Mostrar «pagaste», «pagó [persona]» y «tu parte» en cada registro. El menú de pago debe explicar si se registra una devolución y qué movimientos genera. Gráfico y categorías pasan a Análisis. Los 18 registros históricos existentes no se vaciaron en el reinicio solicitado de movimientos y tarjetas.

### Ahorro

Separar patrimonio acumulado de transferencias del mes. El selector de mes no debe sugerir que filtra una tenencia acumulada sin explicar la fecha de corte. Mostrar alcancías y metas primero, seguida de transferencias. Usar `Depositar` / `Retirar` o `Nueva transferencia`, en vez de `Nuevo Movimiento` sin contexto.

En `AhorroModule` hay una barra que asigna 75% si existen depósitos y 20% si no existen. Esos valores no representan cumplimiento real. Sustituirla por saldo/meta calculado para una alcancía o por una descripción sin barra cuando no hay meta definida. Conservar equivalencias, depósitos, retiros y administración de alcancías.

### Inversiones

Priorizar cartera, costo, valuación disponible y resultado; luego compras/ventas. Usar `Distribución de cartera` en lugar de `Asset Allocation`, y `Cartera` en lugar de `Estrategia & Cartera` cuando se muestra una lista de tenencias.

Mostrar moneda, fecha de cotización y activos sin precio. Un precio ausente no es cero. El monitor de mercado queda en una vista o panel secundario; conservar la consulta sin convertirla en acción de inversión real. Formularios muestran ticker, cantidad, precio, cuenta, fecha y moneda; tipo de cambio sólo cuando corresponde, manteniendo explicación y cálculo visible.

La banda de mercado con desplazamiento automático añade movimiento visual incluso con una cartera vacía. Mantener cotizaciones en el monitor secundario, con pausa accesible; no anteponerla a las posiciones y operaciones.

### Configuración

Mantener cuentas, tarjetas, categorías, alcancías y contactos. Un único acceso principal, secciones claras y formularios coherentes. Fechas actuales de resumen, límites y días habituales de cierre/vencimiento son conceptos diferentes y deben agruparse con etiquetas explicativas.

Ordenar campos frecuentes antes que color e icono. La edición no debe cerrar otra ventana con cambios sin guardar. Evitar acumular varios modales si una ficha o panel lateral resuelve el mismo trabajo; conservar una confirmación explícita para borrar.

### FluxoAI y Telegram

Mantener chat, adjuntos y conversación. Reducir chips iniciales a tareas reconocibles, conservando las opciones restantes en Ayuda. Separar respuesta de IA de acción guardable; indicar claramente propuesta, edición y confirmación.

La importación requiere revisión previa de filas, tarjeta, fechas, cuotas, moneda, categorías y duplicados. No sustituir esa revisión por un botón genérico de aceptar. Al finalizar, mostrar cuántos registros se crearon y qué cambió.

Telegram ya respondió a `/start` y a una consulta abierta según las capturas del usuario. Eso acredita recepción y conversación básica, no exactitud de todas las consultas ni de la importación. Sus comandos deben usar el mismo vocabulario que la web.

## Formularios y estados

- Una acción principal: `Guardar gasto`, `Guardar consumo`, `Registrar transferencia` o `Registrar operación`. Cancelar es secundaria.
- Importe, moneda, fecha, cuenta y descripción visibles. Preseleccionar contexto actual sin ocultarlo.
- `Única vez`, `Cuotas` y `Recurrente` revelan únicamente los campos necesarios. No eliminar edición de cuota actual, serie o frecuencia.
- Compartir, dividir entre cuentas y configuración avanzada son bloques desplegables; mostrar resumen de su efecto antes de guardar.
- En cuotas, distinguir importe total e importe por cuota; mostrar cantidad, primera fecha y suma final, incluyendo redondeo.
- En borrados, indicar entidad, cantidad y período. No agrupar borrar todo con acciones habituales. Mantener alcance simple/serie/futuros/histórico.
- Diferenciar `Sin registros`, `Sin coincidencias`, `Sin configuración`, `Cargando` y `No se pudo cargar`. Un error nunca debe presentarse como saldo cero.
- Sin datos: bloque compacto con acción útil; no dos gráficos vacíos y una tabla de gran altura.
- Tras guardar: confirmación visible y actualización de los componentes afectados. Tras errores: conservar formulario y permitir reintentar.

## Accesibilidad, móvil y lenguaje

Hay controles sólo con icono, búsquedas pequeñas y etiquetas de formularios sin asociación explícita en varias plantillas. Revisar asociaciones `label`/campo, nombre accesible, foco, estados de selección y lectura de errores. Elementos con `role=button` necesitan comportamiento de teclado; preferir botones nativos.

Objetivo de producto: área táctil de 44 × 44 px para acciones relevantes. WCAG 2.2 AA establece 24 × 24 px o sus excepciones de espaciado, no un mínimo general de 44 px. Validar contrastes reales de textos secundarios en ambos temas antes de afirmar cumplimiento.

En móvil: una columna, contexto compacto visible, filtro avanzado en panel y acción principal accesible. Evitar exigir desplazamiento horizontal para completar formularios. Las tablas pueden usar filas resumidas con detalle expandible manteniendo importe, moneda y fecha a la vista.

Conservar colores de marca y plásticos; reducir pastillas, sombras y bordes redundantes. Elegir una escala de espaciado y tamaños de control, texto legible y un vocabulario coherente. Evitar badges de salud sin cálculo: con ingresos cero, `TarjetasModule.#updateTopeKpi` muestra «En rango», «Salud OK» y una barra al 15%; debería indicar `Sin base de ingresos` y no evaluar un porcentaje.

## Prioridades y entregas propuestas

| Prioridad | Entrega | Criterio de aceptación |
|---|---|---|
| P0 — realizada | Completar reinicio de totales oficiales | Consumos y movimientos vacíos; tres tarjetas con totales ARS/USD cero; límites y fechas conservados |
| P1 | Claridad financiera | Sin salud/progreso ficticios; etiquetas distinguen neto, resumen, consumos y pagos; monedas separadas |
| P1 | Navegación y contexto | Módulos localizables al cambiar de cuenta; título de sección; acciones con cuenta/mes visibles |
| P1 | Acciones y filtros | Una alta principal por sección; vaciar fuera de la barra habitual; filtros activos visibles y borrables |
| P2 | Reordenar pantallas | Datos y operaciones antes que análisis; estados vacíos compactos; ningún flujo eliminado |
| P2 | Formularios e importación | Opciones condicionales, vista previa de efecto y revisión de filas antes de guardar |
| P2 | Accesibilidad y móvil | Operación con teclado, foco visible, campos etiquetados; pruebas a 390 px y escritorio |
| P3 | Coherencia visual | Espaciado, nombres, tamaños y tonos compartidos sin alterar cálculos |

Secuencia: primero consistencia y navegación; después tarjetas y movimientos; luego compartidos, ahorro e inversiones; finalmente configuración y chat. La implementación 6.3.0 aplica esta secuencia a la navegación y presentación; el cierre siguiente distingue lo realizado de las evaluaciones futuras.

## Verificación para preservar funcionalidades

La implementación posterior debe comprobar estos recorridos: ingreso/gasto simple; recurrente y edición de serie; cuotas con fin de mes; consumo ARS/USD; importación revisada; pago parcial/completo y reintegro; compartir 0/50/100%; transferencias de ahorro; compra/venta; CRUD de configuración; chat con adjunto; filtros combinados; cambio de cuenta; teclado y móvil. Usar fixtures aislados y limpiar las operaciones de prueba.

Comparar antes/después con tareas concretas: localizar tarjeta, encontrar una operación, registrar cuota y reconocer cuenta/mes. Registrar tiempo, errores y comprensión con usuarios reales antes de afirmar una mejora cuantificada.

## Referencias

- [NN/g — Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/): mostrar opciones secundarias cuando son necesarias guía la propuesta de filtros y formularios.
- [NN/g — Visibility of System Status](https://www.nngroup.com/articles/visibility-system-status/): contexto, estados de carga y confirmaciones deben explicar qué ocurrió.
- [W3C — Target Size Minimum, WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): referencia para tamaños de interacción y excepciones.

Las decisiones específicas sobre Fluxo son recomendaciones basadas en la inspección del producto; las referencias no implican que estas fuentes hayan evaluado Fluxo.


## Cierre de implementación — 6.3.0

Implementados: menú y título estables, sección Movimientos, gráficos desplegables en los seis módulos, filtros secundarios y limpieza, acción principal textual, vaciado separado, selector directo de tarjeta y explicación del saldo. Pago interno con importes por moneda y sin acción habilitada cuando no hay pendientes. Corregidos indicadores sin base de ingresos y barras decorativas; moneda global en Ahorro. Movimientos incorpora moneda explícita y distribución/compartidos desplegables sin eliminar campos ni la lógica de series/cuotas. Configuración y chat mantienen sus funciones y reciben reglas responsive compartidas.

Diseño de escritorio principal, grillas adaptativas, menú móvil, formularios de una columna y controles accesibles a teclado. Se validaron seis secciones a 1440, 1024, 768 y 390 px; cinco formularios a 390 px; login, CSP, cambio de cuenta, tema, pago vacío y porcentajes ARS/USD con API simulada. También pasaron 16 pruebas y 19 comprobaciones PostgreSQL revertidas al finalizar. No se cargaron operaciones de prueba en producción para validar el rediseño.

La revisión de importaciones conserva el flujo existente de revisión de filas. Los rediseños futuros de tablas como filas resumidas móviles, estudios de tareas con usuarios y certificación WCAG siguen siendo recomendaciones de evaluación, no resultados acreditados por esta entrega. La cobertura automatizada y capturas locales no equivalen a probar todos los modelos de celular/tablet.
