# git_push.ps1 — Dashboard Demo Day eCommerce Institute
# Sincroniza archivos con GitHub
# Uso: Doble clic o ejecutar en PowerShell

$REPO_URL   = "https://github.com/axellaban/demo-aiagents-ecommerce-institute.git"
$BRANCH     = "main"
$DIR        = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host " ============================================" -ForegroundColor Cyan
Write-Host "  Git Push — Demo Day eCommerce Institute" -ForegroundColor Cyan
Write-Host " ============================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $DIR

# Init repo si no existe
if (-not (Test-Path ".git")) {
    Write-Host "[1/4] Inicializando repositorio git..." -ForegroundColor Yellow
    git init
    git remote add origin $REPO_URL
} else {
    Write-Host "[1/4] Repositorio git detectado." -ForegroundColor Green
    # Asegurar que el remote apunte al repo correcto
    $remoteUrl = git remote get-url origin 2>$null
    if ($remoteUrl -ne $REPO_URL) {
        git remote set-url origin $REPO_URL
        Write-Host "      Remote actualizado a $REPO_URL" -ForegroundColor Yellow
    }
}

# Stage
Write-Host "[2/4] Agregando archivos..." -ForegroundColor Yellow
git add dashboard.html fichas.json transcript.txt servidor.py iniciar_dashboard.bat git_push.ps1 git_push.bat

# Commit
$timestamp  = Get-Date -Format "yyyy-MM-dd HH:mm"
$commitMsg  = "update: dashboard ecommerce-institute $timestamp"
Write-Host "[3/4] Commiteando: $commitMsg" -ForegroundColor Yellow
git commit -m $commitMsg

# Push
Write-Host "[4/4] Pusheando a $REPO_URL ($BRANCH)..." -ForegroundColor Yellow
git push -u origin $BRANCH

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host " ✅ Push exitoso!" -ForegroundColor Green
    Write-Host "    $REPO_URL" -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host " ❌ Error en el push. Revisá credenciales o el estado del repo." -ForegroundColor Red
}

Write-Host ""
Read-Host "Presioná Enter para cerrar"
