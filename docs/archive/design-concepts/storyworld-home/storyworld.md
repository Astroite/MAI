请根据我提供的参考图，实现 MAI App 的 故事世界的页面改造。参考的概念图是同目录下的storyworld.png

产品方向：
MAI 当前主方向是 Story Mode / Story World。故事世界的页面 应该体现“AI 故事导演台”的感觉：用户可以创建世界、开启场景、继续最近一幕、查看角色近况和封幕后的记忆。

设计风格：
清新、简洁、mint teal / clear-water blue、冷白背景、少量 coral 警示。三栏工作台布局。避免复杂后台感。组件使用 8px 以下圆角、1px 分割线、轻阴影、状态 chip。图标优先 lucide-react。不引入大型 UI 框架。参考ui_brief。

技术约束：
保持现有 React Query / API / i18n 结构。不删除现有功能。不做营销页。所有新增文案走 i18n。不要生成任何会覆盖、删除或修改已有对话历史的 CRUD 代码。首页只负责展示和进入现有 World / Scene / Character / Template 等对象。

请实现以下结构：

左侧 Sidebar：
保持不变

中间 Main：
1. Hero Card
标题：今天要导演哪一幕？
副标题：选择一个世界，开启一幕场景，让角色继续他们的故事。
按钮：新建世界、开启新场景、继续最近一幕。
Hero 背景可以使用浅色水墨山水 / clear-water blue 氛围图形或 CSS 占位。

2. 最近的世界
展示 3-4 张 World Card。
每张卡片包含封面、世界名、简介、角色头像、当前场景、状态 chip、继续按钮。

3. 快速开始
四个入口：
- 创建故事世界：从零开始构建你的故事宇宙
- 开启角色群演：邀请多个角色进入同一世界互动
- 从模板开始：使用模板快速搭建世界与设定
- 创建角色：设计角色背景、性格与记忆

右侧 Director Panel：
1. 当前世界摘要
展示当前世界、简介、当前场景、场景内角色、下一幕建议。
示例下一幕建议：在渡口引入新的冲突。

2. 角色近况
实例：
- 玄女：对主角保持戒备，但仍在试探
- 酒僧：情绪松弛，似乎知道更多内情
- 船夫：急于离港，回避追问
每个角色有头像、名称、状态 chip：在场、记忆摘要。

3. 今日可以做什么
- 开启新世界：构建一个全新的故事宇宙
- 继续最近一幕：回到上次中断的场景
- 查看封幕后记忆：回顾已封幕世界的关键记忆

建议组件拆分：
HomePage、HomeSidebar、HomeHeroCard、RecentWorldsSection、WorldCard、QuickStartSection、QuickStartCard、DirectorPanel、CurrentWorldSummaryCard、CharacterStatusCard、TodaySuggestionsCard、StatusChip、AvatarStack。

请优先复用现有组件和样式体系。如果需要 mock 数据，只能作为 UI fallback，不要写入后端。完成后请检查：视觉接近参考图、文案走 i18n、没有破坏现有功能、没有新增危险数据修改逻辑。