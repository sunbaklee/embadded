from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Alert, Device, SensorLog, utc_now
from app.schemas import (
    DailyReportSummary,
    DeviceReportSummary,
    ReportResponse,
    WeeklyReportBucket,
)
from app.services.status_service import as_utc, inactive_seconds, refresh_device_status


router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("", response_model=ReportResponse)
def get_reports(db: Session = Depends(get_db)):
    now = utc_now()
    daily_start = now - timedelta(hours=24)
    weekly_start = now - timedelta(days=7)
    devices = db.scalars(select(Device).order_by(Device.device_id)).all()
    for device in devices:
        refresh_device_status(db, device, now)

    daily_logs = db.scalars(
        select(SensorLog).where(SensorLog.received_at >= daily_start)
    ).all()
    weekly_logs = db.scalars(
        select(SensorLog).where(SensorLog.received_at >= weekly_start)
    ).all()
    weekly_alerts = db.scalars(
        select(Alert).where(Alert.created_at >= weekly_start)
    ).all()

    offline_count = sum(
        int((now - as_utc(device.last_seen_at)).total_seconds())
        >= settings.sensor_offline_seconds
        for device in devices
        if device.is_active
    )
    summary = DailyReportSummary(
        total_received=len(daily_logs),
        activity_count=sum(log.activity_detected for log in daily_logs),
        danger_alerts=sum(
            as_utc(alert.created_at) >= daily_start for alert in weekly_alerts
        ),
        warning_devices=sum(device.status == "warning" for device in devices),
        completed_count=sum(
            alert.resolved_at is not None
            and as_utc(alert.resolved_at) >= daily_start
            for alert in weekly_alerts
        ),
        offline_devices=offline_count,
    )

    activity_by_device: dict[int, int] = {}
    for log in daily_logs:
        if log.activity_detected:
            activity_by_device[log.device_id] = (
                activity_by_device.get(log.device_id, 0) + 1
            )
    priority = {"danger": 0, "warning": 1, "normal": 2}
    device_summaries = [
        DeviceReportSummary(
            device_id=device.device_id,
            device_name=device.name or device.device_id,
            activity_count=activity_by_device.get(device.id, 0),
            last_activity_at=device.last_activity_at,
            last_seen_at=device.last_seen_at,
            inactive_seconds=inactive_seconds(device, now),
            status=device.status,
        )
        for device in sorted(
            devices,
            key=lambda item: (
                priority.get(item.status, 3),
                -inactive_seconds(item, now),
            ),
        )[:6]
    ]

    weekly = []
    for day_offset in range(6, -1, -1):
        day = (now - timedelta(days=day_offset)).date()
        weekly.append(
            WeeklyReportBucket(
                date=day.isoformat(),
                danger_alerts=sum(
                    as_utc(alert.created_at).date() == day
                    for alert in weekly_alerts
                ),
                activity_count=sum(
                    log.activity_detected
                    and as_utc(log.received_at).date() == day
                    for log in weekly_logs
                ),
                completed_count=sum(
                    alert.resolved_at is not None
                    and as_utc(alert.resolved_at).date() == day
                    for alert in weekly_alerts
                ),
            )
        )
    db.commit()
    return ReportResponse(
        summary=summary,
        devices=device_summaries,
        weekly=weekly,
    )
