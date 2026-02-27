# ═══════════════════════════════════════════════════
# Script de re-deploy rápido (para actualizaciones)
# Ejecutar desde la raíz: .\scripts\deploy.ps1
# ═══════════════════════════════════════════════════

Write-Host "🚀 Actualizando Fichajes Bodegas Álvaro en Railway..." -ForegroundColor DarkRed
Write-Host ""

# Verificar que hay cambios
$status = git status --porcelain
if ($status) {
    Write-Host "📝 Guardando cambios en git..." -ForegroundColor Cyan
    git add .
    $fecha = Get-Date -Format "yyyy-MM-dd HH:mm"
    git commit -m "deploy: actualizacion $fecha"
}

Write-Host "🔨 Desplegando en Railway..." -ForegroundColor Cyan
railway up --detach

Write-Host ""
Write-Host "✅ Deploy enviado. Ver logs con: railway logs" -ForegroundColor Green
railway logs --tail 20
