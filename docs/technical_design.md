# MAI 技术设计文档

> 当前状态：稳定实现版，配套产品文档见 `product_design.md`。

## 1. 架构总览

MAI 当前是一个单进程、本地优先应用：

```text
frontend/src  Vite + React + TypeScript
    |
    | HTTP + SSE，开发时 /api 由 Vite proxy 转发
    v
backend/app   FastAPI + SQLAlchemy async + LiteLLM
    |
    +-- SQLite 默认，PostgreSQL 可选
    +-- uploads/ 保存上传文件
    +-- trace_payloads/ 保存大 trace payload
```

桌面版使用 Tauri v2 承载前端，并启动 PyInstaller 打包的 `mai-backend` sidecar。Tauri 在 SPA 加载前注入 `window.__MAI_API_BASE__`，因此桌面端不固定占用 dev 默认端口（`47821`），每次启动都会从临时端口里挑选。

前端 API base 优先级：

```text
window.__MAI_API_BASE__ -> VITE_API_BASE -> /api
```

## 2. 不变量

### 2.1 单进程

当前设计刻意保持单进程。房间运行时、in-flight 调用和 SSE event bus 都在进程内管理。多进程、多用户协作、Redis Pub/Sub 等只有在真实需求出现后再引入。

### 2.2 append-only

消息历史不编辑、不删除。以下行为都追加新消息：

- AI 或用户发言
- 裁决
- 裁决撤销
- dead-end 标记
- 主持信号
- 子讨论合并
- 审计 meta

### 2.3 in-flight 按 room + message 跟踪

`engine.ACTIVE_CALLS` 的形状是：

```python
dict[room_id, dict[message_id, InFlightCall]]
```

普通阶段同一房间只允许一个 in-flight 调用；`parallel` 阶段可以注册多个 message-scoped 调用。`freeze_room` 会取消该房间所有 active calls，并把 partial 保存为 truncated message。

### 2.4 说话人由调度器选择

AI 不是 free-running。`pick_next_speaker` 根据当前阶段的 `ordering_rule` 产出：

- wait
- single speaker
- parallel speakers
- phase_done

`mention_driven` 会先解析最新用户可见消息中的 @ 提及，未命中时回退 round-robin。

## 3. 后端模块

| 模块 | 责任 |
|---|---|
| `main.py` | FastAPI 路由、设置、模板、房间、上传、SSE、SPA 挂载 |
| `engine.py` | 调度、streaming、autodrive、phase lifecycle、scribe/facilitator、freeze |
| `models.py` | SQLAlchemy 模型 |
| `schemas.py` | Pydantic API contract |
| `seed.py` | 内置人设、阶段、赛制、配方 |
| `db.py` | engine/session、SQLite WAL、schema create、轻量迁移入口 |
| `migrate_personas.py` | legacy persona 表拆分到 template/instance |
| `migrate_settings.py` | 默认 API 设置迁移 |
| `migrate_api_models.py` | legacy provider/model 数据迁移到 `api_models` |
| `llm.py` | LiteLLM stream 与 tool-call 包装 |
| `tools.py` | 内置工具、MCP server 同步、工具调用记录与事件发布 |
| `event_bus.py` | 进程内 SSE pub/sub |
| `trace.py` | trace row + payload sidecar |

## 4. 数据模型

### 4.1 模板与实例

模板对象：

- `persona_templates`
- `phase_templates`
- `debate_formats`
- `recipes`

共同字段：

- `version`
- `schema_version`
- `status`
- `forked_from_id`
- `forked_from_version`
- `owner_user_id`
- `is_builtin`
- `tags`

内置模板 `is_builtin=True`，后端禁止 PATCH / DELETE。用户点击“添加”时调用 duplicate endpoint，创建 `is_builtin=False` 的可编辑副本。

`persona_instances` 是房间内人设快照。房间创建或添加成员时从 `persona_templates` 复制字段。模板后续修改不会回灌已存在房间；房间内修改也不会污染模板。

### 4.2 API 配置

当前模型配置分三张表：

```text
api_providers
  id
  name
  provider_slug
  api_key
  api_base
  last_tested_*

api_models
  id
  api_provider_id
  display_name
  model_name
  enabled
  is_default
  context_window
  tags
  last_tested_*

app_settings
  id = 1
  default_api_model_id
  default_api_provider_id      # legacy mirror / fallback
  default_backing_model        # legacy mirror / fallback
```

`api_model_id` 是新 UI 的主路径。为了兼容旧数据，`backing_model` 和 `api_provider_id` 仍保留在 persona template / instance 上，并在选择 `api_model_id` 时同步更新。

模型解析顺序在 `engine.py` 中集中处理：

```text
persona_instance.api_model_id
  -> app_settings.default_api_model_id
  -> legacy backing_model + api_provider_id
  -> LiteLLM provider 环境变量中的 key（前提是已有 provider 路由配置）
```

### 4.3 房间运行时

核心表：

- `rooms`
- `room_phase_plan`
- `room_phase_instances`
- `room_runtime_state`
- `messages`
- `decisions`
- `scribe_states`
- `facilitator_signals`
- `merge_backs`
- `room_snapshots`
- `uploads`
- `trace_events`
- `tool_servers`
- `tool_invocations`

`room_runtime_state` 包含：

- 当前 phase instance
- frozen
- token / cost 计数
- auto_transition
- max_message_tokens
- max_room_tokens
- max_phase_rounds
- account daily/monthly budget
- phase exit suggestion 状态
- consecutive AI turn 计数

### 4.4 工具与 MCP

工具层由两张表和一个运行时注册表组成：

```text
tool_servers
  id
  name
  kind = mcp
  transport = streamable_http | sse
  url
  enabled
  allow_write
  manifest.tools
  last_synced_at / last_error

tool_invocations
  id
  room_id
  message_id
  parent_message_id
  server_id
  tool_name / display_name
  status = pending | success | error
  arguments / result / error
  started_at / completed_at
```

`tools.py` 负责把 MAI 内置工具与已启用 MCP server 的 manifest 合并成统一工具清单。MCP 工具对 LLM 暴露时会被转换成安全的外部函数名，调用时再映射回 server manifest 里的原始工具名。

当前内置工具：

- `mai_search_room_messages`
- `mai_list_room_members`
- `mai_create_persona_template`
- `mai_create_phase_template`

写入工具需要两层授权：

1. server 或工具本身标记为写入能力。
2. 房间成员实例 `config.tools_allow_write=true`，或手动执行接口显式传入 `allow_write=true`。

### 4.5 JSON 跨方言

`models.JSONType` 定义为：

```python
JSON().with_variant(JSONB(), "postgresql")
```

SQLite 使用 JSON，PostgreSQL 使用 JSONB。

## 5. Schema 与迁移

项目没有 Alembic。schema 管理方式：

1. `Base.metadata.create_all` 负责新库。
2. `db.py::_ensure_added_columns` 对旧库执行安全的 `ALTER TABLE ADD COLUMN`。
3. 一次性数据迁移记录在 `_migrations` 表。

当前一次性迁移：

- `migrate_personas`
- `migrate_settings`
- `migrate_api_models`

新增已存在表的列时，需要：

- 在 `models.py` 添加字段。
- 在 `db.py::_ADDED_COLUMNS` 添加对应 DDL。
- 如需数据搬迁，新增一个幂等迁移模块，并在 `create_schema` 中调用。

## 6. 引擎流程

### 6.1 消息追加后

`after_message_appended` 做几件事：

1. 检查 phase exit conditions。
2. 按节奏触发书记官和主持。
3. 触发 autodrive。
4. 发布 SSE / invalidate 所需事件。

用户消息、问题、回答、文档、群友发言等会触发 autodrive。AI 消息不会递归触发下一轮。

### 6.2 阶段生命周期

每个房间有 `room_phase_plan`。进入某个 plan slot 时创建 `room_phase_instances`。

退出条件包括：

- `rounds`
- `all_spoken`
- `all_voted`
- `token_budget`
- `facilitator_suggests`
- `user_manual`
- runtime 注入的 max phase rounds

满足退出条件后：

- 设置 `runtime.phase_exit_suggested=True`
- 发布 `phase.exit_suggested`
- 用户可以继续、再来一回合、进入下一阶段

阶段切换会强制运行书记官和主持边界任务。

### 6.3 Streaming

每次 persona 调用：

1. 创建临时 message id。
2. 注册 `InFlightCall`。
3. LiteLLM chunk 到达后立即发 `message.streaming` SSE。
4. 每个 chunk 更新 partial 和估算 tokens。
5. 完成、取消、超时或触发 limit 后追加最终 message。
6. 清理 `ACTIVE_CALLS`。

### 6.4 带工具调用的生成

房间成员实例可在 `config` 中开启：

```json
{
  "auto_reply_enabled": true,
  "tools_enabled": true,
  "tools_allow_write": false
}
```

调度器只在自动选择说话人时尊重 `auto_reply_enabled=false`；用户手动指定 speaker 不受影响。

当 `tools_enabled=true` 且工具清单非空时，`engine._stream_one_message` 走 `LLMAdapter.complete_with_tools`。这条路径不是逐 token streaming，而是在工具调用轮次完成后一次性发布最终 chunk。工具调用本身会立即追加 `tool_invocation` 消息，完成后更新同一消息内容并发布 SSE invalidate。

普通未启用工具的成员仍走原来的 streaming 路径。

chunk 空闲超时默认 30 秒，记录为 `truncated_reason="timeout"`。

### 6.5 Freeze

冻结流程：

1. 设置房间 frozen。
2. cancel 当前房间所有 `ACTIVE_CALLS`。
3. partial 保存为 truncated message。
4. 写 room snapshot。
5. 发布 `room.frozen`。

## 7. 系统角色

### 7.1 Scribe

`run_scribe_update` 每 5 条可见消息和阶段边界运行。输出是结构化 diff，写回 `scribe_states.current_state`。

书记官只做记录，不做建议。删除/解决条目必须能引用既有内容。

### 7.2 Facilitator

`run_facilitator_eval` 每 5 条消息、阶段边界和用户主动询问时运行。输出：

- `facilitator_signals` 结构化记录
- `message_type="facilitator_signal"` 的 observer-only message
- SSE 事件

主持信号 `visibility_to_models=False`，不会进入 AI 讨论上下文。`filter_facilitator_signals` 对同 tag 做 cooldown；手动询问使用 force，可绕过 cooldown。

## 8. 前端架构

### 8.1 技术栈

- Vite
- React 18
- TypeScript
- React Router
- TanStack Query
- Zustand
- dnd-kit
- lucide-react
- react-markdown + remark-gfm + KaTeX + Shiki

前端类型在 `frontend/src/types.ts` 手动镜像后端 Pydantic contract。

### 8.2 路由

```text
/
/rooms/:id
/templates/personas
/templates/phases
/templates/formats
/templates/recipes
/templates/api
/settings
```

`/rooms/*` 下隐藏全局导航，直接进入聊天壳。

### 8.3 房间 UI

`frontend/src/pages/room/RoomShell.tsx` 组合三栏：

- `RoomListSidebar`
- `MessageList` + `Composer`
- `MembersSidebar`

设置抽屉和右栏 panel 位于：

```text
frontend/src/pages/room/panels/
```

新增房间侧功能时，优先扩展这些 panel，而不是把逻辑塞进 `RoomPage.tsx`。

### 8.4 SSE

`useRoomEvents` 订阅 `/rooms/{id}/events`：

- `message.streaming`：直接更新 Zustand streaming buffer。
- `message.appended` / room / phase / scribe / facilitator 事件：invalidate 对应 TanStack Query。
- `message.cancelled`：清理 streaming buffer 并刷新房间。

断线后，`GET /rooms/{id}/state` 会返回 `in_flight_partial`，前端用 `message_id` 和 `chunk_index` 去重恢复。

### 8.5 国际化

`frontend/src/i18n.tsx` 提供：

- `I18nProvider`
- `useI18n`
- `LanguageToggle`
- `t(key, params)`
- `display(kind, value)`

语言保存在 `localStorage`，并同步 `document.documentElement.lang`。

UI 文案和内部枚举显示应使用 i18n；用户内容和模板数据本身不翻译。

## 9. Backend ↔ Frontend 契约

前端 API wrapper 总是以 `/api` 为默认前缀。后端 route 写在根路径，`main.py` 的 `_strip_api_prefix` 中间件会把 `/api/...` 重写到根路径。

这让同一份前端构建可用于：

- Vite proxy 开发模式。
- FastAPI 单进程托管。
- Tauri sidecar 模式。

新增 API 时需要同步：

1. `backend/app/schemas.py`
2. `backend/app/main.py`
3. `frontend/src/types.ts`
4. `frontend/src/api.ts`
5. 相关 React Query key / invalidation

新增 SSE 事件时需要同步 publisher 和 `useRoomEvents`。

### 9.1 新增契约

工具与 MCP：

- `GET /tools`
- `GET /tools/mcp-servers`
- `POST /tools/mcp-servers`
- `PATCH /tools/mcp-servers/{server_id}`
- `DELETE /tools/mcp-servers/{server_id}`
- `POST /tools/mcp-servers/{server_id}/sync`
- `POST /rooms/{room_id}/tools/execute`

场景与模板助手：

- `GET /scenarios`
- `POST /assistants/template-draft`

房间状态新增：

- `RoomCreate.initial_message`
- `MessageOut.tool_invocation`
- `RoomState.tool_invocations`

## 10. 内置数据

`seed.py` 使用 deterministic UUIDv5：

```python
builtin_id(kind, key)
```

各类内置数据只在对应表为空时写入，没有 upsert。修改已 seed 的内置内容时，需要删除本地 DB、清表，或改 seed key。

内置模板在运行时不是特殊代码路径，只是 `is_builtin=True` 的内容数据。后端禁止直接修改；用户需要 duplicate 后编辑副本。

## 11. Trace 与上传

`trace.py::trace_record` 写两层：

- `trace_events` 表：轻量元数据。
- `<trace_payload_dir>/<room_id>/<event_id>.json`：完整 payload。

上传文件保存到 `<upload_dir>/<room_id>/`。当前只接受：

- `.md`
- `.txt`
- `.pdf`

PDF 使用 `pypdf` 提取文本。

开发模式目录默认在 `backend/` 下；打包模式目录默认在系统用户数据目录的 `MAI/` 下。

## 12. 验证与发布

前端：

```powershell
cd frontend
pnpm build
```

后端：

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
pytest -q
```

后端测试需要 `backend/tests/.env.test` 中的真实 `OPENAI_API_KEY`。
默认测试库位于 `backend/tests/.runtime/mai_test.sqlite3`，每次测试会清理重建；只有在 `.env.test` 显式设置 `DATABASE_URL` 时才会连接外部测试库。

发布包：

```powershell
.\scripts\package.ps1 -Version v0.1.0
```

桌面包：

```powershell
.\scripts\build-sidecar.ps1
.\scripts\package-tauri.ps1
```

## 13. 当前不做

这些不是当前架构的目标：

- 多进程协同。
- 多用户同房间协作。
- 消息编辑或删除。
- Trace 查询 / 重放 UI。
- 模板导入 UI。
- 图片和多模态上传。
- Streaming 续写。
- 超时自动重试。

如需引入这些能力，应先更新 `product_design.md`，再调整 schema 和引擎不变量。
