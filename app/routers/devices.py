from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Device, utc_now
from app.schemas import (
    ContactResponse,
    ContactUpdate,
    DeviceCreate,
    DeviceResponse,
    DeviceUpdate,
)


router = APIRouter(prefix="/api/devices", tags=["device management"])


def find_device(db: Session, device_id: str) -> Device:
    device = db.scalar(select(Device).where(Device.device_id == device_id))
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


def contact_response(device: Device) -> ContactResponse:
    return ContactResponse(
        device_id=device.device_id,
        device_name=device.name or device.device_id,
        guardian_name=device.guardian_name,
        guardian_phone=device.guardian_phone,
        guardian_relation=device.guardian_relation,
        worker_name=device.worker_name,
        worker_phone=device.worker_phone,
        emergency_priority=device.emergency_priority,
        center_phone=device.center_phone,
    )


@router.post("", response_model=DeviceResponse, status_code=status.HTTP_201_CREATED)
def create_device(payload: DeviceCreate, db: Session = Depends(get_db)):
    if db.scalar(select(Device).where(Device.device_id == payload.device_id)):
        raise HTTPException(status_code=409, detail="Device ID already exists")

    now = utc_now()
    device = Device(
        device_id=payload.device_id,
        name=payload.name,
        location=payload.location,
        room_name=payload.room_name,
        sensor_types=",".join(payload.sensor_types),
        risk_profile=payload.risk_profile,
        is_active=payload.is_active,
        last_seen_at=now,
        last_activity_at=now,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


@router.put("/{device_id}", response_model=DeviceResponse)
def update_device(
    device_id: str,
    payload: DeviceUpdate,
    db: Session = Depends(get_db),
):
    device = find_device(db, device_id)
    device.name = payload.name
    device.location = payload.location
    device.room_name = payload.room_name
    device.sensor_types = ",".join(payload.sensor_types)
    device.risk_profile = payload.risk_profile
    device.is_active = payload.is_active
    if not device.is_active:
        device.status = "normal"
    db.commit()
    db.refresh(device)
    return device


@router.post("/{device_id}/toggle-active", response_model=DeviceResponse)
def toggle_device_active(device_id: str, db: Session = Depends(get_db)):
    device = find_device(db, device_id)
    device.is_active = not device.is_active
    if not device.is_active:
        device.status = "normal"
    db.commit()
    db.refresh(device)
    return device


@router.get("/{device_id}/contacts", response_model=ContactResponse)
def get_contacts(device_id: str, db: Session = Depends(get_db)):
    return contact_response(find_device(db, device_id))


@router.put("/{device_id}/contacts", response_model=ContactResponse)
def update_contacts(
    device_id: str,
    payload: ContactUpdate,
    db: Session = Depends(get_db),
):
    device = find_device(db, device_id)
    for field, value in payload.model_dump().items():
        setattr(device, field, value)
    db.commit()
    db.refresh(device)
    return contact_response(device)
