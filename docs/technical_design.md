# 多模型协作讨论平台 · 技术设计文档

> v1.0 · 全部决策对齐
> 配套产品文档：`product_design.md`

---

## 1. 设计前提

技术决策建立在三个产品决策之上：

1. **AI 自动讨论循环受控可中断** —— 用户消息后，autodrive 默认会驱动 AI 之间持续接力，最长 `runtime.max_consecutive_ai_turns`（默认 10）轮；只有当 phase 模板的 `auto_discuss=True` 才进入连发循环，否则维持"用户消息 → 单轮 AI 回复"。声明式 `parallel` phase 是唯一允许多个 in-flight LLM call 同时存在的例外，并按 `message_id` 独立跟踪。任何用户操作（发言、冻结、phase 切换）都立即打断当前接力。
2. **严格 append-only，不做编辑 / 删除** —— 消息历史只追加；裁决撤销也是 append 一条新消息。
3. **产品设计要克制** —— 不为不存在的并发场景做架构准备；不引入超出当前需求的框架。

这三条决定了 v1 的整体技术风格：单进程、薄抽象、纯 SQL、不上 agent 框架。

---

## 2. 总体架构

```
┌──────────────────────────────────────────────────────────┐
│  Frontend (Vite + React + TypeScript)                     │
│  ├─ 状态: TanStack Query + Zustand                        │
│  ├─ UI: shadcn/ui + Tailwind                              │
│  ├─ SSE: @microsoft/fetch-event-source                    │
│  └─ 编辑器: dnd-kit + react-hook-form + zod              │
└──────────────────┬───────────────────────────────────────┘
                   │ HTTP/SSE (OpenAPI 契约)
┌──────────────────▼───────────────────────────────────────┐
│  Backend (FastAPI + Python 3.12,单进程)                  │
│  ├─ API 层: FastAPI routes                                │
│  ├─ 引擎层: 调度循环 + Phase FSM + Scribe + Facilitator   │
│  ├─ LLM 层: LLMAdapter (LiteLLM 包装)                     │
│  ├─ 内存状态: active_rooms dict                           │
│  └─ Trace 写入: 异步 batch flush                          │
└──────┬─────────────────────────┬──────────────────────────┘
       │                         │
┌──────▼──────┐         ┌────────▼─────────┐
│ SQLite 默认 │         │  本地文件 / 对象存储  │
│ Postgres 可选│        │  trace_payloads/   │
│ 业务 / 运行时表│       │  uploads/          │
│  trace_events│        │                    │
└─────────────┘         └────────────────────┘
```

---

## 3. 状态管理

### 3.1 五类状态分类

| 类别 | 特性 | v1 实现 |
|------|------|---------|
| 持久业务数据 | 长期存储，跨会话 | SQLAlchemy；SQLite 默认，PostgreSQL 可选 |
| 房间运行时状态 | 频繁读写 | 进程内存 + 数据库双写 |
| In-flight 调用状态 | 短暂，可取消 | 进程内存 dict |
| 协同事件流 | 实时，可订阅 | SSE 单通道，进程内 event bus |
| 前端 UI 状态 | 浏览器侧临时态 | React state |

### 3.2 关键决策

**A. 不使用 LangGraph**——LangGraph 解决的问题(状态图、checkpointer、agent loop)在我们场景下要么不需要，要么用更简单的方式自行解决。

| LangGraph 提供 | 我们的解决方式 |
|----------------|--------------|
| 状态图 StateGraph | phase 内部只有"某个 persona 说一句话"这一个动作。整体是循环 + 调度器，不是图 |
| Checkpointer | append-only message 表本身就是完整事件流，重放即可恢复 |
| Streaming | LLM provider SDK 自带，直接转 SSE |
| Human-in-the-loop | 每次 AI 发言完自然停下等用户 |
| 多 agent 编排 | 调度逻辑 = 根据 phase 规则 + 用户 @提及 选下一个 persona |

**B. 房间运行时状态：进程内存 + 数据库双写**——schema 上把运行时字段放在独立的 `room_runtime_state` 表。默认 SQLite 开启 WAL 与 `busy_timeout`，以适配 autodrive 后台任务与前台请求的轻量并发；将来真有压力时可整表迁移到 Redis。

**C. ScribeState：jsonb 当前态 + 增量 fold**——`scribe_states` 表存当前态 jsonb + `last_event_id`。每次有新消息触发书记官更新时，增量 fold 一次。`decisions[]` 单独建表(细粒度操作)。

**D. 消息严格 append-only，撤销靠 append 新消息**——messages 表无任何 update。裁决撤销 = append 一条 `message_type: verdict_revoke` 的新消息引用原消息 id。

**E. In-flight 状态只放内存**——`ACTIVE_CALLS` 以 `room_id -> message_id -> InFlightCall` 跟踪；进程崩溃则该 in-flight call 视为失败，前端用户重试即可。不做断点续传。

### 3.3 演进路径

v1 这套架构在以下条件下需要演进，否则不动：

| 触发条件 | 演进方向 |
|----------|----------|
| 单进程 CPU 跑满 | 多进程 + `room_runtime_state` 挪到 Redis |
| 用户开多个房间并行 | 同上 |
| 多用户协作进同一房间 | Redis Pub/Sub 替代进程内 event bus |
| messages 表过大 | 按 room_id 分区已就位，归档到冷存储 |
| 出现复杂多步推理需求 | 局部引入 LangGraph 处理单个 phase，整体不变 |

---

## 4. 数据库 Schema

### 4.1 ID / 时间 / Null 处理统一规范

- **ID 格式**：UUID v7(时间有序，索引友好，Postgres 17 原生支持)
- **时间格式**：ISO 8601 字符串，存储为 `timestamptz`
- **Null 处理**：JSON 序列化时字段缺失而非显式 null(`exclude_none=True`)
- **命名风格**：snake_case 贯穿前后端

### 4.2 业务表

```sql
-- 用户与账号
users(id, email, created_at, ...)

-- 模板对象(共享 schema 套路)
-- v1 把"全局可重用的 persona"和"挂在某个房间里、和该房间生命周期绑定的
-- persona"拆成了两张表：persona_templates 是模板池，persona_instances 是
-- "把模板加到房间时的快照"。共识是：模板编辑不会回灌已建房间，房间内
-- 改 persona 也不污染模板。原来的 personas 单表保留为只读 legacy，迁移
-- 由 backend/app/migrate_personas.py 在启动时一次性完成。
persona_templates(
  id uuid pk,
  version int,
  schema_version int,
  status text check (status in ('draft','published')),
  forked_from_id uuid null,
  forked_from_version int null,
  owner_user_id uuid null,
  is_builtin bool,

  kind text check (kind in ('discussant','scribe','facilitator')),

  name text,
  description text,
  backing_model text,
  api_provider_id uuid null references api_providers(id),
  system_prompt text,
  temperature float,
  config jsonb,           -- discriminated by kind
  tags text[],

  created_at timestamptz,
  updated_at timestamptz
)
CREATE INDEX ON persona_templates USING gin(tags);

persona_instances(
  id uuid pk,
  room_id uuid references rooms(id) on delete cascade,
  template_id uuid references persona_templates(id),
  template_version int,    -- snapshot 时 template 的 version
  position int,            -- 房间内显示顺序

  -- 以下字段都是创建实例时从 template 拷贝；之后房间内的修改只动 instance 不动 template
  kind text,
  name text,
  description text,
  backing_model text,
  api_provider_id uuid null,
  system_prompt text,
  temperature float,
  config jsonb,
  tags text[],

  created_at timestamptz,
  updated_at timestamptz
)
CREATE INDEX ON persona_instances(room_id);

-- 全局账号设定与外部 LLM provider；persona 选 backing model 时按
-- "instance.backing_model -> template.backing_model -> app_settings.default_backing_model" 的顺序回退；
-- api_provider_id 同样有 instance -> template -> app_settings 的回退链。
-- seed.py 不会预置任何 ApiProvider；首次启动后用户必须在 /settings UI 创建
-- 至少一个 provider 并指定 default_api_provider_id 才能跑 LLM 调用。
api_providers(
  id uuid pk,
  name text,
  provider_slug text,           -- e.g. 'openai' | 'anthropic' | 'litellm-proxy'
  api_key text,                 -- encrypted at rest if provider supports it
  api_base text null,
  last_tested_ok bool null,
  last_tested_at timestamptz null,
  last_tested_error text null,
  created_at, updated_at
)

app_settings(
  id int primary key default 1, -- singleton row, enforced by check (id = 1)
  default_backing_model text null,
  default_api_provider_id uuid null references api_providers(id),
  updated_at timestamptz
)

phase_templates(
  id uuid pk, version int, schema_version int,
  status, forked_from_id, forked_from_version,
  owner_user_id, is_builtin,
  
  name, description,
  declared_variables jsonb,    -- list of VariableDeclaration
  allowed_speakers jsonb,       -- discriminated union
  ordering_rule jsonb,          -- discriminated union
  exit_conditions jsonb,        -- list of discriminated unions
  role_constraints text,
  prompt_template text,
  tags text[],
  
  created_at, updated_at
)
CREATE INDEX ON phase_templates USING gin(tags);

debate_formats(
  id uuid pk, version int, schema_version int,
  status, forked_from_id, forked_from_version,
  owner_user_id, is_builtin,
  
  name, description,
  phase_sequence jsonb,        -- list of FormatPhaseSlot (含 phase_template_version 锁定)
  tags text[],
  
  created_at, updated_at
)

recipes(
  id uuid pk, version int, schema_version int, ...
  persona_ids uuid[],
  format_id uuid,
  format_version int,
  initial_settings jsonb,
  tags text[],
  ...
)

-- 房间
rooms(
  id uuid pk,
  parent_room_id uuid null,    -- 子讨论引用父
  owner_user_id uuid,
  title text,
  recipe_id uuid null,
  format_id uuid null,
  format_version int null,
  status text check (status in ('active','frozen','archived')),
  frozen_at timestamptz null,
  created_at timestamptz
)

-- 房间的 phase 计划与实例
room_phase_plan(
  room_id uuid,
  position int,
  phase_template_id uuid,
  phase_template_version int,
  source text,             -- 'format' | 'user_inserted' | 'ad_hoc'
  variable_bindings jsonb, -- {"$affirmative_speaker": [persona_id, ...]}
  primary key (room_id, position)
)

room_phase_instances(
  id uuid pk,
  room_id uuid,
  plan_position int,
  phase_template_id uuid,
  phase_template_version int,
  status text check (status in ('running','completed','skipped')),
  started_at timestamptz,
  completed_at timestamptz null
)

-- 消息表（不分区；v1 工作集小，PG 分区方案推迟到真正出现单表性能问题再做）
messages(
  id uuid pk,
  room_id uuid,
  phase_instance_id uuid null,
  parent_message_id uuid null,        -- 回复关系
  message_type text,                  -- speech|question|answer|summary|verdict|verdict_revoke|dead_end|facilitator_signal|user_doc|masquerade_reveal|meta
  
  author_persona_id uuid,
  author_model text null,             -- 用户消息时为 null
  author_actual text,                 -- 'ai' | 'user_as_judge' | 'user_as_persona'
  user_masquerade_persona_id uuid null,
  
  visibility text default 'public',   -- public | private_to | observer_only
  visibility_to_models bool default true,
  
  content text,
  content_chunks_count int default 1, -- streaming 分片数(调试用)
  
  truncated_reason text null,         -- frozen | limit_exceeded | user_skip | null
  
  prompt_tokens int null,
  completion_tokens int null,
  cost_usd numeric null,
  
  user_masquerade_name text null,      -- 用户投放的群友昵称；旧的 persona 伪装可为空
  user_revealed_at timestamptz null,   -- 群友/伪装揭示时间(仅用户视图用)
  
  created_at timestamptz
);

CREATE INDEX ON messages(room_id, created_at);
CREATE INDEX ON messages(phase_instance_id);

-- 书记官状态
scribe_states(
  room_id uuid pk,
  current_state jsonb,                -- ScribeState 当前态
  last_event_message_id uuid null,    -- 增量 fold 起点
  updated_at timestamptz
)

-- 决议(单独表,支持锁定)
decisions(
  id uuid pk,
  room_id uuid,
  scribe_event_message_id uuid,       -- 由哪条消息触发产生
  content text,
  is_locked bool default false,
  locked_by_message_id uuid null,     -- 裁决锁定的 message
  revoked_by_message_id uuid null,    -- 裁决撤销的 message
  created_at timestamptz
)

-- 上帝副手信号
facilitator_signals(
  id uuid pk,
  room_id uuid,
  message_id uuid,                    -- 关联的 meta message
  trigger_after_message_id uuid,      -- 触发评估时的最后消息
  signals jsonb,                      -- list of {tag, severity, reasoning, evidence_message_ids}
  overall_health text,
  pacing_note text,
  created_at timestamptz
)

-- 子房间合并包
merge_backs(
  id uuid pk,
  parent_room_id uuid,
  sub_room_id uuid,
  conclusion text,
  key_reasoning jsonb,                -- list[str], max 3
  rejected_alternatives jsonb,
  unresolved jsonb,
  artifacts_ref jsonb,
  full_transcript_ref text,
  created_at timestamptz
)

-- 房间快照(冻结时打)
room_snapshots(
  id uuid pk,
  room_id uuid,
  full_state jsonb,
  created_at timestamptz
)

-- 上传文件
uploads(
  id uuid pk,
  user_id uuid,
  room_id uuid null,
  filename text,
  content_type text,
  extracted_text text,                -- 提取后的纯文本
  storage_path text,                  -- 原文件存储路径
  created_at timestamptz
)
```

### 4.3 运行时表(可剥离)

```sql
room_runtime_state(
  room_id uuid pk,
  current_phase_instance_id uuid null,
  frozen bool default false,
  token_counter_total int default 0,
  cost_counter_usd numeric default 0,
  auto_transition bool default false,
  current_user_mode text default 'normal',  -- normal | judge | masquerade-as-X
  current_masquerade_persona_id uuid null,
  updated_at timestamptz
)
```

将来扩展时整表迁移 Redis。

### 4.4 Trace 表

```sql
trace_events(
  id uuid pk,
  room_id uuid,
  event_type text,
  timestamp timestamptz,
  summary text,                       -- 短文本,可索引
  payload_ref text null               -- 文件路径,大 payload 存文件
)
CREATE INDEX ON trace_events(room_id, timestamp);
CREATE INDEX ON trace_events(event_type);
```

大 payload(完整 prompt、response、ScribeState 快照)走文件：`trace_payloads/{room_id}/{event_id}.json`。

---

## 5. Schema 序列化

### 5.1 真理来源：后端 Pydantic v2

- 后端 Pydantic 定义所有模板对象
- FastAPI 自动生成 OpenAPI
- 前端 `openapi-typescript` 派生 TypeScript 类型
- 前端表单校验：从 OpenAPI 派生 zod schema(via `openapi-zod-client` 等)

### 5.2 多态字段：Discriminated Union

所有"枚举 + 额外参数"的字段用 Pydantic discriminated union：

```python
# ExitCondition
class RoundsExit(BaseModel):
    type: Literal["rounds"]
    n: int

class AllSpokenExit(BaseModel):
    type: Literal["all_spoken"]
    min_each: int

class UserManualExit(BaseModel):
    type: Literal["user_manual"]

class FacilitatorSuggestsExit(BaseModel):
    type: Literal["facilitator_suggests"]
    trigger_if: list[str]    # signal tag 名

class TokenBudgetExit(BaseModel):
    type: Literal["token_budget"]
    max: int

ExitCondition = Annotated[
    RoundsExit | AllSpokenExit | UserManualExit 
    | FacilitatorSuggestsExit | TokenBudgetExit,
    Field(discriminator="type"),
]
```

OrderingRule、AllowedSpeakers、PersonaConfig 同样处理。

### 5.3 变量声明与绑定分离

```python
class PhaseTemplate(BaseModel):
    declared_variables: list[VariableDeclaration]
    # 模板内部用 $variable_name 占位

class VariableDeclaration(BaseModel):
    name: str           # "$affirmative_speaker"
    description: str
    cardinality: Literal["one", "many"]
    required: bool

class RoomPhaseInstance(BaseModel):
    phase_template_id: str
    phase_template_version: int
    variable_bindings: dict[str, list[str]]   # var name → persona_ids
```

### 5.4 版本演进：加法兼容

- 每次只允许"加字段"，不允许删/改字段
- 新字段必须有默认值
- `schema_version` 从 1 开始递增
- 破坏性变更走单独 migration script(v1 不写 framework)

### 5.5 状态字段(v1 加字段不实现功能)

```python
class PhaseTemplate(BaseModel):
    status: Literal["draft", "published"]
    # v1 所有用户保存的都是 published,draft 功能不实现
```

### 5.6 Fork 关系

```python
forked_from_id: str | None
forked_from_version: int | None
```

记录但不实现"原模板更新提醒"。

### 5.7 Format 引用 Phase 时锁定版本

```python
class FormatPhaseSlot(BaseModel):
    phase_template_id: str
    phase_template_version: int    # 锁定
    transitions: list[Transition]   # v1 永远是 [{"condition": "always", "target": "next"}]
```

避免 phase 升级时 format 行为漂移。

### 5.8 模板 Tag 管理

```python
class PhaseTemplate(BaseModel):
    tags: list[str] = []
```

GIN 索引 + `@>` 查询。仅模板分类用，runtime tag 不做。

### 5.9 导入导出

- **v1 只做导出**：模板导出为 JSON bundle(自包含所有依赖)
- **v1 不做导入**：高级用户可走 API
- 导出时不包含 `owner_user_id` 等账户特定字段

### 5.10 三层校验

- **前端实时**：zod + react-hook-form 字段级反馈
- **前端保存前**：完整 schema 校验
- **后端 API**：兜底，防绕过

---

## 6. 赛制状态机

### 6.1 实现层级：声明式数据 + 引擎执行

Python class 定义 phase + 字段是声明式数据。引擎读字段执行调度，不需要每个 phase 写自定义代码。

### 6.2 调度规则枚举(v1 必备)

| 规则 | 行为 |
|------|------|
| `alternating` | 在 allowed 中严格交替 |
| `round_robin` | 在 allowed 中按固定顺序轮转 |
| `mention_driven` | 优先解析最近用户消息的 @ 指定对象；未命中时回退 round-robin，让 autodrive 能继续推进 |
| `question_paired` | 上一句若是 question，下一句必须是被 @ 的回答方 |
| `parallel` | 所有 allowed 同时发言(每条独立 LLM call，按 `message_id` 独立 streaming，结果都 append) |
| `user_picks` | 每次都让用户从 allowed 中选 |

### 6.3 退出条件类型(v1 必备)

```python
ExitCondition = (
  | RoundsExit                  # 已发言轮数
  | AllSpokenExit               # 每人至少 N 次
  | AllVotedExit                # 所有人都做出某动作
  | UserManualExit              # 仅用户手动结束
  | FacilitatorSuggestsExit     # 上帝副手判定该结束
  | TokenBudgetExit             # token 上限
  | PhaseRoundLimitExit         # 运行时全局轮数硬上限（runtime 注入而非模板声明）
)
```

`exit_conditions` 是数组：**任一条件先满足都触发结束事件**。

`PhaseRoundLimitExit` 不出现在 phase 模板里——它由引擎根据 `RoomRuntimeState.max_phase_rounds`（默认 3 轮，限额面板可调）注入，目的是给所有 phase 一个最终保险，避免无限轮转。其 `max` 字段在评估时还要叠加 `runtime.phase_extra_rounds`：用户在 phase exit banner 上点"再来一回合"会调用 `POST /rooms/{id}/phase/extend`，把这个计数器 +1，从而把所有 rounds-style 条件（含模板里的 `RoundsExit`）的目标值整体推后一轮。`phase_extra_rounds` 在每次 phase 切换时归零。

### 6.4 调度核心：`pick_next_speaker`

```python
async def pick_next_speaker(
    phase_instance: RoomPhaseInstance,
    room: Room,
    last_user_action: UserAction,
) -> NextSpeakerResult:
    """
    纯函数(v1 内部不调 LLM,async 是为未来留位)
    返回:
        - PersonaId            下一个发言者
        - WAIT_FOR_USER        等用户操作
        - PARALLEL([ids])      并行模式
        - PHASE_DONE           phase 完成
    """
```

每次决策在 trace 中记录输入与输出。

### 6.5 Phase 切换流程

```
[Phase X 进行中]
    │
    │ 任一 exit_condition 满足
    ▼
[发出 phase.exit_suggested 事件]
    │
    ├─ auto_transition=true  ──→ 自动执行默认下一步
    │
    └─ auto_transition=false ──→ 等用户从决策横幅选择
                                  ├─ "进入下一阶段"
                                  ├─ "再来一回合"      → 把 rounds 类条件 +1
                                  ├─ "切换到指定 phase" → 从 phase 库选
                                  └─ "继续(忽略提示)"  → 暂时压制本次提示
```

### 6.6 退出条件评估的并行性

```python
async def check_phase_exit(phase_instance, room):
    # 结构化条件:同步评估,毫秒级
    structural_results = [
        evaluate(cond, phase_instance, room)
        for cond in phase_instance.exit_conditions
        if cond.is_structural
    ]
    
    # 语义条件:由上帝副手在 facilitator_eval_task 中独立评估
    # 结果通过 facilitator_signals 表读取
    semantic_signal = read_latest_facilitator_signal(
        room.id, type="phase_exhausted"
    )
    
    if any(structural_results) or (semantic_signal and semantic_signal.fresh):
        emit_phase_exit_event(...)
```

### 6.7 跨 Phase 状态：派生而非聚合

所有 phase 内的聚合数据(已发言轮数、各人发言次数等)**不存中间状态**，需要时直接从 `messages` 表 group by `phase_instance_id` 算出。

### 6.8 Phase 切换语义

| 操作 | 语义 |
|------|------|
| 切换到下一个 phase | 当前 phase 实例标记完成，按 plan 创建下一个。messages 全保留 |
| 跳到指定 phase | 跳过中间 phase，被跳过的不创建实例 |
| 中途插入新 phase | 在 plan 当前位置后插入。下一次切换时进入它 |
| 切换赛制 | 加载新赛制的 phase 序列覆盖剩余 plan |
| 完全脱离赛制 | plan 不再绑定 format_id |

切换是**单向**操作，回退请用 fork 子房间。

Phase 不可嵌套、不可中途修改规则——简化实现：phase 实例进入运行后规则字段视为 immutable。

### 6.9 自由模式即统一 phase

"自由模式"在引擎层不是异类，就是普通 phase：

```python
PhaseTemplate(
    id="open",
    allowed_speakers="all",
    ordering_rule="mention_driven",
    exit_conditions=[{"type": "user_manual"}],
)
```

整个系统没有"赛制内/赛制外"代码分支。

### 6.10 代码量预估

| 组件 | 代码量 |
|------|-------|
| Pydantic 模型(所有模板对象) | ~600 行 |
| OrderingRule 实现(6 种) | ~300 行 |
| ExitCondition 评估器 | ~200 行 |
| pick_next_speaker | ~150 行 |
| Phase 切换流程 | ~200 行 |
| 内置 phase / format / persona 数据 | ~500 行 |
| **合计** | **~2000 行** |

---

## 7. LLM 调用层(LLMAdapter)

### 7.1 决策：LiteLLM + 自己的 LLMAdapter 包装

应用代码只见 `LLMAdapter`，不直接调 LiteLLM。

### 7.2 抽象边界

| 功能 | 由谁负责 |
|------|---------|
| Streaming 协议统一 | LiteLLM |
| Token 计数 + cost 计算 | LiteLLM(注意计费表延迟) |
| Tool calling 跨家兼容 | LiteLLM |
| 参数翻译(temperature / max_tokens / stop) | LiteLLM |
| 领域映射(Persona → params) | LLMAdapter |
| 专属参数路由(extended thinking / reasoning) | LLMAdapter |
| 错误统一处理 | LLMAdapter |
| 自定义日志 / trace 记录 | LLMAdapter |

### 7.3 接口定义

```python
class LLMAdapter:
    async def stream(
        self,
        persona: Persona,
        context: list[Message],
        max_tokens: int,
    ) -> AsyncIterator[StreamChunk]:
        litellm_messages = [self._to_litellm_message(m) for m in context]
        extra_params = self._build_extra_params(persona)
        
        response = await acompletion(
            model=persona.backing_model,
            messages=[{"role": "system", "content": persona.system_prompt}] + litellm_messages,
            max_tokens=max_tokens,
            temperature=persona.temperature,
            stream=True,
            **extra_params,
        )
        
        async for chunk in response:
            yield self._to_our_chunk(chunk)
    
    def _build_extra_params(self, persona: Persona) -> dict:
        if persona.backing_model.startswith("anthropic/") and persona.config.deep_thinking:
            return {"thinking": {"type": "enabled", "budget_tokens": 10000}}
        if persona.backing_model.startswith("openai/") and persona.config.deep_thinking:
            return {"reasoning_effort": "high"}
        return {}
    
    async def stream_with_tools(
        self,
        persona: Persona,
        context: list[Message],
        tools: list[ToolDefinition],
        max_tokens: int,
    ) -> ToolCallResult:
        """供书记官、副手用——强制结构化输出"""
        ...
```

### 7.4 已知限制

- Extended thinking / reasoning 跨家差异要 if/else 处理
- 错误细节经常以原 provider 字符串塞在 message 里
- JSON mode 对 Anthropic 是 prompt 注入模拟，结构化输出推荐用 tool calling
- 新模型支持有 1-2 周滞后

### 7.5 代码量

`LLMAdapter` 自身约 300 行(LiteLLM 已省了 streaming 兼容那部分)。

---

## 8. Streaming 与冻结

### 8.1 SSE 事件 schema

每个房间一条 SSE 长连接(浏览器→后端)。

```typescript
type SSEEvent =
  | MessageStreamingEvent      // chunk 透传,无攒批
  | MessageAppendedEvent       // 消息已落库
  | MessageCancelledEvent      // 冻结/limit/超时触发的取消
  | ScribeUpdatedEvent
  | FacilitatorSignalEvent
  | PhaseExitSuggestedEvent
  | PhaseExitContinuedEvent    // 用户点"继续讨论"，本次建议被忽略
  | PhaseExtendedEvent         // 用户点"再来一回合"，phase_extra_rounds += 1
  | PhaseTransitionedEvent
  | RoomFrozenEvent
  | RoomUnfrozenEvent
  | RoomDeletedEvent
  | PersonaInstanceUpdatedEvent
  | PersonaInstanceRemovedEvent
  | SystemErrorEvent

// LimitWarningEvent 已不再单独发：limit 接近阈值时由 facilitator 以
// `pacing_warning` tag 的 FacilitatorSignal 形式推出，复用 facilitator 的
// 严重度阶梯（info → suggest → warning → block），因此 UI 只需在
// FacilitatorSignal 上展示阈值告警，不再处理一个独立的 limit 事件。

interface MessageStreamingEvent {
  type: 'message.streaming'
  room_id: string
  message_id: string           // 临时 id,streaming 期间不变,append 后保持一致
  persona_id: string
  chunk_text: string
  chunk_index: number          // 单调递增,用于断线重连对齐
  cumulative_tokens_estimate: number  // 估算值,UI 加 "≈"
}

interface MessageAppendedEvent {
  type: 'message.appended'
  room_id: string
  message: Message             // 完整对象
  final_tokens: { prompt, completion }
  final_cost_usd: number
}

interface MessageCancelledEvent {
  type: 'message.cancelled'
  room_id: string
  message_id: string
  reason: 'frozen' | 'limit_exceeded' | 'user_skip' | 'timeout'
  partial_text: string
  partial_tokens: number
}
```

### 8.2 Chunk 透传策略

- 不攒批，LLM provider 的 chunk 直接转 SSE 推
- Cumulative tokens 走估算(字符数/4)，UI 加 "≈" 表示估算
- 普通 / autodrive 场景单房间无并发；parallel phase 以 `message_id` 分流，SSE 频率仍在 v1 可接受范围

### 8.3 Partial 处理

- 已生成部分作为 `truncated` 消息保存到 messages 表
- 标记 `truncated_reason` 字段
- Trace 完整记录 partial
- **不支持续写**——unfreeze 后 truncated 消息永远停在那儿

### 8.4 断线重连

```
SSE 连接断开
    ↓
前端 GET /rooms/{id}/state
    ↓
返回包含 in_flight_partial 字段(若有正在 stream 的消息)
    ↓
前端把 partial 当作初始状态渲染
    ↓
重新订阅 SSE,后端推送后续 chunk(从最新 chunk_index 起)
    ↓
前端按 chunk_index dedupe
```

不使用 SSE 的 `Last-Event-ID`(实现复杂度不值)。

### 8.5 冻结实现(Level 3)

```python
async def freeze_room(room_id):
    room = await db.get_room(room_id)
    runtime = await db.get_runtime(room_id)
    active_calls = active_calls_for_room(room_id)

    runtime.frozen = True
    
    # 1. 取消当前房间的所有 in-flight call
    for call in active_calls:
        call.cancel("frozen")
        # stream finally 块里处理 partial 保存与 message.cancelled SSE
    
    # 2. 写状态
    await db.update_room(room_id, status='frozen', frozen_at=now())
    
    # 3. 打快照
    await create_snapshot(room_id)
    
    # 4. 推 SSE
    event_bus.publish(room_id, "room.frozen", {})
```

### 8.6 超时

- Chunk 间隔 30 秒无新 chunk 视为挂死，自动 cancel
- 报错给用户，**不自动重试**
- 超时记录为 `truncated_reason='timeout'`

### 8.7 Streaming 中允许的操作

| 操作 | streaming 中 | 实现 |
|------|------------|------|
| 冻结 | ✅ | 取消 in-flight |
| 裁决 | ✅ | append 新 message |
| 修改 limit | ✅ | 立即生效，下次检查时使用新值 |
| @ 提及下一发言者 | ✅ | 通过新用户消息触发下一轮；`mention_driven` 会解析最新 @ |
| 伪装 / 切 phase / 切赛制 / 拉人设 | ❌ | 前端禁用按钮 |

### 8.8 Parallel 模式渲染

`parallel` ordering 下多个 AI 同时发言：

- 每个有独立的 SSE chunk 流，按 `message_id` 路由
- 前端同时显示多个"正在打字"指示器，每个 persona 一个气泡同时增长

---

## 9. 系统级角色实现

### 9.1 书记官触发

```python
async def maybe_trigger_scribe(room_id: str, latest_message: Message):
    runtime = active_rooms[room_id]
    runtime.messages_since_scribe += 1
    
    # 触发条件:每 5 条 OR phase 边界
    should_trigger = (
        runtime.messages_since_scribe >= 5
        or latest_message.message_type == 'phase_transition_marker'
    )
    
    if should_trigger:
        runtime.messages_since_scribe = 0
        asyncio.create_task(run_scribe_update(room_id))
```

### 9.2 书记官调用

```python
async def run_scribe_update(room_id: str):
    room = await load_room(room_id)
    scribe_persona = await get_scribe_for_room(room)
    current_state = await load_scribe_state(room_id)
    
    new_messages_since_last_fold = await load_messages_since(
        room_id, current_state.last_event_message_id
    )
    
    diff = await llm_adapter.stream_with_tools(
        persona=scribe_persona,
        context=[
            {"role": "system", "content": scribe_persona.system_prompt},
            {"role": "user", "content": render_scribe_input(current_state, new_messages_since_last_fold)},
        ],
        tools=[SCRIBE_UPDATE_TOOL],
    )
    
    new_state = apply_diff(current_state, diff)
    await save_scribe_state(room_id, new_state)
    
    event_bus.publish(room_id, "scribe.updated", new_state)
```

### 9.3 上帝副手触发

跟书记官类似但独立计数：

```python
async def maybe_trigger_facilitator(room_id, latest_message):
    runtime = active_rooms[room_id]
    runtime.messages_since_facilitator += 1
    
    should_trigger = (
        runtime.messages_since_facilitator >= 5
        or latest_message.message_type == 'phase_transition_marker'
        or runtime.user_requested_facilitator
    )
    
    if should_trigger:
        runtime.messages_since_facilitator = 0
        asyncio.create_task(run_facilitator_eval(room_id))
```

### 9.4 上帝副手输出去向

副手产出的 `FacilitatorEvaluation` 同时落三处：

1. `facilitator_signals` 表(结构化)
2. **作为 meta message 进 messages 表**：`message_type=facilitator_signal`、`visibility_to_models=false`、`visibility=observer_only`
3. SSE 推送给前端

### 9.5 副手对历史的"半失忆"

- 看 context：最近 N 条消息(默认 50) + 自己最近 N 次输出(防止重复推送)
- 引擎 cooldown：同 tag 在 N 轮内不重复推送

### 9.6 群友发言 / 伪装的处理

当前 UI 把该能力表现为“群友发言”：用户输入一个临时昵称并投放一条讨论消息，不需要选择已存在的 AI persona。后端仍保留旧的 persona 伪装字段用于兼容和审计。

书记官、副手都不知情群友发言。它们看到的是普通可见讨论消息(role / 内容 / 时序无差异)。AI 可能反向推断身份，作为产品特性接受，不做对抗。

---

## 10. 核心循环伪代码

```python
async def run_room_turn(room_id: str, trigger: UserAction):
    room = load_room(room_id)
    if room.frozen:
        return

    # 1. 调度
    result = await pick_next_speaker(
        phase_instance=room.current_phase,
        room=room,
        requested_persona_id=trigger.requested_persona_id,
    )
    
    if result.kind == "wait":
        return
    if result.kind == "phase_done":
        await emit_phase_exit_event(room)
        return
    if result.kind == "parallel":
        await asyncio.gather(*[
            stream_one_persona(room_id, persona_id)
            for persona_id in result.persona_ids
        ])
        return
    
    # 2. 构造 context (应用 visibility 过滤,得到 AI 视图)
    persona_id = result.persona_ids[0]
    context = build_ai_context(persona_id, room.messages, room.scribe_state)
    
    # 3. 调用 LLM (streaming)，并按 room_id + message_id 注册 in-flight
    in_flight = LLMCall(persona_id, context, max_tokens=room.config.max_message_tokens)
    register_active_call(room_id, in_flight.tmp_message_id, in_flight)
    
    try:
        async for chunk in in_flight.stream():
            event_bus.publish(room_id, "message.streaming", {
                "message_id": in_flight.tmp_message_id,
                "chunk_text": chunk.text,
                "chunk_index": chunk.index,
                "cumulative_tokens_estimate": estimate_tokens(in_flight.partial_response),
            })
            in_flight.partial_response += chunk.text
            
            # 实时检查 limit
            if exceeds_limit(room_id, in_flight):
                await in_flight.cancel(reason='limit_exceeded')
                break
            
            # 检查 chunk 间隔超时
            if time_since_last_chunk(in_flight) > 30:
                await in_flight.cancel(reason='timeout')
                break
        
        # 5. 落库
        msg = await append_message(
            room_id, speaker,
            content=in_flight.partial_response,
            truncated_reason=in_flight.cancelled_reason,
        )
        event_bus.publish(room_id, "message.appended", msg)
        
        # 6. 触发书记官 / 副手 cadence、phase exit 检查、以及 autodrive guard
        await after_message_appended(room_id, msg)
        
    finally:
        unregister_active_call(room_id, in_flight.tmp_message_id)


async def maybe_autodrive_after(room_id: str, just_appended: Message):
    if just_appended.author_actual != "ai" and just_appended.message_type in USER_DRIVEN_TYPES:
        if not autodrive_lock(room_id).locked() and not active_calls_for_room(room_id):
            asyncio.create_task(run_room_turn(room_id, trigger=None))
```

---

## 11. Trace 系统

### 11.1 设计目标

v1 只做**完整记录**，不做分析与查询 UI。trace 是 append-only，事后补不上。

### 11.2 记录的事件类型

| 事件类型 | 何时记录 |
|---------|---------|
| `user_action` | 用户操作(@提及、verdict、masquerade、limit、phase 切换、冻结) |
| `masquerade_started` | 用户切入伪装 |
| `masquerade_message_submitted` | 用户在伪装下发消息(完整内容) |
| `masquerade_revealed` | 用户事后揭示某条伪装 |
| `scheduling_decision` | 每次 pick_next_speaker 的输入和输出 |
| `llm_call_started` | LLM 调用前(完整 prompt) |
| `llm_call_completed` | LLM 完成(完整 response、token、耗时) |
| `llm_call_cancelled` | 冻结 / limit / 超时取消 |
| `scribe_update` | 书记官 fold 的输入(diff)和输出(新 ScribeState) |
| `facilitator_signal` | 副手每次评估(无论是否产生信号) |
| `phase_transition` | phase 切换的触发原因、决策路径 |
| `state_mutation` | room 状态变更 |
| `event_published` | 推给前端的 SSE 事件 |

### 11.3 两层存储

```
Postgres: trace_events 表
  id, room_id, event_type, timestamp, summary, payload_ref
  
本地文件 / 对象存储: trace_payloads/{room_id}/{event_id}.json
  完整的 prompt、response、ScribeState 快照等
```

### 11.4 统一写入入口

```python
async def trace_record(
    room_id: str,
    event_type: TraceEventType,
    summary: str,
    payload: dict | None = None,
):
    """
    异步写入,不阻塞主流程。
    大 payload 写文件,DB 仅存元数据。
    """
```

所有需要 trace 的代码必须通过此入口，**调用方不感知存储细节**。

### 11.5 性能

- 异步 batch flush(每秒一次或缓冲满)
- 大 payload 写文件失败不阻塞主流程，仅记 DB 元数据(降级)
- 单房间预计 5–10 events/分钟，QPS 极低

### 11.6 v1 不做

- Trace 查询 UI
- 重放工具
- Diff 比对
- 质量评估指标

---

## 12. 前端架构

### 12.1 技术栈

| 层 | 选型 |
|----|------|
| 构建 | Vite |
| 框架 | React 18 + TypeScript |
| 路由 | react-router-dom v6 |
| UI 组件 | shadcn/ui (Radix + Tailwind) |
| 状态管理 | TanStack Query + Zustand |
| SSE | @microsoft/fetch-event-source |
| 拖拽 | dnd-kit |
| 虚拟滚动 | react-virtuoso |
| 表单 | react-hook-form + zod |
| 类型同步 | OpenAPI → openapi-typescript |
| 样式 | Tailwind |
| Markdown | react-markdown + remark-gfm + shiki + katex |
| 测试 | Vitest + React Testing Library |

### 12.2 路由结构

```
/                       登录后默认到 dashboard
/dashboard              房间列表 + 模板入口
/rooms/:id              三栏聊天主界面(房间列表 / 消息 / 成员)
/rooms/:id/sub/:subId   子房间
/templates/personas     人设模板管理
/templates/phases       phase 模板管理 + 编辑器
/templates/formats      赛制模板管理
/templates/recipes      房间配方管理
/settings               账号 / limit 设置
/trace/:roomId          (留空,v1 不做)
```

### 12.3 状态管理分工

- **TanStack Query**：服务端状态(rooms, messages, templates, scribe states)
- **Zustand**：UI 全局状态(当前房间 id、AI 视图开关、暗色模式、草稿)
- **React 本地 state**：组件内临时状态

### 12.4 SSE 数据流

```
SSE 事件到达
  ↓
SSE manager hook
  ↓
按事件类型分发:
  - message.streaming → 按 room_id + message_id push chunk 到 Zustand
  - message.appended → invalidate messages query (TanStack Query)
  - message.cancelled → clear streaming bubble + invalidate room query
  - facilitator.signal → invalidate signals query
  - room.frozen → invalidate room query
```

streaming chunks 走 Zustand(临时高频)，落库后的 message 走 TanStack Query(可缓存可分页)。

### 12.5 暗色模式

shadcn CSS 变量方案 + toggle，状态走 Zustand 持久化(localStorage)。

### 12.6 Markdown 渲染

- `react-markdown` + `remark-gfm`(代码块、表格、删除线)
- `shiki` 代码高亮
- `katex` LaTeX 数学公式
- 不做 Mermaid(留 v2)

### 12.7 前端代码量

v1 前端核心代码 8000–12000 行。

### 12.8 桌面壳

桌面壳放在 `frontend/src-tauri/`，使用 Tauri v2 承载 `frontend/dist`。后端通过 PyInstaller 打成 `mai-backend-<target-triple>` sidecar，由 Tauri shell 启动并传入临时本地端口。前端 API base 的优先级是：

```text
window.__MAI_API_BASE__ → VITE_API_BASE → /api
```

这让桌面应用不需要固定 8000 端口，也不需要用户手动启动后端。打包脚本：

```powershell
.\scripts\build-sidecar.ps1
.\scripts\package-tauri.ps1
```

本机打包前需安装 Rust/Cargo、Microsoft C++ Build Tools 和 WebView2 Runtime；完整清单见 `desktop_tauri.md`。

---

## 13. 文档上传

### 13.1 v1 必做

- 用户拖入 MD / TXT / PDF 文件
- 后端 `/upload` endpoint 提取文本
- 提取后纯文本作为 user 类型 message append
- AI 看到纯文本,不看原文件

### 13.2 实现

```
POST /upload
  multipart/form-data: file
  → 后端用 pypdf / 直接读文本
  → 存 uploads 表(原文件 + 提取文本)
  → 返回 upload_id

POST /rooms/{id}/messages/from_upload
  body: { upload_id }
  → append 一条 message_type='user_doc' 消息
  → content 是提取的文本
```

### 13.3 v1 不做

- 图片 / 多模态
- OCR(扫描版 PDF)

---

## 14. 已决策清单

| # | 决策 | 结论 |
|---|------|------|
| - | 框架选型 | 不用 LangGraph，FastAPI 单进程 |
| - | 房间运行时状态 | 进程内存 + 数据库双写；SQLite 默认、PostgreSQL 可选 |
| - | ScribeState 存储 | jsonb 当前态 + 增量 fold |
| - | 消息存储 | 严格 append-only |
| - | In-flight 状态 | 仅内存，按 room + message 跟踪 |
| - | Autodrive | 用户消息后自动触发一次 persona 回复，AI 回复不递归触发 |
| 1 | Streaming chunk | 透传无攒批 |
| 1 | 断线重连 | GET state + 重订阅,不用 Last-Event-ID |
| 1 | Cumulative tokens | 估算值 + UI "≈" 标记 |
| 1 | Parallel 渲染 | 多气泡同时打字 |
| 1 | 超时 | 30 秒无 chunk → cancel + 报错,不重试 |
| 2 | 多模型 API | LiteLLM + 自己 LLMAdapter 包装 |
| 3 | 冻结级别 | Level 3(in-flight + 后台 tasks) |
| 3 | Partial 处理 | 保存为 truncated message |
| 3 | Unfreeze 续写 | 不支持,truncated 永远停在那 |
| 4 | 伪装渲染 | AI 视图按一般 AI 处理 |
| 4 | 伪装计费 | 字符数 × 固定费率 |
| 4 | AI 反推身份 | 不对抗,作为狼人杀特性 |
| 4 | 揭示语义 | 仅用户视图标记,不改 AI context |
| 5 | 书记官触发 | 每 5 条 + phase 边界 |
| 5 | 书记官输出 | ScribeState diff via tool calling |
| 5 | 书记官身份 | Persona kind=scribe |
| 6 | 副手触发 | 每 5 条 + phase 边界 + 用户主动询问 |
| 6 | 副手输出 | tag 集合 via tool calling |
| 6 | 副手身份 | Persona kind=facilitator |
| 6 | 副手信号留痕 | 作为 meta message 进 messages 表 |
| 6 | 副手控制书记官 | 不允许，独立 |
| 7 | 前端框架 | Vite + React + TypeScript |
| 7 | UI 库 | shadcn/ui + Tailwind |
| 7 | 状态管理 | TanStack Query + Zustand |
| 7 | 暗色模式 | v1 做 |
| 7 | 移动端 | 不适配 |
| 7 | Markdown | 富格式 + LaTeX |
| 7 | 文档上传 | v1 做(MD/TXT/PDF) |
| 7 | 图片上传 | v1 不做 |
| 7 | 分享链接 | v1 不做 |
| 8 | Schema 真理来源 | 后端 Pydantic |
| 8 | 多态字段 | discriminated union |
| 8 | 版本演进 | 加法兼容 + schema_version |
| 8 | Draft 状态 | 字段加,功能不实现 |
| 8 | Fork 关系 | 字段记录,功能不实现 |
| 8 | Format 引用 Phase | 锁定版本号 |
| 8 | ID 格式 | UUID v7 |
| 8 | 命名风格 | snake_case 贯穿 |
| 8 | Null 处理 | 字段缺失 |
| 8 | 时间格式 | ISO 8601 |
| 8 | 导入导出 | 仅导出,导入 v1 不做 |
| 8 | 三层校验 | 前端实时 + 保存前 + 后端 |
| 8 | 模板 Tag | 做(GIN 索引) |
| 8 | Runtime Tag | 不做 |
| 9 | 桌面壳 | Tauri v2 + PyInstaller sidecar，Windows NSIS 安装包已构建验证 |

---

## 15. 代码量预估总览

| 模块 | 行数 |
|------|------|
| Pydantic 模型 + Schema | ~600 |
| 调度引擎(OrderingRule / ExitCondition / pick_next_speaker / phase 切换) | ~850 |
| 内置模板数据(phase / format / persona) | ~500 |
| LLMAdapter | ~300 |
| 书记官 / 副手 / Scribe Update | ~400 |
| 核心循环 + 房间生命周期 | ~600 |
| FastAPI routes | ~800 |
| SSE 推送层 | ~300 |
| Trace 系统 | ~300 |
| 文档上传 + 文本提取 | ~200 |
| DB migration / SQLAlchemy 模型 | ~500 |
| 工具函数 / 测试支持 | ~500 |
| **后端合计** | **~5800 行** |
| **前端合计** | **~10000 行** |
| **总计** | **~15800 行** |

v1 是个**单人 1.5–3 个月可达成的项目**(全职估算)。

---

## 16. 开发顺序建议

按这个顺序起步可以最快跑出可演示的雏形：

1. **数据库 schema + Pydantic 模型** —— 结构先行
2. **LLMAdapter** —— 隔离三家 SDK 复杂度
3. **最简房间 + 单一 phase + 自由模式** —— 先跑通核心循环(无书记官/副手)
4. **Streaming + SSE + 前端基础渲染** —— 让"AI 真的在说话"
5. **冻结 + limit** —— 安全兜底
6. **更多 phase + 调度规则 + 切换** —— 产品骨架
7. **书记官** —— 让 ScribeState 活起来
8. **裁决者权限 + decisions 表**
9. **上帝副手 + 决策横幅**
10. **伪装人设权限**
11. **子讨论 + merge-back**
12. **可视化编辑器(phase / persona / format)**
13. **文档上传**
14. **Trace 系统**(虽然 #14 但写入逻辑要从 #1 就内建,这里是收尾让 trace 完整)
15. **打磨 + UI 细节**

每一步都能 demo，不用憋大招。
