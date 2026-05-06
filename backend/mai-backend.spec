# PyInstaller spec for the MAI backend sidecar.
#
# Build with (run from the repo root):
#   pyinstaller backend/mai-backend.spec --noconfirm --distpath frontend/src-tauri/binaries/staging
#
# Then `scripts/build-sidecar.ps1` renames the produced exe to the
# `mai-backend-<rust-target-triple>` form Tauri's sidecar feature expects.
#
# Notes on hidden imports:
#   - litellm pulls provider modules dynamically by string -> --collect-all
#   - tiktoken vendors data files for tokenizers
#   - sqlalchemy.dialects.sqlite.aiosqlite is loaded by SQLAlchemy via a string
#   - uvicorn protocol handlers are dispatched dynamically in the lifespan/server
#   - aiosqlite + pypdf are imported lazily

# pyright: reportUndefinedVariable=false
# ruff: noqa
from __future__ import annotations

from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules


backend_root = Path(SPECPATH).resolve()
repo_root = backend_root.parent
frontend_dist = repo_root / "frontend" / "dist"

datas = []
binaries = []
hiddenimports: list[str] = []

# litellm has a maze of optional providers it imports by string at runtime.
for module_name in ("litellm", "tiktoken", "tiktoken_ext"):
    pkg_datas, pkg_binaries, pkg_hidden = collect_all(module_name)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hidden

hiddenimports += [
    *collect_submodules("app"),
    "aiosqlite",
    "sqlalchemy.dialects.sqlite.aiosqlite",
    "pypdf",
    # uvicorn's lifespan and protocol modules are wired up by string lookup.
    *collect_submodules("uvicorn"),
    "starlette.middleware.cors",
    "starlette.middleware.errors",
    "starlette.middleware.exceptions",
]

# Bundle the built SPA so the FastAPI static-mount path resolves inside the
# packaged binary (see app/main.py::_resolve_frontend_dist; we also expose the
# directory via the MAI_FRONTEND_DIST env var from the Tauri shell).
if frontend_dist.exists() and (frontend_dist / "index.html").exists():
    datas.append((str(frontend_dist), "frontend-dist"))


a = Analysis(
    [str(backend_root / "mai_backend_main.py")],
    pathex=[str(backend_root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        "pytest",
        "pytest_asyncio",
        "tests",
        "IPython",
        "matplotlib",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=None,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=None)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="mai-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # no console window when launched by the Tauri shell
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
