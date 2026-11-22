# Endpoints API REST

Base `http://localhost:4000/api`. Todos los endpoints salvo login, refresh y health requieren `Authorization: Bearer <accessToken>`.

El `refreshToken` viaja en una cookie **httpOnly** (`eco_refresh`) para el cliente web; por compatibilidad también se acepta en el cuerpo de `/auth/refresh` y `/auth/logout`.

| Método | Ruta | Permiso | Uso |
|---|---|---|---|
| GET | /health | Público | Estado básico |
| POST | /auth/login | Público | `{email,password}` devuelve `{accessToken,user}` y fija cookie httpOnly `eco_refresh` |
| POST | /auth/refresh | Público | Renueva y rota token (cookie o `{refreshToken}`) |
| POST | /auth/logout | Autenticado | Revoca refreshToken y limpia cookie |
| GET | /auth/me | Autenticado | Identidad y rol |
| GET,POST | /users | admin | Listar y crear usuarios |
| PATCH | /users/:id | admin | Actualizar estado/nombre/rol |
| GET,POST | /catalogs/sites | GET todos, POST admin | Estaciones |
| GET,POST | /catalogs/variables | GET todos, POST admin | Variables |
| GET | /measurements | Autenticado | Listar, filtrar y paginar mediciones |
| POST | /measurements | Autenticado | Registrar medición manual (evalúa anomalías y alertas) |
| POST | /measurements/import | Autenticado | Importar CSV/XLSX (evalúa anomalías y alertas) |
| PATCH | /measurements/:id | Admin o propietario | Editar valor/notas/calidad |
| DELETE | /measurements/:id | admin | Eliminar medición |
| GET | /dashboard/summary | Autenticado | KPIs (incluye estado de alertas) y últimas mediciones |
| GET | /dashboard/timeseries?site_id=1&variable_id=1 | Autenticado | Serie diaria |
| GET | /dashboard/heatmap | Autenticado | Matriz estación × variable con promedio/mín/máx/muestras |
| GET | /predictions | Autenticado | Historial de corridas con sus pronósticos |
| POST | /predictions/run | Autenticado | `{site_id,variable_id,horizon,folds}` pronóstico multi-paso |
| GET | /alerts | Autenticado | Listar alertas con filtros `status` y `severity` |
| GET | /alerts/summary | Autenticado | KPIs de alertas |
| PATCH | /alerts/:id | Autenticado | Cambiar estado (acknowledged/dismissed) |
| GET,POST | /alerts/rules | GET autenticado, POST admin | Reglas de alerta configurables |
| PATCH,DELETE | /alerts/rules/:id | admin | Activar/desactivar o eliminar regla |
| GET | /reports/pdf, /reports/docx, /reports/xlsx | Autenticado | Descargar reportes filtrables |
| GET | /audit | admin | Hasta 200 acciones recientes |

## Mediciones

Filtros: `site_id`, `variable_id`, `from` y `to` ISO8601, `limit` (1–500, por defecto 100) y `offset`.

Medición ejemplo: `{"site_id":1,"variable_id":1,"value":12.5,"measured_at":"2026-11-10T12:00:00-05:00","source_type":"manual","notes":"Medición de ejemplo"}`.

La respuesta de creación incluye `anomaly_flagged` y `alerts_created`.

## Importación (CSV / XLSX)

`POST /measurements/import` con cuerpo `{site_id, variable_id, content, format, source_type, filename?}` donde `content` es el archivo en base64 y `format` ∈ `csv | xlsx | auto` (autodetección por firma binaria).

Se aceptan cabeceras con alias (`measured_at|fecha|timestamp`, `value|valor|lectura`, `notes|nota`). El resultado detalla `{format, received, inserted, duplicates, failed, flagged, alerts_created, errors[:50], errors_truncated, summary}`. Los duplicados (mismo sitio, variable y fecha) se ignoran con `ON CONFLICT DO NOTHING`.

## Predicciones

`POST /predictions/run` acepta `horizon` (1–12, por defecto 1) y `folds` (3–10, por defecto 5) para la validación walk-forward. Requiere al menos 30 mediciones `quality_status=valid` por estación y variable (422 si son insuficientes). La respuesta incluye métricas (MAE/RMSE/R²/sMAPE), comparación con baseline, intervalos conformales, regularidad del muestreo, importancia de variables y las métricas por pliegue de la validación temporal.
