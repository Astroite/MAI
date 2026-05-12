"""Read-only Scene Context Builder API coverage."""

from datetime import datetime, timezone

from app import engine as engine_module
from app.llm import llm_adapter
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
    assert "[Behavior Contract]" in prompt
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
    assert "未被点名时可以简短观察或沉默" in prompt
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
