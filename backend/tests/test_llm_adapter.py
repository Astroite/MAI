from app.llm import LLMAdapter, llm_adapter
from app.models import ApiProvider, Persona


def _persona(model: str, config: dict | None = None) -> Persona:
    return Persona(
        id="pytest-%s" % model.replace("/", "-"),
        kind="discussant",
        name=model,
        description="",
        backing_model=model,
        system_prompt="",
        temperature=0.4,
        config=config or {},
        tags=["pytest"],
        is_builtin=False,
    )


def test_deep_thinking_extra_params_route_by_model_family():
    assert llm_adapter._build_extra_params(_persona("anthropic/claude-sonnet-4-5", {"deep_thinking": True})) == {
        "thinking": {"type": "enabled", "budget_tokens": 10000}
    }
    assert llm_adapter._build_extra_params(_persona("openai/o3", {"deep_thinking": True})) == {
        "reasoning_effort": "high"
    }
    assert llm_adapter._build_extra_params(_persona("gemini/gemini-1.5-pro", {"deep_thinking": True})) == {}
    assert llm_adapter._build_extra_params(_persona("openai/o3")) == {}


def test_provider_params_passed_through_adapter():
    adapter = LLMAdapter()
    assert adapter._build_provider_params(None) == {}
    provider = ApiProvider(
        id="test", name="t", provider_slug="openai", api_key="sk-x", api_base="https://api.test/v1"
    )
    assert adapter._build_provider_params(provider) == {
        "api_key": "sk-x",
        "api_base": "https://api.test/v1",
    }
    assert adapter._build_provider_params(
        ApiProvider(id="t2", name="t2", provider_slug="openai", api_key="sk-y")
    ) == {"api_key": "sk-y"}
