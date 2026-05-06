"""PATCH / DELETE on /rooms/{id}/persona-instances/{instance_id}.

Verifies the per-room editable surface: description / system_prompt / model
take effect, name + kind are rejected with 422 (Pydantic extra='forbid'),
and DELETE removes the instance from the room state response.
"""

from __future__ import annotations


def test_persona_instance_patch_and_delete(client, review_format, architect_persona):
    room = client.post(
        "/rooms",
        json={
            "title": "pytest persona-instance patch",
            "format_id": review_format["id"],
            "persona_ids": [architect_persona["id"]],
        },
    ).json()
    room_id = room["room"]["id"]
    instance = next(p for p in room["personas"] if p["template_id"] == architect_persona["id"])
    instance_id = instance["id"]

    # Editable fields: change description + system_prompt + temperature.
    patched = client.patch(
        f"/rooms/{room_id}/persona-instances/{instance_id}",
        json={
            "description": "本房间专属描述",
            "system_prompt": "你是评审者。本房间内更激进。",
            "temperature": 0.8,
        },
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["description"] == "本房间专属描述"
    assert body["system_prompt"] == "你是评审者。本房间内更激进。"
    assert body["temperature"] == 0.8

    # Confirm /state reflects the edit.
    state = client.get(f"/rooms/{room_id}/state").json()
    refreshed = next(p for p in state["personas"] if p["id"] == instance_id)
    assert refreshed["description"] == "本房间专属描述"

    # name / kind are immutable on the instance — rejected by extra='forbid'.
    rejected_name = client.patch(
        f"/rooms/{room_id}/persona-instances/{instance_id}",
        json={"name": "改名了"},
    )
    assert rejected_name.status_code == 422
    rejected_kind = client.patch(
        f"/rooms/{room_id}/persona-instances/{instance_id}",
        json={"kind": "facilitator"},
    )
    assert rejected_kind.status_code == 422

    # The template itself MUST NOT change when the instance is patched.
    template_after = next(
        item for item in client.get("/templates/personas").json() if item["id"] == architect_persona["id"]
    )
    assert template_after["description"] == architect_persona["description"]
    assert template_after["system_prompt"] == architect_persona["system_prompt"]

    # DELETE removes the instance from the room.
    removed = client.delete(f"/rooms/{room_id}/persona-instances/{instance_id}")
    assert removed.status_code == 200
    state_after = client.get(f"/rooms/{room_id}/state").json()
    assert all(p["id"] != instance_id for p in state_after["personas"])


def test_add_persona_instances_idempotent(client, review_format, discussant_personas):
    """POST /rooms/{id}/personas with already-present template ids should
    not produce duplicate instances."""
    speakers = discussant_personas[:2]
    room = client.post(
        "/rooms",
        json={
            "title": "pytest add-personas idempotent",
            "format_id": review_format["id"],
            "persona_ids": [speakers[0]["id"]],
        },
    ).json()
    room_id = room["room"]["id"]
    initial_discussants = [p for p in room["personas"] if p["kind"] == "discussant"]
    assert len(initial_discussants) == 1

    # Re-add same template + a new one.
    after_add = client.post(
        f"/rooms/{room_id}/personas",
        json={"template_ids": [speakers[0]["id"], speakers[1]["id"]]},
    )
    assert after_add.status_code == 200
    discussants = [p for p in after_add.json()["personas"] if p["kind"] == "discussant"]
    template_ids = [p["template_id"] for p in discussants]
    assert sorted(template_ids) == sorted([speakers[0]["id"], speakers[1]["id"]])
    # No duplicates.
    assert len(set(template_ids)) == len(template_ids)
