$email = "admin@bodegas-alvaro.com"
$password = "admin123"
$nueva_version = "1.8"

$login = Invoke-RestMethod -Uri "https://fichajesbodegasalvaro-developed.up.railway.app/api/auth/login" -Method POST -ContentType "application/json" -Body "{`"email`":`"$email`",`"password`":`"$password`"}"

Write-Host "Token obtenido correctamente" -ForegroundColor Green

$result = Invoke-RestMethod -Uri "https://fichajesbodegasalvaro-developed.up.railway.app/api/config" -Method PUT -ContentType "application/json" -Headers @{Authorization="Bearer $($login.token)"} -Body "{`"version_minima`":`"$nueva_version`"}"

Write-Host "version_minima actualizada a: $nueva_version en DEV" -ForegroundColor Green
Write-Host "Configuracion actual:" -ForegroundColor Cyan
$result | ConvertTo-Json
