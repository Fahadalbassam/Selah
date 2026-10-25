"""Model adapters. Everything goes through the LLM protocol, so swapping
Ollama for a hosted API is one new class and a config change. A hosted API
sends text to an outside company: use it with sample data only unless
firm approves."""

import json
import re
from collections.abc import AsyncIterator
from typing import Any, Protocol

import httpx

from .config import Settings


class LLM(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]: ...

    async def chat_json(self, system: str, user: str, schema: dict[str, Any]) -> str: ...

    def chat_json_stream(self, system: str, user: str, schema: dict[str, Any]) -> AsyncIterator[str]:
        """The same reply as chat_json, in pieces as the model writes it."""
        ...


# How long a local model stays loaded after a request. Ollama's default is five
# minutes, after which the next question first reloads the model from disk
# (tens of seconds on a processor).
KEEP_ALIVE = "30m"


class OllamaLLM:
    """Embeddings and chat through a local Ollama server."""

    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._client = httpx.AsyncClient(base_url=settings.ollama_url, timeout=settings.request_timeout_s)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        res = await self._client.post("/api/embed", json={"model": self._s.embed_model, "input": texts, "keep_alive": KEEP_ALIVE})
        res.raise_for_status()
        return res.json()["embeddings"]

    def _chat(self, system: str, user: str, schema: dict[str, Any], stream: bool) -> dict[str, Any]:
        return {
            "model": self._s.llm_model,
            "stream": stream,
            "format": schema,  # structured output: the reply must match the schema
            # qwen3 otherwise writes a long hidden reasoning before every answer,
            # which on a processor takes minutes. The passages carry the facts.
            "think": False,
            "keep_alive": KEEP_ALIVE,
            "options": {"temperature": 0},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }

    async def chat_json(self, system: str, user: str, schema: dict[str, Any]) -> str:
        res = await self._client.post("/api/chat", json=self._chat(system, user, schema, stream=False))
        res.raise_for_status()
        return res.json()["message"]["content"]

    async def chat_json_stream(self, system: str, user: str, schema: dict[str, Any]) -> AsyncIterator[str]:
        async with self._client.stream("POST", "/api/chat", json=self._chat(system, user, schema, stream=True)) as res:
            res.raise_for_status()
            async for line in res.aiter_lines():
                if not line.strip():
                    continue
                piece = json.loads(line).get("message", {}).get("content")
                if piece:
                    yield piece


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
        # Some providers accept response_format but ignore it (Ollama's cloud
        # does, tested 2026-10-22), so the prompt also asks for JSON and the
        # reply is checked here: one retry if it still isn't a JSON object.
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        raw = await self._complete(messages, schema)
        found = json_object(raw)
        if found is None:
            retry = [*messages, {"role": "assistant", "content": raw}, {"role": "user", "content": RETRY_JSON}]
            found = json_object(await self._complete(retry, schema))
        return found if found is not None else raw

    async def chat_json_stream(self, system: str, user: str, schema: dict[str, Any]) -> AsyncIterator[str]:
        # No retry here: the caller checks the whole reply and asks again with chat_json.
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        async with self._client.stream("POST", "/chat/completions", json=self._body(messages, schema, stream=True)) as res:
            res.raise_for_status()
            async for line in res.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                choices = json.loads(data).get("choices") or [{}]
                # A reasoning model's thinking comes in another field and is not shown.
                piece = (choices[0].get("delta") or {}).get("content")
                if piece:
                    yield piece

    def _body(self, messages: list[dict[str, str]], schema: dict[str, Any], stream: bool) -> dict[str, Any]:
        return {
            "model": self._s.llm_model,
            "temperature": 0,
            "stream": stream,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "answer", "schema": schema, "strict": True},
            },
            "messages": messages,
        }

    async def _complete(self, messages: list[dict[str, str]], schema: dict[str, Any]) -> str:
        res = await self._client.post("/chat/completions", json=self._body(messages, schema, stream=False))
        res.raise_for_status()
        return res.json()["choices"][0]["message"]["content"] or ""


RETRY_JSON = "Your reply was not valid JSON. Reply again with the JSON object only, matching the format in the instructions."
_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$")


def json_object(raw: str) -> str | None:
    """The JSON object in a model reply, tolerating a code fence or words
    around it; None if there is no object."""
    text = _FENCE.sub("", raw.strip())
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        return None
    candidate = text[start : end + 1]
    try:
        return candidate if isinstance(json.loads(candidate), dict) else None
    except json.JSONDecodeError:
        return None


def make_llm(settings: Settings) -> LLM:
    if settings.llm_provider == "openai_compat":
        return HostedChatLLM(settings)
    return OllamaLLM(settings)
