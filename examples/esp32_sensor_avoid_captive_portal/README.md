# Avoid 센서 Captive Portal 복사본

원본 `examples/esp32_sensor_avoid/esp32_sensor_avoid.ino`의 Avoid 센서 로직을
유지하면서 Wi-Fi와 서버 IP 설정만 Captive Portal 방식으로 변경한 버전입니다.

1. `esp32_sensor_avoid_captive_portal.ino`를 ESP32에 업로드합니다.
2. `LoneCare-AVOID-Open-Router-XXXXXX` Wi-Fi에 연결합니다.
3. 자동 팝업이 없으면 Wi-Fi 상세 화면에서 `공유기 관리`를 누릅니다.
4. `공유기 관리`가 없으면 `http://192.168.4.1`을 엽니다.
5. 방 이름/디바이스 위치와 Wi-Fi 이름/비밀번호, 서버 IP/포트를 저장합니다.

방 이름과 디바이스 위치는 센서 데이터의 `room_name`, `location` 값으로
서버에 전송됩니다.

네이버처럼 HTTPS를 강제하는 사이트는 Captive Portal이 가로챌 수 없습니다.
자동 화면이 뜨지 않으면 주소창에 `http://192.168.4.1`을 직접 입력하거나
`http://neverssl.com`처럼 HTTP 주소를 사용합니다.

실행 중에 BOOT 버튼(GPIO 0)을 5초 이상 누르고 있다가 손을 떼면 ESP32가
설정 모드로 재부팅됩니다. 기존 설정은 유지됩니다. 재부팅 후
`LoneCare-AVOID-Open-Router-XXXXXX` Wi-Fi에 연결하고 `http://192.168.4.1`을
여세요. 저장한 Wi-Fi 연결이 20초간 실패해도 설정 화면이 자동으로 열립니다.

BOOT 버튼을 누른 상태에서 리셋하거나 전원을 켜면 ESP32 다운로드 모드로 들어갈
수 있으므로, 보드가 정상 실행 중일 때 버튼을 5초 누른 뒤 손을 떼세요.

필요한 추가 라이브러리는 `ArduinoJson`입니다.
