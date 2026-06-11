import os
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Settings:
    app_name = os.getenv("APP_NAME", "IoT LoneCare")
    app_env = os.getenv("APP_ENV", "production")
    simulation_enabled = os.getenv(
        "SIMULATION_ENABLED",
        "true" if app_env == "development" else "false",
    ).lower() in {"1", "true", "yes", "on"}
    database_url = os.getenv(
        "DATABASE_URL", f"sqlite:///{BASE_DIR / 'data' / 'lonecare.db'}"
    )
    inactivity_threshold_seconds = int(
        os.getenv("INACTIVITY_THRESHOLD_SECONDS", "43200")
    )
    pressure_delta_threshold = int(os.getenv("PRESSURE_DELTA_THRESHOLD", "100"))
    log_limit_max = int(os.getenv("LOG_LIMIT_MAX", "500"))


settings = Settings()
