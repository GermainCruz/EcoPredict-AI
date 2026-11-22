# EcoPredict AI - MVP avanzado

Sistema web de gestión ambiental con roles, auditoría, predicción temporal, exportación PDF/DOCX/XLSX y PostgreSQL.

Guía para ejecutar el proyecto en otra computadora: [Manual de ejecución para agentes](docs/MANUAL_EJECUCION_AGENTE.md).

## Requisitos
- Node.js 20+ (recomendado 22 LTS), npm, PostgreSQL 15+; Windows, Linux o macOS.
- No requiere Docker ni sensores físicos.

## Instalación (PowerShell, en la raíz)
1. Crear la base: `psql -U postgres -d postgres -f database/scripts/01_create_database.sql`.
2. Esquema: `psql -U postgres -d ecopredict_db -f database/scripts/02_schema.sql`.
3. Catálogos: `psql -U postgres -d ecopredict_db -f database/scripts/03_catalogs.sql`.
4. Mejoras (idempotente): `psql -U postgres -d ecopredict_db -f database/scripts/05_improvements.sql`.
5. Copiar `backend/.env.example` a `backend/.env`; configurar DATABASE_URL, JWT_SECRET aleatorio de 32+ caracteres, SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD. No publicar `.env`.
6. Copiar `frontend/.env.example` a `frontend/.env`.
7. `npm run install:all`; `npm run seed --prefix backend`.
8. Terminal 1: `npm run dev:api`; terminal 2: `npm run dev:web`.
9. Abrir `http://localhost:5173`; API `http://localhost:4000/api/health`.

## Demostración del flujo
- Iniciar sesión con credenciales configuradas durante seed.
- Crear usuarios y sitios si corresponde; seleccionar variable del catálogo.
- Registrar al menos 30 mediciones válidas, **con fechas distintas y secuencia comparable** para una misma estación y variable (datos de demostración se etiquetan como `demo`). También puede importarse un archivo CSV/XLSX.
- Visualizar el dashboard (KPIs, serie interactiva y mapa de calor), el mapa de estaciones, entrenar/registrar una predicción multi-paso, revisar MAE/RMSE/R²/sMAPE frente a baseline ingenuo, la validación walk-forward y exportar reportes.
- Gestionar anomalías y alertas: los valores atípicos se marcan como `suspect` (columna "Atipicidad") y las reglas activas generan alertas evaluadas durante la ingesta.
- Para un caso real, usar datos históricos auténticos, registrar procedencia y evaluar suficiencia y regularidad del muestreo.

## Seguridad y límites
- Acceso JWT 20 min + renovación rotativa 7 días (refresh en cookie httpOnly); autenticación mediante API y roles (admin/user).
- Usuario puede editar sus mediciones; solo admin puede eliminar y administrar usuarios, variables, estaciones y reglas de alerta.
- Los valores de referencia NO son límites legales; las alertas se generan por reglas configurables y no son alertas ambientales oficiales.
- Predicción: regresión Ridge de 3 rezagos, validación walk-forward, comparación con persistencia e intervalos conformales. No se garantiza aptitud operacional. En particular los intervalos irregulares afectan la validez del horizonte proyectado.
- No se incluyen integraciones de sensores ni infraestructura productiva. No ejecutar directamente en internet sin HTTPS, backups, supervisión, política de seguridad y endurecimiento adicional.

## Comprobación
`npm test --prefix backend` y `npm run build --prefix frontend`.

Documentación detallada: `docs/ARQUITECTURA.md`, `docs/API.md`, `docs/PRUEBAS.md`. El PDF adjunto desarrolla el proyecto y los límites comprobados.

## Dataset educativo opcional
Para demostrar predicción sin sensores ni archivos externos, tras crear el administrador ejecutar:
`psql -U postgres -d ecopredict_db -f database/scripts/04_demo_optional.sql`.
Este script crea 45 observaciones **sintéticas**, explícitamente etiquetadas `demo`. No se deben describir como datos reales.
