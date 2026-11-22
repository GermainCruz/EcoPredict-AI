# Verificación y pruebas

## Pruebas que se incluyen
- `npm test --prefix backend`: 16 pruebas unitarias.
  - Predicción Ridge: corte mínimo, MAE/RMSE/R²/sMAPE, álgebra lineal (`solve`), construcción de ejemplos, multi-paso, límite de horizonte, margen conformal, análisis de regularidad, importancia de variables normalizada, validación walk-forward y ausencia de filtración temporal en rezagos.
  - Anomalías: detección de un valor atípico, serie corta sin falsos positivos, serie homogénea y valores no finitos.
- `npm run build --prefix frontend`: compilación para comprobar la integridad estática del frontend.

## Pruebas manuales de integración a realizar con PostgreSQL levantado
1. Crear base, esquema, catálogo y migración de mejoras (`database/scripts/05_improvements.sql`); seed admin.
2. `GET /api/health` -> 200, `POST /api/auth/login` válido -> 200, inválido -> 401. Verificar la cookie httpOnly `eco_refresh` y que `/auth/refresh` rota el token.
3. Token usuario GET /api/users -> 403; admin -> 200.
4. Crear medición válida -> 201, fuera de rango -> 422; comprobar dashboard y filtros.
5. Importar un CSV y un XLSX con cabeceras con alias -> verificar `inserted`, `duplicates`, `failed` y `flagged`.
6. Crear una serie con un valor extremo -> verificar marca `suspect`, `anomaly_score` y alerta generada según regla activa.
7. Crear 30 o más registros válidos de una variable para una estación -> predicción 201 con métricas; con menos -> 422. Probar `horizon` y `folds`.
8. Consultar el mapa de calor y el mapa de estaciones.
9. Consultar historial y exportar PDF/DOCX/XLSX; abrir archivos.
10. Comprobar auditoría para login, mediciones y predicción.
11. Confirmar revocación de refresh al hacer logout y rechazar su reutilización.

Las pruebas integradas no se consideran ejecutadas por la sola existencia de esta lista. Son necesarios PostgreSQL y un entorno real para su certificación.
