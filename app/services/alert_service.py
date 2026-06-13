from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Alert, AlertActionLog, Device, utc_now


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
        message=f"{device.device_id}: 움직임이 없어 위험 기준 시간을 초과했습니다.",
        workflow_stage="danger_detected",
    )
    db.add(alert)
    db.flush()
    db.add(
        AlertActionLog(
            alert_id=alert.id,
            stage="danger_detected",
            action_type="danger_detected",
            message="위험 기준을 초과하여 위험 알림이 생성되었습니다.",
        )
    )
    return alert


def resolve_open_alerts(
    db: Session, device: Device, reason: str = "activity_detected"
) -> None:
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
        alert.resolved_reason = reason
        alert.workflow_stage = "field_confirmed"
        alert.stage_updated_at = now


def resolve_open_alerts_for_activity(db: Session, device: Device) -> None:
    resolve_open_alerts(db, device)
