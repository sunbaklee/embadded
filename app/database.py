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
        "last_pressure_detected": "BOOLEAN NOT NULL DEFAULT 0",
        "battery_level": "INTEGER",
        "wifi_rssi": "INTEGER",
        "location": "VARCHAR(100)",
    }
    with engine.begin() as connection:
        for name, definition in columns.items():
            if name not in existing:
                connection.execute(
                    text(f"ALTER TABLE devices ADD COLUMN {name} {definition}")
                )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
