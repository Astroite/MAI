def test_layered_limit_update_and_phase_round_exit(client, discussant_personas, instance_for_template):
    speaker = discussant_personas[0]
    phase = client.post(
        "/templates/phases",
        json={
            "name": "pytest manual limited phase",
            "description": "manual exit so max_phase_rounds is the active guard",
            "declared_variables": [],
            "allowed_speakers": {"type": "all"},
            "ordering_rule": {"type": "user_picks"},
            "exit_conditions": [{"type": "user_manual"}],
            "role_constraints": "",
            "prompt_template": "请用一句话回应。",
            "tags": ["pytest"],
        },
    ).json()
    debate_format = client.post(
        "/templates/formats",
        json={
            "name": "pytest limited format",
            "phase_sequence": [{"phase_template_id": phase["id"], "phase_template_version": phase["version"]}],
            "tags": ["pytest"],
        },
    ).json()
    room = client.post(
        "/rooms",
        json={"title": "pytest layered limits", "format_id": debate_format["id"], "persona_ids": [speaker["id"]]},
    ).json()
    room_id = room["room"]["id"]
    speaker_instance_id = instance_for_template(room_id, speaker["id"])

    limits = client.patch(
        f"/rooms/{room_id}/limits",
        json={
            "max_message_tokens": 400,
            "max_room_tokens": 2000,
            "max_phase_rounds": 1,
            "max_account_daily_tokens": 5000,
            "max_account_monthly_tokens": 50000,
        },
    )
    assert limits.status_code == 200
    runtime = limits.json()
    assert runtime["max_phase_rounds"] == 1
    assert runtime["max_account_daily_tokens"] == 5000
    assert runtime["max_account_monthly_tokens"] == 50000

    turn = client.post(f"/rooms/{room_id}/turn", json={"speaker_persona_id": speaker_instance_id})
    assert turn.status_code == 200
    state = client.get(f"/rooms/{room_id}/state").json()
    assert state["runtime"]["phase_exit_suggested"] is True
    assert any(item["type"] == "phase_round_limit" for item in state["runtime"]["phase_exit_matched_conditions"])


def test_room_full_lifecycle(client, review_format, architect_persona, instance_for_template):
    """Smoke: room create -> user msg -> turn -> phase continue -> subroom -> merge_back."""
    room = client.post(
        "/rooms",
        json={"title": "pytest smoke", "format_id": review_format["id"], "persona_ids": [architect_persona["id"]]},
    )
    assert room.status_code == 200
    room_id = room.json()["room"]["id"]
    architect_instance_id = instance_for_template(room_id, architect_persona["id"])

    message = client.post(f"/rooms/{room_id}/messages", json={"content": "请评审 SSE + append-only 的方案。"})
    assert message.status_code == 200

    turn = client.post(f"/rooms/{room_id}/turn", json={"speaker_persona_id": architect_instance_id})
    assert turn.status_code == 200
    payload = turn.json()
    assert payload
    assert payload[0]["author_actual"] == "ai"
    assert payload[0]["author_persona_id"] == architect_instance_id

    state = client.get(f"/rooms/{room_id}/state").json()
    assert state["runtime"]["phase_exit_suggested"] is True
    assert state["runtime"]["phase_exit_matched_conditions"][0]["type"] == "all_spoken"

    continued = client.post(f"/rooms/{room_id}/phase/continue")
    assert continued.status_code == 200
    assert continued.json()["runtime"]["phase_exit_suggested"] is False

    subroom = client.post(
        f"/rooms/{room_id}/subrooms",
        json={
            "title": "pytest subroom",
            "format_id": review_format["id"],
            "persona_ids": [architect_persona["id"]],
        },
    )
    assert subroom.status_code == 200
    subroom_id = subroom.json()["room"]["id"]
    assert subroom.json()["room"]["parent_room_id"] == room_id

    merge = client.post(
        f"/rooms/{subroom_id}/merge_back",
        json={
            "conclusion": "子讨论认为 SSE 可以保留。",
            "key_reasoning": ["父讨论只需要结构化合并包"],
            "unresolved": [],
        },
    )
    assert merge.status_code == 200
    parent_state = client.get(f"/rooms/{room_id}/state").json()
    assert any("子讨论合并结论" in message["content"] for message in parent_state["messages"])
