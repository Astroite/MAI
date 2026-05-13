# 2026-05-13 产品形态深度 Review 与文档归并

> 范围：基于最新 `main` 对 MAI 大范围产品形态改动做一次代码审阅、文档漂移检查和 source-of-truth 归并。本文是审计快照；持续维护仍以 `docs/product/`、`docs/architecture/`、`docs/ops/` 和 `docs/status.md` 为准。

## 执行计划

1. 同步 `main`，确认工作区、分支和远端状态。
2. 阅读 AGENTS 指定的 source-of-truth 文档：产品、Story World、persona、架构、运行、桌面、状态和 UI brief。
3. 审阅后端 Scene / World / engine 路径：调度、冻结、删除、封幕、上下文注入和 schema 边界。
4. 审阅前端契约：API wrapper、React Query invalidation、Room shell、Story composer、Stage presence、World/Scene 删除入口。
5. 对照 2026-05-12 审计报告，标记已关闭项、仍开放项和新发现风险。
6. 合并文档漂移：模型回退链、内置 persona 数量、删除边界和本次审计索引。

## 执行摘要

当前产品形态的主线已经稳定：普通讨论房与 Story World Scene 仍共用 `Room` 运行时，通过 `world_id IS NULL / NOT NULL` 分支隔离；P1 Scene Experience 的上下文构建、可见性切片、三模式 composer、导演指令和两阶段 seal draft 已落地。2026-05-12 审计中的多个 P0 项已经关闭，包括 Scene 讨论功能屏蔽、`narration` / `participant.*` 消息类型、`room.deleted` 缓存失效、typed limits、删除前 drain active calls、两阶段封幕检查器。

本轮新增的主要风险集中在删除语义和文档漂移：World 删除的产品承诺是级联删除角色、场景、记忆和关系，但后端当前只删除 `World` 行；Scene 作为普通 Room 仍可被硬删除，可能留下已提交世界状态的来源引用。文档漂移项已在本次归并中修正，运行时代码风险作为 P1 待修复项保留。

## Findings

| 优先级 | 状态 | 问题 | 证据 | 建议 |
|---|---|---|---|---|
| P1 | Open | `DELETE /worlds/{world_id}` 没有兑现级联删除 Scene 的产品契约。 | `frontend/src/i18n.tsx:92` 明确提示会级联删除所有角色和场景；`backend/app/main.py:2671` 只 `delete(world)`；`backend/app/models.py:277` 的 `Room.world_id` 是 nullable/index 字段，不是 FK。 | 抽出 room 删除 helper；World 删除时先枚举 `Room.world_id == world_id` 的 Scene，逐个 drain active calls 并清理 room dependents，再删除 World 与世界状态。补 `DELETE /worlds/{id}` 含 scene 的回归测试，并让前端删除成功后 invalidate `rooms`。 |
| P1 | Open | Scene Room 硬删除入口会让已提交的世界状态留下来源断链。 | `frontend/src/pages/room/RoomListSidebar.tsx:57` 对 Scene 仍调用 `api.deleteRoom`；`backend/app/main.py:1922` 对所有 Room 都硬删；seal commit 写入 `scene_id` / `seal_draft_id` 来源引用见 `backend/app/main.py:3685`、`backend/app/main.py:3727`。 | 产品上二选一：已 sealed / committed Scene 禁止硬删并改为 archive；或实现 World-state provenance tombstone / cleanup。短期建议先禁止删除 sealed Scene，并在 UI 文案区分“删除未封幕草稿场景”和“归档已封幕场景”。 |
| P2 | Closed in docs | 模型回退链文档仍写“PersonaTemplate -> Settings”，与实际运行时不一致。 | `backend/app/model_runtime.py` 运行时解析使用 `PersonaInstance.api_model_id -> AppSettings.default_api_model_id -> legacy backing_model + api_provider_id`；模板模型在创建房间/Scene 时已快照到实例。 | 已更新 `docs/product/product_design.md` 与 `docs/ops/usage.md`，明确模板修改只影响未来实例。 |
| P2 | Closed in docs | 状态页仍写 12 个内置人设，与当前 25 persona taxonomy 不一致。 | `docs/product/personas.md` 与 seed 内容为 25 personas；`docs/status.md` 旧文案为 12 个。 | 已更新 `docs/status.md`。 |
| P2 | Open | sealed Scene 只读测试遗漏 `POST /rooms/{scene_id}/pause`；路由本身未走 `_ensure_not_sealed`。 | `backend/app/main.py:1915` 的 pause endpoint 没有 sealed guard；`backend/tests/test_scenes.py` 的 read-only 覆盖未包含 pause。 | 若 sealed 后所有 mutable room action 都应 409，则给 pause 加 `_ensure_not_sealed` 并补测试。若认为 pause 是幂等状态操作，则在架构文档中明确例外。 |
| P3 | Open | `phase.tags` 中的 `story` 仍是 engine 行为开关。 | `backend/app/engine.py::_should_auto_discuss` 仍用 `"story" in phase_tags` 控制 autodrive decay 逻辑。 | 保留为兼容债；后续迁到显式 recipe / room runtime setting，避免标签同时承载展示、分类和调度语义。 |

## 已关闭的 2026-05-12 高优先项

- Scene 中的判定、群友发言、主持、子讨论入口已在后端和右侧面板屏蔽。
- Story composer 使用 `narration`、`participant.enter`、`participant.exit` 等显式消息类型，不再把 Scene 旁白伪装成普通 user message。
- 前端已监听 `room.deleted`，并对 message append / participant enter-exit / scene sealed 做缓存失效。
- `updateLimits` 等 API wrapper 已从 `Record<string, unknown>` 收敛到明确 request types。
- `delete_room` / `freeze_room` 使用 bounded drain，降低 SQLite lock 和后台写入已删除 room 的风险。
- Seal Draft / Inspector / Commit 已替代早期自动封幕写入，用户可编辑并选择长期世界状态变更。

## 文档归并结果

- `docs/README.md` 增加本次 2026-05-13 深度 review 索引，明确 2026-05-12 是历史快照。
- `docs/product/product_design.md` 与 `docs/ops/usage.md` 统一模型回退链：实例绑定模型优先，其次全局默认，最后 legacy 字段兼容。
- `docs/architecture/append_only_boundaries.md` 增加删除实现规则：`rooms.world_id` 不是 FK，World 删除不能依赖数据库级联。
- `docs/status.md` 更新内置 persona 数量，并增加本次 review / 文档归并状态条目。

## 后续修复建议

1. 先修 World 删除级联。它与 UI 文案和用户数据安全直接冲突，且会产生普通入口看不到的 orphan Scene。
2. 再定 Scene 删除产品语义。推荐把已 sealed Scene 从 hard delete 改为 archive/tombstone，保留 world provenance。
3. 顺手补 sealed Scene pause guard 或文档例外，避免只读边界出现灰区。
4. 将 `story` tag 行为开关迁移成显式配置，降低后续 recipe/tag 扩展的隐性耦合。
