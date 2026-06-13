from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Device, SensorLog, utc_now
from app.schemas import (
    ActivityBucketResponse,
    DeviceResponse,
    LogResponse,
    StatusResponse,
)
from app.services.status_service import as_utc
from app.services.status_service import inactive_seconds, refresh_device_status


router = APIRouter(prefix="/api", tags=["status"])


@router.get("/config")
def get_monitoring_config():
    return {
        "warning_seconds": settings.warning_threshold_seconds,
        "danger_seconds": settings.inactivity_threshold_seconds,
        "pressure_delta_threshold": settings.pressure_delta_threshold,
        "sensor_offline_seconds": settings.sensor_offline_seconds,
        "pressure_no_motion_enabled": settings.pressure_no_motion_enabled,
        "low_battery_threshold": settings.low_battery_threshold,
        "weak_wifi_threshold": settings.weak_wifi_threshold,
    }


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
            radar_online=log.radar_online,
            presence_detected=log.presence_detected,
            moving_detected=log.moving_detected,
            stationary_detected=log.stationary_detected,
            radar_distance_cm=log.radar_distance_cm,
            moving_distance_cm=log.moving_distance_cm,
            stationary_distance_cm=log.stationary_distance_cm,
            moving_signal=log.moving_signal,
            stationary_signal=log.stationary_signal,
            radar_state=log.radar_state,
            pressure_detected=log.pressure_detected,
            pressure_value=log.pressure_value,
            pressure_delta=log.pressure_delta,
            activity_detected=log.activity_detected,
            received_at=log.received_at,
        )
        for log, name in db.execute(statement).all()
    ]


@router.get("/activity", response_model=list[ActivityBucketResponse])
def get_activity(
    hours: int = Query(default=6),
    device_id: str | None = None,
    buckets: int = Query(default=12, ge=6, le=24),
    db: Session = Depends(get_db),
):
    if hours not in {1, 6, 24}:
        raise HTTPException(status_code=422, detail="hours must be 1, 6, or 24")

    end = utc_now()
    start = end - timedelta(hours=hours)
    statement = (
        select(SensorLog)
        .join(Device)
        .where(SensorLog.received_at >= start)
        .order_by(SensorLog.received_at)
    )
    if device_id:
        statement = statement.where(Device.device_id == device_id)

    bucket_seconds = hours * 3600 / buckets
    result = [
        {
            "started_at": start + timedelta(seconds=index * bucket_seconds),
            "ended_at": start + timedelta(seconds=(index + 1) * bucket_seconds),
            "total_count": 0,
            "activity_count": 0,
        }
        for index in range(buckets)
    ]

    for log in db.scalars(statement):
        elapsed = (as_utc(log.received_at) - start).total_seconds()
        index = min(buckets - 1, max(0, int(elapsed / bucket_seconds)))
        result[index]["total_count"] += 1
        if log.activity_detected:
            result[index]["activity_count"] += 1

    return [ActivityBucketResponse(**bucket) for bucket in result]
