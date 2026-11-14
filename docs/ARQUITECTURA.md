# Arquitectura EcoPredict AI

- SPA React + Vite + Tailwind + Recharts.
- API Node.js + Express; JWT acceso 20 minutos, refresh rotativo y rol admin/user.
- PostgreSQL: ocho entidades fundamentales (roles, users, monitoring_sites, environmental_variables, measurements, prediction_runs, predictions, audit_logs) y refresh_tokens.
- Entrenamiento y pronóstico Ridge lineal de rezagos (implementado en JavaScript, sin dependencia TensorFlow). Holdout temporal 80/20 y evaluación comparada con persistencia de último valor.
- Los datos de demostración nunca son mediciones reales; las estaciones precargadas son ilustrativas.
- Seguridad: consultas SQL parametrizadas; hashes bcrypt; validación Zod; Helmet; CORS; rate-limit en autenticación; logs; limitación de payload.
- Recomendaciones para despliegue real: TLS en reverse proxy, refresh token en cookie httpOnly (la SPA actual usa sessionStorage), CSP, backups cifrados, reglas por entidad en todas las rutas, sesiones revocables globalmente, pruebas de penetración, monitoreo y backups probados.

## Flujo
Navegador -> API REST -> PostgreSQL; ruta de predicción -> lectura histórica de mediciones válidas -> evaluación temporal y comparación con baseline -> registro en prediction_runs + predictions -> resultados y reportes.

## Base de datos
Arquitectura relacional con integridad referencial, índice por sitio-variable-fecha, calidades válidas/sospechosas/rechazadas y procedencia manual/import/sensor/demo. `reference_value` solo se utiliza como metadato contextual, jamás como umbral legal implícito.

## Limitaciones científicas
La regresión de 3 rezagos no modela cambios de régimen ni estacionalidades por sí misma. La separación 80/20 es una evaluación preliminar; para uso real implementar backtesting por ventanas temporales, control de intervalos regulares, cobertura/latencia de sensores, incertidumbre calibrada y monitoreo de deriva. La comparación con baseline no acredita por sí sola el desempeño operacional. No se deben publicar predicciones como alertas ambientales oficiales.
