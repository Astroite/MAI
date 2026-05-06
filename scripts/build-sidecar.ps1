param(
    [string]$TargetTriple = "",
    [switch]$SkipFrontendBuild
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$TauriDir = Join-Path $FrontendDir "src-tauri"
$BinariesDir = Join-Path $TauriDir "binaries"
$StagingDir = Join-Path $BinariesDir "staging"
$VenvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"

function Get-HostTriple {
    if (-not [string]::IsNullOrWhiteSpace($TargetTriple)) {
        return $TargetTriple
    }
    $Rustc = Get-Command rustc -ErrorAction SilentlyContinue
    if (-not $Rustc) {
        throw "rustc is required to determine the Tauri sidecar target triple. Install Rust or pass -TargetTriple."
    }
    try {
        $Triple = (& $Rustc.Source --print host-tuple).Trim()
        if (-not [string]::IsNullOrWhiteSpace($Triple)) {
            return $Triple
        }
    }
    catch {
        # Rust < 1.84 does not support --print host-tuple; fall back below.
    }
    $VersionInfo = & $Rustc.Source -Vv
    $HostLine = $VersionInfo | Where-Object { $_ -like "host:*" } | Select-Object -First 1
    if (-not $HostLine) {
        throw "Could not determine Rust host target triple."
    }
    return ($HostLine -replace "^host:\s*", "").Trim()
}

function Ensure-FrontendDist {
    if ($SkipFrontendBuild) {
        return
    }
    Push-Location $FrontendDir
    try {
        pnpm build
    }
    finally {
        Pop-Location
    }
}

function Ensure-PyInstaller {
    if (Test-Path $VenvPython) {
        return $VenvPython
    }
    $Python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $Python) {
        throw "Python is required to build the backend sidecar."
    }
    return $Python.Source
}

$Triple = Get-HostTriple
$Extension = if ($IsWindows -or $env:OS -eq "Windows_NT") { ".exe" } else { "" }
$OutputName = "mai-backend-$Triple$Extension"
$OutputPath = Join-Path $BinariesDir $OutputName

New-Item -ItemType Directory -Force -Path $BinariesDir | Out-Null
Ensure-FrontendDist

if (Test-Path $StagingDir) {
    Remove-Item -LiteralPath $StagingDir -Recurse -Force
}

$PythonExe = Ensure-PyInstaller
Push-Location $Root
try {
    & $PythonExe -m PyInstaller backend\mai-backend.spec --noconfirm --distpath $StagingDir
}
finally {
    Pop-Location
}

$BuiltExe = Join-Path $StagingDir "mai-backend$Extension"
if (-not (Test-Path $BuiltExe)) {
    throw "PyInstaller did not produce $BuiltExe"
}

Copy-Item -Force $BuiltExe $OutputPath
Write-Host "Sidecar ready: $OutputPath"
