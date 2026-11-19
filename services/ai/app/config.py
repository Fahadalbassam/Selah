from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration from the environment. No database settings on purpose:
    this service only ever sees passages the web app already authorized."""

    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    ai_service_token: str = Field(min_length=32)
    ollama_url: str = "http://localhost:11434"
    embed_model: str = "bge-m3"

    # Chat model provider. "ollama" runs locally (qwen3.5:4b, about 3.3 GB,
    # runs on the processor; a GTX 1050 has 2 GB, too little to hold it, and
    # Pascal cards need Ollama's CUDA 12 build to use the card at all).
    # "openai_compat" calls any hosted API that speaks the OpenAI
    # chat-completions format; use it with sample data only unless the
    # firm approves sending documents to that provider.
    llm_provider: Literal["ollama", "openai_compat"] = "ollama"
    llm_model: str = "qwen3.5:4b"
    # Context size for the local model, in tokens. Ollama otherwise picks one
    # from the graphics memory (about 4,000 tokens on small cards) and cuts
    # longer prompts without an error. The upper bound keeps a typo from
    # reserving more memory than the server has (16384 is about 2.3 GB of
    # cache for a 4B model).
    llm_num_ctx: int = Field(default=16384, ge=2048, le=131072)
    llm_api_base: str = ""
    llm_api_key: str = ""
    # Connecting to the model server, sending, and embeddings.
    request_timeout_s: float = 120.0
    # How long a chat model may take before its reply (or, streamed, before
    # its next piece). On a processor a model reads a long prompt for minutes
    # before its first word (section 7 test run: up to about 6 minutes for a
    # whole answer), so this matches the web's 10-minute stream limit.
    llm_timeout_s: float = Field(default=600.0, gt=0)
    max_passages: int = 12
    max_passage_chars: int = 4000
    max_question_chars: int = 2000


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
