"""Read-only Scene Context Builder API coverage."""

import asyncio
from datetime import datetime, timezone

from sqlalchemy import select

from app.db import SessionLocal
from app import engine as engine_module
from app.llm import llm_adapter
from app.models import Message, PersonaInstance, Room, RoomRuntimeState
from app.scene_context import compose_scene_runtime_context_prompt
from app.schemas import (
    SceneContextOut,
    SceneMemoryCueOut,
    SceneRelationshipCueOut,
    SceneSpeakerContextOut,
    SceneStageCharacterOut,
    SceneStageContextOut,
    SceneTranscriptVisibilityPreviewOut,
    SceneWorldBibleCompactOut,
)


def _make_world(client) -> dict:
    return client.post(
        "/worlds",
        json={
            "name": "pytest scene context world",
            "synopsis": "默认简介",
            "setting": "默认背景",
        },
    ).json()


def _make_ai_character(
    client,
    world_id: str,
    persona_template_id: str,
    name: str,
    identity: str = "旅人",
) -> dict:
    return client.post(
        f"/worlds/{world_id}/characters",
        json={
            "kind": "ai",
            "name": name,
            "identity": identity,
            "persona_template_id": persona_template_id,
            "core_identity": f"{name} 的核心身份。",
        },
    ).json()


def _make_user_character(client, world_id: str, name: str = "玩家角色") -> dict:
    return client.post(
        f"/worlds/{world_id}/characters",
        json={"kind": "user", "name": name, "brief": "由用户扮演"},
    ).json()


def _scene_persona_id(state: dict, world_character_id: str) -> str:
    for persona in state["personas"]:
        if persona["world_character_id"] == world_character_id:
            return persona["id"]
    raise AssertionError(f"no PersonaInstance bound to {world_character_id}")


async def _insert_visible_message(
    room_id: str,
    content: str,
    *,
    message_type: str = "speech",
    author_actual: str = "user",
    author_persona_id: str | None = None,
    created_at: datetime | None = None,
) -> str:
    async with SessionLocal() as session:
        runtime = await session.get(RoomRuntimeState, room_id)
        message = Message(
            room_id=room_id,
            phase_instance_id=runtime.current_phase_instance_id if runtime else None,
            message_type=message_type,
            author_actual=author_actual,
            author_persona_id=author_persona_id,
            visibility="public",
            visibility_to_models=True,
            content=content,
            created_at=created_at or datetime.now(timezone.utc),
        )
        session.add(message)
        await session.commit()
        return message.id


async def _visible_contents_for_speaker(room_id: str, speaker_persona_id: str) -> list[str]:
    async with SessionLocal() as session:
        room = await session.get(Room, room_id)
        speaker = await session.get(PersonaInstance, speaker_persona_id)
        assert room is not None
        assert speaker is not None
        messages = list(
            (
                await session.scalars(
                    select(Message)
                    .where(Message.room_id == room_id, Message.visibility_to_models.is_(True))
                    .order_by(Message.created_at)
                )
            ).all()
        )
        visible = await engine_module.visible_messages_for_scene_speaker(
            session,
            room,
            speaker,
            messages,
        )
        return [message.content for message in visible]


async def _clone_unbound_scene_persona(
    room_id: str,
    source_persona_id: str,
    *,
    world_character_id: str | None,
    name: str,
) -> str:
    async with SessionLocal() as session:
        source = await session.get(PersonaInstance, source_persona_id)
        assert source is not None
        clone = PersonaInstance(
            room_id=room_id,
            template_id=source.template_id,
            template_version=source.template_version,
            position=99,
            kind="discussant",
            name=name,
            identity=source.identity,
            description=source.description,
            backing_model=source.backing_model,
            api_provider_id=source.api_provider_id,
            api_model_id=source.api_model_id,
            system_prompt=source.system_prompt,
            temperature=source.temperature,
            talkativeness=source.talkativeness,
            color=source.color,
            icon=source.icon,
            config=dict(source.config or {}),
            tags=list(source.tags or []),
            world_character_id=world_character_id,
        )
        session.add(clone)
        await session.commit()
        return clone.id


def _make_context_scene(client, discussant_personas):
    world = _make_world(client)
    world_id = world["id"]
    template = discussant_personas[0]
    speaker = _make_ai_character(client, world_id, template["id"], "苏离", "剑客")
    active_peer = _make_ai_character(client, world_id, template["id"], "阿照", "医者")
    exited_peer = _make_ai_character(client, world_id, template["id"], "洛衡", "旧友")
    scene = client.post(
        f"/worlds/{world_id}/scenes",
        json={
            "title": "第一幕：边城客栈",
            "background": "雪停后，三人在客栈后院碰面。",
            "in_world_time_start": "永熙三年冬 初七",
            "members": [
                {"world_character_id": speaker["id"], "role_in_scene": "追查者"},
                {"world_character_id": active_peer["id"], "role_in_scene": "同行者"},
                {"world_character_id": exited_peer["id"], "role_in_scene": "传信人"},
            ],
        },
    )
    assert scene.status_code == 200, scene.text
    state = scene.json()
    scene_id = state["room"]["id"]
    exited = client.post(
        f"/rooms/{scene_id}/scene/exit",
        json={"world_character_id": exited_peer["id"]},
    )
    assert exited.status_code == 200, exited.text
    return {
        "world": world,
        "world_id": world_id,
        "scene_id": scene_id,
        "speaker": speaker,
        "active_peer": active_peer,
        "exited_peer": exited_peer,
        "speaker_persona_id": _scene_persona_id(state, speaker["id"]),
    }


def test_scene_context_returns_stage_context_for_scene(client, discussant_personas):
    ctx = _make_context_scene(client, discussant_personas)

    response = client.get(f"/rooms/{ctx['scene_id']}/scene/context")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["room_id"] == ctx["scene_id"]
    assert payload["world"]["id"] == ctx["world_id"]
    assert payload["scene"]["title"] == "第一幕：边城客栈"
    assert payload["scene"]["sealed"] is False
    assert payload["speaker"] is None
    assert {item["name"] for item in payload["stage_characters"]} == {"苏离", "阿照", "洛衡"}
    by_character = {item["world_character_id"]: item for item in payload["stage_characters"]}
    assert by_character[ctx["speaker"]["id"]]["can_speak"] is True
    assert by_character[ctx["exited_peer"]["id"]]["is_present"] is False
    assert by_character[ctx["exited_peer"]["id"]]["can_speak"] is False


def test_scene_context_rejects_regular_discussion_room(
    client, discussant_personas, roundtable_format
):
    room = client.post(
        "/rooms",
        json={
            "title": "普通讨论房",
            "format_id": roundtable_format["id"],
            "persona_ids": [discussant_personas[0]["id"]],
        },
    ).json()

    response = client.get(f"/rooms/{room['room']['id']}/scene/context")

    assert response.status_code == 409
    assert "not a scene" in response.text


def test_visible_messages_filter_leaves_regular_discussion_transcript_unchanged(
    client, discussant_personas, roundtable_format
):
    room = client.post(
        "/rooms",
        json={
            "title": "普通讨论 transcript visibility",
            "format_id": roundtable_format["id"],
            "persona_ids": [discussant_personas[0]["id"]],
        },
    ).json()
    room_id = room["room"]["id"]
    speaker_id = next(
        p["id"] for p in room["personas"] if p["template_id"] == discussant_personas[0]["id"]
    )
    asyncio.run(
        _insert_visible_message(
            room_id,
            "普通讨论第一条",
            created_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
        )
    )
    asyncio.run(
        _insert_visible_message(
            room_id,
            "普通讨论第二条",
            message_type="narration",
            created_at=datetime(2020, 1, 2, tzinfo=timezone.utc),
        )
    )

    contents = asyncio.run(_visible_contents_for_speaker(room_id, speaker_id))

    assert contents[-2:] == ["普通讨论第一条", "普通讨论第二条"]


def test_scene_visible_messages_follow_presence_interval(
    client, discussant_personas
):
    world = _make_world(client)
    template = discussant_personas[0]
    opener = _make_ai_character(client, world["id"], template["id"], "开场者")
    latecomer = _make_ai_character(client, world["id"], template["id"], "迟到者")
    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "Transcript 切片测试",
            "members": [{"world_character_id": opener["id"]}],
        },
    )
    assert scene.status_code == 200, scene.text
    state = scene.json()
    scene_id = state["room"]["id"]
    opener_persona_id = _scene_persona_id(state, opener["id"])

    asyncio.run(
        _insert_visible_message(
            scene_id,
            "开场时所有人能听到的风声。",
            message_type="narration",
            created_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
        )
    )
    enter = client.post(
        f"/rooms/{scene_id}/scene/enter",
        json={
            "world_character_id": latecomer["id"],
            "description": "迟到者推门而入。",
        },
    )
    assert enter.status_code == 200, enter.text
    state_after_enter = client.get(f"/rooms/{scene_id}/state").json()
    late_persona_id = _scene_persona_id(state_after_enter, latecomer["id"])
    asyncio.run(
        _insert_visible_message(
            scene_id,
            "迟到者入场后的旁白。",
            message_type="narration",
        )
    )
    asyncio.run(
        _insert_visible_message(
            scene_id,
            "迟到者入场后的对话。",
            author_actual="ai",
            author_persona_id=opener_persona_id,
        )
    )
    exit_resp = client.post(
        f"/rooms/{scene_id}/scene/exit",
        json={"world_character_id": latecomer["id"], "description": "迟到者离开后院。"},
    )
    assert exit_resp.status_code == 200, exit_resp.text
    asyncio.run(
        _insert_visible_message(
            scene_id,
            "迟到者退场后的秘密。",
            message_type="narration",
            created_at=datetime(2100, 1, 1, tzinfo=timezone.utc),
        )
    )

    opener_contents = asyncio.run(_visible_contents_for_speaker(scene_id, opener_persona_id))
    late_contents = asyncio.run(_visible_contents_for_speaker(scene_id, late_persona_id))

    assert "开场时所有人能听到的风声。" in opener_contents
    assert "迟到者退场后的秘密。" in opener_contents
    assert "开场时所有人能听到的风声。" not in late_contents
    assert "迟到者推门而入。" in late_contents
    assert "迟到者入场后的旁白。" in late_contents
    assert "迟到者入场后的对话。" in late_contents
    assert "迟到者离开后院。" in late_contents
    assert "迟到者退场后的秘密。" not in late_contents


def test_scene_visible_messages_fallback_for_unbound_or_unrostered_speaker(
    client, discussant_personas
):
    world = _make_world(client)
    template = discussant_personas[0]
    on_stage = _make_ai_character(client, world["id"], template["id"], "在场者")
    off_roster = _make_ai_character(client, world["id"], template["id"], "未入场者")
    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "Fallback 切片测试",
            "members": [{"world_character_id": on_stage["id"]}],
        },
    )
    assert scene.status_code == 200, scene.text
    state = scene.json()
    scene_id = state["room"]["id"]
    source_persona_id = _scene_persona_id(state, on_stage["id"])
    unbound_id = asyncio.run(
        _clone_unbound_scene_persona(
            scene_id,
            source_persona_id,
            world_character_id=None,
            name="未绑定 persona",
        )
    )
    unrostered_id = asyncio.run(
        _clone_unbound_scene_persona(
            scene_id,
            source_persona_id,
            world_character_id=off_roster["id"],
            name="不在 roster persona",
        )
    )
    asyncio.run(
        _insert_visible_message(
            scene_id,
            "fallback 应看到的原始消息。",
            created_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
        )
    )

    unbound_contents = asyncio.run(_visible_contents_for_speaker(scene_id, unbound_id))
    unrostered_contents = asyncio.run(_visible_contents_for_speaker(scene_id, unrostered_id))

    assert "fallback 应看到的原始消息。" in unbound_contents
    assert "fallback 应看到的原始消息。" in unrostered_contents


def test_scene_context_world_bible_compact_filters_uncommitted_items(
    client, discussant_personas
):
    ctx = _make_context_scene(client, discussant_personas)
    patch = client.patch(
        f"/worlds/{ctx['world_id']}/bible",
        json={
            "summary": "江湖将乱，旧盟约正在失效。",
            "background": "玄苍门覆灭后二十年，各方势力重回边城。",
            "current_date_label": "永熙三年冬",
            "current_location": "边城客栈",
            "current_arc": {
                "title": "旧盟约",
                "summary": "众人追查盟约破裂原因。",
                "status": "committed",
            },
            "rules": [
                {"id": "rule-1", "title": "不可在城内拔剑", "status": "committed"},
                {"id": "rule-draft", "title": "草稿规则", "status": "draft"},
            ],
            "taboos": [
                {"id": "taboo-1", "title": "不可提旧王名讳"},
                {"id": "taboo-hidden", "title": "隐藏禁忌", "status": "hidden"},
            ],
            "plot_hooks": [
                {"id": "hook-1", "title": "谁烧了密信", "status": "open"},
                {"id": "hook-unconfirmed", "title": "未确认伏笔", "confirmed": False},
            ],
        },
    )
    assert patch.status_code == 200, patch.text

    payload = client.get(f"/rooms/{ctx['scene_id']}/scene/context").json()

    assert payload["world"]["summary"] == "江湖将乱，旧盟约正在失效。"
    assert payload["world"]["background"] == "玄苍门覆灭后二十年，各方势力重回边城。"
    assert payload["world"]["current_date_label"] == "永熙三年冬"
    assert payload["world"]["current_location"] == "边城客栈"
    assert payload["world"]["current_arc"]["title"] == "旧盟约"
    assert [item["id"] for item in payload["world"]["rules"]] == ["rule-1"]
    assert [item["id"] for item in payload["world"]["taboos"]] == ["taboo-1"]
    assert [item["id"] for item in payload["world"]["plot_hooks"]] == ["hook-1"]


def test_scene_context_timeline_only_includes_committed_events(
    client, discussant_personas
):
    ctx = _make_context_scene(client, discussant_personas)
    for title, status in [
        ("已确认旧案", "committed"),
        ("草稿事件", "draft"),
        ("隐藏事件", "hidden"),
    ]:
        response = client.post(
            f"/worlds/{ctx['world_id']}/timeline-events",
            json={"title": title, "status": status},
        )
        assert response.status_code == 200, response.text

    payload = client.get(f"/rooms/{ctx['scene_id']}/scene/context").json()

    assert [event["title"] for event in payload["timeline"]] == ["已确认旧案"]


def test_scene_context_speaker_private_memory_is_only_the_speakers_own(
    client, discussant_personas
):
    ctx = _make_context_scene(client, discussant_personas)
    own = client.post(
        f"/worlds/{ctx['world_id']}/characters/{ctx['speaker']['id']}/memories",
        json={"kind": "backstory", "content": "苏离记得雪夜中的暗号。", "salience": 0.9},
    )
    assert own.status_code == 200, own.text
    other = client.post(
        f"/worlds/{ctx['world_id']}/characters/{ctx['active_peer']['id']}/memories",
        json={"kind": "backstory", "content": "阿照记得另一条线索。", "salience": 0.9},
    )
    assert other.status_code == 200, other.text

    payload = client.get(
        f"/rooms/{ctx['scene_id']}/scene/context",
        params={"speaker_persona_id": ctx["speaker_persona_id"]},
    ).json()

    cues = payload["speaker"]["memory_cues"]
    assert [cue["content"] for cue in cues] == ["苏离记得雪夜中的暗号。"]
    assert cues[0]["source_scene_id"] is None
    assert cues[0]["seal_draft_id"] is None
    assert cues[0]["source"] == "manual"


def test_scene_context_without_speaker_does_not_return_private_memory(
    client, discussant_personas
):
    ctx = _make_context_scene(client, discussant_personas)
    client.post(
        f"/worlds/{ctx['world_id']}/characters/{ctx['speaker']['id']}/memories",
        json={"kind": "backstory", "content": "只应在 speaker context 出现。", "salience": 0.9},
    )

    payload = client.get(f"/rooms/{ctx['scene_id']}/scene/context").json()

    assert payload["speaker"] is None
    assert "只应在 speaker context 出现。" not in str(payload)


def test_scene_context_relationships_are_outgoing_to_active_peers_only(
    client, discussant_personas
):
    ctx = _make_context_scene(client, discussant_personas)
    outgoing_active = client.put(
        f"/worlds/{ctx['world_id']}/characters/{ctx['speaker']['id']}/relations/{ctx['active_peer']['id']}",
        json={"label": "盟友", "sentiment": 0.6, "notes": "苏离信任阿照。"},
    )
    assert outgoing_active.status_code == 200, outgoing_active.text
    incoming = client.put(
        f"/worlds/{ctx['world_id']}/characters/{ctx['active_peer']['id']}/relations/{ctx['speaker']['id']}",
        json={"label": "病人", "sentiment": 0.2, "notes": "阿照担心苏离。"},
    )
    assert incoming.status_code == 200, incoming.text
    outgoing_exited = client.put(
        f"/worlds/{ctx['world_id']}/characters/{ctx['speaker']['id']}/relations/{ctx['exited_peer']['id']}",
        json={"label": "旧友", "sentiment": -0.1, "notes": "洛衡已经离场。"},
    )
    assert outgoing_exited.status_code == 200, outgoing_exited.text

    payload = client.get(
        f"/rooms/{ctx['scene_id']}/scene/context",
        params={"speaker_persona_id": ctx["speaker_persona_id"]},
    ).json()

    cues = payload["speaker"]["relationship_cues"]
    assert [(cue["to_character_id"], cue["label"]) for cue in cues] == [
        (ctx["active_peer"]["id"], "盟友")
    ]
    assert cues[0]["from_character_id"] == ctx["speaker"]["id"]
    assert cues[0]["to_character_name"] == "阿照"


def test_scene_context_old_scene_without_roster_is_stable(client):
    world = _make_world(client)
    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={"title": "空名册旧场景", "members": []},
    )
    assert scene.status_code == 200, scene.text
    state = scene.json()
    scene_id = state["room"]["id"]
    system_persona_id = next(p["id"] for p in state["personas"] if p["kind"] == "scribe")

    payload = client.get(f"/rooms/{scene_id}/scene/context").json()
    speaker_payload = client.get(
        f"/rooms/{scene_id}/scene/context",
        params={"speaker_persona_id": system_persona_id},
    ).json()

    assert payload["stage_characters"] == []
    assert payload["speaker"] is None
    assert speaker_payload["speaker"]["memory_cues"] == []
    assert speaker_payload["speaker"]["relationship_cues"] == []
    assert any(
        "not bound to a WorldCharacter" in note
        for note in speaker_payload["speaker"]["visibility"]["notes"]
    )


def test_as_character_id_requires_speak_as_user_enabled(client, discussant_personas):
    world = _make_world(client)
    user_character = _make_user_character(client, world["id"], name="柳青")
    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "禁止扮演测试",
            "members": [
                {"world_character_id": user_character["id"], "speak_as_user": False}
            ],
        },
    )
    assert scene.status_code == 200, scene.text
    scene_id = scene.json()["room"]["id"]

    response = client.post(
        f"/rooms/{scene_id}/messages",
        json={"content": "我不能越权发言。", "as_character_id": user_character["id"]},
    )

    assert response.status_code == 422
    assert "not enabled for user speech" in response.text


def test_as_character_id_rejects_exited_user_character(client, discussant_personas):
    world = _make_world(client)
    user_character = _make_user_character(client, world["id"], name="柳青")
    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "退场扮演测试",
            "members": [
                {"world_character_id": user_character["id"], "speak_as_user": True}
            ],
        },
    )
    assert scene.status_code == 200, scene.text
    scene_id = scene.json()["room"]["id"]
    exit_resp = client.post(
        f"/rooms/{scene_id}/scene/exit",
        json={"world_character_id": user_character["id"]},
    )
    assert exit_resp.status_code == 200, exit_resp.text

    response = client.post(
        f"/rooms/{scene_id}/messages",
        json={"content": "我已经离场。", "as_character_id": user_character["id"]},
    )

    assert response.status_code == 422
    assert "not currently on this scene's roster" in response.text


def test_scene_runtime_context_prompt_composer_keeps_private_boundaries():
    now = datetime.now(timezone.utc)
    context = SceneContextOut(
        room_id="scene-1",
        world=SceneWorldBibleCompactOut(
            id="world-1",
            name="玄苍世界",
            summary="江湖将乱。",
            background="边城风雪未停。",
            current_date_label="永熙三年冬",
            current_location="边城客栈",
            current_arc={"title": "旧盟约", "summary": "追查盟约破裂原因。"},
            rules=[{"id": "rule-1", "title": "不可在城内拔剑"}],
            plot_hooks=[{"id": "hook-1", "title": "谁烧了密信"}],
        ),
        scene=SceneStageContextOut(
            id="scene-1",
            scene_index=2,
            title="雪夜重逢",
            background="后院无人，灯笼微亮。",
        ),
        stage_characters=[
            SceneStageCharacterOut(
                world_character_id="char-a",
                persona_instance_id="persona-a",
                name="苏离",
                kind="ai",
                joined_at=now,
            ),
            SceneStageCharacterOut(
                world_character_id="char-b",
                persona_instance_id="persona-b",
                name="阿照",
                kind="ai",
                joined_at=now,
            ),
        ],
        speaker=SceneSpeakerContextOut(
            persona_instance_id="persona-a",
            world_character_id="char-a",
            name="苏离",
            memory_cues=[
                SceneMemoryCueOut(
                    id="memory-a",
                    world_character_id="char-a",
                    kind="backstory",
                    content="苏离记得雪夜中的暗号。",
                    created_at=now,
                )
            ],
            relationship_cues=[
                SceneRelationshipCueOut(
                    id="relation-a-b",
                    from_character_id="char-a",
                    to_character_id="char-b",
                    to_character_name="阿照",
                    label="盟友",
                    sentiment=0.6,
                    notes="苏离信任阿照。",
                    updated_at=now,
                )
            ],
            visibility=SceneTranscriptVisibilityPreviewOut(
                visible_message_count=3,
                notes=["speaker is visible from scene open"],
            ),
        ),
    )

    prompt = compose_scene_runtime_context_prompt(context)

    assert "[World State]" in prompt
    assert "[Stage State]" in prompt
    assert "[Your Private Context]" in prompt
    assert "[Behavior Contract / 角色行为契约]" in prompt
    assert "永熙三年冬" in prompt
    assert "边城客栈" in prompt
    assert "旧盟约" in prompt
    assert "苏离记得雪夜中的暗号" in prompt
    assert "苏离信任阿照" in prompt
    assert "只扮演自己" in prompt
    assert "不代替其他角色说话或行动" in prompt
    assert "不做全知旁白" in prompt
    assert "只依据可见上下文" in prompt
    assert "不知道的信息就表现为不知道" in prompt
    assert "如果被点名" in prompt
    assert "优先回应点名意图" in prompt
    assert "未被点名时可以简短观察或沉默" in prompt
    assert "导演指令是临时指导" in prompt
    assert "not a story fact" in prompt
    assert "Play only yourself" in prompt
    assert "Do not speak or act for other characters" in prompt
    assert "peer -> speaker" not in prompt


def test_discussion_room_turn_does_not_pass_scene_context(
    client, discussant_personas, monkeypatch
):
    captured: list[str] = []

    async def capture_stream(
        persona,
        context,
        phase,
        max_tokens,
        scribe_state=None,
        api_provider=None,
        **kwargs,
    ):
        captured.append(kwargs.get("scene_context_prompt", "missing"))
        yield type("Chunk", (), {"text": "普通讨论回复", "index": 0})()

    monkeypatch.setattr(llm_adapter, "stream", capture_stream)
    monkeypatch.setattr(engine_module.llm_adapter, "stream", capture_stream)
    room = client.post(
        "/rooms",
        json={"title": "普通讨论 runtime context 测试", "persona_ids": [discussant_personas[0]["id"]]},
    ).json()
    speaker_id = next(p["id"] for p in room["personas"] if p["template_id"] == discussant_personas[0]["id"])

    response = client.post(f"/rooms/{room['room']['id']}/turn", json={"speaker_persona_id": speaker_id})

    assert response.status_code == 200, response.text
    assert captured == [""]


def test_scene_ai_turn_calls_builder_and_passes_runtime_context_prompt(
    client, discussant_personas, monkeypatch
):
    ctx = _make_context_scene(client, discussant_personas)
    world_id = ctx["world_id"]
    speaker = ctx["speaker"]
    active_peer = ctx["active_peer"]
    patch = client.patch(
        f"/worlds/{world_id}/bible",
        json={
            "summary": "江湖将乱，旧盟约正在失效。",
            "background": "玄苍门覆灭后二十年，各方势力重回边城。",
            "current_date_label": "永熙三年冬",
            "current_location": "边城客栈",
            "current_arc": {"title": "旧盟约", "summary": "追查盟约破裂原因。"},
        },
    )
    assert patch.status_code == 200, patch.text
    client.post(
        f"/worlds/{world_id}/characters/{speaker['id']}/memories",
        json={"kind": "backstory", "content": "苏离记得雪夜中的暗号。", "salience": 0.9},
    )
    client.post(
        f"/worlds/{world_id}/characters/{active_peer['id']}/memories",
        json={"kind": "backstory", "content": "阿照记得另一条线索。", "salience": 0.9},
    )
    client.put(
        f"/worlds/{world_id}/characters/{speaker['id']}/relations/{active_peer['id']}",
        json={"label": "盟友", "sentiment": 0.6, "notes": "苏离信任阿照。"},
    )
    client.put(
        f"/worlds/{world_id}/characters/{active_peer['id']}/relations/{speaker['id']}",
        json={"label": "病人", "sentiment": 0.2, "notes": "阿照担心苏离。"},
    )

    original_builder = engine_module.build_scene_context
    calls: list[str | None] = []
    captured: list[str] = []

    async def counting_builder(session, scene, speaker_persona_id=None):
        calls.append(speaker_persona_id)
        return await original_builder(session, scene, speaker_persona_id=speaker_persona_id)

    async def capture_stream(
        persona,
        context,
        phase,
        max_tokens,
        scribe_state=None,
        api_provider=None,
        **kwargs,
    ):
        captured.append(kwargs.get("scene_context_prompt", ""))
        yield type("Chunk", (), {"text": "场景回复", "index": 0})()

    monkeypatch.setattr(engine_module, "build_scene_context", counting_builder)
    monkeypatch.setattr(llm_adapter, "stream", capture_stream)
    monkeypatch.setattr(engine_module.llm_adapter, "stream", capture_stream)

    response = client.post(
        f"/rooms/{ctx['scene_id']}/turn",
        json={"speaker_persona_id": ctx["speaker_persona_id"]},
    )

    assert response.status_code == 200, response.text
    assert calls == [ctx["speaker_persona_id"]]
    assert len(captured) == 1
    prompt = captured[0]
    assert "永熙三年冬" in prompt
    assert "边城客栈" in prompt
    assert "旧盟约" in prompt
    assert "苏离记得雪夜中的暗号" in prompt
    assert "阿照记得另一条线索" not in prompt
    assert "苏离信任阿照" in prompt
    assert "阿照担心苏离" not in prompt


def test_scene_ai_turn_uses_filtered_transcript_for_late_speaker(
    client, discussant_personas, monkeypatch
):
    world = _make_world(client)
    template = discussant_personas[0]
    opener = _make_ai_character(client, world["id"], template["id"], "开场者")
    latecomer = _make_ai_character(client, world["id"], template["id"], "迟到者")
    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "runtime transcript 切片",
            "members": [{"world_character_id": opener["id"]}],
        },
    )
    assert scene.status_code == 200, scene.text
    scene_id = scene.json()["room"]["id"]
    asyncio.run(
        _insert_visible_message(
            scene_id,
            "迟到者不该知道的开场暗号。",
            message_type="narration",
            created_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
        )
    )
    enter = client.post(
        f"/rooms/{scene_id}/scene/enter",
        json={
            "world_character_id": latecomer["id"],
            "description": "迟到者推门而入。",
        },
    )
    assert enter.status_code == 200, enter.text
    state = client.get(f"/rooms/{scene_id}/state").json()
    late_persona_id = _scene_persona_id(state, latecomer["id"])
    asyncio.run(
        _insert_visible_message(
            scene_id,
            "迟到者可以听见的旁白。",
            message_type="narration",
        )
    )
    captured_context: list[list[str]] = []
    captured_prompts: list[str] = []

    async def capture_stream(
        persona,
        context,
        phase,
        max_tokens,
        scribe_state=None,
        api_provider=None,
        **kwargs,
    ):
        captured_context.append([message.content for message in context])
        captured_prompts.append(kwargs.get("scene_context_prompt", ""))
        yield type("Chunk", (), {"text": "迟到者回应", "index": 0})()

    monkeypatch.setattr(llm_adapter, "stream", capture_stream)
    monkeypatch.setattr(engine_module.llm_adapter, "stream", capture_stream)

    response = client.post(
        f"/rooms/{scene_id}/turn",
        json={"speaker_persona_id": late_persona_id},
    )

    assert response.status_code == 200, response.text
    assert response.json()[0]["content"] == "迟到者回应"
    assert captured_context
    assert "迟到者不该知道的开场暗号。" not in captured_context[0]
    assert "迟到者推门而入。" in captured_context[0]
    assert "迟到者可以听见的旁白。" in captured_context[0]
    assert captured_prompts[0]


def test_scene_runtime_context_failure_falls_back_to_legacy_prompt(
    client, discussant_personas, monkeypatch
):
    ctx = _make_context_scene(client, discussant_personas)
    captured: list[str] = []

    async def failing_builder(session, scene, speaker_persona_id=None):
        raise RuntimeError("pytest forced context failure")

    async def capture_stream(
        persona,
        context,
        phase,
        max_tokens,
        scribe_state=None,
        api_provider=None,
        **kwargs,
    ):
        captured.append(kwargs.get("scene_context_prompt", "missing"))
        yield type("Chunk", (), {"text": "fallback ok", "index": 0})()

    monkeypatch.setattr(engine_module, "build_scene_context", failing_builder)
    monkeypatch.setattr(llm_adapter, "stream", capture_stream)
    monkeypatch.setattr(engine_module.llm_adapter, "stream", capture_stream)

    response = client.post(
        f"/rooms/{ctx['scene_id']}/turn",
        json={"speaker_persona_id": ctx["speaker_persona_id"]},
    )

    assert response.status_code == 200, response.text
    assert captured == [""]
    assert response.json()[0]["content"] == "fallback ok"


def test_ephemeral_director_instruction_prompt_contract():
    prompt = engine_module.append_ephemeral_director_instruction(
        "Scene facts stay above.",
        "隐瞒密信下落，含糊回应。",
    )

    assert "【临时导演指令 / Ephemeral Director Instruction】" in prompt
    assert "隐瞒密信下落，含糊回应。" in prompt
    assert "不是故事事实" in prompt
    assert "not a fact in the story world" in prompt
    assert "only play yourself" in prompt


def test_scene_turn_injects_ephemeral_director_instruction_for_specified_speaker(
    client, discussant_personas, monkeypatch
):
    ctx = _make_context_scene(client, discussant_personas)
    instruction = "隐瞒自己知道密信下落这件事，含糊回应阿照。"
    captured: list[str] = []

    async def capture_stream(
        persona,
        context,
        phase,
        max_tokens,
        scribe_state=None,
        api_provider=None,
        **kwargs,
    ):
        captured.append(kwargs.get("scene_context_prompt", "missing"))
        yield type("Chunk", (), {"text": "我还需要再确认。", "index": 0})()

    monkeypatch.setattr(llm_adapter, "stream", capture_stream)
    monkeypatch.setattr(engine_module.llm_adapter, "stream", capture_stream)
    before_messages = client.get(f"/rooms/{ctx['scene_id']}/state").json()["messages"]

    response = client.post(
        f"/rooms/{ctx['scene_id']}/turn",
        json={
            "speaker_persona_id": ctx["speaker_persona_id"],
            "director_instruction": instruction,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()[0]["content"] == "我还需要再确认。"
    assert captured
    prompt = captured[0]
    assert "【临时导演指令 / Ephemeral Director Instruction】" in prompt
    assert instruction in prompt
    assert "不是故事事实" in prompt
    assert "not a fact in the story world" in prompt
    after_messages = client.get(f"/rooms/{ctx['scene_id']}/state").json()["messages"]
    assert len(after_messages) == len(before_messages) + 1
    assert all(message["content"] != instruction for message in after_messages)


def test_scene_next_beat_injects_ephemeral_director_instruction(
    client, discussant_personas, monkeypatch
):
    ctx = _make_context_scene(client, discussant_personas)
    instruction = "下一拍让在场角色压低声音，不要暴露密信。"
    captured: list[str] = []

    async def capture_stream(
        persona,
        context,
        phase,
        max_tokens,
        scribe_state=None,
        api_provider=None,
        **kwargs,
    ):
        captured.append(kwargs.get("scene_context_prompt", "missing"))
        yield type("Chunk", (), {"text": "风声里，有人放低了声音。", "index": 0})()

    monkeypatch.setattr(llm_adapter, "stream", capture_stream)
    monkeypatch.setattr(engine_module.llm_adapter, "stream", capture_stream)

    response = client.post(
        f"/rooms/{ctx['scene_id']}/turn",
        json={"director_instruction": instruction},
    )

    assert response.status_code == 200, response.text
    assert response.json()[0]["content"] == "风声里，有人放低了声音。"
    assert captured
    assert instruction in captured[0]
    assert "Ephemeral Director Instruction" in captured[0]


def test_discussion_room_ignores_ephemeral_director_instruction(
    client, discussant_personas, monkeypatch
):
    captured: list[str] = []

    async def capture_stream(
        persona,
        context,
        phase,
        max_tokens,
        scribe_state=None,
        api_provider=None,
        **kwargs,
    ):
        captured.append(kwargs.get("scene_context_prompt", "missing"))
        yield type("Chunk", (), {"text": "普通讨论回复", "index": 0})()

    monkeypatch.setattr(llm_adapter, "stream", capture_stream)
    monkeypatch.setattr(engine_module.llm_adapter, "stream", capture_stream)
    room = client.post(
        "/rooms",
        json={"title": "普通讨论导演指令忽略测试", "persona_ids": [discussant_personas[0]["id"]]},
    ).json()
    speaker_id = next(p["id"] for p in room["personas"] if p["template_id"] == discussant_personas[0]["id"])

    response = client.post(
        f"/rooms/{room['room']['id']}/turn",
        json={
            "speaker_persona_id": speaker_id,
            "director_instruction": "这段不应进入普通讨论 prompt。",
        },
    )

    assert response.status_code == 200, response.text
    assert captured == [""]
    assert "这段不应进入普通讨论 prompt。" not in response.json()[0]["content"]


def test_context_fallback_keeps_ephemeral_director_instruction(
    client, discussant_personas, monkeypatch
):
    ctx = _make_context_scene(client, discussant_personas)
    instruction = "即使 Scene Context 构建失败，也要保留这次导演意图。"
    captured: list[str] = []

    async def failing_builder(session, scene, speaker_persona_id=None):
        raise RuntimeError("pytest forced context failure")

    async def capture_stream(
        persona,
        context,
        phase,
        max_tokens,
        scribe_state=None,
        api_provider=None,
        **kwargs,
    ):
        captured.append(kwargs.get("scene_context_prompt", "missing"))
        yield type("Chunk", (), {"text": "fallback with director ok", "index": 0})()

    monkeypatch.setattr(engine_module, "build_scene_context", failing_builder)
    monkeypatch.setattr(llm_adapter, "stream", capture_stream)
    monkeypatch.setattr(engine_module.llm_adapter, "stream", capture_stream)

    response = client.post(
        f"/rooms/{ctx['scene_id']}/turn",
        json={
            "speaker_persona_id": ctx["speaker_persona_id"],
            "director_instruction": instruction,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()[0]["content"] == "fallback with director ok"
    assert captured
    assert instruction in captured[0]
    assert "Ephemeral Director Instruction" in captured[0]


def test_runtime_context_does_not_break_seal_draft_commit(client):
    world = _make_world(client)
    user_character = _make_user_character(client, world["id"], name="柳青")
    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "封幕保持测试",
            "members": [{"world_character_id": user_character["id"], "speak_as_user": True}],
        },
    )
    assert scene.status_code == 200, scene.text
    scene_id = scene.json()["room"]["id"]

    draft = client.post(f"/rooms/{scene_id}/seal")
    assert draft.status_code == 200, draft.text
    committed = client.post(f"/rooms/{scene_id}/seal-drafts/{draft.json()['id']}/commit")

    assert committed.status_code == 200, committed.text
    assert committed.json()["scene"]["sealed_at"] is not None


def test_exited_scene_ai_is_not_picked_by_scheduler(client, discussant_personas):
    world = _make_world(client)
    template = discussant_personas[0]
    active = _make_ai_character(client, world["id"], template["id"], "在场 AI")
    exited = _make_ai_character(client, world["id"], template["id"], "退场 AI")
    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "退场调度保护",
            "members": [
                {"world_character_id": active["id"]},
                {"world_character_id": exited["id"]},
            ],
        },
    )
    assert scene.status_code == 200, scene.text
    state = scene.json()
    scene_id = state["room"]["id"]
    active_persona_id = _scene_persona_id(state, active["id"])
    exited_persona_id = _scene_persona_id(state, exited["id"])
    exit_resp = client.post(
        f"/rooms/{scene_id}/scene/exit",
        json={"world_character_id": exited["id"]},
    )
    assert exit_resp.status_code == 200, exit_resp.text

    async def pick():
        async with SessionLocal() as session:
            room = await session.get(Room, scene_id)
            runtime = await session.get(RoomRuntimeState, scene_id)
            assert room is not None
            assert runtime is not None
            return await engine_module.pick_next_speaker(session, room, runtime, None)

    result = asyncio.run(pick())

    assert result.kind == "single"
    assert result.persona_ids == [active_persona_id]
    assert exited_persona_id not in result.persona_ids


def test_behavior_contract_contains_all_required_rules():
    """Snapshot test: the behavior contract must include every rule from
    the P1.6 spec. Update this list when the contract changes."""
    minimal_context = SceneContextOut(
        room_id="snap-1",
        world=SceneWorldBibleCompactOut(
            id="w1",
            name="Test",
            summary="",
            background="",
            current_date_label="",
            current_location="",
        ),
        scene=SceneStageContextOut(id="snap-1", title="T"),
        stage_characters=[],
    )
    prompt = compose_scene_runtime_context_prompt(minimal_context)

    required_rules = [
        "只扮演自己",
        "不代替其他角色说话或行动",
        "不做全知旁白",
        "只依据可见上下文",
        "不知道的信息就表现为不知道",
        "如果被点名",
        "优先回应点名意图",
        "未被点名时可以简短观察或沉默",
        "导演指令是临时指导",
        "not a story fact",
        "Play only yourself",
        "Do not speak or act for other characters",
    ]
    for rule in required_rules:
        assert rule in prompt, f"Behavior contract missing rule: {rule}"


def test_director_instruction_does_not_leak_into_seal_draft(
    client, discussant_personas, monkeypatch
):
    """Director instruction is ephemeral: it must not appear in the seal
    draft payload, memory updates, or relationship updates."""
    ctx = _make_context_scene(client, discussant_personas)
    instruction = "让苏离隐瞒密信下落。"

    asyncio.run(
        _insert_visible_message(
            ctx["scene_id"],
            "苏离和阿照在后院讨论密信。",
            message_type="narration",
        )
    )

    captured: list[str] = []

    async def capture_stream(
        persona,
        context,
        phase,
        max_tokens,
        scribe_state=None,
        api_provider=None,
        **kwargs,
    ):
        captured.append(kwargs.get("scene_context_prompt", ""))
        yield type("Chunk", (), {"text": "苏离含糊回应。", "index": 0})()

    monkeypatch.setattr(llm_adapter, "stream", capture_stream)
    monkeypatch.setattr(engine_module.llm_adapter, "stream", capture_stream)

    turn = client.post(
        f"/rooms/{ctx['scene_id']}/turn",
        json={
            "speaker_persona_id": ctx["speaker_persona_id"],
            "director_instruction": instruction,
        },
    )
    assert turn.status_code == 200, turn.text
    assert instruction in captured[0]

    state = client.get(f"/rooms/{ctx['scene_id']}/state").json()
    assert all(instruction not in m["content"] for m in state["messages"])

    draft = client.post(f"/rooms/{ctx['scene_id']}/seal")
    assert draft.status_code == 200, draft.text
    draft_text = str(draft.json())
    assert instruction not in draft_text


def test_discussion_room_turn_does_not_include_behavior_contract(
    client, discussant_personas, monkeypatch
):
    captured: list[str] = []

    async def capture_stream(
        persona,
        context,
        phase,
        max_tokens,
        scribe_state=None,
        api_provider=None,
        **kwargs,
    ):
        captured.append(kwargs.get("scene_context_prompt", "missing"))
        yield type("Chunk", (), {"text": "普通讨论回复", "index": 0})()

    monkeypatch.setattr(llm_adapter, "stream", capture_stream)
    monkeypatch.setattr(engine_module.llm_adapter, "stream", capture_stream)

    room = client.post(
        "/rooms",
        json={
            "title": "普通讨论行为契约隔离测试",
            "persona_ids": [discussant_personas[0]["id"]],
        },
    ).json()
    speaker_id = next(
        p["id"]
        for p in room["personas"]
        if p["template_id"] == discussant_personas[0]["id"]
    )

    response = client.post(
        f"/rooms/{room['room']['id']}/turn",
        json={"speaker_persona_id": speaker_id},
    )

    assert response.status_code == 200, response.text
    assert captured == [""]
