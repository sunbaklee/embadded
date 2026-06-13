from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Device, utc_now
from app.services.alert_service import create_danger_alert_if_needed


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def inactive_seconds(device: Device, now: datetime | None = None) -> int:
    current = now or utc_now()
    return max(0, int((current - as_utc(device.last_activity_at)).total_seconds()))


def calculate_status(
    device: Device,
    warning_seconds: int,
    danger_seconds: int,
    now: datetime | None = None,
) -> str:
    if not device.is_active:
        return "normal"
    elapsed = inactive_seconds(device, now)
    if elapsed >= danger_seconds:
        return "danger"
    if elapsed >= warning_seconds:
        return "warning"
    return "normal"


def refresh_device_status(
    db: Session, device: Device, now: datetime | None = None
) -> str:
    new_status = calculate_status(
        device,
        settings.warning_threshold_seconds,
        settings.inactivity_threshold_seconds,
        now,
    )
    device.status = new_status
    if new_status == "danger":
        create_danger_alert_if_needed(db, device)
    return new_status
