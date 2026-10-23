import pytest

# Settings read the environment, so a developer's own model settings (a hosted
# LLM_PROVIDER, LLM_MODEL, ...) would change what the tests see. Start each
# test from the defaults.
SETTINGS_ENV = ("LLM_PROVIDER", "LLM_MODEL", "LLM_API_BASE", "LLM_API_KEY", "OLLAMA_URL", "EMBED_MODEL", "AI_SERVICE_TOKEN")


@pytest.fixture(autouse=True)
def default_settings_env(monkeypatch):
    for name in SETTINGS_ENV:
        monkeypatch.delenv(name, raising=False)
