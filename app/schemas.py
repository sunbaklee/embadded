from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SensorDataCreate(BaseModel):
    device_id: str = Field(min_length=1, max_length=100)
    pir_motion: bool
    pressure_detected: bool
    pressure_value: float
    battery_level: int | None = Field(default=None, ge=0, le=100)
    wifi_rssi: int | None = Field(default=None, ge=-120, le=0)
    location: str | None = Field(default=None, min_length=1, max_length=100)


class SensorDataResponse(BaseModel):
    message: str
    device_id: str
    activity_detected: bool
    pressure_delta: float | None
    status: str
    received_at: datetime


class DeviceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    device_id: str
    status: str
    last_seen_at: datetime
    last_activity_at: datetime
    last_pressure_value: float | None
    last_pir_motion: bool
    last_pressure_detected: bool
    battery_level: int | None
    wifi_rssi: int | None
    location: str | None
    created_at: datetime


class StatusResponse(DeviceResponse):
    inactive_seconds: int
    threshold_seconds: int


class LogResponse(BaseModel):
    id: int
    device_id: str
    pir_motion: bool
    pressure_detected: bool
    pressure_value: float
    pressure_delta: float | None
    activity_detected: bool
    received_at: datetime


class ActivityBucketResponse(BaseModel):
    started_at: datetime
    ended_at: datetime
    total_count: int
    activity_count: int


class AlertResponse(BaseModel):
    id: int
    device_id: str
    level: str
    message: str
    is_resolved: bool
    created_at: datetime
    resolved_at: datetime | None
    resolved_reason: str | None


class SimulationCreate(BaseModel):
    device_id: str = Field(
        default="demo-room-001",
        min_length=6,
        max_length=100,
        pattern=r"^demo-[A-Za-z0-9_-]+$",
    )
    scenario: Literal["normal", "warning", "danger"]


class SimulationResponse(BaseModel):
    message: str
    device_id: str
    scenario: str
    status: str
    inactive_seconds: int
