# ═══════════════════════════════════════════════════════════════════
# Script de configuración de Railway para Fichajes Bodegas Álvaro
# Ejecutar desde la raíz del proyecto: .\scripts\setup-railway.ps1
# ═══════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "🍷  Fichajes Bodegas Álvaro — Configuración Railway" -ForegroundColor DarkRed
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor DarkRed
Write-Host ""

# Verificar que railway CLI está instalado
try {
    $version = railway --version 2>&1
    Write-Host "✅ Railway CLI: $version" -ForegroundColor Green
} catch {
    Write-Host "❌ Railway CLI no encontrado. Instalando..." -ForegroundColor Yellow
    npm install -g @railway/cli
}

# Generar JWT Secret seguro
Write-Host ""
Write-Host "🔑 Generando JWT Secret seguro..." -ForegroundColor Cyan
$jwtSecret = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
Write-Host "   JWT_SECRET generado: $($jwtSecret.Substring(0,8))..." -ForegroundColor Gray

# Login en Railway
Write-Host ""
Write-Host "🔐 Iniciando sesión en Railway (se abrirá el navegador)..." -ForegroundColor Cyan
railway login

Write-Host ""
Write-Host "📦 Creando proyecto en Railway..." -ForegroundColor Cyan
railway init --name "fichajes-bodegas-alvaro"

# Configurar variables de entorno
Write-Host ""
Write-Host "⚙️  Configurando variables de entorno..." -ForegroundColor Cyan
railway variables --set "NODE_ENV=production"
railway variables --set "JWT_SECRET=$jwtSecret"
railway variables --set "DB_PATH=/data/fichajes.db"

Write-Host ""
Write-Host "📁 IMPORTANTE: Crear el Volume para la base de datos" -ForegroundColor Yellow
Write-Host "   Ve a tu proyecto en https://railway.app" -ForegroundColor Yellow
Write-Host "   → Settings → Volumes → Add Volume" -ForegroundColor Yellow
Write-Host "   → Mount Path: /data" -ForegroundColor Yellow
Write-Host ""
Write-Host "Presiona Enter cuando hayas creado el Volume..." -ForegroundColor Yellow
Read-Host

# Desplegar
Write-Host ""
Write-Host "🚀 Desplegando en Railway..." -ForegroundColor Cyan
railway up --detach

Write-Host ""
Write-Host "⏳ Esperando a que el deploy termine..." -ForegroundColor Cyan
Start-Sleep -Seconds 5

# Mostrar URL del deploy
Write-Host ""
Write-Host "🌐 URL de tu aplicación:" -ForegroundColor Cyan
railway open

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor DarkRed
Write-Host "✅ ¡Deploy completado!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Credenciales iniciales:" -ForegroundColor Cyan
Write-Host "   Email: admin@bodegas-alvaro.com" -ForegroundColor White
Write-Host "   Password: admin123" -ForegroundColor White
Write-Host ""
Write-Host "⚠️  IMPORTANTE: Cambia la contraseña del admin en el primer acceso!" -ForegroundColor Yellow
Write-Host ""
Write-Host "Para ver los logs del servidor:" -ForegroundColor Gray
Write-Host "   railway logs" -ForegroundColor Gray
Write-Host ""
