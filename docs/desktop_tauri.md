# MAI 桌面壳安装与打包清单

> 当前状态：Tauri v2 壳与 FastAPI PyInstaller sidecar 已接入，Windows NSIS 安装包已在本机完成构建验证；正式无窗口 sidecar 已通过 `/health` 运行时探活。

## 1. 你需要安装的东西

### 1.1 Rust / Cargo

安装 Rust stable 工具链，让 `rustc` 和 `cargo` 进入 PATH。

验证：

```powershell
rustc --version
cargo --version
rustc -Vv
```

如果 `rustc -Vv` 中的 `host` 不是 `x86_64-pc-windows-msvc`，打包时把实际 host triple 传给脚本。

### 1.2 Microsoft C++ Build Tools

Tauri/Rust 在 Windows 上需要 MSVC 链接器。安装 Visual Studio Build Tools 2022，勾选：

- Desktop development with C++
- MSVC v143 x64/x86 build tools
- Windows 10 SDK 或 Windows 11 SDK

如果已经安装完整 Visual Studio 2022，并且有 C++ 桌面开发工作负载，可以跳过。

### 1.3 Microsoft Edge WebView2 Runtime

Tauri 窗口依赖 WebView2。Windows 10/11 大多已经内置；如果启动桌面应用时报 WebView2 缺失，安装 Evergreen WebView2 Runtime。

### 1.4 项目依赖

在仓库根目录执行：

```powershell
cd frontend
pnpm install
pnpm tauri --version
cd ..
```

后端依赖里已经包含 PyInstaller。确认虚拟环境存在并安装依赖：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m app.init_db
cd ..
```

## 2. 打包前验证

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
cd ..\frontend
pnpm build
cd ..
```

当前基线应为：

- 后端测试：`27 passed`
- 前端构建：成功；Vite 可能提示大 chunk warning，这不是失败
- Tauri 构建：成功生成 `frontend/src-tauri/target/release/bundle/nsis/MAI_0.1.0_x64-setup.exe`

## 3. 构建后端 sidecar

通常可以自动检测 Rust target triple：

```powershell
.\scripts\build-sidecar.ps1
```

如果自动检测失败，显式传入 Windows MSVC triple：

```powershell
.\scripts\build-sidecar.ps1 -TargetTriple x86_64-pc-windows-msvc
```

成功后会生成：

```text
frontend/src-tauri/binaries/mai-backend-x86_64-pc-windows-msvc.exe
```

该二进制是构建产物，已被 `.gitignore` 忽略。

## 4. 构建 Tauri 安装包

一条命令构建 sidecar 并打 Tauri 包：

```powershell
.\scripts\package-tauri.ps1 -TargetTriple x86_64-pc-windows-msvc
```

如果刚刚已经构建过 sidecar，可以跳过 sidecar 重建：

```powershell
.\scripts\package-tauri.ps1 -TargetTriple x86_64-pc-windows-msvc -SkipSidecarBuild
```

安装包会出现在：

```text
frontend/src-tauri/target/release/bundle/nsis/
```

## 5. 常见错误

| 现象 | 处理 |
|---|---|
| `rustc` 不是可识别命令 | 安装 Rust，并重新打开 PowerShell |
| `link.exe` 或 MSVC linker 缺失 | 安装 Visual Studio Build Tools 2022 的 C++ 桌面开发工作负载 |
| `pnpm tauri` 不存在 | 在 `frontend/` 重新执行 `pnpm install` |
| 找不到 `mai-backend-<triple>.exe` | 先运行 `.\scripts\build-sidecar.ps1 -TargetTriple x86_64-pc-windows-msvc` |
| 桌面应用启动后白屏或 API 不通 | 检查 sidecar 是否启动；Tauri 壳会向前端注入 `window.__MAI_API_BASE__` 指向本地临时端口 |
| `ModuleNotFoundError: No module named 'app'` | 重新构建 sidecar；`mai_backend_main.py` 必须直接导入 `app.main`，`mai-backend.spec` 必须显式收集 `app.*` |
| 提示 WebView2 缺失 | 安装 Microsoft Edge WebView2 Evergreen Runtime |
