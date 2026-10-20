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
from .llm import LLM, OllamaLLM
from .prompt import ANSWER_SCHEMA, Answer, Passage, build_messages, check_answer

app = FastAPI(title="Selah AI service", docs_url=None, redoc_url=None, openapi_url=None)

_llm: LLM | None = None


def get_llm(settings: Annotated[Settings, Depends(get_settings)]) -> LLM:
    global _llm
    if _llm is None:
        _llm = OllamaLLM(settings)
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
