import os
import sys
from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _is_packaged() -> bool:
    if os.environ.get("MAI_PACKAGED"):
        return True
    return getattr(sys, "frozen", False)  # PyInstaller sets this


def _user_data_dir(app_name: str = "MAI") -> Path:
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / app_name
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / app_name
    xdg = os.environ.get("XDG_DATA_HOME")
    base = Path(xdg) if xdg else Path.home() / ".local" / "share"
    return base / app_name


def _default_data_dir() -> Path:
    if _is_packaged():
        return _user_data_dir()
    # Dev mode: keep everything under the backend working directory.
    return Path(".")


def _default_database_url(data_dir: Path) -> str:
    db_path = (data_dir / "mai.sqlite3").resolve()
    return f"sqlite+aiosqlite:///{db_path.as_posix()}"


class Settings(BaseSettings):
    app_name: str = "MAI"
    data_dir: Path = Field(default_factory=_default_data_dir)
    database_url: str = ""
    trace_payload_dir: Path = Path("trace_payloads")
    upload_dir: Path = Path("uploads")
    cors_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173,tauri://localhost,http://tauri.localhost",
        description="Comma-separated CORS origins.",
    )

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @model_validator(mode="after")
    def _resolve_paths(self) -> "Settings":
        if not self.database_url:
            self.database_url = _default_database_url(self.data_dir)
        if _is_packaged():
            # In packaged mode trace + upload dirs default under the user data dir
            # so we don't write next to the executable.
            if self.trace_payload_dir == Path("trace_payloads"):
                self.trace_payload_dir = self.data_dir / "trace_payloads"
            if self.upload_dir == Path("uploads"):
                self.upload_dir = self.data_dir / "uploads"
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
