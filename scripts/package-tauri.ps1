param(
    [string]$TargetTriple = "",
    [switch]$SkipSidecarBuild
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$FrontendDir = Join-Path $Root "frontend"

if (-not $SkipSidecarBuild) {
    & (Join-Path $PSScriptRoot "build-sidecar.ps1") -TargetTriple $TargetTriple
}

Push-Location $FrontendDir
try {
    pnpm tauri build
}
finally {
    Pop-Location
}
