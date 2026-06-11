from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Alert, Device, SensorLog, utc_now
from app.schemas import SimulationCreate, SimulationResponse
from app.services.alert_service import resolve_open_alerts
from app.services.status_service import inactive_seconds, refresh_device_status


router = APIRouter(prefix="/api/simulation", tags=["simulation"])


def ensure_enabled() -> None:
    if not settings.simulation_enabled:
        raise HTTPException(status_code=404, detail="Simulation mode is disabled")


@router.get("")
def get_simulation_config():
    return {
        "enabled": settings.simulation_enabled,
        "threshold_seconds": settings.inactivity_threshold_seconds,
    }


@router.post("/scenario", response_model=SimulationResponse)
def create_scenario(payload: SimulationCreate, db: Session = Depends(get_db)):
    ensure_enabled()
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

    threshold = settings.inactivity_threshold_seconds
    if payload.scenario == "normal":
        elapsed = 0
    elif payload.scenario == "warning":
        elapsed = max(1, min(threshold - 1, int(threshold * 0.6)))
    else:
        elapsed = threshold + 5

    device.last_seen_at = now
    device.last_activity_at = now - timedelta(seconds=elapsed)
    device.last_pressure_value = 1200
    device.last_pir_motion = payload.scenario == "normal"
    device.last_pressure_detected = payload.scenario != "normal"
    device.battery_level = 87
    device.wifi_rssi = -58
    device.location = "침실"

    if payload.scenario != "danger":
        resolve_open_alerts(db, device, reason="simulation_state_changed")
    refresh_device_status(db, device, now)

    db.add(
        SensorLog(
            device_id=device.id,
            pir_motion=payload.scenario == "normal",
            pressure_detected=False,
            pressure_value=1200,
            pressure_delta=0,
            activity_detected=payload.scenario == "normal",
            received_at=now,
        )
    )
    db.commit()

    return SimulationResponse(
        message="simulation scenario applied",
        device_id=device.device_id,
        scenario=payload.scenario,
        status=device.status,
        inactive_seconds=inactive_seconds(device, now),
    )


@router.delete("/devices/{device_id}")
def delete_simulation_device(
    device_id: str = Path(pattern=r"^demo-[A-Za-z0-9_-]+$"),
    db: Session = Depends(get_db),
):
    ensure_enabled()
    device = db.scalar(select(Device).where(Device.device_id == device_id))
    if device is None:
        return {"message": "simulation device not found", "deleted_count": 0}

    db.execute(delete(Alert).where(Alert.device_id == device.id))
    db.execute(delete(SensorLog).where(SensorLog.device_id == device.id))
    db.delete(device)
    db.commit()
    return {"message": "simulation device deleted", "deleted_count": 1}
