# 2026-05-11 重构问题复盘

## 背景

本轮重构同时触及模板、API/model 配置、Story World、streaming 状态、桌面诊断、i18n 和 runtime 控制。整体方向正确，但暴露出一个核心问题：多个模块的语义边界被拉宽后，旧文档和运行时不变量没有同步收紧，导致 Agent 和代码都容易把“看起来相近”的控制混在一起。

## 已暴露问题

### 1. Pause 与 Freeze 语义混用

表现：

- 故事模式中用户点“暂停”期望当前角色说完后停住。
- 实际路径复用了 freeze，语义是立即取消 in-flight。
- 在连续 autodrive 链里，冻结如果撞在两轮之间，可能没有 active call 可取消，但旧 runner 仍继续排下一位。

根因：

- `clear_autodrive_lock()` 只删除 `_AUTODRIVE_LOCKS` 里的引用，不会停止已经持有旧 lock 的 runner。
- 没有单独的 graceful pause 状态/入口。
- 文档里只写 freeze 是最高优先级控制，没有写“暂停是温和冻结入口”。

处理：

- 引擎需要显式跟踪 autodrive runner task，并提供 stop request。
- `freeze` 保持强制取消；`pause` 等当前 active call 完成后再冻结。
- 状态条“暂停”和顶部“冻结”必须分别调用不同 API。

### 2. Runtime 状态来源过多

表现：

- `runtime.frozen`、`room.status`、`ACTIVE_CALLS`、autodrive lock、SSE streaming buffer 共同决定 UI 状态。
- 任一来源刷新延迟或被单独清理，都可能让 UI 显示“冻结/暂停”但后台仍在调度。

约束：

- 后端必须把“是否还能调度下一位”集中到 engine runner 的 stop / lock / active-call 检查。
- 前端只展示后端状态，不自行推断 runtime 结束。
- 所有会停止房间生命周期的操作（freeze、pause、delete、seal）都必须停止 autodrive runner。

### 3. Story World 增量路径依赖 Room 旧语义

表现：

- Story World 文档曾写 `autodrive / facilitator / freeze 全部不动`。
- 这句话在 PR 初期有用，但后续 Story World 已把“暂停一幕戏”变成核心交互，旧表述容易误导后续改动。

约束：

- Story World 可以复用 Room runtime，但必须明确哪些行为是“沿用”，哪些行为在产品语义上有新入口。
- Scene 的 pause / freeze / seal 都是 Room 生命周期控制，不应散落到前端临时逻辑。

### 4. 过期设计稿混在当前设计目录

表现：

- `docs/design/storyworld/storyworld.md` 是一次性实现 prompt。
- `docs/design/concepts/*.png` 是早期概念图。
- 它们和 `ui_brief.md` 同层，容易被误读成当前设计约束。

处理：

- 已归档到 `docs/archive/design-concepts/`。
- `docs/design/` 只保留当前可执行的设计规范。

### 5. 文档入口缺失

表现：

- `AGENTS.md` 列出了 source-of-truth，但 `docs/` 内部没有索引。
- 新 Agent 需要靠文件名猜测哪些是现行文档，哪些只是历史参考。

处理：

- 新增 `docs/README.md` 作为文档地图。
- 新增 `docs/archive/README.md` 说明归档边界。

## 后续硬约束

1. 改 runtime 控制时先检查 `engine.py` 的三件事：active calls、autodrive runner、append-only message。
2. 新增房间生命周期 API 时，同步 `main.py`、`schemas.py`、`frontend/src/types.ts`、`frontend/src/api.ts`、SSE invalidation 和文档。
3. 对“立即停止”和“等当前动作结束”这类相近语义，必须拆 API，不用一个 endpoint 加前端解释。
4. Story World 的用户动作如果影响 Room runtime，应在 engine 层实现，不放在页面组件里临时拼接。
5. 归档文档不参与当前需求判断；需要恢复历史方向时，先把它重新提炼成现行文档。
