from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Device, SensorLog, utc_now
from app.schemas import SensorDataCreate, SensorDataResponse
from app.services.alert_service import resolve_open_alerts_for_activity
from app.services.status_service import refresh_device_status


router = APIRouter(prefix="/api", tags=["sensor"])


@router.post(
    "/sensor-data",
    response_model=SensorDataResponse,
    status_code=status.HTTP_201_CREATED,
)
def receive_sensor_data(payload: SensorDataCreate, db: Session = Depends(get_db)):
    now = utc_now()
    device = db.scalar(select(Device).where(Device.device_id == payload.device_id))
    if device is None:
        device = Device(
            device_id=payload.device_id,
            last_seen_at=now,
            last_activity_at=now,
        )
        db.add(device)
        db.flush()

    pressure_delta = (
        abs(payload.pressure_value - device.last_pressure_value)
        if device.last_pressure_value is not None
        else None
    )
    activity_detected = payload.pir_motion or (
        pressure_delta is not None
        and pressure_delta >= settings.pressure_delta_threshold
    )

    device.last_seen_at = now
    device.last_pressure_value = payload.pressure_value
    device.last_pir_motion = payload.pir_motion
    device.last_pressure_detected = payload.pressure_detected
    if payload.battery_level is not None:
        device.battery_level = payload.battery_level
    if payload.wifi_rssi is not None:
        device.wifi_rssi = payload.wifi_rssi
    if payload.location is not None:
        device.location = payload.location
    if activity_detected:
        device.last_activity_at = now
        device.status = "normal"
        resolve_open_alerts_for_activity(db, device)
    else:
        refresh_device_status(db, device, now)

    log = SensorLog(
        device_id=device.id,
        pir_motion=payload.pir_motion,
        pressure_detected=payload.pressure_detected,
        pressure_value=payload.pressure_value,
        pressure_delta=pressure_delta,
        activity_detected=activity_detected,
        received_at=now,
    )
    db.add(log)
    db.commit()

    return SensorDataResponse(
        message="sensor data stored",
        device_id=device.device_id,
        activity_detected=activity_detected,
        pressure_delta=pressure_delta,
        status=device.status,
        received_at=now,
    )
