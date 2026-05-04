param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173,
    [switch]$SkipInstall,
    [switch]$SkipDbInit,
    [switch]$SkipPostgres
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$EnvFile = Join-Path $BackendDir ".env"
$EnvExample = Join-Path $BackendDir ".env.example"
$VenvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"

function Has-Command($Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Start-PostgresIfAvailable {
    if ($SkipPostgres) {
        Write-Host "Skipping PostgreSQL startup."
        return
    }
    if (-not (Has-Command "docker")) {
        Write-Host "Docker not found. Start PostgreSQL manually if it is not already running."
        return
    }
    $ComposeFile = Join-Path $Root "infra\docker-compose.yml"
    if (-not (Test-Path $ComposeFile)) {
        Write-Host "No infra/docker-compose.yml found. Start PostgreSQL manually."
        return
    }
    Write-Host "Starting PostgreSQL with Docker Compose..."
    docker compose -f $ComposeFile up -d postgres
}

function Ensure-Backend {
    if (-not (Test-Path $EnvFile)) {
        Copy-Item $EnvExample $EnvFile
        Write-Host "Created backend/.env from .env.example."
    }

    if (-not (Test-Path $VenvPython)) {
        Write-Host "Creating backend virtual environment..."
        python -m venv (Join-Path $BackendDir ".venv")
    }

    if (-not $SkipInstall) {
        Write-Host "Installing backend dependencies..."
        & $VenvPython -m pip install -r (Join-Path $BackendDir "requirements.txt")
    }

    if (-not $SkipDbInit) {
        Write-Host "Initializing database schema and built-ins..."
        Push-Location $BackendDir
        try {
            & $VenvPython -m app.init_db
        }
        finally {
            Pop-Location
        }
    }
}

function Ensure-Frontend {
    if (-not (Has-Command "pnpm")) {
        throw "pnpm is required. Install Node.js 20+ and enable pnpm/corepack first."
    }
    if ($SkipInstall) {
        Write-Host "Skipping frontend dependency install."
        return
    }
    Write-Host "Installing frontend dependencies..."
    Push-Location $FrontendDir
    try {
        pnpm install --frozen-lockfile
    }
    finally {
        Pop-Location
    }
}

function Start-DevProcesses {
    $Shell = Get-Command pwsh -ErrorAction SilentlyContinue
    if (-not $Shell) {
        $Shell = Get-Command powershell -ErrorAction Stop
    }

    $BackendCommand = ".\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --host 0.0.0.0 --port $BackendPort"
    $FrontendCommand = "pnpm dev --host 0.0.0.0 --port $FrontendPort"

    Start-Process -FilePath $Shell.Source -WorkingDirectory $BackendDir -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $BackendCommand)
    Start-Process -FilePath $Shell.Source -WorkingDirectory $FrontendDir -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $FrontendCommand)

    Write-Host ""
    Write-Host "MAI development servers are starting."
    Write-Host "Backend:  http://127.0.0.1:$BackendPort"
    Write-Host "Frontend: http://localhost:$FrontendPort"
    Write-Host ""
}

Start-PostgresIfAvailable
Ensure-Backend
Ensure-Frontend
Start-DevProcesses
