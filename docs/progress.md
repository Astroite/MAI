# 项目进度与待办

> 以 `product_design.md` / `technical_design.md` 为基线，记录当前实现状态。
> 最近更新：2026-05-01

---

## 1. 总览

| 模块 | 后端 | 前端 |
|------|------|------|
| 数据模型 / Schema | ✅ 完整 | ✅ 类型已镜像 |
| 引擎调度 / Phase FSM | ✅ 完整 | — |
| 系统级角色（书记官 / 副手） | ✅ 完整 | ✅ 面板已渲染 |
| 流式 + SSE | ✅ 含 30s 空闲超时 | ✅ 含 `message.cancelled` 处理 |
| 冻结 + 快照 | ✅ 完整 | ✅ 完整 |
| 子讨论 + merge-back | ✅ 完整 | ✅ 完整 |
| 决议锁定 | ✅ PATCH + audit meta | ✅ DecisionsPanel |
| 文档上传 | ✅ MD/TXT/PDF | ⚠️ 仅 input，无拖拽区 |
| 模板可视化编辑 | API 完整 | ⚠️ Format / Phase 创建可视化完成；persona / format 详情编辑仍缺 |
| Limit 分层 | ✅ 单条 / 房间 / phase 轮次 / 账号日月预算 | ✅ LimitPanel 已可调整 |
| Markdown 渲染 | — | ✅ shiki 代码高亮 + KaTeX |
| Trace | ✅ 写入完整 | — (v1 不做查询 UI) |

代码量：后端 `app/*.py` ~3,260 行，前端 `src/**` ~1,520 行，测试 ~280 行；文档预估 ~15,800 行（前端尚未铺开）。

---

## 2. 已完成清单

### 2.1 引擎核心（`backend/app/engine.py`）

- 6 种 ordering 全部实现：alternating / round_robin / mention_driven / question_paired / parallel / user_picks（`engine.py:154-171`）
- 6 种 exit conditions 全部实现：rounds / all_spoken / all_voted / user_manual / facilitator_suggests / token_budget（`engine.py:517+`）
- `pick_next_speaker` 返回 wait / single / parallel / phase_done（`engine.py:51`）
- `ACTIVE_CALLS: dict[room_id, InFlightCall]` 单飞约束 + `freeze_room` 取消流 + 后台任务取消 + 房间快照 + SSE 推送
- 书记官 / 副手每 5 条消息 + phase 边界触发；副手按 tag cooldown（`filter_facilitator_signals`）；副手输出落 `messages` 表 meta + `facilitator_signals` 表 + SSE
- 严格 append-only：verdict / verdict_revoke / dead_end 都是新消息（`engine.py:720-774`），`Decision.revoked_by_message_id` 反向链接
- AI 视图过滤 `visibility_to_models is True`（`engine.py:236`），副手信号对讨论者完全隐藏
- Phase 切换路由：next / continue / insert（auto_transition 跳过 UI）
- Limit 分层：单条 max tokens、房间累计 token、单 phase 最大轮次、账号日 / 月 token budget；接近阈值时副手追加 `pacing_warning`

### 2.2 数据 Schema（`models.py` + `schemas.py`）

技术文档 §4.2 列出的全部表已建好：personas、phase_templates、debate_formats、recipes、rooms、room_phase_plan、room_phase_instances、messages、scribe_states、decisions、facilitator_signals、merge_backs、room_snapshots、uploads、room_runtime_state、trace_events。

- discriminated union：`ExitCondition`、`OrderingRule`、`AllowedSpeakers`、`PersonaConfig` 全部到位
- 模板字段：`forked_from_id`、`version`、`schema_version`、`status`、`tags`（GIN 索引）
- Format 锁定 phase 版本：`FormatPhaseSlot.phase_template_version`

### 2.3 REST 端点（`backend/app/main.py`）

模板 CRUD + export、房间 CRUD、`/turn`、`/verdicts`（含 revoke 与 dead_end）、`/masquerade`、`/messages/{id}/reveal`、`/facilitator`（on-demand）、`/phase/next` `/phase/continue` `/phase/insert`、`/limits` PATCH、`/freeze` `/unfreeze`、`/events` SSE、`/upload` + `/messages/from_upload`、`/subrooms` + `/merge_back`。

### 2.4 内置数据（`seed.py`）

- 12 个 personas（含 scribe / facilitator，命中文档 "10–20"）
- 10 个 phase 模板（命中文档 "10"）
- 6 个 debate format（命中文档 "6"）
- 2 个 recipe

### 2.5 LLM 层（`llm.py`）

- `stream` + `complete_tool`，tool calling 走 LiteLLM
- mock vs real 双重判定：`MOCK_LLM` env + persona `backing_model` 以 `mock/` 起头（CLAUDE.md 已记录此约定）

### 2.6 前端

- 主路由：dashboard、room、templates、settings
- Room 主视图：消息列表、streaming bubble、phase plan 侧栏、决策横幅、auto_transition toggle
- 模式切换 dropdown：normal / judge / dead_end / masquerade（含 reveal）
- freeze / unfreeze、askFacilitator、Scribe / Facilitator 面板
- 子讨论创建 + merge-back 表单
- 文件上传（md/txt/pdf）→ user_doc 消息
- SSE useRoomEvents 处理 streaming / appended / scribe / facilitator / phase 事件
- Markdown + KaTeX、暗色模式（Zustand 持久化）
- 模板页 tag 筛选 + Format dnd-kit 顺序卡片编辑器（phase 库添加、拖拽排序、移除、保存 published）
- Phase 字段编辑器：allowed_speakers、ordering_rule、exit_conditions、role_constraints、prompt_template 可视化创建
- 房间侧 LimitPanel 已支持单条 / 房间 / phase 轮次 / 账号日月 budget 调整

### 2.7 测试

`tests/test_smoke.py` 覆盖：health、builtins、room CRUD、消息追加、scribe / facilitator 工具调用、phase transition、facilitator cooldown、verdict + revoke、freeze。

---

## 3. 待办（按优先级）

### P0 · 安全兜底

- [x] **30 秒 chunk 间隔超时** —— `engine.py:CHUNK_IDLE_TIMEOUT_SECONDS` + `asyncio.wait_for` 包裹 `__anext__()`，超时落 `truncated_reason="timeout"`，覆盖测试 `test_chunk_idle_timeout_truncates_message`。

### P1 · v1 验收剧本必经

- [x] **Format 顺序卡片编辑器**：赛制页已支持从 phase 库添加、dnd-kit 拖拽排序、移除 phase，并通过 `POST /templates/formats` 保存为 published。
- [x] **Phase 卡内完整字段编辑器**：新建 Phase 已可配置 allowed_speakers / ordering_rule / exit_conditions / role_constraints / prompt_template；persona 仍只读，归入 P2。
- [x] **Limit 分层补齐**：`RoomRuntimeState` 补齐 `max_phase_rounds`、账号日 / 月 token budget；UI 可调；phase 轮次会触发退出建议，接近阈值时副手主动追加 `pacing_warning`。

### P2 · 完整体验

- [x] **决议锁定 / 解锁 UI** —— 新增 `PATCH /rooms/{id}/decisions/{id}`、`DecisionsPanel`，锁定动作 append meta 消息保留审计；覆盖测试 `test_decision_lock_toggle_creates_audit_meta`。
- [x] **`message.cancelled` SSE** —— `hooks.ts` 在 cancelled 上 clearStream + invalidate query。
- [ ] **parallel 模式多气泡渲染**：后端可并行 stream，前端目前只单流；按 §8.8 同时显示多个 "正在打字"。
- [ ] **persona 创建编辑 UI + format 详情编辑 UI**：format 已能创建顺序模板，但还缺已有 format 的详情编辑；persona 仍只能走 API。
- [ ] **断线重连协议**：`GET /rooms/{id}/state` 返回 `in_flight_partial`，前端按 `chunk_index` dedupe（§8.4）。

### P3 · 打磨

- [x] **代码高亮（shiki）** —— `MarkdownBlock` 通过 shiki `codeToHtml` 渲染 fenced code，主题随暗色模式切换。
- [x] **Tag 筛选 UI** —— `TemplatesPage` 四个视图（personas / phases / formats / recipes）顶部加可点选 tag 过滤条，多 tag AND 过滤。
- [ ] **拖拽上传区**：当前是 `<input type=file>`，需要拖入区域。
- [ ] **Extended thinking 参数路由**：`LLMAdapter._build_extra_params` 在跨家差异处的实现（thinking budget / reasoning_effort）尚未填充（§7.3）。

### P4 · 测试覆盖补强

- 子讨论 + merge-back 端到端
- masquerade 完整流程（含 reveal）
- 6 种 ordering 各自的单测
- visibility 过滤的真实场景断言

---

## 4. v1 验收剧本完成度

文档 §14 验收剧本：开房 → 加载方案评审 4 phase → 拉 4 人设 → 拖入文档 → 跑完 → 锁决议 → 伪装投放 → 副手提示打转后切 phase → 开子讨论 → 合并 → 拿结构化结论。

**后端**：100% 跑得通（`test_smoke.py` 已断言关键节点）。

**前端**：P1 必经项已清；决议锁、代码高亮、tag 筛选、Format 顺序卡片编辑器、Phase 字段编辑器、Limit 分层已落地。剩余 P2/P3 主要是 parallel 多气泡、persona/format 详情编辑、断线重连和上传拖拽区。

附加场景（自定义 phase + 导出）：列表筛选 + Phase 字段表单 + Format 顺序模板可走通。

---

## 5. v1 不做的（与文档保持一致，避免误增）

消息编辑 / 删除、倒带 / 分支（除子房间）、导演权限、phase 嵌套、赛制切回、节点连线编辑器、自荐发言、人设互相设计、人设打分微调、red team 召唤、观察席、多用户高并发、trace 分析 UI、图片 / 多模态、分享只读链接、移动端、streaming 续写、超时自动重试、模板导入、draft 状态功能、runtime tag。

字段已预留但功能不实现的：`status='draft'`、`forked_from_id`、`forked_from_version`。
