from types import SimpleNamespace

from app.llm import llm_adapter


def test_hidden_facilitator_messages_are_filtered_from_llm_context(
    client, review_format, discussant_personas, monkeypatch
):
    captured = {}

    async def capture_stream(persona, context, phase, max_tokens, scribe_state=None, api_provider=None):
        captured["contents"] = [message.content for message in context]
        captured["api_provider"] = api_provider
        yield SimpleNamespace(text="可见上下文已检查。", index=0)

    monkeypatch.setattr(llm_adapter, "stream", capture_stream)

    speaker = discussant_personas[0]
    room = client.post(
        "/rooms",
        json={"title": "pytest visibility filtering", "format_id": review_format["id"], "persona_ids": [speaker["id"]]},
    ).json()
    room_id = room["room"]["id"]

    for index in range(5):
        assert client.post(f"/rooms/{room_id}/messages", json={"content": f"可见讨论消息 {index}"}).status_code == 200
    state = client.get(f"/rooms/{room_id}/state").json()
    hidden_messages = [message for message in state["messages"] if message["visibility_to_models"] is False]
    assert hidden_messages, "facilitator output should produce visibility_to_models=False messages"

    turn = client.post(f"/rooms/{room_id}/turn", json={"speaker_persona_id": speaker["id"]})
    assert turn.status_code == 200
    assert "contents" in captured
    assert any("可见讨论消息" in content for content in captured["contents"])
    assert all(message["content"] not in captured["contents"] for message in hidden_messages)
