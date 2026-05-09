import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from litellm import acompletion
from pydantic import BaseModel

from .models import ApiProvider, Message, Persona, PhaseTemplate


@dataclass
class StreamChunk:
    text: str
    index: int


@dataclass
class ToolCompletion:
    content: str
    tool_call_count: int = 0


class LLMAdapter:
    async def stream(
        self,
        persona: Persona,
        context: list[Message],
        phase: PhaseTemplate | None,
        max_tokens: int,
        scribe_state: dict[str, Any] | None = None,
        api_provider: ApiProvider | None = None,
        room_background: str = "",
        peer_names: dict[str, str] | None = None,
        peer_identities: dict[str, str] | None = None,
    ) -> AsyncIterator[StreamChunk]:
        messages = self._build_messages(
            persona, context, phase, scribe_state, room_background, peer_names, peer_identities
        )

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

    async def complete_with_tools(
        self,
        persona: Persona,
        context: list[Message],
        phase: PhaseTemplate | None,
        max_tokens: int,
        tools: list[dict[str, Any]],
        execute_tool: Callable[[str, dict[str, Any]], Awaitable[str]],
        scribe_state: dict[str, Any] | None = None,
        api_provider: ApiProvider | None = None,
        max_tool_rounds: int = 4,
        room_background: str = "",
        peer_names: dict[str, str] | None = None,
        peer_identities: dict[str, str] | None = None,
    ) -> ToolCompletion:
        messages = self._build_messages(
            persona, context, phase, scribe_state, room_background, peer_names, peer_identities
        )
        tool_call_count = 0
        for _ in range(max_tool_rounds + 1):
            response = await acompletion(
                model=persona.backing_model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=persona.temperature,
                tools=tools or None,
                **self._build_extra_params(persona),
                **self._build_provider_params(api_provider),
            )
            message = response.choices[0].message
            content = self._read_attr(message, "content") or ""
            tool_calls = self._read_attr(message, "tool_calls") or []
            if not tool_calls:
                return ToolCompletion(content=content, tool_call_count=tool_call_count)

            normalized_calls = [self._normalize_tool_call(call) for call in tool_calls]
            tool_call_count += len(normalized_calls)
            messages.append({"role": "assistant", "content": content, "tool_calls": normalized_calls})
            for call in normalized_calls:
                function = call.get("function") or {}
                name = function.get("name") or ""
                raw_args = function.get("arguments") or "{}"
                try:
                    parsed_args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
                except Exception:
                    parsed_args = {"raw_arguments": raw_args}
                result_text = await execute_tool(name, parsed_args)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id"),
                        "content": result_text,
                    }
                )
        return ToolCompletion(
            content="工具调用轮次已达到上限，请基于已获得的工具结果继续推进。",
            tool_call_count=tool_call_count,
        )

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
        schema = output_model.model_json_schema()
        base_messages = [
            {"role": "system", "content": persona.system_prompt},
            {
                "role": "user",
                "content": (
                    "Use the requested tool exactly once. "
                    "Return only facts supported by the payload.\n\n"
                    f"Payload:\n{json.dumps(payload, ensure_ascii=False)}"
                ),
            },
        ]
        base_kwargs: dict[str, Any] = dict(
            model=persona.backing_model,
            max_tokens=max_tokens,
            temperature=persona.temperature,
            **self._build_extra_params(persona),
            **self._build_provider_params(api_provider),
        )
        tool_def = [
            {
                "type": "function",
                "function": {
                    "name": tool_name,
                    "description": tool_description,
                    "parameters": schema,
                },
            }
        ]

        # 1) Preferred path: forced tool_choice. Most providers honor this and
        #    we get a perfectly-shaped tool_call back.
        try:
            response = await acompletion(
                messages=base_messages,
                tools=tool_def,
                tool_choice={"type": "function", "function": {"name": tool_name}},
                **base_kwargs,
            )
        except Exception as exc:
            msg = str(exc).lower()
            # DeepSeek reasoner and a few other providers reject forced
            # tool_choice with a 400. Fall back to auto + nudge in the prompt.
            tool_choice_unsupported = (
                "tool_choice" in msg
                or "does not support" in msg and "tool" in msg
                or "function" in msg and "not supported" in msg
            )
            if not tool_choice_unsupported:
                raise
            response = await self._complete_tool_auto_fallback(
                base_messages, base_kwargs, tool_def, tool_name, schema
            )

        message = response.choices[0].message
        arguments = self._extract_tool_arguments(message)
        parsed = self._parse_tool_arguments(arguments)
        return output_model.model_validate(parsed).model_dump(mode="json")

    async def _complete_tool_auto_fallback(
        self,
        base_messages: list[dict[str, Any]],
        base_kwargs: dict[str, Any],
        tool_def: list[dict[str, Any]],
        tool_name: str,
        schema: dict[str, Any],
    ):
        """For providers that reject forced tool_choice (e.g. deepseek-reasoner).

        We retry with `tool_choice="auto"`, and if the model still doesn't
        emit a tool_call, drop tools entirely and ask for raw JSON — then the
        caller's argument parser handles fenced/plain JSON content.
        """
        nudged_messages = list(base_messages)
        nudged_messages[-1] = {
            "role": "user",
            "content": (
                f"Call the function `{tool_name}` exactly once. "
                "Do not include any prose, reasoning, or markdown — only the function call.\n\n"
                + nudged_messages[-1]["content"]
            ),
        }
        try:
            response = await acompletion(
                messages=nudged_messages,
                tools=tool_def,
                tool_choice="auto",
                **base_kwargs,
            )
            if self._read_attr(response.choices[0].message, "tool_calls"):
                return response
        except Exception:
            # Fall through to JSON-mode retry below.
            pass

        # Last resort: no tools, just ask for JSON conforming to the schema.
        json_messages = [
            {
                "role": "system",
                "content": (
                    base_messages[0]["content"]
                    + "\n\nReturn only a JSON object that validates against this schema. "
                    "Do not wrap it in markdown fences. Do not include any other text.\n"
                    f"Schema:\n{json.dumps(schema, ensure_ascii=False)}"
                ),
            },
            base_messages[1],
        ]
        return await acompletion(messages=json_messages, **base_kwargs)

    def _parse_tool_arguments(self, arguments: Any) -> dict[str, Any]:
        if isinstance(arguments, dict):
            return self._unstring_nested(arguments)
        text = (arguments or "{}").strip()
        # Strip ```json ... ``` fences if present.
        if text.startswith("```"):
            text = text.strip("`").strip()
            if text.lower().startswith("json"):
                text = text[4:].lstrip()
        # Some models prefix the JSON with reasoning prose. Try to slice from
        # the first { to the matching last }.
        if not text.startswith("{") and "{" in text:
            text = text[text.index("{"):]
        if not text.endswith("}") and "}" in text:
            text = text[: text.rindex("}") + 1]
        return self._unstring_nested(json.loads(text or "{}"))

    def _unstring_nested(self, value: Any) -> Any:
        """Recursively re-hydrate JSON-string sub-fields.

        MiMo, some OpenRouter relays, and a few self-hosted models emit nested
        objects/arrays as JSON-encoded strings inside tool-call arguments
        instead of as real JSON values. We recover those before pydantic
        validation. Only strings that *look* like JSON (start with `{` or `[`)
        are attempted, so legitimate text fields are untouched.
        """
        if isinstance(value, dict):
            return {k: self._unstring_nested(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._unstring_nested(x) for x in value]
        if isinstance(value, str):
            stripped = value.strip()
            if stripped.startswith(("{", "[")):
                try:
                    return self._unstring_nested(json.loads(stripped))
                except json.JSONDecodeError:
                    pass
        return value

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
        room_background: str = "",
        has_peers: bool = False,
        peer_roster: list[tuple[str, str]] | None = None,
    ) -> str:
        parts = [persona.system_prompt.strip()]
        if room_background and room_background.strip():
            parts.append(f"【场景设定】\n{room_background.strip()}")
        if has_peers:
            # Tell the model how the transcript is labeled and that it must
            # NOT echo the convention back. Without this, multi-AI rooms blur
            # into a single omniscient narrator voice — every AI sees prior
            # AI turns as its own past output and "continues" them.
            identity_clause = f"({persona.identity})" if getattr(persona, "identity", "") else ""
            parts.append(
                f"【发言规则】\n"
                f"你只是「{persona.name}」{identity_clause}一个人。下方对话历史里,以「『某某』:」开头的发言来自其他人,"
                f"不是你说的;你只能就你自己的立场、动作、内心做出回应。\n"
                f"输出时只直接说出「{persona.name}」要说的话或动作,**不要在自己的回复里加「『{persona.name}』:」前缀**,"
                f"也绝不要替别人写台词或动作。如果想对某人说话,直接说,不需要标注对方名字。"
            )
            if peer_roster:
                roster = "、".join(
                    f"{name}({identity})" if identity else name
                    for name, identity in peer_roster
                )
                parts.append(f"本房间在场的其他人:{roster}。")
        if phase:
            parts.append(f"当前 Phase:{phase.name}。{phase.description}".strip())
            if phase.role_constraints:
                parts.append(f"本阶段行为约束:{phase.role_constraints}")
            if phase.prompt_template:
                parts.append(f"本轮任务:{phase.prompt_template}")
            ordering = (phase.ordering_rule or {}).get("type")
            if ordering == "casual":
                # casual_chat treats silence as the polite default — sit out
                # turns you have nothing for. story_mode is the opposite: even
                # a beat of in-character action keeps the scene alive, and
                # blanket-silencing kills the whole room. We discriminate by
                # the `story` tag so other story-style phases users author
                # themselves can opt into the same treatment.
                phase_tags = set(phase.tags or [])
                if "story" in phase_tags:
                    parts.append(
                        "这是故事场景:即便此刻没有大新闻,也请用一句台词、一个动作或一个表情"
                        "(例如皱眉、转身、低声自语、看一眼某人)保持角色的存在感。"
                        "**只有**当你的角色此刻确实别无可演时才输出 `<silent/>`;能演就演,不要轻易沉默。"
                    )
                else:
                    parts.append(
                        "这是闲聊场景。如果你这一轮没有想补充的、没有真正想说的话,"
                        "就只输出 `<silent/>` 这一个标记,不要解释原因,也不要客套。"
                        "只在你确实有内容要说时才正常发言;不要为了凑话而说话。"
                    )
        brief = self._render_scribe_brief(scribe_state).strip()
        if brief:
            parts.append(f"当前结构化记录:\n{brief}")
        return "\n\n".join(part for part in parts if part)

    def _build_messages(
        self,
        persona: Persona,
        context: list[Message],
        phase: PhaseTemplate | None,
        scribe_state: dict[str, Any] | None,
        room_background: str = "",
        peer_names: dict[str, str] | None = None,
        peer_identities: dict[str, str] | None = None,
    ) -> list[dict[str, Any]]:
        """Route history so each model sees the conversation from its own POV.

        Without this routing, every AI persona sees every prior AI turn as
        its own `assistant` history — and naturally "continues" all of them
        in a single omniscient-narrator voice, which is exactly how 3 personas
        in a story room ended up writing one shared narration.

        Routing rules (current speaker = `persona`):
          * `persona`'s own past turns        -> assistant (no prefix)
          * Other AI personas' turns          -> user, prefixed `「Name」: ...`
          * `user_as_persona` masquerade      -> user, prefixed by masquerade name
          * Real user / system / judge        -> user, prefixed `「用户」` etc.
        """
        peer_map: dict[str, str] = dict(peer_names or {})
        identity_map: dict[str, str] = dict(peer_identities or {})
        # Build prompt only after deciding whether peers exist, so the rule
        # block isn't injected for solo rooms (scribe/facilitator cycles etc.).
        has_peers = any(pid != persona.id for pid in peer_map)
        # Roster of other personas with their identities for the system prompt
        # (different from the inline `「Name」:` prefix, which stays short).
        peer_roster: list[tuple[str, str]] = []
        for pid, pname in peer_map.items():
            if pid == persona.id:
                continue
            peer_roster.append((pname, identity_map.get(pid, "")))
        messages: list[dict[str, Any]] = [
            {
                "role": "system",
                "content": self._build_system_prompt(
                    persona,
                    phase,
                    scribe_state,
                    room_background,
                    has_peers=has_peers,
                    peer_roster=peer_roster,
                ),
            }
        ]
        for message in context[-50:]:
            role, prefix = self._route_message(message, persona, peer_map)
            content = (
                f"「{prefix}」: {message.content}" if prefix else message.content
            )
            messages.append({"role": role, "content": content})
        return messages

    @staticmethod
    def _route_message(
        message: Message,
        persona: Persona,
        peer_map: dict[str, str],
    ) -> tuple[str, str | None]:
        author_actual = message.author_actual
        author_persona_id = message.author_persona_id
        # Current persona's own past turn — no relabeling.
        if author_persona_id and author_persona_id == persona.id:
            return ("assistant", None)
        # Another AI persona — surface as user input with name prefix.
        if author_persona_id and author_actual == "ai":
            name = peer_map.get(author_persona_id) or "他人"
            return ("user", name)
        # User masquerading as a persona (with or without reveal).
        if author_actual == "user_as_persona":
            label = message.user_masquerade_name or "扮演者"
            return ("user", label)
        if author_actual == "user_as_judge":
            return ("user", "裁判")
        # Real user, system messages, dead_end markers, etc.
        return ("user", "用户" if author_actual == "user" else None)

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

    def _normalize_tool_call(self, call: Any) -> dict[str, Any]:
        function = self._read_attr(call, "function") or {}
        name = self._read_attr(function, "name") or ""
        arguments = self._read_attr(function, "arguments") or "{}"
        return {
            "id": self._read_attr(call, "id") or f"tool_{name}",
            "type": self._read_attr(call, "type") or "function",
            "function": {"name": name, "arguments": arguments},
        }

    @staticmethod
    def _read_attr(value: Any, key: str) -> Any:
        if isinstance(value, dict):
            return value.get(key)
        return getattr(value, key, None)


llm_adapter = LLMAdapter()
