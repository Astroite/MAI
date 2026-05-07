def test_upload_is_bound_to_owning_room(client):
    room_a = client.post("/rooms", json={"title": "pytest upload owner a", "persona_ids": []}).json()
    room_b = client.post("/rooms", json={"title": "pytest upload owner b", "persona_ids": []}).json()
    upload = client.post(
        f"/upload?room_id={room_a['room']['id']}",
        files={"file": ("note.md", b"# Owned by room A\n\ncontent", "text/markdown")},
    )
    assert upload.status_code == 200
    upload_id = upload.json()["id"]

    rejected = client.post(f"/rooms/{room_b['room']['id']}/messages/from_upload", json={"upload_id": upload_id})
    assert rejected.status_code == 403

    accepted = client.post(f"/rooms/{room_a['room']['id']}/messages/from_upload", json={"upload_id": upload_id})
    assert accepted.status_code == 200
    assert accepted.json()["message_type"] == "user_doc"


def test_global_upload_can_be_claimed_by_first_room(client):
    """Uploads with no room_id (dashboard-style global upload) become claimable
    by the first room that references them via from_upload — and are then
    locked to that room exactly like room-bound uploads."""
    upload = client.post(
        "/upload",
        files={"file": ("global.md", b"# Global note\n\nbody", "text/markdown")},
    )
    assert upload.status_code == 200
    payload = upload.json()
    assert payload["room_id"] is None, "global upload must start unbound"
    upload_id = payload["id"]

    room_a = client.post("/rooms", json={"title": "pytest claim a", "persona_ids": []}).json()
    room_b = client.post("/rooms", json={"title": "pytest claim b", "persona_ids": []}).json()

    accepted = client.post(
        f"/rooms/{room_a['room']['id']}/messages/from_upload",
        json={"upload_id": upload_id},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["message_type"] == "user_doc"

    # Once claimed by room_a, room_b is locked out — same as a room-bound upload.
    rejected = client.post(
        f"/rooms/{room_b['room']['id']}/messages/from_upload",
        json={"upload_id": upload_id},
    )
    assert rejected.status_code == 403
