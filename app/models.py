from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="normal", index=True)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    last_pressure_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_pir_motion: Mapped[bool] = mapped_column(Boolean, default=False)
    last_radar_online: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_presence_detected: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_moving_detected: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_stationary_detected: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True
    )
    last_radar_distance_cm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_pressure_detected: Mapped[bool] = mapped_column(Boolean, default=False)
    battery_level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    wifi_rssi: Mapped[int | None] = mapped_column(Integer, nullable=True)
    location: Mapped[str | None] = mapped_column(String(100), nullable=True)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    room_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sensor_types: Mapped[str] = mapped_column(
        String(255),
        default="pir,pressure,battery,wifi",
    )
    risk_profile: Mapped[str] = mapped_column(String(50), default="default")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    guardian_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    guardian_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    guardian_relation: Mapped[str | None] = mapped_column(String(50), nullable=True)
    worker_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    worker_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    emergency_priority: Mapped[str] = mapped_column(
        String(50),
        default="guardian_first",
    )
    center_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )

    logs: Mapped[list["SensorLog"]] = relationship(back_populates="device")
    alerts: Mapped[list["Alert"]] = relationship(back_populates="device")


class SensorLog(Base):
    __tablename__ = "sensor_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id"), index=True)
    pir_motion: Mapped[bool] = mapped_column(Boolean)
    radar_online: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    presence_detected: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    moving_detected: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    stationary_detected: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    radar_distance_cm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    moving_distance_cm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stationary_distance_cm: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    moving_signal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stationary_signal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    radar_state: Mapped[str | None] = mapped_column(String(30), nullable=True)
    pressure_detected: Mapped[bool] = mapped_column(Boolean)
    pressure_value: Mapped[float] = mapped_column(Float)
    pressure_delta: Mapped[float | None] = mapped_column(Float, nullable=True)
    activity_detected: Mapped[bool] = mapped_column(Boolean, index=True)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )

    device: Mapped[Device] = relationship(back_populates="logs")


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id"), index=True)
    level: Mapped[str] = mapped_column(String(20), default="danger", index=True)
    message: Mapped[str] = mapped_column(String(255))
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolved_reason: Mapped[str | None] = mapped_column(String(100), nullable=True)
    resolution_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    workflow_stage: Mapped[str] = mapped_column(
        String(40),
        default="danger_detected",
        index=True,
    )
    stage_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
    )

    device: Mapped[Device] = relationship(back_populates="alerts")
    action_logs: Mapped[list["AlertActionLog"]] = relationship(
        back_populates="alert",
        cascade="all, delete-orphan",
    )


class AlertActionLog(Base):
    __tablename__ = "alert_action_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id"), index=True)
    stage: Mapped[str] = mapped_column(String(40), index=True)
    action_type: Mapped[str] = mapped_column(String(40))
    message: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        index=True,
    )

    alert: Mapped[Alert] = relationship(back_populates="action_logs")


