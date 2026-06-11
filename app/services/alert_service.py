from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Alert, Device, utc_now


def create_danger_alert_if_needed(db: Session, device: Device) -> Alert | None:
    open_alert = db.scalar(
        select(Alert).where(
            Alert.device_id == device.id,
            Alert.level == "danger",
            Alert.is_resolved.is_(False),
        )
    )
    if open_alert:
        return None

    alert = Alert(
        device_id=device.id,
        level="danger",
        message=f"{device.device_id}: 무활동 위험 기준 시간을 초과했습니다.",
    )
    db.add(alert)
    return alert


def resolve_open_alerts_for_activity(db: Session, device: Device) -> None:
    alerts = db.scalars(
        select(Alert).where(
            Alert.device_id == device.id,
            Alert.is_resolved.is_(False),
        )
    ).all()
    now = utc_now()
    for alert in alerts:
        alert.is_resolved = True
        alert.resolved_at = now
        alert.resolved_reason = "activity_detected"
