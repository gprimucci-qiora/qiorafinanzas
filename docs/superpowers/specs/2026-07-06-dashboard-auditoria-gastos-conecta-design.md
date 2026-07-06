# Dashboard de Auditoría de Gastos — QiORA Conecta

**Fecha:** 2026-07-06
**Estado:** Aprobado para planeación de implementación

## 1. Contexto y objetivo

QiORA opera bajo un modelo de iguala mensual fija por distrito con Totalplay (ver contexto completo de negocio en memoria del proyecto). La rentabilidad depende de administrar eficientemente el costo operativo, por lo que el área financiera necesita auditar semanalmente el gasto real pagado, desglosado por sucursal/distrito y por tipo de gasto, distinguiendo **costo directo** (facturado a una sucursal específica) de **gasto operativo** (una "bolsa" sin sucursal directa, que se reparte entre distritos según proporción de folios).

Este es el primer dashboard de un programa más amplio de auditoría financiera multi-línea-de-negocio; se construye primero para **Conecta** como piloto.

Es un proyecto nuevo e independiente del dashboard existente `SistemaBonos` (sin compartir repo, Supabase ni autenticación).

## 2. Fuente de datos

### 2.1 Reporte de facturas (Siva)

Descarga manual semanal (lunes) desde el sistema Siva, en formato Excel. Cada descarga cubre una **ventana móvil variable** (mínimo los últimos 6 meses, o el año en curso — decisión del usuario semana a semana, no fija). El motivo de re-descargar el rango completo (no solo la semana nueva) es que facturas de meses anteriores pueden pagarse o corregirse después, y deben reflejarse.

Estructura real (confirmada sobre archivo de ejemplo, 50,213 filas, dic-2022 a may-2026):

| Columna Excel | Campo interno | Notas |
|---|---|---|
| FAMILIA | `familia` | 39 valores. Nivel superior del drill-down de gasto. |
| GASTO | `gasto` | 126 valores. Subcategoría de `familia` (relación 1:1 confirmada en >99% de los casos). |
| EMPRESA | `empresa` | Razón social + banco (12 valores). |
| SUCURSAL | `sucursal` | 92 valores en los datos de ejemplo. Se cruza contra `glosario_sucursales`. |
| PROVEEDOR | `proveedor` | |
| FACTURA | `factura` | Folio. Puede repetirse (una factura con varias líneas). |
| IVA, SUBTOTAL, DESCUENTO, MONTO | numéricos | `MONTO` es el importe pagado (puede ser negativo: notas de crédito/reembolsos). |
| FECHA ALTA | `fecha_alta` | |
| FECHA DE PAGO | `fecha_pago` | **Clave para la ventana de reemplazo semanal.** Sin nulos en el archivo de ejemplo. |
| TIPO DE GASTO | `tipo_gasto_categoria` | 25 valores (ej. FLOTA VEHICULAR, MODULO NOMINAS). **No confundir** con el `tipo_gasto` del glosario (Costo Directo/Gasto Operativo) — mismo nombre en el Excel original, concepto distinto. Se renombra explícitamente en el modelo. |
| LÍNEA DE NEGOCIO | `linea_negocio` | Solo 2 valores en la muestra (PLANTA INTERNA / TP PLANTA INTERNA). Se conserva pero no es dimensión central. |
| NEGOCIO | `negocio` | Siempre "CONECTA" en este archivo. Se conserva para permitir auditar otras líneas de negocio en el futuro sin cambiar el esquema. |
| CLUSTER | *(no se usa)* | Mezcla nombres de región y de distrito de forma inconsistente; se descarta como dimensión y se usa en su lugar `region`/`sucursal_secundaria` del glosario. |

Columnas descartadas para v1 (no aportan a las vistas definidas): USUARIO REEMBOLSO, PLACA, NÚMERO ÚNICO, OBSERVACIONES, NOMBRE USUARIO REGISTRO, Mes.

### 2.2 Glosario de sucursales

Archivo Excel mantenido manualmente por el usuario, ~63 sucursales únicas válidas (confirmado sobre archivo de ejemplo). Columnas:

| Columna Excel | Campo interno |
|---|---|
| SUCURSAL | `sucursal` (clave) |
| TIPO DE SUCURSAL | `tipo_sucursal` — DISTRITO, CONTRATISTAS, CAPITAL HUMANO, OPERACIONES, ACTIVOS, DIRECCION, ADMIN |
| REGIÓN | `region` — BAJÍO, OCCIDENTE, GUADALAJARA, ORIENTE, SURESTE, NACIONAL, NORTE |
| SUCURSAL SECUNDARIA | `sucursal_secundaria` — distrito real de consolidación (relevante para `CONTRATISTAS`) |
| TIPO DE GASTO | `tipo_gasto` — `COSTOS DIRECTOS` \| `GASTOS OPERATIVOS` |

En v1, este glosario se carga inicialmente desde el Excel proporcionado y a partir de ahí **se administra desde el propio dashboard** (tabla editable: agregar/editar sucursal), no se vuelve a subir por Excel.

## 3. Modelo de datos (Supabase / Postgres)

```sql
create table glosario_sucursales (
  sucursal text primary key,
  tipo_sucursal text,
  region text,
  sucursal_secundaria text,
  tipo_gasto text check (tipo_gasto in ('COSTOS DIRECTOS', 'GASTOS OPERATIVOS')),
  actualizado_en timestamptz default now()
);

create table facturas (
  id bigserial primary key,
  familia text,
  gasto text,
  empresa text,
  sucursal text,
  proveedor text,
  factura text,
  subtotal numeric,
  iva numeric,
  descuento numeric,
  monto numeric,
  fecha_alta date,
  fecha_pago date not null,
  tipo_gasto_categoria text,
  linea_negocio text,
  negocio text default 'CONECTA',
  cargado_en timestamptz default now()
);

create index on facturas (fecha_pago);
create index on facturas (sucursal);
```

Clasificación de cada factura (calculada en consulta, vía join con `glosario_sucursales` por `sucursal`):
- Si hay match → usa `tipo_gasto`, `region`, `sucursal_secundaria` del glosario.
- Si no hay match → cae en categoría **"Sin Clasificar"**: se muestra por separado, no se prorratea, y se lista en la vista "Sin Clasificar" para que el usuario complete el glosario. (En los datos de ejemplo: 29 códigos, ~$11.7M de $1,335M totales, 0.9%.)

## 4. Ingesta semanal (reemplazo por ventana de fecha)

El reemplazo **no es de toda la tabla** — es acotado al rango de fechas que cubre el archivo subido, para no afectar el histórico fuera de esa ventana.

Flujo:
1. Vista "Cargar Datos" (solo `admin`): el usuario selecciona el archivo Excel.
2. El navegador parsea el archivo con SheetJS y calcula `fecha_min = MIN(fecha_pago)` y `fecha_max = MAX(fecha_pago)` de las filas leídas.
3. Se muestra al usuario el rango detectado y un conteo de filas, pidiendo confirmación antes de proceder (por ser una operación destructiva sobre ese rango).
4. Al confirmar, se llama una función de Postgres vía Supabase RPC, ej. `reemplazar_facturas(filas jsonb, fecha_min date, fecha_max date)`, que dentro de una sola transacción:
   - `delete from facturas where fecha_pago between fecha_min and fecha_max;`
   - inserta las filas nuevas del payload.
5. Al ser una única función de Postgres, la transacción es atómica: si falla a la mitad (dato mal formado, conexión perdida), Postgres hace rollback completo y las facturas previas de esa ventana quedan intactas — nunca hay un estado a medias.
6. Facturas con `fecha_pago` fuera del rango `[fecha_min, fecha_max]` de la carga nunca se tocan.

Este diseño resuelve el caso de negocio explícito: una factura de hace 8 meses que se paga hoy aparece en la descarga con `fecha_pago` = hoy, cae dentro de la ventana nueva, y se inserta/actualiza correctamente aunque su origen sea antiguo.

## 5. Prorrateo de gasto operativo

El "gasto operativo" (bolsa sin sucursal directa) se reparte entre distritos según proporción de folios pagados en el periodo, respetando el alcance regional:

- Bolsas con `region` específica (ej. `CAPITAL HUMANO BAJÍO`, `OPERACIONES BAJÍO`) se reparten **solo entre los distritos de esa región** (ej. Irapuato y León).
- Bolsas con `region = NACIONAL` (ej. Control de Activos, Admin Póliza, Dirección, Flotillas) se reparten **entre los 17 distritos**.

El dashboard ofrece un **toggle** en la vista "Por Sucursal/Distrito":
- **"Bolsa"**: el gasto operativo se muestra agregado, sin asignar a ningún distrito.
- **"Prorrateado"**: el gasto operativo se reparte y se suma al costo directo de cada distrito, según la regla de alcance regional/nacional anterior.

Este cálculo se hace en consulta (vista SQL o cálculo en el cliente), no se almacena — permite alternar sin recalcular datos.

## 6. Vistas del dashboard

1. **Resumen Ejecutivo**: KPIs del periodo (gasto total, costo directo, gasto operativo, monto "Sin Clasificar"), comparación vs. mes anterior, composición mensual (costo directo vs. operativo), top 5 familias de gasto.
2. **Por Tipo de Gasto**: drill-down **Familia → Gasto**, tabla + gráfica, filtrable por sucursal/distrito y por costo directo/operativo. `tipo_gasto_categoria` disponible como filtro/agrupador adicional opcional.
3. **Por Sucursal / Distrito**: los 17 distritos con su gasto (toggle bolsa/prorrateado). Click en un distrito abre su detalle con desglose Familia→Gasto de ese distrito.
4. **Sin Clasificar**: sucursales del Excel sin match en el glosario, con monto y conteo de facturas, para guiar actualización del glosario.
5. **Glosario de Sucursales**: tabla editable (alta/edición de sucursal, tipo_sucursal, región, sucursal_secundaria, tipo_gasto) — solo `admin`.
6. **Cargar Datos**: solo `admin`, flujo descrito en sección 4.
7. **Filtro de tiempo global**: selector de mes, default mes actual vs. mes anterior; opción de ver acumulado YTD o rango libre por `fecha_pago`.

Dirección visual: inspirada en el proyecto Stitch "Qiora Financial Analytics" (sidebar oscuro, tarjetas KPI, tablas de drill-down, vista de detalle por distrito) — se adapta la maqueta a las categorías/estructura reales definidas en este documento, no a los datos de ejemplo genéricos de Stitch.

## 7. Roles y seguridad

- **`admin`**: sube/reemplaza facturas, edita el glosario de sucursales, ve todas las vistas.
- **`finanzas`**: solo lectura de todas las vistas; sin acceso a "Cargar Datos" ni edición de glosario.
- Preparado para extender a recorte por región/distrito en el futuro (cada factura ya trae `region`/`sucursal_secundaria` vía el glosario) sin rediseñar el modelo — solo se añadiría una política RLS adicional y un campo de alcance en el perfil de usuario.
- RLS en Supabase: lectura de `facturas` y `glosario_sucursales` para cualquier usuario autenticado; escritura (insert/update/delete) restringida a rol `admin`, validado contra una tabla `usuarios` (mismo patrón que `SistemaBonos`).

## 8. Fuera de alcance para v1

- Comparación contra presupuesto/forecast (no existe ese dato aún).
- Historial de versiones de carga (comparar cómo se veían los datos hace N semanas).
- Roles con recorte por región/distrito (solo se deja preparado el modelo).
- Auditoría de otras líneas de negocio del holding QiORA (Telecom, etc.) — este dashboard es específico de Conecta; la extensión a otras líneas es un proyecto futuro separado.
