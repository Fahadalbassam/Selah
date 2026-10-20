from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration from the environment. No database settings on purpose:
    this service only ever sees passages the web app already authorized."""

    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    ai_service_token: str = Field(min_length=32)
    ollama_url: str = "http://localhost:11434"
    llm_model: str = "qwen3:8b"
    embed_model: str = "bge-m3"
    request_timeout_s: float = 120.0
    max_passages: int = 12
    max_passage_chars: int = 4000
    max_question_chars: int = 2000


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
