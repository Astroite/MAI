- 整体视觉方向：清新、简洁、mint teal / clear-water blue、冷白背景、少量 coral 警示。
- 布局原则：工作台三栏、配置页两栏、避免复杂后台感。
- 组件规则：8px 以下圆角、1px 分割线、轻阴影、状态 chip、阶段状态图、消息引用 chip。
- 每张图对应哪些现有页面：
  - 讨论室工作台 → RoomShell.tsx, MessageList.tsx, RightPanel.tsx
  - 新建讨论 → DashboardPage.tsx
  - 书记与决议 → ScribePanel.tsx, DecisionsPanel.tsx
  - 人设与模型 → TemplatesPage.tsx
  - 工具页 → ToolPanel.tsx
  - 设置/API → SettingsPage.tsx



约束：
- 保持现有 React Query / API / i18n 结构。
- 不引入大型 UI 框架。
- 不删除现有功能。
- 不做营销页。
- 文案走 i18n。
- 优先复用 lucide-react 图标。