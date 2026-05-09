"""Memory CRUD + retrieval-into-prompt baking for Story World characters.

The LLM-driven scene-end memory scribe is exercised manually with the paid
test model — these tests cover the deterministic parts: manual writes,
listing order, deletion, and the `_compose_scene_persona_prompt` injection
path that pulls top-K memories into a fresh scene.
"""


def _world_with_ai_character(client, discussant_personas, name: str = "苏离"):
    world = client.post("/worlds", json={"name": "pytest memory world"}).json()
    template = discussant_personas[0]
    character = client.post(
        f"/worlds/{world['id']}/characters",
        json={
            "kind": "ai",
            "name": name,
            "identity": "剑客",
            "persona_template_id": template["id"],
            "core_identity": "沉默寡言。",
        },
    ).json()
    return world, character


def test_manual_memory_crud_and_listing_order(client, discussant_personas):
    world, character = _world_with_ai_character(client, discussant_personas)

    # Empty initially.
    initial = client.get(f"/worlds/{world['id']}/characters/{character['id']}/memories")
    assert initial.status_code == 200
    assert initial.json() == []

    # Manual backstory write — the user-as-director path.
    backstory = client.post(
        f"/worlds/{world['id']}/characters/{character['id']}/memories",
        json={
            "kind": "backstory",
            "content": "幼时师门被屠，独自逃出。",
            "salience": 0.95,
            "in_world_time_at_event": "二十年前 · 寒冬",
        },
    ).json()
    assert backstory["kind"] == "backstory"
    assert backstory["source_scene_id"] is None
    assert backstory["scene_index_at_write"] is None
    assert backstory["salience"] == 0.95

    # A second entry with lower salience.
    other = client.post(
        f"/worlds/{world['id']}/characters/{character['id']}/memories",
        json={"kind": "fact", "content": "认识镇上酒馆的老板。", "salience": 0.3},
    ).json()

    # Listing returns both — newest scene_index_at_write first (NULLs last).
    listing = client.get(
        f"/worlds/{world['id']}/characters/{character['id']}/memories"
    ).json()
    assert len(listing) == 2
    ids = {m["id"] for m in listing}
    assert ids == {backstory["id"], other["id"]}

    # Delete one.
    drop = client.delete(
        f"/worlds/{world['id']}/characters/{character['id']}/memories/{other['id']}"
    )
    assert drop.status_code == 200
    remaining = client.get(
        f"/worlds/{world['id']}/characters/{character['id']}/memories"
    ).json()
    assert len(remaining) == 1
    assert remaining[0]["id"] == backstory["id"]


def test_memory_create_rejects_target_in_other_world(client, discussant_personas):
    world_a, char_a = _world_with_ai_character(client, discussant_personas)
    world_b = client.post("/worlds", json={"name": "pytest memory world b"}).json()
    template = discussant_personas[0]
    char_in_b = client.post(
        f"/worlds/{world_b['id']}/characters",
        json={"kind": "ai", "name": "另一世界角色", "persona_template_id": template["id"]},
    ).json()

    cross = client.post(
        f"/worlds/{world_a['id']}/characters/{char_a['id']}/memories",
        json={"kind": "impression", "content": "?", "target_character_id": char_in_b["id"]},
    )
    assert cross.status_code == 422


def test_top_k_memories_baked_into_next_scene_prompt(client, discussant_personas):
    """High-salience and backstory memories should appear in the system_prompt
    of a freshly-created scene's PersonaInstance for that character."""
    world, character = _world_with_ai_character(client, discussant_personas, name="忆主")

    # Seed three memories — only top-K (default 6) come back, ordered for prompt.
    for idx, payload in enumerate(
        [
            {"kind": "backstory", "content": "出生于江南雨夜。", "salience": 0.9},
            {"kind": "episode", "content": "初次拔剑伤了同门。", "salience": 0.8},
            {"kind": "vow", "content": "立誓不饮酒。", "salience": 0.7},
        ]
    ):
        resp = client.post(
            f"/worlds/{world['id']}/characters/{character['id']}/memories", json=payload
        )
        assert resp.status_code == 200, resp.text

    # Spawn a scene with this character.
    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "回忆触发测试",
            "members": [{"world_character_id": character["id"]}],
        },
    ).json()
    discussants = [p for p in scene["personas"] if p["kind"] == "discussant"]
    assert len(discussants) == 1
    prompt = discussants[0]["system_prompt"]
    # All three memories should appear in the baked prompt.
    assert "出生于江南雨夜。" in prompt
    assert "初次拔剑伤了同门。" in prompt
    assert "立誓不饮酒。" in prompt
    # The "你记得的事" header is the section anchor.
    assert "你记得的事" in prompt
    # Backstory memories are tagged differently from per-scene memories in the
    # rendered line; just sanity-check that the renderer ran.
    assert "[背景]" in prompt or "[经历]" in prompt or "[誓言]" in prompt


def test_scene_without_memories_omits_memory_section(client, discussant_personas):
    """A character with zero memory rows must NOT get an empty 你记得的事 block."""
    world, character = _world_with_ai_character(client, discussant_personas, name="新人")
    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "无记忆首场",
            "members": [{"world_character_id": character["id"]}],
        },
    ).json()
    discussant = next(p for p in scene["personas"] if p["kind"] == "discussant")
    assert "你记得的事" not in discussant["system_prompt"]
