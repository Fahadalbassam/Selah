"""Through a real server: when the web side hangs up on a streamed answer, the
AI service closes its connection to Ollama, so the model stops instead of
working on for nobody (review of PR #208, B1). A fake Ollama on a raw socket
records when its peer closes; the AI service runs in uvicorn; an httpx client
reads a few lines and hangs up."""

import asyncio
import json
import socket
import time

import httpx
import pytest
import uvicorn

from app.config import Settings, get_settings
from app.llm import OllamaLLM
from app.main import app, get_llm

TOKEN = "t" * 40


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def _hang_up_and_watch(mode: str) -> tuple[float | None, list]:
    closed: list[float] = []
    asked = asyncio.Event()

    async def fake_ollama(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        await reader.readuntil(b"\r\n\r\n")
        asked.set()
        if mode == "writing":
            writer.write(b"HTTP/1.1 200 OK\r\ncontent-type: application/x-ndjson\r\ntransfer-encoding: chunked\r\n\r\n")
        start = time.monotonic()
        try:
            while time.monotonic() - start < 10:
                if mode == "writing":
                    # A piece the screen doesn't show yet: the service sends waits meanwhile.
                    body = json.dumps({"message": {"content": " "}}).encode() + b"\n"
                    writer.write(b"%x\r\n%s\r\n" % (len(body), body))
                    await writer.drain()
                try:
                    if await asyncio.wait_for(reader.read(100), timeout=0.1) == b"":
                        closed.append(time.monotonic())
                        return
                except asyncio.TimeoutError:
                    pass
        except ConnectionError:
            closed.append(time.monotonic())
        finally:
            writer.close()

    ollama = await asyncio.start_server(fake_ollama, "127.0.0.1", 0)
    ollama_port = ollama.sockets[0].getsockname()[1]
    settings = Settings(ai_service_token=TOKEN, ollama_url=f"http://127.0.0.1:{ollama_port}")
    llm = OllamaLLM(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_llm] = lambda: llm
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    serving = asyncio.create_task(server.serve())
    try:
        while not server.started:
            await asyncio.sleep(0.02)
        seen = []
        async with httpx.AsyncClient(timeout=10) as client:
            async with client.stream(
                "POST",
                f"http://127.0.0.1:{port}/v1/answer/stream",
                headers={"authorization": f"Bearer {TOKEN}"},
                json={"question": "How often?", "passages": [{"id": "P1", "text": "The board meets quarterly.", "source": "d"}]},
            ) as res:
                async for line in res.aiter_lines():
                    seen.append(json.loads(line))
                    if len(seen) >= 2:
                        break
        hung_up = time.monotonic()
        deadline = hung_up + 5
        while not closed and time.monotonic() < deadline:
            await asyncio.sleep(0.05)
        assert asked.is_set()
        return (closed[0] - hung_up if closed else None), seen
    finally:
        server.should_exit = True
        await serving
        ollama.close()
        await llm._client.aclose()
        app.dependency_overrides.clear()


@pytest.mark.parametrize("mode", ["reading", "writing"])
def test_hanging_up_closes_the_connection_to_ollama(monkeypatch, mode):
    # "reading": Ollama sends nothing yet (the model reads the prompt);
    # "writing": it sends pieces the screen doesn't show.
    monkeypatch.setattr("app.main.WAIT_EVERY_S", 0.1)
    after, seen = asyncio.run(_hang_up_and_watch(mode))
    assert seen == [{"type": "wait"}, {"type": "wait"}]
    assert after is not None, "the AI service never closed its connection to Ollama"
    assert after < 3
