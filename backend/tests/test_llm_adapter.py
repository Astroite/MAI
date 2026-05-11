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


def _provider(slug: str) -> ApiProvider:
    return ApiProvider(id=f"p-{slug}", name=slug, provider_slug=slug, api_key="sk-x")


def test_resolve_model_string_prepends_provider_slug_when_missing():
    adapter = LLMAdapter()
    # Bare model id + routable slug → slug gets prepended so litellm can route.
    assert adapter._resolve_model_string(_persona("gpt-4o-mini"), _provider("openai")) == "openai/gpt-4o-mini"
    assert adapter._resolve_model_string(_persona("claude-3-5-sonnet"), _provider("anthropic")) == "anthropic/claude-3-5-sonnet"
    # Any "/" in the model id means "user already specified routing" — leave
    # alone. This covers both pre-prefixed strings (openai/gpt-4o-mini) and
    # the OpenAI-compat-to-elsewhere pattern (slug=openai + api_base=openrouter
    # + model=openrouter/anthropic/...).
    assert adapter._resolve_model_string(_persona("openai/gpt-4o-mini"), _provider("openai")) == "openai/gpt-4o-mini"
    assert adapter._resolve_model_string(_persona("openrouter/anthropic/claude-haiku-4.5"), _provider("openai")) == "openrouter/anthropic/claude-haiku-4.5"
    assert adapter._resolve_model_string(_persona("openrouter/anthropic/claude-3.5-sonnet"), _provider("openrouter")) == "openrouter/anthropic/claude-3.5-sonnet"
    # custom slug / no provider → we don't touch the user's string.
    assert adapter._resolve_model_string(_persona("deepseek-chat"), _provider("custom")) == "deepseek-chat"
    assert adapter._resolve_model_string(_persona("openai/gpt-4o-mini"), None) == "openai/gpt-4o-mini"


def test_extra_params_use_provider_slug_when_model_has_no_prefix():
    adapter = LLMAdapter()
    persona = _persona("claude-3-5-sonnet", {"deep_thinking": True})
    # Slug routes deep_thinking even when the user typed a bare model id.
    assert adapter._build_extra_params(persona, _provider("anthropic")) == {
        "thinking": {"type": "enabled", "budget_tokens": 10000}
    }
    persona_oai = _persona("o3", {"deep_thinking": True})
    assert adapter._build_extra_params(persona_oai, _provider("openai")) == {"reasoning_effort": "high"}
