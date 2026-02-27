# ═══════════════════════════════════════════════════════════════════
# Script de configuración de Railway — Solo BACKEND
# Ejecutar desde la raíz del proyecto: .\scripts\setup-railway.ps1
# ═══════════════════════════════════════════════════════════════════

param(
  [string]$VercelUrl = ""
)

Write-Host ""
Write-Host "🍷  Fichajes Bodegas Álvaro — Backend en Railway" -ForegroundColor DarkRed
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor DarkRed
Write-Host ""

# Verificar railway CLI
try {
    $v = railway --version 2>&1
    Write-Host "✅ Railway CLI: $v" -ForegroundColor Green
} catch {
    Write-Host "❌ Railway CLI no encontrado. Instalando..." -ForegroundColor Yellow
    npm install -g @railway/cli
}

# Generar JWT Secret
Write-Host ""
Write-Host "🔑 Generando JWT Secret seguro..." -ForegroundColor Cyan
$jwtSecret = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
Write-Host "   JWT_SECRET: $($jwtSecret.Substring(0,8))..." -ForegroundColor Gray

# Login
Write-Host ""
Write-Host "🔐 Iniciando sesión en Railway (se abrirá el navegador)..." -ForegroundColor Cyan
railway login

# Crear proyecto
Write-Host ""
Write-Host "📦 Creando proyecto en Railway..." -ForegroundColor Cyan
railway init --name "fichajes-bodegas-alvaro-api"

# Variables de entorno
Write-Host ""
Write-Host "⚙️  Configurando variables de entorno..." -ForegroundColor Cyan
railway variables --set "NODE_ENV=production"
railway variables --set "JWT_SECRET=$jwtSecret"
railway variables --set "DB_PATH=/data/fichajes.db"

if ($VercelUrl -ne "") {
    railway variables --set "FRONTEND_URL=$VercelUrl"
    Write-Host "   FRONTEND_URL=$VercelUrl" -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "⚠️  Cuando tengas la URL de Vercel, ejecuta:" -ForegroundColor Yellow
    Write-Host '   railway variables --set "FRONTEND_URL=https://TU-APP.vercel.app"' -ForegroundColor Gray
}

# Volume
Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "📁 PASO MANUAL: Crear el Volume para la base de datos" -ForegroundColor Yellow
Write-Host ""
Write-Host "   1. Ve a https://railway.app → Tu proyecto" -ForegroundColor White
Write-Host "   2. Haz clic en '+ Add Service' → 'Volume'" -ForegroundColor White
Write-Host "   3. Mount Path: /data" -ForegroundColor White
Write-Host "   4. Conecta el Volume al servicio de la API" -ForegroundColor White
Write-Host ""
Write-Host "Presiona Enter cuando hayas creado el Volume..." -ForegroundColor Yellow
Read-Host

# Deploy
Write-Host ""
Write-Host "🚀 Desplegando backend en Railway..." -ForegroundColor Cyan
railway up --detach

Write-Host ""
Write-Host "⏳ Esperando logs del deploy..." -ForegroundColor Cyan
Start-Sleep -Seconds 8
railway logs --tail 15

# URL final
Write-Host ""
Write-Host "🌐 URL de tu API:" -ForegroundColor Cyan
railway open

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor DarkRed
Write-Host "✅ ¡Backend desplegado en Railway!" -ForegroundColor Green
Write-Host ""
Write-Host "🔗 Próximo paso: Desplegar el frontend en Vercel" -ForegroundColor Cyan
Write-Host "   Ver: DESPLIEGUE_RAILWAY.md" -ForegroundColor Gray
Write-Host ""
Write-Host "💾 Guarda este JWT Secret en lugar seguro:" -ForegroundColor Yellow
Write-Host "   $jwtSecret" -ForegroundColor White
Write-Host ""
