# MAI - 多模型协作讨论平台

MAI 是一个本地优先的多模型协作讨论工具：用户创建讨论室，拉入多个 AI 人设，按阶段和赛制推进讨论，并由书记官、主持信号、裁决与子讨论机制沉淀可追溯结论。

当前形态已经从早期原型收敛为：

- FastAPI 单进程后端，默认 SQLite，本地文件即可运行；PostgreSQL 仍可通过 `DATABASE_URL` 启用。
- Vite + React + TypeScript 前端，支持中英文切换、暗色模式、Markdown/KaTeX/Shiki 渲染。
- Tauri v2 桌面壳，使用 PyInstaller sidecar 自动启动后端。
- LiteLLM 统一模型调用。API 配置拆成三层：供应商 vendor、LiteLLM provider、具体 model。
- 模板系统已稳定：内置模板只读；用户点击“添加”时从内置库复制一份可编辑实例；人设、阶段、赛制、配方页里的卡片都按可编辑实例管理。
- 新增 AgentVerse 启发的能力扩展层：内置工具、MCP server 注册与同步、成员级工具权限、场景化一键开房、模板 AI 起草。

## 快速开始

Windows 一键开发启动：

```powershell
.\scripts\dev.ps1 -SkipPostgres
```

脚本会创建后端 `.venv`、安装依赖、初始化数据库、安装前端依赖，并分别启动后端和前端开发服务。

手动启动后端：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python -m app.init_db
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

手动启动前端：

```powershell
cd frontend
pnpm install
pnpm dev --host 0.0.0.0 --port 5173
```

打开：

```text
http://localhost:5173
```

开发模式下，Vite 会把 `/api` 代理到 `http://127.0.0.1:8000`。

## 配置模型

推荐通过 UI 配置，不再直接在人设里手写一个裸模型名。

1. 打开 `模板 -> API 配置`。
2. 新建 API 配置，填写：
   - `供应商 vendor`：面向用户的归类，例如 OpenAI、Anthropic、OpenRouter、Local。
   - `Provider`：LiteLLM 路由名，例如 `openai`、`anthropic`、`gemini`、`openrouter`。
   - API Key 与可选 API Base。
3. 在该 API 配置下添加一个或多个模型，填写显示名称和 LiteLLM 模型名，例如 `openai/gpt-4o-mini`。
4. 打开 `设置`，选择默认模型。
5. 在 `模板 -> 人设` 或房间成员编辑器中，为具体人设选择模型；留空则使用设置页默认模型。

环境变量仍适合开发兜底：

```text
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
```

未绑定模型的人设会优先使用设置页默认模型；旧的 `backing_model + api_provider_id` 字段仍保留用于兼容和迁移，但新 UI 以 `api_model_id` 为主。

## 模板工作流

`app/seed.py` 里定义的内置人设、阶段、赛制和配方是只读内容。

- 默认列表显示用户自己的可编辑实例。
- 点击“添加”会打开内置库，从内置模板复制一份。
- 复制出来的条目可修改、删除、导出。
- 阶段的 `ordering_rule`、`allowed_speakers`、`exit_conditions` 等内部标记在 UI 中会显示为用户友好的中英文标签。
- 模板支持 tag 过滤，赛制支持拖拽排序阶段。

## 工具与 MCP

房间右侧 `工具` 面板提供两类工具：

- MAI 内置工具：搜索房间消息、列出房间成员，以及可选的模板创建工具。
- 外部 MCP server：支持 `streamable_http` 和 `sse` 传输，添加 server 后点击同步会读取工具清单。

成员是否能调用工具由房间成员编辑器控制：

- `允许工具`：该成员的 LLM 调用会带上可用工具定义。
- `允许写入工具`：允许调用会修改 MAI 数据的工具；未开启时只暴露只读工具。
- `允许自动回复`：关闭后，自动调度会跳过该成员，但用户仍可手动点名。

工具调用会以 `tool_invocation` 消息追加进房间，并在房间状态里返回完整调用记录，方便复盘和审计。

## 场景与模板起草

首页新建房间支持场景卡片，例如技术方案评审、产品决策圆桌、头脑风暴和假设压力测试。场景会预填房间标题、初始问题、赛制或配方；创建后可自动发送第一条消息。

模板页的人设编辑器新增 `AI 起草`，可用自然语言生成一个可编辑的人设草稿。后端接口同时保留了 phase / recipe 草稿类型，便于后续扩展到更多模板。

## 单进程托管

前端构建后，后端可以直接托管 SPA，不需要单独启动 Vite：

```powershell
cd frontend
pnpm build
cd ..\backend
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

当 `frontend/dist/index.html` 存在、`MAI_FRONTEND_DIST` 指向构建目录，或 PyInstaller 包中存在 `frontend-dist` 时，`app.main` 会把前端挂载到 `/`，并把前端请求的 `/api/...` 重写到后端根路由。

## 验证

前端：

```powershell
cd frontend
pnpm build
```

Vite 可能提示 Markdown/KaTeX/Shiki 相关 chunk 较大，这是 warning，不是失败。

后端：

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pytest -q
```

测试会调用真实 LLM。请在 `backend/tests/.env.test` 写入 `OPENAI_API_KEY`；缺少 key 时测试会直接给出清晰提示并退出。

## 打包

普通 release 包：

```powershell
.\scripts\package.ps1 -Version v0.1.0
```

桌面安装包：

```powershell
.\scripts\build-sidecar.ps1
.\scripts\package-tauri.ps1
```

桌面打包需要 Rust/Cargo、Microsoft C++ Build Tools 和 WebView2 Runtime，详见 `docs/desktop_tauri.md`。

## 运行时数据

默认 SQLite 与本地数据路径：

- 开发模式：`backend/mai.sqlite3`
- 打包模式：系统用户数据目录下的 `MAI/mai.sqlite3`

上传和 trace：

- 开发模式：`backend/uploads/`、`backend/trace_payloads/`
- 打包模式：用户数据目录下的 `MAI/uploads/`、`MAI/trace_payloads/`

这些运行时文件都被 Git 忽略。

## 文档

- `docs/usage.md`：本地运行、模型配置、打包、安装与常见问题。
- `docs/product_design.md`：稳定后的产品概念和边界。
- `docs/technical_design.md`：当前架构、数据模型和前后端契约。
- `docs/progress.md`：当前实现状态快照。
- `docs/desktop_tauri.md`：桌面壳依赖与打包清单。
