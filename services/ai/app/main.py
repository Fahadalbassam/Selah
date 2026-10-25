"""Selah AI service: embeddings and grounded answers.

It holds no database credentials and never fetches documents itself. The web
app authorizes the user, runs the permission-filtered retrieval, and sends
only the surviving passages here. Every call needs the shared service token.
"""

import asyncio
import hmac
import json
import time
from collections.abc import AsyncIterator
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .config import Settings, get_settings
from .llm import LLM, json_object, make_llm
from .prompt import (
    ANSWER_SCHEMA,
    SUMMARY_SCHEMA,
    TRANSLATION_SCHEMA,
    Answer,
    AnswerText,
    HistoryTurn,
    Passage,
    build_messages,
    build_summary_messages,
    build_translation_messages,
    check_answer,
    check_summary,
    check_translation,
)

app = FastAPI(title="Selah AI service", docs_url=None, redoc_url=None, openapi_url=None)

_llm: LLM | None = None


def get_llm(settings: Annotated[Settings, Depends(get_settings)]) -> LLM:
    global _llm
    if _llm is None:
        _llm = make_llm(settings)
    return _llm


def require_token(
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    expected = f"Bearer {settings.ai_service_token}"
    if authorization is None or not hmac.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


class EmbedRequest(BaseModel):
    texts: list[Annotated[str, Field(min_length=1, max_length=8000)]] = Field(min_length=1, max_length=64)


class EmbedResponse(BaseModel):
    vectors: list[list[float]]


class AnswerRequest(BaseModel):
    question: str = Field(min_length=1)
    passages: list[Passage]
    language: Literal["ar", "en", "auto"] = "auto"
    history: list[HistoryTurn] = Field(default_factory=list, max_length=8)
    # "client": a person at the client organisation; extra rules apply (prompt.CLIENT_RULES).
    audience: Literal["staff", "client"] = "staff"


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    source: Literal["ar", "en"]
    target: Literal["ar", "en"]


class TranslateResponse(BaseModel):
    text: str
    model: str


class SummaryPage(BaseModel):
    n: int = Field(ge=1)
    text: str = Field(max_length=20000)


class SummarizeRequest(BaseModel):
    pages: list[SummaryPage] = Field(min_length=1, max_length=200)
    lang: Literal["ar", "en"]
    max_lines: int = Field(default=8, ge=1, le=20)


class SummaryPoint(BaseModel):
    text: str
    pages: list[int]


class SummarizeResponse(BaseModel):
    points: list[SummaryPoint]
    model: str


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/v1/embed", dependencies=[Depends(require_token)])
async def embed(req: EmbedRequest, llm: Annotated[LLM, Depends(get_llm)]) -> EmbedResponse:
    return EmbedResponse(vectors=await llm.embed(req.texts))


def _check_size(req: AnswerRequest, settings: Settings) -> None:
    # OWASP LLM10: bound what one request can consume.
    if len(req.question) > settings.max_question_chars or len(req.passages) > settings.max_passages:
        raise HTTPException(status_code=413, detail="request too large")
    if any(len(p.text) > settings.max_passage_chars for p in req.passages):
        raise HTTPException(status_code=413, detail="passage too large")


@app.post("/v1/answer", dependencies=[Depends(require_token)])
async def answer(
    req: AnswerRequest,
    llm: Annotated[LLM, Depends(get_llm)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Answer:
    _check_size(req, settings)
    if not req.passages:
        return Answer(answer="", cited_ids=[], grounded=False)

    system, user = build_messages(req.question, req.passages, req.language, req.history, req.audience)
    raw = await llm.chat_json(system, user, ANSWER_SCHEMA)
    return check_answer(raw, req.passages)


# At most this often a "text" line while the answer is written: the screen
# needs no more, and each line repeats the answer so far.
TEXT_EVERY_S = 0.1
# While a reply is asked for again whole, a {"type": "wait"} line this often keeps the caller's idle timer from firing.
WAIT_EVERY_S = 15.0


@app.post("/v1/answer/stream", dependencies=[Depends(require_token)])
async def answer_stream(
    req: AnswerRequest,
    llm: Annotated[LLM, Depends(get_llm)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> StreamingResponse:
    """The same answer as /v1/answer, as lines of JSON while the model writes:
    {"type": "text", "text": the answer so far} now and then, then
    {"type": "done", "answer": the checked answer}, with {"type": "wait"} now
    and then while a reply that wasn't JSON is asked for again. Only the done line counts:
    the text lines are unchecked, for showing progress. A failure after the
    first line is {"type": "error"}."""
    _check_size(req, settings)

    async def lines() -> AsyncIterator[str]:
        if not req.passages:
            yield _line({"type": "done", "answer": Answer(answer="", cited_ids=[], grounded=False).model_dump()})
            return
        system, user = build_messages(req.question, req.passages, req.language, req.history, req.audience)
        partial = AnswerText()
        raw, shown, last = "", "", 0.0
        try:
            async for piece in llm.chat_json_stream(system, user, ANSWER_SCHEMA):
                raw += piece
                partial.feed(piece)
                now = time.monotonic()
                if now - last >= TEXT_EVERY_S and (text := partial.text()) != shown:
                    shown, last = text, now
                    yield _line({"type": "text", "text": text})
            found = json_object(raw)
            if found is None:
                # Not JSON: asked again whole, which for a hosted model includes its own retry.
                again = asyncio.ensure_future(llm.chat_json(system, user, ANSWER_SCHEMA))
                while not (await asyncio.wait({again}, timeout=WAIT_EVERY_S))[0]:
                    yield _line({"type": "wait"})
                found = json_object(again.result())
            yield _line({"type": "done", "answer": check_answer(found or raw, req.passages).model_dump()})
        except Exception:  # noqa: BLE001 - the caller only needs to know it failed
            yield _line({"type": "error"})

    return StreamingResponse(lines(), media_type="application/x-ndjson")


def _line(event: dict[str, object]) -> str:
    return json.dumps(event, ensure_ascii=False) + "\n"


@app.post("/v1/translate", dependencies=[Depends(require_token)])
async def translate(
    req: TranslateRequest,
    llm: Annotated[LLM, Depends(get_llm)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> TranslateResponse:
    if req.source == req.target:
        raise HTTPException(status_code=422, detail="source and target are the same")
    system, user = build_translation_messages(req.text, req.source, req.target)
    text = check_translation(await llm.chat_json(system, user, TRANSLATION_SCHEMA))
    if text is None:
        raise HTTPException(status_code=502, detail="the model gave no translation")
    return TranslateResponse(text=text, model=settings.llm_model)


@app.post("/v1/summarize", dependencies=[Depends(require_token)])
async def summarize(
    req: SummarizeRequest,
    llm: Annotated[LLM, Depends(get_llm)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SummarizeResponse:
    pages = [(p.n, p.text) for p in req.pages]
    system, user = build_summary_messages(pages, req.lang, req.max_lines)
    points = check_summary(await llm.chat_json(system, user, SUMMARY_SCHEMA), {n for n, _ in pages}, req.max_lines)
    if points is None:
        raise HTTPException(status_code=502, detail="the model gave no summary")
    return SummarizeResponse(points=[SummaryPoint(text=t, pages=c) for t, c in points], model=settings.llm_model)
