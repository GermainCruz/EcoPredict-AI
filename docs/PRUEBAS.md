# Verificación y pruebas

## Pruebas que se incluyen
- `npm test --prefix backend`: pruebas unitarias de predicción Ridge, corte mínimo, MAE/RMSE/R², álgebra lineal y ausencia de filtración temporal en rezagos.
- `npm run build --prefix frontend`: compilación para comprobar la integridad estática del frontend.

## Pruebas manuales de integración a realizar con PostgreSQL levantado
1. Crear base, esquema y catálogo; seed admin.
2. `GET /api/health` -> 200, `POST /api/auth/login` válido -> 200, inválido -> 401.
3. Token usuario GET /api/users -> 403; admin -> 200.
4. Crear medición válida -> 201, fuera de rango -> 422; comprobar dashboard y filtros.
5. Crear 30 o más registros crónicos de una variable para una estación -> predicción 201, métricas presentes; con menos -> 422.
6. Consultar historial y exportar PDF/DOCX/XLSX; abrir archivos.
7. Comprobar auditoría para login, mediciones y predicción.
8. Confirmar revocación de refresh al hacer logout y rechazar su reutilización.

Las pruebas integradas no se consideran ejecutadas por la sola existencia de esta lista. Son necesarios PostgreSQL y un entorno real para su certificación.
