import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

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

    @staticmethod
    def _chunk_text(text: str, size: int = 32) -> list[str]:
        return [text[i : i + size] for i in range(0, len(text), size)] or [""]


llm_adapter = LLMAdapter()

