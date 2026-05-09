from app.engine import ACTIVE_CALLS, InFlightCall


def test_room_state_exposes_in_flight_partial(client, review_format, discussant_personas, instance_for_template):
    speaker = discussant_personas[0]
    room = client.post(
        "/rooms",
        json={"title": "pytest reconnect", "format_id": review_format["id"], "persona_ids": [speaker["id"]]},
    ).json()
    room_id = room["room"]["id"]
    speaker_instance_id = instance_for_template(room_id, speaker["id"])
    call = InFlightCall(
        room_id=room_id,
        message_id="msg-reconnect",
        persona_id=speaker_instance_id,
        task=object(),
        partial_text="partial answer",
        last_chunk_index=3,
    )
    ACTIVE_CALLS.setdefault(room_id, {})[call.message_id] = call
    try:
        state = client.get(f"/rooms/{room_id}/state")
        assert state.status_code == 200
        partial = state.json()["in_flight_partial"][0]
        assert partial["message_id"] == "msg-reconnect"
        assert partial["persona_id"] == speaker_instance_id
        assert partial["content"] == "partial answer"
        assert partial["last_chunk_index"] == 3
    finally:
        ACTIVE_CALLS.pop(room_id, None)


