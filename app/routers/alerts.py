from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Alert, AlertActionLog, Device, utc_now
from app.schemas import (
    AlertActionLogResponse,
    AlertResponse,
    AlertWorkflowActionCreate,
    AlertWorkflowResponse,
    ContactResponse,
    DeviceResolutionResponse,
    DeviceSafetyContextResponse,
    ResolutionLogResponse,
    SafetyReasonResponse,
    SafetyResolutionCreate,
    WorkflowStageResponse,
)
from app.services.alert_service import resolve_open_alerts
from app.services.status_service import as_utc, inactive_seconds


router = APIRouter(prefix="/api/alerts", tags=["alerts"])

RESOLUTION_METHOD_LABELS = {
    "in_person": "현장 방문으로 안전 확인",
    "phone_call": "본인과 전화 통화",
    "caregiver_contact": "보호자·담당자에게 확인",
    "sensor_check": "센서 상태 점검 후 확인",
    "false_alarm": "오탐으로 판단",
    "other": "기타 방식으로 확인",
}

WORKFLOW_STAGES = [
    ("danger_detected", "위험 감지됨"),
    ("guardian_notified", "1차 보호자 알림 발송 완료"),
    ("guardian_waiting", "보호자 응답 대기 중"),
    ("admin_required", "관리자 확인 필요"),
    ("visit_requested", "현장 방문 요청"),
    ("field_confirmed", "현장 확인 완료"),
]
WORKFLOW_LABELS = dict(WORKFLOW_STAGES)


def to_response(alert: Alert, device_id: str) -> AlertResponse:
    return AlertResponse(
        id=alert.id,
        device_id=device_id,
        level=alert.level,
        message=alert.message,
        is_resolved=alert.is_resolved,
        created_at=alert.created_at,
        resolved_at=alert.resolved_at,
        resolved_reason=alert.resolved_reason,
        resolution_detail=alert.resolution_detail,
        workflow_stage=alert.workflow_stage,
        workflow_stage_label=WORKFLOW_LABELS.get(
            alert.workflow_stage,
            alert.workflow_stage,
        ),
        stage_updated_at=alert.stage_updated_at or alert.created_at,
    )


def get_open_alert(db: Session, device: Device) -> Alert | None:
    return db.scalar(
        select(Alert)
        .where(
            Alert.device_id == device.id,
            Alert.is_resolved.is_(False),
        )
        .order_by(Alert.created_at.desc())
    )


def safety_reasons(db: Session, device: Device) -> list[SafetyReasonResponse]:
    elapsed = inactive_seconds(device)
    threshold = settings.inactivity_threshold_seconds
    last_seen_seconds = max(
        0,
        int((utc_now() - as_utc(device.last_seen_at)).total_seconds()),
    )
    reasons = [
        SafetyReasonResponse(
            code="inactivity_threshold",
            title="장시간 활동이 감지되지 않음",
            detail=(
                f"마지막 활동 이후 {elapsed // 3600}시간 "
                f"{(elapsed % 3600) // 60}분이 지나 "
                f"위험 기준 {threshold // 3600}시간을 초과했습니다."
            ),
            level="danger",
        )
    ]

    if last_seen_seconds > settings.sensor_offline_seconds:
        reasons.append(
            SafetyReasonResponse(
                code="sensor_offline",
                title="센서 데이터 수신 중단",
                detail=(
                    f"마지막 센서 수신 후 {last_seen_seconds // 60}분이 지나 "
                    "원격으로 현재 상태를 확인할 수 없었습니다."
                ),
                level="warning",
            )
        )

    if (
        settings.pressure_no_motion_enabled
        and device.last_pressure_detected
        and not device.last_pir_motion
    ):
        reasons.append(
            SafetyReasonResponse(
                code="pressure_without_motion",
                title="압력은 유지되지만 움직임이 없음",
                detail="압력 센서는 감지 상태였지만 PIR 움직임은 감지되지 않았습니다.",
                level="warning",
            )
        )

    if (
        device.battery_level is not None
        and device.battery_level <= settings.low_battery_threshold
    ):
        reasons.append(
            SafetyReasonResponse(
                code="low_battery",
                title="센서 배터리 부족",
                detail=f"배터리 잔량이 {device.battery_level}%로 낮아 센서 신뢰도 확인이 필요합니다.",
                level="info",
            )
        )

    if (
        device.wifi_rssi is not None
        and device.wifi_rssi <= settings.weak_wifi_threshold
    ):
        reasons.append(
            SafetyReasonResponse(
                code="weak_wifi",
                title="Wi-Fi 신호가 약함",
                detail=(
                    f"현재 신호가 {device.wifi_rssi}dBm으로 "
                    f"점검 기준 {settings.weak_wifi_threshold}dBm 이하입니다."
                ),
                level="info",
            )
        )

    return reasons


def safety_context(db: Session, device: Device) -> DeviceSafetyContextResponse:
    alert = get_open_alert(db, device)
    requires_confirmation = device.status == "danger" or alert is not None
    reasons = safety_reasons(db, device) if requires_confirmation else []
    return DeviceSafetyContextResponse(
        device_id=device.device_id,
        status=device.status,
        requires_confirmation=requires_confirmation,
        alert_id=alert.id if alert else None,
        alert_created_at=alert.created_at if alert else None,
        inactive_seconds=inactive_seconds(device),
        threshold_seconds=settings.inactivity_threshold_seconds,
        last_activity_at=device.last_activity_at,
        last_seen_at=device.last_seen_at,
        reasons=reasons,
    )


@router.get("", response_model=list[AlertResponse])
def get_alerts(
    resolved: bool | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    statement = (
        select(Alert, Device.device_id)
        .join(Device)
        .order_by(Alert.created_at.desc())
        .limit(limit)
    )
    if resolved is not None:
        statement = statement.where(Alert.is_resolved == resolved)
    return [to_response(alert, name) for alert, name in db.execute(statement).all()]


@router.get("/resolved", response_model=list[ResolutionLogResponse])
def get_resolution_logs(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(Alert, Device)
        .join(Device)
        .where(Alert.is_resolved.is_(True), Alert.resolved_at.is_not(None))
        .order_by(Alert.resolved_at.desc())
        .limit(limit)
    ).all()
    return [
        ResolutionLogResponse(
            alert_id=alert.id,
            device_id=device.device_id,
            device_name=device.name or device.device_id,
            location=device.location,
            resolved_at=alert.resolved_at,
            resolution_method=alert.resolved_reason or "activity_detected",
            resolution_method_label=RESOLUTION_METHOD_LABELS.get(
                alert.resolved_reason or "",
                "센서 활동으로 자동 확인"
                if alert.resolved_reason == "activity_detected"
                else "안전 확인 완료",
            ),
            resolution_detail=alert.resolution_detail,
            original_reason=alert.message,
            workflow_stage=alert.workflow_stage,
        )
        for alert, device in rows
    ]


@router.get(
    "/device/{device_id}/context",
    response_model=DeviceSafetyContextResponse,
)
def get_device_safety_context(device_id: str, db: Session = Depends(get_db)):
    device = db.scalar(select(Device).where(Device.device_id == device_id))
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return safety_context(db, device)


def workflow_response(
    db: Session,
    alert: Alert,
    device: Device,
) -> AlertWorkflowResponse:
    stage_keys = [stage for stage, _ in WORKFLOW_STAGES]
    current_index = stage_keys.index(alert.workflow_stage)
    logs = db.scalars(
        select(AlertActionLog)
        .where(AlertActionLog.alert_id == alert.id)
        .order_by(AlertActionLog.created_at)
    ).all()
    contact = ContactResponse(
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
    return AlertWorkflowResponse(
        alert_id=alert.id,
        device_id=device.device_id,
        device_name=device.name or device.device_id,
        current_stage=alert.workflow_stage,
        current_stage_label=WORKFLOW_LABELS[alert.workflow_stage],
        is_resolved=alert.is_resolved,
        stages=[
            WorkflowStageResponse(
                key=key,
                label=label,
                completed=index <= current_index,
                current=index == current_index,
            )
            for index, (key, label) in enumerate(WORKFLOW_STAGES)
        ],
        logs=[
            AlertActionLogResponse(
                id=log.id,
                stage=log.stage,
                action_type=log.action_type,
                message=log.message,
                created_at=log.created_at,
            )
            for log in logs
        ],
        contact=contact,
    )


@router.get("/{alert_id}/workflow", response_model=AlertWorkflowResponse)
def get_alert_workflow(alert_id: int, db: Session = Depends(get_db)):
    row = db.execute(
        select(Alert, Device).join(Device).where(Alert.id == alert_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return workflow_response(db, *row)


@router.post("/{alert_id}/workflow/action", response_model=AlertWorkflowResponse)
def progress_alert_workflow(
    alert_id: int,
    payload: AlertWorkflowActionCreate,
    db: Session = Depends(get_db),
):
    row = db.execute(
        select(Alert, Device).join(Device).where(Alert.id == alert_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert, device = row
    if alert.is_resolved:
        raise HTTPException(status_code=409, detail="Alert is already resolved")

    now = utc_now()
    if payload.action == "notify_guardian":
        guardian = device.guardian_name or "등록 보호자"
        destination = device.guardian_phone or "연락처 미등록"
        alert.workflow_stage = "guardian_waiting"
        messages = [
            (
                "guardian_notified",
                f"보호자 {guardian}에게 1차 알림 발송 ({destination})",
            ),
            ("guardian_waiting", "보호자 응답 대기 상태로 변경"),
        ]
    elif payload.action == "escalate_admin":
        worker = device.worker_name or "담당 복지사"
        destination = device.worker_phone or device.center_phone or "연락처 미등록"
        alert.workflow_stage = "admin_required"
        messages = [
            (
                "admin_required",
                f"보호자 미응답으로 {worker}에게 알림 전달 ({destination})",
            ),
            ("admin_required", "관리자 확인 필요 상태로 변경"),
        ]
    elif payload.action == "request_visit":
        alert.workflow_stage = "visit_requested"
        messages = [
            (
                "visit_requested",
                f"{device.worker_name or '담당자'}에게 현장 방문 요청",
            )
        ]
    else:
        alert.workflow_stage = "field_confirmed"
        alert.is_resolved = True
        alert.resolved_at = now
        alert.resolved_reason = "in_person"
        alert.resolution_detail = "알림 처리 흐름에서 현장 확인 완료"
        device.status = "normal"
        device.last_activity_at = now
        messages = [("field_confirmed", "현장 방문 후 안전 확인 완료")]

    alert.stage_updated_at = now
    for stage, message in messages:
        db.add(
            AlertActionLog(
                alert_id=alert.id,
                stage=stage,
                action_type=payload.action,
                message=message,
                created_at=now,
            )
        )
    db.commit()
    return workflow_response(db, alert, device)


@router.post("/{alert_id}/resolve", response_model=AlertResponse)
def resolve_alert(alert_id: int, db: Session = Depends(get_db)):
    row = db.execute(
        select(Alert, Device)
        .join(Device)
        .where(Alert.id == alert_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert, device = row
    if not alert.is_resolved:
        now = utc_now()
        resolve_open_alerts(db, device, reason="manual_safety_confirmed")
        alert.resolution_detail = "알림 목록에서 직접 안전 확인 완료"
        device.last_activity_at = now
        device.status = "normal"
        db.commit()
    return to_response(alert, device.device_id)


@router.post(
    "/device/{device_id}/resolve",
    response_model=DeviceResolutionResponse,
)
def resolve_device_alerts(
    device_id: str,
    payload: SafetyResolutionCreate,
    db: Session = Depends(get_db),
):
    device = db.scalar(select(Device).where(Device.device_id == device_id))
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.status != "danger":
        raise HTTPException(status_code=409, detail="Device is not in danger status")

    if (
        payload.resolution_method == "other"
        and not (payload.resolution_detail or "").strip()
    ):
        raise HTTPException(
            status_code=422,
            detail="기타 해결 방식을 입력해 주세요.",
        )

    context = safety_context(db, device)
    open_alerts = db.scalars(
        select(Alert).where(
            Alert.device_id == device.id,
            Alert.is_resolved.is_(False),
        )
    ).all()
    now = utc_now()
    resolve_open_alerts(db, device, reason=payload.resolution_method)
    for alert in open_alerts:
        alert.resolution_detail = (payload.resolution_detail or "").strip() or None
        db.add(
            AlertActionLog(
                alert_id=alert.id,
                stage="field_confirmed",
                action_type="safety_confirmed",
                message=(
                    f"안전 확인 완료: "
                    f"{RESOLUTION_METHOD_LABELS[payload.resolution_method]}"
                ),
                created_at=now,
            )
        )
    device.last_activity_at = now
    device.status = "normal"
    db.commit()
    return DeviceResolutionResponse(
        message="device safety confirmed",
        device_id=device.device_id,
        status=device.status,
        confirmed_at=now,
        resolution_method=payload.resolution_method,
        resolution_method_label=RESOLUTION_METHOD_LABELS[payload.resolution_method],
        resolution_detail=(payload.resolution_detail or "").strip() or None,
        unconfirmed_reasons=[reason.title for reason in context.reasons],
    )
