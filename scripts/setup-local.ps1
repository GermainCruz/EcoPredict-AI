$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$npm = 'C:\Program Files\nodejs\npm.cmd'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw "El comando anterior fallo (codigo $LASTEXITCODE)." } }
function New-Secret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes)
}
& $npm install --prefix backend
Check-Exit
& $npm install --prefix frontend
Check-Exit
$securePassword = Read-Host 'Contrasena del usuario postgres' -AsSecureString
$credential = New-Object System.Net.NetworkCredential('', $securePassword)
$dbPassword = $credential.Password
$env:PGPASSWORD = $dbPassword
try {
    $exists = & $psql -h localhost -U postgres -d postgres -w -tAc "SELECT 1 FROM pg_database WHERE datname='ecopredict_db'"
    Check-Exit
    if ($exists -ne '1') {
        & $psql -h localhost -U postgres -d postgres -w -v ON_ERROR_STOP=1 -f database/scripts/01_create_database.sql
        Check-Exit
    }
    foreach ($file in @('02_schema.sql', '03_catalogs.sql')) {
        & $psql -h localhost -U postgres -d ecopredict_db -w -v ON_ERROR_STOP=1 -f "database/scripts/$file"
        Check-Exit
    }
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
if (!(Test-Path backend/.env)) {
    $adminPassword = New-Secret
    $jwtSecret = New-Secret
    $encodedPassword = [Uri]::EscapeDataString($dbPassword)
    @"
PORT=4000
DATABASE_URL=postgresql://postgres:$encodedPassword@localhost:5432/ecopredict_db
JWT_SECRET=$jwtSecret
CORS_ORIGIN=http://localhost:5173
SEED_ADMIN_EMAIL=admin@ecopredict.local
SEED_ADMIN_PASSWORD=$adminPassword
NODE_ENV=development
"@ | Set-Content backend/.env -Encoding ASCII
}
if (!(Test-Path frontend/.env)) { Copy-Item frontend/.env.example frontend/.env }
& $npm run seed --prefix backend
Check-Exit
& $npm test --prefix backend
Check-Exit
& $npm run build --prefix frontend
Check-Exit
$root = (Get-Location).Path
Start-Process -FilePath $npm -ArgumentList @('run', 'dev:api') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$root/backend-local.log" -RedirectStandardError "$root/backend-local-error.log"
Start-Process -FilePath $npm -ArgumentList @('run', 'dev:web', '--', '--strictPort') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$root/frontend-local.log" -RedirectStandardError "$root/frontend-local-error.log"
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $null = Invoke-WebRequest http://localhost:4000/api/health -UseBasicParsing
        $null = Invoke-WebRequest http://localhost:5173 -UseBasicParsing
        $ready = $true
        break
    } catch { }
}
if (!$ready) { throw 'No se pudo verificar el arranque. Revisa los archivos *local*.log en la raiz.' }
Write-Host 'Aplicacion disponible: http://localhost:5173'
Write-Host 'Usuario: admin@ecopredict.local'
Write-Host 'La contrasena de acceso esta en SEED_ADMIN_PASSWORD dentro de backend/.env.'
Start-Process 'http://localhost:5173'
