# ============================================================
# build_dev_apk.ps1
# Genera el APK de desarrollo (debug) conectado al servidor
# de pruebas: fichajesbodegasalvaro-developed.up.railway.app
#
# App ID: com.bodegasalvaro.fichajes.dev  (convive con prod)
# Nombre: "Fichajes DEV"
# ============================================================

$ErrorActionPreference = "Stop"
$root    = $PSScriptRoot
$frontend = Join-Path $root "frontend"
$android  = Join-Path $frontend "android"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BUILD APK DEV - servidor de pruebas  " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Copiar .env.dev -> .env (bakeamos la URL del servidor dev)
Write-Host "[1/4] Configurando entorno DEV..." -ForegroundColor Yellow
$envDev  = Join-Path $frontend ".env.dev"
$envFile = Join-Path $frontend ".env"
$envBackup = Join-Path $frontend ".env.bak"

Copy-Item $envFile $envBackup -Force
Copy-Item $envDev  $envFile   -Force
Write-Host "      VITE_API_URL -> fichajesbodegasalvaro-developed.up.railway.app" -ForegroundColor Gray

# 2. Build frontend
Write-Host "[2/4] Compilando frontend (npm run build)..." -ForegroundColor Yellow
Set-Location $frontend
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR en npm run build" -ForegroundColor Red
    Copy-Item $envBackup $envFile -Force
    exit 1
}

# 3. Capacitor copy
Write-Host "[3/4] Copiando assets a Android (cap copy android)..." -ForegroundColor Yellow
npx cap copy android
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR en cap copy" -ForegroundColor Red
    Copy-Item $envBackup $envFile -Force
    exit 1
}

# 4. Restaurar .env original
Copy-Item $envBackup $envFile -Force
Remove-Item $envBackup -Force
Write-Host "      .env restaurado" -ForegroundColor Gray

# 5. Gradle assembleDebug
Write-Host "[4/4] Compilando APK debug (assembleDebug)..." -ForegroundColor Yellow
Set-Location $android

$gradlew = Join-Path $android "gradlew.bat"
& $gradlew assembleDebug
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR en Gradle" -ForegroundColor Red
    Set-Location $root
    exit 1
}

Set-Location $root

# Localizar APK generado
$apkPath = Join-Path $android "app\build\outputs\apk\debug\app-debug.apk"
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  APK DEV generado correctamente!       " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Archivo: $apkPath" -ForegroundColor White
Write-Host ""
Write-Host "  App ID : com.bodegasalvaro.fichajes.dev" -ForegroundColor Cyan
Write-Host "  Nombre : Fichajes DEV" -ForegroundColor Cyan
Write-Host "  Servidor: fichajesbodegasalvaro-developed.up.railway.app" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Instala con:" -ForegroundColor Gray
Write-Host "  adb install -r `"$apkPath`"" -ForegroundColor Gray
Write-Host ""
