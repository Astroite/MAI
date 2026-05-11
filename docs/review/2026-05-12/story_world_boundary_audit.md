# Story World vs Discussion Room 架构边界审计

> 审计日期：2026-05-12
> 范围：Story World（World / Character / Scene / Memory / Relations）与 Discussion Room（Room / Phase / Scribe / Facilitator / Verdict）的架构边界
> 方法：静态代码审计，不修改代码

## 0. 架构概要

Story World 的核心设计决策是 **Scene = Room + `world_id` + `scene_index`**，而非独立 domain model。所有 Scene 的消息、调度、streaming、freeze/pause 都复用 Room 的基础设施。差异通过 `is_scene_room(room)` = `room.world_id is not None` 分支。

```
Room (world_id IS NULL)          Scene (world_id IS NOT NULL)
  ├─ Phase / Format                ├─ Phase (story_mode, 单 phase)
  ├─ Scribe (共识/分歧)            ├─ Scribe 早退 (run_scribe_update 短路)
  ├─ Facilitator (节奏建议)        ├─ Facilitator 早退 (run_facilitator_eval 短路)
  ├─ Verdict / Dead End            ├─ Verdict (仍可用, 未屏蔽)
  ├─ Sub-room / Merge              ├─ Sub-room (仍可用, 未屏蔽)
  ├─ Tool Execute                  ├─ Tool Execute (仍可用, 未屏蔽)
  └─ Masquerade                    └─ Narration / Act-as (Composer 双模式)
                                    └─ Seal → per-character memory scribe
                                    └─ Character Memory / Relations
```

---

## 1. 逐项检查结果

### 1.1 Scene 是否只是 Room + world_id，还是已需要独立 domain model

**结论：当前复用合理，但已接近临界点。**

| 维度 | 现状 | 风险 |
|------|------|------|
| 数据模型 | `Room` 加了 6 列 (`world_id`, `scene_index`, `in_world_time_start/end`, `in_world_duration_hint`, `sealed_at`)，通过 `_ADDED_COLUMNS` 自愈 | 低。列增长可控，`world_id IS NULL` 路径完全不受影响 |
| 路由 | Scene 特有端点 (`/scene/enter`, `/scene/exit`, `/seal`, `/scene/members`) 都挂 `/rooms/{rid}/` 下，由 `_scene_or_404` 守卫 | 中。路径语义混合——`/rooms/{rid}/seal` 对 Discussion Room 返回 409，但 URL 看不出这是 Scene-only |
| 调度 | `pick_next_speaker` / `get_room_discussants` 通过 `is_scene_room` 分支过滤候选集 | 低。分支逻辑清晰，未污染 Discussion Room 路径 |
| 消息流 | 同一 `messages` 表，`message_type` 区分 `narration` / `participant.enter` / `participant.exit` | 低。append-only 语义不变 |
| 运行时状态 | 同一 `room_runtime_state` 表，`frozen` / `autodrive_active` / `current_speakers` 共用 | 低。Scene 和 Discussion Room 不会同时活跃在同一 Room 上 |

**不需要独立 domain model 的理由**：Room 的核心抽象（消息流 + 调度 + freeze/pause + streaming）对 Scene 完全适用。Scene 的差异主要在"谁可以发言"（名册过滤）和"封幕后的记忆管线"，这两点通过 `is_scene_room` 分支处理是干净的。

**接近临界点的信号**：如果后续需要 Scene 独有的运行时状态（如角色情绪状态机、幕间时间推进）、独立的 SSE 事件类型、或独立的权限模型，就应该考虑拆分。

### 1.2 Story World 是否不应依赖 Discussion Room 的 phase / facilitator / scribe 语义

**结论：当前隔离做得较好，但隔离方式是"早退"而非"独立路径"。**

| 组件 | Scene 中的行为 | 隔离方式 | 评价 |
|------|--------------|---------|------|
| Phase | 使用内置 `story_mode` phase（`auto_discuss=True`, `ordering=casual`, `exit=user_manual`） | 共用 phase 模型，但 Scene 通常只有单 phase | 合理。Phase 模型本身是通用调度抽象 |
| Scribe | `run_scribe_update` 在 `is_scene_room(room)` 时早退（`engine.py:1264-1271`） | 短路返回 | 合理。Discussion Scribe 的共识/分歧/决议对故事无意义 |
| Facilitator | `run_facilitator_eval` 在 `is_scene_room(room)` 时早退（`engine.py:1756`） | 短路返回 | 合理。Discussion Facilitator 的节奏建议对故事无意义 |
| Memory Scribe | `run_scene_memory_scribe` 是独立函数，只在 `POST /rooms/{rid}/seal` 时调用 | 独立路径 | 优秀。与 Discussion Scribe 完全解耦 |

**风险点**：早退模式意味着如果有人在 engine.py 中新增一个 scribe/facilitator 的调用点，可能会忘记加 `is_scene_room` 检查。当前只有 `after_message_appended` 和 phase boundary 两个调用点，所以实际风险低。

### 1.3 story tag 是否承担了过多行为开关

**结论：是的，`story` tag 已经承担了 4 个独立行为开关，建议控制。**

`story` tag 在代码中的效果：

| 位置 | 效果 | 代码引用 |
|------|------|---------|
| `seed.py:504` | `story_mode` phase 的 tags = `["builtin", "story", "casual"]` | 定义 |
| `engine.py:363` | `_should_auto_discuss` 中 `"story" in phase_tags` → 跳过几何衰减，AI 持续接力 | 行为开关 1 |
| `engine.py:395` | `story` 标签下 silent 提示改为"用一句台词或动作维持存在感" | 行为开关 2 |
| `llm.py:489` | `message.message_type == "narration"` → 标记为「旁白」（不依赖 tag，但与 Story World 强关联） | 独立判断 |

**风险**：如果后续给 `story` tag 加更多行为（如跳过 facilitator、改变 token 预算、修改 streaming 策略），tag 会变成一个隐式的 feature flag 集合。每个新行为都需要在所有检查 `story` tag 的地方确认兼容性。

**建议**：将 `story` tag 的行为拆分为独立的 phase 配置字段（如 `skip_geometric_decay: bool`, `silent_policy: str`），让 tag 回归过滤/分类职责。

### 1.4 Memory Scribe 与 Discussion Scribe 是否分离彻底

**结论：分离彻底，两条路径无交叉。**

| 维度 | Discussion Scribe | Scene Memory Scribe |
|------|-------------------|---------------------|
| 触发 | `after_message_appended` 每 5 条 + phase boundary | `POST /rooms/{rid}/seal` 显式调用 |
| 函数 | `run_scribe_update` | `run_scene_memory_scribe` → `_scribe_memory_for_character` |
| 输出 | `scribe_states.current_state`（共识/分歧/问题/决议/产物/死路） | `world_character_memories`（episodes/impressions/vows）+ `world_character_relations` |
| LLM 调用 | 单次 tool call，输出结构化 diff | 每个 AI 角色一次 tool call，输出 `new_episodes` + `impressions` |
| 幂等 | 每次覆盖 `current_state` | `_scene_memory_already_written` 检查 `source_scene_id`，已写过则跳过 |
| Scene 中 | 早退（`is_scene_room` 短路） | 正常运行 |
| Discussion Room 中 | 正常运行 | 不可达（seal 端点要求 `_scene_or_404`） |

**零交叉**。两条路径的输入、输出、触发时机和存储位置完全不同。

### 1.5 Seal 是否有幂等保护

**结论：有，且保护完善。**

`POST /rooms/{rid}/seal`（`main.py:3028-3059`）的幂等设计：

1. **端点级**：`if scene.sealed_at is not None: return scene`（line 3039-3040）——已封幕的 Scene 直接返回，不重跑 scribe。
2. **Scribe 级**：`_scene_memory_already_written(session, character.id, scene.id)`（`engine.py:1331`）——即使绕过端点级检查，每个角色的 episodic 写入也会拒绝重复。
3. **Flush 顺序**：先 `session.flush()` 写 `sealed_at`，再跑 scribe → decay → cap → `session.commit()`。如果 scribe 中途崩溃，`sealed_at` 已持久化，下次请求会走幂等返回。

**唯一风险**：seal 过程中 scribe 失败（如 LLM 超时），Scene 状态为 `sealed_at IS NOT NULL` 但记忆可能不完整。当前没有重试机制——用户无法"重新封幕"。`Scene-end inspector` UI 允许逐角色重跑，但需要用户主动操作。

### 1.6 world_scene_members 的 entered/exited 区间是否可靠

**结论：可靠，但有边界约束。**

| 检查点 | 现状 |
|--------|------|
| 进入 | `scene_enter` 验证：角色属于同一 world、状态 active、不在当前名册中。创建 `WorldSceneMember` + `participant.enter` 系统消息。`entered_at_message_id` 指向该消息 |
| 退出 | `scene_exit` 验证：成员在名册中且未退出。创建 `participant.exit` 系统消息。`exited_at_message_id` 指向该消息 |
| 唯一性 | 每个角色每个 Scene 至多一进一出（v1 不支持回流）。进入时检查"不在当前名册"，退出时检查"未退出" |
| 候选集过滤 | `get_room_discussants`（`engine.py:552`）过滤 `exited_at_message_id IS NULL` 且 `entered_at_message_id` 已发生 |
| 封幕保护 | `_ensure_room_writable` 检查 `sealed_at`，封幕后禁止 enter/exit |

**约束**：v1 不支持角色回流（退出后重新进入）。如果后续需要，需要改为事件流模型（`WorldSceneMemberEvent`）。

**风险**：`entered_at_message_id` 和 `exited_at_message_id` 是消息 ID，依赖消息的 append-only 语义。如果未来引入消息编辑/删除（当前明确不做），这些外键会失效。

### 1.7 Composer 的旁白模式、扮演模式、普通消息是否类型清晰

**结论：前端类型清晰，后端类型宽松。**

| 层 | 普通消息 | 旁白 | 扮演 |
|----|---------|------|------|
| 前端 Composer | `discussionMode="normal"` | `storyMode="narration"` | `storyMode="act_as"` |
| 前端 API 调用 | `appendMessage(content)` | `appendMessage(content, {message_type:"narration"})` | `appendMessage(content, {as_character_id: id})` |
| 后端 `message_type` | `"speech"` | `"narration"` | `"speech"`（默认） |
| 后端 `author_actual` | `"user"` | `"user"` | `"user_as_persona"` |
| 后端 `user_masquerade_name` | `None` | `None` | `character.name` |
| LLM 视角 | 正常 user 消息 | `("user", "旁白")` 标签 | 正常 user 消息，带角色名 |

**问题 1**：`message_type` 接受任意字符串（`schemas.py:912`），无枚举约束。`"narration"` 的语义完全靠下游（`llm.py:489`）消费，如果拼错不会报错。

**问题 2**：旁白消息的 `author_actual` 是 `"user"` 而非 `"system"`，但 `participant.enter` / `participant.exit` 的 `author_actual` 是 `"system"`。两种系统级消息用了不同的 author_actual 值。

**问题 3**：扮演模式的 `message_type` 默认为 `"speech"`，与普通用户发言无法区分。区分只能靠 `author_actual="user_as_persona"` 和 `user_masquerade_name` 非空。

### 1.8 Character Memory / Relation / Vow 是否可能重复写或脏写

**结论：有幂等保护，但有脏写窗口。**

| 写入路径 | 幂等保护 | 脏写风险 |
|---------|---------|---------|
| 封幕 scribe → episodic | `_scene_memory_already_written` 检查 `source_scene_id` | 低。同一 Scene 同一角色不会重复写 |
| 封幕 scribe → relations | 直接 `merge` upsert（`engine.py:1496`） | 低。同 `(source_character_id, target_character_id)` 会覆盖 |
| 手动编辑 memory | `PATCH /worlds/{wid}/characters/{cid}/memories/{mid}` | 中。用户可与封幕 scribe 并发编辑同一 memory |
| 手动编辑 relation | `PUT /worlds/{wid}/characters/{cid}/relations/{tid}` | 中。用户可与封幕 scribe 并发编辑同一 relation |
| 封幕 scribe 并发 | `drain_active_calls` 等待 in-flight 完成后才跑 scribe | 低。但多个 seal 请求理论上可并发（单进程下实际不会） |

**脏写窗口**：用户在封幕进行中手动编辑 memory/relation。封幕 scribe 是 LLM 调用，耗时可能数秒。在此期间用户通过 REST API 编辑同一条 memory，scribe 完成后会覆盖用户编辑。当前无乐观锁或版本号保护。

### 1.9 Scene Timeline 是否能支撑后续长期故事

**结论：当前实现足够，但有两个增长瓶颈。**

| 维度 | 现状 | 承载力 |
|------|------|--------|
| Scene 索引 | `scene_index` 整数，`max + 1` 递增 | 无上限，但无分支 |
| 时间线查询 | `GET /worlds/{wid}/timeline` 按 `scene_index` 排序 | 单 World 内 Scene 数量增长后查询仍高效（有索引） |
| 记忆检索 | `salience DESC, scene_index DESC` top-K（K=6） | 记忆数量增长后检索仍高效（有索引 + 硬上限折叠） |
| 记忆衰减 | `decay_unused_memories` 降低未引用记忆的 salience | 防止记忆无限增长 |
| 记忆上限 | `enforce_memory_cap` 折叠超出上限的记忆 | 硬上限保护 |
| 消息量 | 单 Scene 的消息量 = 单 Room 的消息量 | 与 Discussion Room 相同，无额外压力 |

**瓶颈 1**：`scene_index` 无分支。`story_world.md` §9 提到"时间线分支"是 v2 候选，当前线性模型不支持 what-if 或回溯。

**瓶颈 2**：记忆检索是纯 salience 排序，无语义检索。当记忆数量增长到数百条，top-6 可能漏掉相关但低 salience 的记忆。`story_world.md` §9 提到 embedding-based retrieval 是 v2 候选。

### 1.10 Discussion Room 的工具、裁决、主持信号是否会误入 Story World

**结论：后端未屏蔽，前端部分屏蔽。存在语义污染风险。**

| Discussion Room 功能 | 后端 Scene 中可用？ | 前端 Scene 中可见？ | 语义是否合理？ |
|---------------------|-------------------|-------------------|--------------|
| Verdict（裁决） | **是**。`POST /rooms/{rid}/verdicts` 无 `is_scene_room` 检查 | **是**。`RightPanel` 的 Decisions panel 未按 Scene 过滤 | **不合理**。故事场景不应有"裁决" |
| Dead End（死路标记） | **是**。同 verdict 端点 | **是**。`MessageList` 渲染 dead_end 消息 | **不合理**。故事场景不应有"死路" |
| Facilitator（主持信号） | **是**。`POST /rooms/{rid}/facilitator` 无 `is_scene_room` 检查 | **是**。`RightPanel` 的 Facilitator panel 未按 Scene 过滤 | **不合理**。引擎层已早退，但手动触发仍可用 |
| Tool Execute | **是**。`POST /rooms/{rid}/tools/execute` 无 `is_scene_room` 检查 | **是**。`RightPanel` 的 Tool panel 未按 Scene 过滤 | **待定**。工具可能对故事有用（如搜索消息） |
| Masquerade（群友发言） | **是**。`POST /rooms/{rid}/masquerade` 无 `is_scene_room` 检查 | **否**。`Composer` 在 `story` 模式下隐藏 discussion modes | 合理。前端已屏蔽 |
| Sub-room（子讨论） | **是**。无 `is_scene_room` 检查 | **是**。`RightPanel` 的 Subroom panel 未按 Scene 过滤 | **不合理**。Scene 不应有子讨论 |
| Scribe Panel | 引擎层早退，面板显示空状态 | **是**。`RightPanel` 的 Scribe panel 仍显示 | 无害但冗余 |

**核心问题**：后端的 `_ensure_room_writable` 只检查 frozen + sealed，不区分 Discussion Room 和 Story World Scene。前端的 `RightPanel` 也未按 Scene 类型过滤面板。

---

## 2. 当前复用合理的部分

| 组件 | 为什么合理 |
|------|-----------|
| Room 作为 Scene 的容器 | 消息流、调度、freeze/pause、streaming 对两者完全适用 |
| Phase 模型 | 通用调度抽象，Scene 用 `story_mode` phase 是合理的特化 |
| Message 表 | append-only 语义不变，`message_type` 和 `author_actual` 区分类型 |
| Autodrive 机制 | `_should_auto_discuss` 的 `story` tag 分支是干净的扩展点 |
| LLM 调用层 | `stream` / `complete_with_tools` 对两者完全适用 |
| SSE event bus | 事件类型和订阅机制对两者完全适用 |
| `_build_messages` | 角色重写逻辑（peer routing）对两者完全适用 |
| freeze / pause / delete | `drain_active_calls` 模式对两者完全适用 |
| PersonaInstance 快照 | Scene 的 PersonaInstance 带 `world_character_id` 反查，设计干净 |
| 记忆管线 | `run_scene_memory_scribe` 独立于 Discussion Scribe，无交叉 |

## 3. 当前复用有风险的部分

| 组件 | 风险 | 严重度 |
|------|------|--------|
| Verdict / Dead End 端点 | Story World Scene 中可写入裁决和死路标记，语义不匹配 | 中 |
| Facilitator 手动触发 | 引擎层早退，但 REST 端点仍可在 Scene 中触发手动评估 | 低 |
| Tool Execute | Scene 中可执行工具，语义待定 | 低 |
| Sub-room | Scene 中可创建子讨论，语义不匹配 | 中 |
| `story` tag 过载 | 4 个独立行为开关绑定在同一个 tag 上 | 中 |
| Composer `message_type` 无枚举 | `"narration"` 纯靠约定，拼错不报错 | 低 |
| Memory/Relation 手动编辑与封幕并发 | 无乐观锁，封幕可覆盖用户手动编辑 | 低 |
| RightPanel 未按 Scene 过滤 | 显示 Discussion 专属面板（Decisions, Facilitator, Subroom） | 低（UI 层面） |

## 4. 应该继续共用的基础设施

| 组件 | 理由 |
|------|------|
| Room 模型 + 消息表 | Scene 的核心就是"一个有名册的 Room"，拆分增加复杂度无收益 |
| Phase 调度引擎 | `pick_next_speaker` 的 `is_scene_room` 分支已经足够 |
| Autodrive / freeze / pause | 这些是房间级运行时控制，对两者语义一致 |
| SSE event bus | 事件类型统一，不需要 Scene 专属事件通道 |
| LLM adapter | `stream` / `complete_with_tools` / peer routing 完全复用 |
| `drain_active_calls` | 取消 in-flight 的模式对两者一致 |
| PersonaInstance 快照机制 | Scene 的 PersonaInstance 带额外字段是合理的扩展 |

## 5. 应该逐步拆分的 domain service

| 拆分项 | 当前位置 | 建议 |
|--------|---------|------|
| Verdict / Dead End 守卫 | `main.py:1600` | 在 verdict 端点加 `is_scene_room` 检查，Scene 中返回 409 |
| Sub-room 守卫 | `main.py` sub-room 端点 | 在 sub-room 创建端点加 `is_scene_room` 检查 |
| Facilitator 手动触发守卫 | `main.py:1801` | 在 facilitator 端点加 `is_scene_room` 检查（引擎层已早退，但端点层应一致） |
| RightPanel 面板过滤 | `RightPanel.tsx` | Scene 中隐藏 Decisions / Facilitator / Subroom 面板 |
| `story` tag 行为拆分 | `engine.py:363,395` | 将 `skip_geometric_decay` 和 `silent_policy` 改为 phase 配置字段 |
| `message_type` 枚举 | `schemas.py:912` | 定义 `MessageType` 枚举，约束合法值 |
| Composer 模式类型 | `main.py:1554-1597` | 后端增加 composer mode 概念，而非依赖 `message_type` + `as_character_id` 的隐式组合 |

## 6. 不建议现在拆的部分

| 组件 | 理由 |
|------|------|
| Room → Scene 独立模型 | 当前 Room + `world_id` 分支足够清晰，拆分需要重构所有 Room 路由和运行时状态 |
| Phase → Scene 独立调度 | `story_mode` phase 已经是合理的特化，不需要独立调度器 |
| Message → Scene 独立消息表 | 消息表的 append-only 语义对两者一致，拆分增加查询复杂度 |
| SSE → Scene 独立事件通道 | 事件类型统一，不需要额外通道 |
| Memory scribe → 共享框架 | 两条 scribe 路径已经完全独立，强行共享会引入不必要的抽象 |
| Autodrive → Scene 独立循环 | `_should_auto_discuss` 的 `story` tag 分支已经足够 |

## 7. Story World 下一阶段架构建议

### 7.1 短期（v1.1 补齐）

1. **后端守卫补齐**：verdict / sub-room / facilitator 手动触发端点加 `is_scene_room` 检查。这是最低成本的隔离补丁。
2. **RightPanel Scene 过滤**：Scene 中隐藏 Decisions / Facilitator / Subroom 面板，只保留 Phase / Limits / Tools / Upload。
3. **`message_type` 枚举化**：定义 `MessageType` 枚举（`speech`, `question`, `answer`, `user_doc`, `narration`, `participant.enter`, `participant.exit`, `verdict`, `verdict_revoke`, `dead_end`, `tool_invocation`, `facilitator_signal`, `scribe_update`, `merge_back`），约束 Pydantic schema。
4. **封幕重试**：`seal_scene` 中如果 scribe 失败，允许用户重新触发（当前 scribe 失败后 `sealed_at` 已写入，无法重跑）。方案：`sealed_at` 保持，但增加 `seal_status` 字段（`sealed` / `sealing_failed`），失败时可重试。

### 7.2 中期（v2 架构演进）

5. **`story` tag 行为字段化**：在 `PhaseTemplate` 上增加 `skip_geometric_decay: bool`、`silent_policy: str`（`"silent_if_nothing"` / `"maintain_presence"`），让 `story` tag 回归分类职责。
6. **Composer 模式后端化**：在 `MessageCreate` 中增加 `composer_mode: Literal["normal", "narration", "act_as"]`，替代当前 `message_type` + `as_character_id` 的隐式组合。
7. **记忆乐观锁**：`WorldCharacterMemory` 增加 `version` 字段，手动编辑时检查版本号，防止与封幕 scribe 并发覆盖。
8. **角色回流**：v1 每个角色每 Scene 至多一进一出。改为 `WorldSceneMemberEvent` 事件流，支持角色中途离开再回来。

### 7.3 长期（v3 方向）

9. **Scene 独立运行时状态**：如果引入角色情绪状态机、幕间时间推进、或 Scene 专属 SSE 事件，考虑将 `RoomRuntimeState` 拆分为 `RoomRuntimeState` + `SceneRuntimeState`。
10. **Embedding-based 记忆检索**：替换 salience-only top-K，支持语义相关性检索。
11. **时间线分支**：支持 what-if 沙盒、多结局走向。
12. **世界事件广播器**：系统角色定期发布世界级事件，作为 episodic 的另一写入源。

---

## 8. 风险矩阵

| # | 风险 | 严重度 | 可能性 | 当前缓解 | 建议 |
|---|------|--------|--------|---------|------|
| R1 | Verdict/Dead End 写入 Scene | 中 | 中 | 无 | 加 `is_scene_room` 守卫 |
| R2 | Sub-room 创建在 Scene 中 | 中 | 低 | 无 | 加 `is_scene_room` 守卫 |
| R3 | `story` tag 行为过载 | 中 | 中 | 代码注释 | 字段化拆分 |
| R4 | 封幕 scribe 失败后无法重试 | 中 | 低 | `sealed_at` 已写入 | 增加 `seal_status` 字段 |
| R5 | Memory 手动编辑与封幕并发覆盖 | 低 | 低 | 无 | 增加乐观锁 |
| R6 | `message_type` 无枚举约束 | 低 | 中 | 约定 | Pydantic 枚举 |
| R7 | RightPanel 显示 Scene 无关面板 | 低 | 高 | 无 | Scene 过滤 |
| R8 | Facilitator 手动触发在 Scene 中 | 低 | 低 | 引擎层早退 | 端点层守卫 |
| R9 | `narration` 与 `participant.enter` 的 author_actual 不一致 | 低 | 低 | 无 | 统一约定 |
| R10 | 记忆检索随记忆数量增长退化 | 低 | 中 | salience 衰减 + 硬上限 | v2 embedding |

---

## 9. 总结

Story World 的"Scene = Room + world_id"复用策略在 v1 阶段是**正确的架构决策**。它避免了重复实现消息流、调度、streaming、freeze/pause 等复杂基础设施，同时通过 `is_scene_room` 分支和 `run_scribe_update` / `run_facilitator_eval` 早退实现了必要的隔离。

当前最大的架构缺陷不是复用本身，而是**后端端点层缺少 Scene 守卫**——verdict、sub-room、facilitator 手动触发可在 Scene 中调用，语义不匹配。这是低成本可修复的问题。

`story` tag 的行为过载是中期需要关注的问题，但不构成当前的架构风险。

不需要将 Scene 拆分为独立 domain model。Room + `world_id` 的增量模型在可预见的 v2 范围内仍然适用。
