from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Device, SensorLog
from app.schemas import DeviceResponse, LogResponse, StatusResponse
from app.services.status_service import inactive_seconds, refresh_device_status


router = APIRouter(prefix="/api", tags=["status"])


@router.get("/status", response_model=list[StatusResponse])
def get_status(db: Session = Depends(get_db)):
    devices = db.scalars(select(Device).order_by(Device.device_id)).all()
    result = []
    for device in devices:
        refresh_device_status(db, device)
        result.append(
            StatusResponse(
                **DeviceResponse.model_validate(device).model_dump(),
                inactive_seconds=inactive_seconds(device),
                threshold_seconds=settings.inactivity_threshold_seconds,
            )
        )
    db.commit()
    return result


@router.get("/devices", response_model=list[DeviceResponse])
def get_devices(db: Session = Depends(get_db)):
    devices = db.scalars(select(Device).order_by(Device.device_id)).all()
    for device in devices:
        refresh_device_status(db, device)
    db.commit()
    return devices


@router.get("/logs", response_model=list[LogResponse])
def get_logs(
    device_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=settings.log_limit_max),
    db: Session = Depends(get_db),
):
    statement = (
        select(SensorLog, Device.device_id)
        .join(Device)
        .order_by(SensorLog.received_at.desc())
        .limit(limit)
    )
    if device_id:
        statement = statement.where(Device.device_id == device_id)

    return [
        LogResponse(
            id=log.id,
            device_id=name,
            pir_motion=log.pir_motion,
            pressure_detected=log.pressure_detected,
            pressure_value=log.pressure_value,
            pressure_delta=log.pressure_delta,
            activity_detected=log.activity_detected,
            received_at=log.received_at,
        )
        for log, name in db.execute(statement).all()
    ]
