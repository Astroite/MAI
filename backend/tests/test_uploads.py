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
