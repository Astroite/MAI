def test_world_crud_lifecycle(client, discussant_personas):
    architect_persona = discussant_personas[0]
    # create
    created = client.post(
        "/worlds",
        json={
            "name": "pytest 苍穹纪",
            "synopsis": "一个由用户驱动的故事世界",
            "calendar_hint": "玄苍纪元，一年三百日",
            "cover_color": "#8b5cf6",
            "cover_icon": "Globe",
        },
    )
    assert created.status_code == 200
    world = created.json()
    assert world["name"] == "pytest 苍穹纪"
    assert world["synopsis"] == "一个由用户驱动的故事世界"
    assert world["calendar_hint"] == "玄苍纪元，一年三百日"
    assert world["cover_color"] == "#8b5cf6"
    assert world["status"] == "active"
    assert world["characters"] == []
    world_id = world["id"]

    # list returns it with character_count = 0
    listing = client.get("/worlds").json()
    summary = next(item for item in listing if item["id"] == world_id)
    assert summary["character_count"] == 0
    assert summary["scene_count"] == 0
    assert summary["last_activity_at"] is None

    # patch metadata
    patched = client.patch(
        f"/worlds/{world_id}",
        json={"synopsis": "改写后的简介", "cover_icon": "BookOpen"},
    )
    assert patched.status_code == 200
    assert patched.json()["synopsis"] == "改写后的简介"
    assert patched.json()["cover_icon"] == "BookOpen"

    # ai character requires persona_template_id
    rejected_no_template = client.post(
        f"/worlds/{world_id}/characters",
        json={"kind": "ai", "name": "无模板"},
    )
    assert rejected_no_template.status_code == 422

    rejected_bad_template = client.post(
        f"/worlds/{world_id}/characters",
        json={"kind": "ai", "name": "假模板", "persona_template_id": "not-a-real-id"},
    )
    assert rejected_bad_template.status_code == 422

    # create ai character
    ai_character = client.post(
        f"/worlds/{world_id}/characters",
        json={
            "kind": "ai",
            "name": "苏离",
            "identity": "剑客",
            "brief": "孤身浪迹的游侠",
            "persona_template_id": architect_persona["id"],
            "core_identity": "沉默寡言，刀比话快。",
            "skills_text": "剑术、夜行",
            "goals_text": "查清当年师门之变",
            "color": "#0ea5e9",
            "icon": "Swords",
        },
    ).json()
    assert ai_character["kind"] == "ai"
    assert ai_character["persona_template_id"] == architect_persona["id"]
    assert ai_character["persona_template_version"] == architect_persona["version"]
    assert ai_character["core_identity"] == "沉默寡言，刀比话快。"
    assert ai_character["status"] == "active"

    # create user-driven blank character
    user_character = client.post(
        f"/worlds/{world_id}/characters",
        json={
            "kind": "user",
            "name": "无名旅人",
            "brief": "由玩家扮演",
        },
    ).json()
    assert user_character["kind"] == "user"
    assert user_character["persona_template_id"] is None
    assert user_character["persona_template_version"] is None

    # user characters cannot bind to a template via PATCH
    rejected_user_bind = client.patch(
        f"/worlds/{world_id}/characters/{user_character['id']}",
        json={"persona_template_id": architect_persona["id"]},
    )
    assert rejected_user_bind.status_code == 422

    # ai characters cannot have their template cleared via PATCH
    rejected_clear = client.patch(
        f"/worlds/{world_id}/characters/{ai_character['id']}",
        json={"persona_template_id": None},
    )
    assert rejected_clear.status_code == 422

    # patch ai character core fields
    edited = client.patch(
        f"/worlds/{world_id}/characters/{ai_character['id']}",
        json={"goals_text": "改写后的目标", "color": "#ef4444"},
    ).json()
    assert edited["goals_text"] == "改写后的目标"
    assert edited["color"] == "#ef4444"

    # kind is immutable (extra='forbid' rejects)
    rejected_kind = client.patch(
        f"/worlds/{world_id}/characters/{ai_character['id']}",
        json={"kind": "user"},
    )
    assert rejected_kind.status_code == 422

    # detail view includes both characters
    detail = client.get(f"/worlds/{world_id}").json()
    char_ids = {c["id"] for c in detail["characters"]}
    assert char_ids == {ai_character["id"], user_character["id"]}

    # listing reflects 2 active characters
    summary = next(item for item in client.get("/worlds").json() if item["id"] == world_id)
    assert summary["character_count"] == 2

    # soft delete a character -> status retired, count drops
    deleted = client.delete(f"/worlds/{world_id}/characters/{user_character['id']}").json()
    assert deleted["status"] == "retired"
    detail = client.get(f"/worlds/{world_id}").json()
    # both still appear in detail (we don't filter retired)
    assert len(detail["characters"]) == 2
    summary = next(item for item in client.get("/worlds").json() if item["id"] == world_id)
    assert summary["character_count"] == 1

    # delete the world cascades characters
    drop = client.delete(f"/worlds/{world_id}")
    assert drop.status_code == 200
    assert client.get(f"/worlds/{world_id}").status_code == 404
    assert all(item["id"] != world_id for item in client.get("/worlds").json())


def test_world_color_and_icon_validation(client):
    # bad color hex rejected
    bad_color = client.post(
        "/worlds",
        json={"name": "pytest bad color", "cover_color": "blue"},
    )
    assert bad_color.status_code == 422

    # unknown icon falls back to Sparkles (validator coerces, doesn't reject)
    world = client.post(
        "/worlds",
        json={"name": "pytest icon coerce"},
    ).json()
    bad_icon_char = client.post(
        f"/worlds/{world['id']}/characters",
        json={"kind": "user", "name": "图标怪", "icon": "NotARealIcon"},
    ).json()
    assert bad_icon_char["icon"] == "Sparkles"


def test_get_unknown_world_404(client):
    assert client.get("/worlds/nope").status_code == 404
    assert client.patch("/worlds/nope", json={"name": "x"}).status_code == 404
    assert client.delete("/worlds/nope").status_code == 404
    assert client.post("/worlds/nope/characters", json={"kind": "user", "name": "x"}).status_code == 404
