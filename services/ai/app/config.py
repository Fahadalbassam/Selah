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

    # Chat model provider. "ollama" runs locally (qwen3:4b runs on the
    # processor; a GPU needs more memory than a GTX 1050 has).
    # "openai_compat" calls any hosted API that speaks the OpenAI
    # chat-completions format; use it with sample data only unless the
    # firm approves sending documents to that provider.
    llm_provider: Literal["ollama", "openai_compat"] = "ollama"
    llm_model: str = "qwen3:4b"
    # Context size for the local model, in tokens. Ollama otherwise picks one
    # from the graphics memory (about 4,000 tokens on small cards) and cuts
    # longer prompts without an error. The upper bound keeps a typo from
    # reserving more memory than the server has (16384 is about 2.3 GB of
    # cache for qwen3:4b).
    llm_num_ctx: int = Field(default=16384, ge=2048, le=131072)
    llm_api_base: str = ""
    llm_api_key: str = ""
    request_timeout_s: float = 120.0
    max_passages: int = 12
    max_passage_chars: int = 4000
    max_question_chars: int = 2000


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
