# Detalle de Distrito — Drill-Down desde Por Sucursal/Distrito

**Fecha:** 2026-07-07
**Estado:** Aprobado para planeación de implementación
**Extiende:** `docs/superpowers/specs/2026-07-06-dashboard-auditoria-gastos-conecta-design.md`

## 1. Contexto

Con el dashboard v1 ya en uso con datos reales, Giacomo pidió poder entrar al detalle de un distrito específico desde la vista "Por Sucursal/Distrito" — ver su desglose de gasto por Familia→Gasto, con gráficas de tendencia de los últimos 6 meses y variaciones mes-contra-mes (MoM) y año-contra-año (YoY) por línea de gasto.

## 2. Navegación

En la tabla de "Por Sucursal/Distrito" (`tabla-sucursales-body`), el nombre de cada distrito se vuelve un link clickeable (`onclick="abrirDetalleDistrito('<distrito>')"`). Al hacer click:

1. Se oculta la vista `vista-sucursal` y se muestra una nueva vista `vista-detalle-distrito` (mismo mecanismo `.vista`/`.activa` que las demás vistas — no es una vista de sidebar, se activa/desactiva manualmente).
2. Un botón "← Volver" en `vista-detalle-distrito` llama `mostrarVista('sucursal')` para regresar.

No se agrega entrada al sidebar — esta vista solo es alcanzable vía drill-down.

## 3. Contenido de la vista

1. **Encabezado:** botón "← Volver" + nombre del distrito (mismo estilo de título que las demás vistas).
2. **Gráfica de tendencia mensual** (Chart.js, barras): gasto total del distrito por mes, últimos 6 meses terminando en el mes de referencia (sección 4).
3. **Gráfica de top familias** (Chart.js, barras horizontales): las familias de gasto con mayor monto acumulado del distrito en esos mismos 6 meses (top 5, resto agrupado como "Otros" si aplica).
4. **Tabla Familia→Gasto con variaciones**, expandible igual que "Por Tipo de Gasto", con columnas: Familia, Monto (mes de referencia), % MoM, % YoY. Al expandir una familia se ve el desglose por Gasto (columna B del Excel) con su propio monto — sin variación por renglón de Gasto individual (la variación se calcula y muestra solo a nivel Familia, para no fragmentar demasiado la lectura).
5. **Renglón final aparte** (fuera de la tabla expandible, con su propio estilo): "Gasto Operativo Asignado" — el monto prorrateado que `Calc.calcularProrrateo` ya calcula para ese distrito en el mes de referencia, sin desglose por familia (esa granularidad no existe para el gasto operativo).

## 4. Mes de referencia para MoM/YoY

El mes de referencia es el mes calendario que contiene la fecha `fin` del rango de tiempo activo (`obtenerRangoActivo().fin`), sin importar qué modo de filtro esté seleccionado (mes-actual, YTD, o rango personalizado). Esto hace que la vista de distrito siempre sea consistente con lo que el usuario está viendo en el resto del dashboard en ese momento.

- **MoM:** mes de referencia vs. el mes calendario inmediato anterior.
- **YoY:** mes de referencia vs. el mismo mes calendario del año anterior.

Si el mes de comparación no tiene facturas (monto anterior = 0), la variación se muestra como "—" (sin dato comparable), no como un porcentaje infinito o engañoso.

## 5. Modelo de datos y consultas

No se agregan columnas ni tablas nuevas — todo se deriva de `facturas` + `glosario_sucursales` ya existentes, filtrando por `sucursal_secundaria` (vía `Calc.clasificarFactura`) igual al distrito seleccionado y `tipo_gasto === 'COSTOS DIRECTOS'`.

Dos consultas a Supabase (ambas vía `obtenerFacturasEnRango`, ya paginado):
1. **Ventana de 6 meses** `[mesReferencia − 5 meses, mesReferencia]` completa → alimenta la gráfica de tendencia mensual, la gráfica de top familias, el monto del mes de referencia, y el mes anterior (para MoM) — todos se derivan de esta misma respuesta sin volver a consultar.
2. **Un solo mes** = el mismo mes calendario del año anterior → alimenta el YoY.

## 6. Lógica nueva en `calc.js` (con tests)

Dos funciones puras, agregadas a `calc.js` junto a las existentes:

- **`calcularVariacionPct(actual, anterior)`** → `((actual - anterior) / anterior) * 100`, o `null` si `anterior === 0` (evita división entre cero y valores engañosos tipo "+∞%" o "+100%" falsos).
- **`agruparPorFamiliaGasto(facturas)`** → `{ [familia]: { total, porGasto: { [gasto]: monto } } }`. Reutilizable: se invoca 3 veces (mes de referencia, mes anterior, mismo mes año anterior) sobre subconjuntos ya filtrados por distrito y por mes, calculados en `index.html`.

El resto (qué meses pedir, filtrar por distrito vía `sucursal_secundaria`, armar los datasets de Chart.js, la interacción de expandir/contraer filas) vive en `index.html`, igual que el resto de las vistas — no se centraliza en `calc.js` porque es orquestación de vista, no lógica de negocio reutilizable.

## 7. Fuera de alcance

- No se agrega esta vista al sidebar ni a la URL (no hay ruteo por URL en esta SPA).
- No se prorratea el gasto operativo por familia — se muestra como monto agregado único, tal como ya lo hace `calcularProrrateo`.
- Variaciones MoM/YoY solo a nivel Familia, no a nivel Gasto individual (columna B).
