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
    status,
    last_seen_at,
    last_activity_at,
    last_pressure_value,
    last_pir_motion,
    last_pressure_detected,
    battery_level,
    wifi_rssi,
    location,
    created_at
)
SELECT
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
    pressure_detected,
    pressure_value,
    pressure_delta,
    activity_detected,
    received_at
)
SELECT
    device.id,
    CASE WHEN (seed.seq + offsets.log_order) % 4 = 0 THEN 1 ELSE 0 END,
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

INSERT INTO alerts (
    device_id,
    level,
    message,
    is_resolved,
    created_at,
    resolved_at,
    resolved_reason
)
SELECT
    device.id,
    'danger',
    seed.location || ': 장시간 움직임이 감지되지 않아 안전 확인이 필요합니다.',
    0,
    datetime('now', printf('-%d minutes', 8 + seed.seq)),
    NULL,
    NULL
FROM ui_seed_devices AS seed
JOIN devices AS device ON device.device_id = seed.device_id
WHERE seed.status = 'danger';

COMMIT;

SELECT
    COUNT(*) AS seeded_devices,
    SUM(status = 'normal') AS normal_devices,
    SUM(status = 'warning') AS warning_devices,
    SUM(status = 'danger') AS danger_devices
FROM devices
WHERE device_id IN (SELECT device_id FROM ui_seed_devices);
