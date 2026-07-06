# QiORA Conecta — Dashboard de Auditoría de Gastos

## ¿Qué es esto?

Dashboard financiero interno para **auditar el gasto real pagado** de QiORA Conecta (unidad de negocio que opera fibra óptica para Totalplay bajo un modelo de iguala mensual fija por distrito). Es el **primer piloto** de un programa más amplio de auditoría financiera que eventualmente cubrirá otras líneas de negocio del holding QiORA.

Desarrollado por: **Giacomo Primucci**, Analista de Planeación Financiera.
Es un proyecto **financiero, de control de gasto** — prioriza claridad numérica y **densidad de gráficos** (tendencias, composición, comparativos, drill-down) sobre cualquier otra consideración de diseño.

Proyecto **nuevo e independiente** de `~/SistemaBonos` (repo propio, Supabase propio, sin compartir auth ni datos).

📄 **Spec de diseño completo:** `docs/superpowers/specs/2026-07-06-dashboard-auditoria-gastos-conecta-design.md` — léelo primero para el detalle técnico completo (modelo de datos exacto, lógica de ingesta, prorrateo, vistas, roles).

---

## El problema de negocio

QiORA Conecta cobra una iguala fija por distrito; la utilidad depende de administrar bien el costo. El gasto pagado se registra en Siva (sistema externo) y cae en dos categorías:

- **Costo directo**: factura cargada a una sucursal/distrito específico.
- **Gasto operativo**: factura sin sucursal directa (nómina corporativa, capital humano regional, operaciones regional, activos, dirección) — es una "bolsa" que se reparte entre distritos según proporción de folios pagados, respetando el alcance regional o nacional de cada bolsa (ver glosario).

## Flujo de datos

1. **Cada lunes**, Giacomo descarga desde Siva un Excel con una **ventana móvil variable** (mínimo 6 meses, o el año en curso — varía semana a semana, no es fija).
2. Sube el archivo desde la vista "Cargar Datos" del dashboard (solo rol `admin`).
3. El navegador calcula el rango `[fecha_min, fecha_max]` de `FECHA DE PAGO` del archivo y llama una función de Postgres que, en una sola transacción atómica, borra las facturas existentes de ese rango e inserta las nuevas.
4. Facturas fuera de ese rango (histórico más viejo) nunca se tocan. Si la carga falla a medias, Postgres hace rollback — nunca queda data corrupta o vacía.

Este reemplazo por ventana (no de toda la tabla) existe porque facturas viejas a veces se pagan o corrigen después, y deben reflejarse sin perder el histórico fuera de la ventana descargada.

## Arquitectura

```
QiORAConectaGastos/
├── index.html                          # SPA — vanilla HTML/CSS/JS, Chart.js, SheetJS, Supabase JS
├── docs/superpowers/specs/              # Specs de diseño (fuente de verdad de decisiones de producto)
│   └── 2026-07-06-dashboard-auditoria-gastos-conecta-design.md
└── CONTEXT.md                           # Este archivo
```

Stack: **igual patrón que SistemaBonos** — un solo `index.html`, sin build step, Chart.js para gráficas, SheetJS para leer Excel en el navegador, Supabase (Postgres + Auth + RLS) como backend.

## Modelo de datos (resumen — detalle completo en el spec)

- `facturas`: una fila por línea de factura pagada. Campos clave: `familia`, `gasto` (jerarquía de 2 niveles para drill-down de tipo de gasto), `sucursal`, `monto`, `fecha_pago` (clave del reemplazo semanal), `tipo_gasto_categoria` (⚠️ 25 categorías tipo "FLOTA VEHICULAR" — **no confundir** con el `tipo_gasto` del glosario).
- `glosario_sucursales`: mapea cada código de sucursal a `tipo_sucursal`, `region`, `sucursal_secundaria` (para consolidar contratistas en su distrito real) y `tipo_gasto` (`COSTOS DIRECTOS` | `GASTOS OPERATIVOS`). **Editable desde el dashboard** (CRUD, no se vuelve a subir por Excel).
- Sucursales sin match en el glosario caen en **"Sin Clasificar"** (no se pierden, no se prorratean, se alertan para completar el glosario).

## Vistas del dashboard

1. Resumen Ejecutivo (KPIs, comparación vs. mes anterior, composición mensual)
2. Por Tipo de Gasto (drill-down Familia → Gasto)
3. Por Sucursal/Distrito (toggle "Bolsa" vs. "Prorrateado" para el gasto operativo)
4. Sin Clasificar (alerta de sucursales sin glosario)
5. Glosario de Sucursales (CRUD, solo admin)
6. Cargar Datos (solo admin)

Filtro de tiempo global: default mes actual vs. mes anterior; opción YTD o rango libre.

## Roles

- `admin` (Giacomo): sube/reemplaza facturas, edita glosario, ve todo.
- `finanzas` (equipo): solo lectura, ve todo (sin recorte por región todavía — preparado para agregarlo después sin rediseñar el modelo).

## Fuera de alcance en v1

- Comparación contra presupuesto (no existe ese dato aún).
- Historial de versiones de carga.
- Roles con recorte por región/distrito (modelo preparado, no implementado).
- Otras líneas de negocio de QiORA (Telecom, etc.) — proyecto futuro separado.

## Estado

**2026-07-06:** ✅ v1 implementada completa.

**Completado (Tareas 1-17):**
- Supabase: schema SQL (facturas, glosario_sucursales), RLS por rol, RPCs de carga con reemplazo por ventana.
- `calc.js`: módulo de lógica de negocio (prorrateo, drill-down, etc.) con 10 tests pasando.
- `index.html`: SPA vanilla con 6 vistas (Login, Cargar Datos, Glosario CRUD, Resumen Ejecutivo, Por Sucursal/Distrito, Por Tipo de Gasto, Sin Clasificar) + filtro de tiempo global.

**Estado actual:** Listo para smoke-test manual (Giacomo con credenciales Supabase reales, Excel de prueba, validar RLS y reemplazo por ventana).

**Fuera de alcance en v1:** comparación vs. presupuesto, historial de versiones, roles regionales, otras líneas de negocio.

## Glosario de términos

| Término | Significado |
|---|---|
| Siva | Sistema externo desde donde se descarga el reporte de facturas pagadas |
| Iguala | Pago mensual fijo que Totalplay hace a QiORA por distrito operado |
| Costo directo | Gasto facturado a una sucursal/distrito específico |
| Gasto operativo | Gasto sin sucursal directa ("bolsa"); se prorratea entre distritos por proporción de folios |
| Sucursal secundaria | Distrito real al que se consolida el gasto de un contratista (glosario) |
| Ventana de reemplazo | Rango `[fecha_min, fecha_max]` de `FECHA DE PAGO` del archivo subido, usado para acotar el borrado/inserción semanal |
