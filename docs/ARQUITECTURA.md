# Arquitectura EcoPredict AI

- SPA React + Vite + Tailwind + Plotly (gráficos interactivos con exportación PNG de alta resolución).
- API Node.js + Express; JWT acceso 20 minutos, refresh rotativo y rol admin/user.
- PostgreSQL: entidades fundamentales (roles, users, monitoring_sites, environmental_variables, measurements, prediction_runs, predictions, audit_logs), refresh_tokens y, desde la migración de mejoras, alert_rules y alerts.
- Entrenamiento y pronóstico Ridge de rezagos (implementado en JavaScript, sin dependencia TensorFlow). Estandarización previa, validación walk-forward (Time-Series CV), intervalos conformales, sMAPE y análisis de regularidad del muestreo.
- Detección de anomalías no supervisada por z-score modificado (mediana/MAD) y cercas IQR; las filas atípicas se marcan como `suspect` sin sobrescribir decisiones manuales de calidad.
- Sistema de alertas por reglas configurables (`alert_rules`), independiente de `reference_value`, evaluado durante la ingesta de mediciones (manual e importada).
- Los datos de demostración nunca son mediciones reales; las estaciones precargadas son ilustrativas.
- Seguridad: refresh token en cookie httpOnly (además del soporte por cuerpo para clientes no navegador); consultas SQL parametrizadas; hashes bcrypt; validación Zod; Helmet; CORS con credenciales; rate-limit en autenticación; logs; limitación de payload.
- Recomendaciones para despliegue real: TLS en reverse proxy, CSP, backups cifrados, reglas por entidad en todas las rutas, sesiones revocables globalmente, pruebas de penetración, monitoreo y backups probados.

## Módulos de la interfaz
- Panel (KPIs, serie temporal interactiva, mapa de calor estación × variable).
- Mediciones (registro manual, importación CSV/XLSX, paginación, columna de atipicidad).
- Predicciones (pronóstico multi-paso, intervalos, validación walk-forward e importancia de variables).
- Alertas (reglas configurables y gestión de alertas).
- Mapa de estaciones (proyección lat/lon con valores agregados).
- Catálogos, Reportes, Usuarios y Auditoría.

## Flujo
Navegador -> API REST -> PostgreSQL; ruta de predicción -> lectura histórica de mediciones válidas -> evaluación temporal y comparación con baseline -> registro en prediction_runs + predictions -> resultados y reportes. La ingesta de mediciones -> evaluación de anomalías -> evaluación de reglas de alerta -> registro en alerts.

## Base de datos
Arquitectura relacional con integridad referencial, índice por sitio-variable-fecha, unicidad (sitio, variable, fecha), calidades válidas/sospechosas/rechazadas y procedencia manual/import/sensor/demo. `reference_value` solo se utiliza como metadato contextual, jamás como umbral legal implícito.

## Limitaciones científicas
La regresión de 3 rezagos no modela cambios de régimen ni estacionalidades por sí misma. La validación walk-forward es una evaluación más honesta que la partición simple, pero sigue siendo preliminar; para uso real implementar control de intervalos regulares, cobertura/latencia de sensores, incertidumbre calibrada y monitoreo de deriva. La comparación con baseline no acredita por sí sola el desempeño operacional. No se deben publicar predicciones como alertas ambientales oficiales.
