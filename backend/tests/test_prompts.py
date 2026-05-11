from app.models import (
    Room,
    World,
    WorldCharacter,
    WorldCharacterMemory,
    WorldCharacterRelation,
)
from app.prompts import compose_scene_persona_prompt


def test_compose_scene_persona_prompt_keeps_story_blocks_in_order():
    world = World(
        id="world-1",
        name="长夜城",
        synopsis="一座被潮汐围困的城。",
        setting="城中以灯塔分区。",
        calendar_hint="潮历",
    )
    character = WorldCharacter(
        id="char-a",
        world_id=world.id,
        kind="ai",
        name="苏离",
        identity="剑客",
        brief="少言，警觉。",
        core_identity="这段主提示应由实例创建路径置顶，不在这里重复。",
        skills_text="听风辨位",
        goals_text="守住东门",
    )
    peer = WorldCharacter(
        id="char-b",
        world_id=world.id,
        kind="ai",
        name="沈砚",
        identity="医师",
        brief="",
        core_identity="",
        skills_text="",
        goals_text="",
    )
    scene = Room(
        id="scene-3",
        title="城楼夜话",
        background="城楼外风声很紧。",
        scene_index=3,
        in_world_time_start="暮春黄昏",
        in_world_duration_hint="一炷香",
    )
    memories = [
        WorldCharacterMemory(
            id="memory-a",
            world_character_id=character.id,
            kind="backstory",
            content="出生在雨夜。",
            salience=0.9,
            in_world_time_at_event="二十年前",
        ),
        WorldCharacterMemory(
            id="memory-b",
            world_character_id=character.id,
            kind="vow",
            content="不再弃剑。",
            salience=0.8,
            scene_index_at_write=2,
        ),
    ]
    relations = {
        peer.id: WorldCharacterRelation(
            id="relation-a",
            from_character_id=character.id,
            to_character_id=peer.id,
            label="盟友",
            sentiment=0.75,
            notes="并肩守城。",
        )
    }

    prompt = compose_scene_persona_prompt(
        world,
        character,
        scene,
        memories=memories,
        relations=relations,
        peers=[character, peer],
    )

    assert prompt == (
        "## 世界『长夜城』\n"
        "一座被潮汐围困的城。\n"
        "设定：城中以灯塔分区。\n"
        "纪年法：潮历\n\n"
        "## 你是谁\n"
        "你是「苏离」（剑客）。\n"
        "少言，警觉。\n"
        "技能：听风辨位\n"
        "当前目标：守住东门\n\n"
        "## 你记得的事\n"
        "- [背景]（过往 · 二十年前） 出生在雨夜。\n"
        "- [誓言]（第2幕） 不再弃剑。\n\n"
        "## 你和在场角色的关系\n"
        "- 对「沈砚」: 盟友 [❤ +0.75]\n"
        "  并肩守城。\n\n"
        "## 这一幕（第 3 幕）\n"
        "时间：暮春黄昏\n"
        "时长：一炷香\n"
        "城楼外风声很紧。"
    )
    assert "这段主提示应由实例创建路径置顶" not in prompt
