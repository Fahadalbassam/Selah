"""Model adapters. Everything goes through the LLM protocol, so swapping
Ollama for a hosted API is one new class and a config change. A hosted API
sends text to an outside company: use it with sample data only unless
firm approves."""

from typing import Any, Protocol

import httpx

from .config import Settings


class LLM(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]: ...

    async def chat_json(self, system: str, user: str, schema: dict[str, Any]) -> str: ...


class OllamaLLM:
    """Embeddings and chat through a local Ollama server."""

    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._client = httpx.AsyncClient(base_url=settings.ollama_url, timeout=settings.request_timeout_s)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        res = await self._client.post("/api/embed", json={"model": self._s.embed_model, "input": texts})
        res.raise_for_status()
        return res.json()["embeddings"]

    async def chat_json(self, system: str, user: str, schema: dict[str, Any]) -> str:
        res = await self._client.post(
            "/api/chat",
            json={
                "model": self._s.llm_model,
                "stream": False,
                "format": schema,  # structured output: the reply must match the schema
                "options": {"temperature": 0},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            },
        )
        res.raise_for_status()
        return res.json()["message"]["content"]


class HostedChatLLM:
    """Chat through a hosted OpenAI-compatible API; embeddings stay local in
    Ollama so the vector index does not depend on the hosted provider."""

    def __init__(self, settings: Settings) -> None:
        if not settings.llm_api_base or not settings.llm_api_key:
            raise ValueError("llm_api_base and llm_api_key are required for the openai_compat provider")
        self._s = settings
        self._local = OllamaLLM(settings)
        self._client = httpx.AsyncClient(
            base_url=settings.llm_api_base,
            timeout=settings.request_timeout_s,
            headers={"authorization": f"Bearer {settings.llm_api_key}"},
        )

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return await self._local.embed(texts)

    async def chat_json(self, system: str, user: str, schema: dict[str, Any]) -> str:
        res = await self._client.post(
            "/chat/completions",
            json={
                "model": self._s.llm_model,
                "temperature": 0,
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {"name": "answer", "schema": schema, "strict": True},
                },
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            },
        )
        res.raise_for_status()
        return res.json()["choices"][0]["message"]["content"]


def make_llm(settings: Settings) -> LLM:
    if settings.llm_provider == "openai_compat":
        return HostedChatLLM(settings)
    return OllamaLLM(settings)
