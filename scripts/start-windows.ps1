$ErrorActionPreference='Stop'
Write-Host 'EcoPredict AI - inicie PostgreSQL y ejecute los scripts SQL antes de continuar.'
if (-not (Test-Path 'backend\.env')) { Copy-Item 'backend\.env.example' 'backend\.env'; Write-Host 'Configure backend\.env; luego vuelva a ejecutar'; exit 1 }
if (-not (Test-Path 'frontend\.env')) { Copy-Item 'frontend\.env.example' 'frontend\.env' }
Write-Host 'Abra DOS PowerShell adicionales:'
Write-Host '1) npm run dev:api'
Write-Host '2) npm run dev:web'
Write-Host 'Previamente: npm run install:all; npm run seed --prefix backend'
