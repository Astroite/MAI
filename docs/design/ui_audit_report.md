# UI 标准化审计报告

> 审计日期：2026-05-10
> 分支：`feature/ui-standardization`
> 范围：`frontend/src/` 全部 48 个源文件（41 `.tsx` + 6 `.ts` + 1 `.css`）

---

## 1. 图标大小不一致

### 1.1 问题总览

代码库使用了 **13 种不同的像素尺寸**（9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 26, 48），远超 Lucide 推荐的标准阶梯（12, 14, 16, 18, 20, 24）。

### 1.2 重点不一致

| 场景 | 当前状态 | 建议 |
|------|---------|------|
| **冻结状态 Snowflake 图标** | 5 个文件用了 5 种尺寸：9 / 10 / 10 / 11 / 16 | 统一为 `size={12}` |
| **房间卡片统计图标**（Users / MessageCircle） | 3 个文件用了 3 种尺寸：10 / 11 / 12 | 统一为 `size={12}` |
| **删除按钮 Trash2** | 5 种尺寸：12 / 13 / 14 / 15 / 16 | 统一为 `size={14}` |
| **编辑按钮 Pencil** | 4 种尺寸：12 / 15 / 16 | 统一为 `size={14}` |
| **折叠切换 Chevron** | 3 种尺寸：12 / 14 / 16 | 统一为 `size={14}` |
| **添加按钮 Plus** | 3 种尺寸：13 / 14 / 16 | 统一为 `size={14}` |
| **保存按钮 Save** | 3 种尺寸：12 / 13 / 14 / 16 | 统一为 `size={14}` |

### 1.3 建议标准化尺寸阶梯

| 语义 | 尺寸 | 使用场景 |
|------|------|---------|
| `icon-xs` | 12 | 内联徽章、状态指示器、紧凑统计 |
| `icon-sm` | 14 | 按钮图标、SectionCard 头部、面板标签 |
| `icon-md` | 16 | 工具栏按钮、对话框关闭、操作按钮 |
| `icon-lg` | 18 | 导航栏、页面头部图标 |
| `icon-xl` | 20 | 特色卡片、大型指示器 |

### 1.4 PersonaIcon 复合尺寸

PersonaIcon 在 13 个位置使用了 9 种不同的容器尺寸（18, 20, 22, 26, 28, 32, 36, 44, 48）。建议标准化为 4 级：

| 级别 | 容器 | 内图标 | 场景 |
|------|------|--------|------|
| xs | 18 | 9 | Composer 选择器 |
| sm | 24 | 12 | 侧边栏、紧凑列表 |
| md | 32 | 16 | 消息头像、角色卡片 |
| lg | 44 | 22 | 模板编辑器、对话框预览 |

---

## 2. 文字大小不一致

### 2.1 问题总览

代码库使用了 3 个非标准像素尺寸（`text-[9px]`、`text-[10px]`、`text-[11px]`）与标准 Tailwind 尺寸混用，且相同 UI 模式在不同文件中使用不同尺寸。

### 2.2 重点不一致

| 场景 | 当前状态 | 建议 |
|------|---------|------|
| **标签/徽章 pill** | TemplatesPage 用 `text-[11px]`，PersonaTemplatePicker 用 `text-[10px]` | 统一为 `text-xs` |
| **元数据行** | HomePage/RoomListSidebar 用 `text-[11px]`，DashboardPage 用 `text-xs` | 统一为 `text-xs` |
| **代码片段** | ToolsPage/MessageList 用 `text-[11px]`，PersonaTemplatePicker 用 `text-xs` | 统一为 `text-xs` |
| **表单提示** | WorldDetailPage 用 `text-[11px]`，PhaseExitBanner 用 `text-xs` | 统一为 `text-xs` |
| **大写标签** | PersonaTemplatePicker 用 `text-[10px]`，MembersSidebar 用 `text-xs` | 统一为 `text-xs` |
| **徽章数字** | 5 种尺寸：9 / 10 / 10 / 11 / 12 | 按容器大小分级 |

### 2.3 建议标准化尺寸阶梯

| 语义 | Tailwind | 像素 | 使用场景 |
|------|----------|------|---------|
| `text-xs` | `text-xs` | 12 | 元数据、标签、徽章、提示、代码 |
| `text-sm` | `text-sm` | 14 | 正文、表单标签、描述 |
| `text-base` | `text-base` | 16 | 对话框标题 |
| `text-lg` | `text-lg` | 18 | 区域标题 |
| `text-xl` | `text-xl` | 20 | 页面标题 |
| `text-2xl` | `text-2xl` | 24 | 首页大标题 |

**消除目标**：`text-[9px]`（1 处）、`text-[10px]`（13 处）、`text-[11px]`（30+ 处）全部改为 `text-xs`。

### 2.4 文字对齐

对齐基本一致，无需大改。`items-start` 用于多行内容，`items-center` 用于单行，符合预期。

---

## 3. 输入框与表单控件大小

### 3.1 问题总览

`.input` / `.textarea` / `.btn` 基础类定义一致，但存在覆盖和误用。

### 3.2 重点不一致

| 问题 | 位置 | 描述 |
|------|------|------|
| **`btn-sm` 未定义** | `App.tsx:204,209` | 使用了不存在的 CSS 类，无实际效果 |
| **textarea 误用 `.input`** | `WorldDetailPage.tsx:618,875` | `<textarea className="input">` 应为 `.textarea` |
| **3 种小按钮高度** | 全局 | `h-6`(1处) / `h-7`(20+处) / `h-8`(20+处) 混用 |
| **同文件混用 h-7/h-8** | `TemplatesPage.tsx` | 模型列表用 `h-7`，人设/阶段列表用 `h-8` |
| **圆角不一致** | 5 个文件 | 部分 `btn-primary` 用 `rounded-full`，其余用 `rounded-md` |
| **Composer 输入框覆盖** | `Composer.tsx:274` | `h-8 text-xs` 覆盖基础 `h-9 text-sm` |
| **Composer 附件按钮** | `Composer.tsx:282` | 内联样式替代 `.btn` 类，值略有不同 |
| **方形图标按钮 3 种尺寸** | 全局 | `h-7 w-7` / `h-8 w-8` / `h-9 w-9` 混用 |
| **冗余 text-sm** | `RoomShell.tsx:570` | `.textarea` 已含 `text-sm` |

### 3.3 建议标准化

| 语义 | 高度 | 使用场景 |
|------|------|---------|
| `btn-xs` | `h-6` (24px) | 极小内联操作 |
| `btn-sm` | `h-7` (28px) | 列表/表格中的紧凑操作按钮 |
| `btn` | `h-9` (36px) | 标准按钮（保持现有） |
| `btn-lg` | `h-10` (40px) | 发送按钮等主要操作 |

| 语义 | 尺寸 | 使用场景 |
|------|------|---------|
| `icon-btn-sm` | `h-7 w-7` | 紧凑方形图标按钮 |
| `icon-btn` | `h-8 w-8` | 标准方形图标按钮 |
| `icon-btn-lg` | `h-9 w-9` | 大方形图标按钮 |

**圆角规则**：`btn-primary` 统一使用 `rounded-md`；仅 Composer 发送按钮保留 `rounded-full`（特殊语义）。

---

## 4. 色系匹配

### 4.1 问题总览（最严重）

项目已定义完整的语义色系（`brand` / `danger` / `success` / `warning` / `info` / `accent`），但大量页面直接使用 Tailwind 原始色名绕过语义层。

### 4.2 重点不一致

| 问题类型 | 数量 | 涉及文件 |
|---------|------|---------|
| **硬编码 hex 色板重复 3 次** | 3 处 | PersonaIcon / WorldListPage / WorldDetailPage |
| **`personaTone()` 函数重复** | 2 处 | MembersSidebar / MessageList（完全相同的 HSL 生成） |
| **冻结状态硬编码 RGB** | 3 处 | DashboardPage / HomePage / RoomListSidebar（`rgb(244 63 94 / 0.7)`） |
| **`rose-*` 应为 `danger`** | 14 处 | App / SettingsPage / TemplatesPage / WorldListPage / WorldDetailPage / SceneInspectorDialog / RoomListSidebar / SpeakerStateBar / RoomShell |
| **`emerald-*` 应为 `success`** | 15 处 | App / DashboardPage / HomePage / SettingsPage / TemplatesPage / WorldDetailPage / SceneInspectorDialog |
| **`amber-*` 应为 `warning`** | 5 处 | App / HomePage / WorldDetailPage / RoomShell |
| **`violet-*` 无语义对应** | 1 处 | HomePage |
| **`zinc-*` 应为 `muted`** | 3 处 | SettingsPage / TemplatesPage |
| **hex-alpha 拼接** | 1 处 | SpeakerStateBar（`` `${accent}66` ``） |
| **`dark:text-blue-300` 泄漏** | 1 处 | App.tsx |

### 4.3 建议修复

1. **提取共享色板常量**：`PERSONA_COLORS` / `PALETTE` 合并为 `constants/colors.ts` 中的单一导出。
2. **提取共享 `personaTone()` 函数**：放入 `utils/color.ts`，消除 MembersSidebar 和 MessageList 的重复。
3. **冻结状态用语义色**：`rgb(244 63 94 / 0.7)` → `bg-danger/70` 或 CSS 变量。
4. **批量替换原始色名**：
   - `rose-*` → `danger-*`（14 处）
   - `emerald-*` → `success-*`（15 处）
   - `amber-*` → `warning-*`（5 处）
   - `zinc-400` → `muted`（3 处）
5. **消除 hex-alpha 拼接**：SpeakerStateBar 使用 CSS `color-mix()` 或 Tailwind opacity 语法。
6. **修复 dark mode 泄漏**：App.tsx `dark:text-blue-300` → `dark:text-brand`。

---

## 5. 其他发现

### 5.1 代码重复

| 重复项 | 位置 | 建议 |
|--------|------|------|
| `personaTone()` HSL 生成 | MembersSidebar + MessageList | 提取到 `utils/color.ts` |
| `PERSONA_COLORS` / `PALETTE` 色板 | 3 个文件 | 提取到 `constants/colors.ts` |
| 冻结状态 inline style 模式 | DashboardPage + HomePage + RoomListSidebar | 提取为工具函数或 CSS 类 |

### 5.2 可访问性

- 未发现 `aria-label` 缺失的严重问题（大部分交互元素有文本标签）。
- 色彩对比度未在此次审计范围内，建议后续补充。

---

## 6. 修复优先级

| 优先级 | 类别 | 影响范围 | 工作量 |
|--------|------|---------|--------|
| **P0** | 色系替换（rose/emerald/amber → 语义） | 34 处，14 文件 | 中 |
| **P0** | 提取重复色板和 personaTone | 5 文件 | 小 |
| **P1** | 文字大小统一（text-[10px]/[11px] → text-xs） | 43 处，16 文件 | 中 |
| **P1** | 图标大小统一（按场景分级） | ~60 处 | 大 |
| **P2** | 按钮高度统一（定义 btn-sm） | ~40 处 | 中 |
| **P2** | textarea 误用修复 | 2 处 | 小 |
| **P2** | 圆角统一（rounded-full → rounded-md） | 5 处 | 小 |
| **P3** | 消除 hex-alpha 拼接 | 1 处 | 小 |
| **P3** | 修复 dark mode 泄漏 | 1 处 | 小 |
| **P3** | 定义并使用 `btn-sm` | 2 处 + 新增定义 | 小 |
