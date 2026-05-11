# MAI - 本地优先的 AI 故事导演台

MAI 当前的主方向是 **Story World / 故事世界**：用户创建世界、设定角色、开启一幕场景，让多个 AI 角色在同一世界中持续互动；用户可以用旁白推进剧情，也可以扮演某个用户角色介入。每幕封幕后，系统会把角色经历折叠成记忆、关系印象和承诺，带入下一幕。

MAI 仍保留 **Discussion Room / 讨论室** 作为第二条主线：多个 AI 人设按阶段和赛制围绕问题进行结构化讨论，由书记官、主持信号、裁决和子讨论沉淀可追溯结论。

## 产品主线

### Story World

- World：跨房间的世界观容器，保存 synopsis、setting、时间提示和角色集合。
- Character：AI / 用户角色档案，包含身份、目标、技能、外观和跨场景记忆。
- Scene：一幕戏，本质上是带 `world_id` 和 `scene_index` 的 Room。
- Memory：封幕后写入 episodic 记忆、角色关系印象和承诺，下一幕按 salience 检索入 prompt。
- Composer：支持旁白和扮演模式，用户既可以做导演，也可以亲自上场。

### Discussion Room

- 阶段、赛制、配方：控制多 AI 发言范围、顺序、退出条件和自动讨论节奏。
- 多 AI peer 路由：每个 AI 只把自己的历史看作 `assistant`，其他角色发言会改写为带名字的 `user` 消息，避免全知叙述者退化。
- Scribe / Facilitator：书记官折叠共识、分歧、问题和产物；主持信号只面向用户，帮助判断节奏。
- Freeze / Pause：用户拥有停止、恢复、阶段推进和模型配置的最终控制权。
- Tools / MCP：房间成员可按权限调用内置工具或外部 MCP server，调用记录进入消息流审计。

## 工程形态

- FastAPI 单进程后端，默认 SQLite（WAL + 长 busy timeout），可选 PostgreSQL。
- Vite + React + TypeScript 前端，支持中英文切换、暗色模式、Markdown/KaTeX/Shiki 渲染。
- Tauri v2 桌面壳，使用 PyInstaller sidecar 自动启动本地后端。
- LiteLLM 统一模型调用；API 配置拆成 Provider（凭据 + 路由）和 Model（具体模型）。
- 模板系统稳定：内置模板只读，用户从内置库复制后得到可编辑实例；人设带主题色和图标。
- 能力扩展层：内置工具、MCP server 注册与同步、成员级工具权限、模板 AI 起草。

## 快速开始

完整产品、架构、运行和设计文档见 [`docs/README.md`](docs/README.md)。

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
uvicorn app.main:app --reload --host 0.0.0.0 --port 47821
```

需要跑后端测试或构建桌面 sidecar 时，安装开发依赖：

```powershell
pip install -r requirements-dev.txt
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

开发模式下，Vite 会把 `/api` 代理到 `http://127.0.0.1:47821`。

## 配置模型

推荐通过 UI 配置，不再直接在人设里手写一个裸模型名。

1. 打开 `模板 -> API 配置`。
2. 新建 API 配置，填写：
   - `名称`：用户可读的标签，例如 "我的 OpenAI"。
   - `类型`：LiteLLM 路由，从 `openai` / `anthropic` / `gemini` / `openrouter` / `azure` / `custom` 中选一个。
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

## Story World 与讨论室入口

首页优先呈现 Story World 导演台：最近世界、最近一幕、角色近况和继续入口。用户可以从世界页创建角色、开启新 Scene，并在房间内用旁白或扮演模式推进剧情。

讨论室仍作为结构化多 AI 协作入口保留。新建房间支持场景卡片，例如技术方案评审、产品决策圆桌、头脑风暴和假设压力测试。场景会预填房间标题、初始问题、赛制或配方；创建后可自动发送第一条消息。

模板页的人设编辑器新增 `AI 起草`，可用自然语言生成一个可编辑的人设草稿。后端接口同时保留了 phase / recipe 草稿类型，便于后续扩展到更多模板。

## 单进程托管

前端构建后，后端可以直接托管 SPA，不需要单独启动 Vite：

```powershell
cd frontend
pnpm build
cd ..\backend
uvicorn app.main:app --host 127.0.0.1 --port 47821
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
pip install -r requirements-dev.txt
pytest -q
```

测试会调用真实 LLM。请在 `backend/tests/.env.test` 写入 `OPENAI_API_KEY`；缺少 key 时测试会直接给出清晰提示并退出。
默认测试数据库是 `backend/tests/.runtime/mai_test.sqlite3`，每次测试会清理重建，不会污染开发库 `backend/mai.sqlite3`。如果要测试 PostgreSQL 或其他数据库，请在 `.env.test` 里显式写入 `DATABASE_URL`。

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

桌面打包需要 Rust/Cargo、Microsoft C++ Build Tools 和 WebView2 Runtime，详见 [`docs/ops/desktop_tauri.md`](docs/ops/desktop_tauri.md)。

## 运行时数据

默认 SQLite 与本地数据路径：

- 开发模式：`backend/mai.sqlite3`
- 打包模式：系统用户数据目录下的 `MAI/mai.sqlite3`

上传和 trace：

- 开发模式：`backend/uploads/`、`backend/trace_payloads/`
- 打包模式：用户数据目录下的 `MAI/uploads/`、`MAI/trace_payloads/`

这些运行时文件都被 Git 忽略。

## 文档

文档入口见 [`docs/README.md`](docs/README.md)。常用阅读顺序：

- 产品语义：`docs/product/product_design.md`、`docs/product/story_world.md`
- 实现约束：`docs/architecture/technical_design.md`
- 本地运行与打包：`docs/ops/usage.md`、`docs/ops/desktop_tauri.md`
- 当前状态：`docs/status.md`
- 工程复盘：`docs/engineering/`
- 历史概念稿：`docs/archive/`
