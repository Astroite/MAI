import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from litellm import acompletion
from pydantic import BaseModel

from .models import ApiProvider, Message, Persona, PhaseTemplate


@dataclass
class StreamChunk:
    text: str
    index: int


class LLMAdapter:
    async def stream(
        self,
        persona: Persona,
        context: list[Message],
        phase: PhaseTemplate | None,
        max_tokens: int,
        scribe_state: dict[str, Any] | None = None,
        api_provider: ApiProvider | None = None,
    ) -> AsyncIterator[StreamChunk]:
        messages = [{"role": "system", "content": self._build_system_prompt(persona, phase, scribe_state)}]
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
            **self._build_provider_params(api_provider),
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
        api_provider: ApiProvider | None = None,
    ) -> dict[str, Any]:
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
            **self._build_provider_params(api_provider),
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

    def _build_provider_params(self, provider: ApiProvider | None) -> dict[str, Any]:
        if provider is None:
            return {}
        params: dict[str, Any] = {}
        if provider.api_key:
            params["api_key"] = provider.api_key
        if provider.api_base:
            params["api_base"] = provider.api_base
        return params

    def _build_system_prompt(
        self,
        persona: Persona,
        phase: PhaseTemplate | None,
        scribe_state: dict[str, Any] | None,
    ) -> str:
        parts = [persona.system_prompt.strip()]
        if phase:
            parts.append(f"当前 Phase：{phase.name}。{phase.description}".strip())
            if phase.role_constraints:
                parts.append(f"本阶段行为约束：{phase.role_constraints}")
            if phase.prompt_template:
                parts.append(f"本轮任务：{phase.prompt_template}")
        brief = self._render_scribe_brief(scribe_state).strip()
        if brief:
            parts.append(f"当前结构化记录：\n{brief}")
        return "\n\n".join(part for part in parts if part)

    def _render_scribe_brief(self, scribe_state: dict[str, Any] | None) -> str:
        if not scribe_state:
            return ""
        labels = {
            "decisions": "已裁决",
            "consensus": "共识",
            "disagreements": "分歧",
            "open_questions": "开放问题",
            "dead_ends": "死路",
        }
        lines: list[str] = []
        for key, label in labels.items():
            items = [item for item in scribe_state.get(key, []) if item.get("content")]
            if items:
                joined = "；".join(item["content"][:140] for item in items[-3:])
                lines.append(f"{label}：{joined}")
        return "\n".join(lines) + ("\n\n" if lines else "")

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


llm_adapter = LLMAdapter()
