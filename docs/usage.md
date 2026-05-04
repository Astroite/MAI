# MAI 使用与打包安装指南

本文面向本地开发、交付打包和部署安装。产品与技术背景见 `product_design.md` 与 `technical_design.md`。

## 1. 运行要求

- Python 3.12
- Node.js 20+
- pnpm 10+
- PostgreSQL 15+，本地默认连接为：

```text
postgresql+asyncpg://mai:mai_dev_password@localhost:5432/mai
```

后端默认启用 `MOCK_LLM=true`，不需要任何模型 API Key 即可跑完整 mock 流程。

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

使用本机 PostgreSQL：

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

## 4. 本地开发运行

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

## 5. 常用使用流程

1. 打开 Dashboard。
2. 创建一个 Room，选择内置配方或赛制。
3. 在 Room 中追加用户消息，或拖入 MD/TXT/PDF 文档。
4. 选择下一位 persona 发言，mock 模式会返回确定性回复。
5. 使用 Phase 面板切换阶段，或在触发退出条件后按横幅进入下一阶段。
6. 使用 Judge 模式写入裁决，必要时锁定或撤销决议。
7. 使用 Masquerade 模式以某个 discussant 身份投放观点。
8. 使用 Ask Facilitator 查看副手信号。
9. 对独立争议创建子讨论，结束后 merge back 到父房间。
10. 使用 Freeze 立即取消 in-flight 调用并冻结房间；之后可 Unfreeze 继续。

## 6. 使用真实 LLM

编辑 `backend/.env`：

```text
MOCK_LLM=false
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
```

然后创建或编辑 persona，让 `backing_model` 使用 LiteLLM 兼容模型名，例如：

```text
openai/<model-name>
anthropic/<model-name>
gemini/<model-name>
```

内置 persona 使用 `mock/...` model。即使 `MOCK_LLM=false`，`mock/...` persona 仍会使用本地确定性输出，方便混合测试。

## 7. 打包

建议把前端静态产物和后端应用代码分别打包，运行时再安装 Python 依赖并配置 `.env`。

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
DATABASE_URL=postgresql+asyncpg://mai:mai_dev_password@localhost:5432/mai
MOCK_LLM=true
TRACE_PAYLOAD_DIR=trace_payloads
UPLOAD_DIR=uploads
```

初始化数据库并启动：

```bash
python -m app.init_db
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

前端产物 `release/frontend/dist` 可用任意静态服务器托管。Nginx 示例：

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

后端测试需要 PostgreSQL 已启动，且 `DATABASE_URL` 指向可写测试数据库：

```bash
cd backend
source .venv/bin/activate
pytest -q
```

Windows PowerShell：

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pytest -q
```

## 10. 常见问题

| 现象 | 处理 |
|---|---|
| `/health` 报数据库错误 | 确认 PostgreSQL 已启动，`DATABASE_URL` 的用户、密码、库名正确 |
| `pytest` 全部在 startup 阶段失败 | 通常是测试数据库未启动或端口 5432 不可达 |
| 前端请求 404 | 开发模式确认 Vite proxy 生效；生产模式确认 `/api` 被反向代理到后端 |
| 真实模型仍返回 mock 文本 | 确认 `MOCK_LLM=false`，且所选 persona 的 `backing_model` 不以 `mock/` 开头 |
| LiteLLM 认证失败 | 检查对应 provider API Key 是否写入 `backend/.env`，然后重启后端 |
| 前端构建出现 chunk size warning | 当前 Markdown/KaTeX/Shiki 包较大，这是警告不是失败；需要优化时再做按需加载 |

