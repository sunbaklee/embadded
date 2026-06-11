from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SensorDataCreate(BaseModel):
    device_id: str = Field(min_length=1, max_length=100)
    pir_motion: bool
    pressure_detected: bool
    pressure_value: float


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


class AlertResponse(BaseModel):
    id: int
    device_id: str
    level: str
    message: str
    is_resolved: bool
    created_at: datetime
    resolved_at: datetime | None
    resolved_reason: str | None
