# Story World

> 状态：已实现（PR 1–6 全部合入 `feature/story-world`）。当前文档反映**现状**，原始设计草案与决策表见 git 历史。
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

- **N1**：World 是 Room 的容器；删除 World 级联删 Scene 与 Character。删除单个 Scene 不影响 World。
- **N2**：同一 World 内 `scene_index` 严格单调递增，无分支。新 Scene 总是 `max + 1`。
- **N3**：角色记忆只在 Scene 之间流动；Scene 进行中产出的消息不会实时改写其他 Scene 的记忆——记忆固化发生在「封幕」(`POST /rooms/{rid}/seal`)。
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

`Room` 加列：`world_id` / `scene_index` / `in_world_time_start` / `in_world_time_end` / `in_world_duration_hint` / `sealed_at`。`world_id IS NULL` 的房间走全部现有行为；非空房间是 Scene。

`PersonaInstance` 加列 `world_character_id`，让 engine 在 Scene 中能反查回 character（拉记忆 / 关系入 prompt）。

## 4. 记忆管线（三层）

| 层 | 容量 | 进入 prompt 的方式 | 写入时机 |
|---|---|---|---|
| **core_identity** | ~500 字 | 每幕都进，固定位置 | 创建 / 手动编辑 |
| **relationships** | 同场角色 × ~100 字 | 仅同场角色互相进 | 每幕末 scribe |
| **episodic** | 全部存档，retrieval top-K | 排序入 prompt | 每幕末 scribe |

Retrieval v1 简化为 `salience DESC, scene_index DESC` 的 top-K，未引入 BM25 / embedding。每次被选入新 scene prompt 的条目会更新 `last_used_scene_index`，驱动衰减（`engine.decay_unused_memories`）。每角色 episodic 有硬上限（`engine.enforce_memory_cap`）。

封幕 pipeline（`engine.run_scene_memory_scribe`）：

1. 取该角色「在场区间内」的所有消息。
2. tool-call 严格 schema 输出：`new_episodes` / `impressions` / `vows`。
3. 写入 `world_character_memories` + `world_character_relations`，幂等（同 `source_scene_id` 已写过则拒绝重复跑）。

封幕只触发于：

- 用户显式调用 `POST /rooms/{rid}/seal`。
- Room freeze 后 5 秒前端弹「是否封幕」UI 提示——**不**自动封幕（不可逆）。

## 5. Engine 改动点

落在 `app/engine.py`：

- `pick_next_speaker`：Scene 模式下，候选集来自当前在场（`exited_at_message_id IS NULL` 且 `entered_at_message_id` 已发生）的 `world_scene_members`。`kind=user` 角色出现在轮转里时变成 `wait`。
- `_build_messages`：在 system prompt 头部 prepend World synopsis + character 档案 + retrieved episodic + 同场关系卡片。
- `run_scene_memory_scribe` / `decay_unused_memories` / `enforce_memory_cap`：封幕路径的三个核心函数。
- Scene 内默认**关闭** Room scribe（`run_scribe_update` 在 `world_id IS NOT NULL` 的房间里早退）；character memory scribe 是唯一的折叠路径。

`autodrive` / `facilitator` / `freeze` 全部不动。

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

POST   /rooms/{rid}/scene/enter                        角色入场（追加 system 消息 + 更新 member）
POST   /rooms/{rid}/scene/exit                         角色离场
GET    /rooms/{rid}/scene/members                      在场名册
POST   /rooms/{rid}/seal                               封幕：触发 scene-end scribe，状态 → sealed
```

`POST /rooms/{rid}/messages` 增加可选字段 `as_character_id`——当用户挂多个 user 角色时，指明本次以谁的身份发言。

## 7. 前端

新页面：

- `WorldListPage.tsx` —— 与 `/` 同级，左 rail 加入口。
- `WorldPage.tsx` —— 三栏：[角色列表] [时间线 + Scene 卡] [世界设定]。
- `world/CharacterEditor.tsx` / `CharacterMemoryPanel.tsx` / `SceneCreator.tsx` / `TimelineColumn.tsx`。

`RoomShell.tsx` 已小幅改造：检测到 `world_id` 时 title bar 显示「世界 / 第 N 幕」；Composer 增加两类模式：

- **旁白（narration）**：用户以「导演」身份描写场景或角色动作，落库为 system 消息。
- **扮演（act-as）**：用户挑选 `kind=user` 的角色，以该角色身份发言。

封幕后，**Scene-end inspector** 对话框可逐角色查看本幕产出的 episodic / impressions / vows，必要时可重跑。

## 8. 测试覆盖

- `tests/test_worlds.py` —— World / Character CRUD。
- `tests/test_scenes.py` —— Scene 创建、enter / exit、seal。
- `tests/test_memory.py` —— scene-end scribe 写入 episodic / impressions。
- `tests/test_memory_decay.py` —— `last_used_scene_index` 衰减 + episodic cap 折叠。
- `tests/test_relations.py` —— 关系卡片单向维护。
- `tests/test_room_export.py` —— Scene 导出。

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

- **R1 封幕失败**：封幕状态机 `unsealed → sealing → sealed | sealing_failed`；失败可重试，封幕期间禁止以同一名册开新场景。
- **R2 修改 core_identity 是否回算 episodic**：不回算，记忆是历史事实。UI 提示。
- **R3 删除 character**：软删除（`status=retired`），关系卡片保留。
- **R4 PersonaTemplate 升级污染**：`WorldCharacter` 已拷贝 color / icon / identity；动态依赖只剩 `system_prompt`。`persona_template_version` 字段为后续「是否同步新版」提示留位。
