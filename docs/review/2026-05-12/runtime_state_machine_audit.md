# MAI 运行时状态机、并发与取消逻辑专项审计

> 审计日期：2026-05-12
> 审计范围：backend/app/engine.py, event_bus.py, tools.py, main.py; frontend hooks.ts, store.ts, RoomShell.tsx, SpeakerStateBar.tsx, MessageList.tsx
> 方法：纯阅读审计，未修改任何代码

---

## 0. 并发模型概览

MAI 是**单进程 asyncio** 应用。所有运行时状态都是进程内 Python 对象：

| 内存态 | 类型 | 作用域 | 生命周期 |
|---|---|---|---|
| `ACTIVE_CALLS` | `dict[room_id, dict[message_id, InFlightCall]]` | module-global | LLM 调用期间 |
| `_AUTODRIVE_LOCKS` | `dict[room_id, asyncio.Lock]` | module-global | 永不主动清理（仅 `clear_autodrive_lock` 按需） |
| `_AUTODRIVE_TASKS` | `dict[room_id, asyncio.Task]` | module-global | autodrive 链期间 |
| `_AUTODRIVE_STOP_REQUESTS` | `set[room_id]` | module-global | freeze/pause 到 unfreeze |
| `EventBus._queues` | `dict[room_id, set[Queue]]` | module-global | SSE 连接期间 |

SQLite 配置：WAL 模式、`busy_timeout=15000`、`synchronous=NORMAL`。无行级锁（`SELECT ... FOR UPDATE` 在 SQLite 上退化为 database-level 写锁）。

---

## 1. 逐流程审计

### 1.1 Autodrive

**状态入口：** `maybe_autodrive_after()` — 仅当 `author_actual ∈ {user, user_as_persona, user_as_judge}` 且 `message_type ∈ {speech, question, answer, user_doc, narration}` 时触发。`POST /rooms/{id}/autodrive/resume` 走 `schedule_autodrive()`。

**状态出口：**
- 正常：`_should_auto_discuss` 返回 False（frozen / sealed / auto_discuss=False / max_consecutive / exit_condition / random decay）
- 异常：`asyncio.CancelledError`（被 freeze/pause/delete 取消）
- 异常：未捕获异常 → 发布 `system.error` SSE

**持久化字段：**
- `RoomRuntimeState.consecutive_ai_turns` — 每次 AI 消息 +1，用户消息重置为 0
- `RoomRuntimeState.frozen` — freeze/pause 置 True
- `Room.sealed_at` — 封幕时间戳

**内存态字段：**
- `_AUTODRIVE_LOCKS[room_id]` — asyncio.Lock，防重入
- `_AUTODRIVE_TASKS[room_id]` — 当前 runner Task
- `_AUTODRIVE_STOP_REQUESTS` — freeze/pause 请求停止

**前端态字段：**
- `runtime.autodrive_active` — 通过 `/state` refetch 填充
- `runtime.current_speakers` — 活跃调用的 persona_id 列表

**SSE 事件：** `message.streaming` (每 chunk)、`message.appended` (完成)、`message.cancelled` (截断)、`system.error` (失败)

**可能竞争条件：**
1. **RC-A1: `maybe_autodrive_after` 与已有 lock 的竞态。** 检查 `lock.locked()` 和 `active_calls_for_room()` 是两步操作，理论上存在窗口期。但由于是单进程 asyncio，实际在同一 event loop tick 内完成，风险极低。
2. **RC-A2: `_AUTODRIVE_STOP_REQUESTS` 的 set 操作非原子。** Python GIL 保护单线程内的 dict/set 操作，且 asyncio 是协作式调度，不会在 `add/discard` 之间 yield，因此安全。
3. **RC-A3: `_maybe_handle_pending_user_turn` 在链结束后检查最新消息。** 如果用户在链运行期间发送了消息，链结束后会重新触发。但如果同时有人 freeze 了房间，`_autodrive_stop_requested` 会阻止重触发。

**可能卡死点：**
- `_autodrive_runner` 内部的 `run_room_turn` 调用 LLM，如果 LLM provider 永不响应且 `asyncio.wait_for` 超时未覆盖（`complete_with_tools` 的 timeout 是 `max(30, 180)=180s`，但 `stream` 的 timeout 是 per-chunk 30s），最长等待 180s。

**是否幂等：** 否。`_AUTODRIVE_LOCKS` 防止同一 room 同时跑两个 runner，但 `maybe_autodrive_after` 的 guard 可能因时序漏过。

**是否可能重复消息：** 低风险。lock 保证同一时刻只有一个 runner；`continue_chain=False` 的单次 runner 不会递归。

**是否可能 SQLite 写锁：** 低。runner 内部的 `SessionLocal()` 独立于外层 session；WAL 模式下并发读写安全。

**是否可能 UI/backend 不一致：** 是。autodrive 链运行中，`/state` refetch 去抖 250ms，期间 UI 可能看不到最新 `current_speakers`。SSE streaming chunks 是实时的，但 `autodrive_active` 字段依赖 refetch。

---

### 1.2 Pause（graceful pause）

**状态入口：** `POST /rooms/{id}/pause` → `pause_room()`

**状态出口：**
- 成功：`runtime.frozen=True`, `room.status="frozen"`, 发布 `room.frozen`
- 异常：`ValueError("room not found")`

**持久化字段：** `RoomRuntimeState.frozen`, `Room.status`, `Room.frozen_at`, `RoomSnapshot`

**内存态字段：** `_AUTODRIVE_STOP_REQUESTS` 添加 room_id

**SSE 事件：** `room.frozen`

**关键流程：**
1. `_request_autodrive_stop(room_id)` — 立即阻止新 autodrive 调度
2. `await session.rollback()` — 释放当前 session 的事务
3. 等待所有 active_calls 的 task 自然完成（`asyncio.gather`）
4. 等待 autodrive runner 完成（如果没 active_calls 则 cancel runner）
5. 重新获取 room/runtime，写 frozen 状态

**可能竞争条件：**
1. **RC-P1: `session.rollback()` 后重新获取 room/runtime。** 步骤 3 等待 active calls 完成期间，room 可能被其他操作修改（如用户又发了消息触发了 `_maybe_handle_pending_user_turn`）。步骤 5 用 `populate_existing=True` 重新加载，但 `_ensure_room_writable` 检查已被跳过（pause 路由不调用它）。
2. **RC-P2: active_calls 等待期间新消息追加。** 等待期间 LLM 可能完成并追加消息、触发 `after_message_appended`，进而触发 scribe/facilitator。pause 不阻止这些后续流程。

**可能卡死点：**
- 如果 LLM 调用永不超时（provider 完全挂起），`asyncio.gather` 会永远等待。但 `CHUNK_IDLE_TIMEOUT_SECONDS=30` 的 per-chunk timeout 和 `complete_with_tools` 的 `wait_for(180s)` 提供了兜底。

**是否幂等：** 是。重复调用 pause 在 room 已 frozen 时，`_request_autodrive_stop` 是 set.add 幂等，但步骤 5 会重新写 frozen 并创建新的 snapshot（浪费但无害）。

**是否可能重复消息：** 否。pause 不产生消息。

**是否可能 SQLite 写锁：** 低。步骤 2 rollback 释放锁，步骤 5 重新获取。

**是否可能 UI/backend 不一致：** 是。pause 等待期间（可能数十秒），UI 看到的仍是 `frozen=false`，直到步骤 5 commit 后 SSE 推送 `room.frozen`。

---

### 1.3 Freeze（强制冻结）

**状态入口：** `POST /rooms/{id}/freeze` → `freeze_room()`

**状态出口：**
- 成功：`runtime.frozen=True`, `room.status="frozen"`, 发布 `room.frozen`
- 被取消的 calls 会收到 `CancelledError`，保存 truncated partial

**持久化字段：** 同 pause + 被截断的 Message（`truncated_reason="frozen"`）

**内存态字段：** `ACTIVE_CALLS` 清空该 room，`_AUTODRIVE_STOP_REQUESTS` 添加

**SSE 事件：** `message.cancelled`（每个被截断的消息）、`message.appended`（截断后的最终消息）、`room.frozen`

**关键流程：**
1. `_request_autodrive_stop` + `session.rollback()`
2. `drain_active_calls` — cancel 所有 in-flight task + `asyncio.gather` 等待退出
3. `_await_autodrive_runner(cancel=True)` — cancel runner task
4. `clear_autodrive_lock`
5. 重新获取 room/runtime，写 frozen 状态

**可能竞争条件：**
1. **RC-F1: `drain_active_calls` 内部的 cancel + gather 时序。** `task.cancel()` 只是调度取消，信号要等 task 走到下一个 `await`（通常是 LLM stream 的下一个 chunk）才生效。如果 LLM provider 完全无响应，cancel 信号无法被感知，gather 会等待直到 per-chunk timeout (30s) 触发。
2. **RC-F2: freeze 与用户消息竞态。** 用户在 freeze 请求发出后、服务端处理前发送的消息可能已经触发了 `after_message_appended` → `maybe_autodrive_after`。freeze 的 `_request_autodrive_stop` 会在 autodrive runner 的下一个循环迭代检查到，但该迭代可能已经开始（正在 `run_room_turn`）。

**可能卡死点：** 同 pause，但更严重——freeze 的语义是"立即截断"，但如果 LLM provider 完全无响应，实际要等 30s chunk timeout。

**是否幂等：** 部分。重复 freeze 在 room 已 frozen 时，`_ensure_not_sealed` 检查通过但 `drain_active_calls` 是 no-op（无 active calls）。

**是否可能重复消息：** 是。被 cancel 的 task 可能在 cancel 信号到达前已经完成了消息构建，会追加一条完整消息；同时 freeze 流程也会保存一条 truncated 消息——但这是同一条消息（`tmp_message_id`），不是两条。`_stream_one_message` 的 finally 块中 `_unregister_active_call` 确保只注册一次。

**是否可能 SQLite 写锁：** 低。`drain_active_calls` 内部的 session 与 freeze 的 session 独立。

**是否可能 UI/backend 不一致：** 同 pause。

---

### 1.4 Delete Room

**状态入口：** `DELETE /rooms/{room_id}`

**状态出口：** 房间及所有关联数据被删除，发布 `room.deleted`

**持久化字段：** 全部删除

**内存态字段：** `ACTIVE_CALLS` 清空，`_AUTODRIVE_LOCKS` 清空，`_AUTODRIVE_STOP_REQUESTS` 清空

**SSE 事件：** `room.deleted`

**关键流程：**
1. `drain_active_calls` — cancel + await 所有 in-flight
2. `clear_autodrive_lock(clear_stop=True)`
3. 按 FK 依赖顺序 DELETE 子表
4. DELETE Room
5. commit
6. publish `room.deleted`

**可能竞争条件：**
1. **RC-D1: SSE 事件发布在 commit 之后。** `room.deleted` 在 commit 后发布。但 delete 期间被 cancel 的 task 可能在 `finally` 块中尝试 publish（`_unregister_active_call` 不 publish，但 `_stream_one_message` 的 finally 之前的 `event_bus.publish` 可能已经排入队列）。这些旧事件可能在 `room.deleted` 之后到达前端。
2. **RC-D2: 前端 SSE handler 收到 `room.deleted` 后的行为。** 前端 `hooks.ts` 没有专门处理 `room.deleted` 事件类型——它会落入默认的 `scheduleInvalidate` 路径，触发 refetch，但 refetch 会 404（房间已删）。SSE 连接本身会收到 HTTP 错误并停止重试（`onerror` 中 4xx 被标记为 offline）。

**可能卡死点：** 同 freeze。

**是否幂等：** 否。重复 delete 会 404。

**是否可能重复消息：** 否。delete 不产生消息。

**是否可能 SQLite 写锁：** 中。多个 DELETE 语句在同一事务中，如果表数据量大，持锁时间可能较长。

**是否可能 UI/backend 不一致：** 是。delete 是破坏性操作，前端可能缓存了旧的 room state。

---

### 1.5 Scene Seal（封幕）

**状态入口：** `POST /rooms/{room_id}/seal` → `seal_scene()`

**状态出口：**
- 成功：`scene.sealed_at` 设置，per-character memory scribe 完成
- 幂等：已封幕的 scene 直接返回

**持久化字段：**
- `Room.sealed_at`
- `WorldCharacterMemory` — episodic 记忆条目
- `WorldCharacterRelation` — 关系卡片更新

**内存态字段：** `ACTIVE_CALLS` 清空（通过 `drain_active_calls`）

**SSE 事件：** 无专门 seal 事件（前端通过 `room.frozen` 或 `/state` refetch 感知）

**关键流程：**
1. `drain_active_calls("scene_sealed")` — cancel + await
2. `clear_autodrive_lock(clear_stop=True)`
3. 设置 `scene.sealed_at`，flush（保证 seal 标记持久化，即使后续 scribe 失败）
4. `run_scene_memory_scribe` — 逐 AI character 调 LLM tool-call
5. `decay_unused_memories` — 衰减旧记忆
6. `enforce_memory_cap` — 折叠超限记忆
7. commit

**可能竞争条件：**
1. **RC-S1: seal 后 scribe 失败。** 如果 step 4 的某个 character scribe LLM 调用失败，`_scribe_memory_for_character` 捕获异常并返回 0（不抛出）。但 seal 标记已 flush，scene 处于"sealed 但记忆不完整"状态。前端 Scene-end inspector 可以重跑，但用户可能不知道。
2. **RC-S2: seal 与 freeze 的竞态。** seal 调用 `drain_active_calls`，与 freeze 的 `drain_active_calls` 使用相同的 cancel+await 模式。如果用户同时点击 seal 和 freeze，两个请求都会尝试 cancel 同一批 calls。第二个 `drain_active_calls` 会是 no-op（calls 已被第一个取消），但 `clear_autodrive_lock(clear_stop=True)` 可能清除第一个设置的 stop request。
3. **RC-S3: `_scene_memory_already_written` 幂等检查。** 使用 `source_scene_id` 做幂等。但如果 scribe 在写入部分 rows 后崩溃（session rollback），下次 seal 会重跑——这是正确的幂等行为。

**可能卡死点：**
- 多 character 的 scribe 是串行执行的（`for member, character in ai_pairs`）。每个 character 一次 LLM tool-call，如果有 N 个 AI character，总耗时 = N × LLM 延迟。N=5 时可能需要 30-60s。

**是否幂等：** 是。`sealed_at IS NOT NULL` 检查 + `_scene_memory_already_written` 双重保护。

**是否可能重复消息：** 否。seal 不产生 room messages。

**是否可能 SQLite 写锁：** 中。scribe 写入多行 memory + relation，持锁时间与 character 数量成正比。

**是否可能 UI/backend 不一致：** 是。seal 是长时间操作（数十秒），前端 `sealScene.isPending` 提供了 loading 状态，但没有中间进度反馈。

---

### 1.6 Streaming

**状态入口：** `_stream_one_message` — 由 `run_room_turn` 调用

**状态出口：**
- 正常：`truncated_reason=None`，完整消息追加
- 截断：`truncated_reason ∈ {limit_exceeded, frozen, timeout, cancelled, room_deleted, scene_sealed}`
- 异常：LLM 调用异常 → re-raise + `system.error` SSE

**持久化字段：** `Message`（含 `truncated_reason`, `prompt_tokens`, `completion_tokens`）

**内存态字段：**
- `InFlightCall.partial_text` — 实时累积文本
- `InFlightCall.last_chunk_index` — 最后 chunk 序号
- `ACTIVE_CALLS` 注册/注销

**前端态字段：**
- `useUIStore.streaming[messageId]` — 实时文本
- `useUIStore.finalizedStreamIds[messageId]` — 完成标记

**SSE 事件：** `message.streaming` (每 chunk), `message.appended` (完成), `message.cancelled` (截断)

**可能竞争条件：**
1. **RC-SR1: SSE chunk 与 `message.appended` 的顺序。** `message.streaming` chunks 在 LLM 流式产出时逐个发送；`message.appended` 在消息持久化后发送。正常情况下 append 在所有 chunks 之后。但如果 LLM 调用被 cancel，`message.cancelled` 和 `message.appended` 几乎同时发送（`_stream_one_message` 的 finally 后）。
2. **RC-SR2: 前端 `appendChunk` 的 finalized 保护。** `appendChunk` 检查 `finalizedStreamIds[messageId]`，如果已 finalized 则忽略 chunk。但 `finalizeStream` 从 `streaming` 中删除条目并添加到 `finalizedStreamIds`——如果 `message.appended` 的 SSE 事件先于最后一个 `message.streaming` chunk 到达（网络乱序），最后一个 chunk 会被丢弃。**这是设计意图**——最终消息已包含完整内容。
3. **RC-SR3: `hydrateStream` 与实时 chunks 的竞态。** `/state` refetch 返回 `in_flight_partial`，`hydrateStream` 会覆盖 Zustand store 中的 streaming 条目。如果 refetch 返回的 `last_chunk_index` 低于已收到的实时 chunks，`hydrateStream` 检查 `current.lastChunkIndex > lastChunkIndex` 并跳过——正确行为。

**可能卡死点：**
- `asyncio.wait_for(stream_iter.__anext__(), timeout=30)` — 如果 30s 无 chunk，触发 `TimeoutError`，消息被截断为 `truncated_reason="timeout"`。
- `complete_with_tools` 的整体 timeout 是 `max(30, 180)=180s`。

**是否幂等：** 否。streaming 是一次性操作。

**是否可能重复消息：** 否。`tmp_message_id` 在整个 `_stream_one_message` 调用中唯一。

**是否可能 SQLite 写锁：** 低。只有最后的 `session.commit()` 写入一条 Message。

**是否可能 UI/backend 不一致：** 是。streaming 期间 UI 依赖 Zustand store 的实时 chunks；如果 SSE 连接断开重连，chunks 可能丢失，但 `in_flight_partial` 恢复机制会补充。

---

### 1.7 In-Flight Partial（SSE 重连恢复）

**状态入口：** SSE 断线重连后，前端通过 `GET /rooms/{id}/state` 获取 `in_flight_partial`

**状态出口：** 前端 `hydrateStream` 将 partial 写入 Zustand store

**持久化字段：** 无（partial 是内存态）

**内存态字段：** `InFlightCall.partial_text`

**前端态字段：** `useUIStore.streaming[messageId]`

**关键流程：**
1. 前端 `RoomShell.tsx` useEffect 监听 `state?.in_flight_partial`
2. 对每个 partial，检查 `finalMessageIds.has(partial.message_id)` — 如果消息已最终化，跳过
3. 调用 `hydrateStream(roomId, messageId, personaId, content, lastChunkIndex)`
4. `hydrateStream` 检查 store 中已有 chunk 的 index 是否更高，是则跳过

**可能竞争条件：**
1. **RC-IP1: `hydrateStream` 与实时 `appendChunk` 的竞态。** 如果 SSE 重连后立即收到新的 streaming chunk，同时 refetch 返回了旧的 partial，`appendChunk` 的 `chunkIndex` 可能高于 `hydrateStream` 的 `lastChunkIndex`。`appendChunk` 检查 `chunkIndex <= current.lastChunkIndex` 并跳过——但 `hydrateStream` 可能覆盖了更高的 index。时序：`hydrateStream(index=5)` → `appendChunk(index=6)` 正确；`appendChunk(index=6)` → `hydrateStream(index=5)` 被 `current.lastChunkIndex > lastChunkIndex` 检查阻止——正确。

**是否幂等：** 是。`hydrateStream` 的 index 检查保证幂等。

**是否可能重复消息：** 否。partial 不产生消息。

**是否可能 UI/backend 不一致：** 是。refetch 去抖 250ms 期间，partial 可能已过时。

---

### 1.8 Tool-Call Generation

**状态入口：** `_stream_one_message` 内部，当 `tools_enabled=True` 且工具清单非空时走 `complete_with_tools` 路径

**状态出口：**
- 正常：`ToolCompletion` 返回，消息追加
- 工具调用失败：`ToolInvocation.status="error"`，但消息仍追加

**持久化字段：**
- `ToolInvocation` — 每次工具调用记录
- `Message` (tool_invocation type) — 工具调用消息

**内存态字段：** 同 streaming

**SSE 事件：** `message.appended` (工具调用消息，含 `tool_invocation` 字段)

**关键流程：**
1. `list_tool_schemas` 获取工具清单
2. `tool_definitions_for_llm` 过滤写入工具
3. `llm_adapter.complete_with_tools` — 非流式，等待工具调用轮次完成
4. 工具调用期间，`execute_tool` 创建 `ToolInvocation` + `Message`，publish `message.appended`
5. 最终消息追加，publish `message.appended`

**可能竞争条件：**
1. **RC-TC1: 工具调用消息与最终消息的 SSE 顺序。** `execute_tool` 内部 publish `message.appended`（工具调用消息），然后 `complete_with_tools` 返回，`_stream_one_message` publish 最终 `message.appended`。前端 `upsertRoomMessage` 按 message.id upsert，不会丢失。
2. **RC-TC2: `complete_with_tools` 的 timeout。** 整体 `wait_for(180s)` 覆盖所有工具调用轮次。如果单个 MCP server 响应慢，180s 后超时，消息被截断。
3. **RC-TC3: 工具调用期间 freeze。** freeze 的 `drain_active_calls` 会 cancel `_stream_one_message` 的 task。但 `complete_with_tools` 不是流式的，cancel 信号要等到下一个 `await` 才生效——可能是 `execute_tool` 的 `session.flush()` 或 `event_bus.publish()`。

**是否幂等：** 否。工具调用可能有副作用。

**是否可能重复消息：** 低。`complete_with_tools` 的 `max_tool_rounds=4` 限制了循环次数。

**是否可能 SQLite 写锁：** 中。每个工具调用一次 `session.flush()`，多次写入。

**是否可能 UI/backend 不一致：** 是。工具调用消息通过 SSE 实时推送，但最终消息的 `tool_invocation` 字段要等 `complete_with_tools` 返回后才填充。

---

### 1.9 SSE Reconnect

**状态入口：** `fetchEventSource` 的 `onerror` 回调

**状态出口：** 指数退避重连（1s → 2s → 4s → ... → 30s cap）

**前端态字段：**
- `connectionStatus`: "connected" / "reconnecting" / "offline"
- `connectionRetries`: 重试次数

**SSE 事件：** 重连后收到 `connected` 事件

**可能竞争条件：**
1. **RC-SSE1: 重连期间的事件丢失。** SSE 是无状态的——重连后只会收到新事件，不会重放。重连期间（可能数秒到 30s）的 `message.streaming` chunks 丢失，但 `in_flight_partial` 恢复机制通过 `/state` refetch 补充。
2. **RC-SSE2: 重连后的 duplicate events。** `fetchEventSource` 使用 `Last-Event-ID` header（如果服务器支持），但 `EventBus` 不实现此机制。重连后可能收到已处理的事件。前端的 `appendChunk` 通过 `chunkIndex` 去重，`finalizeStream` 通过 `finalizedStreamIds` 去重。
3. **RC-SSE3: 4xx 错误的永久断开。** `onerror` 中检查 `rejected with 4`，标记为 `offline` 并抛出错误停止重试。但如果 room 被删除后用户仍在查看，SSE 会永久断开——这是正确行为。

**是否幂等：** 是。重连是 idempotent 的。

**是否可能重复消息：** 是（SSE 事件），但前端有去重保护。

**是否可能 UI/backend 不一致：** 是。重连期间 UI 可能显示过时状态。

---

### 1.10 Phase Transition

**状态入口：**
- 自动：`check_phase_exit` 检测到退出条件满足 → `emit_phase_exit` → 如果 `auto_transition=True` 自动切换
- 手动：`POST /rooms/{id}/phase/next` → `transition_to_next_phase`

**状态出口：**
- 有下一阶段：创建新 `RoomPhaseInstance`，重置 runtime 状态
- 无下一阶段：`current_phase_instance_id=None`

**持久化字段：**
- `RoomPhaseInstance` (status, completed_at)
- `RoomRuntimeState.current_phase_instance_id`
- `RoomRuntimeState.phase_exit_suggested`, `phase_exit_matched_conditions`, `phase_exit_suppressed_after_message_id`
- `RoomRuntimeState.consecutive_ai_turns`, `phase_extra_rounds`
- `Message` (type="meta", "进入阶段 #N")

**SSE 事件：** `phase.exit_suggested`, `phase.exit_continued`, `phase.extended`, `phase.transitioned`

**可能竞争条件：**
1. **RC-PT1: `check_phase_exit` 在 `after_message_appended` 中被调用。** 如果 `auto_transition=True`，`emit_phase_exit` 会立即调用 `transition_to_next_phase`。但 `after_message_appended` 之后还有 `maybe_autodrive_after`——此时 phase 已切换，autodrive 使用新 phase 的规则。这是正确行为。
2. **RC-PT2: 手动 `next_phase` 与 autodrive 的竞态。** 用户点击"下一阶段"时，autodrive 可能正在运行。`_ensure_room_writable` 只检查 frozen/sealed，不检查 autodrive。`transition_to_next_phase` 会修改 runtime 但不 cancel active calls。新 phase 的 autodrive 可能与旧 phase 的 in-flight call 共存——但 `pick_next_speaker` 会读取新 phase 的 `allowed_speakers`，可能排除正在发言的 persona。
3. **RC-PT3: `phase_exit_suppressed_after_message_id` 的抑制逻辑。** 用户点击"继续讨论"后，`continue_current_phase` 设置 `phase_exit_suppressed_after_message_id`。后续 `check_phase_exit` 检查此字段，如果最新消息 id 匹配则跳过。但如果用户在 suppress 后又发了新消息，suppress 失效，退出条件重新生效。

**是否幂等：** 部分。`transition_to_next_phase` 不幂等——重复调用会创建多个 phase instance。

**是否可能重复消息：** 否。

**是否可能 SQLite 写锁：** 低。

**是否可能 UI/backend 不一致：** 是。`phase.exit_suggested` 通过 SSE 推送，但 `phase_exit_suggested` 字段依赖 `/state` refetch。

---

### 1.11 Story Phase Behavior

**状态入口：** phase template 含 `story` tag

**关键差异：**
- 跳过 casual ordering 的几何衰减（`_should_auto_discuss` 中 `is_story` 分支）
- AI 持续接力直到 `consecutive_ai_turns >= max_consecutive_ai_turns` 或 token budget 或用户 freeze
- `<silent/>` 提示改为"用一句台词或动作维持存在感"
- 多 AI peer 路由：其他 AI 发言改写为 `user + 「Name」: ` 前缀

**可能竞争条件：**
1. **RC-ST1: 故事模式的长 autodrive 链。** `max_consecutive_ai_turns` 默认 10，可在限额面板拉到 30-100。长链期间，每个 turn 一次 LLM 调用 + SSE 推送 + `/state` refetch 去抖。如果用户在此期间 freeze，`drain_active_calls` 会 cancel 当前 in-flight 并等待 runner 退出——但 runner 可能正在 `_should_auto_discuss` 的新迭代中。
2. **RC-ST2: 故事模式的 token budget 检查。** `_token_limit_exceeded` 在 chunk 循环中和消息完成后各检查一次。chunk 循环中的检查使用 **旧的** `runtime.token_counter_total`（不包含当前消息的 tokens），因为 runtime 是在 stream 开始前读取的。`_stream_one_message` 最后的 `with_for_update=True` 重新读取 runtime 做最终检查——但此时可能已经有其他 parallel 调用更新了 token counter（parallel phase 场景）。
3. **RC-ST3: 多 AI 故事模式的并发发言。** 普通 phase 每次只有一个 in-flight call；`parallel` phase 可以有多个。多个 `_stream_one_message` 各自独立读取 context、写入消息。后写入的消息看不到先写入的消息内容（它们在各自独立的 session 中读取 context）——这可能导致故事连贯性问题，但不是 bug。

**是否可能重复消息：** 否。

**是否可能 SQLite 写锁：** 低（单 in-flight）到中（parallel）。

---

## 2. 状态机风险表

| # | 风险 | 严重度 | 概率 | 模块 | 描述 |
|---|---|---|---|---|---|
| R1 | Freeze/Seal 对完全无响应 provider 的等待 | **高** | 低 | engine.py | `drain_active_calls` 等待 task 退出，但 cancel 信号要等 LLM stream 的下一个 chunk timeout (30s) 才生效。provider 完全挂起时，最长等待 30s。 |
| R2 | Pause 等待期间无进度反馈 | **中** | 中 | engine.py + frontend | pause 等待 active calls 完成可能需要数十秒，期间 UI 无变化。用户可能重复点击。 |
| R3 | Seal 后 scribe 部分失败 | **中** | 低 | engine.py | `sealed_at` 先 flush，scribe 后跑。单个 character scribe 失败不会阻止 seal，但记忆不完整。幂等保护允许重跑，但 UI 未明确提示哪些 character 失败。 |
| R4 | Phase transition 与 in-flight call 共存 | **中** | 中 | engine.py | 手动 `next_phase` 不 cancel 旧 phase 的 in-flight calls。新旧 phase 的 autodrive 可能短暂共存。 |
| R5 | SSE 重连期间事件丢失 | **中** | 中 | hooks.ts + event_bus.py | SSE 是 fire-and-forget，重连后不重放。`in_flight_partial` 恢复是最终一致的，但 streaming chunks 可能丢失几秒。 |
| R6 | EventBus queue overflow (200) | **低** | 低 | event_bus.py | 慢消费者（网络慢）的 queue 满后，新事件被 `suppress(QueueFull)` 静默丢弃。 |
| R7 | `_AUTODRIVE_LOCKS` 内存泄漏 | **低** | 高 | engine.py | locks 字典永不主动清理（仅 `clear_autodrive_lock` 按需），长期运行可能积累大量无用 lock 对象。 |
| R8 | Parallel phase 的 token counter 竞态 | **低** | 低 | engine.py | 多个 parallel `_stream_one_message` 各自读取 `runtime.token_counter_total`，最后写入时可能覆盖彼此的增量。`with_for_update=True` 在 SQLite 上无效。 |
| R9 | Delete 期间 SSE 事件乱序 | **低** | 低 | main.py + hooks.ts | `room.deleted` 在 commit 后发布，但被 cancel 的 task 可能已在队列中排入旧事件。前端未专门处理 `room.deleted`。 |
| R10 | `session.rollback()` 在 pause/freeze 中的副作用 | **低** | 低 | engine.py | `pause_room` 和 `freeze_room` 在读取 room/runtime 后调用 `session.rollback()` 释放事务，然后重新获取。如果 session 中有未 flush 的脏数据，rollback 会丢失。 |

---

## 3. 最危险的 5 个并发场景

### 场景 1: Freeze 与 Streaming 的 Cancel 竞态

**触发条件：** 用户在 AI 正在流式输出时点击 Freeze。

**时序：**
1. `_stream_one_message` 正在 `while True` 循环中逐 chunk 追加
2. 用户点击 Freeze → `freeze_room` → `_request_autodrive_stop` + `drain_active_calls`
3. `call.cancel("frozen")` → `task.cancel()`
4. cancel 信号在下一个 `await stream_iter.__anext__()` 处触发 `CancelledError`
5. `CancelledError` 被捕获，`truncated_reason = "frozen"`
6. 消息被格式化为截断版本并追加
7. `freeze_room` 的 `drain_active_calls` 的 `asyncio.gather` 等待 task 退出
8. task 在 finally 中 `_unregister_active_call` 退出
9. `freeze_room` 继续写 frozen 状态

**风险：** 步骤 4-6 可能需要最多 30s（chunk timeout）。在此期间，freeze 请求被"挂起"。用户看到的是 Freeze 按钮 loading，但房间仍显示 streaming 状态。

**缓解：** 当前设计是正确的——cancel 信号传播到 LLM stream 后立即截断。30s 是 worst-case（provider 完全无响应）。

### 场景 2: 用户消息在 Autodrive 链运行期间到达

**触发条件：** autodrive 链正在运行（AI 接力中），用户发送了一条消息。

**时序：**
1. autodrive runner 持有 lock，正在 `run_room_turn`
2. 用户 POST `/rooms/{id}/messages` → `append_user_message` → commit → `after_message_appended`
3. `maybe_autodrive_after` 检查 `lock.locked()` → True → 返回（不触发新 runner）
4. autodrive runner 完成当前 turn，进入 `_should_auto_discuss` → 可能继续下一轮
5. 如果 runner 最终退出（chain 结束），`_autodrive_runner` 的末尾调用 `_maybe_handle_pending_user_turn`
6. `_maybe_handle_pending_user_turn` 检查最新消息是否是 user-driven → 是 → 启动新 runner

**风险：** 用户消息在步骤 2 被追加，但 AI 回复要等到步骤 5-6 才开始。如果 autodrive 链还有多轮（步骤 4 继续），用户消息的回复被延迟。这是**设计意图**——autodrive 链不被打断，用户消息在链结束后被处理。

**潜在问题：** 如果 `max_consecutive_ai_turns` 很高（如 100），用户消息可能等待很长时间。

### 场景 3: 多个 Freeze/Pause/Seal 请求并发

**触发条件：** 用户快速点击 Freeze、然后 Seal、或同时发送多个 freeze 请求。

**时序：**
1. 请求 A: `freeze_room` → `drain_active_calls` → cancel + gather → 写 frozen
2. 请求 B: `seal_scene` → `drain_active_calls` → no-op（calls 已被 A 取消）→ 设置 sealed_at

**风险：** 请求 B 的 `drain_active_calls` 是 no-op，但 `clear_autodrive_lock(clear_stop=True)` 会清除请求 A 设置的 `_AUTODRIVE_STOP_REQUESTS`。如果此时有新的 autodrive 请求到达（理论上不可能，因为 room 已 frozen），它不会被 stop request 阻止。但实际上 `_ensure_room_writable` 检查 `runtime.frozen` 会阻止新消息。

**缓解：** HTTP 请求是顺序处理的（FastAPI 的 Depends(get_session) 在每个请求中创建新 session），但 `engine` 的内存态（locks, stop requests）是共享的。

### 场景 4: SQLite 写锁争用

**触发条件：** 多个房间同时有 autodrive 链运行，或同一房间的 scribe + 消息追加并发。

**时序：**
1. Room A 的 autodrive runner 正在 `session.commit()` 写入消息
2. Room B 的 autodrive runner 也尝试 `session.commit()`
3. SQLite WAL 模式下，写入者需要获取 wal writer lock

**风险：** SQLite WAL 允许一个写入者 + 多个并发读取者。如果两个写入者同时 commit，第二个会等待 `busy_timeout=15000`。在单进程 asyncio 中，`session.commit()` 是 `await` 的，event loop 可以在等待期间处理其他 task——但 SQLite 的 busy_timeout 是同步等待，会阻塞 event loop。

**缓解：** SQLAlchemy async 的 `commit()` 使用 `run_sync` 在线程池中执行同步 SQLite 操作，不会阻塞 event loop。但线程池大小有限（默认 `min(32, os.cpu_count() + 4)`）。

### 场景 5: Seal 期间 LLM 调用失败 + 用户操作

**触发条件：** 用户点击 Seal，scribe 的 LLM 调用失败，用户同时尝试 freeze 或发送消息。

**时序：**
1. `seal_scene` → `drain_active_calls` → 设置 `sealed_at` → flush
2. `run_scene_memory_scribe` → `_scribe_memory_for_character` → LLM 调用失败
3. 失败被捕获，返回 0（不抛出）
4. 用户在此期间尝试 freeze → `_ensure_not_sealed` 检查 → 409 "scene is sealed"
5. 用户尝试发送消息 → `_ensure_room_writable` → `_ensure_not_sealed` → 409

**风险：** 用户被锁定在 sealed 状态，但记忆可能不完整。Scene-end inspector 可以重跑失败的 character，但用户可能不知道需要这样做。

**缓解：** 幂等保护允许重跑；但 UI 应明确提示哪些 character 的 scribe 失败。

---

## 4. 建议补充的测试场景

### 4.1 并发与取消

| # | 测试场景 | 覆盖风险 | 优先级 |
|---|---|---|---|
| T1 | Freeze 期间 LLM provider 无响应（模拟 30s chunk timeout） | R1 | 高 |
| T2 | Pause 等待期间用户重复点击 Pause | R2 | 高 |
| T3 | Freeze + Seal 快速连续调用 | R3, 场景 3 | 高 |
| T4 | Autodrive 链运行期间用户发送消息，验证链结束后消息被处理 | 场景 2 | 高 |
| T5 | Parallel phase 的多个 in-flight calls 同时被 freeze cancel | 场景 1 | 中 |
| T6 | Seal 后单个 character scribe 失败，验证其他 character 正常写入 | R3 | 中 |
| T7 | Phase transition 期间 autodrive 正在运行 | R4 | 中 |
| T8 | `max_consecutive_ai_turns=100` 的长故事链，中途 freeze | 场景 2 | 中 |

### 4.2 SSE 与前端状态

| # | 测试场景 | 覆盖风险 | 优先级 |
|---|---|---|---|
| T9 | SSE 断线重连后 streaming chunks 恢复 | R5, RC-IP1 | 高 |
| T10 | `message.appended` 先于最后一个 `message.streaming` chunk 到达 | RC-SR2 | 中 |
| T11 | EventBus queue overflow（200 条消息 burst） | R6 | 低 |
| T12 | Room 删除后 SSE 连接行为 | RC-D2 | 中 |
| T13 | 多次 SSE 重连后的 `finalizedStreamIds` 清理 | RC-SSE2 | 低 |

### 4.3 数据一致性

| # | 测试场景 | 覆盖风险 | 优先级 |
|---|---|---|---|
| T14 | Seal 后重跑 scribe，验证幂等（不重复写入记忆） | RC-S3 | 高 |
| T15 | Freeze 后消息的 `truncated_reason` 正确设置 | R1 | 高 |
| T16 | Phase transition 后 `consecutive_ai_turns` 重置 | RC-PT1 | 中 |
| T17 | Tool-call 被 freeze cancel 后 `ToolInvocation` 状态 | RC-TC3 | 中 |
| T18 | `_AUTODRIVE_LOCKS` 内存泄漏（创建/删除 1000 个房间后） | R7 | 低 |
| T19 | Parallel phase 的 token counter 准确性 | R8 | 中 |
| T20 | Story mode 多 AI peer 路由的历史消息重写正确性 | RC-ST3 | 中 |

### 4.4 边界条件

| # | 测试场景 | 覆盖风险 | 优先级 |
|---|---|---|---|
| T21 | Room 不存在时 freeze/pause/seal/delete 的 404 行为 | - | 低 |
| T22 | 已 frozen 的 room 再次 freeze 的幂等性 | - | 中 |
| T23 | 已 sealed 的 scene 再次 seal 的幂等性 | - | 中 |
| T24 | `session.rollback()` 在 pause/freeze 中不丢失脏数据 | R10 | 中 |
| T25 | `consecutive_ai_turns` 在用户消息后正确重置为 0 | - | 中 |

---

## 5. 架构级观察

### 5.1 内存态与持久化态的分离

`ACTIVE_CALLS`、`_AUTODRIVE_LOCKS`、`_AUTODRIVE_TASKS`、`_AUTODRIVE_STOP_REQUESTS` 都是进程内存态，不持久化。进程重启后全部丢失。这意味着：

- 重启后如果有正在进行的 LLM 调用，它们会无声消失（无 truncated message）
- `autodrive_active` 在重启后为 False，即使 autodrive 之前正在运行
- `current_speakers` 在重启后为空

这是**可接受的**——单进程应用重启意味着用户主动操作，且 SQLite 中的消息是 append-only 的，不会丢失历史。

### 5.2 EventBus 的 fire-and-forget 语义

`EventBus.publish` 使用 `suppress(QueueFull)` 静默丢弃满队列的事件。这意味着：

- 慢消费者（网络慢的 SSE 客户端）可能丢失事件
- 没有事件重放机制
- 前端依赖 `/state` refetch 作为最终一致性保障

这是**合理的设计权衡**——SSE 是实时推送层，`/state` 是一致性保障层。

### 5.3 SQLite 的 `SELECT ... FOR UPDATE` 无效性

`_stream_one_message` 中的 `session.get(RoomRuntimeState, room_id, with_for_update=True)` 在 SQLite 上不提供行级锁。SQLite 的写锁是 database-level 的。这意味着 parallel phase 的多个 `_stream_one_message` 在更新 `runtime.token_counter_total` 时可能互相覆盖。

**实际影响：** token counter 可能少计几个 tokens（被覆盖的增量），但不会导致功能错误。`max_room_tokens` 检查在 chunk 循环中使用旧值，可能略微超过预算。

### 5.4 `_autodrive_runner` 的异常处理

`_autodrive_runner` 的 `except Exception` 块只记录 trace 和发布 `system.error`，不尝试修复或重试。autodrive 链在任何异常后终止。这是**正确的**——异常通常是 LLM provider 错误，重试可能加剧问题。

但 `_maybe_handle_pending_user_turn` 在 runner 末尾调用，即使 runner 因异常退出也会执行——这可能在 room 处于异常状态时启动新的 runner。

---

## 6. 总结

MAI 的运行时状态机设计整体**稳健**。单进程 asyncio 模型避免了多线程竞态；SQLite WAL + busy_timeout 提供了合理的写锁保护；前端的 finalizedStreamIds + in_flight_partial 恢复机制覆盖了 SSE 断线场景。

**最需要关注的改进方向：**

1. **Freeze/Seal 对无响应 provider 的等待时间**：考虑在 `drain_active_calls` 中增加总超时（如 35s），超时后 force-kill task。
2. **Pause 等待期间的 UI 反馈**：考虑在 pause 请求期间发布中间 SSE 事件（如 `room.pausing`），让 UI 显示"等待当前发言完成"。
3. **Seal 后 scribe 失败的可见性**：`seal_scene` 应返回每个 character 的 scribe 结果，让前端 Scene-end inspector 明确标记失败项。
4. **Phase transition 与 in-flight calls 的协调**：考虑在 `transition_to_next_phase` 中 cancel 旧 phase 的 active calls，或至少等待它们完成。
5. **`_AUTODRIVE_LOCKS` 的内存清理**：在 room 删除时或定期清理不再需要的 lock 对象。
