def test_masquerade_reveal_flow(client, review_format, discussant_personas):
    speaker = discussant_personas[0]
    room = client.post(
        "/rooms",
        json={"title": "pytest masquerade reveal", "format_id": review_format["id"], "persona_ids": [speaker["id"]]},
    ).json()
    room_id = room["room"]["id"]

    masquerade = client.post(
        f"/rooms/{room_id}/masquerade",
        json={"persona_id": speaker["id"], "content": "我以该人设补充一个受控观点。"},
    )
    assert masquerade.status_code == 200
    masquerade_payload = masquerade.json()
    assert masquerade_payload["author_actual"] == "user_as_persona"
    assert masquerade_payload["author_persona_id"] == speaker["id"]
    assert masquerade_payload["user_masquerade_persona_id"] == speaker["id"]
    assert masquerade_payload["user_masquerade_name"] == speaker["name"]
    assert masquerade_payload["user_revealed_at"] is None

    revealed = client.post(f"/rooms/{room_id}/messages/{masquerade_payload['id']}/reveal")
    assert revealed.status_code == 200
    assert revealed.json()["user_revealed_at"]
    state = client.get(f"/rooms/{room_id}/state").json()
    original = next(message for message in state["messages"] if message["id"] == masquerade_payload["id"])
    reveal_meta = next(message for message in state["messages"] if message["message_type"] == "masquerade_reveal")
    assert original["user_revealed_at"]
    assert reveal_meta["parent_message_id"] == masquerade_payload["id"]
    assert reveal_meta["visibility_to_models"] is False

    guest = client.post(
        f"/rooms/{room_id}/masquerade",
        json={"display_name": "路过群友", "content": "我作为新增群友插一句。"},
    )
    assert guest.status_code == 200
    guest_payload = guest.json()
    assert guest_payload["author_actual"] == "user_as_persona"
    assert guest_payload["author_persona_id"] is None
    assert guest_payload["user_masquerade_persona_id"] is None
    assert guest_payload["user_masquerade_name"] == "路过群友"

    normal = client.post(f"/rooms/{room_id}/messages", json={"content": "普通用户消息。"}).json()
    rejected = client.post(f"/rooms/{room_id}/messages/{normal['id']}/reveal")
    assert rejected.status_code == 400
