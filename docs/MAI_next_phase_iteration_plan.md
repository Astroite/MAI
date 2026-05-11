# MAI 下一阶段产品与工程迭代计划

> 建议文件位置：`docs/roadmap/mai_next_phase_iteration_plan.md`  
> 面向对象：产品负责人、前端/后端开发 Agent、重构 Agent、官网 Agent  
> 当前结论：MAI 下一阶段应以 **Story World / 故事世界** 作为主发展方向，同时保留并稳定 **Discussion Room / 讨论室** 作为结构化多 AI 讨论能力。工程上不建议彻底拆成两套架构，而应演进为 **共享 Conversation Runtime + 独立 Story Domain + 独立 Discussion Domain**。

---

## 1. 背景

MAI 已经从“本地优先的多模型协作讨论平台”逐步演进为一个更偏创作向的 AI 角色群演与故事世界推演工具。

当前产品中同时存在两条主线：

1. **Story World / 故事世界**
   - 创建世界。
   - 创建 AI / 用户角色。
   - 开启线性 Scene。
   - 用户以旁白或扮演模式介入。
   - 多 AI 角色在同一场景中持续互动。
   - 场景封幕后写入角色记忆、印象、承诺和关系变化。
   - 下一幕继承过去的世界状态和角色记忆。

2. **Discussion Room / 讨论室**
   - 多 AI 人设围绕问题进行结构化讨论。
   - 通过阶段、赛制、配方组织发言。
   - 由书记官沉淀共识、分歧、开放问题和决议。
   - 由主持信号提示节奏、偏题、风险和是否需要子讨论。
   - 用户拥有裁决、冻结、推进阶段和配置模型的最终控制权。

在产品定位上，Story World 已经成为主要发展方向；Discussion Room 仍然是底层能力的重要来源，也是面向产品决策、技术评审、头脑风暴等场景的独立价值模块。

---

## 2. 下一阶段核心目标

### 2.1 产品目标

下一阶段产品目标不是继续横向堆功能，而是把 MAI 的产品心智从“多 AI 讨论工具”升级为：

> 一个本地优先的 AI 故事导演台，同时保留结构化多 AI 讨论能力。

用户打开 MAI 后，应首先感知到：

- 我有哪些世界。
- 哪一幕可以继续。
- 哪些角色正在场景中等待。
- 哪些角色记住了过去的事件。
- 我可以作为导演旁白，也可以亲自扮演某个角色。
- 如果需要严肃推理，也可以进入讨论室组织多 AI 圆桌。

### 2.2 工程目标

下一阶段工程目标是从当前的“功能可用”进入“可持续迭代”：

1. 收敛 Story World 与 Room 的边界。
2. 修复已知运行时竞态和状态多源问题。
3. 把散落的胶水代码、兼容补丁和路由层 prompt 逻辑逐步归位。
4. 保持 append-only、冻结、封幕记忆、autodrive 等关键不变量不被破坏。
5. 把视觉和 i18n 规范落到 Story World 主线页面。
6. 为后续官网、开源分发和大陆用户访问提供稳定支撑。

---

## 3. 总体架构原则

### 3.1 不做完全分离

不建议把 Story World 和 Discussion Room 完全拆成两套独立架构。

原因：

- 两者共享大量底层能力：
  - Message log
  - Persona Instance
  - Model Runtime
  - Streaming
  - Freeze / Resume
  - Autodrive
  - Tool Invocation
  - Runtime State
  - API Provider / API Model
- 完全拆分会导致同类 bug 修两遍。
- 流式状态、模型选择、工具调用、冻结逻辑等基础能力会出现体验漂移。
- 当前 Scene 仍然可以被视为带有 `world_id + scene_index` 的 Room，短期强拆数据库风险过高。

### 3.2 要做领域分离

不完全拆底层，但必须分清领域边界。

推荐目标架构：

```text
MAI
├── Conversation Runtime 共享运行时
│   ├── Message Log
│   ├── Persona Runtime
│   ├── Model Runtime
│   ├── Streaming
│   ├── Freeze / Resume
│   ├── Autodrive Lock
│   ├── Tool Invocation
│   └── Runtime State
│
├── Story Domain 故事世界领域
│   ├── World
│   ├── Scene
│   ├── World Character
│   ├── Scene Member Roster
│   ├── Narration / Roleplay Composer
│   ├── Character Memory
│   ├── Character Relation
│   ├── Scene Seal
│   └── Scene-end Inspector
│
└── Discussion Domain 讨论室领域
    ├── Phase Plan
    ├── Debate Format
    ├── Recipe
    ├── Discussion Scribe
    ├── Facilitator
    ├── Decision / Verdict
    ├── Dead End
    └── Subroom
```

### 3.3 产品入口分离，运行时共享

产品 UI 上应清晰区分：

```text
首页 / 工作台
├── 故事世界
│   ├── World 列表
│   ├── World Detail
│   ├── Scene
│   ├── 角色记忆
│   └── 封幕检查器
│
└── 讨论室
    ├── 普通讨论
    ├── 技术评审
    ├── 产品圆桌
    ├── 假设压力测试
    └── 方案复盘
```

但底层仍共享：

```text
/conversations/{id}/messages
/conversations/{id}/freeze
/conversations/{id}/resume
/conversations/{id}/autodrive
/conversations/{id}/tools
```

---

## 4. 产品迭代方向

## 4.1 Story World 成为主线

Story World 是下一阶段的主叙事。

核心体验应围绕：

- 创建世界。
- 创建角色。
- 开启一幕 Scene。
- 用户作为导演旁白推进场景。
- 用户以某个角色身份加入对话。
- AI 角色只扮演自己，不替其他角色发言。
- 每幕封幕后整理角色记忆。
- 下一幕继承前情和角色关系变化。

### 4.1.1 首页与工作台

首页已经完成重构，下一阶段继续围绕“AI 故事导演台”打磨：

- 最近世界。
- 当前场景。
- 快速开始。
- 角色近况。
- 当前世界摘要。
- 今日建议。
- 封幕后记忆入口。
- 讨论室入口弱化但保留。

设计上继续保持：

- 清新、简洁。
- mint teal / clear-water blue。
- 冷白背景。
- 少量 coral 表示警示。
- 三栏工作台布局。
- 轻卡片、轻阴影、1px 分割线、状态 chip。

### 4.1.2 World Detail

World Detail 是 Story World 的核心运营页，应逐步增强：

- 世界 synopsis / setting / calendar hint。
- 角色列表。
- 角色关系。
- 角色记忆。
- Scene 时间线。
- 最近封幕摘要。
- 创建下一幕入口。
- 当前正在进行的 Scene 快速继续。

### 4.1.3 Scene 体验

Scene 不只是 Room 的换皮，应突出“演出感”：

- 顶部显示世界、幕次、场景标题。
- 明确当前在场角色。
- Composer 明确区分：
  - 旁白：用户作为导演描述场景 / 动作。
  - 扮演：用户以用户角色身份发言。
- AI 发言强调角色身份和在场感。
- 支持角色沉默、观察、行动和短句回应。
- 保持角色一致性，不出现全知叙述者。

### 4.1.4 Scene Seal / 封幕

封幕是 Story World 的关键闭环。

必须保持：

- 由用户显式触发。
- 不自动封幕。
- 封幕后写入角色记忆。
- 封幕不可逆。
- 弹出 Scene-end Inspector 供用户检查和必要时重跑。

下一阶段可以增强：

- 封幕前风险提示。
- 封幕后记忆差异预览。
- 每个角色记忆的来源片段引用。
- 失败后可重试且保持幂等。

### 4.1.5 Character Memory

角色记忆是 Story World 的长期价值资产。

下一阶段不急于做 embedding retrieval，可以先做到：

- 记忆 UI 更清晰。
- 区分 core identity、relationship、episodic memory。
- 展示最近更新来源。
- 封幕后新增 / 变化记忆突出显示。
- 防止重要 backstory 被 hard drop。
- 明确 memory cap 的 v1 策略。

---

## 4.2 Discussion Room 保留为结构化讨论能力

Discussion Room 不再是首页主叙事，但仍然是 MAI 的重要能力。

下一阶段定位：

> 当用户需要严肃推理、方案评审、产品决策、假设压力测试时，进入讨论室。

继续保留：

- Persona Template / Instance。
- Phase Template。
- Debate Format。
- Recipe。
- Scribe State。
- Facilitator Signal。
- Decision / Verdict。
- Dead End。
- Subroom。
- Tool / MCP。
- 文档上传。

讨论室不应该被 Story World 逻辑污染：

- 不引入 Scene Seal。
- 不引入 Character Memory。
- 不引入旁白 / 扮演 Composer。
- 不使用故事角色关系作为讨论上下文。

---

## 4.3 官网与开源分发

官网作为并行工作推进，但不要阻塞 MAI 本体迭代。

官网目标：

- 独立 Git 仓库。
- Astro 或同类现代静态方案。
- 部署到腾讯云 EdgeOne Pages。
- 覆盖 Story World 与 Discussion Room 两条产品线。
- 保持 MAI 主 UI 风格。
- 自动同步 GitHub Release。
- 为大陆用户提供稳定下载镜像。

官网内容优先级：

1. Hero：AI 故事导演台。
2. Story World：世界、角色、场景、记忆。
3. Discussion Room：多 AI 圆桌、阶段、书记官、主持。
4. 本地优先与开源。
5. 下载与版本更新。
6. 使用场景。
7. 路线图。

---

## 5. 工程迭代方向

## 5.1 运行时稳定性优先

第一阶段优先解决真实运行风险，而不是先做大重构。

### 5.1.1 Freeze / In-flight Race

当前风险：

- `freeze_room` 只 cancel active task，不 await。
- 流式任务可能仍在写 SQLite。
- 之后的冻结写入可能撞上 SQLite lock。
- `delete_room` 已有 await 模式，应抽为公共 helper。

目标：

```text
drain_active_calls(room_id, reason)
```

要求：

- `freeze_room` 使用它。
- `delete_room` 使用它。
- 保持 partial / truncated message 语义。
- 不改变 Message append-only 模型。

### 5.1.2 Autodrive Lock 清理

当前风险：

- `_AUTODRIVE_LOCKS` 是模块级 dict。
- Room 删除或 Scene 封幕后可能残留 lock。
- 单进程可接受，但需要主动清理。

目标：

- 删除 Room 时清理 `_AUTODRIVE_LOCKS[room_id]`。
- Scene 封幕后如果不再允许继续发言，也清理 lock。
- 横向扩容暂时不作为目标，但需要写入技术文档。

### 5.1.3 Autodrive skipped reason

当前问题：

- 用户点击“让 AI 继续”时，如果返回 skipped，没有理由。
- UI 无法判断是 locked、frozen、no speaker 还是 phase exit。

目标：

```text
schedule_autodrive(...) -> { status: "scheduled" | "skipped", reason?: string }
```

推荐 reason：

```text
locked
frozen
in_flight
no_available_speaker
phase_not_auto
exit_condition_met
token_budget_exceeded
```

---

## 5.2 低风险清理

第二阶段做低风险代码质量清理。

范围：

- `store.ts` 死表达式。
- locale 不一致的中文引号。
- LanguageToggle 文案走 i18n。
- PALETTE 三处合并。
- `personaTone` 抽 utils。
- `personaModelLabel` / `apiModelOptionLabel` 抽 utils。
- `previewValue` 抽 utils。
- `_setup_complete(row)` helper。
- React Query key 工厂。

原则：

- 不碰 engine 核心链路。
- 不碰 migration。
- 不碰 seed。
- 不碰 Story World 记忆语义。
- 不顺手做大视觉重构。

---

## 5.3 Story World i18n 与轻量边界收敛

第三阶段围绕 Story World 主线补齐用户体验。

### 5.3.1 i18n 补齐

处理文件：

- `WorldListPage.tsx`
- `WorldDetailPage.tsx`
- `SceneInspectorDialog.tsx`
- `PersonaTemplatePicker.tsx`
- `Composer.tsx` 故事模式分支
- `RoomShell.tsx` 故事头部

要求：

- 所有用户可见文案走 i18n。
- zh-CN / en-US 同步新增。
- 不改业务逻辑。
- 不改变 React Query / API 结构。

### 5.3.2 isScene 单一派生

前端：

```ts
const isScene = !!state?.room.world_id
```

后端：

```py
def is_scene_room(room: Room) -> bool:
    return room.world_id is not None
```

目标：

- 替换散落判断。
- 不改变分支行为。
- 为后续 Story Domain / Discussion Domain 做铺垫。

---

## 5.4 文档化兼容层

第四阶段先文档化，不急着删除 load-bearing workaround。

需要新增：

### 5.4.1 `docs/schema_history.md`

记录：

- 每个 `migrate_*.py` 的目的。
- 影响表。
- 是否仍需要。
- 可删除条件。
- 当前版本是否仍依赖。

### 5.4.2 `docs/known_provider_quirks.md`

记录：

- LiteLLM / provider tool_choice 兼容问题。
- 为什么需要三层 tool_choice fallback。
- 为什么需要 `_parse_tool_arguments` / `_unstring_nested`。
- 哪些 provider / relay 曾返回双重 JSON 字符串。

### 5.4.3 `docs/append_only_boundaries.md`

明确：

- Message / Decision / ToolInvocation 是 append-only。
- RuntimeState / ScribeState / FacilitatorSignal 是当前状态镜像。
- Character Memory 是封幕后写入的长期角色状态。
- Provider / Model 删除导致的 persona 字段清理属于配置层副作用，需要 trace 或 snapshot。

---

## 5.5 Tauri 可诊断性

第五阶段解决 release 版本后端崩溃静默问题。

目标：

- sidecar stdout / stderr 写入本地日志文件。
- `CommandEvent::Terminated` 给用户可见提示。
- 设置页或菜单提供“打开日志目录”。
- release 构建也可定位 backend 启动失败。

建议路径：

```text
%APPDATA%/MAI/logs/backend.log
%APPDATA%/MAI/logs/frontend.log
```

验收：

- 后端启动失败时用户有提示。
- 日志文件可打开。
- 不影响正常启动。
- 不引入大型依赖。

---

## 5.6 ApiModel 双轨字段收敛

这是高风险任务，应放在测试补齐之后。

当前问题：

- `api_model_id` 是新字段。
- `backing_model + api_provider_id` 是 legacy 字段。
- 后端、前端、engine、llm、schemas 多处仍三字段并存。
- 删除 ApiModel / Provider 时存在配置字段联动清理。

分阶段执行。

### 5.6.1 补测试

必须覆盖：

1. 创建 provider。
2. 创建 ApiModel。
3. 设置默认模型。
4. Persona Template 绑定 ApiModel。
5. Persona Instance 继承模板模型。
6. 房间成员 override 模型。
7. 删除 ApiModel。
8. 删除 Provider。
9. 旧数据通过 legacy 字段迁移。
10. LLM 实际调用模型正确。

### 5.6.2 写入路径单一化

目标：

- 新写入只写 `api_model_id`。
- legacy 字段只作为兼容读取。
- 删除 Provider / Model 时留 trace snapshot。
- 前端类型把 legacy 字段标记为 optional / deprecated。

### 5.6.3 暂不 drop column

不建议本阶段删除 legacy 列。

删除列前置条件：

- schema_history 完成。
- 旧 DB 升级测试通过。
- Release 用户迁移路径明确。
- 至少一个版本周期内无 legacy 写入。

---

## 5.7 Streaming 状态单一真值

当前问题：

- Zustand streaming。
- `/state.in_flight_partial`。
- React Query messages cache。

三者在流式期间都可能成为文本来源。

推荐方向：

```text
流式期间：Zustand 是唯一实时真值。
完成后：React Query messages cache 是最终真值。
/state.in_flight_partial：只用于首次进入房间或重连恢复。
```

验收：

1. 正在生成时刷新页面，可恢复 partial。
2. 切换房间再回来，文本不重复。
3. 生成完成后没有 ghost streaming text。
4. freeze 后 partial 正确保存为 truncated message。
5. 多 AI parallel 阶段不会串流。

---

## 5.8 Prompt 模块下沉

当前问题：

- 路由层拼装 scene prompt。
- LLM adapter 知道过多业务概念。
- Story prompt、persona draft prompt、memory formatting 分散。

建议新增：

```text
backend/app/prompts.py
```

先收纳：

```text
compose_scene_persona_prompt
compose_persona_draft_prompt
format_character_memory
format_character_relation
format_scene_context
format_peer_roster
```

原则：

- 路由层只做输入校验和对象装配。
- Engine 负责运行时策略。
- LLM adapter 最终只接收 messages / tools / model config。
- 不一次性重写全部 prompt，先移动 Story World 相关部分。

---

## 5.9 TemplatesPage 拆分

当前问题：

- `TemplatesPage.tsx` 巨型单文件。
- 聚合 personas / phases / formats / recipes / providers / models。
- 表单逻辑、模型选择、测试逻辑混在一起。
- 后续维护成本高。

建议拆分：

```text
frontend/src/pages/templates/
  TemplatesLayout.tsx
  PersonasTab.tsx
  PhasesTab.tsx
  FormatsTab.tsx
  RecipesTab.tsx
  ProvidersTab.tsx
  ModelsTab.tsx
  shared/
    TemplateCard.tsx
    TemplateEditorShell.tsx
    ModelSelector.tsx
    PersonaForm.tsx
```

原则：

- 只做结构拆分。
- 不改 API。
- 不改表单语义。
- 不改内置只读 / 用户实例可编辑规则。
- 不顺手做视觉重构。

---

## 6. 推荐 PR 拆分

### PR 1：运行时竞态修复

范围：

- `drain_active_calls(room_id, reason)`
- `freeze_room` / `delete_room` 统一 active call drain。
- `_AUTODRIVE_LOCKS` 清理。
- `/autodrive/resume` skipped reason。

不做：

- Story World 架构重构。
- ApiModel 字段收敛。
- TemplatesPage 拆分。

验收：

- AI 流式生成时 Freeze，不出现 database locked。
- partial message 正确保留。
- 解冻后可继续。
- 删除有 in-flight call 的房间，无 ACTIVE_CALLS / lock 残留。
- resume skipped 返回 reason。

---

### PR 2：低风险清理

范围：

- 死表达式。
- i18n 小修。
- PALETTE 合并。
- 重复 helper 抽 utils。
- React Query key 工厂。
- `_setup_complete` helper。

验收：

- `pytest -q`
- `pnpm test`
- `pnpm build`
- 手动检查首页、RoomShell、WorldDetail、TemplatesPage。

---

### PR 3：Story World i18n 与轻量边界

范围：

- Story World 页面 i18n。
- `Composer` 故事模式文案。
- `SceneInspectorDialog` 文案。
- `RoomShell` 单一 `isScene`。
- 后端 `is_scene_room(room)`。

验收：

- zh-CN / en-US 可切换。
- Story World 流程正常。
- Discussion Room 不受影响。

---

### PR 4：兼容层文档化

范围：

- `schema_history.md`
- `known_provider_quirks.md`
- `append_only_boundaries.md`

验收：

- 文档明确哪些 workaround 是 load-bearing。
- 文档明确哪些迁移不可删除。
- 文档明确 append-only 边界。

---

### PR 5：Tauri 日志与错误提示

范围：

- sidecar stdout / stderr 落盘。
- backend terminated 可见提示。
- 打开日志目录入口。

验收：

- Release 构建下 backend 崩溃可定位。
- 用户能找到日志。

---

### PR 6：ApiModel 双轨字段第一阶段

范围：

- 补测试。
- 新写入路径单一化。
- legacy 只读兼容。
- 前端类型标记 legacy optional / deprecated。
- 不 drop column。

验收：

- 模型选择链路不回归。
- Provider / Model 删除逻辑可追踪。
- 旧数据仍能升级。

---

### PR 7：Streaming 状态单一真值

范围：

- Zustand 作为流式期间唯一实时真值。
- `/state.in_flight_partial` 仅用于恢复。
- message appended 后由 RQ cache 接管。

验收：

- 刷新恢复 partial。
- 不重复显示。
- freeze 后 partial 正确截断。
- parallel 阶段正常。

---

### PR 8：Prompt 模块下沉

范围：

- 新增 `backend/app/prompts.py`。
- 下沉 scene prompt。
- 下沉 memory / relation formatting。
- 路由层只调用，不拼长 prompt。

验收：

- Story Scene prompt 内容一致。
- 封幕记忆不回归。
- 普通 Discussion prompt 不受影响。

---

### PR 9：TemplatesPage 拆分

范围：

- 按 tab 拆分组件。
- 抽公共表单与模型选择组件。
- 不改行为。

验收：

- 人设、阶段、赛制、配方、Provider、Model 功能一致。
- 内置只读规则一致。
- 用户实例编辑一致。

---

## 7. Agent 执行约束

所有 Agent 执行任务必须遵守：

1. 一次只做一个 PR 范围。
2. 不跨阶段顺手清理。
3. 不删除迁移脚本。
4. 不直接 drop legacy 数据列。
5. 不改变 Story World 封幕语义。
6. 不改变 append-only 消息语义。
7. 不引入大型 UI 框架。
8. 不破坏 React Query / API / i18n 结构。
9. 不把 UI 修复和数据写入逻辑混在一起。
10. 任何高风险问题先补测试，再改代码。

---

## 8. 非目标

下一阶段暂不做：

- 多用户协作。
- 任意分支时间线。
- 倒带 / 重演 / 多版本 canon。
- 图片 / 多模态上传。
- 移动端专项适配。
- 完全拆分 Story Scene 与 Room 数据表。
- embedding-based memory retrieval。
- LLM 自动总结低优先级记忆替代 hard drop。
- 横向扩容 / 多进程分布式 autodrive。
- 删除历史 migration。
- 删除 LiteLLM provider workaround。

---

## 9. 下一阶段里程碑

### Milestone A：运行时稳定

完成：

- PR 1
- PR 2

结果：

- Freeze / Delete / Autodrive 更稳定。
- 低风险重复代码减少。
- 日常开发体验改善。

### Milestone B：Story World 主线打磨

完成：

- PR 3
- PR 4

结果：

- Story World 页面文案和 UI 规范一致。
- Story / Discussion 边界更清楚。
- 兼容层和 append-only 边界有文档依据。

### Milestone C：分发可诊断

完成：

- PR 5
- 官网 MVP

结果：

- 桌面版出问题可定位。
- 官网能宣传 Story World 和 Discussion Room。
- 大陆用户可稳定下载。

### Milestone D：核心数据流收敛

完成：

- PR 6
- PR 7

结果：

- ApiModel 字段收敛开始。
- Streaming 多源真值问题解决。
- 后续模型配置和流式体验更可靠。

### Milestone E：架构持续整理

完成：

- PR 8
- PR 9

结果：

- Prompt 逻辑从路由层剥离。
- TemplatesPage 维护成本降低。
- 后续引入 Story Domain / Discussion Domain 更顺滑。

---

## 10. 最终方向总结

MAI 下一阶段的方向可以总结为：

```text
产品上：
Story World 是主线，Discussion Room 是保留的结构化多 AI 讨论能力。

架构上：
不完全拆成两套系统，而是形成共享 Conversation Runtime + Story Domain + Discussion Domain。

工程上：
先修稳定性，再补 Story World 体验，再文档化兼容层，然后处理 ApiModel、Streaming、Prompt、Templates 等高收益重构。

节奏上：
小 PR、强验收、先测试、后收敛，不做一次性大爆炸重构。
```

最终目标是让 MAI 从一个功能快速演进的实验型工具，进入一个可以长期维护、面向开源用户和创作者持续扩展的产品阶段。
