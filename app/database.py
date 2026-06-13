from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings


if settings.database_url.startswith("sqlite:///"):
    db_path = settings.database_url.removeprefix("sqlite:///")
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False}
    if settings.database_url.startswith("sqlite")
    else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def ensure_device_columns() -> None:
    inspector = inspect(engine)
    if "devices" not in inspector.get_table_names():
        return

    existing = {column["name"] for column in inspector.get_columns("devices")}
    columns = {
        "last_pir_motion": "BOOLEAN NOT NULL DEFAULT 0",
        "last_radar_online": "BOOLEAN",
        "last_presence_detected": "BOOLEAN",
        "last_moving_detected": "BOOLEAN",
        "last_stationary_detected": "BOOLEAN",
        "last_radar_distance_cm": "INTEGER",
        "last_pressure_detected": "BOOLEAN NOT NULL DEFAULT 0",
        "battery_level": "INTEGER",
        "wifi_rssi": "INTEGER",
        "location": "VARCHAR(100)",
        "name": "VARCHAR(100)",
        "room_name": "VARCHAR(100)",
        "sensor_types": "VARCHAR(255) NOT NULL DEFAULT 'pir,pressure,battery,wifi'",
        "risk_profile": "VARCHAR(50) NOT NULL DEFAULT 'default'",
        "is_active": "BOOLEAN NOT NULL DEFAULT 1",
        "guardian_name": "VARCHAR(100)",
        "guardian_phone": "VARCHAR(30)",
        "guardian_relation": "VARCHAR(50)",
        "worker_name": "VARCHAR(100)",
        "worker_phone": "VARCHAR(30)",
        "emergency_priority": "VARCHAR(50) NOT NULL DEFAULT 'guardian_first'",
        "center_phone": "VARCHAR(30)",
    }
    with engine.begin() as connection:
        for name, definition in columns.items():
            if name not in existing:
                connection.execute(
                    text(f"ALTER TABLE devices ADD COLUMN {name} {definition}")
                )


def ensure_sensor_log_columns() -> None:
    inspector = inspect(engine)
    if "sensor_logs" not in inspector.get_table_names():
        return

    existing = {column["name"] for column in inspector.get_columns("sensor_logs")}
    columns = {
        "radar_online": "BOOLEAN",
        "presence_detected": "BOOLEAN",
        "moving_detected": "BOOLEAN",
        "stationary_detected": "BOOLEAN",
        "radar_distance_cm": "INTEGER",
        "moving_distance_cm": "INTEGER",
        "stationary_distance_cm": "INTEGER",
        "moving_signal": "INTEGER",
        "stationary_signal": "INTEGER",
        "radar_state": "VARCHAR(30)",
    }
    with engine.begin() as connection:
        for name, definition in columns.items():
            if name not in existing:
                connection.execute(
                    text(f"ALTER TABLE sensor_logs ADD COLUMN {name} {definition}")
                )


def ensure_alert_columns() -> None:
    inspector = inspect(engine)
    if "alerts" not in inspector.get_table_names():
        return

    existing = {column["name"] for column in inspector.get_columns("alerts")}
    columns = {
        "resolution_detail": "TEXT",
        "workflow_stage": "VARCHAR(40) NOT NULL DEFAULT 'danger_detected'",
        "stage_updated_at": "DATETIME",
    }
    with engine.begin() as connection:
        for name, definition in columns.items():
            if name not in existing:
                connection.execute(
                    text(f"ALTER TABLE alerts ADD COLUMN {name} {definition}")
                )
        connection.execute(
            text(
                "UPDATE alerts SET stage_updated_at = created_at "
                "WHERE stage_updated_at IS NULL"
            )
        )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
