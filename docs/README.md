# MAI 文档地图

> 当前文档结构整理于 2026-05-12。阅读顺序：产品语义先看 `product/`，实现约束再看 `architecture/`，运行发布看 `ops/`。

## 现行文档

| 路径 | 定位 | 维护要求 |
|---|---|---|
| `product/product_design.md` | 产品总设计：核心对象、用户流程、权限与冻结语义 | 改用户可见语义时必须同步 |
| `product/story_world.md` | Story World / Scene / Character / Memory 子系统 | 改世界、场景、角色记忆时必须同步 |
| `product/personas.md` | 内置 persona taxonomy 与扩展规则 | 改 `seed.py` 内置人设时同步 |
| `architecture/technical_design.md` | 后端/前端契约、引擎不变量、schema 迁移策略 | 改 runtime、API contract、schema 时必须同步 |
| `architecture/append_only_boundaries.md` | 数据模型 append-only 与 mutable 边界定义 | 改表的只读/可写属性时同步 |
| `architecture/known_provider_quirks.md` | LLM provider 兼容性 workaround 清单 | 改 LLM 调用降级逻辑时同步 |
| `architecture/schema_history.md` | 迁移历史、_ADDED_COLUMNS 清单、迁移删除规则 | 新增/删除迁移或自愈列时同步 |
| `ops/usage.md` | 本地运行、配置、常用流程、验证命令 | 改启动、配置、常用操作时同步 |
| `ops/desktop_tauri.md` | Tauri 桌面壳打包与诊断 | 改桌面打包、sidecar、日志策略时同步 |
| `design/ui_brief.md` | 当前视觉方向约束 | 改设计系统、页面视觉语言时同步 |
| `status.md` | 模块状态快照 | 每个阶段性合入后刷新 |

## 归档文档

归档内容在 `archive/` 下。它们是历史概念稿、一次性实现 prompt、旧截图或过期草案，不再作为当前实现依据。

当前归档：

- `archive/design-concepts/room-workspace/`：早期讨论室 UI 概念图。
- `archive/design-concepts/storyworld-home/`：Story World 首页改造 prompt 和概念图。
- `archive/mai_next_phase_iteration_plan.md`：下一阶段产品与工程迭代规划，已执行完毕。
- `archive/engineering/refactor_issues_2026-05-11.md`：2026-05-11 重构复盘，问题已落地。

## 审计快照

`review/` 下按日期存放架构审计报告，是某一时间点的系统健康快照，不作为持续维护的 source-of-truth。

- `review/2026-05-12/`：五部分架构审计（架构地图、胶水兼容、契约一致性、状态机、Story World 边界）+ 执行计划。

## 维护规则

1. **改语义先改 source-of-truth。** 例如 pause / freeze / seal / autodrive 语义变化，应同步 `product/` 与 `architecture/`。
2. **改 API contract 同步四处。** 后端 schema / route、前端 type / api wrapper、React Query invalidation、文档契约说明都要一致。
3. **旧材料不要混在现行目录。** 已落地或过期的概念稿直接移入 `archive/`，避免 Agent 把它误当成当前需求。
4. **设计规范和设计稿分离。** `design/ui_brief.md` 是现行规范；概念图、prompt、参考稿放归档。
5. **状态快照不是设计源。** `status.md` 只记录现状，不承载新的产品决策。
