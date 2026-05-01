import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from .config import get_settings
from .models import Message, Persona, PhaseTemplate


@dataclass
class StreamChunk:
    text: str
    index: int


class LLMAdapter:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def stream(
        self,
        persona: Persona,
        context: list[Message],
        phase: PhaseTemplate | None,
        max_tokens: int,
    ) -> AsyncIterator[StreamChunk]:
        if self.settings.mock_llm or persona.backing_model.startswith("mock/"):
            text = self._mock_response(persona, context, phase, max_tokens)
            for index, part in enumerate(self._chunk_text(text)):
                await asyncio.sleep(0.025)
                yield StreamChunk(text=part, index=index)
            return

        try:
            from litellm import acompletion
        except ImportError as exc:
            raise RuntimeError("LiteLLM is not installed; enable MOCK_LLM or install dependencies.") from exc

        messages = [{"role": "system", "content": persona.system_prompt}]
        for message in context[-50:]:
            role = "assistant" if message.author_actual in {"ai", "user_as_persona"} else "user"
            messages.append({"role": role, "content": message.content})

        response = await acompletion(
            model=persona.backing_model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=persona.temperature,
            stream=True,
            **self._build_extra_params(persona),
        )
        index = 0
        async for chunk in response:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                yield StreamChunk(text=delta, index=index)
                index += 1

    async def complete_tool(
        self,
        persona: Persona,
        tool_name: str,
        tool_description: str,
        output_model: type[BaseModel],
        payload: dict[str, Any],
        max_tokens: int = 1200,
    ) -> dict[str, Any]:
        if self.settings.mock_llm or persona.backing_model.startswith("mock/"):
            data = self._mock_tool_result(tool_name, payload)
            return output_model.model_validate(data).model_dump(mode="json")

        try:
            from litellm import acompletion
        except ImportError as exc:
            raise RuntimeError("LiteLLM is not installed; enable MOCK_LLM or install dependencies.") from exc

        response = await acompletion(
            model=persona.backing_model,
            messages=[
                {"role": "system", "content": persona.system_prompt},
                {
                    "role": "user",
                    "content": (
                        "Use the requested tool exactly once. "
                        "Return only facts supported by the payload.\n\n"
                        f"Payload:\n{json.dumps(payload, ensure_ascii=False)}"
                    ),
                },
            ],
            max_tokens=max_tokens,
            temperature=persona.temperature,
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "description": tool_description,
                        "parameters": output_model.model_json_schema(),
                    },
                }
            ],
            tool_choice={"type": "function", "function": {"name": tool_name}},
            **self._build_extra_params(persona),
        )
        message = response.choices[0].message
        arguments = self._extract_tool_arguments(message)
        parsed = arguments if isinstance(arguments, dict) else json.loads(arguments or "{}")
        return output_model.model_validate(parsed).model_dump(mode="json")

    def _build_extra_params(self, persona: Persona) -> dict[str, Any]:
        deep = bool((persona.config or {}).get("deep_thinking"))
        if not deep:
            return {}
        if persona.backing_model.startswith("anthropic/"):
            return {"thinking": {"type": "enabled", "budget_tokens": 10000}}
        if persona.backing_model.startswith("openai/"):
            return {"reasoning_effort": "high"}
        return {}

    def _mock_response(
        self,
        persona: Persona,
        context: list[Message],
        phase: PhaseTemplate | None,
        max_tokens: int,
    ) -> str:
        recent = [m for m in context if m.visibility_to_models][-6:]
        latest_user = next((m.content for m in reversed(recent) if m.author_actual in {"user", "user_as_judge"}), "")
        latest_any = recent[-1].content if recent else ""
        phase_name = phase.name if phase else "自由讨论"
        role_hint = {
            "架构师": "我会先收紧边界和数据流，再指出一个需要尽早验证的结构性假设。",
            "性能批评者": "我先看吞吐、延迟和资源消耗，避免方案在规模上失真。",
            "维护者": "我关注这件事半年后的维护成本，尤其是调试、迁移和测试。",
            "书记官": "我只记录已经发生的事实，不给建议。",
            "上帝副手": "我会从节奏和讨论健康度给用户提示。",
        }.get(persona.name, "我从当前角色视角补充一个具体判断。")

        basis = latest_user or latest_any or "目前还没有足够上下文，先建立讨论框架。"
        text = (
            f"【{persona.name} · {phase_name}】{role_hint}\n\n"
            f"基于当前上下文：{basis[:360]}\n\n"
            "我的判断是：先明确目标、约束和可验证标准，再决定是否进入下一阶段。"
            "如果这是方案评审，我建议把关键风险写成可测试的检查项，而不是停留在偏好层面。"
        )
        char_budget = max(280, max_tokens * 3)
        return text[:char_budget]

    def _mock_tool_result(self, tool_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        if tool_name == "scribe_update":
            current = payload.get("current_state") or {}
            messages = payload.get("messages") or []
            known = {
                "decisions": {item.get("message_id") for item in current.get("decisions", [])},
                "dead_ends": {item.get("message_id") for item in current.get("dead_ends", [])},
                "artifacts": {item.get("message_id") for item in current.get("artifacts", [])},
                "open_questions": {item.get("message_id") for item in current.get("open_questions", [])},
                "consensus": {item.get("message_id") for item in current.get("consensus", [])},
                "disagreements": {item.get("message_id") for item in current.get("disagreements", [])},
            }
            result: dict[str, Any] = {
                "consensus_added": [],
                "consensus_removed": [],
                "disagreements_added": [],
                "disagreements_resolved": [],
                "open_questions_added": [],
                "open_questions_answered": [],
                "decisions_added": [],
                "artifacts_added": [],
                "dead_ends_added": [],
                "reasoning": "mock scribe folded explicit verdicts, uploads, dead ends, and obvious discussion markers.",
            }
            for message in messages:
                message_id = message.get("id")
                content = message.get("content") or ""
                message_type = message.get("message_type")
                if not message_id:
                    continue
                if message_type == "verdict" and message_id not in known["decisions"]:
                    result["decisions_added"].append({"message_id": message_id, "content": content, "locked": True})
                if message_type == "verdict_revoke" and message_id not in known["dead_ends"]:
                    result["dead_ends_added"].append({"message_id": message_id, "content": f"撤销裁决：{content}"})
                if message_type == "user_doc" and message_id not in known["artifacts"]:
                    result["artifacts_added"].append(
                        {"message_id": message_id, "type": "uploaded_document", "title": content[:80]}
                    )
                if message_type == "meta" and "死路" in content and message_id not in known["dead_ends"]:
                    result["dead_ends_added"].append({"message_id": message_id, "content": content})
                if ("？" in content or "?" in content) and message_id not in known["open_questions"]:
                    result["open_questions_added"].append({"message_id": message_id, "content": content[:240]})
                if "共识" in content and message_id not in known["consensus"]:
                    result["consensus_added"].append({"message_id": message_id, "content": content[:240]})
                if "分歧" in content and message_id not in known["disagreements"]:
                    result["disagreements_added"].append({"message_id": message_id, "content": content[:240]})
            return result

        if tool_name == "facilitator_evaluation":
            recent = payload.get("recent_messages") or []
            signals: list[dict[str, Any]] = []
            overall = "productive"
            pacing = "节奏正常。"
            if len(recent) >= 5:
                authors = [message.get("author_persona_id") or message.get("author_actual") for message in recent[:5]]
                if len(set(authors)) <= 2:
                    overall = "circling"
                    pacing = "最近几轮发言集中在少数角色，建议切换 phase 或点名反方。"
                    signals.append(
                        {
                            "tag": "disagreement_unproductive",
                            "severity": "suggest",
                            "reasoning": "最近发言集中，可能开始原地循环。",
                            "evidence_message_ids": [message.get("id") for message in recent[:5] if message.get("id")],
                        }
                    )
            if recent and len(recent[0].get("content", "")) // 4 > 450:
                signals.append(
                    {
                        "tag": "pacing_warning",
                        "severity": "info",
                        "reasoning": "最近单轮输出较长。",
                        "evidence_message_ids": [recent[0]["id"]] if recent[0].get("id") else [],
                    }
                )
            if not signals:
                signals.append(
                    {
                        "tag": "consensus_emerging",
                        "severity": "info",
                        "reasoning": "讨论仍在产出可整理的观点，暂不需要强制干预。",
                        "evidence_message_ids": [message.get("id") for message in recent[:3] if message.get("id")],
                    }
                )
            return {"signals": signals, "overall_health": overall, "pacing_note": pacing}

        return {}

    def _extract_tool_arguments(self, message: Any) -> Any:
        tool_calls = self._read_attr(message, "tool_calls") or []
        if tool_calls:
            function = self._read_attr(tool_calls[0], "function") or {}
            return self._read_attr(function, "arguments") or ""
        return self._read_attr(message, "content") or "{}"

    @staticmethod
    def _read_attr(value: Any, key: str) -> Any:
        if isinstance(value, dict):
            return value.get(key)
        return getattr(value, key, None)

    @staticmethod
    def _chunk_text(text: str, size: int = 32) -> list[str]:
        return [text[i : i + size] for i in range(0, len(text), size)] or [""]


llm_adapter = LLMAdapter()
