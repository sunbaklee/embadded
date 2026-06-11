from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Alert, Device, utc_now
from app.schemas import AlertResponse
from app.services.alert_service import resolve_open_alerts


router = APIRouter(prefix="/api/alerts", tags=["alerts"])


def to_response(alert: Alert, device_id: str) -> AlertResponse:
    return AlertResponse(
        id=alert.id,
        device_id=device_id,
        level=alert.level,
        message=alert.message,
        is_resolved=alert.is_resolved,
        created_at=alert.created_at,
        resolved_at=alert.resolved_at,
        resolved_reason=alert.resolved_reason,
    )


@router.get("", response_model=list[AlertResponse])
def get_alerts(
    resolved: bool | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    statement = (
        select(Alert, Device.device_id)
        .join(Device)
        .order_by(Alert.created_at.desc())
        .limit(limit)
    )
    if resolved is not None:
        statement = statement.where(Alert.is_resolved == resolved)
    return [to_response(alert, name) for alert, name in db.execute(statement).all()]


@router.post("/{alert_id}/resolve", response_model=AlertResponse)
def resolve_alert(alert_id: int, db: Session = Depends(get_db)):
    row = db.execute(
        select(Alert, Device)
        .join(Device)
        .where(Alert.id == alert_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert, device = row
    if not alert.is_resolved:
        now = utc_now()
        resolve_open_alerts(db, device, reason="manual_safety_confirmed")
        device.last_activity_at = now
        device.status = "normal"
        db.commit()
    return to_response(alert, device.device_id)
