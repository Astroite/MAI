# Story World

> 状态：已实现（PR 1–6 全部合入 `feature/story-world`，P1 Scene Experience 全部完成）。当前文档反映**现状**，原始设计草案与决策表见 git 历史。
> 配套阅读：[`product_design.md`](product_design.md)、[`personas.md`](personas.md)、[`../architecture/technical_design.md`](../architecture/technical_design.md)。

## 1. 定位

Story World 在 Room + Persona 之上抽出 **World** 一级实体，把 Room 重新定位为该世界中的一幕 **Scene**，并给世界中的角色一条跨场景的记忆线。

它解决两个问题：

1. 跨房间复用世界观、地图、规则——不需要每次重新介绍背景。
2. 角色跨场景有持续记忆——上一幕的羁绊、恩怨、承诺会在下一幕里影响发言。

普通讨论房（`world_id IS NULL`）行为**完全未变**，Story World 是纯增量层。

## 2. 不变量

继承自现有系统：

- **append-only**：Scene 内消息、verdict、revoke 仍只追加。
- **单进程 + ACTIVE_CALLS 跟踪**：Scene 是 Room，所有 freeze / cancel 行为不变。
- **Speakers 是 picked**：`pick_next_speaker` 不变，但路由集合受 Scene 名册收窄。
- **built-ins 是内容**：World 模板（如有）走 `seed.py` + `builtin_id()`。

新增：

- **N1**：World 是 Room 的容器；删除 World 会 drain 并级联硬删其 Scene 与 Character。删除未封幕 Scene 只删除该 Scene；删除已封幕 Scene 会归档为 `status=archived`，保留 world provenance。
- **N2**：同一 World 内 `scene_index` 严格单调递增，无分支。新 Scene 总是 `max + 1`。
- **N3**：角色记忆只在 Scene 之间流动；Scene 进行中产出的消息不会实时改写其他 Scene 的记忆——`POST /rooms/{rid}/seal` 只生成可编辑草稿，记忆固化发生在 Seal Draft commit。
- **N4**：`kind=user` 角色没有 episodic 管线；用户的记忆是用户自己的。系统只存档案 + 关系卡片（卡片由 AI 角色单边维护）。
- **N5**：入场 / 离场是 append-only 事件——`participant.enter` / `participant.exit` 系统消息（visible to models），同步更新 `WorldSceneMember.entered_at_message_id` / `exited_at_message_id`。每个角色每个 Scene 至多一进一出（v1 不支持回流）。

## 3. 数据模型

新增表（详见 `backend/app/models.py`）：

| 表 | 责任 |
|---|---|
| `worlds` | 世界设定：synopsis / setting / calendar_hint / cover_color / cover_icon |
| `world_characters` | 角色档案：`kind∈{ai, user}`、外观、core_identity、skills_text、goals_text、可选 `persona_template_id` |
| `world_scene_members` | Scene 名册（PK = `(scene_id, world_character_id)`）+ entered/exited 区间 + `speak_as_user` |
| `world_character_memories` | Episodic 记忆条目（`kind∈{episode, impression, vow, fact, backstory}`）+ salience + `last_used_scene_index` |
| `world_character_relations` | A 视角下对 B 的关系卡片（单向，AI 单边维护） |
| `world_timeline_events` | World 级时间轴事件：历史背景、记忆/关系/伏笔/主线/地点/阵营变化；Scene 节点仍以 `Room` 为源 |
| `world_scene_seal_drafts` | 两阶段封幕草稿：摘要、时间轴事件、记忆更新、关系更新、警告、重试来源和 commit 状态 |

`Room` 加列：`world_id` / `scene_index` / `in_world_time_start` / `in_world_time_end` / `in_world_duration_hint` / `sealed_at`。`world_id IS NULL` 的房间走全部现有行为；非空房间是 Scene。

`PersonaInstance` 加列 `world_character_id`，让 engine 在 Scene 中能反查回 character（拉记忆 / 关系入 prompt）。

`World.config.world_bible` 是 P0 World State 的兼容层，保存当前世界设定集：`summary`、`background`、当前故事时间、当前地点、当前主线 `current_arc`、地点、阵营、规则、禁忌和伏笔等。`World.synopsis` / `setting` 继续保留并与 Bible 的 summary / background 同步，兼容旧列表和 prompt 路径。

## 4. 记忆管线（三层）

| 层 | 容量 | 进入 prompt 的方式 | 写入时机 |
|---|---|---|---|
| **core_identity** | ~500 字 | 每幕都进，固定位置 | 创建 / 手动编辑 |
| **relationships** | 同场角色 × ~100 字 | 仅同场角色互相进 | 每幕末 scribe |
| **episodic** | 全部存档，retrieval top-K | 排序入 prompt | 每幕末 scribe |

Retrieval v1 简化为 `salience DESC, scene_index DESC` 的 top-K，未引入 BM25 / embedding。每次被选入新 scene prompt 的条目会更新 `last_used_scene_index`，驱动衰减（`engine.decay_unused_memories`）。每角色 episodic 有硬上限（`engine.enforce_memory_cap`）。

封幕 pipeline 是两阶段提交：

1. `POST /rooms/{rid}/seal` 先暂停/冻结 Scene 并生成 `WorldSceneSealDraft`，不写入长期世界状态；存在未提交/未废弃草稿时不能解冻继续改写本幕。
2. `engine.generate_scene_seal_draft_payload` 取每个 AI 角色「在场区间内」的消息，用严格 schema tool-call 生成记忆和关系草稿。
3. Scene-end Inspector 中用户可编辑摘要、勾选 / 取消时间轴事件、记忆和关系变化，也可整体重试生成新草稿。
4. `POST /rooms/{rid}/seal-drafts/{draft_id}/commit` 才写入 `sealed_at`、`world_timeline_events`、`world_character_memories`、`world_character_relations`，并执行 decay / cap。写入项保留 `scene_id` 与 `seal_draft_id` / `last_updated_seal_draft_id` 以便追溯来源。
5. Commit 幂等：同一 draft 重复提交不会重复写入；同一 Scene 只允许一个 committed draft。

封幕只触发于：

- 用户显式调用 `POST /rooms/{rid}/seal` 暂停 Scene 并生成草稿。
- Room freeze 后前端提示是否生成封幕草稿；系统不会自动写入长期状态。

## 5. Engine 改动点

落在 `app/engine.py`：

- `pick_next_speaker`：Scene 模式下，候选集来自当前在场（`exited_at_message_id IS NULL` 且 `entered_at_message_id` 已发生）的 `world_scene_members`。`kind=user` 角色出现在轮转里时变成 `wait`。已退场角色完全排除在调度之外。
- `_build_messages`：在 system prompt 头部 prepend World synopsis + character 档案 + retrieved episodic + 同场关系卡片。
- `visible_messages_for_scene_speaker`：基于 `WorldSceneMember` 的 `entered_at_message_id` / `exited_at_message_id` 做 transcript visibility slicing。晚入场角色看不到入场前消息，退场角色看不到退场后消息。
- `_stream_one_message`：Scene room 中调用 `build_scene_context` + `compose_scene_runtime_context_prompt` 构建 Scene Context；如有 `director_instruction` 则调用 `append_ephemeral_director_instruction` 追加 ephemeral 指令块。
- `generate_scene_seal_draft_payload`：生成可编辑封幕草稿，不写入长期状态。使用 `_slice_messages_for_character` 确保每个角色只看到自己见证的消息。
- `run_scene_memory_scribe`：保留为底层兼容函数；正式 UI 路径通过 SealDraft commit 写入。
- `decay_unused_memories` / `enforce_memory_cap`：SealDraft commit 后执行的记忆维护函数。
- Scene 内默认**关闭** Room scribe（`run_scribe_update` 在 `world_id IS NOT NULL` 的房间里早退）；character memory scribe 是唯一的折叠路径。

`autodrive` / `facilitator` 仍沿用主引擎路径；`pause` / `freeze` 也走 Room 级控制（pause 等当前角色说完后冻结，freeze 立即取消 in-flight）。

### 5.1 Scene Context Builder（P1.1）

`backend/app/scene_context.py` 提供只读 Scene Context Builder：

- `build_scene_context(session, room, speaker_persona_id)` → `SceneContextOut`
- 包含 World Bible compact、timeline events、stage roster、speaker private memory（top 6 by salience）、outgoing relationships to active peers、transcript visibility preview
- `compose_scene_runtime_context_prompt(context)` 渲染为 `[World State]` / `[Stage State]` / `[Your Private Context]` / `[Behavior Contract]` 四段

### 5.2 Behavior Contract（P1.6）

Scene Context 的 `[Behavior Contract / 角色行为契约]` 段包含 8 条双语规则：

- 只扮演自己 / Play only yourself
- 不代替其他角色说话或行动 / Do not speak or act for other characters
- 不做全知旁白 / Do not narrate as an omniscient observer
- 只依据可见上下文 / Base responses only on visible context
- 不知道的信息就表现为不知道 / If you don't know something, behave as if you don't know it
- 如果被点名，优先回应点名意图 / When named, prioritize responding to the call
- 未被点名时可以简短观察或沉默 / When not named, you may briefly observe or stay silent
- 导演指令是临时指导，不是故事事实，不是角色听到的话，不会进入长期记忆 / A director instruction is temporary guidance, not a story fact, not something your character heard, and will not enter long-term memory

### 5.3 Ephemeral Director Instruction（P1.5）

`engine.py::append_ephemeral_director_instruction` 将导演指令包裹为 ephemeral block：

- 只影响下一次 AI turn
- 不持久化（不写入 Message 表）
- 不是故事事实、不是旁白、不是角色听到的话
- 不会进入 Seal Draft 或 Memory
- 不会污染 World State

## 6. 路由

```
GET    /worlds                                         列表（角色数、场景数、最后活动时间）
POST   /worlds                                         创建
GET    /worlds/{wid}                                   详情
PATCH  /worlds/{wid}                                   编辑
DELETE /worlds/{wid}                                   级联删除（强确认）

POST   /worlds/{wid}/characters                        创建 character
GET    /worlds/{wid}/characters/{cid}
PATCH  /worlds/{wid}/characters/{cid}
DELETE /worlds/{wid}/characters/{cid}                  软删除（status=retired）

GET    /worlds/{wid}/characters/{cid}/memories         记忆条目列表 / 编辑 / 删除
PUT    /worlds/{wid}/characters/{cid}/memories
PATCH  /worlds/{wid}/characters/{cid}/memories/{mid}
DELETE /worlds/{wid}/characters/{cid}/memories/{mid}

POST   /worlds/{wid}/scenes                            创建 Scene（自动 scene_index = max+1）
GET    /worlds/{wid}/timeline                          按 scene_index 顺序的场景一览
GET    /worlds/{wid}/state                             World Detail 主控台状态（Bible / Timeline Events / Scenes / Memories / Relations）
DELETE /rooms/{scene_id}                                未封幕 Scene 硬删除；已封幕 Scene 归档（status=archived）
PATCH  /worlds/{wid}/bible                             编辑 World Bible 兼容层
GET    /worlds/{wid}/timeline-events                   World 级时间轴事件
POST   /worlds/{wid}/timeline-events                   手动添加历史/状态事件
PATCH  /worlds/{wid}/timeline-events/{eid}             编辑事件
DELETE /worlds/{wid}/timeline-events/{eid}             删除事件

POST   /rooms/{rid}/scene/enter                        角色入场（追加 system 消息 + 更新 member）
POST   /rooms/{rid}/scene/exit                         角色离场
GET    /rooms/{rid}/scene/members                      在场名册
POST   /rooms/{rid}/seal                               生成封幕草稿（不写入长期状态）
GET    /rooms/{rid}/seal-drafts                        草稿列表
POST   /rooms/{rid}/seal-drafts                        生成新草稿
GET    /rooms/{rid}/seal-drafts/{draft_id}             查看草稿
PATCH  /rooms/{rid}/seal-drafts/{draft_id}             编辑草稿 / 勾选项
POST   /rooms/{rid}/seal-drafts/{draft_id}/retry       基于当前草稿整体重试
POST   /rooms/{rid}/seal-drafts/{draft_id}/commit      确认写入世界状态，Scene → sealed
```

P1 新增路由：

```
POST   /rooms/{rid}/turn                               AI turn（可带 director_instruction）
GET    /rooms/{rid}/scene/context                      Scene Context（只读，含 visibility preview）
```

`POST /rooms/{rid}/messages` 增加可选字段 `as_character_id`——当用户挂多个 user 角色时，指明本次以谁的身份发言。

## 7. 前端

页面：

- `WorldListPage.tsx` —— 与 `/` 同级，左 rail 加入口。
- `WorldDetailPage.tsx` —— World State 主控台：Header + 状态卡 + Tabs（Overview / Timeline / World Bible / Characters / Relationships / Memories / Scenes）。
- `world/CharacterEditor.tsx` / `CharacterMemoryPanel.tsx` / `SceneCreator.tsx` / `TimelineColumn.tsx`。

`RoomShell.tsx` 已小幅改造：检测到 `world_id` 时 title bar 显示「世界 / 第 N 幕」；Composer 增加三类模式（P1.3）：

- **旁白（narration）**：用户以「导演」身份描写场景或角色动作，落库为 system 消息。
- **扮演（act-as）**：用户挑选 `kind=user` 的角色，以该角色身份发言。
- **导演指令（director）**：用户输入指令调度 AI 回应 / 下一拍。指令是 ephemeral runtime instruction，不写入故事正文。

**Stage Presence UI（P1.4）**：`SceneStageConsole.tsx` 展示 World / Act / time / location、在场 / 退场角色列表、可发言 / 可扮演状态、memory / relationship cues。

封幕草稿生成后，**Scene-end Inspector** 对话框展示本幕摘要、时间轴事件、角色记忆更新、关系变化与警告。用户确认 commit 后，这些内容才会进入长期世界状态。

World Detail 的 P0 主控台能力：

- Header 展示世界简介、当前故事时间、当前主线阶段、当前地点，并给出“继续当前 Scene / 开启下一幕”入口。
- Timeline Tab 合并显示 `world_timeline_events` 历史事件与 Scene 节点，并提供类型筛选。
- World Bible Tab 支持编辑世界概述、背景、当前故事时间、当前地点和当前主线状态。
- Memories / Relationships Tab 以可读列表展示现有 `world_character_memories` 与 `world_character_relations`，并标注来源（手动 / 封幕写入）。
- P0.4 两阶段封幕已切换：`Seal Draft -> Inspector -> Commit`。

## 8. 测试覆盖

- `tests/test_worlds.py` —— World / Character CRUD。
- `tests/test_scenes.py` —— Scene 创建、enter / exit、seal。
- `tests/test_memory.py` —— scene-end scribe 写入 episodic / impressions。
- `tests/test_memory_decay.py` —— `last_used_scene_index` 衰减 + episodic cap 折叠。
- `tests/test_relations.py` —— 关系卡片单向维护。
- `tests/test_room_export.py` —— Scene 导出。
- `tests/test_world_state.py` —— World State 聚合、World Bible 编辑、Timeline Event CRUD 与链接校验。
- `tests/test_scene_context.py` —— Scene Context Builder、transcript visibility slicing、director instruction ephemeral semantics、behavior contract completeness、Discussion Room isolation。

## 9. v2 候选（不在 v1）

- **角色回流**：v1 一个角色每个 Scene 至多进出一次；v2 改为 `WorldSceneMemberEvent` 事件流。
- **世界事件广播器**（「报社」）：系统角色定期发布世界级事件，作为 episodic 的另一写入源。
- **时间线分支**：if / else 走向、what-if 沙盒。
- **Embedding-based retrieval**：替换当前 salience-only top-K。
- **角色情绪状态机**：`current_mood` 字段影响发言风格。
- **Skills 升级到 tool**：当前 `skills_text` 是纯描述，v2 关联 MCP tool。
- **多用户协作**：多人各扮一个 user 角色。
- **从 Scene 导出小说稿**：复用 markdown 导出 + 章节化排版。

## 10. 已知风险与处理

- **R1 封幕失败**：两阶段状态为 `unsealed → draft_ready|draft_failed → committed`；失败或质量不佳可整体重试生成新草稿。草稿审阅期间 Scene 保持暂停/冻结，避免 transcript 改动导致草稿失真。
- **R2 修改 core_identity 是否回算 episodic**：不回算，记忆是历史事实。UI 提示。
- **R3 删除 character**：软删除（`status=retired`），关系卡片保留。
- **R4 PersonaTemplate 升级污染**：`WorldCharacter` 已拷贝 color / icon / identity；动态依赖只剩 `system_prompt`。`persona_template_version` 字段为后续「是否同步新版」提示留位。
- **R5 删除语义**：World 删除会级联清理 Scene；单 Scene 删除按封幕状态分流——未封幕可以硬删，已封幕只归档，避免长期记忆、关系卡和时间轴来源断链。
