from uuid import UUID

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    database_url: str
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    google_api_key: str = ""


settings = Settings()

# Stand-in until auth (design.md, build step 5). Matches db/seed.sql.
DEV_USER_ID = UUID("00000000-0000-0000-0000-000000000001")
