def _make_world_with_ai(client, discussant_personas):
    world = client.post(
        "/worlds",
        json={
            "name": "pytest world state",
            "synopsis": "旧世界简介",
            "setting": "旧世界背景",
            "calendar_hint": "旧纪年法",
        },
    ).json()
    template = discussant_personas[0]
    character = client.post(
        f"/worlds/{world['id']}/characters",
        json={
            "kind": "ai",
            "name": "苏离",
            "identity": "剑客",
            "persona_template_id": template["id"],
            "core_identity": "沉默寡言。",
        },
    ).json()
    peer = client.post(
        f"/worlds/{world['id']}/characters",
        json={
            "kind": "ai",
            "name": "阿照",
            "identity": "医者",
            "persona_template_id": template["id"],
            "core_identity": "温和谨慎。",
        },
    ).json()
    return world, character, peer


def test_world_state_includes_bible_timeline_memory_and_relationship(
    client, discussant_personas
):
    world, character, peer = _make_world_with_ai(client, discussant_personas)
    world_id = world["id"]

    bible = client.patch(
        f"/worlds/{world_id}/bible",
        json={
            "summary": "江湖将乱，旧盟约正在失效。",
            "background": "玄苍门覆灭后二十年，各方势力重回边城。",
            "current_date_label": "永熙三年冬",
            "current_location": "边城客栈",
            "current_arc": {
                "title": "旧盟约",
                "summary": "众人追查盟约破裂原因。",
                "current_conflict": "各派都在隐瞒真相。",
                "current_goal": "找到第一份盟书。",
                "status": "developing",
                "unresolved_hooks": [
                    {"id": "hook-1", "title": "谁烧了密信", "status": "open"}
                ],
            },
        },
    )
    assert bible.status_code == 200, bible.text
    assert bible.json()["current_location"] == "边城客栈"

    event = client.post(
        f"/worlds/{world_id}/timeline-events",
        json={
            "type": "history",
            "title": "玄苍门覆灭",
            "summary": "二十年前，玄苍门在雪夜被灭。",
            "date_label": "二十年前",
            "related_character_ids": [character["id"]],
        },
    )
    assert event.status_code == 200, event.text
    assert event.json()["order"] == 1

    memory = client.post(
        f"/worlds/{world_id}/characters/{character['id']}/memories",
        json={"kind": "backstory", "content": "幼年在雪夜逃出玄苍门。", "salience": 0.9},
    )
    assert memory.status_code == 200, memory.text

    relation = client.put(
        f"/worlds/{world_id}/characters/{character['id']}/relations/{peer['id']}",
        json={"label": "旧识", "sentiment": 0.4, "notes": "曾在边城互相救过命。"},
    )
    assert relation.status_code == 200, relation.text

    scene = client.post(
        f"/worlds/{world_id}/scenes",
        json={
            "title": "第一幕：雪夜重逢",
            "in_world_time_start": "永熙三年冬 初七",
            "members": [
                {"world_character_id": character["id"]},
                {"world_character_id": peer["id"]},
            ],
        },
    )
    assert scene.status_code == 200, scene.text

    state = client.get(f"/worlds/{world_id}/state")
    assert state.status_code == 200, state.text
    payload = state.json()
    assert payload["bible"]["summary"] == "江湖将乱，旧盟约正在失效。"
    assert payload["bible"]["background"] == "玄苍门覆灭后二十年，各方势力重回边城。"
    assert payload["unresolved_hooks_count"] == 1
    assert payload["timeline_events"][0]["title"] == "玄苍门覆灭"
    assert payload["scenes"][0]["title"] == "第一幕：雪夜重逢"
    assert payload["open_scene"]["id"] == scene.json()["room"]["id"]
    assert payload["memories"][0]["source"] == "manual"
    assert payload["memories"][0]["character_name"] == "苏离"
    assert payload["relationships"][0]["label"] == "旧识"
    assert payload["relationships"][0]["to_character_name"] == "阿照"

    detail = client.get(f"/worlds/{world_id}").json()
    assert detail["synopsis"] == "江湖将乱，旧盟约正在失效。"
    assert detail["setting"] == "玄苍门覆灭后二十年，各方势力重回边城。"


def test_timeline_event_validates_world_links(client, discussant_personas):
    world, _, _ = _make_world_with_ai(client, discussant_personas)
    other_world, other_char, _ = _make_world_with_ai(client, discussant_personas)

    cross_character = client.post(
        f"/worlds/{world['id']}/timeline-events",
        json={
            "title": "跨世界角色",
            "related_character_ids": [other_char["id"]],
        },
    )
    assert cross_character.status_code == 422

    event = client.post(
        f"/worlds/{world['id']}/timeline-events",
        json={"title": "可编辑事件", "summary": "初稿"},
    ).json()
    patched = client.patch(
        f"/worlds/{world['id']}/timeline-events/{event['id']}",
        json={"summary": "修订稿", "status": "draft"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["summary"] == "修订稿"
    assert patched.json()["status"] == "draft"

    missing = client.patch(
        f"/worlds/{other_world['id']}/timeline-events/{event['id']}",
        json={"summary": "不能跨世界编辑"},
    )
    assert missing.status_code == 404
