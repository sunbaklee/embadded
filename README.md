# IoT LoneCare

PIR 센서와 압력 센서로 생활 활동을 비접촉 감지하고, 장시간 무활동 시
위험 알림을 생성하는 FastAPI 기반 모니터링 시스템입니다.

## 주요 기능

- ESP32 센서 데이터 수신 및 SQLite 저장
- 장치별 `normal`, `warning`, `danger` 상태 판정
- 열린 danger 알림 중복 생성 방지
- 활동 재감지 시 정상 복구 및 열린 알림 자동 해제
- 웹 대시보드 5초 자동 갱신
- 최근 1시간/6시간/24시간 활동 감지 그래프
- 장치별 온라인 상태, 배터리, Wi-Fi 신호, 설치 위치 표시
- 상태·연결·위치·센서 조건별 장치 관리 페이지
- 센서 없이 상태를 재현하는 개발용 시뮬레이션
- Windows Docker Desktop 및 Raspberry Pi ARM64 공통 구성
- Docker named volume을 사용한 DB 영구 저장

## 상태 판정

`INACTIVITY_THRESHOLD_SECONDS`가 위험 기준입니다.

| 상태 | 조건 |
|---|---|
| normal | 무활동 시간이 기준의 절반 미만 |
| warning | 기준의 절반 이상, 기준 미만 |
| danger | 기준 이상 |

다음 중 하나를 만족하면 활동으로 판단합니다.

- `pir_motion`이 `true`
- 직전 압력 값과 현재 압력 값의 차이가 `PRESSURE_DELTA_THRESHOLD` 이상

새 장치의 첫 데이터는 압력 비교 기준값이 없으므로 PIR이 `false`이면 압력
활동으로 판정하지 않습니다. 첫 수신 시각부터 무활동 시간을 계산합니다.

## 프로젝트 구조

```text
iot-lonecare/
├─ app/
│  ├─ routers/          # 센서, 상태, 알림, 시뮬레이션 API
│  ├─ services/         # 상태 판정 및 알림 서비스
│  ├─ static/           # HTML/CSS/JavaScript 대시보드
│  ├─ config.py
│  ├─ database.py
│  ├─ main.py
│  ├─ models.py
│  └─ schemas.py
├─ data/
├─ examples/
│  └─ esp32_sensor.ino
├─ Dockerfile
├─ docker-compose.yml
├─ docker-compose.override.yml
├─ .env.example
└─ requirements.txt
```

## Windows 개발 실행

사전 준비:

1. Docker Desktop을 설치합니다.
2. Docker Desktop을 실행하고 Linux containers 모드인지 확인합니다.
3. PowerShell에서 프로젝트 폴더로 이동합니다.

```powershell
cd iot-lonecare
Copy-Item .env.example .env
```

발표 시연이라면 `.env`에서 아래 값을 변경합니다.

```dotenv
APP_ENV=development
INACTIVITY_THRESHOLD_SECONDS=60
```

실행:

```powershell
docker compose up --build
```

Windows에서는 Compose가 `docker-compose.override.yml`을 자동으로 함께
읽습니다. `app` 폴더가 `/app/app`에 마운트되고 Uvicorn `--reload`가
활성화되므로 Python/HTML/CSS/JavaScript 수정 사항이 바로 반영됩니다.

- 대시보드: http://localhost:8000
- 장치 관리: http://localhost:8000/devices
- Swagger API 문서: http://localhost:8000/docs
- 상태 확인: http://localhost:8000/health

백그라운드 실행과 종료:

```powershell
docker compose up -d --build
docker compose logs -f web
docker compose down
```

`docker compose down`은 named volume을 삭제하지 않으므로 DB가 유지됩니다.
`docker compose down -v`는 DB volume도 삭제하므로 초기화할 때만 사용합니다.

## Raspberry Pi 운영 실행

권장 환경은 64비트 Raspberry Pi OS와 Docker Engine/Compose plugin입니다.
프로젝트를 Pi에 복사하거나 Git으로 받은 뒤 다음을 실행합니다.

```bash
cd iot-lonecare
cp .env.example .env
nano .env
```

운영 설정 예:

```dotenv
APP_ENV=production
HOST_PORT=8000
DATABASE_URL=sqlite:////app/data/lonecare.db
INACTIVITY_THRESHOLD_SECONDS=43200
PRESSURE_DELTA_THRESHOLD=100
SENSOR_OFFLINE_SECONDS=30
```

운영에서는 개발 override를 제외하고 기본 파일만 명시합니다.

```bash
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs -f web
```

`restart: unless-stopped`가 적용되어 Docker 서비스가 부팅될 때 컨테이너도
다시 시작됩니다. Docker 자체 자동 시작도 활성화합니다.

```bash
sudo systemctl enable --now docker
```

같은 네트워크의 PC에서 `http://라즈베리파이_IP:8000`으로 접속합니다.
Pi의 IP는 다음 명령으로 확인할 수 있습니다.

```bash
hostname -I
```

## 기기 추가 방법

별도의 기기 등록 화면이나 사전 등록 과정은 없습니다. 서버가 처음 보는
`device_id`의 센서 데이터를 받으면 해당 기기를 자동으로 등록합니다.

### 1. 서버 연결 확인

센서 기기를 연결하기 전에 서버가 실행 중인지 확인합니다.

```powershell
curl.exe http://localhost:8000/health
```

다음 응답이 나오면 데이터를 받을 준비가 된 상태입니다.

```json
{"status":"ok","environment":"development"}
```

ESP32에서 접속할 때는 `localhost` 대신 서버를 실행 중인 PC 또는 Raspberry
Pi의 LAN IP를 사용해야 합니다.

### 2. 기기 ID 정하기

각 기기에 서로 다른 `device_id`를 지정합니다. 같은 ID로 들어오는 데이터는
같은 기기의 기록으로 저장되고, 새로운 ID를 사용하면 새 기기가 등록됩니다.

권장 예:

| 설치 장소 | `device_id` 예 |
|---|---|
| 거실 | `room-living-001` |
| 침실 | `room-bedroom-001` |
| 현관 | `room-entrance-001` |
| 테스트 기기 | `demo-room-001` |

ID는 영문 소문자, 숫자, 하이픈 조합을 권장합니다. 설치 후에는 기록이
분리되지 않도록 같은 기기의 ID를 변경하지 않는 것이 좋습니다.

### 3. 센서 데이터 한 번 보내기

아래 요청에서 `device_id`를 원하는 값으로 바꿔 전송합니다.

```powershell
curl.exe -X POST http://localhost:8000/api/sensor-data `
  -H "Content-Type: application/json" `
  -d '{"device_id":"room-bedroom-001","pir_motion":true,"pressure_detected":false,"pressure_value":0}'
```

성공하면 HTTP `201 Created`와 함께 다음 형태의 응답을 받습니다.

```json
{
  "message": "sensor data stored",
  "device_id": "room-bedroom-001",
  "activity_detected": true,
  "pressure_delta": null,
  "status": "normal",
  "received_at": "2026-06-12T00:00:00Z"
}
```

이 시점부터 기기가 등록되며 대시보드에 표시됩니다. 등록 결과는 다음
명령으로도 확인할 수 있습니다.

```powershell
curl.exe http://localhost:8000/api/devices
curl.exe http://localhost:8000/api/status
```

### 4. ESP32 기기 추가

[examples/esp32_sensor.ino](examples/esp32_sensor.ino)를 열고 다음 네 값을
설치 환경에 맞게 수정합니다.

```cpp
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL = "http://192.168.0.10:8000/api/sensor-data";
const char* DEVICE_ID = "room-bedroom-001";
const char* DEVICE_LOCATION = "침실";
```

핀 번호도 실제 배선에 맞게 확인합니다.

```cpp
const int PIR_PIN = 27;
const int PRESSURE_PIN = 34;
```

Arduino IDE에서 업로드한 뒤 Serial Monitor를 `115200 baud`로 열어
`POST 201` 또는 `POST 200` 계열 응답이 출력되는지 확인합니다. 기기를 한 대
더 추가하려면 같은 코드를 새 ESP32에 업로드하되 `DEVICE_ID`만 겹치지 않게
변경합니다.

센서 요청에는 다음 선택 정보를 함께 보낼 수 있습니다. 보내지 않아도 기존
요청은 정상 처리되며 대시보드에는 `정보 없음`으로 표시됩니다.

| 필드 | 형식 | 설명 |
|---|---|---|
| `battery_level` | 0~100 정수 | 배터리 잔량(%) |
| `wifi_rssi` | -120~0 정수 | Wi-Fi RSSI(dBm) |
| `location` | 문자열 | 설치 위치 |

```json
{
  "device_id": "room-bedroom-001",
  "pir_motion": true,
  "pressure_detected": false,
  "pressure_value": 1234,
  "battery_level": 87,
  "wifi_rssi": -58,
  "location": "침실"
}
```

### 5. 센서 없이 테스트 기기 추가

Windows 개발 실행에서는 대시보드 상단에 **상태 시뮬레이션** 패널이
표시됩니다.

1. `http://localhost:8000`에 접속합니다.
2. `demo-`로 시작하는 테스트 장치 이름을 입력합니다.
3. **안전 상태**, **주의 상태**, **위험 상태** 중 하나를 누릅니다.
4. 장치 카드와 위험 알림이 즉시 바뀌는지 확인합니다.
5. 테스트가 끝나면 **현재 장치 초기화**를 누릅니다.

테스트 장치 ID는 `demo-room-001`처럼 `demo-`로 시작해야 합니다. 이 기능은
기본적으로 `APP_ENV=development`일 때만 활성화되고 운영 환경에서는
숨겨집니다. 환경과 관계없이 명시적으로 제어하려면 다음 설정을 사용할 수
있습니다.

```dotenv
SIMULATION_ENABLED=true
```

운영 서버에서는 테스트 API가 노출되지 않도록 `SIMULATION_ENABLED=false`를
권장합니다.

### 기기가 나타나지 않을 때

다음 순서로 확인합니다.

1. 서버의 `/health` 요청이 성공하는지 확인합니다.
2. ESP32와 서버가 같은 네트워크에 있는지 확인합니다.
3. `SERVER_URL`에 `localhost`가 아닌 서버의 LAN IP가 들어 있는지 확인합니다.
4. ESP32 Serial Monitor에서 HTTP 응답 코드와 오류 메시지를 확인합니다.
5. Windows 방화벽에서 TCP 8000번 인바운드 연결을 허용합니다.
6. `curl.exe http://localhost:8000/api/logs?limit=20`으로 수신 기록을 확인합니다.
7. 컨테이너 로그를 확인합니다.

```powershell
docker compose logs --tail 100 web
```

## API

| Method | 경로 | 설명 |
|---|---|---|
| POST | `/api/sensor-data` | 센서 데이터 저장 |
| GET | `/api/config` | 위험 판단 및 오프라인 기준 조회 |
| GET | `/api/status` | 장치별 현재 상태와 무활동 시간 |
| GET | `/api/devices` | 등록 장치 목록 |
| GET | `/api/logs` | 최근 센서 로그 |
| GET | `/api/activity?hours=6` | 시간 구간별 센서 수신/활동 집계 |
| GET | `/api/alerts` | 알림 목록 |
| POST | `/api/alerts/{alert_id}/resolve` | 안전 확인 완료 및 장치 상태 정상 복구 |
| POST | `/api/alerts/device/{device_id}/resolve` | 위험 장치의 안전 확인 완료 |
| GET | `/api/simulation` | 시뮬레이션 활성화 여부 확인 |
| POST | `/api/simulation/scenario` | 테스트 장치 상태 변경 |
| DELETE | `/api/simulation/devices/{device_id}` | 테스트 장치 초기화 |

`/api/logs?device_id=room_001&limit=20`처럼 장치와 개수를 지정할 수 있습니다.
`/api/alerts?resolved=false`로 미해제 알림만 조회할 수 있습니다.

## curl 테스트

PowerShell에서는 별칭 충돌을 피하기 위해 `curl.exe`를 사용합니다.

활동 데이터 전송:

```powershell
curl.exe -X POST http://localhost:8000/api/sensor-data `
  -H "Content-Type: application/json" `
  -d '{"device_id":"room_001","pir_motion":true,"pressure_detected":false,"pressure_value":1234}'
```

무활동 데이터 전송:

```powershell
curl.exe -X POST http://localhost:8000/api/sensor-data `
  -H "Content-Type: application/json" `
  -d '{"device_id":"room_001","pir_motion":false,"pressure_detected":false,"pressure_value":1234}'
```

조회 및 알림 해제:

```powershell
curl.exe http://localhost:8000/api/status
curl.exe http://localhost:8000/api/devices
curl.exe "http://localhost:8000/api/logs?limit=20"
curl.exe "http://localhost:8000/api/alerts?resolved=false"
curl.exe -X POST http://localhost:8000/api/alerts/1/resolve
```

Linux/Raspberry Pi에서는 줄바꿈 없이 같은 명령을 사용하거나 PowerShell의
백틱 대신 `\`를 사용합니다.

## ESP32 연결

예제는 [examples/esp32_sensor.ino](examples/esp32_sensor.ino)에 있습니다.

Arduino IDE에서 다음을 준비합니다.

1. ESP32 보드 패키지를 설치합니다.
2. Library Manager에서 `ArduinoJson`을 설치합니다.
3. Wi-Fi 이름, 비밀번호, 서버 IP를 수정합니다.
4. PIR 핀과 압력 센서 ADC 핀을 실제 배선에 맞게 수정합니다.
5. ESP32와 서버가 같은 네트워크에 연결되어 있는지 확인합니다.

서버 주소의 `localhost`는 ESP32 자신을 뜻하므로 사용할 수 없습니다.
Windows에서는 `ipconfig`, Raspberry Pi에서는 `hostname -I`로 서버의 LAN
IP를 확인하여 다음처럼 지정합니다.

```cpp
const char* SERVER_URL = "http://192.168.0.10:8000/api/sensor-data";
```

Windows 방화벽이 연결을 막으면 TCP 8000번 인바운드 연결을 허용해야 합니다.

## 60초 발표 시연 시나리오

먼저 `.env`의 `INACTIVITY_THRESHOLD_SECONDS=60`을 확인하고 컨테이너를
재시작합니다.

```powershell
docker compose up -d --build
```

1. 대시보드와 Swagger 문서를 엽니다.
2. PIR `true` 데이터를 보내 `room_001`을 등록합니다.
3. 즉시 대시보드에서 `normal`과 최근 활동 시각을 확인합니다.
4. 센서를 움직이지 않고 약 30초 기다립니다. 대시보드 자동 갱신 후
   `warning`으로 변합니다.
5. 총 60초가 지나면 `danger`와 위험 알림이 표시됩니다.
6. `/api/status`를 여러 번 호출해도 열린 danger 알림이 하나뿐임을 보여줍니다.
7. PIR `true`를 다시 전송하거나 압력 값을 기준보다 크게 변화시킵니다.
8. 상태가 `normal`로 복구되고 기존 알림이 자동 해제되는 것을 확인합니다.
9. 컨테이너를 재시작한 후 장치, 로그, 알림 데이터가 유지되는지 확인합니다.

```powershell
docker compose restart web
curl.exe http://localhost:8000/api/devices
curl.exe http://localhost:8000/api/logs
```

압력 변화 활동 시연은 기준값을 먼저 저장한 뒤 두 번째 값을 크게 바꿉니다.

```powershell
curl.exe -X POST http://localhost:8000/api/sensor-data -H "Content-Type: application/json" -d '{"device_id":"room_002","pir_motion":false,"pressure_detected":true,"pressure_value":1000}'
curl.exe -X POST http://localhost:8000/api/sensor-data -H "Content-Type: application/json" -d '{"device_id":"room_002","pir_motion":false,"pressure_detected":true,"pressure_value":1200}'
```

기본 임계값이 100이면 두 번째 요청의 변화량 200이 활동으로 판정됩니다.

## UI 확인용 샘플 데이터 50개

[app/seeds/ui_preview.sql](app/seeds/ui_preview.sql)은 다음 데이터를 만듭니다.

- 자연스러운 이름의 장치 50개
- 안전 25개, 주의 15개, 위험 10개
- 온라인/오프라인, 저배터리, Wi-Fi 신호, 설치 위치 조합
- 최근 24시간 센서 로그 300개
- 미해결 위험 알림 10개

같은 SQL을 다시 실행하면 해당 샘플 장치만 교체하므로 중복되지 않습니다.

```powershell
docker compose exec web python -c "import sqlite3; db=sqlite3.connect('/app/data/lonecare.db'); db.executescript(open('/app/app/seeds/ui_preview.sql', encoding='utf-8').read()); db.close()"
```

적용 후 다음 페이지에서 UI를 확인합니다.

- 대시보드: http://localhost:8000
- 장치 관리: http://localhost:8000/devices

샘플 데이터만 삭제:

```powershell
docker compose exec web python -c "import sqlite3; db=sqlite3.connect('/app/data/lonecare.db'); db.executescript(open('/app/app/seeds/ui_preview_cleanup.sql', encoding='utf-8').read()); db.close()"
```

## 데이터 보존과 백업

DB는 컨테이너 내부 `/app/data/lonecare.db`에 있고, Compose named volume
`lonecare_data`가 이 경로를 보존합니다. 컨테이너 삭제/재생성 후에도
volume을 삭제하지 않는 한 데이터가 유지됩니다.

간단한 백업 예:

```bash
docker compose -f docker-compose.yml exec web \
  python -c "import sqlite3; src=sqlite3.connect('/app/data/lonecare.db'); dst=sqlite3.connect('/app/data/backup.db'); src.backup(dst)"
```

SQLite는 이 규모의 단일 서버 IoT 프로젝트에 적합합니다. 여러 Uvicorn
worker에서 동시에 쓰지 않도록 현재 구성은 worker 1개로 실행합니다.
