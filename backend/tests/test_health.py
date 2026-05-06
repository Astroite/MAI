def test_health_and_builtin_templates(client):
    health = client.get("/health")
    assert health.status_code == 200
    body = health.json()
    assert body["database"] == "ok"
    assert "mock_llm" not in body

    phases = client.get("/templates/phases")
    assert phases.status_code == 200
    assert len(phases.json()) >= 10

    formats = client.get("/templates/formats")
    assert formats.status_code == 200
    assert any(item["name"] == "方案评审" for item in formats.json())

    recipes = client.get("/templates/recipes")
    assert recipes.status_code == 200
    assert any(item["name"] == "方案评审默认配方" for item in recipes.json())
