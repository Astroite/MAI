"""Memory decay, cold-storage gating, hard cap, and PATCH endpoints (PR 5).

Decay/cap fire at scene seal. The LLM-driven memory scribe is exercised
manually with the paid model — these tests focus on the deterministic
maintenance pipeline and director PATCH paths.
"""

import pytest

from app import engine as engine_module


def _world_with_ai_character(client, discussant_personas, name="忆主"):
    world = client.post("/worlds", json={"name": "pytest decay world"}).json()
    template = discussant_personas[0]
    character = client.post(
        f"/worlds/{world['id']}/characters",
        json={"kind": "ai", "name": name, "persona_template_id": template["id"]},
    ).json()
    return world, character


def _seal_and_commit(client, scene_id: str):
    draft = client.post(f"/rooms/{scene_id}/seal")
    assert draft.status_code == 200, draft.text
    payload = draft.json()
    commit = client.post(f"/rooms/{scene_id}/seal-drafts/{payload['id']}/commit")
    assert commit.status_code == 200, commit.text
    return commit


def test_backstory_is_protected_from_decay(client, discussant_personas):
    world, character = _world_with_ai_character(client, discussant_personas)

    # Seed a backstory memory via the director route.
    backstory = client.post(
        f"/worlds/{world['id']}/characters/{character['id']}/memories",
        json={"kind": "backstory", "content": "幼时的某事", "salience": 0.7},
    ).json()
    original_salience = backstory["salience"]

    # Spawn + seal a scene with this character. (No participants needed for
    # decay to run; the seal route always invokes decay_unused_memories.)
    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "封幕触发衰减",
            "members": [{"world_character_id": character["id"]}],
        },
    ).json()
    _seal_and_commit(client, scene["room"]["id"])

    # Backstory salience must be untouched.
    after = client.get(
        f"/worlds/{world['id']}/characters/{character['id']}/memories"
    ).json()
    backstory_after = next(m for m in after if m["id"] == backstory["id"])
    assert backstory_after["salience"] == original_salience


def test_cold_storage_memories_are_excluded_from_next_scene_prompt(
    client, discussant_personas
):
    world, character = _world_with_ai_character(client, discussant_personas, name="冷藏者")
    cold = client.post(
        f"/worlds/{world['id']}/characters/{character['id']}/memories",
        json={"kind": "fact", "content": "彻底淡忘的细节", "salience": 0.5},
    ).json()
    warm = client.post(
        f"/worlds/{world['id']}/characters/{character['id']}/memories",
        json={"kind": "vow", "content": "依然铭记的誓言", "salience": 0.9},
    ).json()
    # Push the first one into cold storage.
    pushed = client.patch(
        f"/worlds/{world['id']}/characters/{character['id']}/memories/{cold['id']}",
        json={"salience": 0.01},
    ).json()
    assert pushed["salience"] == 0.01

    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "记忆筛选",
            "members": [{"world_character_id": character["id"]}],
        },
    ).json()
    persona = next(p for p in scene["personas"] if p["kind"] == "discussant")
    prompt = persona["system_prompt"]
    assert "依然铭记的誓言" in prompt
    assert "彻底淡忘的细节" not in prompt


def test_used_memories_get_stamped_with_last_used_scene_index(
    client, discussant_personas
):
    world, character = _world_with_ai_character(client, discussant_personas, name="留痕者")
    memory = client.post(
        f"/worlds/{world['id']}/characters/{character['id']}/memories",
        json={"kind": "episode", "content": "曾经的事", "salience": 0.8},
    ).json()
    assert memory["last_used_scene_index"] is None

    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={"title": "首场", "members": [{"world_character_id": character["id"]}]},
    ).json()
    assert scene["room"]["scene_index"] == 1

    after = client.get(
        f"/worlds/{world['id']}/characters/{character['id']}/memories"
    ).json()
    refreshed = next(m for m in after if m["id"] == memory["id"])
    assert refreshed["last_used_scene_index"] == 1


def test_unused_episode_decays_when_outside_grace_window(
    client, discussant_personas
):
    """A memory with no recent use whose scene_index_at_write is older than the
    grace window must lose salience at seal time."""
    world, character = _world_with_ai_character(client, discussant_personas, name="衰减者")
    # Seed via API (NULL scene_index_at_write, NULL last_used). Then PATCH
    # kind to episode so the backstory protection doesn't apply.
    memory = client.post(
        f"/worlds/{world['id']}/characters/{character['id']}/memories",
        json={"kind": "backstory", "content": "古旧记忆", "salience": 0.6},
    ).json()
    promoted = client.patch(
        f"/worlds/{world['id']}/characters/{character['id']}/memories/{memory['id']}",
        json={"kind": "episode"},
    ).json()
    assert promoted["kind"] == "episode"
    assert promoted["salience"] == 0.6

    # Burn through enough scenes so the threshold passes the row.
    # Grace = MEMORY_DECAY_GRACE_SCENES (3); we need scene_index > grace so
    # the NULL wrote_idx + NULL last_used doesn't get an early-skip.
    # Each scene creation stamps last_used (because the memory is salience >=
    # cold storage). To get decay to fire, exclude this character from the
    # roster of all but the last scene, OR we hit a fresh scene where
    # threshold_index > current last_used. Here: 4 scenes WITHOUT this
    # character, then seal the last one.
    other_char = client.post(
        f"/worlds/{world['id']}/characters",
        json={
            "kind": "ai",
            "name": "陪跑",
            "persona_template_id": discussant_personas[0]["id"],
        },
    ).json()
    seal_targets: list[str] = []
    for index in range(4):
        scene = client.post(
            f"/worlds/{world['id']}/scenes",
            json={
                "title": f"过场 {index + 1}",
                "members": [{"world_character_id": other_char["id"]}],
            },
        ).json()
        seal_targets.append(scene["room"]["id"])

    # Seal the 4th scene — at scene_index 4 with grace 3, threshold = 1.
    # Our memory has wrote_idx=None and used_idx=None → both branches skip
    # → decay applies.
    _seal_and_commit(client, seal_targets[-1])

    after = client.get(
        f"/worlds/{world['id']}/characters/{character['id']}/memories"
    ).json()
    refreshed = next(m for m in after if m["id"] == memory["id"])
    assert refreshed["salience"] < 0.6
    assert refreshed["salience"] == pytest.approx(0.6 * 0.95, rel=1e-6)


def test_memory_cap_drops_lowest_salience(client, discussant_personas, monkeypatch):
    """Force a tiny cap, exceed it, then seal — the lowest-salience non-backstory
    rows should be deleted."""
    monkeypatch.setattr(engine_module, "MEMORY_PER_CHARACTER_CAP", 3)
    world, character = _world_with_ai_character(client, discussant_personas, name="拥挤者")

    # Add 4 episodes spanning a salience range. Backstory shouldn't count.
    backstory = client.post(
        f"/worlds/{world['id']}/characters/{character['id']}/memories",
        json={"kind": "backstory", "content": "永久背景"},
    ).json()
    episodes = []
    for salience, label in [(0.9, "高"), (0.7, "中高"), (0.4, "中"), (0.1, "低")]:
        episode = client.post(
            f"/worlds/{world['id']}/characters/{character['id']}/memories",
            json={"kind": "episode", "content": f"事件{label}", "salience": salience},
        ).json()
        episodes.append(episode)

    other_char = client.post(
        f"/worlds/{world['id']}/characters",
        json={
            "kind": "ai",
            "name": "陪跑",
            "persona_template_id": discussant_personas[0]["id"],
        },
    ).json()
    scene = client.post(
        f"/worlds/{world['id']}/scenes",
        json={
            "title": "封幕触发上限",
            "members": [{"world_character_id": other_char["id"]}],
        },
    ).json()
    _seal_and_commit(client, scene["room"]["id"])

    after = client.get(
        f"/worlds/{world['id']}/characters/{character['id']}/memories"
    ).json()
    contents = sorted(m["content"] for m in after)
    # Backstory always survives; lowest-salience episode (事件低) should be gone.
    assert "永久背景" in contents
    assert "事件高" in contents
    assert "事件中高" in contents
    assert "事件中" in contents
    assert "事件低" not in contents


def test_patch_memory_partial_edit(client, discussant_personas):
    world, character = _world_with_ai_character(client, discussant_personas)
    memory = client.post(
        f"/worlds/{world['id']}/characters/{character['id']}/memories",
        json={"kind": "fact", "content": "原版", "salience": 0.5},
    ).json()
    patched = client.patch(
        f"/worlds/{world['id']}/characters/{character['id']}/memories/{memory['id']}",
        json={"content": "改版"},
    ).json()
    assert patched["content"] == "改版"
    # Untouched fields remain.
    assert patched["kind"] == "fact"
    assert patched["salience"] == 0.5

    # extra='forbid' rejects unknown fields.
    bad = client.patch(
        f"/worlds/{world['id']}/characters/{character['id']}/memories/{memory['id']}",
        json={"created_at": "2026-01-01"},
    )
    assert bad.status_code == 422


def test_patch_relation_partial_edit(client, discussant_personas):
    world = client.post("/worlds", json={"name": "pytest patch relation"}).json()
    template = discussant_personas[0]
    char_a = client.post(
        f"/worlds/{world['id']}/characters",
        json={"kind": "ai", "name": "A", "persona_template_id": template["id"]},
    ).json()
    char_b = client.post(
        f"/worlds/{world['id']}/characters",
        json={"kind": "ai", "name": "B", "persona_template_id": template["id"]},
    ).json()
    client.put(
        f"/worlds/{world['id']}/characters/{char_a['id']}/relations/{char_b['id']}",
        json={"label": "盟友", "sentiment": 0.5, "notes": "起初"},
    )
    patched = client.patch(
        f"/worlds/{world['id']}/characters/{char_a['id']}/relations/{char_b['id']}",
        json={"sentiment": -0.3},
    ).json()
    assert patched["sentiment"] == -0.3
    assert patched["label"] == "盟友"
    assert patched["notes"] == "起初"

    missing = client.patch(
        f"/worlds/{world['id']}/characters/{char_a['id']}/relations/nonexistent-id",
        json={"sentiment": 0.0},
    )
    assert missing.status_code == 404
