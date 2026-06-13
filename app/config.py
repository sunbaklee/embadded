import os
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _bool_env(name: str, default: bool) -> bool:
    return os.getenv(name, "true" if default else "false").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


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
    # 위험 판단 기준 (danger). 활동 미감지가 이 시간을 넘으면 위험으로 판정합니다.
    inactivity_threshold_seconds = int(
        os.getenv("INACTIVITY_THRESHOLD_SECONDS", "43200")
    )
    # 주의 판단 기준 (warning). 기본 6시간.
    warning_threshold_seconds = int(
        os.getenv("WARNING_THRESHOLD_SECONDS", "21600")
    )
    pressure_delta_threshold = int(os.getenv("PRESSURE_DELTA_THRESHOLD", "100"))
    sensor_offline_seconds = int(os.getenv("SENSOR_OFFLINE_SECONDS", "30"))
    pressure_no_motion_enabled = _bool_env("PRESSURE_NO_MOTION_ENABLED", True)
    low_battery_threshold = int(os.getenv("LOW_BATTERY_THRESHOLD", "20"))
    weak_wifi_threshold = int(os.getenv("WEAK_WIFI_THRESHOLD", "-75"))
    log_limit_max = int(os.getenv("LOG_LIMIT_MAX", "500"))


settings = Settings()
