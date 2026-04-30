from fastapi.testclient import TestClient

from app.main import app


def test_health_and_builtin_templates():
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["database"] == "ok"

        phases = client.get("/templates/phases")
        assert phases.status_code == 200
        assert len(phases.json()) >= 10

        formats = client.get("/templates/formats")
        assert formats.status_code == 200
        assert any(item["name"] == "方案评审" for item in formats.json())

        recipes = client.get("/templates/recipes")
        assert recipes.status_code == 200
        assert any(item["name"] == "方案评审默认配方" for item in recipes.json())


def test_room_message_and_mock_turn():
    with TestClient(app) as client:
        formats = client.get("/templates/formats").json()
        personas = client.get("/templates/personas?kind=discussant").json()
        review = next(item for item in formats if item["name"] == "方案评审")
        speaker = next(item for item in personas if item["name"] == "架构师")
        body = {
            "title": "pytest smoke",
            "format_id": review["id"],
            "persona_ids": [speaker["id"]],
        }
        room = client.post("/rooms", json=body)
        assert room.status_code == 200
        room_id = room.json()["room"]["id"]

        message = client.post("/rooms/%s/messages" % room_id, json={"content": "请评审 SSE + append-only 的方案。"})
        assert message.status_code == 200

        turn = client.post("/rooms/%s/turn" % room_id, json={"speaker_persona_id": speaker["id"]})
        assert turn.status_code == 200
        payload = turn.json()
        assert payload
        assert payload[0]["author_actual"] == "ai"

        state = client.get("/rooms/%s/state" % room_id).json()
        assert state["runtime"]["phase_exit_suggested"] is True
        assert state["runtime"]["phase_exit_matched_conditions"][0]["type"] == "all_spoken"

        continued = client.post("/rooms/%s/phase/continue" % room_id)
        assert continued.status_code == 200
        assert continued.json()["runtime"]["phase_exit_suggested"] is False
