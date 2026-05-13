"""CRUD + roster behavior for Story World scenes (Rooms with world_id set).

These tests intentionally avoid actually driving the LLM — they exercise scene
creation, timeline ordering, enter/exit append-only audit, and seal semantics.
The persona-prompt baking is asserted by reading the resulting PersonaInstance,
not by running a turn.
"""

from app import engine as engine_module
from app import main as main_module
from app.engine import DrainResult
from app.runtime_defaults import (
    SCENE_DEFAULT_MAX_ACCOUNT_DAILY_TOKENS,
    SCENE_DEFAULT_MAX_ACCOUNT_MONTHLY_TOKENS,
    SCENE_DEFAULT_MAX_CONSECUTIVE_AI_TURNS,
    SCENE_DEFAULT_MAX_MESSAGE_TOKENS,
    SCENE_DEFAULT_MAX_PHASE_ROUNDS,
    SCENE_DEFAULT_MAX_ROOM_TOKENS,
)


def _make_world(client) -> dict:
    created = client.post("/worlds", json={"name": "pytest scene world", "synopsis": "测试场景的世界"}).json()
    return created


def _make_ai_character(client, world_id: str, persona_template_id: str, name: str = "苏离") -> dict:
    return client.post(
        f"/worlds/{world_id}/characters",
        json={
            "kind": "ai",
            "name": name,
            "identity": "剑客",
            "persona_template_id": persona_template_id,
            "core_identity": "沉默寡言。",
            "skills_text": "剑术",
            "goals_text": "查清师门之变",
        },
    ).json()


def _make_user_character(client, world_id: str, name: str = "无名旅人") -> dict:
    return client.post(
        f"/worlds/{world_id}/characters",
        json={"kind": "user", "name": name, "brief": "由玩家扮演"},
    ).json()


def test_scene_create_assigns_monotonic_index_and_bakes_prompt(
    client, discussant_personas
):
    world = _make_world(client)
    template = discussant_personas[0]
    ai_char = _make_ai_character(client, world["id"], template["id"])
    user_char = _make_user_character(client, world["id"])

    # Scene 1
    scene_1 = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "第一幕：相遇",
            "background": "酒馆角落，烛光摇曳。",
            "in_world_time_start": "玄苍纪元第七日 黄昏",
            "in_world_duration_hint": "约半个时辰",
            "members": [
                {"world_character_id": ai_char["id"], "role_in_scene": "独坐角落"},
                {"world_character_id": user_char["id"], "speak_as_user": True},
            ],
        },
    )
    assert scene_1.status_code == 200, scene_1.text
    state_1 = scene_1.json()
    assert state_1["room"]["world_id"] == world["id"]
    assert state_1["room"]["scene_index"] == 1
    assert state_1["room"]["in_world_time_start"] == "玄苍纪元第七日 黄昏"
    assert state_1["room"]["sealed_at"] is None
    assert state_1["runtime"]["max_message_tokens"] == SCENE_DEFAULT_MAX_MESSAGE_TOKENS
    assert state_1["runtime"]["max_room_tokens"] == SCENE_DEFAULT_MAX_ROOM_TOKENS
    assert state_1["runtime"]["max_phase_rounds"] == SCENE_DEFAULT_MAX_PHASE_ROUNDS
    assert state_1["runtime"]["max_account_daily_tokens"] == SCENE_DEFAULT_MAX_ACCOUNT_DAILY_TOKENS
    assert state_1["runtime"]["max_account_monthly_tokens"] == SCENE_DEFAULT_MAX_ACCOUNT_MONTHLY_TOKENS
    assert state_1["runtime"]["max_consecutive_ai_turns"] == SCENE_DEFAULT_MAX_CONSECUTIVE_AI_TURNS

    # PersonaInstance for the AI character carries the WorldCharacter's
    # name/identity (not the template's) and the prompt got baked.
    discussants = [p for p in state_1["personas"] if p["kind"] == "discussant"]
    assert len(discussants) == 1, "user character must NOT spawn a PersonaInstance"
    persona = discussants[0]
    assert persona["name"] == "苏离"
    assert persona["identity"] == "剑客"
    assert persona["world_character_id"] == ai_char["id"]
    assert "苏离" in persona["system_prompt"]
    assert "玄苍纪元第七日 黄昏" in persona["system_prompt"]
    assert "酒馆角落" in persona["system_prompt"]
    assert world["synopsis"] in persona["system_prompt"]

    # Scene 2: index advances monotonically.
    scene_2 = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "第二幕：追凶",
            "members": [{"world_character_id": ai_char["id"]}],
        },
    ).json()
    assert scene_2["room"]["scene_index"] == 2

    # Timeline returns scenes in scene_index order with member/message counts.
    timeline = client.get(f"/worlds/{world['id']}/timeline").json()
    assert [s["scene_index"] for s in timeline] == [1, 2]
    assert timeline[0]["member_count"] == 2  # ai + user
    assert timeline[1]["member_count"] == 1
    # message_count counts all rows in `messages` (including phase-boundary
    # meta entries the engine writes during scene init); exact value depends
    # on engine internals, just assert it's bounded.
    assert all(s["message_count"] >= 0 for s in timeline)

    # World summary picks up scene_count + last_activity_at.
    summary = next(item for item in client.get("/worlds").json() if item["id"] == world["id"])
    assert summary["scene_count"] == 2
    assert summary["last_activity_at"] is not None


def test_scene_create_rejects_bad_roster(client, discussant_personas):
    world_a = _make_world(client)
    world_b = client.post("/worlds", json={"name": "pytest other world"}).json()
    template = discussant_personas[0]
    char_in_b = _make_ai_character(client, world_b["id"], template["id"], name="跨世界角色")

    # Character belongs to a different world.
    cross = client.post(
        f"/worlds/{world_a['id']}/scenes",
        json={"title": "跨世界 roster", "members": [{"world_character_id": char_in_b["id"]}]},
    )
    assert cross.status_code == 422

    # Duplicate roster entry.
    char_in_a = _make_ai_character(client, world_a["id"], template["id"], name="本世界角色")
    dup = client.post(
        f"/worlds/{world_a['id']}/scenes",
        json={
            "title": "重复 roster",
            "members": [
                {"world_character_id": char_in_a["id"]},
                {"world_character_id": char_in_a["id"]},
            ],
        },
    )
    assert dup.status_code == 422

    # Retired character rejected.
    client.delete(f"/worlds/{world_a['id']}/characters/{char_in_a['id']}")
    retired = client.post(
        f"/worlds/{world_a['id']}/scenes",
        json={"title": "退场 roster", "members": [{"world_character_id": char_in_a["id"]}]},
    )
    assert retired.status_code == 422


def test_scene_enter_and_exit_are_append_only(client, discussant_personas):
    world = _make_world(client)
    template = discussant_personas[0]
    main_char = _make_ai_character(client, world["id"], template["id"], name="主角")
    latecomer = _make_ai_character(client, world["id"], template["id"], name="迟到者")

    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "入场离场测试",
            "members": [{"world_character_id": main_char["id"]}],
        },
    ).json()
    scene_id = scene["room"]["id"]

    # Enter mid-scene with a custom description.
    enter = client.post(
        f"/rooms/{scene_id}/scene/enter",
        json={
            "world_character_id": latecomer["id"],
            "description": "迟到者推门而入，肩上落着雨。",
        },
    )
    assert enter.status_code == 200, enter.text
    enter_member = enter.json()
    assert enter_member["world_character_id"] == latecomer["id"]
    assert enter_member["entered_at_message_id"] is not None
    assert enter_member["exited_at_message_id"] is None

    # The participant.enter message is in the room transcript with the custom text.
    state = client.get(f"/rooms/{scene_id}/state").json()
    enter_messages = [m for m in state["messages"] if m["message_type"] == "participant.enter"]
    assert len(enter_messages) == 1
    assert enter_messages[0]["content"] == "迟到者推门而入，肩上落着雨。"
    assert enter_messages[0]["author_actual"] == "system"
    assert enter_messages[0]["visibility_to_models"] is True

    # PersonaInstance now exists for the latecomer.
    discussants = [p for p in state["personas"] if p["kind"] == "discussant"]
    names = {p["name"] for p in discussants}
    assert names == {"主角", "迟到者"}

    # Cannot enter twice.
    again = client.post(
        f"/rooms/{scene_id}/scene/enter",
        json={"world_character_id": latecomer["id"]},
    )
    assert again.status_code == 409

    # Exit the latecomer with default text.
    exit_resp = client.post(
        f"/rooms/{scene_id}/scene/exit",
        json={"world_character_id": latecomer["id"]},
    )
    assert exit_resp.status_code == 200
    exit_member = exit_resp.json()
    assert exit_member["exited_at_message_id"] is not None

    state = client.get(f"/rooms/{scene_id}/state").json()
    exit_messages = [m for m in state["messages"] if m["message_type"] == "participant.exit"]
    assert len(exit_messages) == 1
    assert "迟到者" in exit_messages[0]["content"]

    # Cannot exit twice.
    twice = client.post(
        f"/rooms/{scene_id}/scene/exit",
        json={"world_character_id": latecomer["id"]},
    )
    assert twice.status_code == 409

    # PersonaInstance stays in the personas list (audit) — engine filters at
    # routing time, not by deletion. Verify via /scene/members which keeps
    # both rows but exit timestamp is set on the latecomer.
    members = client.get(f"/rooms/{scene_id}/scene/members").json()
    by_char = {m["world_character_id"]: m for m in members}
    assert by_char[main_char["id"]]["exited_at_message_id"] is None
    assert by_char[latecomer["id"]]["exited_at_message_id"] is not None


def test_scene_seal_draft_commit_is_idempotent_and_blocks_roster_changes(client, discussant_personas):
    world = _make_world(client)
    template = discussant_personas[0]
    main_char = _make_ai_character(client, world["id"], template["id"])
    extra = _make_ai_character(client, world["id"], template["id"], name="额外的人")

    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={"title": "封幕测试", "members": [{"world_character_id": main_char["id"]}]},
    ).json()
    scene_id = scene["room"]["id"]

    # Seal now creates a reviewable draft first; the Scene is frozen while
    # the draft is under Inspector review so the transcript stays stable.
    draft = client.post(f"/rooms/{scene_id}/seal")
    assert draft.status_code == 200, draft.text
    draft_payload = draft.json()
    assert draft_payload["status"] == "ready"
    assert draft_payload["scene"]["sealed_at"] is None
    assert draft_payload["scene"]["status"] == "frozen"

    message_during_review = client.post(
        f"/rooms/{scene_id}/messages",
        json={"content": "草稿审阅期间不能继续改写本幕。"},
    )
    assert message_during_review.status_code == 409
    unfreeze_during_review = client.post(f"/rooms/{scene_id}/unfreeze")
    assert unfreeze_during_review.status_code == 409

    sealed = client.post(f"/rooms/{scene_id}/seal-drafts/{draft_payload['id']}/commit")
    assert sealed.status_code == 200, sealed.text
    sealed_payload = sealed.json()
    assert sealed_payload["scene"]["sealed_at"] is not None
    assert "scribe_results" in sealed_payload
    first_ts = sealed_payload["scene"]["sealed_at"]

    # Re-committing the same draft is a no-op.
    sealed_again = client.post(f"/rooms/{scene_id}/seal-drafts/{draft_payload['id']}/commit").json()
    assert sealed_again["scene"]["sealed_at"] == first_ts

    # Roster mutations rejected after seal.
    enter = client.post(
        f"/rooms/{scene_id}/scene/enter",
        json={"world_character_id": extra["id"]},
    )
    assert enter.status_code == 409
    exit_resp = client.post(
        f"/rooms/{scene_id}/scene/exit",
        json={"world_character_id": main_char["id"]},
    )
    assert exit_resp.status_code == 409


def test_sealed_scene_room_is_read_only(client):
    world = _make_world(client)
    user_char = _make_user_character(client, world["id"])

    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "只读封幕测试",
            "members": [{"world_character_id": user_char["id"], "speak_as_user": True}],
        },
    ).json()
    scene_id = scene["room"]["id"]

    draft = client.post(f"/rooms/{scene_id}/seal")
    assert draft.status_code == 200, draft.text
    sealed = client.post(f"/rooms/{scene_id}/seal-drafts/{draft.json()['id']}/commit")
    assert sealed.status_code == 200, sealed.text
    assert sealed.json()["scene"]["sealed_at"] is not None

    phase_id = client.get("/templates/phases").json()[0]["id"]
    blocked_requests = [
        ("post", f"/rooms/{scene_id}/messages", {"content": "封幕后不能继续说话"}),
        ("post", f"/rooms/{scene_id}/messages/from_upload", {"upload_id": "missing"}),
        ("post", f"/rooms/{scene_id}/verdicts", {"content": "封幕后不能裁决", "is_locked": False, "dead_end": False}),
        ("post", f"/rooms/{scene_id}/masquerade", {"display_name": "群友", "content": "封幕后不能伪装发言"}),
        ("post", f"/rooms/{scene_id}/turn", {"speaker_persona_id": None}),
        ("post", f"/rooms/{scene_id}/autodrive/resume", None),
        ("post", f"/rooms/{scene_id}/phase/next", {"target_position": None}),
        ("post", f"/rooms/{scene_id}/phase/continue", None),
        ("post", f"/rooms/{scene_id}/phase/extend", None),
        ("post", f"/rooms/{scene_id}/phase/insert", {"phase_template_id": phase_id}),
        ("post", f"/rooms/{scene_id}/facilitator", None),
        ("post", f"/rooms/{scene_id}/tools/execute", {"tool_name": "missing", "arguments": {}}),
        ("patch", f"/rooms/{scene_id}/background", {"background": "封幕后不能改背景"}),
        ("patch", f"/rooms/{scene_id}/limits", {"max_consecutive_ai_turns": 2}),
        ("post", f"/rooms/{scene_id}/freeze", None),
        ("post", f"/rooms/{scene_id}/unfreeze", None),
    ]
    for method, path, body in blocked_requests:
        request = getattr(client, method)
        response = request(path, json=body) if body is not None else request(path)
        assert response.status_code == 409, f"{method.upper()} {path}: {response.text}"

    upload = client.post(
        f"/upload?room_id={scene_id}",
        files={"file": ("sealed.txt", b"sealed room upload", "text/plain")},
    )
    assert upload.status_code == 409

    state = client.get(f"/rooms/{scene_id}/state").json()
    assert all("封幕后不能" not in message["content"] for message in state["messages"])


def test_non_scene_routes_reject_normal_room(client):
    """The /scene/* routes only accept rooms that have a world_id set."""
    room = client.post("/rooms", json={"title": "pytest non-scene room", "persona_ids": []}).json()
    room_id = room["room"]["id"]
    seal = client.post(f"/rooms/{room_id}/seal")
    assert seal.status_code == 409
    enter = client.post(
        f"/rooms/{room_id}/scene/enter",
        json={"world_character_id": "anything"},
    )
    assert enter.status_code == 409
    members = client.get(f"/rooms/{room_id}/scene/members")
    assert members.status_code == 409


def test_scene_rejects_discussion_room_only_endpoints(client, discussant_personas):
    world = _make_world(client)
    template = discussant_personas[0]
    ai_char = _make_ai_character(client, world["id"], template["id"])
    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={"title": "语义隔离测试", "members": [{"world_character_id": ai_char["id"]}]},
    ).json()
    scene_id = scene["room"]["id"]

    cases = [
        ("post", f"/rooms/{scene_id}/verdicts", {"content": "Scene 不能裁决", "is_locked": False}),
        ("post", f"/rooms/{scene_id}/verdicts", {"content": "Scene 不能标死路", "dead_end": True}),
        ("post", f"/rooms/{scene_id}/facilitator", None),
        ("post", f"/rooms/{scene_id}/subrooms", {"title": "Scene 子讨论", "persona_ids": []}),
        ("post", f"/rooms/{scene_id}/masquerade", {"display_name": "群友", "content": "Scene 不能群友发言"}),
    ]
    for method, path, body in cases:
        request = getattr(client, method)
        response = request(path, json=body) if body is not None else request(path)
        assert response.status_code == 409, f"{method.upper()} {path}: {response.text}"


def test_discussion_room_only_endpoints_still_work_for_normal_rooms(client):
    room = client.post("/rooms", json={"title": "pytest discussion endpoints", "persona_ids": []}).json()
    room_id = room["room"]["id"]

    verdict = client.post(f"/rooms/{room_id}/verdicts", json={"content": "普通房间仍可裁决。"})
    assert verdict.status_code == 200, verdict.text

    dead_end = client.post(
        f"/rooms/{room_id}/verdicts",
        json={"content": "普通房间仍可标记死路。", "dead_end": True},
    )
    assert dead_end.status_code == 200, dead_end.text

    facilitator = client.post(f"/rooms/{room_id}/facilitator")
    assert facilitator.status_code != 409

    subroom = client.post(
        f"/rooms/{room_id}/subrooms",
        json={"title": "普通房间子讨论", "persona_ids": []},
    )
    assert subroom.status_code == 200, subroom.text

    masquerade = client.post(
        f"/rooms/{room_id}/masquerade",
        json={"display_name": "群友", "content": "普通房间仍可群友发言。"},
    )
    assert masquerade.status_code == 200, masquerade.text


def test_unclean_drain_blocks_delete_and_seal(client, discussant_personas, monkeypatch):
    async def fake_unclean_drain(*args, **kwargs):
        return DrainResult(
            cancelled=["msg-stuck"],
            completed=[],
            timed_out=["msg-stuck"],
            clean=False,
        )

    monkeypatch.setattr(main_module, "drain_active_calls", fake_unclean_drain)

    room = client.post("/rooms", json={"title": "pytest delete blocked", "persona_ids": []}).json()
    room_id = room["room"]["id"]
    delete_resp = client.delete(f"/rooms/{room_id}")
    assert delete_resp.status_code == 409
    assert client.get(f"/rooms/{room_id}/state").status_code == 200

    world = _make_world(client)
    ai_char = _make_ai_character(client, world["id"], discussant_personas[0]["id"])
    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={"title": "封幕阻断测试", "members": [{"world_character_id": ai_char["id"]}]},
    ).json()
    scene_id = scene["room"]["id"]
    seal_resp = client.post(f"/rooms/{scene_id}/seal")
    assert seal_resp.status_code == 409
    state = client.get(f"/rooms/{scene_id}/state").json()
    assert state["room"]["sealed_at"] is None


def test_seal_scribe_reports_single_character_failure_without_blocking_others(
    client, discussant_personas, monkeypatch
):
    async def noop_autodrive_after(room_id, message):
        return None

    async def controlled_complete_tool(
        persona,
        tool_name,
        tool_description,
        output_model,
        payload,
        max_tokens=1200,
        api_provider=None,
    ):
        assert tool_name == "scene_memory_distill"
        character = payload["character"]
        if character["name"] == "失败者":
            raise RuntimeError("pytest scribe failure")
        peer_id = payload["peers_on_stage"][0]["id"]
        return {
            "new_episodes": [
                {"kind": "episode", "content": "记住了风雨夜的约定。", "salience": 0.7},
                {"kind": "vow", "content": "发誓查清真相。", "salience": 0.8},
            ],
            "impressions": [
                {
                    "about_character_id": peer_id,
                    "sentiment_delta": 0.2,
                    "label": "同伴",
                    "notes_append": "共同经历了风雨夜。",
                }
            ],
            "reasoning": "pytest deterministic memory result",
        }

    monkeypatch.setattr(engine_module, "maybe_autodrive_after", noop_autodrive_after)
    monkeypatch.setattr(engine_module.llm_adapter, "complete_tool", controlled_complete_tool)

    world = _make_world(client)
    template = discussant_personas[0]
    success_char = _make_ai_character(client, world["id"], template["id"], name="成功者")
    failed_char = _make_ai_character(client, world["id"], template["id"], name="失败者")
    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "封幕结果测试",
            "members": [
                {"world_character_id": success_char["id"]},
                {"world_character_id": failed_char["id"]},
            ],
        },
    ).json()
    scene_id = scene["room"]["id"]
    message = client.post(
        f"/rooms/{scene_id}/messages",
        json={"content": "风雨夜里，两人做出了不同选择。", "message_type": "narration"},
    )
    assert message.status_code == 200

    draft = client.post(f"/rooms/{scene_id}/seal")
    assert draft.status_code == 200, draft.text
    draft_payload = draft.json()
    assert draft_payload["status"] == "ready"
    assert any("pytest scribe failure" in warning["message"] for warning in draft_payload["warnings"])
    assert len(draft_payload["memory_updates"]) == 2
    assert len(draft_payload["relationship_updates"]) == 1

    seal = client.post(f"/rooms/{scene_id}/seal-drafts/{draft_payload['id']}/commit")
    assert seal.status_code == 200, seal.text
    payload = seal.json()
    results = {item["character_name"]: item for item in payload["scribe_results"]}

    assert results["成功者"]["status"] == "success"
    assert results["成功者"]["episodes_count"] == 1
    assert results["成功者"]["vows_count"] == 1
    assert results["成功者"]["impressions_count"] == 1
    assert "失败者" not in results

    memories = client.get(
        f"/worlds/{world['id']}/characters/{success_char['id']}/memories"
    ).json()
    scene_memories = [memory for memory in memories if memory["source_scene_id"] == scene_id]
    assert {memory["kind"] for memory in scene_memories} == {
        "episode",
        "vow",
    }
    assert all(memory["seal_draft_id"] == draft_payload["id"] for memory in scene_memories)
    relations = client.get(f"/worlds/{world['id']}/characters/{success_char['id']}/relations").json()
    scene_relations = [relation for relation in relations if relation["last_updated_scene_id"] == scene_id]
    assert scene_relations
    assert all(
        relation["last_updated_seal_draft_id"] == draft_payload["id"]
        for relation in scene_relations
    )


def test_seal_draft_can_be_edited_and_commit_is_idempotent(
    client, discussant_personas, monkeypatch
):
    async def noop_autodrive_after(room_id, message):
        return None

    async def controlled_complete_tool(
        persona,
        tool_name,
        tool_description,
        output_model,
        payload,
        max_tokens=1200,
        api_provider=None,
    ):
        assert tool_name == "scene_memory_distill"
        peer_id = payload["peers_on_stage"][0]["id"]
        return {
            "new_episodes": [
                {"kind": "episode", "content": "应该被用户取消的记忆。", "salience": 0.7}
            ],
            "impressions": [
                {
                    "about_character_id": peer_id,
                    "sentiment_delta": 0.3,
                    "label": "盟友",
                    "notes_append": "应该被用户取消的关系变化。",
                }
            ],
            "reasoning": "pytest deterministic draft edit",
        }

    monkeypatch.setattr(engine_module, "maybe_autodrive_after", noop_autodrive_after)
    monkeypatch.setattr(engine_module.llm_adapter, "complete_tool", controlled_complete_tool)

    world = _make_world(client)
    template = discussant_personas[0]
    char_a = _make_ai_character(client, world["id"], template["id"], name="甲")
    char_b = _make_ai_character(client, world["id"], template["id"], name="乙")
    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "草稿编辑测试",
            "members": [
                {"world_character_id": char_a["id"]},
                {"world_character_id": char_b["id"]},
            ],
        },
    ).json()
    scene_id = scene["room"]["id"]
    client.post(
        f"/rooms/{scene_id}/messages",
        json={"content": "甲乙在旧桥旁交换线索。", "message_type": "narration"},
    )

    draft = client.post(f"/rooms/{scene_id}/seal").json()
    assert draft["memory_updates"]
    assert draft["relationship_updates"]
    draft["timeline_events"][0]["summary"] = "用户编辑后的时间轴摘要。"
    draft["memory_updates"][0]["selected"] = False
    draft["relationship_updates"][0]["selected"] = False
    patched = client.patch(
        f"/rooms/{scene_id}/seal-drafts/{draft['id']}",
        json={
            "timeline_events": draft["timeline_events"],
            "memory_updates": draft["memory_updates"],
            "relationship_updates": draft["relationship_updates"],
        },
    )
    assert patched.status_code == 200, patched.text

    committed = client.post(f"/rooms/{scene_id}/seal-drafts/{draft['id']}/commit")
    assert committed.status_code == 200, committed.text
    committed_again = client.post(f"/rooms/{scene_id}/seal-drafts/{draft['id']}/commit")
    assert committed_again.status_code == 200, committed_again.text

    memories = client.get(f"/worlds/{world['id']}/characters/{char_a['id']}/memories").json()
    assert all(memory["source_scene_id"] != scene_id for memory in memories)
    relations = client.get(f"/worlds/{world['id']}/characters/{char_a['id']}/relations").json()
    assert relations == []
    state = client.get(f"/worlds/{world['id']}/state").json()
    committed_events = [
        event for event in state["timeline_events"] if event["scene_id"] == scene_id
    ]
    assert len(committed_events) == 1
    assert committed_events[0]["summary"] == "用户编辑后的时间轴摘要。"
    assert committed_events[0]["seal_draft_id"] == draft["id"]
