# Story World 设计文档

> 状态：设计草案，待 review。新增功能分支：`feature/story-world`。
> 配套阅读：`product_design.md`、`technical_design.md`、`personas.md`、`CLAUDE.md`。

## 1. 背景

当前的 Room + Persona 模型已经能让多个 AI 在一个房间里按人设对话，story phase（`story_mode` + `story_format`）已经把"一幕戏"的节奏跑通：连续推进、不衰减、`<silent/>` 反向规则。但用户反馈两个核心缺失：

1. **没有跨房间的"世界"**——每次都得重新介绍背景、关系、过往。
2. **角色没有记忆**——上一幕里建立起来的羁绊、恩怨、承诺，下一幕全部归零。

Story World 在现有 Room 之上抽出一层 `World`，把 Room 重新定位为该世界中的一幕 `Scene`，并给 World 自己的角色一条跨场景的记忆线。

## 2. 设计决策（已锁定）

| # | 决策 | 锁定值 |
|---|---|---|
| D1 | World 的存在形式 | 新一级实体（不是 Room 上加字段） |
| D2 | 角色档案归属 | World 自带 `WorldCharacter`（不是复用 PersonaInstance） |
| D3 | Scene 与 Room 的关系 | Scene = Room + `world_id` + `scene_index` |
| D4 | 时间线 | 严格线性，单调递增 `scene_index`，不允许分支 |
| D5 | 用户参与方式 | 用户可扮演任意 `kind=user` 角色；Composer 加 "speak as" 选择器 |
| D6 | 空白角色 | World 可创建 `kind=user` 的轻档案角色，由用户驱动，不接 LLM |
| D7 | 角色名册 | 显式勾选——创建 Scene 时挑选本幕在场角色 |
| D8 | 技能系统 v1 | 纯文本字段进 system prompt，不挂 tool |
| D9 | 记忆模型 | 三层：core_identity / episodic / relationships |
| D10 | 记忆产出时机 | 场景 freeze（or 显式"封幕"）时跑 per-character scribe |

## 3. 不变量

### 3.1 继承自现有系统（不能破坏）

- **append-only**：Scene 内消息、verdict、revoke 仍然只追加。
- **单进程 + ACTIVE_CALLS 跟踪**：Scene 是 Room，所有 freeze / cancel 行为不变。
- **Speakers 是 picked**：`pick_next_speaker` 不变，但路由集合受 Scene 名册收窄。
- **built-ins 是内容**：World 模板（如果做）也走 `seed.py` + `builtin_id()`，read-only。

### 3.2 新增

- **N1 World 是 Room 的容器**：删除 World 必须级联删除其所有 Scene 和 Character。删除单个 Scene 不影响 World。
- **N2 scene_index 单调**：同一 World 内 `scene_index` 唯一且递增。新 Scene 总是 `max + 1`。
- **N3 角色记忆只在 Scene 之间流动**：Scene 进行中产出的消息不会实时改写其他 Scene 的记忆；记忆固化发生在"封幕"。
- **N4 user 角色没有 episodic 管线**：用户的记忆是用户自己的，系统只存档案 + 关系卡片（关系卡片由 AI 角色单边维护）。
- **N5 入场/离场是 append-only 事件**：Scene 内允许角色中途加入或离开，但每次进出都写一条 `participant.enter` / `participant.exit` 系统消息（visible to models）。每个角色每个 Scene 至多一次进、一次出（v1 不支持回流）。`world_scene_members` 行的 `entered_at_message_id` / `exited_at_message_id` 锁定该角色的"在场区间"，所有记忆/关系/路由都基于这个区间。

## 4. 数据模型

### 4.1 新增表

```python
class World(Base):
    __tablename__ = "worlds"
    id: str(36) PK
    owner_user_id: str(36) | None
    name: str(200)
    synopsis: text                    # 世界观简介，进每个 Scene 的 system prompt 头部
    setting: text                     # 时代/地点/规则等长文，可选
    cover_color: str(16) = "#3b82f6"  # 列表卡片着色
    cover_icon: str(48) = "Globe"
    calendar_hint: text = ""          # 自由文本，描述本世界的纪年法/历法
                                      # 例："现代公历" / "玄苍纪元，一年三百日，每日十二时辰"
                                      # 仅作为 prompt 上下文，系统不解析
    status: str(32) = "active"        # active | archived
    config: JSONType = {}             # 预留：默认 phase / format / 记忆参数
    created_at, updated_at

class WorldCharacter(Base):
    __tablename__ = "world_characters"
    id: str(36) PK
    world_id: FK worlds.id ON DELETE CASCADE, indexed
    kind: str(16)                     # "ai" | "user"
    name: str(120)
    identity: str(120) = ""           # 短头衔/称谓，与 PersonaTemplate.identity 同义
    brief: text = ""                  # 简介，每场都进 prompt
    # AI 角色专属
    persona_template_id: FK persona_templates.id | None  # kind=ai 必填
    persona_template_version: int | None
    backing_overrides: JSONType = {}  # 可选覆盖模型/温度（v1 留空字段）
    # 外观（独立于 PersonaTemplate，允许 World 内统一风格）
    color: str(16)
    icon: str(48)
    # 角色档案——记忆的"core"层
    core_identity: text = ""          # 长留性格设定，每场都进 prompt
    skills_text: text = ""            # v1 纯文本技能描述
    goals_text: text = ""             # 当前目标，可在场景之间手动编辑
    # 状态
    status: str(32) = "active"        # active | retired
    config: JSONType = {}
    created_at, updated_at

class WorldCharacterMemory(Base):
    """Episodic 记忆条目，per character。AI 角色由 scene-end scribe 写入；
    user 角色不写。手动编辑允许（用户作为'导演'可以加 backstory）。"""
    __tablename__ = "world_character_memories"
    id: str(36) PK
    world_character_id: FK world_characters.id ON DELETE CASCADE, indexed
    source_scene_id: FK rooms.id | None     # NULL = 手写 backstory
    scene_index_at_write: int | None        # 用于按时间线排序/过滤
    in_world_time_at_event: text = ""       # 从 source_scene.in_world_time_start 拷贝，让 prompt 能体现时间感
    kind: str(32)                            # "episode" | "impression" | "vow" | "fact" | "backstory"
    content: text
    salience: float = 0.5                    # 0..1，影响 retrieval 排序
    created_at
    # 索引：(world_character_id, scene_index_at_write desc)

class WorldCharacterRelation(Base):
    """A 视角下对 B 的关系卡片。单向，AI 角色单边维护；user 角色作为 B 可以是被指向方。"""
    __tablename__ = "world_character_relations"
    id: str(36) PK
    from_character_id: FK world_characters.id ON DELETE CASCADE, indexed
    to_character_id: FK world_characters.id ON DELETE CASCADE, indexed
    label: str(64) = ""                       # "盟友" | "宿敌" | "暗恋" | ...
    sentiment: float = 0.0                    # -1..+1
    notes: text = ""                          # 自由文本，每幕末由 scribe 折叠
    last_updated_scene_id: FK rooms.id | None
    updated_at
    UniqueConstraint(from_character_id, to_character_id)

class WorldSceneMember(Base):
    """Scene 在场名册（D7 + N5）。和 RoomPersona 不同的是它指向 WorldCharacter
    而不是 Persona。RoomPersona 仍然存在以兼容非 World 房间。

    在场区间由 entered_at_message_id 和 exited_at_message_id 标定：
      - entered_at_message_id IS NULL → 自 Scene 开幕起在场
      - exited_at_message_id IS NULL → 仍在场
    每个 (scene, character) 只有一行——v1 不支持回流。"""
    __tablename__ = "world_scene_members"
    scene_id: FK rooms.id PK
    world_character_id: FK world_characters.id PK
    role_in_scene: text = ""                  # 可选：本幕特定的处境提示
    speak_as_user: bool = False               # kind=user 时此 scene 是否由用户控制
    entered_at_message_id: FK messages.id | None
    exited_at_message_id: FK messages.id | None
    joined_at
```

### 4.2 Room 的扩展

只加两列，行为完全向后兼容：

```python
# rooms 表 ADD COLUMN（写进 db.py::_ADDED_COLUMNS）
world_id: FK worlds.id | None        # NULL = 普通讨论房（旧行为）
scene_index: int | None              # NULL 同上；非空时 (world_id, scene_index) UNIQUE
in_world_time_start: text = ""       # 本幕开始时的"故事内时间"，自由文本
                                     # 例："第七日 黄昏" / "2025-03-15 20:00"
in_world_time_end: text = ""         # 本幕结束时的"故事内时间"，可选
in_world_duration_hint: text = ""    # 例："约持续两小时"，纯叙事
sealed_at: timestamp | None          # 封幕时间戳；NULL = 未封幕
```

时间字段的语义：
- 系统**不解析**这些字段，只透传到 prompt（例如 "本幕的时间：{start}"）和 timeline UI
- **建议**新 Scene 的 `in_world_time_start >= 上一幕的 in_world_time_end`，但不强制（World 级别开关 `config.enforce_time_monotonic`，默认 False）
- 时间线 UI 可在前端做"距上一幕"的人类可读估算——但这是展示，不是模型契约
- Episodic 记忆条目带 `in_world_time_at_event`（从 source_scene 的 `in_world_time_start` 拷贝），让记忆 prompt 能呈现"很久以前"/"昨天" 这种时间感

`world_id IS NULL` 的房间走全部现有行为。`world_id IS NOT NULL` 的房间是 Scene，触发新分支：
- 名册取自 `world_scene_members` 而不是 `room_personas`
- system prompt 注入 World synopsis + character core_identity + relations + retrieved episodic
- Scene 封幕时跑 per-character memory scribe

### 4.3 PersonaInstance 的位置

**保留不动。** Scene 仍然为每个在场 AI 角色创建一个 `PersonaInstance`，但创建时从 `WorldCharacter` 拷贝快照（而不是从 `PersonaTemplate`），并把 system_prompt 拼接好（template prompt + core_identity + skills + relevant memory snapshot）。这样 engine 完全无感——它看到的还是 PersonaInstance。

`PersonaInstance` 加一列：

```python
world_character_id: FK world_characters.id | None
```

让 engine 在做记忆查询时能反查回 character。

## 5. 记忆管线

### 5.1 三层结构

| 层 | 容量 | 进入 prompt 的方式 | 写入时机 |
|---|---|---|---|
| **core_identity** | ~500 字 | 每场都进，固定位置 | 创建/手动编辑 |
| **relationships** | 同场角色 × ~100 字 | 仅同场角色之间互相进，B 视角不会进 A 的 prompt | 每幕末 scribe |
| **episodic** | 全部存档，retrieval top-K（默认 8） | 排序入 prompt | 每幕末 scribe |

**core** 是人写的（创建时填，可以让 LLM 起草，但用户拍板）。**relationships** 和 **episodic** 是 LLM 写的。

### 5.2 Episodic 检索（v1 用 BM25）

不引入 embedding 依赖，v1 用 SQLite FTS5 / Postgres `tsvector` 做关键词检索，输入是"本幕已发生的消息 + 在场角色名 + 当前 scene synopsis"，retrieval target 是该角色的 episodic 条目。Top-K 按 `salience * recency_decay * bm25_score` 排序。

> v2 候选：换成 embedding（litellm 已支持，可以复用 ApiProvider 配置）。

### 5.3 Scene-end scribe

Trigger：
- 用户显式封幕（`POST /worlds/{id}/scenes/{scene_id}/seal`）
- Room freeze 后 5 秒内若仍未封幕，给一个"是否封幕并产出记忆"的 UI 提示（**不**自动封幕——封幕是不可逆操作）

Pipeline（per AI character）：

```
input:
  - 该角色"在场区间内"的所有消息（按 entered_at_message_id..exited_at_message_id 切片）
  - 该角色当前 episodic top-N（避免重复入库）
  - 与该角色"同时在场"过的角色名单（区间相交即算）
  - 该角色对每个上述角色的现有 relationship 卡片

LLM 调用（tool-call 强约束 schema）：
  output: {
    new_episodes: [{kind, content, salience}],
    impressions:  [{about_character_id, sentiment_delta, label, notes_append}],
    vows:         [{content, salience}],          # 承诺/誓言/约定，高 salience
    skill_changes: [{added: [...], dropped: [...]}],   # v1 仅人写，留 schema 占位
  }
```

写入：所有条目 idempotent（同一 source_scene_id 已封幕过则拒绝重复跑），失败可手动重跑。

### 5.4 上下文预算与"遗忘"

OpenClaw 的教训：episodic 无限增长 → retrieval 退化 → context 爆炸。对策：

1. **每角色 episodic 硬上限**（默认 200 条）。超限时跑"压缩"：把最旧的 K 条按时间窗口折叠成一条 `kind=fact` 的总结，标记 salience=0.3。
2. **Salience 单调下降**：每过 N 个 scene，未被检索命中的条目 salience × 0.95。低于 0.05 的进入"冷藏"——还能搜到但不会自动入 prompt。
3. **手动编辑入口**：用户作为导演可在 World 管理界面查看/编辑/删除任意角色记忆。

## 6. Engine 改动

需要改的地方很小：

1. **`pick_next_speaker`**：当 Room 是 Scene 时，speaker 候选集来自 `world_scene_members` **过滤为当前在场**（`exited_at_message_id IS NULL` 且 `entered_at_message_id` 已发生）。`kind=user` 角色被视为"必须等用户"——出现在轮转里时变成 `wait` + 标记 `expected_user_character_id`。
1.5. **入场/离场动作**：新增两个消息 kind：`participant.enter` / `participant.exit`，由路由 `POST /rooms/{rid}/scene/enter` / `/exit` 触发。两个动作都：(a) 追加一条系统消息（`role=system`，`visibility_to_models=True`，content 形如 "X 走进了房间" / "X 离开了"）；(b) 更新对应 `WorldSceneMember` 行的 entered/exited 指针。在场角色看到入场/离场消息后，下一轮发言会自然反应（不需要特殊 prompt 注入）。

   **消息作者来源（双轨）**：UI 给两个入口——
   - 用户直接填一句话（默认）
   - 点 "让 AI 帮我描述这个动作"，调用一个轻量 LLM（沿用 Scene 的默认模型，prompt 带 World synopsis + 当前 Scene 状态 + 进/出动作类型 + 角色 brief），LLM 产出候选文案，用户编辑确认后再落库

   两条路径最终写入同一种消息，落库后无差别。
2. **`_build_messages` / system prompt 拼接**：在现有 system prompt 前面 prepend：
   ```
   ## 世界
   {world.synopsis}

   ## 你是谁
   {character.name}（{character.identity}）
   {character.core_identity}
   技能：{character.skills_text}
   当前目标：{character.goals_text}

   ## 相关记忆
   {top-K episodic, 时间倒序}

   ## 在场的人和你的关系
   - {peer.name}：{relation.label}（{relation.notes}）
   ...
   ```
3. **Scene-end hook**：`freeze_room` 路径之后发布 `scene.freeze_completed` 事件，前端弹"封幕"按钮。封幕走独立路由。

`autodrive`、`scribe`（Scene 内的，跟 character memory 是两回事）、`facilitator` 全部不动。

## 7. API 草图

```
GET    /worlds                              列表（带角色数、场景数、最后活动时间）
POST   /worlds                              创建
GET    /worlds/{id}                         详情（角色 + 场景列表）
PATCH  /worlds/{id}                         编辑 synopsis/setting
DELETE /worlds/{id}                         级联删除（强确认）

POST   /worlds/{id}/characters              创建 character
PATCH  /worlds/{id}/characters/{cid}        编辑（含 core_identity / skills / goals）
DELETE /worlds/{id}/characters/{cid}        软删除（status=retired），保留历史记忆
GET    /worlds/{id}/characters/{cid}/memories
PATCH  /worlds/{id}/characters/{cid}/memories/{mid}
DELETE /worlds/{id}/characters/{cid}/memories/{mid}

POST   /worlds/{id}/scenes                  body: { title, synopsis, member_ids[], speak_as_user_for[] }
                                            内部：创建 Room（world_id + scene_index = max+1）
                                            + WorldSceneMember 记录
                                            后续路由全部复用现有 /rooms/{room_id}/...
POST   /rooms/{rid}/seal                    封幕：触发 scene-end scribe，状态 → sealed
GET    /worlds/{id}/timeline                所有 scene 按 scene_index，含一句话摘要
```

`POST /rooms/{rid}/turn` 的 body 加可选字段 `as_character_id`——用户在多个 user 角色都属于自己时指明这次以谁的身份发言。

## 8. 前端结构草图

```
frontend/src/pages/
  WorldListPage.tsx              # 与 RoomListPage 平级，左 rail 加入口
  WorldPage.tsx                  # 三栏：[角色列表] [时间线 + Scene 卡片] [世界设定]
  world/
    CharacterEditor.tsx          # core_identity / skills / goals / 外观
    CharacterMemoryPanel.tsx     # 列表 + 编辑 + 删除
    SceneCreator.tsx             # 名册勾选 + speak-as 选择
    TimelineColumn.tsx           # 严格线性的场景列表，状态 active|sealed
  RoomShell.tsx                  # 仅做小改造：检测 world_id，title bar 显示
                                 # "世界 / 第 N 幕"，Composer 多 speak-as 选择器

frontend/src/components/
  WorldIcon.tsx                  # 复用 PersonaIcon 的 lucide 集
```

## 9. 迁移路径

### 9.1 数据迁移

无需 backfill：World 是新概念，旧 Room（`world_id IS NULL`）行为完全不变。

需要：
- `db.py::_ADDED_COLUMNS` 加 `rooms.world_id`、`rooms.scene_index`、`persona_instances.world_character_id`
- 新表通过 `Base.metadata.create_all` 创建
- 内置示例 World（一个示范世界 + 3 个角色 + 1 个空场景）走 `seed.py`，可选——v1 可以不内置

### 9.2 PR 拆分

| PR | 范围 | 风险 |
|---|---|---|
| **PR 1** | 数据模型 + 路由（World / Character CRUD，无 Scene） | 低，纯增量 |
| **PR 2** | Scene 创建 + 名册 + 入场/离场动作 + engine prompt 拼接（**还没记忆**） | 中，要测好 PersonaInstance 创建路径 + 在场区间过滤 |
| **PR 3** | Scene-end scribe + episodic 写入 + retrieval 入 prompt | 中高，prompt 长度要管控 |
| **PR 4** | Relationships 维护 + UI 展示 | 低 |
| **PR 5** | 记忆压缩 / 衰减 / 手动编辑 UI | 低 |
| **PR 6** | speak-as 用户角色 + Composer UI | 中 |

每个 PR 都能独立合并、独立 ship。PR 1+2 之后用户已经能跑"无记忆的连续场景"，价值已经为正。

## 10. v2 候选（已记录，不在 v1 范围）

- **世界事件广播器（"报社"）**：系统角色，定期向 World 发布事件消息，可作为 episodic 的另一个写入源。可能形态：(a) 内置系统 character，scene 间可被触发；(b) MCP tool，让在场角色主动 query "最近世界发生了什么"。
- **角色回流**：v1 一个角色每个 Scene 至多进出一次。v2 改成 `WorldSceneMemberEvent` 事件流，支持反复进出。
- **时间线分支**：if/else 走向，what-if 沙盒。
- **Embedding-based retrieval**：替换 BM25。
- **角色情绪状态机**：current_mood 字段，影响发言风格。
- **多用户协作**：多人各扮一个 user 角色。
- **从 Scene 导出小说稿**：复用现有 markdown 导出，加章节化排版。
- **Skills 升级到 tool**：当前 skills_text 是纯描述，v2 可让 skill 关联到一个 MCP tool（"剑术" → 触发战斗判定 tool）。

## 11. 风险与开放问题

- **风险 R1**：scene-end scribe 失败/超时怎么办？方案：封幕状态机 `unsealed → sealing → sealed | sealing_failed`，sealing_failed 可重试。封幕期间不允许新场景以同一角色名册开启（防止读到一半的记忆）。
- **风险 R2**：用户中途修改 character.core_identity，已经写好的 episodic 是否要重算？v1 不重算（记忆是历史事实）。UI 上提示"修改 core 不影响已有记忆"。
- **风险 R3**：删除 character 时，其他角色 relationships 卡片里的引用怎么处理？方案：软删除（status=retired），关系卡片保留（"已离场"标记）。
- **风险 R4**：同一 PersonaTemplate 被多个 World 用，PersonaTemplate 编辑会不会污染？不会——`WorldCharacter` 已经做了字段拷贝（color/icon/identity），唯一动态依赖的是 `system_prompt`。考虑加 `persona_template_version` 锁定，PersonaTemplate 升级时给 World 一个"是否同步新版"提示。
- **已定 Q1**：Scene 默认走 `story_format`（复用现有 `story_mode` phase + 反向 `<silent/>` + 无衰减行为）。不再造新 phase。
- **已定 Q2**：Scene 内默认**关闭** Room scribe（事实/共识那个）。`run_scribe_update` 在 `world_id IS NOT NULL` 的房间里早退；character memory scribe 是唯一的折叠路径。
- **已定 Q3**：World 有真实时间概念，落在 `in_world_time_start` / `in_world_time_end` / `in_world_duration_hint` 字段（见 §4.2）+ World 的 `calendar_hint`（见 §4.1）+ 记忆条目的 `in_world_time_at_event`。系统不解析时间字符串，但时间感会通过 prompt 透传到角色。

## 12. 下一步

1. Review 本文档。重点看决策表（§2）、不变量 N5（§3.2，入场/离场行为）、数据模型（§4）、PR 拆分（§9.2）。
2. 确认无误后 commit 文档到 `feature/story-world` 分支。
3. 开始 PR 1（World / Character CRUD）实现。
