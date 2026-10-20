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

    # Chat model provider. "ollama" runs locally (a GTX 1050 fits small
    # models such as qwen3:4b). "openai_compat" calls any hosted API that
    # speaks the OpenAI chat-completions format; use it with synthetic data
    # only unless the firm approves sending documents to that provider.
    llm_provider: Literal["ollama", "openai_compat"] = "ollama"
    llm_model: str = "qwen3:4b"
    llm_api_base: str = ""
    llm_api_key: str = ""
    request_timeout_s: float = 120.0
    max_passages: int = 12
    max_passage_chars: int = 4000
    max_question_chars: int = 2000


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
