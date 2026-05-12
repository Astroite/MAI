# MAI 使用、配置与打包指南

本文面向本地开发、日常使用、交付打包和安装排障。产品与架构背景见 [`../product/product_design.md`](../product/product_design.md) 与 [`../architecture/technical_design.md`](../architecture/technical_design.md)。

## 1. 运行要求

基础运行：

- Python 3.12+（已在 3.13 上验证）
- Node.js 20+
- pnpm 10+

桌面壳打包额外需要：

- Rust stable / Cargo
- Microsoft C++ Build Tools
- Microsoft Edge WebView2 Runtime

完整桌面打包清单见 [`desktop_tauri.md`](desktop_tauri.md)。

默认数据库是 SQLite，不需要 PostgreSQL：

- 开发模式：`backend/mai.sqlite3`
- 打包模式：系统用户数据目录下的 `MAI/mai.sqlite3`

如需 PostgreSQL，在 `backend/.env` 中设置：

```text
DATABASE_URL=postgresql+asyncpg://mai:mai_dev_password@localhost:5432/mai
```

仓库的 `infra/docker-compose.yml` 提供了可选开发库：

```powershell
docker compose -f infra/docker-compose.yml up -d postgres
```

## 2. 本地开发

### 2.1 一键启动

Windows PowerShell：

```powershell
.\scripts\dev.ps1 -SkipPostgres
```

脚本会：

- 从 `.env.example` 创建 `backend/.env`（如果不存在）。
- 创建后端 `.venv` 并安装依赖。
- 执行 `python -m app.init_db`，建表、运行轻量迁移、写入内置模板。
- 安装前端依赖。
- 分别启动后端与前端开发服务。

常用参数：

```powershell
.\scripts\dev.ps1 -SkipInstall
.\scripts\dev.ps1 -SkipDbInit
.\scripts\dev.ps1 -BackendPort 8001 -FrontendPort 5174
```

### 2.2 手动启动后端

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python -m app.init_db
uvicorn app.main:app --reload --host 0.0.0.0 --port 47821
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:47821/health
```

### 2.3 手动启动前端

```powershell
cd frontend
pnpm install
pnpm dev --host 0.0.0.0 --port 5173
```

打开：

```text
http://localhost:5173
```

Vite 会把 `/api` 代理到 `http://127.0.0.1:47821`。

### 2.4 单进程托管

生产形态或桌面形态只需要一个后端进程：

```powershell
cd frontend
pnpm build
cd ..\backend
uvicorn app.main:app --host 127.0.0.1 --port 47821
```

满足以下任一条件时，后端会挂载已构建前端并提供 SPA fallback：

- `frontend/dist/index.html` 存在。
- `MAI_FRONTEND_DIST` 指向一个构建目录。
- PyInstaller `_MEIPASS/frontend-dist` 存在。

同一后端会把 `/api/...` 请求去掉 `/api` 前缀后再路由，所以前端无需重新构建。

## 3. 配置 API 与模型

MAI 把模型配置拆成两层：

| 概念 | 含义 | 示例 |
|---|---|---|
| `provider` | 一份凭据 + LiteLLM 路由类型，由用户取一个可读名称 | "我的 OpenAI"，类型 `openai` / `anthropic` / `openrouter` / `custom` |
| `model` | 该 provider 下挂的具体可选模型 | `openai/gpt-4o-mini`、`anthropic/claude-sonnet-4-5` |

推荐流程：

1. 进入 `模板 -> API 配置`。
2. 新建 API 配置，填 `名称`、`类型`、API Key 和可选 API Base。
3. 在该 API 配置下添加一个或多个模型。
4. 在模型列表里可以测试连接，也可以指定 Provider 默认模型。
5. 进入 `设置`，选择全局默认模型。
6. 进入 `模板 -> 人设` 或房间成员编辑器，为具体人设选择模型。留空则走全局默认模型。

调用时的回退顺序：

```text
persona_instance.api_model_id
  -> persona_template.api_model_id
  -> app_settings.default_api_model_id
  -> legacy backing_model + api_provider_id（兼容旧数据）
```

新写入只保存 `api_model_id`。`backing_model` / `api_provider_id` 旧字段保留用于老数据库回退，不再作为新模型选择的镜像。

## 4. 模板管理

模板页包含：

- 人设
- 阶段
- 赛制
- 配方
- API 配置

稳定后的交互规则：

- 内置模板只读。
- 默认列表显示可编辑实例。
- 点击“添加”时，从内置库复制一份实例。
- 可编辑实例支持修改和删除。
- 人设可以绑定 API 模型。
- 阶段可以配置发言范围、排序规则、退出条件、自动讨论、角色约束和提示词模板。
- 赛制是阶段的有序组合，支持拖拽排序。
- 配方打包人设集合、赛制和初始房间设置。
- 标签用于过滤模板。
- 人设编辑器支持 AI 起草：输入自然语言需求后填入可编辑草稿，再由用户保存。

## 5. 讨论室常用流程

1. 在首页创建房间，选择场景、配方、赛制和人设；场景可预填初始问题。
2. 在房间中发送用户消息，或上传 MD/TXT/PDF 文档。
3. 后端根据当前阶段规则选择下一位 AI 发言者。
4. `parallel` 阶段会同时启动多个模型调用；普通阶段每次只有一个 in-flight 调用。
5. 消息列表上方的**发言状态条**会实时显示运行时状态（frozen / speaking / scheduling / idle）和当前发言人。idle 时点 「让 AI 继续」 即可不发消息也让 AI 接力（背后调 `POST /rooms/{id}/autodrive/resume`）。状态条里的「暂停」会等当前角色说完后冻结房间；顶部「冻结」会立即截断当前发言。
6. 右侧面板可查看阶段、书记官状态、主持信号、裁决、限额、上传和子讨论。
7. 阶段满足退出条件后，横幅会提示进入下一阶段、继续讨论或再来一回合。
8. Judge 模式可写入裁决或标记死路；撤销裁决也是追加消息，不会修改历史。
9. 群友发言模式可用临时昵称投放观点，必要时再揭示。
10. 子讨论可隔离争议点，结束后合并回父讨论。
11. Freeze 会取消当前 in-flight 调用并冻结房间，Unfreeze 后可继续；Pause 会先停止后续 autodrive，等当前角色自然完成后再进入冻结态。

### 5.1 故事模式

新建房间时格式选 「故事模式」（内置 `story_format`），加几个想看演的角色（可以用 AI 起草做剧本人物）。

特点：
- 单 phase 永不自动结束，由用户喊停（pause 或 freeze）。
- AI 持续接力到 `max_consecutive_ai_turns`（默认 10，可在右侧「限额」面板拉到 30–100）、token 上限或冻结。
- 每个角色只演自己一个，不替别人写台词。多 AI 房间下后端会自动重写历史角色消息为 `user + 「Name」: `，避免一个 AI 把整段故事都讲完。
- 想让某角色更主动开口，调高他人设的「健谈度」滑块。

### 5.2 Story World

Story World 在 Room 之上多一层「世界」容器，让一组角色在多幕戏之间保留记忆。详细设计见 [`../product/story_world.md`](../product/story_world.md)。常用流程：

1. 左 rail 进入 **World 列表**，新建一个世界，填 synopsis / setting / calendar_hint。
2. 在 World 详情页查看世界主控台：首屏展示当前故事时间、当前主线、当前地点、最近一幕、活跃角色，以及继续当前 Scene / 开启下一幕入口。
3. 在 **World Bible** 页签补充世界概述、背景、当前时间、当前地点和当前主线；也可以在 **Timeline** 页签手动添加历史背景事件。
4. 在 World 详情页添加角色：`kind=ai` 绑定 PersonaTemplate（带 core_identity / skills / goals），`kind=user` 是用户驱动的轻档案。
5. 创建第一幕（**Scene**）：勾选本幕在场角色，可以为某个 user 角色开启 `speak_as_user`。
6. 进入 Scene 后，在 Composer 切换：
   - **正常**：以当前 user 角色身份发言（多个 user 角色用 `as_character_id` 选择）。
   - **旁白**：用户作为「导演」描写场景或角色动作，落库为 system 消息。
   - **扮演**：以指定 user 角色身份发言（与 1 等价，仅 UI 入口不同）。
7. 角色中途加入或离开：调 `POST /rooms/{rid}/scene/enter` / `/exit`，会追加 `participant.enter` / `.exit` 系统消息。
8. 一幕戏想要保留为持久记忆 → 点 **生成封幕草稿**（`POST /rooms/{rid}/seal`）。这一步会暂停/冻结 Scene 并生成 Seal Draft，不写入长期世界状态；草稿审阅期间不能解冻继续改写本幕，避免提交旧草稿。
9. 在 **Scene-end Inspector** 中检查 / 编辑本幕摘要、时间轴事件、角色记忆和关系变化；可以取消错误项或整体重试。
10. 点击 **确认写入世界状态**（`POST /rooms/{rid}/seal-drafts/{draft_id}/commit`）后，本幕才会写入 `sealed_at`、Timeline、Memory 和 Relationship。World Detail 的 **Memories** 和 **Relationships** 页签会展示这些沉淀。
11. 下一幕 (`scene_index = 上一幕 + 1`) 创建时，已有角色会自动带回 retrieved top-K episodic 与同场关系卡片入 prompt。

## 6. 工具与 MCP

房间右侧 `工具` 面板用于管理工具能力：

1. 查看 MAI 内置工具清单。
2. 添加 MCP server，填写名称、URL 和传输方式。
3. 点击同步，读取 server 暴露的 tools。
4. 可手动执行只读工具做 smoke test。
5. 在成员编辑器里为具体成员开启 `允许工具`。
6. 如需让成员创建模板或调用外部写入工具，再开启 `允许写入工具`。

安全建议：

- 默认保持 `允许写入工具` 关闭。
- 对不稳定的外部 MCP server 先用手动只读工具测试。
- 工具调用会进入消息流和 `tool_invocations`，不要把敏感参数交给不可信 server。

## 7. 国际化

前端提供中英文切换：

- 全局顶部导航有语言按钮。
- 房间页隐藏全局导航，因此房间 header 内也有语言按钮。
- 语言选择保存在 `localStorage`。
- 内部枚举和标记会通过 `display()` 转成用户友好文案，例如 `round_robin`、`facilitator_suggests`、`dead_end`。
- 用户自己写的房间名、模板名、消息内容不会被翻译。

## 8. 验证

前端构建：

```powershell
cd frontend
pnpm build
```

后端测试：

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
pytest -q
```

后端测试会调用真实 LLM。请在 `backend/tests/.env.test` 写入：

```text
OPENAI_API_KEY=...
```

该文件已被 `.gitignore` 排除。缺少 token 时，测试会直接退出并说明原因。
默认测试数据库是 `backend/tests/.runtime/mai_test.sqlite3`，每次测试会清理重建，不会写入开发库 `backend/mai.sqlite3`。如果要测试其他数据库，请在 `.env.test` 里显式写入 `DATABASE_URL`。

## 9. 打包

### 9.1 普通发布包

```powershell
.\scripts\package.ps1 -Version v0.1.0
```

输出在 `release/` 下，包含前端构建产物、后端代码、依赖文件和文档。

常用参数：

```powershell
.\scripts\package.ps1 -Version v0.1.0 -SkipInstall
.\scripts\package.ps1 -Version v0.1.0 -SkipFrontendBuild
.\scripts\package.ps1 -Version v0.1.0 -OutputDir artifacts
```

### 9.2 Tauri 桌面包

桌面壳使用 Tauri v2 承载 React SPA，并由 PyInstaller sidecar 启动 FastAPI 后端。Tauri 启动时注入 `window.__MAI_API_BASE__`，前端会请求 sidecar 的本地临时端口。

构建 sidecar：

```powershell
.\scripts\build-sidecar.ps1 -TargetTriple x86_64-pc-windows-msvc
```

构建安装包：

```powershell
.\scripts\package-tauri.ps1 -TargetTriple x86_64-pc-windows-msvc
```

安装包输出：

```text
frontend/src-tauri/target/release/bundle/nsis/
```

## 10. GitHub Release

推送匹配 `v*.*.*` 的 tag 会触发 `.github/workflows/release.yml`：

发布前先统一应用版本号。当前需要同步的版本位置：

| 文件 | 字段 | 用途 |
|---|---|---|
| `frontend/package.json` | `version` | 前端包版本 |
| `frontend/src-tauri/tauri.conf.json` | `version` | Tauri 应用/更新器版本 |
| `frontend/src-tauri/Cargo.toml` | `[package].version` | 桌面壳 Rust crate 版本 |
| `frontend/src-tauri/Cargo.lock` | `mai-desktop` package `version` | 锁定桌面壳 crate 版本 |
| `backend/app/main.py` | `FastAPI(..., version=...)` | 后端 OpenAPI 元数据版本 |

版本号提交应先合入 `main`，再创建同版本 tag，避免 tag 指向的代码仍带旧版本号。

```powershell
git tag -a v0.6.5 -m "Release v0.6.5"
git push origin v0.6.5
```

工作流会安装依赖、运行测试、构建前端、打包并上传 Release 产物。

## 11. 常见问题

| 现象 | 处理 |
|---|---|
| `/health` 报数据库错误 | SQLite：检查 DB 文件目录可写；PostgreSQL：确认服务、账号、库名和 `DATABASE_URL` |
| 设置页显示未配置完成 | 到 `模板 -> API 配置` 新建 provider 和 model，再回设置页选择默认模型 |
| LiteLLM 认证失败 | 检查 API Key、API Base、provider 路由和模型名；修改环境变量后需要重启后端 |
| 人设没有走预期模型 | 先看房间成员实例是否绑定模型，再看模板模型，最后看设置页默认模型 |
| 前端 404 或 API 不通 | 开发模式确认 Vite proxy；单进程模式确认 `frontend/dist/index.html` 存在 |
| 前端构建出现 chunk size warning | Markdown/KaTeX/Shiki 体积较大，这是 warning |
| pytest 提示缺少 `OPENAI_API_KEY` | 在 `backend/tests/.env.test` 写入真实 token |
| Tauri 启动白屏或 API 不通 | 先确认 sidecar 已构建；前端应优先使用 `window.__MAI_API_BASE__` |
| `rustc` 或 `link.exe` 缺失 | 安装 Rust/Cargo 和 Visual Studio Build Tools C++ 桌面工作负载 |
