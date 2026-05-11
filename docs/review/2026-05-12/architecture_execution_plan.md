# MAI 下一阶段架构整理执行计划

> 日期：2026-05-12
> 基于本轮全部审计：
> - [`architecture_map.md`](./architecture_map.md) — 全局架构地图
> - [`contract_consistency_audit.md`](./contract_consistency_audit.md) — 前后端契约一致性
> - [`glue_and_compat_audit.md`](./glue_and_compat_audit.md) — 胶水代码、兼容逻辑与迁移残留
> - [`runtime_state_machine_audit.md`](./runtime_state_machine_audit.md) — 运行时状态机、并发与取消
> - [`story_world_boundary_audit.md`](./story_world_boundary_audit.md) — Story World 与 Discussion Room 架构边界
>
> 性质：执行计划，不修改代码

---

## 1. 执行摘要

五轮审计覆盖了 MAI 的全局架构、前后端契约、胶水/兼容层、运行时状态机和 Story World 边界。共计发现 **31 项胶水/兼容问题**、**10 项状态机风险**、**10 项边界风险**、**50 项契约漂移**、**12 项高风险架构候选**。

**整体评估**：MAI 的核心架构（单进程 asyncio、append-only 消息、Room + world_id 增量模型、drain_active_calls 取消模式、SSE + /state refetch 双层一致性）是稳健的。问题集中在三个层面：

1. **守卫缺失**：后端端点层缺少 Scene 守卫，Discussion Room 专属功能可误入 Story World
2. **兼容债务**：三字段模型解析（`backing_model` + `api_provider_id` + `api_model_id`）导致每个 AI 调用 4 分支回退、provider 删除 12 条 UPDATE、9 个 Pydantic schema 携带死字段
3. **契约漂移**：9 个前端 API 方法用 `unknown` 绕过类型检查、`narration` 消息类型前端未声明、`room.deleted` SSE 事件无处理、React Query invalidation 只覆盖 room 级

本计划将所有发现按 P0/P1/P2 分级，给出 15 个具体行动项。

---

## 2. 当前最大风险 Top 10

综合五份审计，按严重度 × 可能性排序：

| 排名 | 风险 | 来源 | 严重度 | 可能性 |
|------|------|------|--------|--------|
| 1 | **三字段模型解析链**：每个 AI 调用 4 分支回退，provider 删除 12 条 UPDATE | 胶水审计 A1/A2/D1/D2 | 高 | 高（每次 AI 调用） |
| 2 | **Freeze/Seal 对无响应 provider 等待无上限** | 状态机审计 R1 | 高 | 低 |
| 3 | **Room 状态四源不一致**：`Room.status` / `Room.frozen_at` / `RoomRuntimeState.frozen` / `Room.sealed_at` | 胶水审计 I1 | 高 | 中 |
| 4 | **Verdict/Dead End/Sub-room 可在 Scene 中调用** | 边界审计 R1/R2 | 中 | 中 |
| 5 | **9 个前端 API 方法用 `unknown` 绕过类型检查** | 契约审计 C-01~C-09 | 中 | 高（每次模板编辑） |
| 6 | **`room.deleted` SSE 事件前端无处理** | 契约审计 C-37、状态机审计 R9 | 中 | 中 |
| 7 | **Seal 后 scribe 部分失败用户无感知** | 状态机审计 R3 | 中 | 低 |
| 8 | **React Query invalidation 只覆盖 room 级**：World/Template/SceneMembers 跨页面 stale | 契约审计 C-38~C-43 | 中 | 高（多标签场景） |
| 9 | **`_ADDED_COLUMNS` 33 条无清理机制** | 胶水审计 C12 | 中 | 高（持续增长） |
| 10 | **`story` tag 承载 4 个隐式行为开关** | 边界审计 R3 | 中 | 中 |

---

## 3. P0 / P1 / P2 路线图

### P0 — 立即执行（阻塞安全发布）

共 5 项，预计 2-3 天。

---

#### P0-1: 后端 Scene 守卫补齐

- **标题**：后端 Scene 守卫补齐
- **背景**：verdict、sub-room、facilitator 手动触发、masquerade 端点无 `is_scene_room` 检查，可在 Story World Scene 中调用，语义不匹配。边界审计 §1.10、§5。
- **目标**：所有 Discussion Room 专属端点在 Scene 中返回 409。
- **涉及文件**：
  - `backend/app/main.py` — verdict 端点 (~line 1600)、facilitator 端点 (~line 1801)、sub-room 创建端点、masquerade 端点 (~line 1655)
- **改动范围**：每个端点加 2-3 行 `if is_scene_room(room): raise HTTPException(409, "...")`。抽取 `_ensure_not_scene(room)` 辅助函数统一守卫模式。
- **风险**：极低。纯增量守卫，不改变现有行为。
- **验收标准**：
  - `POST /rooms/{scene_id}/verdicts` 返回 409
  - `POST /rooms/{scene_id}/facilitator` 返回 409
  - `POST /rooms/{scene_id}/subroom` 返回 409
  - `POST /rooms/{scene_id}/masquerade` 返回 409
  - Discussion Room 中上述端点行为不变
- **测试建议**：为每个端点写 Scene 中 409 测试 + Discussion Room 正常测试（状态机审计 T26-T30）。
- **是否需要迁移**：否
- **是否影响老用户数据**：否

---

#### P0-2: RightPanel Scene 面板过滤

- **标题**：RightPanel Scene 面板过滤
- **背景**：`RightPanel.tsx` 在 Scene 中仍显示 Decisions、Facilitator、Subroom 面板。边界审计 §1.10。
- **目标**：Scene 中隐藏 Discussion 专属面板。
- **涉及文件**：
  - `frontend/src/pages/room/RightPanel.tsx`
  - `frontend/src/pages/room/RoomShell.tsx`（传递 `isScene` prop）
- **改动范围**：`RightPanel` 接收 `isScene` prop，条件渲染过滤 Decisions/Facilitator/Subroom。Scene 中保留 Phase / Limits / Tools / Upload / Scribe（显示空状态）。
- **风险**：极低。纯 UI 过滤。
- **验收标准**：Scene 中右侧面板不显示 Decisions、Facilitator、Subroom；Discussion Room 不变。
- **测试建议**：手动验证 Scene 和 Discussion Room 面板差异。
- **是否需要迁移**：否
- **是否影响老用户数据**：否

---

#### P0-3: drain_active_calls 总超时保护

- **标题**：drain_active_calls 总超时保护
- **背景**：freeze/seal/delete 等待 in-flight task 退出。provider 完全无响应时 cancel 信号无法感知，`asyncio.gather` 等待直到 chunk timeout (30s)。状态机审计 R1、场景 1。
- **目标**：`drain_active_calls` 增加总超时（35s），超时后 force-kill task。
- **涉及文件**：
  - `backend/app/engine.py` — `drain_active_calls` 函数
- **改动范围**：`asyncio.gather` 改为 `asyncio.wait` + 总超时。超时后对未退出的 task 再次 `cancel()`，记录 trace event。
- **风险**：低。超时后 force-kill 的 `finally` 块仍会执行（需 TV-1 验证）。
- **验收标准**：Freeze 在 provider 无响应时最多 35s 后强制完成；正常行为不变。
- **测试建议**：T1（模拟 30s chunk timeout）。
- **是否需要迁移**：否
- **是否影响老用户数据**：否

---

#### P0-4: 契约漂移紧急修复 — narration 类型 + room.deleted + updateLimits

- **标题**：契约漂移紧急修复
- **背景**：三个高优先级契约问题：(1) `narration` 消息类型前端未声明，Story World 旁白消息类型窄化遗漏（C-27）；(2) `room.deleted` SSE 事件前端无处理，删除房间后 stale（C-37）；(3) `updateLimits` 请求/响应都是 `unknown`（C-09）。
- **目标**：修复三个紧急契约漂移。
- **涉及文件**：
  - `frontend/src/types.ts` — `MessageType` 联合类型增加 `"narration"`
  - `frontend/src/hooks.ts` — `useRoomEvents` 增加 `room.deleted` 处理
  - `frontend/src/pages/room/RoomShell.tsx` — 删除后导航回首页
  - `frontend/src/api.ts` — `updateLimits` 请求/响应类型替换 `unknown`
  - `backend/app/schemas.py` — 确认 `LimitUpdate` / `LimitOut` schema
- **改动范围**：
  - `MessageType` 联合类型增加 `"narration"` + `"participant.enter"` + `"participant.exit"`
  - `useRoomEvents` 增加 `case "room.deleted":` → `queryClient.removeQueries` + 导航回 `/`
  - `updateLimits` 请求体类型从 `unknown` 改为具体类型
- **风险**：极低。纯类型修复和事件处理。
- **验收标准**：
  - TypeScript 编译通过，narration 消息不触发类型错误
  - 删除房间后前端自动回到首页
  - `updateLimits` 调用有编译时类型保护
- **测试建议**：CT-12（MessageType includes narration）、CT-13（useRoomEvents handles all backend event types）。
- **是否需要迁移**：否
- **是否影响老用户数据**：否

---

#### P0-5: Seal 后 scribe 失败的可见性

- **标题**：Seal 后 scribe 失败的可见性
- **背景**：seal 过程中 scribe 失败时 `sealed_at` 已写入，用户无感知哪些 character 失败。状态机审计 R3、场景 5。
- **目标**：seal 响应中包含每个 character 的 scribe 结果。
- **涉及文件**：
  - `backend/app/engine.py` — `run_scene_memory_scribe` 返回值
  - `backend/app/main.py` — `seal_scene` 端点 response model
  - `backend/app/schemas.py` — `SealResult` 新 schema
  - `frontend/src/pages/room/RoomShell.tsx` — seal 后展示结果
- **改动范围**：
  - `run_scene_memory_scribe` 返回 `list[CharacterScribeResult]`（character_id, name, episodes_count, impressions_count, vows_count, error）
  - `seal_scene` 响应包含 scribe 结果
  - 前端 seal 后 toast 展示失败项
- **风险**：低。response model 扩展。
- **验收标准**：seal 响应包含每个 character 结果；失败项在 UI 有标记。
- **测试建议**：T6（单个 character scribe 失败）。
- **是否需要迁移**：否
- **是否影响老用户数据**：否

---

### P1 — 近期执行（稳定性与债务清理）

共 6 项，预计 5-8 天。

---

#### P1-1: 模型解析链简化（三字段 → 单字段）

- **标题**：模型解析链简化
- **背景**：`backing_model` + `api_provider_id` + `api_model_id` 三字段共存于 `PersonaTemplate`、`PersonaInstance`、`AppSettings`。每个 AI 调用走 4 分支回退（胶水审计 A1/A2）；provider 删除需 12 条 UPDATE（胶水审计 D1/D2）；9 个 Pydantic schema 携带死字段（胶水审计 B4）。
- **目标**：确认所有活跃 DB 已通过 `migrate_api_models.py` 填充 `api_model_id` 后，运行清理迁移移除 `backing_model` 和 `api_provider_id`。
- **涉及文件**：
  - `backend/app/models.py` — `PersonaTemplate`、`PersonaInstance`、`AppSettings` 移除旧字段
  - `backend/app/db.py` — `_ADDED_COLUMNS` 移除对应条目
  - `backend/app/engine.py` — `resolve_api_provider` / `resolve_persona_runtime` 简化为单分支
  - `backend/app/main.py` — `_sync_api_model_snapshot` 移除；provider/model 删除端点简化为单列清理
  - `backend/app/schemas.py` — 9 个 schema 移除旧字段
  - `frontend/src/types.ts` — 移除 `@deprecated` 字段
- **改动范围**：
  - 新增 `migrate_drop_legacy_model_fields.py` 一次性迁移：确认所有行有 `api_model_id` 后 DROP COLUMN
  - `resolve_persona_runtime` 简化为 `instance.api_model_id → settings.default_api_model_id` 两层
  - provider 删除端点从 12 条 UPDATE 简化为 2 条
- **风险**：中。需要先确认无老 DB 依赖旧字段。迁移前运行检查查询：`SELECT COUNT(*) FROM persona_templates WHERE api_model_id IS NULL AND backing_model IS NOT NULL`。
- **验收标准**：
  - 模型解析只有两层回退
  - provider 删除只需 2 条 UPDATE
  - 9 个 Pydantic schema 不再携带 `backing_model` / `api_provider_id`
  - 前端类型无 `@deprecated` 字段
- **测试建议**：所有现有后端测试通过；新增测试验证旧数据迁移后模型解析正确。
- **是否需要迁移**：是。`migrate_drop_legacy_model_fields.py`：DROP COLUMN `backing_model` 和 `api_provider_id` 从 3 张表。
- **是否影响老用户数据**：是。迁移会删除列，但数据已迁移到 `api_model_id`。

---

#### P1-2: message_type 枚举化

- **标题**：message_type 枚举化
- **背景**：`MessageCreate.message_type` 接受任意字符串（C-12），`"narration"` 语义靠下游消费，拼错不报错。边界审计 §1.7。
- **目标**：定义 `MessageType` 枚举，约束合法值。
- **涉及文件**：
  - `backend/app/schemas.py` — 新增 `MessageType` 枚举
  - `frontend/src/types.ts` — 同步枚举
- **改动范围**：
  - 枚举值：`speech`, `question`, `answer`, `user_doc`, `narration`, `participant.enter`, `participant.exit`, `verdict`, `verdict_revoke`, `dead_end`, `tool_invocation`, `facilitator_signal`, `scribe_update`, `merge_back`, `meta`, `system_error`
  - `MessageCreate.message_type` 改为 `MessageType` 类型
  - 后端其他写入 `message_type` 的地方保持 str（兼容已有数据）
- **风险**：低。Pydantic 层校验，数据库层保持 str。
- **验收标准**：非法 `message_type` 返回 422；已有消息读取不受影响。
- **测试建议**：传入非法值验证 422。
- **是否需要迁移**：否
- **是否影响老用户数据**：否

---

#### P1-3: Room 状态源统一

- **标题**：Room 状态源统一
- **背景**：Room frozen/sealed 状态由 4 个字段表示：`Room.status`、`Room.frozen_at`、`RoomRuntimeState.frozen`、`Room.sealed_at`。引擎在不同代码路径检查不同字段（胶水审计 I1）。`Room.status` 还有 `"active"` / `"frozen"` 两种值，但 `sealed_at` 是独立的时间戳。
- **目标**：确立 `Room.status` 为唯一状态源，其他字段降级为时间戳/派生值。
- **涉及文件**：
  - `backend/app/models.py` — `Room.status` 增加 `"sealed"` 枚举值
  - `backend/app/engine.py` — 统一检查 `room.status` 而非混用 `runtime.frozen` / `room.sealed_at`
  - `backend/app/main.py` — `_ensure_room_writable` 统一用 `room.status`
- **改动范围**：
  - `RoomStatus` 枚举增加 `"sealed"`
  - `seal_scene` 设置 `room.status = "sealed"` 而非只设 `sealed_at`
  - `_ensure_not_frozen` 和 `_ensure_not_sealed` 合并为 `_ensure_room_status(room, "active")`
  - `runtime.frozen` 改为从 `room.status` 派生
- **风险**：中。需要确保所有检查 `runtime.frozen` / `room.sealed_at` 的地方都改为检查 `room.status`。遗漏会导致状态不一致。
- **验收标准**：
  - 所有 freeze/seal/writable 检查统一走 `room.status`
  - `frozen_at` / `sealed_at` 仅用于 UI 显示时间戳
  - 现有测试全部通过
- **测试建议**：回归所有 freeze/pause/seal/delete 测试。
- **是否需要迁移**：是。已有 sealed room 需要 `UPDATE rooms SET status = 'sealed' WHERE sealed_at IS NOT NULL`。
- **是否影响老用户数据**：是。迁移更新 `status` 字段，行为不变。

---

#### P1-4: story tag 行为字段化

- **标题**：story tag 行为字段化
- **背景**：`story` tag 在 `_should_auto_discuss` 和 silent 提示中承担 4 个隐式行为开关。边界审计 §1.3。
- **目标**：将 `skip_geometric_decay` 和 `silent_policy` 从 tag 检查改为 phase 配置字段。
- **涉及文件**：
  - `backend/app/models.py` — `PhaseTemplate` 增加两个字段
  - `backend/app/db.py` — `_ADDED_COLUMNS`
  - `backend/app/engine.py` — `_should_auto_discuss` 读取字段
  - `backend/app/seed.py` — `story_mode` phase 设置新字段值
- **改动范围**：
  - `PhaseTemplate` 增加 `skip_geometric_decay: bool = False`、`silent_policy: str = "silent_if_nothing"`
  - `_should_auto_discuss` 中 `"story" in phase_tags` 改为 `phase.skip_geometric_decay`
  - silent 提示中 `"story" in phase_tags` 改为 `phase.silent_policy == "maintain_presence"`
- **风险**：中。老 phase 模板默认值需与当前行为一致。
- **验收标准**：`story_mode` phase 行为不变；自定义 phase 默认衰减行为不变。
- **测试建议**：验证 story_mode 持续接力行为不变。
- **是否需要迁移**：是。一次性迁移：tags 含 `story` 的 phase 设置 `skip_geometric_decay=True`、`silent_policy="maintain_presence"`。
- **是否影响老用户数据**：是。迁移修改老 phase 字段值，行为不变。

---

#### P1-5: React Query invalidation 扩展

- **标题**：React Query invalidation 扩展
- **背景**：`useRoomEvents` 所有 SSE 事件只 invalidate `["room", roomId]`，不 invalidate `rooms`（sidebar）、`worlds`、`world-timeline`、`scene-members`、`character-memories` 等。跨页面 stale 数据。契约审计 C-38~C-43。
- **目标**：SSE 事件 invalidate 覆盖关联的 query keys。
- **涉及文件**：
  - `frontend/src/hooks.ts` — `useRoomEvents` 扩展 invalidation
  - `frontend/src/queryKeys.ts` — 确认 query key 定义
- **改动范围**：
  - `persona.instance.updated` / `persona.instance.removed` → 额外 invalidate `queryKeys.rooms`（sidebar 成员头像）
  - `room.frozen` / `room.unfrozen` → 额外 invalidate `queryKeys.rooms`（sidebar 状态）
  - `room.deleted` → `queryClient.removeQueries` + invalidate `queryKeys.rooms`
  - 新增 `queryKeys.sceneMembers(roomId)` 的 invalidation
- **风险**：低。增量 invalidation，不影响已有行为。
- **验收标准**：房间内操作后切换到 World 列表或 sidebar，数据不 stale。
- **测试建议**：多标签场景下验证跨页面数据一致性。
- **是否需要迁移**：否
- **是否影响老用户数据**：否

---

#### P1-6: 前端 API 请求体类型补全

- **标题**：前端 API 请求体类型补全
- **背景**：9 个前端 API 方法用 `unknown` 绕过类型检查（C-01~C-09）。字段拼写错误只有运行时 422。
- **目标**：所有 API 方法的请求体和响应体都有具体类型。
- **涉及文件**：
  - `frontend/src/api.ts` — 9 个方法的类型替换
  - `frontend/src/types.ts` — 补充缺失的请求/响应类型
- **改动范围**：
  - `createPersonaTemplate` / `updatePersonaTemplate` → `PersonaTemplateCreate` / `PersonaTemplateUpdate`
  - `createFormat` / `updateFormat` → `DebateFormatCreate` / `DebateFormatUpdate`
  - `createRecipe` / `updateRecipe` → `RecipeCreate` / `RecipeUpdate`
  - `createPhase` / `updatePhase` → `PhaseTemplateCreate` / `PhaseTemplateUpdate`
  - `updateLimits` → `LimitUpdate`（P0-4 已处理）
- **风险**：低。纯类型替换，不改变运行时行为。
- **验收标准**：TypeScript 编译通过；lint 规则禁止 `unknown` 请求体。
- **测试建议**：CT-11（lint 规则）。
- **是否需要迁移**：否
- **是否影响老用户数据**：否

---

### P2 — 中期规划（架构演进与技术债清理）

共 7 项，预计 7-12 天。

---

#### P2-1: _ADDED_COLUMNS 清理机制

- **标题**：_ADDED_COLUMNS 清理机制
- **背景**：33 条 `_ADDED_COLUMNS` 无清理机制，持续增长。每次启动检查所有 9 张表。胶水审计 C12。
- **目标**：建立定期审计流程，移除已通过 `create_all` 覆盖的条目。
- **涉及文件**：
  - `backend/app/db.py` — `_ADDED_COLUMNS` 条目清理
- **改动范围**：
  - 审计每条 `_ADDED_COLUMNS`：如果列已在 `models.py` 的 `Column()` 定义中且所有活跃 DB 都已运行过 `create_all`，移除该条目
  - 建立文档规范：新增 `_ADDED_COLUMNS` 条目时注明预计清理时间
- **风险**：低。移除条目前确认列已存在。
- **验收标准**：`_ADDED_COLUMNS` 条目数减少到必要的最小集。
- **测试建议**：在已有旧 DB 上运行 `create_schema`，确认无报错。
- **是否需要迁移**：否（清理的是迁移辅助代码）
- **是否影响老用户数据**：否

---

#### P2-2: 前端响应体字段补全

- **标题**：前端响应体字段补全
- **背景**：后端返回 10+ 字段前端未声明（C-13~C-26），包括 token 统计、运行时状态、模板状态等。信息白白丢失。
- **目标**：前端 TypeScript 类型覆盖后端所有返回字段。
- **涉及文件**：
  - `frontend/src/types.ts` — 补充缺失字段
- **改动范围**：
  - `Message` 增加 `content_chunks_count`、`prompt_tokens`、`completion_tokens`、`cost_usd`
  - `Runtime` 增加 `current_user_mode`、`current_masquerade_persona_id`
  - `PersonaTemplate` 增加 `schema_version`、`status`
  - `FacilitatorSignal` 增加 `message_id`、`trigger_after_message_id`
  - `Room` 增加 `owner_user_id`、`format_version`、`frozen_at`
- **风险**：低。纯类型补充。
- **验收标准**：TypeScript 编译通过；CT-08/CT-09/CT-10 通过。
- **测试建议**：编译时类型断言测试。
- **是否需要迁移**：否
- **是否影响老用户数据**：否

---

#### P2-3: Memory/Relation 乐观锁

- **标题**：Memory/Relation 乐观锁
- **背景**：用户封幕进行中手动编辑 memory/relation，scribe 完成后覆盖用户编辑。边界审计 §1.8。
- **目标**：`WorldCharacterMemory` 和 `WorldCharacterRelation` 增加 `version` 字段。
- **涉及文件**：
  - `backend/app/models.py` — 增加 `version: int = 1`
  - `backend/app/db.py` — `_ADDED_COLUMNS`
  - `backend/app/main.py` — PATCH/PUT 端点检查 version
  - `backend/app/engine.py` — scribe 写入时 bump version
- **改动范围**：手动编辑接收 `expected_version`，不匹配返回 409；scribe bump `version += 1`。
- **风险**：低。乐观锁标准模式。
- **验收标准**：并发编辑后写入者收到 409。
- **测试建议**：模拟 scribe 进行中手动编辑。
- **是否需要迁移**：是。`_ADDED_COLUMNS` 增加 `version` 列，默认值 1。
- **是否影响老用户数据**：否。新列默认值兼容。

---

#### P2-4: 封幕重试机制

- **标题**：封幕重试机制
- **背景**：scribe 失败后 `sealed_at` 已写入，无法重新封幕。边界审计 §1.5。
- **目标**：增加 `seal_status` 字段，失败时可重试。
- **涉及文件**：
  - `backend/app/models.py` — `Room` 增加 `seal_status`
  - `backend/app/db.py` — `_ADDED_COLUMNS`
  - `backend/app/main.py` — `seal_scene` 逻辑调整
  - `frontend/src/pages/room/RoomShell.tsx` — 重试 UI
- **改动范围**：
  - scribe 全部成功 → `seal_status="sealed"`；有失败 → `seal_status="sealing_failed"`
  - `sealing_failed` 时端点允许重跑 scribe（跳过 drain/flush，只重跑失败 character）
- **风险**：中。幂等保护需确保重试时已写过的 character 跳过。
- **验收标准**：失败后 UI 显示重试按钮；重试只跑失败 character。
- **测试建议**：模拟 scribe 失败 → 重试 → 幂等验证。
- **是否需要迁移**：是。`_ADDED_COLUMNS` 增加 `seal_status`，已有 sealed room 默认 `"sealed"`。
- **是否影响老用户数据**：否。

---

#### P2-5: PersonaInstance 快照集中化

- **标题**：PersonaInstance 快照集中化
- **背景**：Template 和 Instance 携带 15 个相同字段，`duplicate` 手动复制所有字段。胶水审计 J1。
- **目标**：`PersonaInstance` 增加 `snapshot_from_template()` 类方法，集中复制逻辑。
- **涉及文件**：
  - `backend/app/models.py` — `PersonaInstance.snapshot_from_template()`
  - `backend/app/main.py` — 所有创建 instance 的地方改用该方法
- **改动范围**：将 `main.py` 中分散的字段复制逻辑集中到一个方法。
- **风险**：低。重构不改变行为。
- **验收标准**：创建 instance 后所有字段与 template 一致。
- **测试建议**：回归 persona instance 创建测试。
- **是否需要迁移**：否
- **是否影响老用户数据**：否

---

#### P2-6: 前端 Room 类型拆分

- **标题**：前端 Room 类型拆分
- **背景**：`Room` 类型混合了 `RoomSummaryOut`（sidebar 用）和 `RoomOut`（state 用）的字段，`members`/`member_count`/`message_count`/`last_activity_at` 在 `state.room` 上是 `undefined`。契约审计 C-33~C-36。
- **目标**：拆分为 `RoomSummary` 和 `RoomDetail` 类型。
- **涉及文件**：
  - `frontend/src/types.ts` — 拆分 `Room` 为 `RoomSummary` + `RoomDetail`
  - `frontend/src/pages/room/RoomListSidebar.tsx` — 使用 `RoomSummary`
  - `frontend/src/pages/room/RoomShell.tsx` — 使用 `RoomDetail`
- **改动范围**：类型拆分 + 消费端适配。
- **风险**：低。纯类型重构。
- **验收标准**：TypeScript 编译通过；无 `undefined` 访问。
- **测试建议**：编译时类型检查。
- **是否需要迁移**：否
- **是否影响老用户数据**：否

---

#### P2-7: Pause/Freeze 等待期间 UI 反馈

- **标题**：Pause/Freeze 等待期间 UI 反馈
- **背景**：pause 等待 active calls 完成可能数十秒，UI 无变化。状态机审计 R2。
- **目标**：pause/freeze 请求期间 UI 显示"等待当前发言完成"。
- **涉及文件**：
  - `backend/app/engine.py` — `pause_room` 发布 `room.pausing` SSE 事件
  - `frontend/src/pages/room/SpeakerStateBar.tsx` — 新增 `pausing` 状态
  - `frontend/src/hooks.ts` — 处理 `room.pausing`
  - `frontend/src/pages/room/RoomShell.tsx` — 按钮 disabled
- **改动范围**：`pause_room` 在 `_request_autodrive_stop` 后发布 `room.pausing`；SpeakerStateBar 新增 pausing 态。
- **风险**：低。纯增量 UI 状态。
- **验收标准**：点击 Pause 后立即显示"等待当前发言完成"；按钮 disabled。
- **测试建议**：T2（Pause 等待期间重复点击）。
- **是否需要迁移**：否
- **是否影响老用户数据**：否

---

## 4. 建议新建或更新的文档

| 文档 | 动作 | 内容 |
|------|------|------|
| `docs/architecture/technical_design.md` | 更新 | 补充 `drain_active_calls` 超时、`seal_status`、`MessageType` 枚举、`skip_geometric_decay`/`silent_policy`、Room 状态统一、模型解析链简化 |
| `docs/product/story_world.md` | 更新 | 补充 Scene 守卫策略、`seal_status` 重试机制 |
| `docs/ops/usage.md` | 更新 | 补充封幕重试操作说明 |
| `docs/architecture/concurrency_model.md` | **新建** | 从状态机审计提取并发模型概览 |
| `docs/architecture/message_types.md` | **新建** | `MessageType` 枚举定义、触发来源和消费者 |
| `docs/architecture/contract_sync_checklist.md` | **新建** | 从契约审计提取前后端同步检查清单 |
| `docs/review/2026-05-12/` 下 5 份审计 | 保留 | 工程复盘存档 |

---

## 5. 建议新增的测试

### 5.1 后端集成测试

| 测试 ID | 场景 | 覆盖 | 优先级 |
|---------|------|------|--------|
| T1 | Freeze 期间 provider 无响应（30s chunk timeout） | 状态机 R1 | P0 |
| T2 | Pause 等待期间重复点击 | 状态机 R2 | P1 |
| T3 | Freeze + Seal 快速连续调用 | 状态机 场景3 | P0 |
| T4 | Autodrive 链运行中用户发消息 | 状态机 场景2 | P1 |
| T5 | Parallel phase 多 in-flight 同时 freeze cancel | 状态机 场景1 | P1 |
| T6 | Seal 后单 character scribe 失败 | 状态机 R3 | P0 |
| T7 | Phase transition 期间 autodrive 运行 | 状态机 R4 | P1 |
| T14 | Seal 后重跑 scribe 幂等 | 状态机 RC-S3 | P1 |
| T15 | Freeze 后 truncated_reason 正确 | 状态机 R1 | P0 |
| T20 | Story mode 多 AI peer 路由正确性 | 状态机 RC-ST3 | P1 |
| T26 | `POST /rooms/{scene_id}/verdicts` 返回 409 | 边界 R1 | P0 |
| T27 | `POST /rooms/{scene_id}/facilitator` 返回 409 | 边界 R8 | P0 |
| T28 | `POST /rooms/{scene_id}/subroom` 返回 409 | 边界 R2 | P0 |
| T29 | `POST /rooms/{scene_id}/masquerade` 返回 409 | 边界 | P0 |
| T30 | Discussion Room 中 verdict/facilitator/subroom 正常 | 边界 | P0 |

### 5.2 契约测试

| 测试 ID | 场景 | 覆盖 | 优先级 |
|---------|------|------|--------|
| CT-01 | PersonaTemplateOut 包含 schema_version/status | 契约 C-19/C-20 | P2 |
| CT-02 | MessageOut 包含 token 统计字段 | 契约 C-13~C-16 | P2 |
| CT-03 | RoomRuntimeOut 包含 current_user_mode | 契约 C-17/C-18 | P2 |
| CT-08 | Message 类型覆盖 MessageOut 所有字段 | 契约 | P2 |
| CT-11 | lint 规则禁止 unknown 请求体 | 契约 C-01~C-09 | P1 |
| CT-12 | MessageType 包含 narration | 契约 C-27 | P0 |
| CT-13 | useRoomEvents 覆盖所有后端事件类型 | 契约 C-37 | P0 |

### 5.3 前端测试

| 测试 ID | 场景 | 优先级 |
|---------|------|--------|
| T9 | SSE 断线重连后 streaming 恢复 | P1 |
| T12 | Room 删除后导航回首页 | P0 |
| T31 | Scene 中 RightPanel 不显示 Discussion 面板 | P0 |
| T32 | Pause 期间 SpeakerStateBar 显示 pausing | P2 |

---

## 6. 建议拆分的模块

| 模块 | 当前位置 | 建议拆分 | 优先级 | 理由 |
|------|---------|---------|--------|------|
| Scene 守卫逻辑 | `main.py` 各端点内联 | 抽取 `_ensure_not_scene(room)` | P0 | 统一守卫模式 |
| 模型解析 | `engine.py:471-540` + `main.py:3127` | 抽取 `resolve_model()` 到独立函数 | P1 | 消除重复逻辑 |
| 记忆检索 | `main.py:_fetch_top_memories` | 移入 `engine.py` 或新建 `memory.py` | P2 | 核心逻辑不应在路由层 |
| seal 流程 | `main.py:seal_scene` | 抽取 `seal_scene_service()` 到 engine.py | P2 | 核心逻辑在路由层 |
| 快照逻辑 | `main.py` 多处 | `PersonaInstance.snapshot_from_template()` | P2 | 集中复制逻辑 |
| Composer 验证 | `main.py:append_user_message` | 抽取 `_resolve_composer_mode()` | P2 | 随 P2-1 一起做 |

---

## 7. 不建议现在动的模块

| 模块 | 理由 |
|------|------|
| Room → Scene 独立 domain model | `Room + world_id` 分支足够清晰，拆分需重构所有路由 |
| Phase → Scene 独立调度器 | `story_mode` phase 已是合理特化 |
| Message → Scene 独立消息表 | append-only 语义一致，拆分增加查询复杂度 |
| SSE → Scene 独立事件通道 | 事件类型统一 |
| Memory scribe → 共享框架 | 两条路径已完全独立 |
| Autodrive → Scene 独立循环 | `_should_auto_discuss` 分支已足够 |
| `engine.py` 拆分（~1800 行） | 当前耦合度虽高，但拆分需要大量接口提取，风险大于收益 |
| `main.py` 拆分（~3000+ 行） | 同上；路由顺序敏感（SPA mount 在底部），拆分容易引入路由冲突 |
| i18n 内联字典提取 | ~730 keys × 2 语言，当前内联够用，提取工具链引入复杂度 |
| Legacy 表清理（`personas`/`room_personas`） | 迁移仍在使用，等所有 DB 迁移完成后再清理 |
| EventBus 架构改造 | fire-and-forget + /state refetch 是合理权衡 |
| SQLite → PostgreSQL 强制迁移 | WAL + busy_timeout 在单进程下足够 |

---

## 8. 需要产品决策的问题

| # | 问题 | 背景 | 选项 | 建议 |
|---|------|------|------|------|
| PD-1 | Story World Scene 中是否允许工具执行？ | 后端未屏蔽，工具可能对故事有用 | A. 允许 B. 禁用 C. 按工具类型过滤 | A（允许，UI 可折叠） |
| PD-2 | Scene 中是否允许 Facilitator 手动触发？ | 引擎层早退但端点可用 | A. 禁用 B. 改为"剧情建议" | A（禁用） |
| PD-3 | 封幕失败后自动重试还是手动？ | scribe 失败后 sealed_at 已写入 | A. 自动重试 B. 仅手动 C. 自动重试全部 | B（手动，给用户控制权） |
| PD-4 | 旁白消息的 author_actual 应该是 "user" 还是 "system"？ | 旁白是用户主动行为但语义类似系统消息 | A. "user" B. "system" C. "narrator" | A（保持 "user"） |
| PD-5 | 故事模式 max_consecutive_ai_turns 是否需要硬限制？ | 长链期间用户消息被延迟 | A. 无硬限制 B. 硬限制 50 C. 长链自动暂停 | A（但 pausing UI 给打断能力） |
| PD-6 | 是否需要清理 legacy `backing_model`/`api_provider_id` 列？ | 三字段共存导致复杂度 | A. 立即清理 B. 等确认无老 DB C. 永久保留 | B（先确认迁移覆盖率） |
| PD-7 | `_ADDED_COLUMNS` 是否值得引入版本标记机制？ | 33 条无清理机制 | A. 版本标记 B. 定期人工审计 C. 不处理 | B（人工审计，成本低） |

---

## 9. 需要技术验证的问题

| # | 问题 | 验证方法 | 优先级 | 阻塞项 |
|---|------|---------|--------|--------|
| TV-1 | `drain_active_calls` 超时后 force-kill，`finally` 是否执行？ | 最小复现：task 在 await 中被 cancel | P0 | P0-3 |
| TV-2 | SQLAlchemy async `commit()` 在 SQLite WAL 下是否阻塞 event loop？ | 测量 `await session.commit()` 停顿时间 | P1 | — |
| TV-3 | 所有活跃 DB 是否已通过 `migrate_api_models.py` 填充 `api_model_id`？ | 运行检查查询 `SELECT COUNT(*) FROM persona_templates WHERE api_model_id IS NULL AND backing_model IS NOT NULL` | P1 | P1-1 |
| TV-4 | `seal_status` 迁移对已有 sealed room 的影响 | 在已有 sealed room 的 DB 上跑迁移 | P2 | P2-4 |
| TV-5 | `migrate_builtin_personas_update` 每次启动的写入量 | 测量 startup 时的 DB 写入次数 | P2 | — |
| TV-6 | `_ADDED_COLUMNS` 33 条在 startup 的耗时 | 测量 `create_schema()` 总时间 | P2 | P2-1 |

---

## 10. 推荐的最小安全重构顺序

按依赖关系和风险递减排列：

```
Week 1 (P0):
  Day 1: P0-1 (Scene 守卫) + P0-2 (RightPanel 过滤)
         — 无依赖，纯增量，可并行
  Day 2: P0-3 (drain_active_calls 超时) + P0-5 (seal 结果可见性)
         — P0-3 需要 TV-1 验证
  Day 3: P0-4 (契约紧急修复: narration + room.deleted + updateLimits)
         — 纯前端修复

Week 2 (P1):
  Day 4: P1-2 (message_type 枚举) + P1-6 (API 请求体类型补全)
         — 纯类型工作，可并行
  Day 5: P1-5 (React Query invalidation 扩展)
         — 前端改动
  Day 6-7: P1-3 (Room 状态源统一) + P1-4 (story tag 字段化)
         — 两者都需要迁移，放在一起做
  Day 8: P1-1 (模型解析链简化)
         — 需要 TV-3 验证 + DROP COLUMN 迁移，风险最高放最后

Week 3+ (P2):
  P2-1 (_ADDED_COLUMNS 清理) — 独立，可随时插入
  P2-2 (响应体字段补全) — 独立
  P2-5 (快照集中化) — 独立
  P2-6 (Room 类型拆分) — 独立
  P2-7 (Pause UI 反馈) — 独立
  P2-3 (乐观锁) → P2-4 (封幕重试) — 有依赖
```

**关键依赖**：
- P0-3 → P1-3（drain 超时机制复用于状态统一时的 room transition）
- P0-5 → P2-4（seal 结果可见性是封幕重试的前置）
- P1-1 需要 TV-3（确认无老 DB 依赖旧字段后才能 DROP COLUMN）
- P2-3 → P2-4（乐观锁是封幕重试的前置，防止重试时用户编辑覆盖）

**每步验证**：每个行动项完成后跑对应测试场景，确认无回归再进入下一步。
