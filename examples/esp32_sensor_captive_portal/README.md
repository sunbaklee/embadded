# ESP32 Captive Portal 버전

기존 `examples/esp32_sensor/esp32_sensor.ino`는 수정하지 않았습니다. 이 폴더의
`esp32_sensor_captive_portal.ino`는 Wi-Fi 정보와 서버 IP를 ESP32 설정 화면에서
입력하고 플래시 메모리에 저장하는 복사본입니다.

## 처음 설정

1. Arduino IDE에서 `esp32_sensor_captive_portal.ino`를 열고 ESP32에 업로드합니다.
2. 휴대폰이나 노트북의 Wi-Fi 목록에서 `LoneCare-XXXXXX`에 연결합니다.
3. 설정 화면이 자동으로 뜨지 않으면 브라우저에서 `http://192.168.4.1`을 엽니다.
4. Wi-Fi 이름, 비밀번호, 서버 IP, 포트를 입력합니다.
5. `저장하고 재시작`을 누릅니다.

서버 IP에는 `192.168.0.10`처럼 IP만 입력합니다. `http://`, 포트, API 경로는
따로 입력하거나 코드에서 자동으로 추가됩니다. 실제 전송 주소는 다음 형식입니다.

```text
http://서버IP:8000/api/sensor-data
```

## 설정 다시 열기

ESP32 전원을 켜거나 리셋할 때 보드의 `BOOT` 버튼(GPIO 0)을 누르고 있으면
`LoneCare-XXXXXX` 설정 Wi-Fi가 다시 열립니다. 저장된 Wi-Fi 연결이 20초 동안
실패해도 설정 모드가 자동으로 열립니다.

## 필요한 라이브러리

- ESP32 보드 패키지에 포함: `WiFi`, `HTTPClient`, `WebServer`, `DNSServer`,
  `Preferences`
- Arduino Library Manager에서 별도 설치: `ArduinoJson`

설정용 AP는 초기 연결 편의를 위해 비밀번호가 없는 개방형 네트워크입니다. 현장
설정을 마치면 ESP32가 AP를 종료하고 지정한 Wi-Fi에 연결합니다.
