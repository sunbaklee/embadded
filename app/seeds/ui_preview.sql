-- IoT LoneCare UI preview data for SQLite.
-- Re-running this file replaces only the 50 devices listed below.

PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

DROP TABLE IF EXISTS temp.ui_seed_devices;
CREATE TEMP TABLE ui_seed_devices (
    seq INTEGER PRIMARY KEY,
    device_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    pressure_value REAL,
    pir_motion INTEGER NOT NULL,
    pressure_detected INTEGER NOT NULL,
    battery_level INTEGER,
    wifi_rssi INTEGER,
    location TEXT NOT NULL,
    created_at TEXT NOT NULL
);

WITH
communities(name, community_order) AS (
    VALUES
        ('해솔마을', 0),
        ('푸른정원', 1),
        ('다온하우스', 2),
        ('별빛마루', 3),
        ('늘봄빌리지', 4),
        ('한결타운', 5),
        ('온유마을', 6),
        ('라온채', 7),
        ('소담누리', 8),
        ('아침뜰', 9)
),
rooms(room_name, room_label, room_order) AS (
    VALUES
        ('101호', '침실', 1),
        ('102호', '거실', 2),
        ('201호', '침실', 3),
        ('202호', '생활실', 4),
        ('301호', '거실', 5)
),
generated AS (
    SELECT
        community_order * 5 + room_order AS seq,
        name || '-' || room_name AS device_id,
        name || ' ' || room_name || ' ' || room_label AS location
    FROM communities
    CROSS JOIN rooms
)
INSERT INTO ui_seed_devices (
    seq,
    device_id,
    status,
    last_seen_at,
    last_activity_at,
    pressure_value,
    pir_motion,
    pressure_detected,
    battery_level,
    wifi_rssi,
    location,
    created_at
)
SELECT
    seq,
    device_id,
    CASE
        WHEN seq % 10 IN (0, 1) THEN 'danger'
        WHEN seq % 10 IN (2, 3, 4) THEN 'warning'
        ELSE 'normal'
    END,
    CASE
        WHEN seq % 5 = 0 THEN datetime('now', '-5 seconds')
        WHEN seq % 5 = 1 THEN datetime('now', '-12 seconds')
        WHEN seq % 5 = 2 THEN datetime('now', '-24 seconds')
        ELSE datetime('now', printf('-%d minutes', 3 + seq % 42))
    END,
    CASE
        WHEN seq % 10 IN (0, 1)
            THEN datetime('now', printf('-%d minutes', 760 + seq * 11))
        WHEN seq % 10 IN (2, 3, 4)
            THEN datetime('now', printf('-%d minutes', 380 + seq * 4))
        ELSE datetime('now', printf('-%d minutes', 2 + seq * 5))
    END,
    900 + seq * 17,
    CASE WHEN seq % 10 NOT IN (0, 1, 2, 3, 4) AND seq % 3 = 0 THEN 1 ELSE 0 END,
    CASE WHEN seq % 3 = 0 THEN 1 ELSE 0 END,
    CASE
        WHEN seq % 13 = 0 THEN NULL
        WHEN seq % 11 = 0 THEN 12 + seq % 8
        ELSE 42 + (seq * 7) % 58
    END,
    -48 - (seq * 3) % 39,
    location,
    datetime('now', printf('-%d days', 5 + seq % 24))
FROM generated;

DELETE FROM alert_action_logs
WHERE alert_id IN (
    SELECT alerts.id
    FROM alerts
    JOIN devices ON devices.id = alerts.device_id
    WHERE devices.device_id IN (SELECT device_id FROM ui_seed_devices)
);

DELETE FROM alerts
WHERE device_id IN (
    SELECT id
    FROM devices
    WHERE device_id IN (SELECT device_id FROM ui_seed_devices)
);

DELETE FROM sensor_logs
WHERE device_id IN (
    SELECT id
    FROM devices
    WHERE device_id IN (SELECT device_id FROM ui_seed_devices)
);

DELETE FROM devices
WHERE device_id IN (SELECT device_id FROM ui_seed_devices);

INSERT INTO devices (
    device_id,
    name,
    status,
    last_seen_at,
    last_activity_at,
    last_pressure_value,
    last_pir_motion,
    last_radar_online,
    last_presence_detected,
    last_moving_detected,
    last_stationary_detected,
    last_radar_distance_cm,
    last_pressure_detected,
    battery_level,
    wifi_rssi,
    location,
    room_name,
    sensor_types,
    risk_profile,
    is_active,
    guardian_name,
    guardian_phone,
    guardian_relation,
    worker_name,
    worker_phone,
    emergency_priority,
    center_phone,
    created_at
)
SELECT
    device_id,
    device_id,
    status,
    last_seen_at,
    last_activity_at,
    pressure_value,
    pir_motion,
    CASE WHEN seq % 13 = 0 THEN 0 ELSE 1 END,
    CASE
        WHEN seq % 13 = 0 THEN NULL
        WHEN seq % 4 IN (0, 1) THEN 1
        ELSE 0
    END,
    CASE WHEN seq % 13 != 0 AND pir_motion = 1 THEN 1 ELSE 0 END,
    CASE
        WHEN seq % 13 != 0 AND pir_motion = 0 AND seq % 4 IN (0, 1) THEN 1
        ELSE 0
    END,
    CASE WHEN seq % 13 = 0 THEN NULL ELSE 80 + (seq * 17) % 320 END,
    pressure_detected,
    battery_level,
    wifi_rssi,
    location,
    location,
    'pir,pressure,battery,wifi',
    CASE WHEN seq % 9 = 0 THEN 'sensitive' ELSE 'default' END,
    1,
    '김' || printf('%02d', seq) || ' 보호자',
    '010-' || printf('%04d', 1000 + seq) || '-' || printf('%04d', 3000 + seq),
    CASE WHEN seq % 3 = 0 THEN '자녀' WHEN seq % 3 = 1 THEN '형제' ELSE '조카' END,
    '박' || printf('%02d', (seq - 1) % 8 + 1) || ' 복지사',
    '010-5500-' || printf('%04d', 2000 + seq),
    'guardian_first',
    '051-700-' || printf('%04d', 1000 + (seq % 10)),
    created_at
FROM ui_seed_devices;

-- Six logs per device spread across the last 24 hours.
WITH log_offsets(log_order, minutes_ago) AS (
    VALUES
        (1, 5),
        (2, 45),
        (3, 150),
        (4, 360),
        (5, 720),
        (6, 1320)
)
INSERT INTO sensor_logs (
    device_id,
    pir_motion,
    radar_online,
    presence_detected,
    moving_detected,
    stationary_detected,
    radar_distance_cm,
    moving_distance_cm,
    stationary_distance_cm,
    moving_signal,
    stationary_signal,
    radar_state,
    pressure_detected,
    pressure_value,
    pressure_delta,
    activity_detected,
    received_at
)
SELECT
    device.id,
    CASE WHEN (seed.seq + offsets.log_order) % 4 = 0 THEN 1 ELSE 0 END,
    CASE WHEN seed.seq % 13 = 0 THEN 0 ELSE 1 END,
    CASE
        WHEN seed.seq % 13 = 0 THEN NULL
        WHEN (seed.seq + offsets.log_order) % 4 IN (0, 1) THEN 1
        ELSE 0
    END,
    CASE
        WHEN seed.seq % 13 != 0 AND (seed.seq + offsets.log_order) % 4 = 0 THEN 1
        ELSE 0
    END,
    CASE
        WHEN seed.seq % 13 != 0 AND (seed.seq + offsets.log_order) % 4 = 1 THEN 1
        ELSE 0
    END,
    CASE WHEN seed.seq % 13 = 0 THEN NULL ELSE 80 + (seed.seq * 17) % 320 END,
    CASE WHEN seed.seq % 13 = 0 THEN NULL ELSE 60 + (seed.seq * 11) % 240 END,
    CASE WHEN seed.seq % 13 = 0 THEN NULL ELSE 70 + (seed.seq * 13) % 260 END,
    CASE WHEN seed.seq % 13 = 0 THEN NULL ELSE 35 + (seed.seq * 7) % 65 END,
    CASE WHEN seed.seq % 13 = 0 THEN NULL ELSE 30 + (seed.seq * 5) % 60 END,
    CASE
        WHEN seed.seq % 13 = 0 THEN 'offline'
        WHEN (seed.seq + offsets.log_order) % 4 = 0 THEN 'moving'
        WHEN (seed.seq + offsets.log_order) % 4 = 1 THEN 'stationary'
        ELSE 'none'
    END,
    CASE WHEN (seed.seq + offsets.log_order) % 3 = 0 THEN 1 ELSE 0 END,
    seed.pressure_value + offsets.log_order * 9,
    CASE
        WHEN offsets.log_order = 1 THEN 9
        ELSE 60 + ((seed.seq + offsets.log_order) * 13) % 170
    END,
    CASE
        WHEN (seed.seq + offsets.log_order) % 4 = 0 THEN 1
        WHEN 60 + ((seed.seq + offsets.log_order) * 13) % 170 >= 100 THEN 1
        ELSE 0
    END,
    CASE
        WHEN offsets.log_order = 1 THEN seed.last_seen_at
        ELSE datetime('now', printf('-%d minutes', offsets.minutes_ago + seed.seq % 20))
    END
FROM ui_seed_devices AS seed
JOIN devices AS device ON device.device_id = seed.device_id
CROSS JOIN log_offsets AS offsets;

-- One historical activity sample per device for each of the previous six days.
WITH day_offsets(day_order) AS (
    VALUES (1), (2), (3), (4), (5), (6)
)
INSERT INTO sensor_logs (
    device_id,
    pir_motion,
    radar_online,
    presence_detected,
    moving_detected,
    stationary_detected,
    radar_distance_cm,
    moving_distance_cm,
    stationary_distance_cm,
    moving_signal,
    stationary_signal,
    radar_state,
    pressure_detected,
    pressure_value,
    pressure_delta,
    activity_detected,
    received_at
)
SELECT
    device.id,
    CASE WHEN (seed.seq + days.day_order) % 3 = 0 THEN 1 ELSE 0 END,
    CASE WHEN seed.seq % 13 = 0 THEN 0 ELSE 1 END,
    CASE
        WHEN seed.seq % 13 = 0 THEN NULL
        WHEN (seed.seq + days.day_order) % 3 = 0 THEN 1
        ELSE 0
    END,
    CASE
        WHEN seed.seq % 13 != 0 AND (seed.seq + days.day_order) % 3 = 0 THEN 1
        ELSE 0
    END,
    CASE
        WHEN seed.seq % 13 != 0 AND (seed.seq + days.day_order) % 3 = 1 THEN 1
        ELSE 0
    END,
    CASE WHEN seed.seq % 13 = 0 THEN NULL ELSE 80 + (seed.seq * 17) % 320 END,
    CASE WHEN seed.seq % 13 = 0 THEN NULL ELSE 60 + (seed.seq * 11) % 240 END,
    CASE WHEN seed.seq % 13 = 0 THEN NULL ELSE 70 + (seed.seq * 13) % 260 END,
    CASE WHEN seed.seq % 13 = 0 THEN NULL ELSE 35 + (seed.seq * 7) % 65 END,
    CASE WHEN seed.seq % 13 = 0 THEN NULL ELSE 30 + (seed.seq * 5) % 60 END,
    CASE
        WHEN seed.seq % 13 = 0 THEN 'offline'
        WHEN (seed.seq + days.day_order) % 3 = 0 THEN 'moving'
        WHEN (seed.seq + days.day_order) % 3 = 1 THEN 'stationary'
        ELSE 'none'
    END,
    CASE WHEN (seed.seq + days.day_order) % 4 = 0 THEN 1 ELSE 0 END,
    seed.pressure_value + days.day_order * 13,
    40 + ((seed.seq + days.day_order) * 17) % 140,
    CASE WHEN (seed.seq + days.day_order) % 3 = 0 THEN 1 ELSE 0 END,
    datetime(
        'now',
        printf('-%d days', days.day_order),
        printf('-%d hours', seed.seq % 18)
    )
FROM ui_seed_devices AS seed
JOIN devices AS device ON device.device_id = seed.device_id
CROSS JOIN day_offsets AS days;

INSERT INTO alerts (
    device_id,
    level,
    message,
    is_resolved,
    created_at,
    resolved_at,
    resolved_reason,
    resolution_detail,
    workflow_stage,
    stage_updated_at
)
SELECT
    device.id,
    'danger',
    seed.location || ': 장시간 움직임이 감지되지 않아 안전 확인이 필요합니다.',
    0,
    datetime('now', printf('-%d minutes', 8 + seed.seq)),
    NULL,
    NULL,
    NULL,
    CASE seed.seq % 5
        WHEN 0 THEN 'danger_detected'
        WHEN 1 THEN 'guardian_waiting'
        WHEN 2 THEN 'admin_required'
        WHEN 3 THEN 'visit_requested'
        ELSE 'danger_detected'
    END,
    datetime('now', printf('-%d minutes', 4 + seed.seq))
FROM ui_seed_devices AS seed
JOIN devices AS device ON device.device_id = seed.device_id
WHERE seed.status = 'danger';

INSERT INTO alert_action_logs (alert_id, stage, action_type, message, created_at)
SELECT
    alert.id,
    'danger_detected',
    'danger_detected',
    '위험 기준을 초과하여 위험 알림이 생성되었습니다.',
    alert.created_at
FROM alerts AS alert
JOIN devices AS device ON device.id = alert.device_id
WHERE device.device_id IN (SELECT device_id FROM ui_seed_devices)
  AND alert.is_resolved = 0;

INSERT INTO alert_action_logs (alert_id, stage, action_type, message, created_at)
SELECT
    alert.id,
    'guardian_notified',
    'notify_guardian',
    '보호자에게 1차 알림 발송 완료',
    datetime(alert.created_at, '+2 minutes')
FROM alerts AS alert
JOIN devices AS device ON device.id = alert.device_id
WHERE device.device_id IN (SELECT device_id FROM ui_seed_devices)
  AND alert.workflow_stage IN ('guardian_waiting', 'admin_required', 'visit_requested');

INSERT INTO alert_action_logs (alert_id, stage, action_type, message, created_at)
SELECT
    alert.id,
    'guardian_waiting',
    'notify_guardian',
    '보호자 응답 대기 상태로 변경',
    datetime(alert.created_at, '+3 minutes')
FROM alerts AS alert
JOIN devices AS device ON device.id = alert.device_id
WHERE device.device_id IN (SELECT device_id FROM ui_seed_devices)
  AND alert.workflow_stage IN ('guardian_waiting', 'admin_required', 'visit_requested');

INSERT INTO alert_action_logs (alert_id, stage, action_type, message, created_at)
SELECT
    alert.id,
    'admin_required',
    'escalate_admin',
    '보호자 미응답으로 담당 복지사에게 알림 전달',
    datetime(alert.created_at, '+5 minutes')
FROM alerts AS alert
JOIN devices AS device ON device.id = alert.device_id
WHERE device.device_id IN (SELECT device_id FROM ui_seed_devices)
  AND alert.workflow_stage IN ('admin_required', 'visit_requested');

INSERT INTO alert_action_logs (alert_id, stage, action_type, message, created_at)
SELECT
    alert.id,
    'visit_requested',
    'request_visit',
    '담당 복지사에게 현장 방문 요청',
    datetime(alert.created_at, '+7 minutes')
FROM alerts AS alert
JOIN devices AS device ON device.id = alert.device_id
WHERE device.device_id IN (SELECT device_id FROM ui_seed_devices)
  AND alert.workflow_stage = 'visit_requested';

-- Completed cases for the persistent safety-confirmation history page.
INSERT INTO alerts (
    device_id,
    level,
    message,
    is_resolved,
    created_at,
    resolved_at,
    resolved_reason,
    resolution_detail,
    workflow_stage,
    stage_updated_at
)
SELECT
    device.id,
    'danger',
    seed.location || ': 센서 미수신과 장시간 무활동으로 안전 확인이 필요했습니다.',
    1,
    datetime('now', printf('-%d days', 1 + seed.seq % 6)),
    CASE seed.seq
        WHEN 5 THEN datetime('now', '-4 hours')
        WHEN 15 THEN datetime('now', '-1 day', '-3 hours')
        WHEN 25 THEN datetime('now', '-2 days', '-2 hours')
        WHEN 35 THEN datetime('now', '-3 days', '-5 hours')
        ELSE datetime('now', '-4 days', '-1 hour')
    END,
    CASE seed.seq
        WHEN 5 THEN 'in_person'
        WHEN 15 THEN 'phone_call'
        WHEN 25 THEN 'caregiver_contact'
        WHEN 35 THEN 'sensor_check'
        ELSE 'other'
    END,
    CASE WHEN seed.seq = 45
        THEN '관리센터 CCTV와 이웃 방문 확인을 함께 진행'
        ELSE NULL
    END,
    'field_confirmed',
    CASE seed.seq
        WHEN 5 THEN datetime('now', '-4 hours')
        WHEN 15 THEN datetime('now', '-1 day', '-3 hours')
        WHEN 25 THEN datetime('now', '-2 days', '-2 hours')
        WHEN 35 THEN datetime('now', '-3 days', '-5 hours')
        ELSE datetime('now', '-4 days', '-1 hour')
    END
FROM ui_seed_devices AS seed
JOIN devices AS device ON device.device_id = seed.device_id
WHERE seed.seq IN (5, 15, 25, 35, 45);

INSERT INTO alert_action_logs (alert_id, stage, action_type, message, created_at)
SELECT
    alert.id,
    'field_confirmed',
    'safety_confirmed',
    '안전 확인 완료: ' || COALESCE(alert.resolution_detail, alert.resolved_reason),
    alert.resolved_at
FROM alerts AS alert
JOIN devices AS device ON device.id = alert.device_id
WHERE device.device_id IN (SELECT device_id FROM ui_seed_devices)
  AND alert.is_resolved = 1;

COMMIT;

SELECT
    COUNT(*) AS seeded_devices,
    SUM(status = 'normal') AS normal_devices,
    SUM(status = 'warning') AS warning_devices,
    SUM(status = 'danger') AS danger_devices
FROM devices
WHERE device_id IN (SELECT device_id FROM ui_seed_devices);
