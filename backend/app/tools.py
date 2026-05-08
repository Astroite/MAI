import json
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .event_bus import event_bus
from .ids import new_id
from .models import Message, PersonaTemplate, PhaseTemplate, Recipe, RoomRuntimeState, ToolInvocation, ToolServer, now_utc
from .trace import trace_record


JSON_OBJECT_SCHEMA = {"type": "object", "properties": {}, "additionalProperties": True}


BUILTIN_TOOLS: list[dict[str, Any]] = [
    {
        "name": "mai_search_room_messages",
        "display_name": "Search room messages",
        "description": "Search visible messages in the current MAI room. Use this to recover earlier facts before answering.",
        "source": "builtin",
        "read_only": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Keyword or phrase to search for."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 8},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
    {
        "name": "mai_list_room_members",
        "display_name": "List room members",
        "description": "List discussants in the current room with their names, tags, and tool settings.",
        "source": "builtin",
        "read_only": True,
        "input_schema": JSON_OBJECT_SCHEMA,
    },
    {
        "name": "mai_create_persona_template",
        "display_name": "Create persona template",
        "description": "Create a reusable MAI persona template. This is a write tool and requires explicit write permission.",
        "source": "builtin",
        "read_only": False,
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "description": {"type": "string"},
                "system_prompt": {"type": "string"},
                "temperature": {"type": "number", "minimum": 0, "maximum": 2, "default": 0.4},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["name", "system_prompt"],
            "additionalProperties": False,
        },
    },
    {
        "name": "mai_create_phase_template",
        "display_name": "Create phase template",
        "description": "Create a reusable MAI phase template. This is a write tool and requires explicit write permission.",
        "source": "builtin",
        "read_only": False,
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "description": {"type": "string"},
                "role_constraints": {"type": "string"},
                "prompt_template": {"type": "string"},
                "auto_discuss": {"type": "boolean"},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["name"],
            "additionalProperties": False,
        },
    },
]


def builtin_tool_map() -> dict[str, dict[str, Any]]:
    return {tool["name"]: tool for tool in BUILTIN_TOOLS}


async def list_tool_schemas(session: AsyncSession) -> list[dict[str, Any]]:
    tools = [dict(tool, enabled=True, server_id=None, server_name=None) for tool in BUILTIN_TOOLS]
    servers = (
        await session.scalars(select(ToolServer).where(ToolServer.enabled.is_(True)).order_by(ToolServer.name))
    ).all()
    for server in servers:
        for tool in (server.manifest or {}).get("tools", []):
            raw_name = str(tool.get("name") or "").strip()
            if not raw_name:
                continue
            tools.append(
                {
                    "name": external_tool_name(server, raw_name),
                    "original_name": raw_name,
                    "display_name": tool.get("title") or raw_name,
                    "description": tool.get("description") or raw_name,
                    "server_id": server.id,
                    "server_name": server.name,
                    "source": "mcp",
                    "input_schema": tool.get("inputSchema") or JSON_OBJECT_SCHEMA,
                    "read_only": not server.allow_write,
                    "enabled": server.enabled,
                }
            )
    return tools


async def sync_mcp_server(session: AsyncSession, server: ToolServer) -> ToolServer:
    try:
        tools = await _list_mcp_tools(server)
        server.manifest = {"tools": tools}
        server.last_synced_at = now_utc()
        server.last_error = None
    except Exception as exc:  # noqa: BLE001
        server.last_error = str(exc)
        raise
    finally:
        await session.flush()
    return server


async def execute_tool(
    session: AsyncSession,
    room_id: str,
    tool_name: str,
    arguments: dict[str, Any] | None = None,
    *,
    parent_message_id: str | None = None,
    allow_write: bool = False,
) -> ToolInvocation:
    arguments = arguments or {}
    schemas = await list_tool_schemas(session)
    schema = next((item for item in schemas if item["name"] == tool_name), None)
    if schema is None:
        raise ValueError(f"tool not found: {tool_name}")
    if not schema.get("read_only", True) and not allow_write:
        raise PermissionError(f"tool requires write permission: {tool_name}")

    invocation = ToolInvocation(
        room_id=room_id,
        parent_message_id=parent_message_id,
        server_id=schema.get("server_id"),
        tool_name=tool_name,
        display_name=schema.get("display_name") or tool_name,
        status="pending",
        arguments=arguments,
    )
    session.add(invocation)
    await session.flush()
    message = _tool_message(room_id, invocation)
    runtime = await session.get(RoomRuntimeState, room_id)
    if runtime:
        message.phase_instance_id = runtime.current_phase_instance_id
    session.add(message)
    await session.flush()
    invocation.message_id = message.id
    await trace_record(session, room_id, "tool_invocation_started", tool_name, {"tool_invocation_id": invocation.id})
    await session.flush()
    await _publish_tool_message(room_id, message, invocation)

    try:
        if schema.get("source") == "builtin":
            result = await _execute_builtin(session, room_id, tool_name, arguments)
        else:
            server = await session.get(ToolServer, schema.get("server_id"))
            if server is None:
                raise ValueError("MCP server not found")
            result = await _call_mcp_tool(server, schema.get("original_name") or original_mcp_tool_name(tool_name), arguments)
        invocation.status = "success"
        invocation.result = result
        invocation.completed_at = now_utc()
    except Exception as exc:  # noqa: BLE001
        invocation.status = "error"
        invocation.error = str(exc)
        invocation.completed_at = now_utc()
    message.content = tool_invocation_content(invocation)
    await trace_record(
        session,
        room_id,
        "tool_invocation_completed",
        f"{tool_name} -> {invocation.status}",
        {"tool_invocation_id": invocation.id, "status": invocation.status, "error": invocation.error},
    )
    await session.flush()
    await _publish_tool_message(room_id, message, invocation)
    return invocation


def tool_definitions_for_llm(tool_schemas: list[dict[str, Any]], *, allow_write: bool) -> list[dict[str, Any]]:
    allowed = [tool for tool in tool_schemas if allow_write or tool.get("read_only", True)]
    return [
        {
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool.get("description") or tool["display_name"],
                "parameters": tool.get("input_schema") or JSON_OBJECT_SCHEMA,
            },
        }
        for tool in allowed
    ]


def tool_invocation_content(invocation: ToolInvocation) -> str:
    payload = {
        "id": invocation.id,
        "tool_name": invocation.tool_name,
        "display_name": invocation.display_name,
        "status": invocation.status,
        "arguments": invocation.arguments or {},
        "result": invocation.result,
        "error": invocation.error,
        "started_at": invocation.started_at.isoformat() if invocation.started_at else None,
        "completed_at": invocation.completed_at.isoformat() if invocation.completed_at else None,
    }
    return json.dumps(payload, ensure_ascii=False)


def tool_result_as_text(invocation: ToolInvocation) -> str:
    payload = {"status": invocation.status, "result": invocation.result, "error": invocation.error}
    return json.dumps(payload, ensure_ascii=False)


async def _execute_builtin(
    session: AsyncSession,
    room_id: str,
    tool_name: str,
    arguments: dict[str, Any],
) -> Any:
    if tool_name == "mai_search_room_messages":
        query = str(arguments.get("query") or "").strip()
        limit = min(max(int(arguments.get("limit") or 8), 1), 20)
        if not query:
            return {"matches": []}
        rows = (
            await session.scalars(
                select(Message)
                .where(
                    Message.room_id == room_id,
                    Message.visibility_to_models.is_(True),
                    Message.content.ilike(f"%{query}%"),
                )
                .order_by(Message.created_at.desc())
                .limit(limit)
            )
        ).all()
        return {
            "matches": [
                {
                    "message_id": row.id,
                    "message_type": row.message_type,
                    "author_actual": row.author_actual,
                    "author_persona_id": row.author_persona_id,
                    "content": row.content[:1200],
                    "created_at": row.created_at.isoformat(),
                }
                for row in rows
            ]
        }
    if tool_name == "mai_list_room_members":
        from .models import PersonaInstance

        rows = (
            await session.scalars(
                select(PersonaInstance).where(PersonaInstance.room_id == room_id).order_by(PersonaInstance.position)
            )
        ).all()
        return {
            "members": [
                {
                    "id": row.id,
                    "template_id": row.template_id,
                    "kind": row.kind,
                    "name": row.name,
                    "description": row.description,
                    "tags": row.tags or [],
                    "tools_enabled": bool((row.config or {}).get("tools_enabled")),
                    "auto_reply_enabled": (row.config or {}).get("auto_reply_enabled", True) is not False,
                }
                for row in rows
            ]
        }
    if tool_name == "mai_create_persona_template":
        template = PersonaTemplate(
            id=new_id(),
            kind="discussant",
            name=str(arguments.get("name") or "新智能体"),
            description=str(arguments.get("description") or ""),
            backing_model="",
            system_prompt=str(arguments.get("system_prompt") or "请基于当前讨论上下文给出清晰观点。"),
            temperature=float(arguments.get("temperature") or 0.4),
            config={},
            tags=list(arguments.get("tags") or ["assistant-created"]),
            is_builtin=False,
        )
        session.add(template)
        await session.flush()
        return {"persona_template_id": template.id, "name": template.name}
    if tool_name == "mai_create_phase_template":
        template = PhaseTemplate(
            id=new_id(),
            name=str(arguments.get("name") or "新阶段"),
            description=str(arguments.get("description") or ""),
            allowed_speakers={"type": "all"},
            ordering_rule={"type": "mention_driven"},
            exit_conditions=[{"type": "user_manual"}],
            auto_discuss=bool(arguments.get("auto_discuss") or False),
            role_constraints=str(arguments.get("role_constraints") or ""),
            prompt_template=str(arguments.get("prompt_template") or ""),
            tags=list(arguments.get("tags") or ["assistant-created"]),
            is_builtin=False,
        )
        session.add(template)
        await session.flush()
        return {"phase_template_id": template.id, "name": template.name}
    raise ValueError(f"unsupported builtin tool: {tool_name}")


def external_tool_name(server: ToolServer, tool_name: str) -> str:
    return f"mcp_{server.id.replace('-', '')[:8]}_{_safe_name(tool_name)}"


def original_mcp_tool_name(external_name: str) -> str:
    parts = external_name.split("_", 2)
    return parts[2] if len(parts) == 3 else external_name


def _safe_name(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", name).strip("_") or "tool"


def _tool_message(room_id: str, invocation: ToolInvocation) -> Message:
    return Message(
        room_id=room_id,
        parent_message_id=invocation.parent_message_id,
        message_type="tool_invocation",
        author_actual="system",
        visibility="public",
        visibility_to_models=True,
        content=tool_invocation_content(invocation),
    )


async def _publish_tool_message(room_id: str, message: Message, invocation: ToolInvocation) -> None:
    from .engine import message_to_event
    from .schemas import ToolInvocationOut

    payload = message_to_event(message)
    payload["tool_invocation"] = ToolInvocationOut.model_validate(invocation).model_dump(mode="json")
    await event_bus.publish(room_id, {"type": "message.appended", "message": payload})


async def _list_mcp_tools(server: ToolServer) -> list[dict[str, Any]]:
    async with _mcp_session(server) as client_session:
        tools_result = await client_session.list_tools()
        return [_mcp_tool_to_dict(tool) for tool in tools_result.tools]


async def _call_mcp_tool(server: ToolServer, tool_name: str, arguments: dict[str, Any]) -> Any:
    async with _mcp_session(server) as client_session:
        result = await client_session.call_tool(tool_name, arguments=arguments)
        return _mcp_result_to_json(result)


def _mcp_tool_to_dict(tool: Any) -> dict[str, Any]:
    return {
        "name": getattr(tool, "name", None) or _read_dict(tool, "name"),
        "title": getattr(tool, "title", None) or _read_dict(tool, "title"),
        "description": getattr(tool, "description", None) or _read_dict(tool, "description") or "",
        "inputSchema": getattr(tool, "inputSchema", None) or _read_dict(tool, "inputSchema") or JSON_OBJECT_SCHEMA,
    }


def _mcp_result_to_json(result: Any) -> dict[str, Any]:
    structured = getattr(result, "structuredContent", None) or _read_dict(result, "structuredContent")
    content = getattr(result, "content", None) or _read_dict(result, "content") or []
    return {
        "structured": structured,
        "content": [_content_block_to_json(item) for item in content],
    }


def _content_block_to_json(item: Any) -> dict[str, Any]:
    item_type = getattr(item, "type", None) or _read_dict(item, "type") or "unknown"
    payload: dict[str, Any] = {"type": item_type}
    for key in ["text", "mimeType", "data", "uri", "name"]:
        value = getattr(item, key, None) or _read_dict(item, key)
        if value is not None:
            payload[key] = str(value)
    return payload


def _read_dict(value: Any, key: str) -> Any:
    return value.get(key) if isinstance(value, dict) else None


class _mcp_session:
    def __init__(self, server: ToolServer):
        self.server = server
        self._transport_cm: Any = None
        self._session_cm: Any = None
        self._session: Any = None

    async def __aenter__(self) -> Any:
        if not self.server.url:
            raise ValueError("MCP server URL is required")
        try:
            from mcp import ClientSession
            if self.server.transport == "sse":
                from mcp.client.sse import sse_client

                self._transport_cm = sse_client(self.server.url)
            else:
                from mcp.client.streamable_http import streamable_http_client

                self._transport_cm = streamable_http_client(self.server.url)
        except ImportError as exc:
            raise RuntimeError("Python MCP SDK is not installed. Run pip install -r requirements.txt.") from exc

        streams = await self._transport_cm.__aenter__()
        read_stream, write_stream = streams[0], streams[1]
        self._session_cm = ClientSession(read_stream, write_stream)
        self._session = await self._session_cm.__aenter__()
        await self._session.initialize()
        return self._session

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if self._session_cm is not None:
            await self._session_cm.__aexit__(exc_type, exc, tb)
        if self._transport_cm is not None:
            await self._transport_cm.__aexit__(exc_type, exc, tb)
