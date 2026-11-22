# Manual de ejecución local de EcoPredict AI

## Objetivo y alcance

Guía para que una persona o un agente instale y ejecute el proyecto en otra computadora. La ruta principal usa Windows y PowerShell. Al finalizar deben funcionar la interfaz en http://localhost:5173 y la API en http://localhost:4000/api/health.

La aplicación usa React/Vite, Node.js/Express y PostgreSQL. No requiere Docker ni sensores. Copiar el código no copia los datos de la computadora original: la instalación descrita crea una base local nueva.

## 1. Preparar y transferir el proyecto

Copiar la carpeta completa del código, incluyendo `backend`, `frontend`, `database`, `scripts`, `docs`, el PDF del MVP y los archivos `package.json` y `package-lock.json` existentes. Conservar los archivos `.env.example`.

Excluir `node_modules`, `.npm-cache`, `dist`, registros `*.log` y archivos `.env` con credenciales. Crear credenciales nuevas en el equipo de destino. Verificar que la copia incluya las correcciones actuales de `frontend/tailwind.config.js` y `frontend/src/pages/Catalogs.jsx`.

Leer `README.md` y el PDF de la raíz antes de modificar el alcance funcional. Si hay instrucciones `AGENTS.md` en el equipo de destino, revisarlas también.

## 2. Requisitos

- Node.js 20 o superior; el README recomienda Node.js 22 LTS. npm viene con Node.js.
- PostgreSQL 15 o superior instalado, con el servidor activo.
- Usuario PostgreSQL con permisos para crear la base y sus tablas, y su contraseña.
- Acceso de red a `https://registry.npmjs.org` para descargar dependencias.
- Puertos 4000 y 5173 disponibles.

En PowerShell, desde la raíz del proyecto:

```powershell
node --version
npm.cmd --version
Get-Service *postgres*
```

Si los comandos no están en PATH, usar sus rutas completas. Si el agente tiene restricciones de red o archivos, informar el bloqueo y solicitar al operador ejecutar el comando necesario desde su terminal. No modificar los permisos de seguridad del agente para eludirlo.

## 3. Instalación asistida en Windows

El script `scripts/setup-local.ps1` utiliza estas rutas predeterminadas:

```text
C:\Program Files\nodejs\npm.cmd
C:\Program Files\PostgreSQL\18\bin\psql.exe
```

Si PostgreSQL tiene otra versión o ubicación, editar la variable `$psql` al principio del script. Ajustar `$npm` si corresponde. No asumir que PostgreSQL siempre es versión 18.

Desde la carpeta que contiene el `package.json` principal:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-local.ps1
```

El script instala dependencias, solicita la contraseña de `postgres` sin mostrarla, crea `ecopredict_db` si falta, aplica esquema, catálogos y la migración de mejoras, genera los `.env` ausentes, crea el administrador, ejecuta pruebas y compilación e inicia ambos servicios en segundo plano. Abre el navegador después de comprobar HTTP.

El parámetro `ExecutionPolicy Bypass` se aplica al proceso invocado; no es necesario cambiar permanentemente la política de ejecución.

**Entorno existente:** el script conserva los `.env` que encuentre y el seed no cambia la contraseña de una cuenta ya creada. Si se trasladó un `.env` antiguo o cambió la contraseña de PostgreSQL, corregir `DATABASE_URL` antes de ejecutar el seed. La contraseña solicitada por el script no reemplaza esa conexión existente. No ejecutar de nuevo el instalador con servidores ya iniciados: usar la sección 5.

No compartir las credenciales en el chat, capturas, logs ni repositorios.

## 4. Instalación manual alternativa

Esta ruta sirve también como referencia para Linux y macOS: usar `npm` en vez de `npm.cmd`, las herramientas equivalentes del sistema para copiar archivos e iniciar PostgreSQL, y dos terminales para el arranque.

### Base de datos

Los siguientes comandos suponen que `psql` está en PATH. Si no lo está, anteponer su ruta completa; en PowerShell usar `& "RUTA\psql.exe"`.

```powershell
psql -h localhost -U postgres -d postgres -W -v ON_ERROR_STOP=1 -f database/scripts/01_create_database.sql
psql -h localhost -U postgres -d ecopredict_db -W -v ON_ERROR_STOP=1 -f database/scripts/02_schema.sql
psql -h localhost -U postgres -d ecopredict_db -W -v ON_ERROR_STOP=1 -f database/scripts/03_catalogs.sql
psql -h localhost -U postgres -d ecopredict_db -W -v ON_ERROR_STOP=1 -f database/scripts/05_improvements.sql
```

El script `05_improvements.sql` es idempotente y añade unicidad de mediciones, el puntaje de anomalías, el paso de horizonte y las tablas de reglas y alertas. Puede ejecutarse nuevamente sin efectos secundarios.

Si `ecopredict_db` ya existe, omitir el primer comando. No borrarla para resolver ese mensaje. Para cualquier comando que falle, detenerse y resolver el error antes del siguiente paso.

### Variables de entorno

Copiar los ejemplos solamente si los archivos de destino no existen:

```powershell
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
if (!(Test-Path frontend/.env)) { Copy-Item frontend/.env.example frontend/.env }
```

Editar `backend/.env` localmente:

```dotenv
PORT=4000
DATABASE_URL=postgresql://postgres:CONTRASENA_CODIFICADA@localhost:5432/ecopredict_db
JWT_SECRET=SECRETO_ALEATORIO_DE_AL_MENOS_32_CARACTERES
CORS_ORIGIN=http://localhost:5173
SEED_ADMIN_EMAIL=admin@ecopredict.local
SEED_ADMIN_PASSWORD=CONTRASENA_NUEVA_DE_AL_MENOS_10_CARACTERES
NODE_ENV=development
```

Reemplazar los marcadores. Generar el secreto con un generador criptográfico, por ejemplo `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`, y copiar su salida al archivo local. Codificar como componente URL la contraseña de PostgreSQL si incluye caracteres especiales, como `@`, `:`, `/`, `#` o `%`.

En `frontend/.env`:

```dotenv
VITE_API_URL=http://localhost:4000/api
```

### Dependencias, administrador y comprobaciones

```powershell
npm.cmd run install:all
npm.cmd run seed --prefix backend
npm.cmd test --prefix backend
npm.cmd run build --prefix frontend
```

Ejecutar en ese orden y comprobar que cada comando termine correctamente. Se esperan dieciséis pruebas del backend aprobadas (predicción y anomalías) y una compilación del frontend sin errores. El comando `build` genera archivos estáticos; no inicia los servidores.

## 5. Arranque habitual y parada

Después de completar la instalación, abrir dos terminales en la raíz del proyecto.

Terminal 1:

```powershell
npm.cmd run dev:api
```

Terminal 2:

```powershell
npm.cmd run dev:web
```

Mantener ambas terminales abiertas. Para detenerlas, pulsar `Ctrl+C` en cada una. Para iniciar nuevamente, repetir esos dos comandos con PostgreSQL activo; no recrear la base.

El instalador asistido usa procesos ocultos y guarda `backend-local.log`, `backend-local-error.log`, `frontend-local.log` y `frontend-local-error.log` en la raíz. Para identificar procesos que ocupan los puertos:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 4000,5173 |
    Select-Object LocalPort,OwningProcess
```

Consultar cada PID con `Get-Process -Id NUMERO`. Detener únicamente procesos confirmados como pertenecientes a esta ejecución; no cerrar todos los procesos Node de la computadora. Para recuperar el arranque del backend después de cambios de configuración, reiniciar su proceso.

## 6. Verificación y acceso

```powershell
Invoke-RestMethod http://localhost:4000/api/health
(Invoke-WebRequest http://localhost:5173 -UseBasicParsing).StatusCode
```

La API debe devolver `status: ok` y `service: EcoPredict AI API`; la interfaz debe responder HTTP 200. Abrir http://localhost:5173 y confirmar que aparece el formulario sin errores de compilación. HTTP 200 por sí solo no verifica el inicio de sesión ni todas las funciones.

Ingresar con `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` del `backend/.env` del equipo de destino. Si se utilizó el script, el usuario inicial es `admin@ecopredict.local` y la contraseña fue generada automáticamente en ese archivo. La contraseña de PostgreSQL es distinta de la cuenta de la aplicación.

Comprobar inicio de sesión, apertura del dashboard y consulta de catálogos. Un dashboard vacío es normal en una instalación nueva.

`localhost` siempre apunta a la computadora donde se abre el navegador. Esta guía supone navegador, frontend y backend en el mismo equipo; para acceso desde otro equipo habría que configurar direcciones, CORS y red específicamente.

## 7. Uso básico y demostración opcional

1. Consultar o crear estaciones y variables en Catálogos con la cuenta administradora.
2. Registrar mediciones indicando estación, variable, fecha, valor, procedencia y calidad; también pueden importarse archivos CSV o Excel.
3. Consultar indicadores y series en el dashboard, el mapa de calor y el mapa de estaciones; gestionar alertas y sus reglas.
4. Ejecutar predicciones con al menos 30 observaciones válidas, de fechas distintas, de la misma estación y variable, ajustando horizonte y pliegues. Revisar MAE, RMSE, R², sMAPE, la validación walk-forward y la comparación con persistencia.
5. Exportar reportes PDF, Word o Excel y consultar la auditoría como administrador.

Para una demostración en una base de desarrollo, después del seed puede cargarse la serie incluida:

```powershell
psql -h localhost -U postgres -d ecopredict_db -W -v ON_ERROR_STOP=1 -f database/scripts/04_demo_optional.sql
```

Inserta 45 mediciones sintéticas de temperatura (`TEMP`) en la estación de referencia, etiquetadas `demo`. No son mediciones reales. No cargar este dataset sobre una base de producción.

## 8. Resolución de errores

| Problema | Acción |
| --- | --- |
| `node`, `npm` o `psql` no se reconoce | Verificar instalación y PATH; abrir una terminal nueva o usar la ruta completa. |
| npm devuelve `EACCES`, `EPERM` o errores de red | Revisar el mensaje y la ruta afectada. Si el bloqueo pertenece al entorno restringido del agente, ejecutar la instalación desde la terminal del operador. No desactivar TLS ni usar `--force` como solución general. |
| `password authentication failed` | Verificar usuario, contraseña, host y puerto. Revisar `DATABASE_URL`; no asumir que la contraseña es `postgres`. |
| Contraseña PostgreSQL olvidada | El administrador del equipo debe recuperar o restablecer la cuenta mediante el procedimiento de su instalación. No dejar autenticación `trust` permanente ni borrar la base. |
| `ECONNREFUSED` hacia 5432 | Verificar que PostgreSQL esté activo y escuche en el puerto configurado. |
| `database already exists` | Omitir creación y continuar con el esquema de la base correcta. |
| Puerto 4000 ocupado o Vite pasa a 5174 | Revisar procesos existentes. Usar 5173 para conservar el CORS predeterminado o actualizar coherentemente puertos, URL y CORS. |
| Error de sintaxis en Tailwind o `Catalogs.jsx` | Comprobar que se copió la versión corregida del proyecto. Ejecutar de nuevo el build; no ignorar el error aunque Vite anuncie un puerto. |
| Pantalla vacía o no carga el dashboard | Revisar terminal de Vite, consola del navegador, salud de la API y `VITE_API_URL`. |
| Login rechazado después de editar el seed | El seed conserva usuarios existentes; editar `SEED_ADMIN_PASSWORD` no cambia la contraseña almacenada de esa cuenta. |
| Error al entrenar | Revisar cantidad de mediciones válidas y selección de estación/variable. |

Si npm informa vulnerabilidades, guardar el detalle de `npm audit` y evaluar las actualizaciones por separado. No ejecutar automáticamente `npm audit fix --force`, ya que puede introducir cambios incompatibles.

## 9. Criterio de finalización para el agente

Entregar el enlace local solamente después de verificar que los procesos siguen activos. Informar qué se comprobó realmente: pruebas, build, salud HTTP e inicio de sesión cuando se haya realizado. Si falta alguna verificación, indicarlo junto con el bloqueo concreto. No afirmar que el proyecto funciona completamente basándose únicamente en que Vite anuncia su puerto.

No publicar credenciales en el informe final. No exponer esta ejecución de desarrollo directamente a internet. El MVP incluye limitaciones predictivas y de seguridad descritas en el README y el PDF.

### Instrucción lista para entregar a otro agente

> Lee `docs/MANUAL_EJECUCION_AGENTE.md`, `README.md` y el PDF del MVP en la raíz. Instala y ejecuta EcoPredict AI localmente siguiendo la guía y adaptando las rutas al equipo. Conserva datos y credenciales existentes. Solicita que las contraseñas se introduzcan localmente sin exponerlas en el chat. Ejecuta las pruebas y la compilación, verifica la API y la interfaz y entrega el enlace local con el resultado real de las comprobaciones. Si tus permisos impiden una acción, explica el bloqueo y proporciona al operador el comando exacto.
