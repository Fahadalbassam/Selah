"""Selah AI service: embeddings and grounded answers.

It holds no database credentials and never fetches documents itself. The web
app authorizes the user, runs the permission-filtered retrieval, and sends
only the surviving passages here. Every call needs the shared service token.
"""

import hmac
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .config import Settings, get_settings
from .llm import LLM, make_llm
from .prompt import (
    ANSWER_SCHEMA,
    SUMMARY_SCHEMA,
    TRANSLATION_SCHEMA,
    Answer,
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


@app.post("/v1/answer", dependencies=[Depends(require_token)])
async def answer(
    req: AnswerRequest,
    llm: Annotated[LLM, Depends(get_llm)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Answer:
    # OWASP LLM10: bound what one request can consume.
    if len(req.question) > settings.max_question_chars or len(req.passages) > settings.max_passages:
        raise HTTPException(status_code=413, detail="request too large")
    if any(len(p.text) > settings.max_passage_chars for p in req.passages):
        raise HTTPException(status_code=413, detail="passage too large")
    if not req.passages:
        return Answer(answer="", cited_ids=[], grounded=False)

    system, user = build_messages(req.question, req.passages, req.language)
    raw = await llm.chat_json(system, user, ANSWER_SCHEMA)
    return check_answer(raw, req.passages)


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
