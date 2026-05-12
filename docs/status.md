# 项目进度与状态快照

> 最近更新：2026-05-11
> 基线文档：[`product/product_design.md`](product/product_design.md) / [`architecture/technical_design.md`](architecture/technical_design.md)。Story World 子产品见 [`product/story_world.md`](product/story_world.md)。

## 1. 总览

MAI 当前已从原型期进入稳定打磨期。核心闭环已经可用：

- 创建房间。
- 选择配方、赛制和人设。
- 配置 API provider 与模型。
- 多 persona 按 phase 规则发言（含多 AI peer 路由，避免叙述者声音串味）。
- 书记官折叠状态。
- 主持信号提示节奏。
- 裁决、撤销、死路标记。
- 文档上传。
- 子讨论与合并。
- 一键冻结和恢复。
- 模板编辑与内置模板复制。
- 工具与 MCP server 注册、同步、调用审计。
- 场景化开房和初始问题预填。
- 人设模板 AI 起草（`PersonaDraftEnvelope` 严格 schema + provider 兼容降级）。
- 故事模式：单 phase 持续接力，可一键让 AI 自动演剧情。
- 房间发言状态条：实时显示 frozen / speaking / scheduling / idle，含「让 AI 继续」按钮。
- 人设主题色 + 图标系统（贯穿卡片、状态条、消息气泡）。
- 房间侧边栏卡片化，一眼看见成员头像和活跃度。
- 中英文界面切换。
- Tauri 桌面壳打包。
- **Story World**：跨房间世界 + 角色档案 + 三层记忆（core / relationships / episodic）+ 封幕 scribe + 旁白 / 扮演 composer 模式。
- **World State System**：World Detail 主控台、World Bible 编辑、World 级 Timeline Event、记忆/关系可视化列表、两阶段 Seal Draft / Inspector / Commit。

## 2. 模块状态

| 模块 | 状态 | 说明 |
|---|---|---|
| 后端 schema | 完成 | SQLite 默认、PostgreSQL 可选；轻量迁移覆盖旧库 |
| 引擎调度 | 完成 | 6 种 ordering、phase exit、autodrive、parallel in-flight |
| LLM 调用 | 完成 | LiteLLM stream + tool calling；支持 provider/model 配置 |
| API 配置 | 完成 | `ApiProvider` + `ApiModel` + `AppSettings.default_api_model_id` |
| 模板系统 | 完成 | 内置只读，duplicate 后编辑；人设/阶段/赛制/配方/API 页可用 |
| 工具与 MCP | 完成 | 内置工具、MCP server manifest 同步、成员级工具权限、调用记录 |
| 场景启动 | 完成 | 首页场景卡片可预填标题、初始问题、赛制或配方 |
| 房间 UI | 完成 | 三栏聊天壳、成员编辑、右侧设置抽屉 |
| Scribe | 完成 | 每 5 条消息和阶段边界折叠状态 |
| Facilitator | 完成 | 周期触发、手动询问、cooldown、observer-only |
| 决议 | 完成 | verdict、revoke、dead_end、lock/unlock audit |
| 上传 | 完成 | MD/TXT/PDF，提取文本作为 `user_doc` |
| 子讨论 | 完成 | 创建子房间、填写合并包、回写父房间 |
| 国际化 | 完成 | 中文/英文切换；内部枚举友好显示 |
| 桌面壳 | 完成 | Tauri v2 + PyInstaller sidecar + NSIS 打包 |
| Trace | 写入完成 | 查询与重放 UI 不做 |
| Story World | PR 1–6 全部合入 | World / Character / Scene / Memory / Relations 五张表 + 路由 + 封幕 scribe + UI；详见 [`product/story_world.md`](product/story_world.md) |
| World State System | P0 完成 | World Detail 主控台、World Bible 兼容层、Timeline Event、Memory / Relationship 可视化、两阶段封幕与 Scene-end Inspector |

## 3. 最近稳定化改动

### 3.1 模板重构

旧逻辑中，内置模板和用户模板边界不够清晰。当前规则已经统一：

- 内置模板是只读内容数据。
- 默认页签显示可编辑实例。
- “添加”从内置库复制模板。
- 后端对内置模板 PATCH / DELETE 返回 403。
- duplicate endpoint 会写 `forked_from_id`、`forked_from_version` 并创建自定义副本。

覆盖范围：

- 人设
- 阶段
- 赛制
- 配方

### 3.2 API provider / model 重构

旧逻辑把 provider 和模型名混在一起。当前拆分为：

- `ApiProvider`：用户起的可读名称、LiteLLM provider 类型、key、base、测试状态。
- `ApiModel`：挂在 provider 下的具体模型，含显示名、模型名、默认标记、启用状态、context window、tags。
- `AppSettings.default_api_model_id`：全局默认模型。
- persona template / instance 可绑定 `api_model_id`。

旧字段 `backing_model` 和 `api_provider_id` 仍保留为兼容 fallback；新写入只保存 `api_model_id`。`migrate_api_models.py` 会把旧数据补成 `api_models`。

当前模型运行时解析已集中到 `backend/app/model_runtime.py`，trace 会记录解析来源（`persona` / `settings` / `legacy_persona` / `legacy_settings`）但不记录 API key。`backing_model` / `api_provider_id` 仍处于软退役兼容期；真正删除字段需要等 trace 观察确认 legacy source 使用量可忽略后再进入单独阶段。

### 3.3 国际化

前端新增 `frontend/src/i18n.tsx`：

- `I18nProvider`
- `useI18n`
- `LanguageToggle`
- `t()`
- `display()`

已接入：

- 全局导航
- 设置页
- Dashboard
- 模板页
- 房间头部和三栏 UI
- Composer
- MessageList
- 右侧 panels
- 内部 enum / tag 友好显示

用户内容不自动翻译。

### 3.4 能力扩展层

本轮新增了 5 个方向：

- MCP / 工具注册层：`tool_servers`、`tool_invocations`、`/tools` API 和房间工具面板。
- 成员能力控制：房间内人设可独立配置自动回复、工具调用和写入工具权限。
- 工具调用可视化：`tool_invocation` 消息进入消息流，并在右侧工具面板显示最近调用。
- 场景化开房：首页场景卡片预填标题、初始问题、赛制或配方。
- 模板起草助手：人设编辑器可用自然语言填入可编辑草稿。

### 3.5 故事模式与多 AI 协演

- 新增内置 phase `story_mode` + format `story_format`，casual ordering、`auto_discuss=True`、仅 `user_manual` 退出。
- `story` 标签的 phase 跳过 casual 几何衰减：`_should_auto_discuss` 让 AI 持续接力，由 `max_consecutive_ai_turns`、token 预算或冻结收尾。
- 同标签 phase 改写 silent 提示：原 casual_chat 的"没话就 silent"换成"用一句台词或动作维持存在感"，避免一房间全部 `<silent/>`。
- `llm.py::_build_messages` 加入多 AI peer 路由：当前发言人之外的角色历史发言改写成 `user` + `「Name」: ` 前缀，并向 system prompt 注入"你只是 X 一个人"硬约束，根治"剑客代写刀客台词"那种全知叙述者退化。
- `engine.py` 新增 `is_autodrive_active` / `schedule_autodrive`；`POST /rooms/{id}/autodrive/resume` 端点让用户不发消息也能让 AI 接力。
- `POST /rooms/{id}/pause` 提供 graceful pause：故事模式里等当前角色说完再冻结；顶部 Freeze 仍是强制截断当前 in-flight。
- `RoomRuntimeOut` 暴露 `autodrive_active` 和 `current_speakers`，前端 `SpeakerStateBar` 据此显示 4 态。

### 3.6 人设主题色与视觉一致性

- `PersonaTemplate` / `PersonaInstance` 新增 `color`（hex）/ `icon`（lucide 名）字段，自愈列 `_ADDED_COLUMNS` 覆盖老库。
- 12 个内置人设全部配上独特主题色（架构师=蓝、性能=橙、安全=红、反方=深红、研究=紫……）。
- `frontend/src/components/PersonaIcon.tsx`：24 图标 + 15 色板的统一渲染，与后端 `schemas.PERSONA_ICON_NAMES` 严格对齐。
- 人设卡片 / 头像 / 房间状态条 / 消息气泡都跟随同一主题色脉络。

### 3.7 LLM 调用兼容性

- `complete_tool` 三档降级：forced → auto + nudge → no-tools JSON 模式，覆盖 `deepseek-reasoner` 类不支持强制 tool_choice 的 provider。
- `_unstring_nested` 递归还原嵌套 JSON 字符串字段，处理 MiMo / 部分 OpenRouter 中转的双重编码。
- `PersonaDraftEnvelope` 给人设起草加严格 schema：name 长度、prompt 长度、color hex 正则、icon 枚举、温度范围全约束；错误不再吞，502 直接显示给 UI。

### 3.8 SQLite 与运行时稳定性

- `synchronous=NORMAL` + `busy_timeout=15000` 替换默认。
- `delete_room` / `freeze_room` 取消 in-flight 调用后会 `asyncio.gather` 等任务真正退出，再开始 DELETE，根治"database is locked"。
- 前端 SSE invalidate 加 250 ms 去抖，autodrive burst 不会刷爆 `/state`。

### 3.9 视觉与交互整理

- 房间卡片化侧边栏：`/rooms` 返回 `RoomSummaryOut`（成员预览 + 计数 + 最近活跃），sidebar 显示主题色条 + 4 头像叠加 + 消息数 + 相对时间。
- Dashboard 三步水平节点引导：done / next / upcoming 三态，连接线变绿表示推进。
- API 配置卡片就地展开：去掉右侧 380 px aside，每张 provider 卡片点击展开后左 API 配置 / 右模型管理。
- 模板页人设卡片重组：左侧主题色条 + 图标头像 + hover-only 操作；编辑表单常用字段直显，外观/AI 起稿/高级设置折叠。

### 3.10 配置项

- 后端 dev 端口由 `8000` 改为 `47821`（高位、不撞常见 dev 服务、避开 Windows 临时端口池）。同步更新 vite proxy / dev script / 全部文档。

### 3.11 Story World（PR 1–6）

跨房间「世界」+ 角色记忆。详细设计见 [`product/story_world.md`](product/story_world.md)，下面只列阶段成果：

- **PR 1**：`World` / `WorldCharacter` 数据模型 + CRUD 路由（`/worlds`、`/worlds/{wid}/characters`）。
- **PR 2**：`Scene = Room + world_id + scene_index` + `WorldSceneMember` 名册 + 入场 / 离场 (`participant.enter` / `participant.exit` 系统消息) + engine prompt 拼接。`world_id IS NULL` 路径完全保留。
- **PR 3**：早期封幕 scribe + episodic 写入 + 检索入 prompt（当前已由下方两阶段 Seal Draft / Inspector / Commit 语义覆盖）。
- **PR 4**：关系卡片单向维护 (`world_character_relations`) + 同场角色互相进 prompt。
- **PR 5**：记忆衰减 (`decay_unused_memories`) + 上限折叠 (`enforce_memory_cap`) + 记忆手动编辑 UI。
- **PR 6**：Composer 双模式——**旁白**（导演视角描写动作 / 场景，落库为 system 消息）、**扮演**（用户挑 `kind=user` 角色以其身份发言）。

最近补强（PR 6 之后）：

- 内置模板在新建 Scene 时按 World 名册隐藏，避免误把通用 persona 混进剧本场景。
- Scene 创建后**不再自动跳房**，用户先在 World 视图确认在场名册。
- 修复 Scene 内残留的 Room scribe 渗透（`run_scribe_update` 在 `world_id IS NOT NULL` 时早退）。
- 人设模板选择从原 `<select>` 换成可搜索 picker，自动回填字段。
- **Scene-end Inspector**：封幕先生成 Seal Draft，用户可编辑摘要、勾选/取消时间轴事件、角色记忆和关系变化，确认 commit 后才写入长期世界状态。
- **World Detail 主控台**：首屏展示当前时间、主线、地点、最近一幕、伏笔/关系摘要和继续/开启下一幕入口。
- **World Bible + Timeline Event**：`World.config.world_bible` 承载世界设定兼容层，`world_timeline_events` 承载历史/状态事件；Timeline Tab 合并历史事件和 Scene 节点。
- **Memory / Relationship 可视化**：World Detail 中新增 Memories / Relationships 页签，展示来源、关联 Scene 与关系详情。
- **两阶段封幕**：新增 `world_scene_seal_drafts`，`POST /rooms/{rid}/seal` 生成草稿，`POST /rooms/{rid}/seal-drafts/{draft_id}/commit` 幂等写入 Timeline / Memory / Relationship / sealed 状态。

### 3.12 文档结构整理

- 新增 `docs/README.md` 作为文档地图，明确现行 source-of-truth、工程复盘和归档区边界。
- 新增 `docs/engineering/refactor_issues_2026-05-11.md`，记录本轮重构暴露的 pause / freeze、runtime 多源状态、Story World 语义继承和文档过期问题。
- 将早期 UI 概念图和一次性 Story World 首页实现 prompt 归档到 `docs/archive/design-concepts/`；`docs/design/` 只保留当前视觉规范 `ui_brief.md`。

## 4. 后端完成点

- `ACTIVE_CALLS` 按 room + message 跟踪。
- `freeze_room` 批量取消 in-flight，并保存 partial。
- `pick_next_speaker` 覆盖 alternating / round_robin / mention_driven / question_paired / parallel / user_picks。
- `mention_driven` 支持 @ 提及和 round-robin 回退。
- `maybe_autodrive_after` 避免 AI 回复递归触发。
- phase exit suggestion 支持 continue / next / extra round。
- scribe / facilitator 每 5 条消息和阶段边界运行。
- facilitator signal cooldown 支持 force 绕过。
- observer-only 消息不会进入 LLM context。
- RoomRuntimeState 支持分层 token 和 phase round 限额。
- SQLite 启用 WAL 与 busy timeout。
- `/api` 前缀中间件和 SPA fallback 支持单进程托管。
- `tools.py` 统一 MAI 内置工具与 MCP 工具 manifest。
- LLM 调用支持工具调用轮次，未开启工具的人设仍走原 streaming 路径。

## 5. 前端完成点

- Dashboard 创建房间，支持配方、赛制、人设选择。
- Dashboard 创建房间支持场景卡片和初始消息。
- Room 三栏布局和设置抽屉。
- Composer 支持 normal / judge / dead_end / 群友发言。
- parallel 多气泡 streaming。
- Zustand `streaming` 是流式期间唯一实时文本来源；`message.appended` 后由 TanStack Query room cache 接管最终消息。
- `message.cancelled` / final message id 会 finalized streaming 状态，防止迟到 chunk 或旧 partial 复活。
- 断线重连通过 `in_flight_partial` 恢复，且只恢复尚未进入最终消息列表的 partial。
- 成员编辑器可为房间内人设选择模型。
- 成员编辑器可配置自动回复和工具权限。
- 右侧工具面板可管理 MCP server、查看工具清单、手动执行只读工具。
- 模板页可编辑人设、阶段、赛制、配方和 API 配置。
- 模板页人设编辑器支持 AI 起草。
- API 配置页可测试 provider 和 model。
- 设置页选择默认模型。
- 语言切换和暗色模式。
- Markdown、代码高亮、数学公式。

## 6. 测试状态

后端测试按主题拆分：

- `test_health.py`
- `test_templates.py`
- `test_room_lifecycle.py`
- `test_engine.py`
- `test_scribe_facilitator.py`
- `test_verdict.py`
- `test_in_flight.py`
- `test_masquerade.py`
- `test_uploads.py`
- `test_visibility.py`
- `test_llm_adapter.py`
- `test_migrate_personas.py`
- `test_persona_instances_api.py`
- `test_room_export.py`
- `test_worlds.py` —— Story World CRUD
- `test_scenes.py` —— Scene 创建、enter / exit、seal
- `test_memory.py` —— 封幕 scribe 写入 episodic / impressions
- `test_memory_decay.py` —— `last_used_scene_index` 衰减 + episodic cap 折叠
- `test_relations.py` —— 关系卡片单向维护
- `test_world_state.py` —— World State 聚合、World Bible、Timeline Event

测试需要真实 LLM 凭据：

```text
backend/tests/.env.test
OPENAI_API_KEY=...
```

前端验证命令：

```powershell
cd frontend
pnpm build
```

当前已知的前端构建提示是 Vite 大 chunk warning，来自 Markdown/KaTeX/Shiki 相关 bundle，不是失败。

本次变更已额外做过：

- `backend/.venv/bin/python -m py_compile backend/app/*.py`
- FastAPI app import smoke
- 临时 SQLite smoke：创建房间、初始消息、执行 `mai_list_room_members`
- `npm --prefix frontend run build`

## 7. 打包状态

- `scripts/package.ps1`：普通 release 包。
- `scripts/build-sidecar.ps1`：PyInstaller sidecar。
- `scripts/package-tauri.ps1`：Tauri 安装包。
- `.github/workflows/release.yml`：tag release 自动发布。

桌面壳基线：

- Tauri v2。
- sidecar 监听临时 localhost 端口。
- 前端通过 `window.__MAI_API_BASE__` 请求 sidecar。
- SQLite、uploads、trace 在 packaged mode 下落到用户数据目录。

## 8. 当前不做

这些仍保持在边界外：

- 消息编辑 / 删除。
- 多用户同房间。
- 任意倒带和分支。
- 节点连线式赛制编辑器。
- 模板导入 UI。
- Trace 查询 / 重放 UI。
- 图片 / 多模态上传。
- 移动端专项适配。
- Streaming 续写。
- 超时自动重试。

## 9. 下一阶段建议

现在适合做的不是继续堆功能，而是稳定性与体验整理：

- 给 i18n 字典补齐少量边角页面和错误消息。
- 增加前端组件级测试，特别是 API 配置、模板复制和语言切换。
- 梳理大 chunk 体积，考虑 Markdown/代码高亮按需加载。
- 做一次完整桌面安装包 smoke test。
- 如果要公开分发，再补隐私说明和 API key 本地存储说明。
- 接入真实 MCP server 做端到端兼容性测试，优先覆盖 streamable_http。
- **Story World 关系图（TODO）**：基于 `world_character_relations`（A→B 单向卡片）+ 角色档案，做一个直观的关系网络视图。形态待定——可能是侧栏弹出的力导向图，也可能是 World 页内的一栏；要能按 sentiment 着色、按 label 过滤、点节点跳到角色档案。等用户对 PR 4 的关系卡片用熟之后再开工。
