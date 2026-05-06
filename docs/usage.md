# MAI 使用与打包安装指南

本文面向本地开发、交付打包和部署安装。产品与技术背景见 `product_design.md` 与 `technical_design.md`。

## 1. 运行要求

- Python 3.12+（已在 3.13 上验证）
- Node.js 20+
- pnpm 10+

桌面壳打包还需要：

- Rust stable / Cargo
- Microsoft C++ Build Tools（Windows 上需要 MSVC linker）
- Microsoft Edge WebView2 Runtime

完整清单见 `desktop_tauri.md`。

数据库默认使用 SQLite，文件落在：

- 开发模式：`backend/mai.sqlite3`
- 打包模式（设置环境变量 `MAI_PACKAGED=1` 或由 PyInstaller `sys.frozen` 触发）：
  - Windows：`%APPDATA%\MAI\mai.sqlite3`
  - macOS：`~/Library/Application Support/MAI/mai.sqlite3`
  - Linux：`$XDG_DATA_HOME/MAI/mai.sqlite3`，未设置则 `~/.local/share/MAI/mai.sqlite3`

如果要换成 PostgreSQL，在 `backend/.env` 里取消注释并填好 `DATABASE_URL`：

```text
DATABASE_URL=postgresql+asyncpg://mai:mai_dev_password@localhost:5432/mai
```

所有 LLM 调用都走 LiteLLM。启动前需要在 `backend/.env` 配 provider key（如 `OPENAI_API_KEY`），或在 UI 设置页创建 ApiProvider 并绑定到 persona。内置 persona 默认 `backing_model=openai/gpt-4o-mini`。

## 2. 获取代码

```bash
git clone https://github.com/Astroite/MAI.git
cd MAI
```

如果已经有本地仓库：

```bash
git pull --ff-only origin main
```

## 3. 准备数据库

默认 SQLite 不需要任何额外准备 —— 第一次启动后端时 `python -m app.init_db` 会自己建表、写入 built-ins，文件落到上一节列出的位置即可。

只有在 `backend/.env` 中显式把 `DATABASE_URL` 切到 PostgreSQL 时，才需要准备数据库：

```sql
CREATE USER mai WITH PASSWORD 'mai_dev_password';
CREATE DATABASE mai OWNER mai;
```

也可以用 Docker 快速启动一个开发库：

```bash
docker run --name mai-postgres \
  -e POSTGRES_USER=mai \
  -e POSTGRES_PASSWORD=mai_dev_password \
  -e POSTGRES_DB=mai \
  -p 5432:5432 \
  -d postgres:16
```

仓库里的 `infra/docker-compose.yml` 也是同一份 PG 配置，留给希望复用现有 Postgres 实例的开发者；用 SQLite 时可以忽略。

## 4. 本地开发运行

### 4.0 一键启动

Windows PowerShell：

```powershell
.\scripts\dev.ps1
```

这个脚本会：

- 如果 `backend/.env` 不存在，则从 `.env.example` 创建（默认就是 SQLite）。
- 创建后端 `.venv`，安装 Python 依赖，执行 `python -m app.init_db`。
- 安装前端依赖。
- 分别打开后端和前端开发服务窗口。
- 如果存在 Docker，会顺手用 `infra/docker-compose.yml` 启动本地 PostgreSQL；用 SQLite 不需要它，加 `-SkipPostgres` 跳过。

常用参数：

```powershell
.\scripts\dev.ps1 -SkipPostgres
.\scripts\dev.ps1 -SkipInstall
.\scripts\dev.ps1 -SkipDbInit
.\scripts\dev.ps1 -BackendPort 8001 -FrontendPort 5174
```

### 4.1 后端

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m app.init_db
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Windows PowerShell 对应命令：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python -m app.init_db
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

后端健康检查：

```bash
curl http://127.0.0.1:8000/health
```

### 4.2 前端

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm dev --host 0.0.0.0 --port 5173
```

打开：

```text
http://localhost:5173
```

开发模式下，Vite 会把 `/api` 代理到 `http://127.0.0.1:8000`。

### 4.3 单进程托管（不开 Vite）

`pnpm build` 之后，FastAPI 自己也能托管已构建的前端，适合本地完整跑一遍生产形态：

```bash
cd frontend && pnpm build
cd ../backend && uvicorn app.main:app --host 127.0.0.1 --port 8000
# 浏览器打开 http://127.0.0.1:8000
```

当 `frontend/dist/index.html` 存在（或环境变量 `MAI_FRONTEND_DIST` 指向已构建目录）时，后端会自动把 SPA 挂在 `/`，并对未匹配的路径回落到 `index.html`。同一份后端还会把进来的 `/api/...` 在中间件里去掉前缀再路由，所以前端不需要改 `VITE_API_BASE` 就能用。

## 5. 常用使用流程

1. 打开 Dashboard。
2. 创建一个 Room，选择内置配方或赛制。
3. 在 Room 中追加用户消息，或拖入 MD/TXT/PDF 文档。
4. 发送用户消息后，后端会自动驱动下一位 persona 回复；也可以通过接口显式指定下一位 persona。
5. 使用 Phase 面板切换阶段，或在触发退出条件后按横幅进入下一阶段。
6. 使用 Judge 模式写入裁决，必要时锁定或撤销决议。
7. 使用群友发言模式，以一个新增群友昵称投放观点；复盘时仍可揭示该消息由用户投放。
8. 使用 Ask Facilitator 查看副手信号。
9. 对独立争议创建子讨论，结束后 merge back 到父房间。
10. 使用 Freeze 立即取消 in-flight 调用并冻结房间；之后可 Unfreeze 继续。

## 6. 配置 LLM 凭据

所有 LLM 调用都通过 LiteLLM。两种凭据来源：

**A. ApiProvider（推荐，桌面版默认方式）**

1. 打开 `设置`。
2. 在 API 配置里新增一个 provider，填入 API Key，必要时填 API Base。
3. 打开 `模板 -> 人设`，编辑或新建人设。
4. 把 `Backing Model` 改成 LiteLLM 模型名，例如 `openai/gpt-4o-mini`、`anthropic/claude-sonnet-4-5`、`gemini/gemini-1.5-pro`。
5. 在 `API 配置` 下拉框选择刚才保存的 provider。

绑定 provider 的人设调用时会用 provider 上的 key/base，覆盖环境变量默认值。

**B. 环境变量（开发模式简便）**

在 `backend/.env` 里直接填：

```text
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
```

任何未绑定 ApiProvider 的人设会回退到这些环境变量。

key 选哪一个由 persona 的 `backing_model` 前缀决定：

```text
openai/<model-name>      -> OPENAI_API_KEY
anthropic/<model-name>   -> ANTHROPIC_API_KEY
gemini/<model-name>      -> GEMINI_API_KEY
```

内置 persona 全部使用 `openai/gpt-4o-mini`；fork 一份就可以换成任意 LiteLLM 模型。

## 7. 打包

建议把前端静态产物和后端应用代码分别打包，运行时再安装 Python 依赖并配置 `.env`。

### 7.0 一键打包

Windows PowerShell：

```powershell
.\scripts\package.ps1 -Version v0.1.0
```

脚本会安装前端依赖、执行 `pnpm build`，然后生成：

```text
release/mai-v0.1.0.zip
release/mai-v0.1.0.zip.sha256
release/mai-v0.1.0/
```

常用参数：

```powershell
.\scripts\package.ps1 -Version v0.1.0 -SkipInstall
.\scripts\package.ps1 -Version v0.1.0 -SkipFrontendBuild
.\scripts\package.ps1 -OutputDir artifacts
```

### 7.1 前端打包

如需指定生产 API 地址，先设置 `VITE_API_BASE`：

```bash
cd frontend
pnpm install --frozen-lockfile
VITE_API_BASE=https://api.example.com pnpm build
```

Windows PowerShell：

```powershell
cd frontend
pnpm install --frozen-lockfile
$env:VITE_API_BASE="https://api.example.com"
pnpm build
```

产物目录：

```text
frontend/dist/
```

如果前后端同域部署，并由反向代理把 `/api` 转发到后端，可以不设置 `VITE_API_BASE`，前端会默认请求 `/api`。

### 7.2 后端打包

最小后端发布内容：

```text
backend/app/
backend/requirements.txt
backend/.env.example
backend/pytest.ini
```

不应打包：

```text
backend/.env
backend/.venv/
backend/trace_payloads/
backend/uploads/
frontend/node_modules/
frontend/dist/       # 单独作为前端产物发布
```

PowerShell 示例：

```powershell
New-Item -ItemType Directory -Force -Path release\backend, release\frontend | Out-Null
Copy-Item -Recurse backend\app release\backend\app
Copy-Item backend\requirements.txt release\backend\
Copy-Item backend\.env.example release\backend\
Copy-Item backend\pytest.ini release\backend\
Copy-Item -Recurse frontend\dist release\frontend\dist
Compress-Archive -Path release\* -DestinationPath mai-release.zip -Force
```

Linux/macOS 示例：

```bash
rm -rf release mai-release.tar.gz
mkdir -p release/backend release/frontend
cp -R backend/app release/backend/app
cp backend/requirements.txt backend/.env.example backend/pytest.ini release/backend/
cp -R frontend/dist release/frontend/dist
tar -czf mai-release.tar.gz -C release .
```

### 7.3 Tauri 桌面壳打包

桌面壳使用 Tauri v2 承载已构建的 React SPA，并通过 PyInstaller sidecar 启动 FastAPI 后端。前端启动时由 Tauri 注入 `window.__MAI_API_BASE__`，指向 sidecar 监听的本地临时端口，因此不需要固定占用 8000 端口。

首次打包前按 `desktop_tauri.md` 安装 Rust/Cargo、Microsoft C++ Build Tools 和 WebView2 Runtime，然后执行：

```powershell
cd frontend
pnpm install
pnpm tauri --version
cd ..
```

先验证常规构建：

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
cd ..\frontend
pnpm build
cd ..
```

构建 sidecar：

```powershell
.\scripts\build-sidecar.ps1 -TargetTriple x86_64-pc-windows-msvc
```

构建安装包：

```powershell
.\scripts\package-tauri.ps1 -TargetTriple x86_64-pc-windows-msvc -SkipSidecarBuild
```

也可以一条命令完成 sidecar 与 Tauri 打包：

```powershell
.\scripts\package-tauri.ps1 -TargetTriple x86_64-pc-windows-msvc
```

安装包输出位置：

```text
frontend/src-tauri/target/release/bundle/nsis/
```

## 8. 从打包产物安装

解压后端产物并安装：

```bash
cd release/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

编辑 `.env`，至少确认：

```text
# 默认 SQLite。要切到 PostgreSQL，则取消下面这行注释并修改：
# DATABASE_URL=postgresql+asyncpg://mai:mai_dev_password@localhost:5432/mai
TRACE_PAYLOAD_DIR=trace_payloads
UPLOAD_DIR=uploads
# Provider 凭据（可选）：未绑定 ApiProvider 的人设会回退到这些环境变量。
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
```

初始化数据库并启动：

```bash
python -m app.init_db
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

部署有两种形态：

**A. 单进程托管（推荐用于桌面打包/小规模部署）：** 把前端构建产物放到后端能找到的位置，FastAPI 自己同时服务 SPA 与 API。最简单的方式是把 `frontend/dist` 复制到 `backend/frontend_dist/`（或设置 `MAI_FRONTEND_DIST` 环境变量），然后只跑后端：

```bash
cp -R release/frontend/dist release/backend/frontend_dist
cd release/backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
# 直接访问 http://<host>:8000，前端的 /api/... 调用由内置中间件去前缀后命中后端路由
```

**B. 前后端分开（适合反向代理多副本部署）：** 用任意静态服务器托管 `release/frontend/dist`，并把 `/api/` 反向代理到后端。Nginx 示例：

```nginx
server {
  listen 80;
  server_name mai.example.com;

  root /opt/mai/frontend/dist;
  index index.html;

  location / {
    try_files $uri /index.html;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:8000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

## 9. 验证

前端构建：

```bash
cd frontend
pnpm build
```

后端测试需要真实 LLM 凭据。先在 `backend/tests/.env.test` 写入：

```text
OPENAI_API_KEY=<你的 token>
# 走代理时再加：
# OPENAI_API_BASE=https://api.example.com/v1
```

`tests/.env.test` 已被 `.gitignore` 排除。`conftest.py` 在 import 前加载它；缺少 `OPENAI_API_KEY` 时 pytest 会立刻退出并报清晰的提示。

```bash
cd backend
source .venv/bin/activate
pytest -q
```

如果 `.env` 里把 `DATABASE_URL` 切到了 PostgreSQL，需要确认目标库已启动并可写。

Windows PowerShell：

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pytest -q
```

跑全套用 `gpt-4o-mini` 大约耗时 1–3 分钟，调用成本可忽略。如果只想快速验证某一组：

```bash
pytest -q tests/test_health.py
pytest -q tests/test_engine.py::test_pick_next_speaker_ordering_rules
```

## 10. 常见问题

| 现象 | 处理 |
|---|---|
| `/health` 报数据库错误 | SQLite：检查 `mai.sqlite3` 所在目录可写；PostgreSQL：确认服务已启动且 `DATABASE_URL` 用户、密码、库名正确 |
| `pytest` 全部在 startup 阶段失败 | 默认 SQLite 不应失败；用 PG 时通常是 5432 不可达或测试库未建 |
| `pytest` 第一句报 `OPENAI_API_KEY` 缺失 | 测试需要真实 LLM 凭据；在 `backend/tests/.env.test` 写入 token，详见 §9 |
| 切到 PG 后 startup 报 `Type "jsonb" does not exist` | 旧 PG 版本不支持 JSONB；MAI 需要 PostgreSQL 9.4+，建议直接用 15+ |
| 前端请求 404 | 开发模式确认 Vite proxy 生效；生产模式确认 `/api` 被反向代理到后端 |
| LiteLLM 认证失败 | 检查设置页里的 API Key / API Base，或检查 `backend/.env` 里的 provider 环境变量并重启后端 |
| 前端构建出现 chunk size warning | 当前 Markdown/KaTeX/Shiki 包较大，这是警告不是失败；需要优化时再做按需加载 |
| 单进程托管时打开 `/` 返回 API JSON 或 404 | `frontend/dist/index.html` 不存在；先跑 `pnpm build`，或把 `MAI_FRONTEND_DIST` 指向已构建目录 |
| `rustc` 不是可识别命令 | 安装 Rust/Cargo，重新打开 PowerShell，再执行 `rustc --version` |
| Tauri 打包报 `link.exe` / MSVC linker 缺失 | 安装 Visual Studio Build Tools 2022，并勾选 C++ 桌面开发工作负载 |
| `pnpm tauri` 不存在 | 在 `frontend/` 执行 `pnpm install`，不要依赖全局 tauri CLI |
| 桌面应用启动后 API 不通 | 先确认 sidecar 已构建；Tauri 会注入 `window.__MAI_API_BASE__`，前端应请求本地临时端口 |

## 11. GitHub Release 发布

仓库已提供 GitHub Actions 工作流：

```text
.github/workflows/release.yml
```

它会在发布时执行：

1. 启动 PostgreSQL service。
2. 安装后端依赖并运行 `python -m app.init_db` 与 `pytest -q`。
3. 安装前端依赖并运行 `pnpm build`。
4. 打包 `backend/app`、后端依赖文件、`frontend/dist`、`docs`、`README.md`。
5. 生成 `.zip`、`.tar.gz` 和 `SHA256SUMS.txt`。
6. 创建或更新 GitHub Release，并上传产物。

### 11.1 用 tag 自动发布

```bash
git tag v0.1.0
git push origin v0.1.0
```

推送匹配 `v*.*.*` 的 tag 后，GitHub Actions 会自动创建名为 `v0.1.0` 的 Release。

### 11.2 手动发布

1. 打开 GitHub 仓库页面。
2. 进入 `Actions`。
3. 选择 `Release` workflow。
4. 点击 `Run workflow`。
5. 填入版本号，例如 `v0.1.0`。

### 11.3 权限要求

`release.yml` 已声明：

```yaml
permissions:
  contents: write
```

如果组织或仓库禁用了 Actions 写权限，需要在 GitHub 仓库中打开：

```text
Settings -> Actions -> General -> Workflow permissions -> Read and write permissions
```

### 11.4 发布产物

Release 页面会出现：

```text
mai-v0.1.0.zip
mai-v0.1.0.tar.gz
SHA256SUMS.txt
```

下载后按第 8 节安装即可。
