# 项目进度与待办

> 以 `product_design.md` / `technical_design.md` 为基线，记录当前实现状态。
> 最近更新：2026-05-06

---

## 1. 总览

| 模块 | 后端 | 前端 |
|------|------|------|
| 数据模型 / Schema | ✅ 完整 | ✅ 类型已镜像 |
| 引擎调度 / Phase FSM | ✅ 完整 | — |
| 自动驱动 / autodrive | ✅ 用户消息后自动触发下一位 persona | ✅ 发送框默认聊天化 |
| 系统级角色（书记官 / 副手） | ✅ 完整 | ✅ 面板已渲染 |
| 流式 + SSE | ✅ 含 30s 空闲超时 / parallel 多路 in-flight | ✅ 含 `message.cancelled` + 多气泡渲染 |
| 冻结 + 快照 | ✅ 完整 | ✅ 完整 |
| 子讨论 + merge-back | ✅ 完整 | ✅ 完整 |
| 决议锁定 | ✅ PATCH + audit meta | ✅ DecisionsPanel |
| 文档上传 | ✅ MD/TXT/PDF | ✅ 拖拽上传区 |
| 模板可视化编辑 | API 完整 | ✅ Persona / Phase / Format 创建完成；Persona / Format 详情编辑完成 |
| Limit 分层 | ✅ 单条 / 房间 / phase 轮次 / 账号日月预算 | ✅ LimitPanel 已可调整 |
| Markdown 渲染 | — | ✅ shiki 代码高亮 + KaTeX |
| Trace | ✅ 写入完整 | — (v1 不做查询 UI) |
| 桌面壳 / Tauri | ✅ PyInstaller sidecar 入口 | ✅ Tauri v2 壳已接入，NSIS 安装包已构建 |

当前基线：后端测试套已按主题拆分为 11 个文件（`backend/tests/test_*.py`），跑通需要 `tests/.env.test` 提供真实 LiteLLM 凭据（`OPENAI_API_KEY`），不再有 mock fallback；前端 `pnpm build` 通过，Tauri NSIS 安装包构建通过；PyInstaller sidecar 已通过 `/health` 运行时探活。

---

## 2. 已完成清单

### 2.1 引擎核心（`backend/app/engine.py`）

- 6 种 ordering 全部实现：alternating / round_robin / mention_driven / question_paired / parallel / user_picks（`engine.py:154-171`）
- 6 种 exit conditions 全部实现：rounds / all_spoken / all_voted / user_manual / facilitator_suggests / token_budget（`engine.py:517+`）
- `pick_next_speaker` 返回 wait / single / parallel / phase_done（`engine.py:51`）
- `ACTIVE_CALLS: dict[room_id, dict[message_id, InFlightCall]]` 支持 parallel 多路流；`freeze_room` 批量取消 in-flight + 房间快照 + SSE 推送
- autodrive 已接入 `after_message_appended`：用户发言、用户伪装、裁决者文本、用户文档会触发一次自动 persona 回复；AI 回复不会递归触发
- `mention_driven` 先解析最近消息中的 @-mention；未命中时回退到 round-robin，保证默认自由房间也能自动推进
- SQLite 启用 WAL 与 `busy_timeout`，缓解 autodrive 后台任务与前台请求之间的写锁竞争
- 书记官 / 副手每 5 条消息 + phase 边界触发；副手按 tag cooldown（`filter_facilitator_signals`）；副手输出落 `messages` 表 meta + `facilitator_signals` 表 + SSE
- 严格 append-only：verdict / verdict_revoke / dead_end 都是新消息（`engine.py:720-774`），`Decision.revoked_by_message_id` 反向链接
- AI 视图过滤 `visibility_to_models is True`（`engine.py:236`），副手信号对讨论者完全隐藏
- Phase 切换路由：next / continue / insert（auto_transition 跳过 UI）
- Limit 分层：单条 max tokens、房间累计 token、单 phase 最大轮次、账号日 / 月 token budget；接近阈值时副手追加 `pacing_warning`

### 2.2 数据 Schema（`models.py` + `schemas.py`）

技术文档 §4.2 列出的全部表已建好：personas、phase_templates、debate_formats、recipes、rooms、room_phase_plan、room_phase_instances、messages、scribe_states、decisions、facilitator_signals、merge_backs、room_snapshots、uploads、room_runtime_state、trace_events。

- discriminated union：`ExitCondition`、`OrderingRule`、`AllowedSpeakers`、`PersonaConfig` 全部到位
- 模板字段：`forked_from_id`、`version`、`schema_version`、`status`、`tags`
- Format 锁定 phase 版本：`FormatPhaseSlot.phase_template_version`
- JSON 列跨方言：`JSONType = JSON().with_variant(JSONB(), "postgresql")`，PG 仍走 JSONB，SQLite 走标准 JSON

### 2.3 REST 端点（`backend/app/main.py`）

模板 CRUD + export、房间 CRUD、`/turn`、`/verdicts`（含 revoke 与 dead_end）、`/masquerade`、`/messages/{id}/reveal`、`/facilitator`（on-demand）、`/phase/next` `/phase/continue` `/phase/insert`、`/limits` PATCH、`/freeze` `/unfreeze`、`/events` SSE、`/upload` + `/messages/from_upload`、`/subrooms` + `/merge_back`。Persona / Format 模板支持 PATCH：自定义模板原地更新并递增 version，内置模板保存时自动 fork。

### 2.4 内置数据（`seed.py`）

- 12 个 personas（含 scribe / facilitator，命中文档 "10–20"）
- 10 个 phase 模板（命中文档 "10"）
- 6 个 debate format（命中文档 "6"）
- 2 个 recipe

### 2.5 LLM 层（`llm.py`）

- `stream` + `complete_tool` 直接走 LiteLLM `acompletion`，tool calling 走原生 schema
- 凭据来源：persona 绑定 ApiProvider 时使用其 `api_key`/`api_base`，否则回退到 `backend/.env` 的环境变量
- `deep_thinking` 参数路由：Anthropic 走 `thinking` budget，OpenAI 走 `reasoning_effort=high`，stream / tool call 共用同一路径

### 2.6 前端

- 主路由：dashboard、room、templates、settings；`/rooms/*` 下移除顶层导航，直挂聊天壳
- Room 主视图：三栏 grid（房间列表 / 聊天 / 成员），header 内置设置入口与冻结 / 解冻
- 消息列表：QQ 风格左右气泡，用户右侧、AI 左侧、meta 居中，自动滚到底
- Composer：Enter 发送、Shift+Enter 换行；normal / judge / dead_end / 群友发言特殊模式折叠到 `...` 菜单
- 设置页：后端健康状态 + API provider CRUD；人设页可为人设绑定 provider
- 设置抽屉：Phase、Limit、Scribe、Facilitator、Decisions、Upload、Subroom 七个 Tab，支持 URL `?settings=` 同步与 Esc 关闭
- freeze / unfreeze、askFacilitator、Scribe / Facilitator 面板
- 子讨论创建 + merge-back 表单
- 文件上传（md/txt/pdf）→ user_doc 消息，支持拖拽上传区
- SSE useRoomEvents 处理 streaming / appended / scribe / facilitator / phase 事件；parallel ordering 下按 `message_id` 同时显示多个正在发言气泡
- 断线重连：`/rooms/{id}/state` 返回 `in_flight_partial`，前端恢复 partial 并按 `chunk_index` 去重
- Markdown + KaTeX、暗色模式（Zustand 持久化）
- 模板页 tag 筛选 + Format dnd-kit 顺序卡片编辑器（phase 库添加、拖拽排序、移除、保存 published）
- Persona 创建表单：kind、model、temperature、system_prompt、config JSON、tags 可配置
- Persona / Format 卡片详情编辑：复用右侧表单，保存内置模板时自动生成自定义副本
- Phase 字段编辑器：allowed_speakers、ordering_rule、exit_conditions、role_constraints、prompt_template 可视化创建
- 房间侧 LimitPanel 已支持单条 / 房间 / phase 轮次 / 账号日月 budget 调整

### 2.7 测试

测试套已按主题拆分到 `backend/tests/` 下 11 个文件：

- `test_health.py` — `/health` + 内置模板可见性
- `test_templates.py` — personas / formats / recipes / api-providers CRUD，PATCH / fork，provider 凭据注入到 `LLMAdapter.stream`
- `test_room_lifecycle.py` — 房间创建、消息追加、`/turn`、phase continue、子讨论 + merge_back、分层 limit
- `test_engine.py` — 6 种 ordering 调度、`freeze_room` 取消 autodrive、4 个 autodrive 场景（happy、non-recurse、mention 回退、frozen 短路）
- `test_scribe_facilitator.py` — scribe 把 verdict 折进 decisions、phase 边界强制整理、facilitator 每 5 条触发 + cooldown + 手动 `/facilitator` 绕过
- `test_verdict.py` — verdict_revoke / dead_end / decision 锁定审计 meta
- `test_in_flight.py` — `in_flight_partial` 断线重连、parallel 多路 streams、chunk idle timeout
- `test_masquerade.py` — 伪装发言 + reveal + 普通消息 reveal 拒绝
- `test_uploads.py` — upload 绑定 owning room
- `test_visibility.py` — observer_only facilitator 消息不进入 LLM context
- `test_llm_adapter.py` — `_build_extra_params` / `_build_provider_params` 纯单元（不调 LLM）

共享 fixture（`client`、`review_format`、`architect_persona` 等）放在 `tests/conftest.py`。`conftest.py` import 前会加载 `tests/.env.test`；缺 `OPENAI_API_KEY` 直接 pytest 退出。运行前用户必须在 `tests/.env.test` 填入真实 token。

### 2.8 部署 / 数据存储

- 默认存储为 SQLite（`backend/mai.sqlite3`）；通过 `DATABASE_URL` 可切到 PostgreSQL，两条路径都受测。
- 打包态（`MAI_PACKAGED=1` 或 PyInstaller `sys.frozen`）下，SQLite 文件、`trace_payloads/`、`uploads/` 自动落到 `%APPDATA%/MAI/`（macOS / Linux 取对应 user-data 目录）。
- FastAPI 在 `frontend/dist/index.html` 存在或 `MAI_FRONTEND_DIST` 指定时，自动以 `SPAStaticFiles` 把前端挂在 `/`，并对未匹配路径回落到 `index.html`；`_strip_api_prefix` 中间件把进来的 `/api/...` 重写到根，前端 `VITE_API_BASE` 不必修改即可在单进程模式下工作。
- Tauri v2 壳位于 `frontend/src-tauri/`，通过 `tauri-plugin-shell` 启动 `mai-backend` sidecar；sidecar 由 `backend/mai_backend_main.py` + `backend/mai-backend.spec` 打包，脚本入口是 `scripts/build-sidecar.ps1` 与 `scripts/package-tauri.ps1`。

---

## 3. 待办（按优先级）

### P0 · 安全兜底

- [x] **30 秒 chunk 间隔超时** —— `engine.py:CHUNK_IDLE_TIMEOUT_SECONDS` + `asyncio.wait_for` 包裹 `__anext__()`，超时落 `truncated_reason="timeout"`，覆盖测试 `test_chunk_idle_timeout_truncates_message`。

### P1 · v1 验收剧本必经

- [x] **Format 顺序卡片编辑器**：赛制页已支持从 phase 库添加、dnd-kit 拖拽排序、移除 phase，并通过 `POST /templates/formats` 保存为 published。
- [x] **Phase 卡内完整字段编辑器**：新建 Phase 已可配置 allowed_speakers / ordering_rule / exit_conditions / role_constraints / prompt_template。
- [x] **Limit 分层补齐**：`RoomRuntimeState` 补齐 `max_phase_rounds`、账号日 / 月 token budget；UI 可调；phase 轮次会触发退出建议，接近阈值时副手主动追加 `pacing_warning`。

### P2 · 完整体验

- [x] **决议锁定 / 解锁 UI** —— 新增 `PATCH /rooms/{id}/decisions/{id}`、`DecisionsPanel`，锁定动作 append meta 消息保留审计；覆盖测试 `test_decision_lock_toggle_creates_audit_meta`。
- [x] **`message.cancelled` SSE** —— `hooks.ts` 在 cancelled 上 clearStream + invalidate query。
- [x] **parallel 模式多气泡渲染**：后端 parallel ordering 为每个 persona 开独立 LLM stream / `InFlightCall`，`/state` 返回多个 partial；前端按 room + `message_id` 路由并同时显示多个 "正在发言" 气泡（§8.8）。
- [x] **persona 创建 UI**：模板页可新建 discussant / scribe / facilitator，并配置 backing_model、temperature、system_prompt、config JSON、tags。
- [x] **format / persona 详情编辑 UI**：Persona / Format 卡片可载入右侧表单编辑；自定义模板 PATCH 原地更新，内置模板保存为 fork 副本。
- [x] **断线重连协议**：`GET /rooms/{id}/state` 返回 `in_flight_partial`，前端 hydrate streaming 气泡并按 `chunk_index` dedupe（§8.4）。

### P3 · 打磨

- [x] **代码高亮（shiki）** —— `MarkdownBlock` 通过 shiki `codeToHtml` 渲染 fenced code，主题随暗色模式切换。
- [x] **Tag 筛选 UI** —— `TemplatesPage` 四个视图（personas / phases / formats / recipes）顶部加可点选 tag 过滤条，多 tag AND 过滤。
- [x] **拖拽上传区**：Room 侧上传面板支持拖入或选择 md/txt/pdf，并保留冻结态禁用。
- [x] **Extended thinking 参数路由**：`LLMAdapter._build_extra_params` 已按 `deep_thinking` 分别路由 Anthropic `thinking` budget 与 OpenAI `reasoning_effort`，stream / tool call 共用并覆盖测试（§7.3）。

### P4 · 测试覆盖补强

- [x] 子讨论 + merge-back 端到端：`test_room_lifecycle.py::test_room_full_lifecycle` 覆盖子房间创建、merge_back、父房间合并消息。
- [x] masquerade 完整流程（含 reveal）：`test_masquerade_reveal_flow` 覆盖伪装发言、身份揭示、普通消息 reveal 拒绝。
- [x] 6 种 ordering 各自的单测：`test_pick_next_speaker_ordering_rules` 覆盖 mention_driven / user_picks / parallel / round_robin / alternating / question_paired。
- [x] visibility 过滤的真实场景断言：`test_hidden_facilitator_messages_are_filtered_from_llm_context` 覆盖 observer_only facilitator 消息不进入 LLM context。

### P5 · 桌面壳

- [x] **PyInstaller sidecar 入口**：`backend/mai_backend_main.py` 支持 `--host` / `--port` / `--log-level`，默认设置 `MAI_PACKAGED=1`。
- [x] **sidecar 运行时导入兜底**：入口直接导入 `app.main`，spec 显式收集 `app.*`，避免安装版启动时报 `ModuleNotFoundError: No module named 'app'`。
- [x] **Tauri v2 工程骨架**：`frontend/src-tauri` 已配置窗口、sidecar、capability 与 NSIS bundle。
- [x] **动态 API Base 注入**：Tauri 壳启动 sidecar 后，把 `window.__MAI_API_BASE__` 注入前端，避免固定端口冲突。
- [x] **打包脚本**：`scripts/build-sidecar.ps1` 构建 `mai-backend-<target-triple>.exe`，`scripts/package-tauri.ps1` 生成安装包。
- [x] **本机安装包验证**：`pnpm tauri build` 已生成 `frontend/src-tauri/target/release/bundle/nsis/MAI_0.1.0_x64-setup.exe`。

---

## 4. v1 验收剧本完成度

文档 §14 验收剧本：开房 → 加载方案评审 4 phase → 拉 4 人设 → 拖入文档 → 跑完 → 锁决议 → 伪装投放 → 副手提示打转后切 phase → 开子讨论 → 合并 → 拿结构化结论。

**后端**：100% 跑得通（拆分后的 `tests/test_*.py` 已断言关键节点）。

**前端**：P1 / P2 / P3 已清；三栏聊天壳、设置抽屉、极简 Composer、动态成员状态、决议锁、代码高亮、tag 筛选、Persona 创建与编辑、Format 顺序卡片编辑与详情编辑、Phase 字段编辑器、Limit 分层、断线重连、上传拖拽区、parallel 多气泡已落地。P4 测试补强已完成。

**桌面壳**：代码、脚本与 NSIS 安装包构建验证已完成。

附加场景（自定义 phase + 导出）：列表筛选 + Phase 字段表单 + Format 顺序模板可走通。

---

## 5. v1 不做的（与文档保持一致，避免误增）

消息编辑 / 删除、倒带 / 分支（除子房间）、导演权限、phase 嵌套、赛制切回、节点连线编辑器、自荐发言、人设互相设计、人设打分微调、red team 召唤、观察席、多用户高并发、trace 分析 UI、图片 / 多模态、分享只读链接、移动端、streaming 续写、超时自动重试、模板导入、draft 状态功能、runtime tag。

字段已预留但功能不实现的：`status='draft'`、`forked_from_id`、`forked_from_version`。
