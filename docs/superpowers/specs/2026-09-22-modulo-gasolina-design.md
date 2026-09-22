# Módulo de Gasolina (v1)

**Fecha:** 2026-09-22
**Estado:** Propuesto — pendiente de aprobación

## 1. Contexto

QiORA controla el consumo de combustible de su flota vehicular con tarjetas Edenred. Hoy ese análisis se hace en un Excel manual (`Análisis Gasolina.xlsx`, ~31 MB, 8 hojas) que cruza la descarga cruda de Edenred (hoja `BD`, 43k+ filas) contra el maestro de vehículos (`Base vehicular`) para agregar Modelo/Año por fórmula, y arma varias vistas de análisis a mano: tendencia semanal por sucursal (`14 weeks`/`30 weeks`), heatmap de horario (`TD`), frecuencia de cargas por placa (`Por placa`), y productividad de técnicos (`BD productividad`). El archivo crece cada mes sin límite y el cruce Modelo/Año se mantiene manualmente.

Edenred cambió su formato de descarga — el nuevo trae varias columnas que antes había que calcular a mano (Sucursal, Capacidad de Tanque, Desviación de Rendimiento %/$ ya vienen calculadas por Edenred).

Este módulo lleva ese análisis a la app: se sube la descarga cruda de Edenred, la app cruza automáticamente contra `flota_vehicular` (que ya vive en el pilar Flota Vehicular) para Modelo/Año/Negocio, y expone un pilar nuevo con drill-down completo.

## 2. Alcance v1

**Incluye:**
- Ingesta de la hoja `Report` de la descarga Edenred (formato nuevo), reemplazando solo el rango de fechas que trae el archivo.
- Cruce automático por Placa contra `flota_vehicular` para Modelo, Año y Negocio (`tipo_poliza`) — ya no se mantiene a mano.
- Pilar nuevo "Gasolina" con drill-down **Nacional → Negocio → Sucursal → Placa**.
- Gráfica de consumo semanal con ventana fija (8/14/30 semanas, no crece con el tiempo) y **Excedente** contra dos referencias intercambiables: promedio móvil de las últimas N semanas, o presupuesto por distrito (tabla `presupuesto`, familia "Gasolina", ya existente).
- Heatmap de patrón por hora × día de la semana (detección de cargas fuera de horario).
- Detección de frecuencia anómala de cargas por placa.
- Ranking de gasolineras por precio ponderado.
- Uso directo de `Desviación de Rendimiento %` / `$` que ya manda Edenred (ya no se calcula "Exceso de carga" a mano).

**No incluye (fase futura):**
- Re-subir el maestro de vehículos — la hoja `base vehicular` que trae el archivo de Edenred se ignora; el maestro vive únicamente en `flota_vehicular` (Flota Vehicular pillar, carga FFM).
- Edición manual de transacciones cargadas.
- Alertas/notificaciones automáticas (push, correo) de exceso de carga o consumo fuera de patrón — v1 solo **muestra** los indicadores, no notifica.
- Conciliación contra el estado de cuenta de Edenred (saldos, contracargos) — solo transacciones de consumo.
- Productividad de técnicos (hoja `BD productividad`) — no sale de los datos de gasolina; es una métrica aparte que probablemente ya vive en el módulo de Contratistas. Se deja como posible cruce futuro una vez confirmada su fuente real.

## 3. Modelo de datos

```sql
create table gasolina_transacciones (
  id bigserial primary key,
  fecha date not null,
  hora time,
  placa text not null,
  sucursal text,                        -- tal cual la manda Edenred (columna "Sucursal")
  vin text,
  capacidad_tanque numeric,
  tipo_transaccion text,                -- 'CONSUMO' | 'ANULACIÓN DE CONSUMO'
  precio_por_litro numeric,
  litros numeric,
  monto numeric,                        -- columna "NETO"; negativo en anulaciones
  gasolinera text,                      -- columna "ESTACIÓN DE SERVICIO"
  desviacion_rendimiento_pct numeric,
  desviacion_rendimiento_monto numeric,
  razon_social text,
  cargado_en timestamptz default now()
);

create index if not exists idx_gasolina_fecha on gasolina_transacciones (fecha);
create index if not exists idx_gasolina_placa on gasolina_transacciones (placa);
create index if not exists idx_gasolina_sucursal on gasolina_transacciones (sucursal);
```

**RLS** (mismo patrón que `facturas`/`ingresos`): lectura para cualquier usuario autenticado; escritura solo `rol = 'admin'` (vía RPC).

**Modelo/Año/Negocio del vehículo NO se guardan en esta tabla.** Se resuelven en el cliente con un cruce por Placa contra `flota_vehicular` en el momento de renderizar (mismo patrón que `sucursal_secundaria` vía `glosario_sucursales` para facturas) — así el histórico de gasolina no se desactualiza si el maestro de vehículos cambia (placa reasignada, vehículo dado de baja, etc.).

## 4. Ingesta

RPC `reemplazar_gasolina_transacciones(filas jsonb, p_fecha_min date, p_fecha_max date)` — mismo patrón "borra el rango y vuelve a insertar" que `facturas`/`folios_poliza`/`ingresos`. El rango se calcula de las fechas mínima/máxima encontradas en el archivo, **no del nombre del archivo** (el archivo de agosto trae varios días de septiembre incluidos).

Columnas que se leen de la hoja `Report` (descarga cruda de Edenred, sin modificar):

| Columna Edenred | Campo |
|---|---|
| FECHA | fecha |
| HORA | hora |
| Placas | placa |
| Sucursal | sucursal |
| VIN | vin |
| CAPACIDAD DE TANQUE | capacidad_tanque |
| TRANSACCIÓN | tipo_transaccion |
| PRECIO LTS CON DESCUENTO | precio_por_litro |
| LITROS | litros |
| NETO | monto |
| ESTACIÓN DE SERVICIO | gasolinera |
| DESVIACIÓN DE RENDIMIENTO % | desviacion_rendimiento_pct |
| DESVIACIÓN DE RENDIMIENTO EN $ | desviacion_rendimiento_monto |
| Razon social | razon_social |

Se **ignoran** las columnas de ayuda que el usuario agrega manualmente a la derecha del archivo (Mes/Hora/DiaSem/Semana/Año Veh./Modelo/Gasolinera/Precio x litro/Litros/Monto) — son redundantes de las columnas crudas o se calculan del lado de la app.

Las filas `ANULACIÓN DE CONSUMO` (241 de 9,940 en el archivo de agosto, ~2.4%) se cargan igual que `CONSUMO`, **sin filtrarlas**: litros/monto vienen en negativo y se cancelan solos contra la transacción que anulan al sumar, así el total siempre cuadra sin lógica especial de emparejar transacción+anulación.

**Llave de cruce:** se usa `Placas` (nunca viene vacía en el archivo de agosto), no `No. Unico` (solo viene lleno en 49% de las filas).

## 5. Cruce con `flota_vehicular`

Nueva función en `calc.js`, `clasificarGasolina(transaccion, flotaMap)` (mismo patrón que `clasificarFactura`/`clasificarIngreso`): busca la placa de la transacción en un mapa `{placa: fila de flota_vehicular}` y devuelve `modelo`, `anio`, y `negocio` (= `tipo_poliza` de flota_vehicular). Si la placa no tiene match, `modelo`/`anio`/`negocio` quedan `null` y la transacción se reporta bajo "Sin Match" en vez de perderse silenciosamente.

`tipo_poliza` real en `flota_vehicular` (muestra de 1,000 filas): `PLANTA INTERNA` (44%), `MULTIDISTRITO` (4%), `STAFF`, `PLANTA EXTERNA`, `RED JALISCO`, `CONSTRUCCION`, y **45% sin dato**. El nivel "Negocio" del drill-down usa estos valores tal cual (no se fuerzan a Planta Interna/Recolecciones/Multidistrito) — los vehículos sin `tipo_poliza` se agrupan en "Sin Clasificar".

## 6. Navegación

Pilar nuevo **"Gasolina"** en el sidebar (junto a Operaciones, Financieros, Capital Humano, Flota Vehicular). El Overview del pilar es el nivel 1 (Nacional) del drill-down validado en el mockup:

1. **Nacional** — KPIs (litros, gasto, precio prom./litro, rendimiento prom.), gráfica de tendencia, heatmap de horario, ranking por Negocio.
2. Clic en Negocio → **por Sucursal** dentro de ese negocio.
3. Clic en Sucursal → **por Placa** dentro de esa sucursal, ordenado por desviación de rendimiento (mayor a menor, sin necesidad de definir un umbral fijo en v1 — el orden ya resalta los peores casos).
4. Clic en Placa → **detalle del vehículo**: tarjeta con modelo/año/sucursal/negocio, gráfica semanal, tabla de transacciones (fila resaltada en rojo si `desviacion_rendimiento_pct` de esa transacción es negativa, es decir rindió menos de lo esperado).

## 7. Gráficas

- **Consumo semanal "Todo"** (combo): barras = litros consumidos, con el **Excedente** (rojo/verde, formato con paréntesis en negativo) arriba de cada barra, línea punteada = precio ponderado $/L. Toggle de ventana (8/14/30 semanas) y **altura fija** (la tarjeta no crece verticalmente sin importar cuántas semanas o series se agreguen). Con más de 20 semanas visibles, las etiquetas de valor se ocultan solas (se amontonarían) — el detalle exacto sigue disponible en el tooltip.
- **Toggle de referencia del Excedente:** "vs. Promedio" ↔ "vs. Presupuesto". "Vs. Promedio" compara cada semana contra el promedio móvil de la misma ventana visible en ese momento (si el toggle de ventana está en 14 semanas, la meta es el promedio de esas 14; si cambia a 30, la meta se recalcula sobre 30) — es el default porque siempre hay dato disponible. "Vs. Presupuesto" usa la tabla `presupuesto` (familia que contiene "GASOLINA", por distrito), prorrateado de mensual a semanal, y solo aplica a nivel Sucursal/Negocio/Nacional (el presupuesto no se compara por placa individual).
- **Heatmap Hora × Día de la Semana** — mismo insight que la hoja `TD` del Excel, agregando el eje de día que hoy no tiene, para cachar patrones tipo "domingo de madrugada".
- **Frecuencia de cargas por placa** (mini-heatmap semanal) — mismo insight que la hoja `Por placa`, para detectar vehículos que cargan anormalmente seguido.
- **Ranking de gasolineras por precio ponderado** — de dónde compran más caro los conductores, con volumen.
- Tarjetas chicas (mismo patrón de barra-con-etiqueta): Transacciones/semana, Unidades Activas, Ticket promedio.

Todas las gráficas siguen el mismo estilo visual y técnico ya establecido en el resto de la app (Chart.js, Gordita, paleta de colores existente, banda de ejes separados cuando dos series compiten por espacio).

## 8. Fuera de alcance

- Re-ingesta del maestro de vehículos (vive en Flota Vehicular / FFM).
- Notificaciones automáticas de anomalías — v1 solo visualiza.
- Conciliación de saldos/estado de cuenta Edenred.
- Edición en línea de transacciones cargadas.
