# Endpoints API REST

Base `http://localhost:4000/api`. Todos los endpoints salvo login, refresh y health requieren `Authorization: Bearer <accessToken>`.

| Método | Ruta | Permiso | Uso |
|---|---|---|---|
| GET | /health | Público | Estado básico |
| POST | /auth/login | Público | `{email,password}` devuelve accessToken y refreshToken |
| POST | /auth/refresh | Público | `{refreshToken}` renueva y rota token |
| POST | /auth/logout | Autenticado | Revoca refreshToken |
| GET | /auth/me | Autenticado | Identidad y rol |
| GET,POST | /users | admin | Listar y crear usuarios |
| PATCH | /users/:id | admin | Actualizar estado/nombre/rol |
| GET,POST | /catalogs/sites | GET todos, POST admin | Estaciones |
| GET,POST | /catalogs/variables | GET todos, POST admin | Variables |
| GET,POST | /measurements | Autenticado | Listar, filtrar y crear mediciones |
| PATCH | /measurements/:id | Admin o propietario | Editar valor/notas/calidad |
| DELETE | /measurements/:id | admin | Eliminar medición |
| GET | /dashboard/summary | Autenticado | KPIs y últimas mediciones |
| GET | /dashboard/timeseries?site_id=1&variable_id=1 | Autenticado | Serie diaria |
| GET | /predictions | Autenticado | Historial |
| POST | /predictions/run | Autenticado | `{site_id,variable_id}` |
| GET | /reports/pdf, /reports/docx, /reports/xlsx | Autenticado | Descargar reportes filtrables |
| GET | /audit | admin | Hasta 200 acciones recientes |

Filtros mediciones: `site_id`, `variable_id`, `from` y `to` ISO8601, `limit` (<=500), `offset`.

Medición ejemplo: `{"site_id":1,"variable_id":1,"value":12.5,"measured_at":"2026-11-10T12:00:00-05:00","source_type":"manual","notes":"Medición de ejemplo"}`.

Una predicción necesita al menos 30 mediciones `quality_status=valid` por estación y variable. Respuesta 422 para datos insuficientes. Las métricas regresan en JSON junto con baseline.
