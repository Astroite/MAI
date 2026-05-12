# MAI P0：World State System 实施任务书

## 0. 给执行 Agent 的说明

你将负责推进 MAI 下一阶段 P0 级产品能力：**World State System / 世界状态系统**。

本任务的目标不是新增一个孤立页面，也不是简单增加若干字段，而是把 Story World 从“可创建、可聊天”的功能，升级为“可持续推进、可回看、可沉淀、可继续”的故事世界体验。

你需要在现有 MAI 工程中完成：

1. World Detail / 世界状态页重构。
2. 世界背景与时间轴系统。
3. 角色记忆可视化与关系网。
4. 两阶段封幕流程与 Scene-end Inspector。

最终效果是：用户进入某个 Story World 后，能够清楚看到这个世界的历史、当前时间点、主线状态、已发生事件、角色记忆、角色关系，以及下一幕可以如何继续。

---

## 1. 产品背景

MAI 当前已经具备 Story World 的基础能力：世界、角色、场景、AI 角色演出、封幕、记忆沉淀等。但目前存在几个产品层面的短板：

1. **世界观设定较薄弱**
   用户创建了世界，但世界本身的历史、规则、背景、阵营、地点和主线状态没有形成强感知。

2. **Story World 的线性推进优势没有可视化**
   MAI 的故事世界天然按 Scene / 幕线性推进，但用户缺少一个清晰时间轴来理解“过去发生了什么、现在处在哪、接下来应该去哪”。

3. **角色记忆存在，但用户缺少信任感**
   角色记住了什么、关系如何变化、记忆来自哪一幕，目前不够直观。

4. **封幕需要更可靠**
   封幕是 Story World 的核心仪式，但如果 LLM 失败或生成质量不佳，不能让用户丢失体验，也不能直接污染长期世界状态。

因此，P0 的核心不是做更多 AI 能力，而是建立一个完整的世界状态闭环。

---

## 2. P0 总目标

实现一个统一的 **World State System**，让 Story World 形成以下闭环：

```text
创建世界
→ 补齐世界背景
→ 开启一幕 Scene
→ 用户和 AI 角色共同演出
→ 生成封幕草稿
→ 用户检查 / 编辑 / 重试
→ 确认写入世界状态
→ 更新时间轴、角色记忆、关系网、主线状态
→ 回到 World Detail
→ 从当前状态继续下一幕
```

用户最终应该明确感受到：

> 我不是在和 AI 随机聊天，而是在推进一个有历史、有角色、有关系、有记忆、有主线状态的世界。

---

## 3. 非目标 / 明确不做

本阶段不要偏离 P0 范围。以下内容不属于本任务：

1. 不重构 Discussion Room。
2. 不把 Discussion Room 和 Story World 强行合并。
3. 不引入复杂分支剧情系统。
4. 不引入多世界平行宇宙系统。
5. 不做完整 Galgame / RPG 任务系统。
6. 不做复杂地图编辑器。
7. 不引入大型知识库 / 向量数据库，除非当前工程已有成熟基础。
8. 不让 LLM 自动把未经用户确认的内容写入长期世界状态。
9. 不破坏现有 Scene 创建、角色演出、聊天、封幕等基础流程。
10. 不直接删除旧数据结构，除非有明确迁移方案和兼容层。

---

## 4. 核心原则

### 4.1 Story World 是主产品心智

Story World 的核心体验是：

- 世界持续存在。
- Scene 线性推进。
- 角色只扮演自己。
- 记忆跨场景沉淀。
- 封幕是状态提交点。
- World Detail 是继续创作的主控台。

### 4.2 World Detail 不是配置页，而是世界主控台

World Detail 应该帮助用户理解：

- 这个世界是什么。
- 过去发生了什么。
- 当前主线推进到哪里。
- 哪些角色处于什么状态。
- 哪些关系发生变化。
- 下一幕可以从哪里开始。

### 4.3 时间轴是 Story World 的天然主结构

MAI 的故事世界是线性推进的，因此时间轴应成为 World Detail 的核心视觉结构。

时间轴不仅展示已发生 Scene，也展示：

- 世界历史背景。
- 当前故事时间点。
- 主线 Arc 状态。
- 伏笔和未解决问题。
- 关系变化节点。
- 封幕沉淀节点。

### 4.4 封幕必须两阶段提交

封幕不应“一键生成并立刻写入长期状态”。

必须拆成：

```text
Seal Draft 生成
→ Scene-end Inspector 检查
→ 用户确认 Commit
→ 写入 World State
```

这样才能支持重试、编辑、局部再生成，并避免 LLM 报错或幻觉污染世界状态。

### 4.5 用户确认优先于 AI 自动扩写

AI 可以建议世界背景、事件、记忆、关系变化，但进入正式状态前必须明确区分：

- 已确认内容。
- AI 建议内容。
- 临时草稿内容。
- 低置信度内容。

---

## 5. 术语定义

### World

一个 Story World 的根容器。包含世界背景、角色、Scene、时间轴、记忆、关系、当前主线状态等。

### World Detail

某个世界的主页面。不是设置页，而是世界状态主控台。

### World Bible

世界设定集。包含背景、历史、地点、势力、规则、风格、禁忌、当前主线等。

### Timeline

世界时间轴。包含历史背景事件、已演出 Scene 事件、关系变化、伏笔、主线状态节点等。

### Scene

故事世界中的一幕。用户和 AI 角色共同参与演出。Scene 按世界线性推进。

### Seal

封幕。对一幕 Scene 进行总结、沉淀和状态提交的过程。

### Seal Draft

封幕草稿。由 LLM 生成，但尚未写入长期世界状态。可以重试、编辑、删除、局部再生成。

### Seal Commit

封幕确认提交。用户确认后，系统将封幕草稿写入时间轴、角色记忆、关系网和当前主线状态。

### Character Memory

角色长期记忆。建议至少包含：核心身份、关系记忆、事件记忆、当前目标 / 状态。

### Relationship Graph

角色关系网。展示角色之间的关系类型、强度、变化、来源 Scene 和当前状态。

---

## 6. 实施前盘点任务

在写任何核心代码之前，先完成一次现有实现盘点。输出简短文档或注释说明，避免重复造轮子。

请检查并记录：

1. Story World 相关路由。
2. World 创建 / 编辑相关组件。
3. Scene 创建 / 进入 / 继续相关组件。
4. 封幕相关逻辑。
5. 角色数据结构。
6. 角色记忆数据结构。
7. 当前是否已有 relation / relationship 数据。
8. 当前是否已有 timeline / event / summary 字段。
9. LLM 调用封装位置。
10. 数据持久化方式。
11. 前端状态管理方式。
12. 现有测试方式。

输出格式建议：

```md
# Story World Existing Implementation Audit

## Routes
- ...

## Data Models
- ...

## Components
- ...

## LLM Flows
- ...

## Gaps
- ...

## Reuse Plan
- ...
```

验收标准：

- 你能说明现有 World / Scene / Character / Memory / Seal 的数据流。
- 你能指出哪些能力已有、哪些需要新增、哪些需要迁移。
- 不允许在没有盘点的情况下直接大规模重写。

---

## 7. 里程碑总览

P0 拆成四个里程碑：

```text
P0.1 World Detail 重构
P0.2 世界背景与时间轴
P0.3 角色记忆可视化与关系网
P0.4 两阶段封幕与 Inspector
```

推荐顺序：

1. 先做 World Detail 的页面框架和信息架构。
2. 再做 Timeline 和 World Bible 数据结构。
3. 再做 Character Memory / Relationship Graph 可视化。
4. 最后做 Seal Draft → Inspector → Commit，把前面所有状态串起来。

---

# P0.1 World Detail 重构

## 8. P0.1 目标

将 World Detail 从普通详情 / 配置页升级为世界状态主控台。

用户进入某个 World 后，应立即看到：

1. 当前世界是什么。
2. 当前主线推进到哪里。
3. 最近发生了什么。
4. 哪些角色活跃。
5. 有没有可继续的 Scene。
6. 下一幕可以如何开始。

---

## 9. P0.1 页面结构

World Detail 建议采用以下结构：

```text
World Header
├─ 世界标题
├─ 世界一句话简介
├─ 当前时间点
├─ 当前 Arc / 主线阶段
├─ 当前主要地点
├─ 继续当前 Scene / 开启下一幕按钮

World Status Cards
├─ 最近一幕
├─ 当前主线矛盾
├─ 未解决伏笔
├─ 活跃角色

Main Tabs
├─ Overview 概览
├─ Timeline 时间轴
├─ World Bible 世界设定
├─ Characters 角色
├─ Relationships 关系网
├─ Memories 记忆
├─ Scenes 场景历史
```

第一版可以不追求所有 Tab 都完整，但必须保留清晰的信息架构。

---

## 10. P0.1 必备功能

### 10.1 World Header

展示：

- 世界名称。
- 世界简介。
- 题材 / 风格。
- 当前世界时间。
- 当前主线阶段。
- 当前主要地点。
- 最近更新时间。

操作：

- 继续未封幕 Scene。
- 开启下一幕。
- 编辑世界设定。

### 10.2 Current Mainline Status

展示当前主线状态：

- 当前 Arc 名称。
- 当前主线问题。
- 当前冲突。
- 当前目标。
- 未解决伏笔数量。
- 最近关系变化数量。

### 10.3 Recent Scene Summary

展示最近一幕：

- Scene 标题。
- 发生时间。
- 发生地点。
- 在场角色。
- 封幕状态。
- 一句话摘要。
- 进入 Scene / 查看封幕结果。

### 10.4 Active Characters

展示当前活跃角色：

- 头像 / 名称。
- 当前状态。
- 当前目标。
- 最近记忆变化。
- 与主角 / 其他核心角色的关系提示。

---

## 11. P0.1 验收标准

- 用户进入 World Detail 后，不需要进入 Scene，也能理解当前世界状态。
- 页面上有明确的“继续当前 Scene”或“开启下一幕”入口。
- 页面能显示最近 Scene 的状态。
- 页面能显示当前主线状态，即使第一版只是简化字段。
- 页面不再像单纯配置页。
- 不破坏现有 World / Scene 流程。

---

# P0.2 世界背景与时间轴

## 12. P0.2 目标

解决世界观薄弱问题，并利用 Story World 线性推进的天然结构建立 Timeline。

Timeline 要成为 World Detail 的核心视觉和叙事导航。

---

## 13. World Bible 数据结构建议

如果现有数据结构已有类似字段，优先复用；没有则新增。

建议 World Bible 至少包含：

```ts
interface WorldBible {
  summary: string;                 // 世界一句话概述
  genre?: string;                   // 题材
  tone?: string;                    // 叙事基调
  era?: string;                     // 时代 / 背景时期
  currentDateLabel?: string;        // 当前故事时间，如“永熙三年冬”
  currentLocation?: string;         // 当前主要地点

  background: string;               // 世界背景
  history: TimelineEvent[];         // 历史背景事件
  locations: WorldLocation[];       // 地点
  factions: WorldFaction[];         // 阵营 / 组织 / 家族
  rules: WorldRule[];               // 世界规则
  taboos?: WorldRule[];             // 禁忌 / 不可触碰设定

  currentArc?: StoryArcStatus;      // 当前主线状态
}
```

### WorldLocation

```ts
interface WorldLocation {
  id: string;
  name: string;
  description: string;
  status?: string;                  // 当前状态
  importance?: 'low' | 'medium' | 'high';
  relatedCharacterIds?: string[];
  relatedFactionIds?: string[];
}
```

### WorldFaction

```ts
interface WorldFaction {
  id: string;
  name: string;
  description: string;
  goal?: string;
  status?: string;
  attitudeToPlayer?: string;
  relatedCharacterIds?: string[];
}
```

### WorldRule

```ts
interface WorldRule {
  id: string;
  title: string;
  description: string;
  importance?: 'normal' | 'important' | 'critical';
  source?: 'user' | 'ai_suggested' | 'seal_committed';
  locked?: boolean;                 // 重要设定保护
}
```

### StoryArcStatus

```ts
interface StoryArcStatus {
  id: string;
  title: string;
  summary: string;
  currentConflict?: string;
  currentGoal?: string;
  unresolvedHooks?: PlotHook[];
  status: 'setup' | 'developing' | 'climax' | 'resolved' | 'paused';
  updatedAt: string;
}
```

### PlotHook

```ts
interface PlotHook {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'dropped';
  relatedCharacterIds?: string[];
  relatedSceneIds?: string[];
  importance?: 'low' | 'medium' | 'high';
}
```

---

## 14. Timeline 数据结构建议

Timeline 需要支持三类事件：

1. 历史背景事件。
2. 已演出 Scene 事件。
3. 状态变化事件，例如关系变化、记忆沉淀、伏笔更新。

```ts
interface TimelineEvent {
  id: string;
  worldId: string;
  type:
    | 'history'
    | 'scene'
    | 'memory'
    | 'relationship'
    | 'plot_hook'
    | 'arc_update'
    | 'location_update'
    | 'faction_update';

  title: string;
  summary: string;
  dateLabel?: string;               // 故事内时间，如“永熙三年冬”
  order: number;                    // 线性排序

  source:
    | 'user'
    | 'ai_suggested'
    | 'seal_draft'
    | 'seal_committed'
    | 'migration';

  status: 'draft' | 'committed' | 'hidden';

  sceneId?: string;
  relatedCharacterIds?: string[];
  relatedLocationIds?: string[];
  relatedFactionIds?: string[];
  relatedMemoryIds?: string[];
  relatedRelationshipIds?: string[];
  relatedHookIds?: string[];

  createdAt: string;
  updatedAt: string;
}
```

---

## 15. Timeline UI 要求

Timeline 页面 / Tab 至少支持：

### 15.1 三层时间轴

```text
历史背景
├─ 世界过去发生过什么

已演出 Scene
├─ 用户和 AI 真实参与过的事件

当前主线状态
├─ 当前 Arc、伏笔、目标、冲突
```

### 15.2 筛选能力

至少支持：

- 全部。
- 历史背景。
- 已演出 Scene。
- 角色记忆。
- 关系变化。
- 伏笔。
- 主线更新。

### 15.3 Timeline Event 卡片

每个事件卡片展示：

- 标题。
- 时间标签。
- 类型。
- 摘要。
- 来源。
- 相关角色。
- 相关 Scene。
- 是否已确认。

### 15.4 Scene 节点特殊展示

Scene 节点需要展示：

- 第几幕。
- Scene 标题。
- 地点。
- 在场角色。
- 封幕摘要。
- 关键变化。
- 进入 Scene / 查看 Inspector 的入口。

---

## 16. World Bible UI 要求

World Bible 页面 / Tab 建议分区：

```text
世界概述
历史背景
地点
阵营 / 组织 / 家族
世界规则
禁忌 / 锁定设定
当前主线
```

### 16.1 编辑要求

- 用户可以手动编辑。
- AI 可以生成建议，但建议必须标记为 ai_suggested。
- 用户确认后才能转为正式设定。
- critical / locked 设定不得被封幕自动覆盖。

### 16.2 AI 建议要求

可以提供按钮：

- 根据已有 Scene 补全世界背景。
- 根据角色补全阵营。
- 根据时间轴整理历史。
- 根据封幕结果建议更新当前主线。

但第一版如果实现成本过高，可以先只做手动编辑和 Seal Commit 写入。

---

## 17. P0.2 验收标准

- World Detail 中存在 Timeline 入口。
- Timeline 能展示至少两类事件：历史背景事件、Scene 事件。
- Scene 封幕后能在 Timeline 中形成节点。
- World Bible 至少能展示和编辑世界背景、当前时间、当前地点、当前主线。
- 时间轴顺序稳定，不因刷新或重载错乱。
- AI 建议内容和用户确认内容有明确状态区分。
- 重要设定可被锁定，避免被后续封幕覆盖。

---

# P0.3 角色记忆可视化与关系网

## 18. P0.3 目标

让用户能直观看到：

1. 每个角色现在是谁。
2. 他经历了什么。
3. 他记住了什么。
4. 他和其他角色是什么关系。
5. 这些记忆和关系变化来自哪一幕。

角色记忆和关系网必须一起设计，因为关系本质上也是结构化记忆。

---

## 19. Character Memory 数据结构建议

如已有结构，优先兼容，不要强行推倒重来。

建议长期目标结构：

```ts
interface CharacterMemoryProfile {
  characterId: string;
  worldId: string;

  coreIdentity: MemoryItem[];        // 核心身份
  currentState: MemoryItem[];        // 当前状态
  goals: MemoryItem[];               // 目标 / 动机
  episodic: MemoryItem[];            // 事件记忆
  relationships: RelationshipMemory[];

  updatedAt: string;
}
```

### MemoryItem

```ts
interface MemoryItem {
  id: string;
  characterId: string;
  worldId: string;
  type:
    | 'core_identity'
    | 'current_state'
    | 'goal'
    | 'episodic'
    | 'secret'
    | 'promise'
    | 'trauma'
    | 'belief'
    | 'knowledge';

  content: string;
  importance: 'low' | 'medium' | 'high' | 'critical';
  confidence: 'low' | 'medium' | 'high';

  source:
    | 'user'
    | 'character_creation'
    | 'seal_draft'
    | 'seal_committed'
    | 'manual_edit'
    | 'migration';

  status: 'draft' | 'committed' | 'archived' | 'rejected';
  locked?: boolean;

  sceneId?: string;
  timelineEventId?: string;
  relatedCharacterIds?: string[];

  createdAt: string;
  updatedAt: string;
}
```

### RelationshipMemory

```ts
interface RelationshipMemory {
  id: string;
  worldId: string;
  fromCharacterId: string;
  toCharacterId: string;

  relationType:
    | 'ally'
    | 'enemy'
    | 'family'
    | 'mentor'
    | 'student'
    | 'rival'
    | 'romantic'
    | 'trust'
    | 'suspicion'
    | 'debt'
    | 'promise'
    | 'betrayal'
    | 'unknown'
    | 'custom';

  label: string;
  description: string;
  intensity?: number;                // 0-100
  trust?: number;                    // 可选，0-100
  tension?: number;                  // 可选，0-100

  status: 'draft' | 'committed' | 'archived' | 'rejected';
  source: 'user' | 'seal_draft' | 'seal_committed' | 'manual_edit' | 'migration';

  sceneId?: string;
  timelineEventId?: string;
  evidence?: string;                 // 简短来源说明，不要塞长全文

  createdAt: string;
  updatedAt: string;
}
```

---

## 20. Character UI 要求

角色详情页或 World Detail 的 Characters Tab 中，应展示：

### 20.1 角色状态卡

- 名称。
- 身份。
- 当前状态。
- 当前目标。
- 最近参与 Scene。
- 最近新增记忆。
- 当前关系摘要。

### 20.2 角色记忆面板

按类型分组：

```text
核心身份
当前状态
目标 / 动机
事件记忆
承诺
秘密
对其他角色的认知
```

每条记忆展示：

- 内容。
- 重要性。
- 来源。
- 来源 Scene。
- 是否锁定。
- 是否由封幕写入。

### 20.3 记忆操作

第一版至少支持：

- 查看。
- 编辑。
- 删除 / 归档。
- 锁定重要记忆。

进阶支持：

- 合并重复记忆。
- 标记为错误。
- 查看变更历史。

---

## 21. Relationship Graph UI 要求

关系网第一版不要过度追求炫酷，应以可读性为优先。

推荐布局：

```text
左侧：角色列表 / 筛选
中间：关系网图 / 关系矩阵
右侧：选中关系详情
```

### 21.1 关系展示

每条关系边展示：

- 关系标签。
- 方向。
- 强度。
- 最近变化。
- 来源 Scene。

### 21.2 筛选能力

至少支持：

- 全部角色。
- 当前在场角色。
- 只看高强度关系。
- 只看最近变化。
- 按关系类型筛选。

### 21.3 关系详情

点击某条关系后展示：

- from / to 角色。
- 关系类型。
- 当前描述。
- 最近变化。
- 证据 / 来源 Scene。
- 相关记忆。
- 相关时间轴事件。

---

## 22. P0.3 验收标准

- 用户可以在 World Detail 中查看角色记忆。
- 用户可以看出记忆来源于哪一幕或哪个封幕。
- 用户可以看到角色之间的关系。
- 关系变化可以关联到 Scene 或 Timeline Event。
- 重要记忆可以锁定。
- 关系网在角色数量较多时仍然可读，至少有列表 / 筛选 fallback。
- 不因缺少关系数据导致页面崩溃，空状态要清楚。

---

# P0.4 两阶段封幕与 Scene-end Inspector

## 23. P0.4 目标

将封幕从“一次性 LLM 调用并直接写入状态”升级为“两阶段提交”：

```text
Generate Seal Draft
→ Review in Scene-end Inspector
→ Commit Seal
```

这样可以实现：

- LLM 报错可重试。
- 生成质量不佳可重试。
- 用户可编辑封幕结果。
- 用户可删除错误记忆。
- 用户可确认后再写入长期状态。
- 避免重复写入和状态污染。

---

## 24. Seal Draft 数据结构建议

```ts
interface SealDraft {
  id: string;
  worldId: string;
  sceneId: string;

  status:
    | 'generating'
    | 'ready'
    | 'failed'
    | 'committed'
    | 'discarded';

  sceneSummary: string;
  titleSuggestion?: string;
  dateLabel?: string;
  location?: string;

  timelineEvents: TimelineEventDraft[];
  memoryUpdates: MemoryUpdateDraft[];
  relationshipUpdates: RelationshipUpdateDraft[];
  plotHookUpdates: PlotHookUpdateDraft[];
  worldBibleSuggestions: WorldBibleSuggestionDraft[];
  nextSceneSuggestions: NextSceneSuggestion[];

  warnings?: SealWarning[];
  error?: string;

  llmRunId?: string;
  retryOfDraftId?: string;

  createdAt: string;
  updatedAt: string;
}
```

### TimelineEventDraft

```ts
interface TimelineEventDraft {
  id: string;
  type: TimelineEvent['type'];
  title: string;
  summary: string;
  dateLabel?: string;
  relatedCharacterIds?: string[];
  relatedLocationIds?: string[];
  confidence: 'low' | 'medium' | 'high';
  selected: boolean;
}
```

### MemoryUpdateDraft

```ts
interface MemoryUpdateDraft {
  id: string;
  characterId: string;
  type: MemoryItem['type'];
  content: string;
  importance: MemoryItem['importance'];
  confidence: MemoryItem['confidence'];
  locked?: boolean;
  selected: boolean;
  evidence?: string;
}
```

### RelationshipUpdateDraft

```ts
interface RelationshipUpdateDraft {
  id: string;
  fromCharacterId: string;
  toCharacterId: string;
  relationType: RelationshipMemory['relationType'];
  label: string;
  description: string;
  intensity?: number;
  trust?: number;
  tension?: number;
  confidence: 'low' | 'medium' | 'high';
  selected: boolean;
  evidence?: string;
}
```

### SealWarning

```ts
interface SealWarning {
  id: string;
  type:
    | 'low_confidence'
    | 'possible_hallucination'
    | 'conflict_with_locked_lore'
    | 'missing_character_motivation'
    | 'ambiguous_relationship_change'
    | 'llm_error';
  message: string;
  relatedDraftItemIds?: string[];
}
```

---

## 25. Scene-end Inspector UI 要求

Scene-end Inspector 是封幕后的检查页面 / 弹窗 / 抽屉。

必须展示：

```text
本幕摘要
时间轴事件
角色记忆更新
关系变化
伏笔 / 主线更新
世界设定建议
下一幕建议
警告和低置信度内容
```

### 25.1 本幕摘要

展示：

- Scene 标题。
- 本幕摘要。
- 发生时间。
- 发生地点。
- 在场角色。

用户可编辑。

### 25.2 时间轴事件

展示将写入 Timeline 的事件。

用户可：

- 勾选 / 取消。
- 编辑标题。
- 编辑摘要。
- 修改时间标签。

### 25.3 角色记忆更新

按角色分组展示。

每条记忆可：

- 勾选 / 取消。
- 编辑内容。
- 修改重要性。
- 锁定为重要记忆。
- 查看证据。

### 25.4 关系变化

展示角色关系变化。

每条关系变化可：

- 勾选 / 取消。
- 编辑关系标签。
- 编辑关系描述。
- 调整强度 / 信任 / 紧张度。
- 查看证据。

### 25.5 伏笔 / 主线更新

展示：

- 新增伏笔。
- 推进中的伏笔。
- 已解决伏笔。
- 当前 Arc 更新。

### 25.6 世界设定建议

展示 LLM 根据本幕提出的设定补充。

默认不应自动选中，除非是用户明确表达的设定。

### 25.7 下一幕建议

展示 1-3 个下一幕建议，例如：

- 继续当前冲突。
- 切换到某角色视角。
- 前往新地点。
- 处理某个伏笔。

这些建议不直接写入长期状态，主要用于下一幕创建入口。

---

## 26. 封幕重试机制

必须支持：

1. 生成失败后重试。
2. 对当前 Seal Draft 整体重新生成。
3. 最好支持局部重试：
   - 只重试角色记忆。
   - 只重试关系变化。
   - 只重试下一幕建议。

如果第一版实现局部重试成本过高，可以先实现整体重试，但数据结构要为局部重试预留空间。

### 26.1 重试约束

- 重试 Seal Draft 不得修改已 committed 的世界状态。
- 每次重试生成新的 SealDraft。
- 原 SealDraft 可以标记为 discarded 或保留历史。
- Commit 时只能提交一个 ready 状态的 SealDraft。

---

## 27. Seal Commit 幂等要求

Commit Seal 是高风险操作，必须幂等。

要求：

1. 同一个 SealDraft 只能 commit 一次。
2. 同一个 Scene 只能存在一个最终 committed seal，除非未来明确支持版本修订。
3. Commit 中途失败时，不应产生半写入状态。
4. 如果无法做数据库事务，也要实现补偿或状态检查。
5. 所有写入项都要带 source = 'seal_committed'。
6. 所有写入项都要关联 sceneId 和 sealDraftId / sealId。

Commit 后写入：

- Scene sealed 状态。
- Timeline Scene 节点。
- 选中的 Timeline Events。
- 选中的 Character Memories。
- 选中的 Relationship Updates。
- 选中的 Plot Hooks。
- 必要的 World Bible 更新。
- World 当前主线状态。

---

## 28. Seal LLM 输出要求

LLM 输出必须结构化。不要依赖纯文本再人工解析。

建议 JSON Schema：

```json
{
  "sceneSummary": "string",
  "titleSuggestion": "string",
  "dateLabel": "string",
  "location": "string",
  "timelineEvents": [
    {
      "type": "scene | memory | relationship | plot_hook | arc_update | location_update | faction_update",
      "title": "string",
      "summary": "string",
      "relatedCharacterNames": ["string"],
      "confidence": "low | medium | high"
    }
  ],
  "memoryUpdates": [
    {
      "characterName": "string",
      "type": "core_identity | current_state | goal | episodic | secret | promise | trauma | belief | knowledge",
      "content": "string",
      "importance": "low | medium | high | critical",
      "confidence": "low | medium | high",
      "evidence": "string"
    }
  ],
  "relationshipUpdates": [
    {
      "fromCharacterName": "string",
      "toCharacterName": "string",
      "relationType": "ally | enemy | family | mentor | student | rival | romantic | trust | suspicion | debt | promise | betrayal | unknown | custom",
      "label": "string",
      "description": "string",
      "intensity": 0,
      "trust": 0,
      "tension": 0,
      "confidence": "low | medium | high",
      "evidence": "string"
    }
  ],
  "plotHookUpdates": [
    {
      "title": "string",
      "description": "string",
      "status": "open | in_progress | resolved | dropped",
      "importance": "low | medium | high"
    }
  ],
  "worldBibleSuggestions": [
    {
      "section": "background | history | location | faction | rule | taboo | arc",
      "title": "string",
      "content": "string",
      "confidence": "low | medium | high"
    }
  ],
  "nextSceneSuggestions": [
    {
      "title": "string",
      "premise": "string",
      "suggestedCharacters": ["string"],
      "suggestedLocation": "string"
    }
  ],
  "warnings": [
    {
      "type": "low_confidence | possible_hallucination | conflict_with_locked_lore | missing_character_motivation | ambiguous_relationship_change | llm_error",
      "message": "string"
    }
  ]
}
```

---

## 29. Seal Prompt 要求

封幕 Prompt 必须明确告诉 LLM：

1. 只总结本幕实际发生的内容。
2. 不要发明未出现的重要事实。
3. 可以提出世界设定建议，但必须标记为 suggestion。
4. 区分事实、推测、建议。
5. 每条角色记忆必须有角色归属。
6. 每条关系变化必须有方向和证据。
7. 不要覆盖 locked / critical 世界设定。
8. 输出必须符合 JSON Schema。
9. 不要输出 Markdown。
10. 不要让一个角色知道他在 Scene 中没有获知的信息。

### 29.1 Prompt 输入上下文

封幕时建议输入：

- World 基础信息。
- World Bible 摘要。
- Locked Rules / Critical Lore。
- 当前 Arc 状态。
- Scene 消息记录。
- 在场角色列表。
- 角色当前记忆摘要。
- 当前关系摘要。
- 用户显式设定变更。

### 29.2 Prompt 输出限制

LLM 不应：

- 生成超长世界百科。
- 替用户决定重大设定。
- 把旁白信息写进不该知道的角色记忆。
- 把未确认建议直接当事实。
- 输出无法解析的自然语言。

---

## 30. P0.4 验收标准

- 用户点击封幕后，先生成 Seal Draft，而不是直接写入长期状态。
- LLM 失败时，当前 Scene 不丢失，用户可以重试。
- 用户可以在 Inspector 中查看本幕摘要、记忆更新、关系变化、时间轴事件。
- 用户可以取消选择错误项。
- 用户可以编辑关键内容。
- 用户确认后才写入长期世界状态。
- 同一 SealDraft 重复提交不会重复写入。
- Commit 后 World Detail、Timeline、Memory、Relationship Graph 都能看到对应更新。

---

# 31. 数据迁移与兼容

如果现有数据中已经有 Scene Summary、Character Memory 或 Seal 结果，需要提供兼容方案。

## 31.1 迁移策略

建议：

1. 不删除旧字段。
2. 新增 World State 相关字段 / 表 / store。
3. 旧封幕结果可以迁移为 timeline event。
4. 旧 character memory 可以迁移为 committed MemoryItem。
5. 无法确定来源的旧数据 source = 'migration'。
6. 无法确定 Scene 的旧数据允许 sceneId 为空。

## 31.2 空状态处理

必须处理：

- 老 World 没有 World Bible。
- 老 Scene 没有 Seal。
- 老角色没有 Memory。
- 老世界没有 Timeline。
- 老世界没有 Relationship。

空状态文案要鼓励用户继续使用，例如：

- “这个世界还没有历史事件，可以先添加背景事件，或在下一次封幕后自动生成。”
- “角色关系还没有沉淀，完成一幕封幕后会出现在这里。”

---

# 32. UI / UX 细节要求

## 32.1 信息优先级

World Detail 首屏优先级：

1. 世界名称和当前状态。
2. 继续 / 开启下一幕。
3. 最近发生了什么。
4. 当前主线问题。
5. 活跃角色。
6. 时间轴入口。

## 32.2 状态标签

全系统统一状态标签：

- Draft / 草稿。
- Suggested / AI 建议。
- Committed / 已确认。
- Locked / 已锁定。
- Archived / 已归档。
- Low Confidence / 低置信度。

## 32.3 可解释性

任何由 AI 写入或建议的内容，都应该能让用户看到：

- 来源。
- 关联 Scene。
- 置信度。
- 是否已确认。

## 32.4 防止用户被复杂信息淹没

World Detail 首页不要一次性展示全部细节。推荐采用：

- 概览卡片。
- Tabs。
- 折叠区域。
- “查看详情”。
- 只展示最近变化。

---

# 33. 测试要求

## 33.1 单元测试

至少覆盖：

- Timeline event 排序。
- SealDraft 状态转换。
- Seal Commit 幂等。
- MemoryItem 创建。
- RelationshipUpdate 创建。
- Locked rule 不被覆盖。

## 33.2 集成测试

至少覆盖：

1. 创建 World。
2. 添加 World Bible 基础设定。
3. 创建 Scene。
4. 添加若干消息。
5. 生成 Seal Draft。
6. 编辑 Draft。
7. Commit Seal。
8. 检查 Timeline 更新。
9. 检查 Character Memory 更新。
10. 检查 Relationship Graph 更新。
11. 回到 World Detail，看到当前主线状态变化。

## 33.3 错误测试

至少覆盖：

- LLM 超时。
- LLM 输出 JSON 不合法。
- LLM 输出角色名无法匹配。
- 重试封幕。
- 重复提交同一个 SealDraft。
- Commit 过程中部分写入失败。
- 老数据缺字段。

---

# 34. Agent 执行步骤

请按以下步骤执行，不要跳步。

## Step 1：盘点现有实现

输出 Existing Implementation Audit。

重点找出：

- World 数据在哪里。
- Scene 数据在哪里。
- Character Memory 现在如何保存。
- Seal 当前如何执行。
- UI 路由如何组织。

## Step 2：提出最小改动方案

基于现有实现，写出简短技术方案：

```md
# P0 World State Implementation Plan

## Existing Reuse
## New Data Structures
## UI Changes
## LLM Flow Changes
## Migration Plan
## Risks
```

## Step 3：实现 P0.1

先完成 World Detail 页面框架。

不要等所有后端能力完成后才做 UI，可以用已有数据和空状态先搭出主控台。

## Step 4：实现 P0.2

完成 World Bible 和 Timeline 的基础数据与 UI。

优先让 Timeline 能展示：

- 手动历史事件。
- Scene 节点。

## Step 5：实现 P0.3

完成 Memory 和 Relationship 的可视化。

优先保证：

- 角色记忆可读。
- 关系可读。
- 来源可见。

## Step 6：实现 P0.4

改造封幕为两阶段流程。

优先保证：

- Draft 可生成。
- Draft 可重试。
- Inspector 可检查。
- Commit 可幂等写入。

## Step 7：补测试与文档

补充必要测试，并更新开发文档。

---

# 35. 每个 PR / 提交的建议拆分

建议不要一个巨大 PR 完成全部内容。推荐拆分：

## PR 1：Audit + World Detail Shell

- 现有实现盘点。
- World Detail 新信息架构。
- Overview 空状态。
- 继续 / 开启下一幕入口。

## PR 2：World Bible + Timeline 基础模型

- World Bible 数据结构。
- TimelineEvent 数据结构。
- Timeline UI。
- 手动 / 迁移事件展示。

## PR 3：Memory + Relationship UI

- MemoryItem 兼容层。
- RelationshipMemory 数据结构。
- Character Memory UI。
- Relationship Graph / List UI。

## PR 4：Seal Draft + Inspector

- SealDraft 数据结构。
- Generate Draft。
- Inspector UI。
- Retry。

## PR 5：Seal Commit + Integration

- Commit 写入 Timeline / Memory / Relationship / Arc。
- 幂等保护。
- 错误处理。
- 集成测试。

---

# 36. 最终验收清单

完成 P0 后，应满足以下验收清单：

## World Detail

- [ ] 用户能看到世界当前状态。
- [ ] 用户能看到当前时间点和主线阶段。
- [ ] 用户能看到最近一幕。
- [ ] 用户能继续未封幕 Scene。
- [ ] 用户能开启下一幕。

## World Bible

- [ ] 用户能查看世界背景。
- [ ] 用户能编辑世界背景。
- [ ] 用户能查看地点 / 阵营 / 世界规则。
- [ ] 用户能锁定关键设定。

## Timeline

- [ ] 用户能看到历史背景事件。
- [ ] 用户能看到已演出 Scene 节点。
- [ ] 用户能看到封幕后的事件沉淀。
- [ ] 用户能按类型筛选时间轴。

## Character Memory

- [ ] 用户能查看角色核心身份。
- [ ] 用户能查看角色事件记忆。
- [ ] 用户能查看角色当前目标 / 状态。
- [ ] 用户能看到记忆来源。
- [ ] 用户能锁定重要记忆。

## Relationship Graph

- [ ] 用户能查看角色关系。
- [ ] 用户能查看关系变化来源。
- [ ] 用户能筛选关系。
- [ ] 用户能查看选中关系详情。

## Seal Draft / Inspector

- [ ] 封幕后先生成草稿。
- [ ] 草稿失败可重试。
- [ ] 草稿可编辑。
- [ ] 用户可取消错误项。
- [ ] 用户确认后才写入长期状态。
- [ ] Commit 幂等。

## Integration

- [ ] Commit 后 World Detail 更新。
- [ ] Commit 后 Timeline 更新。
- [ ] Commit 后 Character Memory 更新。
- [ ] Commit 后 Relationship Graph 更新。
- [ ] 老数据不会崩溃。

---

# 37. 风险与注意事项

## 37.1 最大风险：AI 幻觉污染世界状态

解决：

- 两阶段封幕。
- AI 建议和确认状态分离。
- Locked Lore 保护。
- Inspector 可编辑 / 取消选择。

## 37.2 最大体验风险：页面信息过载

解决：

- World Detail 首屏只放概览。
- 深层信息放 Tabs。
- Timeline 和 Memory 默认只展示最近变化。
- 关系网提供列表 fallback。

## 37.3 最大工程风险：一次性大重构

解决：

- 保持兼容。
- 小 PR 拆分。
- 先做 UI shell。
- 再做数据结构。
- 最后接入封幕写入。

## 37.4 最大数据风险：重复提交 Seal

解决：

- SealDraft 状态机。
- Commit 幂等检查。
- sceneId + sealDraftId 关联。
- 写入项 source 标记。

---

# 38. 推荐完成顺序摘要

```text
1. Audit 当前 Story World 实现
2. World Detail 主控台 UI
3. World Bible 基础字段与编辑
4. Timeline 基础事件系统
5. Character Memory 可视化
6. Relationship Graph / List
7. Seal Draft 数据结构
8. Seal Draft 生成与重试
9. Scene-end Inspector
10. Seal Commit 幂等写入
11. 集成测试与文档
```

---

# 39. 最终产品判断标准

P0 成功的标准不是“页面变多了”，而是用户进入一个世界后，会自然产生以下感受：

1. 这个世界有历史。
2. 这个世界正在推进。
3. 我的角色和 AI 角色留下了痕迹。
4. 角色真的记住了事情。
5. 角色关系真的发生了变化。
6. 封幕不是结束，而是下一幕的起点。
7. 我愿意回到这个世界继续创作。

如果实现后的体验仍然像普通聊天室，只是多了一些摘要和字段，那么 P0 没有成功。

如果实现后的体验像一个“活着的故事世界主控台”，那么 P0 成功。
