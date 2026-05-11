# MAI 前后端契约一致性审计

> 审计日期：2026-05-12
> 审计范围：`backend/app/schemas.py`, `backend/app/main.py`, `frontend/src/types.ts`, `frontend/src/api.ts`, `frontend/src/hooks.ts`, `frontend/src/queryKeys.ts`, `frontend/src/pages/room/RoomShell.tsx`
> 原则：只读审计，不修改代码。

## 1. 审计摘要

| 维度 | 结论 |
|---|---|
| REST 路径 | 全部一致，无漂移 |
| 请求体类型 | **9 个方法用 `unknown` 绕过类型检查**；3 个方法缺少字段 |
| 响应体字段 | **后端返回 10+ 字段前端未声明**，集中在 token 统计和运行时状态 |
| 枚举 | **`narration` 消息类型后端用、前端未声明** |
| nullable/optional | 基本一致，ScribeState 包装层级匹配 |
| 未消费后端字段 | 10+ 字段前端收到但不展示 |
| 前端假设字段 | Room 类型混合了 summary-only 字段 |
| SSE 事件类型 | **后端 15 种、前端处理 13 种**，缺 `room.deleted` |
| invalidation 覆盖 | **只 invalidate room，不 invalidate world/character/template** |
| Story World 类型 | 基本一致，无结构性漂移 |

---

## 2. 契约漂移清单

### 2.1 请求体 `unknown` 类型（无编译时契约）

| # | 前端方法 | HTTP | 后端 Schema | 风险 |
|---|---|---|---|---|
| C-01 | `createPersonaTemplate` | POST | `PersonaTemplateCreate` | 字段拼写错误只有运行时 422 |
| C-02 | `updatePersonaTemplate` | PATCH | `PersonaTemplateUpdate` | 同上 |
| C-03 | `createFormat` | POST | `DebateFormatCreate` | 同上 |
| C-04 | `updateFormat` | PATCH | `DebateFormatUpdate` | 同上 |
| C-05 | `createRecipe` | POST | `RecipeCreate` | 同上 |
| C-06 | `updateRecipe` | PATCH | `RecipeUpdate` | 同上 |
| C-07 | `createPhase` | POST | `PhaseTemplateCreate` | 同上 |
| C-08 | `updatePhase` | PATCH | `PhaseTemplateUpdate` | 同上 |
| C-09 | `updateLimits` | PATCH | `LimitUpdate` | **请求和响应都是 `unknown`**，连返回类型都丢失 |

**影响**：调用方可以传入任意对象，TypeScript 编译器不会报错。后端 Pydantic 会在运行时返回 422，但前端没有提前防御。

### 2.2 请求体缺少字段

| # | 前端方法 | 缺少的字段 | 后端 Schema | 影响 |
|---|---|---|---|---|
| C-10 | `insertPhase` | `after_position`, `variable_bindings` | `InsertPhaseRequest` | 前端只能在末尾插入 phase，无法指定位置或绑定变量 |
| C-11 | `masquerade` | `message_type` | `MasqueradeCreate` | 前端始终发 `"speech"`，无法以其他消息类型伪装 |
| C-12 | `appendMessage` | `message_type` 类型为 `string` 而非 `MessageType` | `MessageCreate` | 前端可以传任意字符串，包括后端不识别的类型 |

### 2.3 响应体字段漂移（后端返回、前端未声明）

| # | 后端 Schema | 字段 | 前端类型 | 前端是否使用 |
|---|---|---|---|---|
| C-13 | `MessageOut` | `content_chunks_count` | `Message` | 未声明、未使用 |
| C-14 | `MessageOut` | `prompt_tokens` | `Message` | 未声明、未使用 |
| C-15 | `MessageOut` | `completion_tokens` | `Message` | 未声明、未使用 |
| C-16 | `MessageOut` | `cost_usd` | `Message` | 未声明、未使用 |
| C-17 | `RoomRuntimeOut` | `current_user_mode` | `Runtime` | 未声明、未使用 |
| C-18 | `RoomRuntimeOut` | `current_masquerade_persona_id` | `Runtime` | 未声明、未使用 |
| C-19 | `PersonaTemplateOut` | `schema_version` | `PersonaTemplate` | 未声明、未使用 |
| C-20 | `PersonaTemplateOut` | `status` (`"draft"` / `"published"`) | `PersonaTemplate` | 未声明、未使用 |
| C-21 | `PersonaInstanceOut` | `schema_version` (继承自 template) | `PersonaInstance` | 未声明、未使用 |
| C-22 | `FacilitatorSignalOut` | `message_id` | `FacilitatorSignal` | 未声明、未使用 |
| C-23 | `FacilitatorSignalOut` | `trigger_after_message_id` | `FacilitatorSignal` | 未声明、未使用 |
| C-24 | `RoomOut` | `owner_user_id` | `Room` | 未声明、未使用 |
| C-25 | `RoomOut` | `format_version` | `Room` | 未声明、未使用 |
| C-26 | `RoomOut` | `frozen_at` | `Room` | 未声明、未使用 |

**影响**：这些字段后端确实返回，前端 JSON 里也有，但 TypeScript 类型没声明。不是运行时 crash，而是：
- 前端代码无法安全访问这些字段（编译器报错或 `any` 绕过）。
- token 统计、用户模式、模板状态等信息白白丢失，无法在 UI 展示。

### 2.4 枚举漂移

| # | 枚举 | 后端值 | 前端值 | 差异 |
|---|---|---|---|---|
| C-27 | `MessageType` | `"speech"`, `"question"`, `"answer"`, `"summary"`, `"verdict"`, `"verdict_revoke"`, `"dead_end"`, `"facilitator_signal"`, `"user_doc"`, `"tool_invocation"`, `"masquerade_reveal"`, `"silence"`, `"background_update"`, `"meta"`, **`"narration"`** | 同列表但**无 `"narration"`** | 后端 Story World 使用 `narration` 消息类型（`engine.py:207`, `llm.py:492`），前端 MessageType 联合类型未包含 |
| C-28 | `PersonaKind` | `"discussant"`, `"scribe"`, `"facilitator"` | 同 | 一致 |
| C-29 | `WorldCharacterKind` | `"ai"`, `"user"` | 同 | 一致 |
| C-30 | `WorldCharacterStatus` | `"active"`, `"retired"` | 同 | 一致 |
| C-31 | `WorldStatus` | `"active"`, `"archived"` | 同 | 一致 |
| C-32 | `WorldCharacterMemoryKind` | `"episode"`, `"impression"`, `"vow"`, `"fact"`, `"backstory"` | 同 | 一致 |

**C-27 影响**：Story World 旁白消息的 `message_type` 是 `"narration"`。前端 `Message` 类型的 `message_type` 字段是 `MessageType` 联合类型，不包含 `"narration"`。TypeScript 编译器会将 narration 消息视为类型错误，或者开发者用 `as any` 绕过。消息列表渲染时如果按 `message_type` 做分支，narration 会落入 default 分支。

### 2.5 前端类型混合了 summary-only 字段

| # | 字段 | 来源 | 问题 |
|---|---|---|---|
| C-33 | `Room.member_count` | `GET /rooms` 返回 `RoomSummaryOut` | `Room` 类型声明了此字段，但 `GET /rooms/{id}/state` 返回的 `RoomOut` 不含此字段。RoomShell 消费 `state.room` 时，这些字段是 `undefined` |
| C-34 | `Room.members` | 同上 | 同上 |
| C-35 | `Room.message_count` | 同上 | 同上 |
| C-36 | `Room.last_activity_at` | 同上 | 同上 |

**影响**：RoomShell 中如果直接访问 `state.room.members` 或 `state.room.message_count`，值为 `undefined`。当前 RoomShell 实际通过 `state.personas` 获取成员信息，所以没有 crash，但类型声明不准确。

---

## 3. SSE 事件类型一致性

### 3.1 后端发布 vs 前端处理

| 后端事件类型 | 后端发布位置 | 前端处理 | 状态 |
|---|---|---|---|
| `message.streaming` | engine.py | `appendChunk()` | 一致 |
| `message.appended` | engine.py, main.py, tools.py | upsert + finalize + invalidate | 一致 |
| `message.cancelled` | engine.py | finalize + invalidate | 一致 |
| `scribe.updated` | engine.py | invalidate | 一致 |
| `facilitator.signal` | engine.py | invalidate | 一致 |
| `phase.exit_suggested` | engine.py | invalidate | 一致 |
| `phase.exit_continued` | engine.py | invalidate | 一致 |
| `phase.extended` | engine.py | invalidate | 一致 |
| `phase.transitioned` | engine.py | invalidate | 一致 |
| `room.frozen` | engine.py | invalidate | 一致 |
| `room.unfrozen` | engine.py | invalidate | 一致 |
| **`room.deleted`** | **main.py** | **无处理** | **缺失** |
| `persona.instance.updated` | main.py | invalidate | 一致 |
| `persona.instance.removed` | main.py | invalidate | 一致 |
| `system.error` | engine.py | toast + console | 一致 |

**C-37 `room.deleted` 缺失**：后端在删除房间时发布此 SSE 事件，但前端 `useRoomEvents` 没有对应处理。结果：如果用户在另一个标签页删除了当前正在查看的房间，前端不会收到通知，继续显示已删除房间的 stale 数据。

### 3.2 SSE payload 字段漂移

| 事件 | 后端 payload 字段 | 前端 `StreamingEvent` 字段 | 差异 |
|---|---|---|---|
| `message.streaming` | `message_id`, `persona_id`, `chunk_text`, `chunk_index`, `cumulative_tokens_estimate` | `message_id?`, `persona_id?`, `chunk_text?`, `chunk_index?` | `cumulative_tokens_estimate` 前端未声明 |
| `message.cancelled` | `message_id`, `reason`, `partial_text`, `partial_tokens` | `message_id?` | `reason`, `partial_text`, `partial_tokens` 前端未声明 |
| `facilitator.signal` | `signal` (嵌套对象含 `id`, `message_id`) | 无结构化类型 | 前端只做 invalidate，不解析 payload |
| `phase.extended` | `phase_extra_rounds` | 无 | 前端只做 invalidate |

---

## 4. React Query Invalidation 覆盖分析

### 4.1 当前 invalidation 策略

`useRoomEvents` 中所有 SSE 事件最终只 invalidate 一个 key：

```typescript
queryClient.invalidateQueries({ queryKey: queryKeys.room(roomId) });
// = ["room", roomId]
```

### 4.2 缺失的 invalidation

| 场景 | SSE 事件 | 应 invalidate 的 key | 当前状态 |
|---|---|---|---|
| C-38 | 房间内 persona 被更新 | `persona.instance.updated` | `queryKeys.room` + `queryKeys.personaTemplates.*` | 只 invalidate room |
| C-39 | 房间内 persona 被移除 | `persona.instance.removed` | `queryKeys.room` + `queryKeys.rooms` | 只 invalidate room，sidebar 房间列表成员头像可能 stale |
| C-40 | Scene 封幕 | `message.appended` (seal 触发) | `queryKeys.room` + `queryKeys.world(worldId)` + `queryKeys.worldTimeline(worldId)` | 只 invalidate room，World 详情页的场景列表不会更新 sealed 状态 |
| C-41 | Scene 角色入场/离场 | 无 SSE 事件（REST only） | `queryKeys.sceneMembers(roomId)` | RoomShell 的 mutation onSuccess 只 invalidate room，不 invalidate sceneMembers |
| C-42 | World/Character CRUD | 无 SSE 事件 | `queryKeys.worlds` / `queryKeys.world(id)` | World 页面的 mutation 手动 invalidate，但 RoomShell 内不 invalidate world |
| C-43 | 房间删除 | `room.deleted` | `queryKeys.rooms` | 事件未处理，sidebar 已删除房间不会消失 |

### 4.3 invalidation 范围总结

```
SSE 事件 ──→ 只 invalidate ["room", roomId]
                    │
                    ├─ 不 invalidate ["rooms"]（sidebar 列表）
                    ├─ 不 invalidate ["worlds"] / ["world", wid]（World 页）
                    ├─ 不 invalidate ["world-timeline", wid]
                    ├─ 不 invalidate ["scene-members", roomId]
                    ├─ 不 invalidate ["character-memories", wid, cid]
                    ├─ 不 invalidate ["character-relations", wid, cid]
                    └─ 不 invalidate ["persona-templates"]（模板页）
```

**影响**：用户在房间内操作后切换到 World 列表或模板页，看到的是 stale 缓存数据。需要手动刷新或等待 background refetch。

---

## 5. 可能导致 UI 假状态的问题

| # | 问题 | 触发条件 | 表现 |
|---|---|---|---|
| C-44 | sidebar 房间成员头像 stale | 房间内添加/移除 persona 后查看 sidebar | sidebar 卡片显示旧成员头像，直到 rooms 查询 background refetch |
| C-45 | World 场景列表 sealed 状态 stale | 封幕后查看 World 详情页 | 场景卡片仍显示 "active" 而非 "sealed" |
| C-46 | 房间删除后 sidebar 残留 | 另一个标签页删除房间 | 已删除房间仍显示在 sidebar，点击后 404 |
| C-47 | template 模板编辑后房间 stale | 编辑 persona template 后进入房间 | 房间内 persona instance 是快照，不受影响，但用户可能误以为已更新 |

---

## 6. 可能导致运行时 undefined/null 的问题

| # | 问题 | 触发条件 | 表现 |
|---|---|---|---|
| C-48 | `state.room.members` 访问 | RoomShell 中访问 `state.room.members` | 值为 `undefined`（RoomOut 不含此字段），如果直接 `.map()` 会 crash |
| C-49 | `state.room.message_count` 访问 | 同上 | 值为 `undefined`，显示 NaN 或空白 |
| C-50 | narration 消息渲染 | Story World 旁白消息进入 MessageList | `message_type` 为 `"narration"`，前端 MessageType 不包含此值，类型窄化可能遗漏渲染分支 |

**当前实际影响**：C-48/C-49 在当前 RoomShell 中没有直接 crash，因为 RoomShell 通过 `state.personas` 获取成员、不依赖 `state.room.members`。但类型声明是错的，未来代码可能误用。

---

## 7. 建议补充的 Contract Tests

### 7.1 后端侧（pytest）

| # | 测试 | 覆盖 |
|---|---|---|
| CT-01 | `test_persona_template_create_response_fields` | 确认 `PersonaTemplateOut` 包含 `schema_version`, `status`, `forked_from_version` |
| CT-02 | `test_room_state_message_fields` | 确认 `MessageOut` 包含 `content_chunks_count`, `prompt_tokens`, `completion_tokens`, `cost_usd` |
| CT-03 | `test_room_runtime_fields` | 确认 `RoomRuntimeOut` 包含 `current_user_mode`, `current_masquerade_persona_id` |
| CT-04 | `test_facilitator_signal_fields` | 确认 `FacilitatorSignalOut` 包含 `message_id`, `trigger_after_message_id` |
| CT-05 | `test_insert_phase_request_fields` | 确认 `InsertPhaseRequest` 接受 `after_position`, `variable_bindings` |
| CT-06 | `test_masquerade_message_type` | 确认 `MasqueradeCreate` 接受 `message_type` 字段 |
| CT-07 | `test_sse_room_deleted_published` | 确认 `delete_room` 发布 `room.deleted` SSE 事件 |

### 7.2 前端侧（类型断言 / 集成测试）

| # | 测试 | 覆盖 |
|---|---|---|
| CT-08 | `types Message matches MessageOut shape` | 编译时断言 `Message` 包含 `MessageOut` 所有字段 |
| CT-09 | `types Runtime matches RoomRuntimeOut shape` | 编译时断言 `Runtime` 包含 `RoomRuntimeOut` 所有字段 |
| CT-10 | `types PersonaTemplate matches PersonaTemplateOut shape` | 编译时断言 |
| CT-11 | `api methods request body types are not unknown` | lint 规则禁止 `unknown` 请求体 |
| CT-12 | `MessageType includes narration` | 断言 `"narration"` 在 MessageType 联合类型中 |
| CT-13 | `useRoomEvents handles all backend event types` | 断言 SSE handler 覆盖后端所有事件类型 |

### 7.3 建议的 contract test 框架

```python
# 后端：自动生成 frontend types 的快照
def test_schema_field_coverage():
    """确保每个 Out schema 的字段都在对应 TS 类型中声明。"""
    backend_fields = set(PersonaTemplateOut.model_fields.keys())
    # 读取 types.ts 中 PersonaTemplate interface 的字段
    frontend_fields = parse_ts_interface("PersonaTemplate")
    missing = backend_fields - frontend_fields
    assert not missing, f"Frontend PersonaTemplate missing: {missing}"
```

```typescript
// 前端：编译时类型断言
type AssertExtends<A, B> = A extends B ? true : never;
type _CheckMessage = AssertExtends<
  keyof Message,
  keyof MessageOut  // 从后端 schema 自动生成的 TS 类型
>;
```

---

## 8. 优先级排序

| 优先级 | ID | 问题 | 理由 |
|---|---|---|---|
| **P1** | C-27 | MessageType 缺 `narration` | Story World 旁白消息类型不匹配，影响渲染 |
| **P1** | C-37 | `room.deleted` SSE 未处理 | 房间删除后前端 stale，用户可能操作已删除房间 |
| **P1** | C-09 | `updateLimits` 请求/响应都是 `unknown` | 完全无类型保护 |
| **P2** | C-01~C-08 | 8 个请求体 `unknown` | 降低类型安全，运行时 422 风险 |
| **P2** | C-38~C-43 | invalidation 覆盖不足 | 跨页面 stale 数据，影响多标签/多页面场景 |
| **P2** | C-10 | `insertPhase` 缺字段 | 功能缺失：无法指定插入位置 |
| **P3** | C-13~C-16 | MessageOut token 统计字段未声明 | 无法在 UI 展示 token 用量和成本 |
| **P3** | C-17~C-18 | Runtime 缺运行时状态字段 | 无法展示用户模式和伪装状态 |
| **P3** | C-33~C-36 | Room 类型混合 summary 字段 | 类型不准确，潜在 undefined 访问 |
| **P4** | C-19~C-26 | 其他响应体字段缺失 | 信息丢失但不影响核心功能 |
| **P4** | C-11~C-12 | 请求体缺少可选字段 | 低频功能，影响有限 |

---

## 9. 跨审计关联

本审计与前两份审计的交叉点：

| 本审计 ID | 关联审计 | 关联 ID | 说明 |
|---|---|---|---|
| C-01~C-08 | 架构地图 | API Contract 地图 | 请求体类型空白是架构层面的 contract 缺口 |
| C-13~C-16 | 胶水审计 | A-12 (token/cost 多源) | token 统计字段后端有但前端不消费，与多源状态问题叠加 |
| C-17~C-18 | 胶水审计 | A-07 (room state multi-source) | `current_user_mode` / `current_masquerade_persona_id` 是运行时状态的又一层来源 |
| C-27 | 胶水审计 | A-05 (is_scene_room branching) | `narration` 类型是 Story World 分支引入的，前端未同步 |
| C-37 | 架构地图 | SSE event bus 模块 | SSE 事件发布和消费不对称 |
| C-38~C-43 | 架构地图 | React Query invalidation | invalidation 策略只覆盖 room 级，World/Template 级缺失 |
