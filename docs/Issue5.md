# Issue 5：封幕可靠性与角色记忆边界修复

## 背景

当前故事模式封幕存在两个问题：

1. 角色记忆偶尔混乱，可能把角色不可知的信息写入长期记忆。
2. 出场角色太多时，封幕耗时长且容易失败。

目标不是简单修改 prompt，而是把封幕改成可验证、可分段、可重试的结算流程。

## 核心原则

- 封幕不能直接全量 transcript → 全角色记忆。
- 每个角色只能基于自己的 visible transcript 生成记忆。
- 临时导演指令、系统消息、工具日志不能写入世界事实或角色记忆。
- 每条记忆和关系变化必须带 evidence_message_ids。
- 单个角色失败不能导致整个封幕失败。
- commit 时只写入通过验证的更新。

## 重点文件

优先检查：

- `backend/app/engine.py`
- `backend/app/main.py`
- `backend/app/models.py`
- `backend/app/schemas.py`
- `frontend/src/api.ts`
- `frontend/src/pages/room/SealResultsDialog.tsx`
- 相关测试文件

当前系统已有：
- `generate_scene_seal_draft_payload`
- seal draft create / update / retry / commit API
- scene enter / exit API
- scene speaker visible messages 逻辑

请复用这些基础能力，不要重复造一套不一致的可见性规则。

## 任务 1：新增封幕上下文构建器

新增或重构：

```python
async def build_scene_seal_context(session, scene_id: str) -> SceneSealContext:
    ...
~~~

输出必须包含：

- scene
- world
- transcript messages
- public transcript
- stage members
- per-character visible messages
- per-character existing memories
- per-character existing relations

要求：

- 复用或对齐 `visible_messages_for_scene_speaker`
- 退场角色不能看到退场后的消息
- 临时导演指令不能进入角色可见消息
- 系统消息和工具日志不能进入记忆输入
- 每条 message 保留 id、author、message_type、created_at、content 摘要

## 任务 2：拆分封幕生成流程

将封幕生成拆成：

```python
generate_public_scene_summary(context)
generate_character_memory_updates(context, character_id)
generate_relationship_updates(context, pair)
validate_scene_seal_draft(draft, context)
```

要求：

- 不再一次性生成所有角色记忆
- 角色记忆按角色单独调用 LLM
- 关系更新按 pair 或按小批次调用
- 并发限制 2-3
- 单个角色失败时记录 failed，不要中断整个 draft
- draft status 支持 partial / ready / failed

## 任务 3：收紧 prompt 与输出 schema

公共摘要必须输出：

```json
{
  "summary": "",
  "world_delta": "",
  "open_threads": [],
  "timeline_suggestion": "",
  "evidence_message_ids": []
}
```

角色记忆必须输出：

```json
{
  "character_id": "",
  "memories": [
    {
      "content": "",
      "type": "episodic|belief|goal|secret|clue",
      "importance": 0.0,
      "confidence": 0.0,
      "evidence_message_ids": []
    }
  ],
  "warnings": []
}
```

关系更新必须输出：

```json
{
  "from_character_id": "",
  "to_character_id": "",
  "changes": [
    {
      "label": "",
      "attitude_delta": 0.0,
      "notes": "",
      "confidence": 0.0,
      "evidence_message_ids": []
    }
  ],
  "warnings": []
}
```

## 任务 4：新增验证器

新增：

```python
validate_scene_seal_draft(draft, context)
```

必须检查：

- memory.character_id 存在
- evidence_message_ids 存在
- evidence message 属于该角色 visible_messages
- evidence message 不是导演指令 / 系统 / 工具日志
- exited character 没有使用退场后的消息作为证据
- relationship from/to 存在且不是同一角色
- relationship evidence 合法
- 无证据项目进入 skipped/warnings，不写库

## 任务 5：commit 只写 validated updates

修改 commit 逻辑：

- 只提交 validated memory updates
- 只提交 validated relationship updates
- invalid updates 不写库
- 返回 committed / skipped / warnings 统计
- scene sealed_at 只在 commit 成功后写入
- draft 标记 committed

## 任务 6：增强 retry

现有 retry draft 不应该只能整个 draft 重试。

至少支持内部逻辑：

- retry failed summary
- retry failed character memory
- retry failed relationship batch

如果暂时不改 API，也要在 `retrySealDraft` 中只重试 failed parts，而不是全量重跑。

## 任务 7：前端展示 warnings / failed parts

修改 `SealResultsDialog`：

- 显示公共摘要
- 显示每个角色记忆更新
- 显示关系更新
- 显示 warnings
- 显示 failed parts
- 显示 skipped invalid updates
- commit 前让用户知道哪些内容会被写入，哪些会被跳过

## 测试用例

必须新增测试：

1. 退场角色不会获得退场后消息记忆。
2. 临时导演指令不会进入任何角色记忆。
3. 没有 evidence_message_ids 的记忆不会 commit。
4. 多角色封幕时，一个角色生成失败不会导致整个 draft 失败。
5. retry 只重试失败部分。
6. 关系更新没有直接证据时不会生成。
7. commit 后只写入 validated memory/relation。
8. 封幕成功后 scene.sealed_at 被写入。
9. 封幕失败或 partial draft 不会 sealed。
10. 大量角色时封幕生成不会因为单个 LLM 错误整体失败。

## 验收标准

- 角色 A 不会记住只有角色 B 知道的事情。
- 退场角色不会记住退场后的事情。
- 导演指令不会污染世界事实和角色记忆。
- 角色多时封幕可以 partial success。
- 用户能看到失败项和警告。
- 可以重试失败项。
- commit 只写入通过验证的内容。
- 现有封幕 API 不破坏前端调用。

