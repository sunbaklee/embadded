# PIR(LD2410C-P) Captive Portal 복사본

원본 `examples/esp32_sensor_pir/esp32_sensor_pir.ino`의 레이더 센서 로직을
유지하면서 Wi-Fi와 서버 IP 설정만 Captive Portal 방식으로 변경한 버전입니다.

1. `esp32_sensor_pir_captive_portal.ino`를 ESP32에 업로드합니다.
2. `LoneCare-PIR-Open-Router-XXXXXX` Wi-Fi에 연결합니다.
3. 자동 팝업이 없으면 Wi-Fi 상세 화면에서 `공유기 관리`를 누릅니다.
4. `공유기 관리`가 없으면 `http://192.168.4.1`을 엽니다.
5. Wi-Fi 이름/비밀번호와 서버 IP/포트를 저장합니다.

네이버처럼 HTTPS를 강제하는 사이트는 Captive Portal이 가로챌 수 없습니다.
자동 화면이 뜨지 않으면 주소창에 `http://192.168.4.1`을 직접 입력하거나
`http://neverssl.com`처럼 HTTP 주소를 사용합니다.

부팅할 때 BOOT 버튼(GPIO 0)을 누르고 있거나 저장한 Wi-Fi 연결이 20초간
실패하면 설정 화면이 다시 열립니다.

저장된 설정을 완전히 초기화하려면 ESP32가 실행 중일 때 BOOT 버튼을 5초 이상
누릅니다. Wi-Fi, 비밀번호, 서버 IP, 포트가 삭제되고 설정 모드로 재부팅됩니다.

필요한 추가 라이브러리는 `ArduinoJson`, `MyLD2410`입니다.
