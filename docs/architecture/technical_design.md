# MAI 技术设计文档

> 当前状态：稳定实现版。配套产品文档见 [`../product/product_design.md`](../product/product_design.md)；Story World 子产品的数据模型与 engine 改动见 [`../product/story_world.md`](../product/story_world.md)。

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

Autodrive lock 也是进程内状态：`_AUTODRIVE_LOCKS` 只负责单进程内避免同一 room 重复调度。删除 Room 和封幕 Scene 时会主动清理对应 lock；横向扩容前需要把该锁迁移到跨进程协调层，当前版本不承诺多进程一致性。

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

普通阶段同一房间只允许一个 in-flight 调用；`parallel` 阶段可以注册多个 message-scoped 调用。`freeze_room` 会取消该房间所有 active calls，并把 partial 保存为 truncated message；`pause_room` 不取消 active calls，而是阻止 autodrive 续排并等待当前调用自然完成。

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
| `migrate_drop_vendor.py` | 移除 `ApiProvider.vendor` 旧字段 |
| `migrate_seed_story_mode.py` | 老 dev DB 补建故事模式 phase + format（按 builtin_id 幂等插入） |
| `migrate_story_mode_v2.py` | 同步 builtin 故事模式 phase 的 role_constraints / prompt_template |
| `migrate_persona_identity.py` | 给 PersonaTemplate / PersonaInstance 拆出 `identity` 列（角色头衔与人名分离） |
| `migrate_seed_new_personas.py` | 老 dev DB 补建后续追加的 13 个内置人设 |
| `migrate_builtin_personas_update.py` | **每次启动都跑**的幂等同步：把 `seed.py` 里 `is_builtin=True` 的人设字段刷回 DB（其他一次性迁移按 `_migrations` sentinel 只跑一次） |
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
  default_api_provider_id      # legacy fallback only
  default_backing_model        # legacy fallback only
```

`api_model_id` 是新 UI 的主路径。为了兼容旧数据，`backing_model` 和 `api_provider_id` 仍保留在 persona template / instance 上，但新写入只写 `api_model_id`；legacy 字段只作为旧行读取 fallback，删除 Provider / Model 时会被清理。

模型解析顺序在 `backend/app/model_runtime.py` 中集中处理：

```text
persona_instance.api_model_id
  -> app_settings.default_api_model_id
  -> legacy backing_model + api_provider_id
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
- `autodrive_active`：autodrive 链是否正在跑（由 `is_autodrive_active(room_id)` 实时填充，不持久化；pause / freeze 会请求当前 runner 停在本轮之后）
- `current_speakers`：当前 in-flight 调用的 persona id 列表（包括 LLM 已调用但还没产出第一个 chunk 的瞬间）

`PersonaTemplate` / `PersonaInstance` 上额外携带 `color`（`#rrggbb`）和 `icon`（lucide 图标名，必须从 `schemas.PERSONA_ICON_NAMES` 枚举里挑），用于前端 `PersonaIcon` 组件渲染头像和状态条着色。

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

### 4.5 Story World

Story World 在不破坏旧路径的前提下追加 7 张表 + Room 加列；详细字段、记忆三层结构与封幕 pipeline 见 [`../product/story_world.md`](../product/story_world.md)。

新增表：

```text
worlds                   世界设定 (synopsis / setting / calendar_hint / cover_*)
world_characters         角色档案 (kind=ai|user, identity, brief, core_identity, skills_text, goals_text, persona_template_id?)
world_scene_members      Scene 名册 PK=(scene_id, world_character_id) + entered_at_message_id / exited_at_message_id + speak_as_user
world_character_memories episodic 条目 (kind=episode|impression|vow|fact|backstory, salience, last_used_scene_index, seal_draft_id)
world_character_relations 关系卡片 (单向, A 视角看 B, sentiment∈[-1,+1], notes 累积, last_updated_seal_draft_id)
world_timeline_events    World 级时间轴事件 (history/memory/relationship/plot_hook/arc_update 等, seal_draft_id)
world_scene_seal_drafts  两阶段封幕草稿 (summary/timeline/memory/relation suggestions, status, retry/commit metadata)
```

`Room` 表加列（写进 `_ADDED_COLUMNS`）：`world_id` / `scene_index` / `in_world_time_start` / `in_world_time_end` / `in_world_duration_hint` / `sealed_at`。`PersonaInstance` 加列 `world_character_id`，让 engine 能反查回 character。

P0 World State 兼容层：

- `World.config.world_bible` 保存世界设定集、当前故事时间、当前地点、当前主线、地点、阵营、规则、禁忌和伏笔等结构化 JSON。
- `World.synopsis` / `setting` 继续保留，并与 Bible 的 `summary` / `background` 同步，以兼容旧列表、旧 prompt 和旧 API。
- `world_timeline_events` 存储非 Scene 的世界时间轴事件；Scene 节点仍以 `Room(world_id, scene_index)` 为 canonical source。

`world_id IS NULL` 的房间路径不变；`world_id IS NOT NULL` 的房间是 Scene，触发：

- `pick_next_speaker` 从 `world_scene_members`「在场区间」过滤候选集（`exited_at_message_id IS NULL` 且 `entered_at_message_id` 已发生）。
- `_build_messages` 在 system prompt 头部 prepend World synopsis + character 档案 + retrieved episodic + 同场关系卡片。
- `run_scribe_update`（房间级共识 / 分歧）早退；character memory scribe 是唯一折叠路径。
- `POST /rooms/{rid}/seal` 先冻结 Scene，再调用 `engine.generate_scene_seal_draft_payload` 生成 `world_scene_seal_drafts`，不写入长期状态。
- `POST /rooms/{rid}/seal-drafts/{draft_id}/commit` 幂等写入 `Room.sealed_at`、`world_timeline_events`、`world_character_memories`、`world_character_relations`，并给写入项打上 draft 来源标记，随后执行 `decay_unused_memories` / `enforce_memory_cap`。

`autodrive` / `facilitator` / `freeze` 路径不变。

### 4.5.1 Scene Context Builder（P1.1）

`backend/app/scene_context.py` 为每个 Story Scene AI turn 构建只读 context：

```text
build_scene_context(session, room, speaker_persona_id)
  -> SceneContextOut
       world:  World Bible compact (name/summary/background/date/location/arc/rules/taboos/plot_hooks)
       scene:  stage context (index/title/time/duration/background/sealed/frozen)
       timeline: last 8 committed timeline events
       stage_characters: roster with name/kind/role/is_present/can_speak
       speaker:
         memory_cues: top 6 by salience (>= 0.05)
         relationship_cues: outgoing relations to active peers
         visibility: message count + notes
```

`compose_scene_runtime_context_prompt(context)` 渲染为四段文本：`[World State]` / `[Stage State]` / `[Your Private Context]` / `[Behavior Contract]`。

构建失败时 fallback 到 legacy prompt（非阻塞）。

### 4.5.2 Transcript Visibility Slicing（P1.2b）

`engine.py::visible_messages_for_scene_speaker` 基于 `WorldSceneMember` 的 `entered_at_message_id` / `exited_at_message_id` 做 interval slicing：

- `entered_at_message_id IS NULL` → 从 scene open 可见
- `exited_at_message_id IS NULL` → 到 scene 当前可见
- 边界 inclusive：enter / exit 消息本身可见
- fallback：persona 未绑定 character 或不在 roster 时返回完整 transcript

封幕 pipeline 使用 `_slice_messages_for_character` 做相同过滤。

### 4.5.3 Director Instruction（P1.5）

`TurnRequest.director_instruction` 是 ephemeral runtime instruction：

- `_normalize_ephemeral_director_instruction` 验证必须是 scene room 且非空
- `append_ephemeral_director_instruction` 包裹为 bilingual block 追加到 scene_context_prompt 末尾
- 只影响当次 LLM 调用，不持久化到 Message 表
- 不进入 Seal Draft / Memory / World State

### 4.5.4 Behavior Contract（P1.6）

`compose_scene_runtime_context_prompt` 的 `[Behavior Contract / 角色行为契约]` 段包含 8 条双语规则，覆盖：角色边界、信息边界、点名回应、沉默策略、导演指令临时性。

### 4.6 JSON 跨方言

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

一次性（`_migrations` 表记录完成 sentinel，只跑一次）：

- `migrate_personas`
- `migrate_settings`
- `migrate_api_models`
- `migrate_drop_vendor`
- `migrate_seed_story_mode`
- `migrate_story_mode_v2`
- `migrate_persona_identity`
- `migrate_seed_new_personas`

常驻幂等（每次 `create_schema` 都跑）：

- `migrate_builtin_personas_update` —— 把 `seed.py` 中 `is_builtin=True` 的人设字段刷回 DB，方便迭代内置人设内容

SQLite 连接初始化（`db.py` 内 listener）会执行：

- `PRAGMA journal_mode=WAL`
- `PRAGMA synchronous=NORMAL`（WAL 推荐级别，crash-safe 不变；写性能比默认 FULL 快 5–10×）
- `PRAGMA busy_timeout=15000`（autodrive 取消信号要等 LLM 流读完当前 chunk，5 秒不够）

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

用户消息、问题、回答、文档、群友发言等会触发 autodrive。AI 消息不会递归触发下一轮。autodrive 进入 `_autodrive_runner` 后通过 `_should_auto_discuss` 决定是否再来一轮：

- `frozen` / `auto_discuss=False` / 已达 `max_consecutive_ai_turns` / phase 退出 → 停。
- `casual` ordering + `auto_discuss_mode=decay` 默认按 `0.9 × 0.85^n` 几何衰减，链长期望 2–3 轮。
- `auto_discuss_mode=continuous` 跳过几何衰减：故事/演出型阶段持续接力，由 `consecutive_ai_turns` 上限、token 预算、phase exit 或用户冻结收尾。

用户也能通过 `POST /rooms/{id}/autodrive/resume` 在不发消息的情况下手动启动一次 autodrive 链（背后调 `engine.schedule_autodrive`）。

### 6.1.1 多 AI peer 路由

`llm.py::_build_messages` 在历史消息送进 LLM 前做角色重写：当前发言人自己的过去发言保留 `assistant`，其他 AI/用户的发言重写为 `user` 并加 `「Name」: ` 前缀。多人房间下系统提示里追加一段「你只是『X』一个人」的硬约束。引擎从 `PersonaInstance` 拉名字组成 `peer_names: dict[id, name]` 传给 `stream` / `complete_with_tools`。这个改动是为了避免多 AI 房间所有发言都被当事 AI 当成"自己之前的输出"，从而退化成一个全知叙述者声音。

casual ordering 自带的 `<silent/>` 逃生口也按 `auto_discuss_mode` 分支：`decay` 保留「没话说就 `<silent/>`」默认；`continuous` 改为「即便没大新闻，也用一句台词或动作维持存在感，只有真无可演时才 silent」。`tags` 只保留分类/检索语义，不再驱动调度。

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

前端状态分层：

- 流式期间：Zustand `streaming` buffer 是唯一实时文本来源。
- 完成后：`message.appended` 直接 upsert TanStack Query room cache，并把该 `message_id` 标记为 finalized，迟到 chunk 或旧 `/state.in_flight_partial` 不再恢复气泡。
- `/state.in_flight_partial` 只用于刷新页面、切换房间或 SSE 重连后的恢复；如果同一 `message_id` 已在最终消息列表中，前端会忽略该 partial。

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

### 6.5 Freeze 与删除

冻结流程：

1. 设置房间 frozen。
2. cancel 当前房间所有 `ACTIVE_CALLS`。
3. partial 保存为 truncated message。
4. 写 room snapshot。
5. 发布 `room.frozen`。

`InFlightCall.cancel()` 只是 fire-and-forget 给 task 发 `CancelledError`；信号要等 task 走到下一个 await（通常是 LLM 流的下一个 chunk）才生效。所以 `delete_room` 在调用 cancel 之后会 `asyncio.gather(*tasks, return_exceptions=True)` 等所有被取消的 task 真正退出，再开始 DELETE，避免和后台任务的写事务抢 SQLite 写锁。

`freeze_room` 会先请求 autodrive runner 停止并取消/等待当前 room 的所有 in-flight task 完成，让 partial/truncated message 语义保持 append-only，再继续写冻结状态。`pause_room` 只请求 runner 停止，不取消 active call；它等待当前角色自然完成并追加完整消息后，再把房间置为 frozen。`delete_room` 仍会取消 in-flight task 后再删除数据。用户消息只会触发一轮自动回复，避免 AI 回复继续自触发；`POST /rooms/{id}/autodrive/resume` 才会按 `auto_discuss` 连续推进。resume 返回 `scheduled` 或 `skipped`，skipped 会带 `locked`、`frozen`、`in_flight`、`no_available_speaker`、`phase_not_auto`、`exit_condition_met`、`token_budget_exceeded` 等原因。

### 6.6 LLM 调用兼容性

`LLMAdapter.complete_tool` 三档降级：

1. 首选 `tool_choice={"type":"function", "function":{"name":...}}`。
2. 命中"tool_choice 不支持"类 400（如 `deepseek-reasoner`）时，重试 `tool_choice="auto"` 并在 user message 加强「只调用一次此函数」的指令。
3. 如果模型仍未发出 tool call，丢弃 tools 改用纯 JSON 模式，把 schema 拼进 system prompt。

`_parse_tool_arguments` 会剥 ```` ```json ```` 围栏、切到首个 `{`/末个 `}`；`_unstring_nested` 递归还原嵌套 JSON 字符串字段（MiMo 和部分 OpenRouter 中转会双重编码 tool 参数里的对象/数组）。

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

- `RoomListSidebar`：房间卡片列表（不再是窄长条）。每张卡片显示主题色条、最多 4 个 `PersonaIcon` 成员头像 + `+N` chip、消息计数、相对时间。数据来自 `/rooms` 返回的 `RoomSummaryOut`，4 条 SQL 聚合无 N+1。
- `MessageList` + `Composer` + `SpeakerStateBar`（消息列表上方，4 态状态条 frozen / speaking / scheduling / idle，跟随当前发言人主题色着色，并在 idle 态提供「让 AI 继续」按钮调 `/autodrive/resume`）。
- `RightPanel`：成员摘要 + 多 panel 抽屉。

设置抽屉和右栏 panel 位于：

```text
frontend/src/pages/room/panels/
```

API 配置页（`/templates/api`）：每张 provider 卡片可点击就地展开，左半栏 API 配置 / 右半栏挂载在该 provider 下的模型列表 + 模型编辑器；不再有右侧固定 380 px 编辑面板。`+ 新建` 在列表顶部插入一张 draft 卡。

Dashboard 首次使用引导是三个水平节点（API → 人设 → 房间），之间有 progress 连接线，done / next / upcoming 三态着色。

新增房间侧功能时，优先扩展这些 panel，而不是把逻辑塞进 `RoomPage.tsx`。

### 8.4 SSE

`useRoomEvents` 订阅 `/rooms/{id}/events`：

- `message.streaming`：直接更新 Zustand streaming buffer。
- `message.appended`：先 upsert TanStack Query room cache，再 finalized 对应 streaming buffer，并继续触发去抖 invalidate 做最终对账。
- `message.cancelled`：finalized 对应 streaming buffer 并刷新房间。
- room / phase / scribe / facilitator 事件：invalidate 对应 TanStack Query。

invalidate 走 250 ms 去抖（`scheduleInvalidate`）：autodrive 链一次能在几秒内 burst 多个事件，去抖后多次合并成 1 次 `/state` refetch，避免后台被淹。

断线后，`GET /rooms/{id}/state` 会返回 `in_flight_partial`，前端用 `message_id` 和 `chunk_index` 去重恢复；已 finalized 的 message id 会阻止迟到 partial 重新出现。

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
- `POST /assistants/template-draft`（persona 类型走严格 `PersonaDraftEnvelope` schema：name 2-24 / description 8-140 / system_prompt 30-600 / temperature 0-1.2 / talkativeness 0-3 / color hex / icon 枚举 / tags ≤ 5；非 persona 类型保留宽松 dict 结构）

房间运行时与发言状态：

- `POST /rooms/{room_id}/autodrive/resume`：手动启动 autodrive 链（已在跑或有 in-flight 调用时 no-op）
- `POST /rooms/{room_id}/pause`：graceful pause，等当前角色说完后冻结房间；不同于 `freeze`，不会截断当前发言
- `RoomRuntimeOut.autodrive_active` / `current_speakers`
- `RoomCreate.initial_message`
- `MessageOut.tool_invocation`
- `RoomState.tool_invocations`

房间列表：

- `GET /rooms` 返回 `RoomSummaryOut[]`（继承 `RoomOut`，多出 `members[]` / `member_count` / `message_count` / `last_activity_at`，全部 4 条 SQL 聚合，no N+1）
- `RoomMemberPreview { id, name, color, icon }`：sidebar 卡片头像渲染需要的最小字段集

Story World（详细见 [`../product/story_world.md`](../product/story_world.md) §6）：

- `GET|POST /worlds`、`GET|PATCH|DELETE /worlds/{wid}`
- `POST /worlds/{wid}/characters`、`GET|PATCH|DELETE /worlds/{wid}/characters/{cid}`
- `GET|PUT /worlds/{wid}/characters/{cid}/memories`、`PATCH|DELETE /worlds/{wid}/characters/{cid}/memories/{mid}`
- `POST /worlds/{wid}/scenes`、`GET /worlds/{wid}/timeline`
- `GET /worlds/{wid}/state` 聚合 World Detail 主控台数据（World Bible、Timeline Events、Scenes、Memories、Relationships）
- `PATCH /worlds/{wid}/bible`
- `GET|POST /worlds/{wid}/timeline-events`
- `PATCH|DELETE /worlds/{wid}/timeline-events/{eid}`
- `POST /rooms/{rid}/scene/enter`、`POST /rooms/{rid}/scene/exit`、`GET /rooms/{rid}/scene/members`
- `POST /rooms/{rid}/seal`、`GET|POST /rooms/{rid}/seal-drafts`、`GET|PATCH /rooms/{rid}/seal-drafts/{draft_id}`、`POST /rooms/{rid}/seal-drafts/{draft_id}/retry|commit`
- `POST /rooms/{rid}/messages` 多一个可选字段 `as_character_id`，让用户在多个 `kind=user` 角色之间挑身份发言
- `POST /rooms/{rid}/turn`：AI turn，可带 `director_instruction`（ephemeral，不持久化）
- `GET /rooms/{rid}/scene/context`：只读 Scene Context（World Bible compact、stage roster、speaker memory/relations、visibility preview）

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

如需引入这些能力，应先更新 [`../product/product_design.md`](../product/product_design.md)，再调整 schema 和引擎不变量。
