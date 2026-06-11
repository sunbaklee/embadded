-- Removes only the 50 devices created by ui_preview.sql.

PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

DROP TABLE IF EXISTS temp.ui_seed_ids;
CREATE TEMP TABLE ui_seed_ids (device_id TEXT PRIMARY KEY);

WITH
communities(name) AS (
    VALUES
        ('해솔마을'),
        ('푸른정원'),
        ('다온하우스'),
        ('별빛마루'),
        ('늘봄빌리지'),
        ('한결타운'),
        ('온유마을'),
        ('라온채'),
        ('소담누리'),
        ('아침뜰')
),
rooms(room_name) AS (
    VALUES ('101호'), ('102호'), ('201호'), ('202호'), ('301호')
)
INSERT INTO ui_seed_ids (device_id)
SELECT name || '-' || room_name
FROM communities
CROSS JOIN rooms;

DELETE FROM alerts
WHERE device_id IN (
    SELECT id FROM devices
    WHERE device_id IN (SELECT device_id FROM ui_seed_ids)
);

DELETE FROM sensor_logs
WHERE device_id IN (
    SELECT id FROM devices
    WHERE device_id IN (SELECT device_id FROM ui_seed_ids)
);

DELETE FROM devices
WHERE device_id IN (SELECT device_id FROM ui_seed_ids);

COMMIT;
