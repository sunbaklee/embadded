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

    # 압력 변화량은 이번 패킷이 압력 값을 보냈을 때만 계산한다.
    pressure_delta = None
    pressure_activity = False
    if payload.pressure_value is not None:
        if device.last_pressure_value is not None:
            pressure_delta = abs(payload.pressure_value - device.last_pressure_value)
            pressure_activity = pressure_delta >= settings.pressure_delta_threshold
        device.last_pressure_value = payload.pressure_value

    # Presence is stored as the current occupancy state, but inactivity time is
    # reset only by actual movement (or a meaningful pressure change).
    activity_detected = bool(payload.pir_motion) or pressure_activity

    device.last_seen_at = now
    # 부분 업데이트: 보낸 필드만 갱신해 보드끼리 서로의 값을 덮어쓰지 않게 한다.
    if payload.pir_motion is not None:
        device.last_pir_motion = payload.pir_motion
    if payload.radar_online is not None:
        device.last_radar_online = payload.radar_online
    if payload.presence_detected is not None:
        device.last_presence_detected = payload.presence_detected
    if payload.moving_detected is not None:
        device.last_moving_detected = payload.moving_detected
    if payload.stationary_detected is not None:
        device.last_stationary_detected = payload.stationary_detected
    if payload.radar_distance_cm is not None:
        device.last_radar_distance_cm = payload.radar_distance_cm
    if payload.pressure_detected is not None:
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

    # 이번 패킷이 보내지 않은 센서 값은 장치의 현재 상태로 채워 스냅샷을 남긴다.
    log = SensorLog(
        device_id=device.id,
        pir_motion=device.last_pir_motion,
        radar_online=payload.radar_online,
        presence_detected=payload.presence_detected,
        moving_detected=payload.moving_detected,
        stationary_detected=payload.stationary_detected,
        radar_distance_cm=payload.radar_distance_cm,
        moving_distance_cm=payload.moving_distance_cm,
        stationary_distance_cm=payload.stationary_distance_cm,
        moving_signal=payload.moving_signal,
        stationary_signal=payload.stationary_signal,
        radar_state=payload.state,
        pressure_detected=device.last_pressure_detected,
        pressure_value=device.last_pressure_value or 0.0,
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
