# 多模型协作讨论平台 · 产品设计文档

> v1.0 · 全部决策对齐
> 配套技术文档：`technical_design.md`

---

## 1. 产品定位

让用户在一个统一的工作空间里，调度多家 LLM(Claude、GPT、Gemini 等)以"群聊辩论"的方式协作完成方案设计、评审与验证。区别于市面上的并排对比工具(ChatHub 类)和聚合调用工具(LibreChat 类)，核心差异在于**模型之间真正互相对话、按结构化赛制推进、产出可追溯的决议**。

类比：**AI 版的"Discord 房间 + Notion 决议 + 辩论赛流程"**。

## 2. 核心产品哲学

后续所有取舍以下面三条为判断标尺：

1. **用户掌控感 > 自动化魔法**
   所有 AI 自主行为(发言调度、子讨论触发、模式切换)都必须有对应的"用户接管"入口。
2. **模式优先于实例**
   人设、phase、赛制、房间配方都是可复用、可版本化、可分享的模板。沉淀价值在模板而非单次会话。
3. **先骨架后血肉，产品设计要克制**
   机制按真实使用反馈逐步增加，但**核心数据结构在 v1 就预留扩展位**，避免后期撕裂 schema。功能上能砍则砍——不做编辑、不做并发优化、不做框架抽象。

## 3. 核心概念与抽象

| 概念 | 角色 | 复用性 |
|------|------|--------|
| **Persona(人设)** | 一个 AI 角色的定义：backing model + system prompt + 风格参数 | 跨房间复用 |
| **Phase(阶段)** | 单一发言调度规则与行为约束的原子单元 | 跨赛制、跨房间复用 |
| **Debate Format(赛制)** | 一组 phase 的有序组合 + 默认转换关系 | 快捷方式，可拆分使用 |
| **Room(讨论室)** | 一次具体的讨论实例，承载消息历史与状态 | 一次性，但可保存为配方 |
| **Recipe(房间配方)** | Persona 集合 + 默认 phase 序列 + 初始设置的打包 | 一键开新房间 |
| **Scribe State(书记官状态)** | 房间内的结构化决议状态 | 房间内唯一 |
| **Facilitator(上帝副手)** | 对 AI 隐藏的元主持人，向用户提供建议信号 | 系统级，每房间一个实例 |

**关键解耦**：
- persona / phase / format 三个模板对象互相独立、可任意组合
- **phase 是原子单元，赛制只是 phase 的推荐组合**——用户随时可脱离赛制、自由组合 phase
- 房间运行中可切换赛制、可中途插入新 phase

## 4. 人设系统(Persona)

### 4.1 设计维度

人设不应只在"理性 / 发散"单一轴上，而是多个正交维度组合：

- **认知风格**：发散 / 收敛、抽象 / 具象、长程 / 短程
- **流程角色**：发起者、批评者、综合者、记录者、调度者
- **立场绑定**：自由派、devil's advocate、steelmanner、现状辩护者
- **领域专长**：UE5 渲染、ML pipeline、性能优化、安全审计 等
- **时间视角**：未来用户、遗产守护者、考古学家

### 4.2 关键原则

- **不同人设绑定不同 backing model**。Claude / GPT / Gemini 本身有认知性格差异，由人设放大而非压抑。用户在创建人设时显式选 backing model。
- **出厂自带 10–20 个精调人设**，用户可 fork 修改。
- **房间结束后允许打分微调**人设(这次太啰嗦 / 太顺从)，下次自动调整。**v1 不实现**。
- **飞轮策略**：产品跑起来后，让人设互相设计人设(self-extending)，探索 token 不限的玩法。**v1 不实现**。

### 4.3 人设的三种 kind

Persona 数据结构有三个特殊子类型：

| kind | 角色 | 是否在场 | 出现在 allowed_speakers | 输出去向 |
|------|------|---------|----------------------|----------|
| `discussant` | 普通讨论参与者 | 用户拉入/拉出 | ✅ | messages 表 |
| `scribe` | 书记官 | 永远在场 | ❌(独立 trigger) | ScribeState |
| `facilitator` | 上帝副手 | 永远在场 | ❌(独立 trigger) | facilitator_signals + meta message |

三者共享同一张 `personas` 表，但被引擎区别对待。详见第 6 节。

## 5. 用户角色与权限

### 5.1 设计动机

用户在这个系统里**到底是什么身份**？两种权限分别给出两种答案，且各自都成立。

### 5.2 裁决者(Judge / Arbiter)

**本质**：给用户一个超越讨论层级的"上帝视角"。

| 属性 | 行为 |
|------|------|
| 是否参与论证 | 否，只下判决，不需要论据支撑 |
| 直接写入 `decisions[]` | 是，AI 间共识只能进 `consensus[]`，进 `decisions[]` 必须裁决 |
| 强制中止某条线 | 是，直接写入 `dead_ends[]`，AI 不能再提 |
| 可撤销 | 是。撤销不修改原裁决，而是 append 一条新的"撤销裁决"消息 |
| Prompt 渲染 | 带 `[USER VERDICT]` 高优先级 tag |
| UI 视觉 | 必须明显区别于普通发言(颜色 / 边框 / 徽章)|

### 5.3 伪装人设(Masquerade)

**本质**：让用户作为一个"普通参辩者"进场，与 AI 角色平级。

#### 三层产品价值

1. **测试层**：验证某个 AI 角色是否真的会被反对意见说服
2. **引导层**：用户有想法但不想以"上帝口吻"宣布，把它当备选方案投放接受真实批评
3. **娱乐 / 探索层**：体验"以某个人设的口吻发言会怎样"

#### 渲染策略：按一般 AI 处理

伪装消息在 AI 视图里跟普通 AI 消息**完全无差异**：
- 同 role、同格式、无任何 marker
- system prompt 不提"可能有用户伪装"
- AI 可能反向推断身份，**作为"狼人杀"游戏特性接受**，不做对抗

差异**仅在用户复盘视图**：
- 默认不揭示
- 用户可主动揭示("刚才那条其实是我"——仅改用户复盘视图标记，不影响 AI context)
- 复盘视图永远显示伪装标记

伪装消息提交后行为：
- 立即 append，**无 streaming 效果**
- 跟 AI 发言一样触发 phase 状态检查、调度下一发言者
- 受同一套 max_tokens limit 约束(超过拒绝提交)

#### 计费

按字符数 × 固定费率计入 `room.token_counter`，等同于一次特殊的 API 调用。

#### 必须遵守的边界

- **同一 turn 只能是一个身份**——伪装中不能切换到裁决者
- **书记官不知情**——污染状态更新
- **上帝副手也不知情**——同等对待
- **一次只能附身一个人设**——不允许左右手互搏

### 5.4 v1 不做的功能

- **导演 / 编辑权限**——所有"重说一遍 / 删除消息 / 暂停角色"等操作 v1 不实现，schema 不预留
- **私聊频道**——`visibility` 字段保留(供伪装的"AI 视图"使用)，但用户私聊功能 v1 不做

## 6. 系统级角色

除了用户拉入的人设，房间里有两个系统级角色，它们职责严格分离：

| 角色 | 书记官(Scribe) | 上帝副手(Facilitator) |
|------|---------------|---------------------|
| Persona kind | `scribe` | `facilitator` |
| 职责 | 忠实记录、结构化提取 | 评估、建议、信号 |
| 触发频率 | 每 5 条消息 + phase 边界 | 每 5 条消息 + phase 边界 + 用户主动询问 |
| 输出形式 | ScribeState diff(via tool call) | 信号 tag 集合(via tool call) |
| 输出去向 | ScribeState 表(jsonb) | facilitator_signals 表 + meta message + SSE |
| AI 是否能看到 | 间接(via ScribeState onboarding) | 否，完全隐藏 |
| 看 context 范围 | 全部 + 当前 ScribeState | 最近 N 条 + 历史副手输出(去重) |
| 推荐 backing model | 中等(Sonnet 即可) | 强(Opus / GPT-5) |
| 推荐温度 | 0.2 | 0.3 |

**核心原则**：
- 书记官管"发生了什么"，上帝副手管"接下来该怎么办"
- 都不参与论证、都不做决策，最终决策权永远在用户
- **副手不能控制书记官**，两者保持独立

### 6.1 书记官详细设计

#### 触发策略
- 每 5 条消息(可调)
- Phase 切换边界强制触发一次
- 不做"上帝副手判断该总结"——保持独立

#### 输出形式：ScribeState diff

通过 tool calling 强制结构化，输出 diff 而非全量重写：

```
ScribeUpdate {
  consensus_added, consensus_removed
  disagreements_added, disagreements_resolved
  open_questions_added, open_questions_answered
  artifacts_added
  dead_ends_added
  reasoning: "本次更新简短解释,用于 trace"
}
```

引擎 apply diff 到当前 ScribeState 得到新版本。单房间不并发，无冲突处理。

#### Prompt 关键约束

1. **只记录已说出的内容**，不推测、不补全
2. **共识必须真的所有人都同意过**(被引用的 message id 要明确)
3. **不要给建议**(那是上帝副手的活)
4. **保守删除**——必须能引用消息证明被推翻才 remove，否则保留

第 4 条尤其重要。LLM 喜欢"整理"——会默默删掉它觉得"过时"的内容，必须 hard 约束。

### 6.2 上帝副手详细设计

#### 五项职责

| 职责 | 触发 | 输出 |
|------|------|------|
| 退出条件评估(语义) | 每条新消息(批量) | 当前 phase 该不该结束 |
| 失败模式检测 | 周期性 | 是否陷入打转、跑题、互相肯定 |
| 机会识别 | 周期性 | 是否该开子讨论、是否出现关键转折 |
| 健康度报告 | 用户主动询问 | 综合分析 |
| 预算/节奏告警 | token 接近 limit | 节奏建议 |

#### 输出形式：Tag 系统

通过 tool calling 输出预定义 tag 集合 + 详细信息：

```
FacilitatorEvaluation {
  signals: [
    {
      tag: 'phase_exhausted' | ...,
      severity: 'info' | 'suggest' | 'urgent',
      reasoning: "短句解释",
      evidence_message_ids: [...]
    }
  ],
  overall_health: 'productive' | 'circling' | 'diverging' | 'converging' | 'stuck',
  pacing_note: "..."
}
```

#### 预定义 Tag(v1)

| Tag | 含义 |
|-----|------|
| `phase_exhausted` | 当前 phase 目标已达成或开始空转 |
| `consensus_emerging` | 出现新的可能共识，建议确认 |
| `consensus_solidified` | 共识已稳固，可加入决议 |
| `disagreement_unproductive` | 分歧在原地循环，无新论据 |
| `going_off_topic` | 讨论偏离原始问题 |
| `consider_subroom` | 出现独立争议点，适合开子讨论 |
| `red_team_needed` | 当前方向缺反对声音 |
| `clarification_needed` | 出现术语或概念混淆 |
| `decision_pending` | 多个角色等待用户拍板 |
| `pacing_warning` | 单轮输出过长 / token 消耗过快 |

Phase 模板的语义退出条件就是匹配这些 tag(`facilitator_suggests` 类型 + `trigger_if: ["phase_exhausted"]`)。

#### 信号留痕

副手信号**作为 meta message 进 messages 表**(对 AI 隐藏，对用户可见)：
- `message_type = 'facilitator_signal'`
- `visibility_to_models = false`
- `visibility = 'observer_only'`

复盘时用户能看到时间线上的副手介入。

#### 防重复推送

两层机制：
1. **副手知道自己历史输出**：把"过去 N 次副手输出"喂给它，让它自己判断是否升级 severity
2. **引擎冷却**：同 tag 在 N 轮内不重复推送(`cooldown_per_tag_rounds`)

#### Prompt 关键约束

1. 你的发言**绝对不会被讨论参与者看到**
2. 你只对用户负责，要直接告诉用户当前讨论的健康度和建议
3. 你不参与论证，不能提出自己的方案
4. 看到风格突兀的发言时，按它的人设处理，不要试图推测身份

#### 配置

```
FacilitatorConfig {
  trigger_every_n_messages: 5(默认)
  enabled_signal_tags: list[str]
  cooldown_per_tag_rounds: 5
  context_window_messages: 50
  disabled: bool   # 整体禁用(轻量主持人模式)
}
```

## 7. 房间机制(Room)

### 7.1 房间生命周期

```
创建(选 recipe 或裸开) → 拉入人设 → 选择 phase 序列(或赛制) → 推进讨论
  → 用户冻结 / 自然结束 / hit limit → 归档 → 可作为父房间 fork 子讨论
```

### 7.2 房间隔离

- 每个房间的上下文严格隔离，**不串台**
- 房间间唯一的合法连接通道：**子讨论的 merge-back 包**(见第 10 节)

### 7.3 房间状态

房间状态包含：
- 消息历史(append-only，无修改无删除)
- 当前 phase 实例(引用 phase 模板 + 变量绑定 + 状态)
- 计划的 phase 序列(可来自赛制，也可用户自由组合)
- 当前在场人设列表
- 书记官状态(结构化)
- limit 计数器
- 冻结标志
- 当前用户身份模式(normal / judge / masquerade-as-X)
- 自动转换开关(auto_transition: bool)

### 7.4 节奏假设：人是速度瓶颈

**核心假设**：用户是讨论节奏的控制者。每次 AI 发言完成后，系统默认停下来等待用户下一步动作。该假设直接影响技术架构——单房间内任何时刻**至多一个 in-flight LLM call**。

## 8. Phase 与赛制(Debate Format)

### 8.1 视角：Phase 是原子，赛制是组合

**Phase 是核心运行单元**。整个系统只有一种东西在"跑"——当前 phase。赛制只是"一组 phase 的推荐组合 + 默认转换关系"，是快捷方式而非顶层对象。

### 8.2 Phase 的两类规则

每个 phase 同时定义两类规则，二者职责严格分离：

| 类别 | 调度规则 | 行为规则 |
|------|---------|---------|
| 控制对象 | 谁说话 | 说什么 / 怎么说 |
| 实现位置 | 引擎调度层 | LLM prompt 层 |
| 内容举例 | allowed_speakers、ordering_rule、exit_conditions | "答方不能反问"、"只陈述观点不打断" |

### 8.3 Phase 模板字段

```
PhaseTemplate {
  id, version
  name, description
  declared_variables[]    # 声明本模板需要的变量(如 $affirmative_speaker)
  
  # 调度规则(声明式)
  allowed_speakers       # all / variables / specific
  ordering_rule          # alternating / round_robin / mention_driven / question_paired / parallel / user_picks
  exit_conditions[]      # 多条条件,任一满足即触发结束
  
  # 行为规则
  role_constraints
  prompt_template
}
```

`exit_conditions[]` 同时支持结构化条件(N 轮已完成)和语义条件(由上帝副手评估)，**任一先满足都触发结束事件**。

### 8.4 Phase 不可嵌套、不可中途切换

为保持原子性：

- **不可嵌套**——phase 内不能临时插入子 phase 再回归。需要嵌套语义请使用子讨论室
- **不可中途切换 ordering**——phase 实例进入运行后规则字段视为 immutable

### 8.5 内置 phase 库(v1)

| Phase | 调度规则要点 |
|-------|------------|
| **立论(constructive)** | allowed=正反双方 / ordering=alternating / exit=各 N 轮 |
| **质询(cross-exam)** | ordering=question_paired / 提问方主导 |
| **自由辩论(free-debate)** | allowed=all / ordering=mention_driven / exit=用户手动或 N 轮 |
| **总结陈词(closing)** | allowed=指定双方 / ordering=反方先 / exit=各 1 轮 |
| **轮询(round-robin)** | allowed=all / ordering=round_robin |
| **作者答辩(author-defense)** | allowed=作者 / ordering=question_paired(评审先问) |
| **评审打分(review-scoring)** | allowed=指定评审 / ordering=parallel |
| **头脑风暴(brainstorm)** | allowed=all / ordering=parallel / role_constraints=禁止批评 |
| **诘问(socratic)** | allowed=指定主问者 / ordering=question_paired |
| **自由模式(open)** | allowed=all / ordering=mention_driven / exit=never |

### 8.6 内置赛制模板(v1)

赛制是 phase 的推荐组合：

| 赛制 | 适用场景 | Phase 序列 |
|------|---------|-----------|
| **正经辩论赛** | 二元决策 | 立论 → 质询 → 自由辩论 → 总结陈词 |
| **圆桌讨论** | 开放探索 | 轮询 |
| **方案评审** | 技术方案评审 | 立论(作者) → 质询(评审) → 作者答辩 → 评审打分 |
| **头脑风暴** | 早期发散 | 头脑风暴 → 轮询(归类) |
| **苏格拉底诘问** | 压力测试 | 诘问 |
| **自由模式** | 日常使用 | 自由模式 |

**用户随时可脱离赛制**：在房间中删除 / 替换 / 插入任何 phase，赛制不再约束。

### 8.7 Phase 切换 UI 与策略

#### 切换触发

phase 的 `exit_conditions[]` 中**任一条件**满足时(无论结构化还是语义)，触发 `phase.exit_suggested` 事件。

#### 决策横幅(默认手动模式)

```
[Phase X 进行中]
    │
    │ 任一 exit_condition 满足
    ▼
[显示决策横幅]
    ├─ "进入下一阶段(Phase X+1)"      ← 默认高亮
    ├─ "再来一回合"                    ← 把轮次类条件 +1,清提示
    ├─ "切换到指定 phase..."           ← 展开 phase 库选择
    └─ "继续(忽略提示)"                ← 用户认为还没到
```

#### 全自动模式

`auto_transition = true` 时跳过 UI 直接执行默认下一步。手动入口仍可用。

### 8.8 赛制切换的语义

| 操作 | 语义 |
|------|------|
| 切换到下一个 phase | 当前 phase 实例标记完成，按 plan 创建下一个。messages 全保留 |
| 跳到指定 phase | 跳过中间 phase，被跳过的 phase 不创建实例 |
| 中途插入新 phase | 在 plan 当前位置后插入。下一次切换时进入它 |
| 切换赛制 | 加载新赛制的 phase 序列覆盖剩余 plan(已完成 phase 实例保留)。从新赛制第一个 phase 开始 |
| 完全脱离赛制 | plan 不再绑定 format_id，由用户自由组合 |

切换是**单向操作**，需要回退请用 fork 子房间。

### 8.9 可视化编辑方案

#### v1 范式：顺序卡片列表 + 卡内表单

- 主区域是垂直堆叠的 phase 卡片，显示 phase 名 + 关键参数摘要
- 卡片可拖拽重排、可删除、可从左侧"phase 库"拖入
- 点开卡片展开 form：填 allowed_speakers、选 ordering_rule、配 exit_conditions、写 prompt_template
- 右侧 panel 是 phase 库，分"内置"和"我创建的"两类

#### 数据结构为图升级预留

```json
{
  "phase_sequence": [
    {
      "phase_template_id": "constructive",
      "transitions": [
        {"condition": "always", "target": "next"}
      ]
    }
  ]
}
```

`transitions` 数组在 v1 永远只有一个 `{condition: "always", target: "next"}`，UI 不暴露。

#### 自定义 phase 的可分享性

phase 模板本身是 JSON，可序列化、可导出导入、可一键 fork。跟 persona 模板的体验完全一致。

#### Tag 管理

模板对象(phase / persona / format / recipe)支持 `tags: list[str]` 字段，编辑器里按 tag 筛选。GIN 索引加速查询。

## 9. 书记官与状态管理(Scribe)

### 9.1 书记官产出的结构化状态

```
ScribeState {
  consensus[]:         所有角色明确同意的点
  disagreements[]:     每条记录正反双方各自的论据 + 谁持哪方
  open_questions[]:    尚未触及但被识别出的问题
  decisions[]:         用户拍板或一致同意的最终决议(由裁决者写入)
  artifacts[]:         讨论中产出的具体物件
  dead_ends[]:         试过但被否决的方向
}
```

### 9.2 入场 onboarding 协议

新角色入场时不直接读全部 transcript，而是按需选择：
- 先看共识 + 当前主要分歧
- 不同角色入场时拿到的 brief 可以不同
- 例：发散型角色不告诉他"前面已否过 C 方案"，让他可能重提 C 的变体

### 9.3 决议锁

`decisions[]` 项被锁定后，后续讨论不能在不解锁的前提下推翻。锁定 / 解锁权在裁决者手里。

## 10. 子讨论与合并(Sub-room)

### 10.1 触发场景

- 父讨论中出现某个具体争论 → 开子讨论室专门解决
- 子讨论室独立隔离，不污染父讨论上下文
- 嵌套语义(本来想嵌套 phase 的需求)由子讨论室承担

### 10.2 合并策略：结论 + 关键推理

子讨论结束时，子房间书记官**强制产出结构化合并包**：

```
MergeBack {
  conclusion:              单段话
  key_reasoning:           最多 3 条
  rejected_alternatives:   方向 + 一句话否决理由
  unresolved:              子讨论也没解决的问题
  artifacts_ref:           产出物的引用链接,不内联
  full_transcript_ref:     完整记录的链接,按需展开
}
```

### 10.3 关键原则

父讨论看到的是**可被引用的决议**而不是一坨上下文。后续若有人质疑结论，可"展开完整推理"按需拉取。

## 11. 用户控制机制

### 11.1 Limit(分层但简单)

- **单条消息 max_tokens** —— 防止单个角色话痨
- **单房间累计 token / 美元** —— 最重要的兜底
- **单 phase 最大轮次** —— 防止某阶段无限循环
- **全账户日 / 月 budget** —— 账单爆炸最后防线

每一层独立可设、独立报警、独立硬停。

### 11.2 一键冻结(Level 3)

要做到：

- 当前 in-flight 的流式响应被取消
- 所有后台 tasks(书记官、副手等)被取消
- 新发言被拒绝
- 当前状态被快照
- UI 进入只读模式
- 提供 unfreeze 与 fork

#### Partial 处理
- 已生成部分作为 truncated 消息保存到 messages 表
- 标记 `truncated_reason`(`frozen` / `limit_exceeded` / `user_skip`)
- Trace 完整记录 partial 内容
- **不支持续写**——unfreeze 后 truncated 消息永远停在那儿，下一轮重新调度

### 11.3 Streaming 中允许的操作

| 操作 | streaming 中 | 备注 |
|------|------------|------|
| 冻结 | ✅ | 取消 in-flight |
| 裁决 | ✅ | append 新 message |
| 修改 limit | ✅ | 立即生效 |
| @ 提及下一发言者 | ✅ 缓冲 | 等当前 stream 完成 |
| 伪装发言 | ❌ | 等当前 stream 完成 |
| 切换 phase | ❌ | 等当前 stream 完成 |
| 切换赛制 | ❌ | 等当前 stream 完成 |
| 拉新人设进场 | ❌ | 等当前 stream 完成 |

### 11.4 超时

- Chunk 间隔超过 30 秒视为挂死，自动 cancel
- 报错给用户，**不自动重试**

## 12. 文档与上传

### 12.1 v1 必做

- 用户可拖入 MD / TXT / PDF 文件作为附件 message
- 后端提取文本内容，作为 message 内容附在用户消息里
- AI 看到的是提取后的纯文本，不是原文件

### 12.2 v1 不做

- **图片上传 / 多模态**——后期特性
- **分享只读链接**——schema 也不预留

## 13. v1 范围 vs 后续迭代

### 13.1 v1 必做

- 房间创建 / 拉人设 / 跑 phase 序列(或赛制) / 看结构化结论
- 10 个内置 phase 模板
- 6 个内置赛制模板
- 10–20 个内置人设
- **裁决者权限**(写入 decisions / dead_ends，可撤销)
- **伪装人设权限**(双层信息架构，可选揭示)
- **上帝副手**(每 5 条消息触发，结构化建议信号)
- **书记官**(每 5 条消息触发，fold ScribeState)
- 分层 limit + 一键冻结(Level 3)
- 子讨论 + merge-back 结构化合并
- 严格 append-only 消息历史 + 模板版本化
- 可视化编辑器(顺序卡片列表)——支持自定义 phase / 赛制 / 人设
- 文档上传(MD / TXT / PDF)
- 暗色模式 toggle
- 模板 tag 管理
- Markdown 富格式 + LaTeX 数学公式渲染

### 13.2 v1 不做(产品设计要克制)

- **消息编辑 / 删除**——append-only
- **倒带与分支**——子房间是唯一的"分支"
- **导演 / 编辑权限**——连 schema 都不预留
- **Phase 嵌套与中途规则修改**——保持原子性
- **赛制切回**——单向，需要回退请 fork
- **节点连线编辑器**——v1 顺序卡片，schema 为图预留
- **自荐意愿值发言机制**
- **角色互相设计角色**(self-extending personas)
- **人设打分微调**
- **时间冻结的 red team 召唤**
- **观察席**(只读角色 + 事后备忘录)
- **多用户 / 高并发**
- **trace 分析 / 重放 UI**(写入要做，分析延后)
- **图片 / 多模态上传**
- **分享只读链接**
- **移动端适配**
- **Streaming 续写**
- **超时自动重试**
- **模板导入功能**(v1 只做导出)
- **Draft 模板状态**(字段加，功能不做)
- **Runtime tag**(模板 tag 做，运行时 tag 不做)

## 14. v1 验收标准

用户能完成这个完整流程，即视为 v1 达成：

> 用户开一个房间 → 选"方案评审"赛制(自动加载 4 个 phase) → 拉入 4 个人设(架构师 / 性能批评者 / 维护者 / 书记官) → 拖入方案文档(MD / PDF) → 跑完 4 个 phase → 中途用裁决者权限锁定一项决议 → 中途以伪装人设身份投放一个备选方案接受批评 → 上帝副手在某轮提示"讨论原地打转"，用户接受建议切换到指定 phase → 某个争论开子讨论 → 子讨论结论合并回父房间 → 拿到最终结构化结论 → 全程不超预算 → 必要时一键冻结。

附加场景验收：

> 用户在编辑器中自定义一个新 phase("快速投票"，allowed=all，ordering=parallel，exit=all_voted)，加几个 tag → 保存(直接 published) → 在某个房间中临时插入这个 phase 到当前 phase 序列里 → 运行成功 → 导出该 phase 模板为 JSON 文件。
