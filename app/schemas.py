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
    name: str | None
    room_name: str | None
    sensor_types: str
    risk_profile: str
    is_active: bool
    guardian_name: str | None
    guardian_phone: str | None
    guardian_relation: str | None
    worker_name: str | None
    worker_phone: str | None
    emergency_priority: str
    center_phone: str | None
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
    resolution_detail: str | None
    workflow_stage: str
    workflow_stage_label: str
    stage_updated_at: datetime


class SafetyReasonResponse(BaseModel):
    code: str
    title: str
    detail: str
    level: Literal["danger", "warning", "info"]


class DeviceSafetyContextResponse(BaseModel):
    device_id: str
    status: str
    requires_confirmation: bool
    alert_id: int | None
    alert_created_at: datetime | None
    inactive_seconds: int
    threshold_seconds: int
    last_activity_at: datetime
    last_seen_at: datetime
    reasons: list[SafetyReasonResponse]


class SafetyResolutionCreate(BaseModel):
    resolution_method: Literal[
        "in_person",
        "phone_call",
        "caregiver_contact",
        "sensor_check",
        "false_alarm",
        "other",
    ]
    resolution_detail: str | None = Field(default=None, max_length=500)


class DeviceResolutionResponse(BaseModel):
    message: str
    device_id: str
    status: str
    confirmed_at: datetime
    resolution_method: str
    resolution_method_label: str
    resolution_detail: str | None
    unconfirmed_reasons: list[str]


class ContactResponse(BaseModel):
    device_id: str
    device_name: str
    guardian_name: str | None
    guardian_phone: str | None
    guardian_relation: str | None
    worker_name: str | None
    worker_phone: str | None
    emergency_priority: str
    center_phone: str | None


class ContactUpdate(BaseModel):
    guardian_name: str | None = Field(default=None, max_length=100)
    guardian_phone: str | None = Field(default=None, max_length=30)
    guardian_relation: str | None = Field(default=None, max_length=50)
    worker_name: str | None = Field(default=None, max_length=100)
    worker_phone: str | None = Field(default=None, max_length=30)
    emergency_priority: Literal[
        "guardian_first",
        "worker_first",
        "center_first",
    ] = "guardian_first"
    center_phone: str | None = Field(default=None, max_length=30)


class DeviceCreate(BaseModel):
    device_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    location: str = Field(min_length=1, max_length=100)
    room_name: str = Field(min_length=1, max_length=100)
    sensor_types: list[
        Literal["pir", "pressure", "battery", "wifi"]
    ] = Field(min_length=1)
    risk_profile: Literal["default", "sensitive", "relaxed"] = "default"
    is_active: bool = True


class DeviceUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    location: str = Field(min_length=1, max_length=100)
    room_name: str = Field(min_length=1, max_length=100)
    sensor_types: list[
        Literal["pir", "pressure", "battery", "wifi"]
    ] = Field(min_length=1)
    risk_profile: Literal["default", "sensitive", "relaxed"] = "default"
    is_active: bool = True


class WorkflowStageResponse(BaseModel):
    key: str
    label: str
    completed: bool
    current: bool


class AlertActionLogResponse(BaseModel):
    id: int
    stage: str
    action_type: str
    message: str
    created_at: datetime


class AlertWorkflowResponse(BaseModel):
    alert_id: int
    device_id: str
    device_name: str
    current_stage: str
    current_stage_label: str
    is_resolved: bool
    stages: list[WorkflowStageResponse]
    logs: list[AlertActionLogResponse]
    contact: ContactResponse


class AlertWorkflowActionCreate(BaseModel):
    action: Literal[
        "notify_guardian",
        "escalate_admin",
        "request_visit",
        "complete_visit",
    ]


class ResolutionLogResponse(BaseModel):
    alert_id: int
    device_id: str
    device_name: str
    location: str | None
    resolved_at: datetime
    resolution_method: str
    resolution_method_label: str
    resolution_detail: str | None
    original_reason: str
    workflow_stage: str


class DailyReportSummary(BaseModel):
    total_received: int
    activity_count: int
    danger_alerts: int
    warning_devices: int
    completed_count: int
    offline_devices: int


class DeviceReportSummary(BaseModel):
    device_id: str
    device_name: str
    activity_count: int
    last_activity_at: datetime
    last_seen_at: datetime
    inactive_seconds: int
    status: str


class WeeklyReportBucket(BaseModel):
    date: str
    danger_alerts: int
    activity_count: int
    completed_count: int


class ReportResponse(BaseModel):
    summary: DailyReportSummary
    devices: list[DeviceReportSummary]
    weekly: list[WeeklyReportBucket]


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
