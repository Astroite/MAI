# 项目进度与状态快照

> 最近更新：2026-05-08
> 基线文档：`product_design.md` / `technical_design.md`

## 1. 总览

MAI 当前已从原型期进入稳定打磨期。核心闭环已经可用：

- 创建房间。
- 选择配方、赛制和人设。
- 配置 API 供应商与模型。
- 多 persona 按 phase 规则发言。
- 书记官折叠状态。
- 主持信号提示节奏。
- 裁决、撤销、死路标记。
- 文档上传。
- 子讨论与合并。
- 一键冻结和恢复。
- 模板编辑与内置模板复制。
- 工具与 MCP server 注册、同步、调用审计。
- 场景化开房和初始问题预填。
- 人设模板 AI 起草。
- 中英文界面切换。
- Tauri 桌面壳打包。

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

- `ApiProvider`：供应商、LiteLLM provider、key、base、测试状态。
- `ApiModel`：挂在 provider 下的具体模型，含显示名、模型名、默认标记、启用状态、context window、tags。
- `AppSettings.default_api_model_id`：全局默认模型。
- persona template / instance 可绑定 `api_model_id`。

旧字段 `backing_model` 和 `api_provider_id` 仍保留为兼容镜像。`migrate_api_models.py` 会把旧数据补成 `api_models`。

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

### 3.4 AgentVerse 启发的能力层

本轮新增了 5 个方向：

- MCP / 工具注册层：`tool_servers`、`tool_invocations`、`/tools` API 和房间工具面板。
- 成员能力控制：房间内人设可独立配置自动回复、工具调用和写入工具权限。
- 工具调用可视化：`tool_invocation` 消息进入消息流，并在右侧工具面板显示最近调用。
- 场景化开房：首页场景卡片预填标题、初始问题、赛制或配方。
- 模板起草助手：人设编辑器可用自然语言填入可编辑草稿。

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
- `message.cancelled` 清理 streaming 状态。
- 断线重连通过 `in_flight_partial` 恢复。
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
