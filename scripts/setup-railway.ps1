# Setup Railway - Fichajes Bodegas Alvaro
# Sin emojis ni caracteres especiales para evitar problemas de encoding en PowerShell

param(
    [string]$VercelUrl = "",
    [string]$JwtSecret = ""
)

Write-Host ""
Write-Host "=== Fichajes Bodegas Alvaro - Backend en Railway ===" -ForegroundColor DarkRed
Write-Host ""

# Verificar railway CLI
try {
    $v = railway --version 2>&1
    Write-Host "[OK] Railway CLI: $v" -ForegroundColor Green
} catch {
    Write-Host "[!] Railway CLI no encontrado. Instalando..." -ForegroundColor Yellow
    npm install -g @railway/cli
}

# Generar JWT Secret si no se paso como parametro
if ($JwtSecret -eq "") {
    Write-Host ""
    Write-Host "[...] Generando JWT Secret seguro..." -ForegroundColor Cyan
    $JwtSecret = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    Write-Host "[OK] JWT_SECRET generado." -ForegroundColor Green
}

Write-Host ""
Write-Host "--- PASO 1: Login en Railway ---" -ForegroundColor Yellow
railway login

Write-Host ""
Write-Host "--- PASO 2: Crear servicio en el proyecto ---" -ForegroundColor Yellow
Write-Host "Selecciona el proyecto 'fichajes-bodegas-alvaro-api' y crea un servicio nuevo." -ForegroundColor White
railway service

Write-Host ""
Write-Host "--- PASO 3: Configurar variables de entorno ---" -ForegroundColor Yellow
railway variables --set "NODE_ENV=production"
railway variables --set "JWT_SECRET=$JwtSecret"
railway variables --set "DB_PATH=/data/fichajes.db"

if ($VercelUrl -ne "") {
    railway variables --set "FRONTEND_URL=$VercelUrl"
    Write-Host "[OK] FRONTEND_URL=$VercelUrl" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[!] Cuando tengas la URL de Vercel, ejecuta:" -ForegroundColor Yellow
    Write-Host "    railway variables --set ""FRONTEND_URL=https://TU-APP.vercel.app""" -ForegroundColor Gray
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "[!] PASO MANUAL OBLIGATORIO: Crear el Volume en Railway" -ForegroundColor Yellow
Write-Host ""
Write-Host "    1. Ve a https://railway.com/project/f586e9b0-c60c-4af5-8351-6bac3696f4f7"
Write-Host "    2. Haz clic en el servicio -> Add Volume"
Write-Host "    3. Mount Path: /data"
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Presiona Enter cuando hayas creado el Volume en el dashboard..." -ForegroundColor Yellow
Read-Host

Write-Host ""
Write-Host "--- PASO 4: Desplegar ---" -ForegroundColor Yellow
railway up --detach

Write-Host ""
Write-Host "[...] Esperando logs..." -ForegroundColor Cyan
Start-Sleep -Seconds 10
railway logs --tail 20

Write-Host ""
Write-Host "=== DEPLOY COMPLETADO ===" -ForegroundColor Green
Write-Host ""
Write-Host "URL de la API:" -ForegroundColor Cyan
railway open
Write-Host ""
Write-Host "GUARDA este JWT Secret en lugar seguro:" -ForegroundColor Yellow
Write-Host "$JwtSecret" -ForegroundColor White
Write-Host ""
Write-Host "Credenciales iniciales de la app:" -ForegroundColor Cyan
Write-Host "  Email:    admin@bodegas-alvaro.com" -ForegroundColor White
Write-Host "  Password: admin123" -ForegroundColor White
Write-Host ""
