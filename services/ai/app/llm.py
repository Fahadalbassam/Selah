"""Model adapters. Everything goes through the LLM protocol, so swapping
Ollama for a hosted API is one new class and a config change. A hosted API
sends text to an outside company: use it with sample data only unless
firm approves."""

import json
import logging
import re
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, Protocol

import httpx

from .config import Settings


class LLM(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]: ...

    async def chat_json(self, system: str, user: str, schema: dict[str, Any]) -> str: ...

    def chat_json_stream(self, system: str, user: str, schema: dict[str, Any]) -> AsyncIterator[str]:
        """The same reply as chat_json, in pieces as the model writes it."""
        ...


log = logging.getLogger("uvicorn.error")

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

    def _chat(self, messages: list[dict[str, str]], schema: dict[str, Any], stream: bool) -> dict[str, Any]:
        return {
            "model": self._s.llm_model,
            "stream": stream,
            "format": schema,  # structured output: the reply must match the schema
            # qwen3 otherwise writes a long hidden reasoning before every answer,
            # which on a processor takes minutes. The passages carry the facts.
            "think": False,
            "keep_alive": KEEP_ALIVE,
            # Without num_ctx Ollama picks the context size from the graphics
            # memory (about 4,000 tokens on small cards) and silently drops the
            # start of a long prompt: the rules or the first passages.
            "options": {"temperature": 0, "num_ctx": self._s.llm_num_ctx},
            "messages": messages,
        }

    def _check_context(self, event: dict[str, Any]) -> None:
        read = event.get("prompt_eval_count")
        if isinstance(read, int) and read >= self._s.llm_num_ctx:
            log.warning(
                "local model: the prompt filled the whole context (%s of %s tokens); part of it was probably cut. Raise LLM_NUM_CTX or send fewer passages.",
                read,
                self._s.llm_num_ctx,
            )

    async def _complete(self, messages: list[dict[str, str]], schema: dict[str, Any]) -> str:
        res = await self._client.post("/api/chat", json=self._chat(messages, schema, stream=False))
        res.raise_for_status()
        body = res.json()
        self._check_context(body)
        return body["message"]["content"] or ""

    async def chat_json(self, system: str, user: str, schema: dict[str, Any]) -> str:
        # format is not always obeyed (an open report for qwen3.5 with thinking
        # off, which is how this calls it), so the reply is checked as well.
        return await json_with_one_retry(_messages(system, user), schema, self._complete)

    async def chat_json_stream(self, system: str, user: str, schema: dict[str, Any]) -> AsyncIterator[str]:
        # No retry here: the caller checks the whole reply and asks again with chat_json.
        async with self._client.stream("POST", "/api/chat", json=self._chat(_messages(system, user), schema, stream=True)) as res:
            res.raise_for_status()
            async for line in res.aiter_lines():
                if not line.strip():
                    continue
                event = json.loads(line)
                piece = event.get("message", {}).get("content")
                if piece:
                    yield piece
                if event.get("done"):
                    self._check_context(event)
                    # Where a slow answer's time went: reading the passages, or writing.
                    log.info(
                        "local model: read %s tokens in %.1f s, wrote %s tokens in %.1f s (load %.1f s)",
                        event.get("prompt_eval_count"),
                        event.get("prompt_eval_duration", 0) / 1e9,
                        event.get("eval_count"),
                        event.get("eval_duration", 0) / 1e9,
                        event.get("load_duration", 0) / 1e9,
                    )


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
        # reply is checked: one retry if it still isn't a JSON object.
        return await json_with_one_retry(_messages(system, user), schema, self._complete)

    async def chat_json_stream(self, system: str, user: str, schema: dict[str, Any]) -> AsyncIterator[str]:
        # No retry here: the caller checks the whole reply and asks again with chat_json.
        async with self._client.stream("POST", "/chat/completions", json=self._body(_messages(system, user), schema, stream=True)) as res:
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


def _messages(system: str, user: str) -> list[dict[str, str]]:
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


async def json_with_one_retry(
    messages: list[dict[str, str]],
    schema: dict[str, Any],
    complete: Callable[[list[dict[str, str]], dict[str, Any]], Awaitable[str]],
) -> str:
    """Ask the model, pull the JSON object out of its reply, and ask once more
    if there is none. Returns the raw reply if both tries fail, so the caller's
    own check marks the answer as not grounded."""
    raw = await complete(messages, schema)
    found = json_object(raw)
    if found is None:
        retry = [*messages, {"role": "assistant", "content": raw}, {"role": "user", "content": RETRY_JSON}]
        found = json_object(await complete(retry, schema))
    return found if found is not None else raw


def make_llm(settings: Settings) -> LLM:
    if settings.llm_provider == "openai_compat":
        return HostedChatLLM(settings)
    return OllamaLLM(settings)
