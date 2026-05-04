param(
    [string]$Version = "",
    [string]$OutputDir = "release",
    [switch]$SkipInstall,
    [switch]$SkipFrontendBuild
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$ReleaseRoot = [System.IO.Path]::GetFullPath((Join-Path $Root $OutputDir))

if ([string]::IsNullOrWhiteSpace($Version)) {
    $GitVersion = ""
    try {
        $GitVersion = (git -C $Root describe --tags --always --dirty).Trim()
    }
    catch {
        $GitVersion = ""
    }
    if ([string]::IsNullOrWhiteSpace($GitVersion)) {
        $GitVersion = Get-Date -Format "yyyyMMdd-HHmmss"
    }
    $Version = $GitVersion
}

$PackageName = "mai-$Version"
if ($Version -match '[<>:"/\\|?*]') {
    throw "Version must be a file-name-safe value such as v0.1.0."
}

$RootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd([char[]]@([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar))
if (-not $ReleaseRoot.StartsWith("$RootFull$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputDir must resolve inside the repository root."
}

$Stage = Join-Path $ReleaseRoot $PackageName
$BackendStage = Join-Path $Stage "backend"
$FrontendStage = Join-Path $Stage "frontend"
$ArchivePath = Join-Path $ReleaseRoot "$PackageName.zip"
$ChecksumPath = "$ArchivePath.sha256"

function Has-Command($Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Build-Frontend {
    if ($SkipFrontendBuild) {
        Write-Host "Skipping frontend build."
        return
    }
    if (-not (Has-Command "pnpm")) {
        throw "pnpm is required to build the frontend."
    }
    Push-Location $FrontendDir
    try {
        if (-not $SkipInstall) {
            pnpm install --frozen-lockfile
        }
        pnpm build
    }
    finally {
        Pop-Location
    }
}

function Copy-ReleaseFiles {
    if (Test-Path $Stage) {
        Remove-Item -Recurse -Force $Stage
    }
    New-Item -ItemType Directory -Force -Path $BackendStage, $FrontendStage | Out-Null

    Copy-Item -Recurse (Join-Path $BackendDir "app") (Join-Path $BackendStage "app")
    Copy-Item (Join-Path $BackendDir "requirements.txt") $BackendStage
    Copy-Item (Join-Path $BackendDir ".env.example") $BackendStage
    Copy-Item (Join-Path $BackendDir "pytest.ini") $BackendStage

    if (-not (Test-Path (Join-Path $FrontendDir "dist"))) {
        throw "frontend/dist does not exist. Run without -SkipFrontendBuild or build the frontend first."
    }
    Copy-Item -Recurse (Join-Path $FrontendDir "dist") (Join-Path $FrontendStage "dist")

    Copy-Item (Join-Path $Root "README.md") $Stage
    Copy-Item (Join-Path $Root "CLAUDE.md") $Stage
    Copy-Item -Recurse (Join-Path $Root "docs") (Join-Path $Stage "docs")
}

function Write-Archive {
    if (Test-Path $ArchivePath) {
        Remove-Item -Force $ArchivePath
    }
    Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $ArchivePath -Force
    $Hash = Get-FileHash -Algorithm SHA256 $ArchivePath
    "$($Hash.Hash.ToLowerInvariant())  $(Split-Path -Leaf $ArchivePath)" | Set-Content -Encoding ASCII $ChecksumPath
    Write-Host ""
    Write-Host "Package created:"
    Write-Host "  $ArchivePath"
    Write-Host "  $ChecksumPath"
}

New-Item -ItemType Directory -Force -Path $ReleaseRoot | Out-Null
Build-Frontend
Copy-ReleaseFiles
Write-Archive
