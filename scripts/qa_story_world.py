"""End-to-end QA harness for the Story World feature.

Walks the full backend flow without any UI — useful for verifying that
LLM-driven memory + relationship scribes produce sane output before we
commit to building the Story World UI (PR 6).

Prereqs:
  1. Backend is running locally (`scripts\\dev.ps1`, or
     `uvicorn app.main:app --reload --port 47821` from backend/).
  2. An ApiProvider + default api_model is configured (Settings page).
     Without this, /worlds/{id}/scenes still works but /seal will trace
     "scene_memory_failed" for every AI character.
  3. backend venv is active (`backend\\.venv\\Scripts\\Activate.ps1`).
     httpx is already in requirements.txt.

Usage:
  python scripts/qa_story_world.py
  python scripts/qa_story_world.py --base http://127.0.0.1:47821
  python scripts/qa_story_world.py --keep-going          # skip pauses
  python scripts/qa_story_world.py --skip-cleanup        # leave the World
                                                          # in the DB after

Pause semantics: by default the script stops after each major phase so
you can read the output. Press ENTER to continue. With --keep-going it
runs through end-to-end with no prompts.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any

import httpx


# Visual helpers --------------------------------------------------------------


def banner(title: str) -> None:
    bar = "=" * 70
    print(f"\n{bar}\n  {title}\n{bar}")


def step(label: str) -> None:
    print(f"\n--- {label} ---")


def kv(label: str, value: Any) -> None:
    rendered = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    print(f"  {label}: {rendered}")


def block(label: str, body: str) -> None:
    print(f"  {label}:")
    for line in body.splitlines():
        print(f"    {line}")


def pause(args: argparse.Namespace, prompt: str = "ENTER 继续") -> None:
    if args.keep_going:
        return
    try:
        input(f"\n[{prompt}] ")
    except (EOFError, KeyboardInterrupt):
        print()
        sys.exit(0)


# API client wrapper ----------------------------------------------------------


class API:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.client = httpx.Client(timeout=120.0)

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        url = f"{self.base}{path}"
        response = self.client.request(method, url, **kwargs)
        if response.status_code >= 400:
            raise SystemExit(
                f"!! {method} {path} -> {response.status_code}\n   {response.text[:500]}"
            )
        if response.headers.get("content-type", "").startswith("application/json"):
            return response.json()
        return response.text

    def get(self, path: str, **kwargs: Any) -> Any:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, json_body: Any | None = None, **kwargs: Any) -> Any:
        return self.request("POST", path, json=json_body, **kwargs)

    def patch(self, path: str, json_body: Any | None = None, **kwargs: Any) -> Any:
        return self.request("PATCH", path, json=json_body, **kwargs)

    def put(self, path: str, json_body: Any | None = None, **kwargs: Any) -> Any:
        return self.request("PUT", path, json=json_body, **kwargs)

    def delete(self, path: str, **kwargs: Any) -> Any:
        return self.request("DELETE", path, **kwargs)


# Wait helpers ----------------------------------------------------------------


def wait_for_settle(api: API, room_id: str, timeout: float = 90.0) -> dict[str, Any]:
    """Poll /state until autodrive is idle and there are no in-flight calls.
    Returns the final state."""
    print("  (polling for autodrive to settle ...)")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = api.get(f"/rooms/{room_id}/state")
        runtime = state["runtime"]
        if not runtime.get("autodrive_active") and not runtime.get("current_speakers"):
            return state
        time.sleep(1.0)
    print("  !! settle timed out — proceeding anyway")
    return api.get(f"/rooms/{room_id}/state")


# Phase implementations -------------------------------------------------------


def check_prereqs(api: API) -> None:
    banner("0. 前置检查")
    health = api.get("/health")
    kv("health", health)
    settings = api.get("/settings")
    if not settings.get("default_api_model_id") and not settings.get("default_api_provider_id"):
        print(
            "\n!! 没有配置 default API model / provider — LLM 调用会失败。\n"
            "   请到 UI 的 Settings 页配好 ApiProvider + 默认模型，再回来跑这个脚本。\n"
            "   （或者把 backend/tests/.env.test 的 OPENAI_API_KEY 配进 backend/.env）"
        )
        sys.exit(1)
    kv("default_api_model_id", settings.get("default_api_model_id"))
    kv("default_backing_model", settings.get("default_backing_model"))


def pick_two_discussant_templates(api: API) -> list[dict[str, Any]]:
    templates = api.get("/templates/personas?kind=discussant")
    if len(templates) < 2:
        raise SystemExit("!! 需要至少 2 个 discussant 人设模板")
    chosen = templates[:2]
    kv("template[0]", f"{chosen[0]['name']}（{chosen[0].get('identity', '')}）")
    kv("template[1]", f"{chosen[1]['name']}（{chosen[1].get('identity', '')}）")
    return chosen


def create_world(api: API) -> dict[str, Any]:
    banner("1. 建世界")
    world = api.post(
        "/worlds",
        json_body={
            "name": f"QA-{int(time.time())} 苍穹纪",
            "synopsis": "一个江湖与剑气交织的世界。门派林立，恩怨纠缠。",
            "setting": "中古架空，没有现代科技。",
            "calendar_hint": "玄苍纪元，一年三百日，每日十二时辰。",
            "cover_color": "#8b5cf6",
            "cover_icon": "Sparkles",
        },
    )
    kv("world.id", world["id"])
    kv("world.name", world["name"])
    return world


def create_characters(
    api: API, world: dict[str, Any], templates: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    banner("2. 加角色（2 个 AI）")
    chars: list[dict[str, Any]] = []
    char_a = api.post(
        f"/worlds/{world['id']}/characters",
        json_body={
            "kind": "ai",
            "name": "苏离",
            "identity": "孤剑客",
            "brief": "独行的剑客，沉默寡言。",
            "persona_template_id": templates[0]["id"],
            "core_identity": "性格冷峻，话少行多。受过师门重创，对结盟保持距离。",
            "skills_text": "剑术、夜行、辨毒",
            "goals_text": "查清当年师门覆灭真相",
            "color": "#0ea5e9",
            "icon": "Swords",
        },
    )
    chars.append(char_a)
    kv("char[0]", f"{char_a['name']}（{char_a['identity']}）")
    char_b = api.post(
        f"/worlds/{world['id']}/characters",
        json_body={
            "kind": "ai",
            "name": "宁青",
            "identity": "酒馆老板娘",
            "brief": "镇上唯一一家酒馆的老板娘，消息灵通。",
            "persona_template_id": templates[1]["id"],
            "core_identity": "热情爽朗，但藏着江湖往事。会先观察再说话，话里有钩子。",
            "skills_text": "酿酒、读人、近身格斗",
            "goals_text": "等一个会再回来的人",
            "color": "#f97316",
            "icon": "Heart",
        },
    )
    chars.append(char_b)
    kv("char[1]", f"{char_b['name']}（{char_b['identity']}）")
    return chars


def seed_backstory(api: API, world: dict[str, Any], char_a: dict[str, Any]) -> None:
    banner("3. 给苏离写一段 backstory")
    memory = api.post(
        f"/worlds/{world['id']}/characters/{char_a['id']}/memories",
        json_body={
            "kind": "backstory",
            "content": "二十年前的雪夜，整个剑山门派被屠。我从血泊里爬出来时，只剩半截剑。",
            "salience": 0.95,
            "in_world_time_at_event": "玄苍纪元 二十年前 · 寒冬",
        },
    )
    kv("backstory.id", memory["id"])
    kv("salience", memory["salience"])


def create_scene_one(
    api: API, world: dict[str, Any], chars: list[dict[str, Any]]
) -> dict[str, Any]:
    banner("4. 创建第一幕：相遇")
    scene = api.post(
        f"/worlds/{world['id']}/scenes",
        json_body={
            "title": "第一幕：酒馆相遇",
            "background": "黄昏，宁青的酒馆。窗外飘着细雪。苏离推门而入，肩上落着雪花。",
            "in_world_time_start": "玄苍纪元 第七日 · 黄昏",
            "in_world_duration_hint": "约一个时辰",
            "members": [
                {"world_character_id": chars[0]["id"], "role_in_scene": "陌生客人"},
                {"world_character_id": chars[1]["id"], "role_in_scene": "酒馆老板娘"},
            ],
        },
    )
    room = scene["room"]
    kv("scene.id", room["id"])
    kv("scene_index", room["scene_index"])
    return scene


def show_persona_prompts(scene: dict[str, Any], note: str) -> None:
    step(f"PersonaInstance system_prompt（{note}）")
    for persona in scene["personas"]:
        if persona["kind"] != "discussant":
            continue
        block(f"{persona['name']} ({persona['identity']})", persona["system_prompt"])


def drive_conversation(api: API, room_id: str) -> None:
    banner("5. 喂几条用户消息让两人互动")
    user_messages = [
        "（你扮演旁观者，把场景推一下）请描写一下宁青看到苏离推门进来时的反应。",
        "苏离在角落坐下了。请让两人开始第一句对话。",
        "宁青可以试探一下苏离的来意。苏离要回应得简短而冷淡。",
    ]
    for index, content in enumerate(user_messages, start=1):
        step(f"用户消息 {index}/{len(user_messages)}")
        kv("content", content)
        api.post(f"/rooms/{room_id}/messages", json_body={"content": content})
        wait_for_settle(api, room_id)
    step("最终对话历史")
    state = api.get(f"/rooms/{room_id}/state")
    for msg in state["messages"]:
        if not msg.get("visibility_to_models", True):
            continue
        author = msg.get("author_actual", "?")
        if author == "user":
            tag = "USER"
        elif author == "ai":
            persona_id = msg.get("author_persona_id")
            persona = next(
                (p for p in state["personas"] if p["id"] == persona_id), None
            )
            tag = persona["name"] if persona else f"AI:{persona_id}"
        else:
            tag = author.upper()
        text = msg.get("content", "")
        block(tag, text[:400] + ("…" if len(text) > 400 else ""))


def seal_and_inspect(
    api: API, world: dict[str, Any], chars: list[dict[str, Any]], scene: dict[str, Any]
) -> None:
    banner("6. 封幕：触发记忆 + 关系卡的 LLM scribe")
    room_id = scene["room"]["id"]
    sealed = api.post(f"/rooms/{room_id}/seal")
    kv("sealed_at", sealed["sealed_at"])

    step("LLM 生成的记忆 / 关系")
    for character in chars:
        memories = api.get(
            f"/worlds/{world['id']}/characters/{character['id']}/memories"
        )
        relations = api.get(
            f"/worlds/{world['id']}/characters/{character['id']}/relations"
        )
        print(f"\n  >>> {character['name']}")
        if not memories:
            print("    （无记忆）")
        for memory in memories:
            tag = memory["kind"]
            scene_idx = memory.get("scene_index_at_write")
            scene_marker = f"@ 第{scene_idx}幕" if scene_idx is not None else "@ backstory"
            print(
                f"    [{tag} sal={memory['salience']:.2f} {scene_marker}] {memory['content']}"
            )
        if relations:
            print("    --- 关系 ---")
            for relation in relations:
                target_id = relation["to_character_id"]
                target = next(
                    (c for c in chars if c["id"] == target_id), {"name": target_id}
                )
                print(
                    f"    -> {target['name']}: "
                    f"{relation['label'] or '(未命名)'} "
                    f"sentiment={relation['sentiment']:+.2f} "
                    f"notes={relation['notes'][:80]}"
                )


def create_scene_two_and_show_baking(
    api: API, world: dict[str, Any], chars: list[dict[str, Any]]
) -> dict[str, Any]:
    banner("7. 创建第二幕：看记忆有没有烘焙进新 system_prompt")
    scene2 = api.post(
        f"/worlds/{world['id']}/scenes",
        json_body={
            "title": "第二幕：再访",
            "background": "三日后，苏离再次来到酒馆。",
            "in_world_time_start": "玄苍纪元 第十日 · 午后",
            "members": [
                {"world_character_id": chars[0]["id"]},
                {"world_character_id": chars[1]["id"]},
            ],
        },
    )
    show_persona_prompts(scene2, note="第二幕 — 应包含第一幕产出的记忆 + 关系卡")
    return scene2


def cleanup(api: API, world: dict[str, Any]) -> None:
    banner("8. 清理")
    api.delete(f"/worlds/{world['id']}")
    kv("deleted world", world["id"])


# Entry point -----------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:47821")
    parser.add_argument(
        "--keep-going", action="store_true", help="skip ENTER pauses between phases"
    )
    parser.add_argument(
        "--skip-cleanup", action="store_true", help="leave the QA world in the DB"
    )
    args = parser.parse_args()

    api = API(args.base)

    check_prereqs(api)
    pause(args)

    templates = pick_two_discussant_templates(api)
    pause(args)

    world = create_world(api)
    pause(args)

    chars = create_characters(api, world, templates)
    pause(args)

    seed_backstory(api, world, chars[0])
    pause(args)

    scene1 = create_scene_one(api, world, chars)
    show_persona_prompts(scene1, note="第一幕 — 应包含 backstory")
    pause(args)

    drive_conversation(api, scene1["room"]["id"])
    pause(args)

    seal_and_inspect(api, world, chars, scene1)
    pause(args)

    create_scene_two_and_show_baking(api, world, chars)
    pause(args, prompt="ENTER 清理（或 Ctrl-C 保留世界）")

    if args.skip_cleanup:
        kv("kept world", world["id"])
    else:
        cleanup(api, world)

    banner("QA 完成")
    print("  - 检查 LLM 写出来的 episode/vow 是不是 sane")
    print("  - 检查 sentiment 走向有没有道理")
    print("  - 检查第二幕 PersonaInstance 的 system_prompt 是否真的载入了第一幕的记忆 + 关系")
    print("  - 看 backend trace_payloads/<room_id>/ 下面有完整的 LLM 调用 payload")


if __name__ == "__main__":
    main()
