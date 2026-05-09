"""Relationship-card CRUD + prompt-injection coverage.

The LLM-driven relation upsert (impressions stream from MemoryDistillation)
is exercised manually with the paid test model — these tests cover the
deterministic parts: manual director writes, listing, deletion, validation,
and the prompt-baking path that pulls relations into a fresh scene's
PersonaInstance system_prompt for peers actually on stage.
"""


def _world_with_two_ai_chars(client, discussant_personas):
    world = client.post("/worlds", json={"name": "pytest relations world"}).json()
    template = discussant_personas[0]
    char_a = client.post(
        f"/worlds/{world['id']}/characters",
        json={"kind": "ai", "name": "甲", "persona_template_id": template["id"]},
    ).json()
    char_b = client.post(
        f"/worlds/{world['id']}/characters",
        json={"kind": "ai", "name": "乙", "persona_template_id": template["id"]},
    ).json()
    return world, char_a, char_b


def test_manual_relation_upsert_replace_and_delete(client, discussant_personas):
    world, char_a, char_b = _world_with_two_ai_chars(client, discussant_personas)

    initial = client.get(f"/worlds/{world['id']}/characters/{char_a['id']}/relations").json()
    assert initial == []

    # Create.
    created = client.put(
        f"/worlds/{world['id']}/characters/{char_a['id']}/relations/{char_b['id']}",
        json={"label": "盟友", "sentiment": 0.7, "notes": "在第一幕一起喝过酒。"},
    ).json()
    assert created["from_character_id"] == char_a["id"]
    assert created["to_character_id"] == char_b["id"]
    assert created["label"] == "盟友"
    assert created["sentiment"] == 0.7

    # Replace (PUT semantics).
    replaced = client.put(
        f"/worlds/{world['id']}/characters/{char_a['id']}/relations/{char_b['id']}",
        json={"label": "宿敌", "sentiment": -0.6, "notes": "翻脸了。"},
    ).json()
    assert replaced["id"] == created["id"]
    assert replaced["label"] == "宿敌"
    assert replaced["sentiment"] == -0.6
    assert replaced["notes"] == "翻脸了。"

    # Direction is one-way: B -> A doesn't exist.
    other_dir = client.get(
        f"/worlds/{world['id']}/characters/{char_b['id']}/relations"
    ).json()
    assert other_dir == []

    # Delete.
    drop = client.delete(
        f"/worlds/{world['id']}/characters/{char_a['id']}/relations/{char_b['id']}"
    )
    assert drop.status_code == 200
    after = client.get(f"/worlds/{world['id']}/characters/{char_a['id']}/relations").json()
    assert after == []


def test_relation_validation(client, discussant_personas):
    world, char_a, _ = _world_with_two_ai_chars(client, discussant_personas)

    # Self-relation rejected.
    self_rel = client.put(
        f"/worlds/{world['id']}/characters/{char_a['id']}/relations/{char_a['id']}",
        json={"label": "自我"},
    )
    assert self_rel.status_code == 422

    # Cross-world target rejected.
    other_world = client.post("/worlds", json={"name": "pytest other"}).json()
    template = discussant_personas[0]
    char_in_other = client.post(
        f"/worlds/{other_world['id']}/characters",
        json={"kind": "ai", "name": "外", "persona_template_id": template["id"]},
    ).json()
    cross = client.put(
        f"/worlds/{world['id']}/characters/{char_a['id']}/relations/{char_in_other['id']}",
        json={"label": "?"},
    )
    assert cross.status_code == 422

    # User character cannot own outgoing relations.
    user_char = client.post(
        f"/worlds/{world['id']}/characters",
        json={"kind": "user", "name": "玩家"},
    ).json()
    user_owns = client.put(
        f"/worlds/{world['id']}/characters/{user_char['id']}/relations/{char_a['id']}",
        json={"label": "搭子"},
    )
    assert user_owns.status_code == 409


def test_relation_card_baked_into_scene_prompt_only_for_on_stage_peers(
    client, discussant_personas
):
    """Scene with A + B + C; A holds relations to all three peers, but the
    scene only seats A and B — A's prompt must include the A→B card and
    nothing else."""
    world, char_a, char_b = _world_with_two_ai_chars(client, discussant_personas)
    template = discussant_personas[0]
    char_c = client.post(
        f"/worlds/{world['id']}/characters",
        json={"kind": "ai", "name": "丙", "persona_template_id": template["id"]},
    ).json()

    # A holds two outgoing cards: one for B (on stage), one for C (off stage).
    client.put(
        f"/worlds/{world['id']}/characters/{char_a['id']}/relations/{char_b['id']}",
        json={"label": "盟友", "sentiment": 0.8, "notes": "并肩作战多年。"},
    )
    client.put(
        f"/worlds/{world['id']}/characters/{char_a['id']}/relations/{char_c['id']}",
        json={"label": "宿敌", "sentiment": -0.9, "notes": "不能同台。"},
    )

    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "并肩之夜",
            "members": [
                {"world_character_id": char_a["id"]},
                {"world_character_id": char_b["id"]},
            ],
        },
    ).json()
    a_persona = next(
        p for p in scene["personas"]
        if p["kind"] == "discussant" and p["world_character_id"] == char_a["id"]
    )
    prompt = a_persona["system_prompt"]

    assert "你和在场角色的关系" in prompt
    # On-stage relation appears…
    assert "盟友" in prompt
    assert "并肩作战多年。" in prompt
    # …off-stage one does NOT.
    assert "宿敌" not in prompt
    assert "不能同台。" not in prompt

    # B has no outgoing relations — B's prompt must omit the relations section.
    b_persona = next(
        p for p in scene["personas"]
        if p["kind"] == "discussant" and p["world_character_id"] == char_b["id"]
    )
    assert "你和在场角色的关系" not in b_persona["system_prompt"]


def test_late_joiner_picks_up_existing_relations(client, discussant_personas):
    """When a character enters mid-scene via /scene/enter, their fresh
    PersonaInstance should include relation cards for peers currently on stage."""
    world, char_a, char_b = _world_with_two_ai_chars(client, discussant_personas)
    # B has an outgoing card to A.
    client.put(
        f"/worlds/{world['id']}/characters/{char_b['id']}/relations/{char_a['id']}",
        json={"label": "故人", "sentiment": 0.4, "notes": "三年未见。"},
    )

    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={"title": "重逢", "members": [{"world_character_id": char_a["id"]}]},
    ).json()
    scene_id = scene["room"]["id"]

    enter = client.post(
        f"/rooms/{scene_id}/scene/enter",
        json={"world_character_id": char_b["id"]},
    )
    assert enter.status_code == 200

    state = client.get(f"/rooms/{scene_id}/state").json()
    b_persona = next(
        p for p in state["personas"]
        if p["kind"] == "discussant" and p["world_character_id"] == char_b["id"]
    )
    assert "故人" in b_persona["system_prompt"]
    assert "三年未见。" in b_persona["system_prompt"]
