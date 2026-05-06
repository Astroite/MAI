from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .ids import builtin_id
from .models import DebateFormat, PersonaTemplate, PhaseTemplate, Recipe


def _transition() -> list[dict]:
    return [{"condition": "always", "target": "next"}]


BUILTIN_PERSONAS: list[dict] = [
    {
        "key": "architect",
        "kind": "discussant",
        "name": "架构师",
        "description": "关注系统边界、演进路径、数据模型与复杂度控制。",
        "backing_model": "",
        "temperature": 0.35,
        "tags": ["builtin", "technical", "convergent"],
        "system_prompt": "你是架构师。优先讨论边界、数据流、演进路径、复杂度和可维护性。回答要具体、可执行。",
    },
    {
        "key": "performance_critic",
        "kind": "discussant",
        "name": "性能批评者",
        "description": "主动寻找性能瓶颈、资源浪费和扩展风险。",
        "backing_model": "",
        "temperature": 0.45,
        "tags": ["builtin", "technical", "critic"],
        "system_prompt": "你是性能批评者。优先指出吞吐、延迟、内存、IO、锁与成本风险，并提出可验证的指标。",
    },
    {
        "key": "maintainer",
        "kind": "discussant",
        "name": "维护者",
        "description": "关注代码长期维护、调试体验、测试和操作复杂度。",
        "backing_model": "",
        "temperature": 0.35,
        "tags": ["builtin", "technical", "operations"],
        "system_prompt": "你是维护者。你关注调试、测试、迁移、部署和新人理解成本。不要接受难以维护的捷径。",
    },
    {
        "key": "product_strategist",
        "kind": "discussant",
        "name": "产品策略师",
        "description": "关注用户价值、取舍和阶段性可交付。",
        "backing_model": "",
        "temperature": 0.5,
        "tags": ["builtin", "product", "strategy"],
        "system_prompt": "你是产品策略师。你把讨论拉回用户目标、核心流程、验收标准和取舍优先级。",
    },
    {
        "key": "ux_researcher",
        "kind": "discussant",
        "name": "用户研究员",
        "description": "从真实用户动机、认知负担和可用性风险出发。",
        "backing_model": "",
        "temperature": 0.55,
        "tags": ["builtin", "ux", "research"],
        "system_prompt": "你是用户研究员。你要指出用户会在哪里困惑、迟疑或误用，并提出低成本验证方式。",
    },
    {
        "key": "security_reviewer",
        "kind": "discussant",
        "name": "安全审计者",
        "description": "审视权限、数据泄露、注入、供应链和审计日志。",
        "backing_model": "",
        "temperature": 0.3,
        "tags": ["builtin", "security", "critic"],
        "system_prompt": "你是安全审计者。你优先寻找权限、注入、数据泄露、供应链与审计缺口。",
    },
    {
        "key": "devils_advocate",
        "kind": "discussant",
        "name": "反方律师",
        "description": "系统性提出反例和失败路径。",
        "backing_model": "",
        "temperature": 0.65,
        "tags": ["builtin", "critic", "divergent"],
        "system_prompt": "你是反方律师。你要强制寻找反例、隐藏假设和失败路径，但必须给出证据或可验证判断。",
    },
    {
        "key": "steelmanner",
        "kind": "discussant",
        "name": "钢人化支持者",
        "description": "把弱方案提炼成最强版本再接受评审。",
        "backing_model": "",
        "temperature": 0.55,
        "tags": ["builtin", "synthesis", "constructive"],
        "system_prompt": "你是钢人化支持者。你的职责是先把方案最强版本表达清楚，再承认其边界。",
    },
    {
        "key": "systems_operator",
        "kind": "discussant",
        "name": "运维负责人",
        "description": "关注可观测性、回滚、容量和事故响应。",
        "backing_model": "",
        "temperature": 0.35,
        "tags": ["builtin", "ops", "reliability"],
        "system_prompt": "你是运维负责人。你关注监控、告警、回滚、容量规划、故障域和事故响应。",
    },
    {
        "key": "research_scout",
        "kind": "discussant",
        "name": "研究侦察员",
        "description": "提出可探索方向、备选技术和未知问题。",
        "backing_model": "",
        "temperature": 0.75,
        "tags": ["builtin", "research", "divergent"],
        "system_prompt": "你是研究侦察员。你负责提出备选路径、未知变量、实验设计和外部参考线索。",
    },
    {
        "key": "scribe",
        "kind": "scribe",
        "name": "书记官",
        "description": "忠实记录讨论中的共识、分歧、问题、决议和死路。",
        "backing_model": "",
        "temperature": 0.2,
        "tags": ["builtin", "system"],
        "config": {"trigger_every_n_messages": 5},
        "system_prompt": "你是书记官。只记录已经说出的内容，不推测，不给建议。保守删除，必须引用消息证据。",
    },
    {
        "key": "facilitator",
        "kind": "facilitator",
        "name": "上帝副手",
        "description": "对用户隐藏地评估讨论健康度、节奏和下一步建议。",
        "backing_model": "",
        "temperature": 0.3,
        "tags": ["builtin", "system"],
        "config": {
            "trigger_every_n_messages": 5,
            "cooldown_per_tag_rounds": 5,
            "context_window_messages": 50,
            "disabled": False,
        },
        "system_prompt": "你是上帝副手。你的输出不会被讨论者看到。只对用户负责，给出健康度和节奏建议，不参与论证。",
    },
]


PHASES: dict[str, dict] = {
    "constructive": {
        "name": "立论",
        "description": "正反或多方依次陈述初始观点。",
        "declared_variables": [
            {"name": "$affirmative_speaker", "description": "正方或方案提出者", "cardinality": "many", "required": False},
            {"name": "$negative_speaker", "description": "反方或主要质疑者", "cardinality": "many", "required": False},
        ],
        "allowed_speakers": {"type": "all"},
        "ordering_rule": {"type": "alternating"},
        "exit_conditions": [{"type": "all_spoken", "min_each": 1}],
        "role_constraints": "只陈述核心立场和最强理由，不展开长篇反驳。",
        "prompt_template": "请基于当前问题给出你的初始立场、主要理由和一个最需要验证的假设。",
        "tags": ["builtin", "debate"],
    },
    "cross_exam": {
        "name": "质询",
        "description": "提问方主导，围绕关键假设做问答。",
        "declared_variables": [
            {"name": "$questioners", "description": "提问者", "cardinality": "many", "required": False},
            {"name": "$respondents", "description": "回答者", "cardinality": "many", "required": False},
        ],
        "allowed_speakers": {"type": "all"},
        "ordering_rule": {"type": "question_paired"},
        "exit_conditions": [{"type": "rounds", "n": 2}, {"type": "facilitator_suggests", "trigger_if": ["phase_exhausted"]}],
        "auto_discuss": True,
        "role_constraints": "每轮只聚焦一个问题。回答必须直接，不反问替代回答。",
        "prompt_template": "请提出或回答一个能澄清关键假设的问题。",
        "tags": ["builtin", "debate", "review"],
    },
    "free_debate": {
        "name": "自由辩论",
        "description": "所有在场讨论者可被用户点名发言。",
        "declared_variables": [],
        "allowed_speakers": {"type": "all"},
        "ordering_rule": {"type": "mention_driven"},
        "exit_conditions": [{"type": "user_manual"}, {"type": "rounds", "n": 4}],
        "auto_discuss": True,
        "role_constraints": "可以直接回应他人，但必须带来新论据或清晰归纳。",
        "prompt_template": "请回应当前最关键的争议点，避免重复已经说过的内容。",
        "tags": ["builtin", "debate", "open"],
    },
    "closing": {
        "name": "总结陈词",
        "description": "各方给出最终归纳和建议。",
        "declared_variables": [],
        "allowed_speakers": {"type": "all"},
        "ordering_rule": {"type": "round_robin"},
        "exit_conditions": [{"type": "all_spoken", "min_each": 1}],
        "role_constraints": "只总结最终判断、保留意见和下一步建议。",
        "prompt_template": "请给出你的最终总结、仍不确定的地方和建议用户拍板的事项。",
        "tags": ["builtin", "debate", "summary"],
    },
    "round_robin": {
        "name": "轮询",
        "description": "所有在场讨论者按固定顺序轮流发言。",
        "declared_variables": [],
        "allowed_speakers": {"type": "all"},
        "ordering_rule": {"type": "round_robin"},
        "exit_conditions": [{"type": "all_spoken", "min_each": 1}],
        "auto_discuss": True,
        "role_constraints": "每人补充一个独立观点，不重复。",
        "prompt_template": "请从你的角色出发补充一个独立观察。",
        "tags": ["builtin", "roundtable"],
    },
    "author_defense": {
        "name": "作者答辩",
        "description": "方案作者集中回应评审质询。",
        "declared_variables": [{"name": "$author", "description": "方案作者", "cardinality": "one", "required": False}],
        "allowed_speakers": {"type": "all"},
        "ordering_rule": {"type": "question_paired"},
        "exit_conditions": [{"type": "rounds", "n": 2}],
        "role_constraints": "优先回应明确质询，承认尚未解决的问题。",
        "prompt_template": "请针对最近的评审意见做答辩，说明接受、拒绝或需要验证的点。",
        "tags": ["builtin", "review"],
    },
    "review_scoring": {
        "name": "评审打分",
        "description": "评审并行给出评分、风险和通过条件。",
        "declared_variables": [{"name": "$reviewers", "description": "评审者", "cardinality": "many", "required": False}],
        "allowed_speakers": {"type": "all"},
        "ordering_rule": {"type": "parallel"},
        "exit_conditions": [{"type": "all_spoken", "min_each": 1}],
        "role_constraints": "给出 1-5 分、关键风险和通过条件。",
        "prompt_template": "请给方案打分，并列出必须补齐的条件。",
        "tags": ["builtin", "review", "scoring"],
    },
    "brainstorm": {
        "name": "头脑风暴",
        "description": "发散提出方案，禁止过早批评。",
        "declared_variables": [],
        "allowed_speakers": {"type": "all"},
        "ordering_rule": {"type": "parallel"},
        "exit_conditions": [{"type": "rounds", "n": 1}],
        "role_constraints": "禁止批评，优先数量和差异性。",
        "prompt_template": "请提出 3 个方向不同的想法，每个用一句话说明价值。",
        "tags": ["builtin", "brainstorm", "divergent"],
    },
    "socratic": {
        "name": "诘问",
        "description": "指定主问者连续追问，压力测试假设。",
        "declared_variables": [{"name": "$questioner", "description": "主问者", "cardinality": "one", "required": False}],
        "allowed_speakers": {"type": "all"},
        "ordering_rule": {"type": "question_paired"},
        "exit_conditions": [{"type": "rounds", "n": 3}],
        "role_constraints": "优先提出能暴露假设的问题，不急于给方案。",
        "prompt_template": "请用一个尖锐问题逼近当前论点的关键假设。",
        "tags": ["builtin", "socratic", "critic"],
    },
    "open": {
        "name": "自由模式",
        "description": "统一的开放讨论 phase，由用户点名推进。",
        "declared_variables": [],
        "allowed_speakers": {"type": "all"},
        "ordering_rule": {"type": "mention_driven"},
        "exit_conditions": [{"type": "user_manual"}],
        "role_constraints": "按用户点名和当前上下文发言。",
        "prompt_template": "请基于当前上下文给出有帮助的下一步发言。",
        "tags": ["builtin", "open"],
    },
}


FORMAT_DEFS: list[dict] = [
    {
        "key": "formal_debate",
        "name": "正经辩论赛",
        "description": "适合二元决策：立论、质询、自由辩论、总结陈词。",
        "phases": ["constructive", "cross_exam", "free_debate", "closing"],
        "tags": ["builtin", "debate"],
    },
    {
        "key": "roundtable",
        "name": "圆桌讨论",
        "description": "适合开放探索，由所有角色轮询发言。",
        "phases": ["round_robin"],
        "tags": ["builtin", "roundtable"],
    },
    {
        "key": "solution_review",
        "name": "方案评审",
        "description": "技术方案评审：立论、质询、作者答辩、评审打分。",
        "phases": ["constructive", "cross_exam", "author_defense", "review_scoring"],
        "tags": ["builtin", "review"],
    },
    {
        "key": "brainstorm_format",
        "name": "头脑风暴",
        "description": "早期发散后轮询归类。",
        "phases": ["brainstorm", "round_robin"],
        "tags": ["builtin", "brainstorm"],
    },
    {
        "key": "socratic_format",
        "name": "苏格拉底诘问",
        "description": "压力测试一个观点或方案。",
        "phases": ["socratic"],
        "tags": ["builtin", "socratic"],
    },
    {
        "key": "open_format",
        "name": "自由模式",
        "description": "日常使用的开放讨论。",
        "phases": ["open"],
        "tags": ["builtin", "open"],
    },
]


RECIPE_DEFS: list[dict] = [
    {
        "key": "solution_review_default",
        "name": "方案评审默认配方",
        "description": "架构师、性能批评者、维护者和反方律师按方案评审赛制推进。",
        "personas": ["architect", "performance_critic", "maintainer", "devils_advocate"],
        "format": "solution_review",
        "initial_settings": {"max_message_tokens": 900, "max_room_tokens": 120000, "auto_transition": False},
        "tags": ["builtin", "review"],
    },
    {
        "key": "open_roundtable_default",
        "name": "开放圆桌默认配方",
        "description": "适合早期探索的圆桌讨论配方。",
        "personas": ["product_strategist", "ux_researcher", "architect", "research_scout"],
        "format": "roundtable",
        "initial_settings": {"max_message_tokens": 800, "max_room_tokens": 90000, "auto_transition": False},
        "tags": ["builtin", "roundtable"],
    },
]


async def seed_builtins(session: AsyncSession) -> None:
    existing_persona = await session.scalar(select(PersonaTemplate.id).limit(1))
    if existing_persona is None:
        for data in BUILTIN_PERSONAS:
            item = data.copy()
            key = item.pop("key")
            session.add(
                PersonaTemplate(
                    id=builtin_id("persona", key),
                    version=1,
                    schema_version=1,
                    status="published",
                    is_builtin=True,
                    config=item.pop("config", {}),
                    **item,
                )
            )

    existing_phase = await session.scalar(select(PhaseTemplate.id).limit(1))
    if existing_phase is None:
        for key, data in PHASES.items():
            session.add(
                PhaseTemplate(
                    id=builtin_id("phase", key),
                    version=1,
                    schema_version=1,
                    status="published",
                    is_builtin=True,
                    **data,
                )
            )

    existing_format = await session.scalar(select(DebateFormat.id).limit(1))
    if existing_format is None:
        for data in FORMAT_DEFS:
            phase_sequence = [
                {
                    "phase_template_id": builtin_id("phase", phase_key),
                    "phase_template_version": 1,
                    "transitions": _transition(),
                }
                for phase_key in data["phases"]
            ]
            session.add(
                DebateFormat(
                    id=builtin_id("format", data["key"]),
                    version=1,
                    schema_version=1,
                    status="published",
                    is_builtin=True,
                    name=data["name"],
                    description=data["description"],
                    phase_sequence=phase_sequence,
                    tags=data["tags"],
                )
            )
    existing_recipe = await session.scalar(select(Recipe.id).limit(1))
    if existing_recipe is None:
        for data in RECIPE_DEFS:
            session.add(
                Recipe(
                    id=builtin_id("recipe", data["key"]),
                    version=1,
                    schema_version=1,
                    status="published",
                    is_builtin=True,
                    name=data["name"],
                    description=data["description"],
                    persona_ids=[builtin_id("persona", key) for key in data["personas"]],
                    format_id=builtin_id("format", data["format"]),
                    format_version=1,
                    initial_settings=data["initial_settings"],
                    tags=data["tags"],
                )
            )
    await session.commit()
