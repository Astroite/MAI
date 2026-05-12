"""Read-only Scene Context Builder API coverage."""


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
