"""Model adapters. Everything goes through the LLM protocol, so swapping
Ollama for a hosted API is one new class and a config change. A hosted API
sends text to an outside company: use it with synthetic data only unless
the firm approves."""

from typing import Any, Protocol

import httpx

from .config import Settings


class LLM(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]: ...

    async def chat_json(self, system: str, user: str, schema: dict[str, Any]) -> str: ...


class OllamaLLM:
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
