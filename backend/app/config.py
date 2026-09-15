from uuid import UUID

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"  # "production" on the host
    database_url: str

    # Sign-in with Supabase Auth, e.g. https://abcd1234.supabase.co.
    # Empty = no sign-in: local development with a built-in dev user.
    supabase_url: str = ""

    # Encrypts users' saved API keys (a Fernet key: 32 url-safe base64-encoded bytes).
    key_encryption_key: str = ""

    # Browser origins allowed to call the API directly, comma-separated.
    cors_origins: str = "http://localhost:5173"

    # Local development only: provider keys for the dev user when none are saved.
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    google_api_key: str = ""

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def auth_enabled(self) -> bool:
        return bool(self.supabase_url)

    @model_validator(mode="after")
    def _production_requires_auth(self):
        # Never go live without sign-in: everyone would share one account.
        if self.is_production:
            missing = [
                name
                for name, value in (("SUPABASE_URL", self.supabase_url), ("KEY_ENCRYPTION_KEY", self.key_encryption_key))
                if not value
            ]
            if missing:
                raise ValueError(f"ENVIRONMENT=production requires {', '.join(missing)}")
        return self


settings = Settings()

# Local development without sign-in uses this user. Matches db/seed.sql.
DEV_USER_ID = UUID("00000000-0000-0000-0000-000000000001")
