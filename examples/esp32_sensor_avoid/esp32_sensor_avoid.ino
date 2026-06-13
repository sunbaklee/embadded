#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// =======================
// Wi-Fi / Server 설정
// =======================
const char* WIFI_SSID = "DoD_2.4G";
const char* WIFI_PASSWORD = "dod54321";

const char* SERVER_URL = "http://192.168.0.13:8000/api/sensor-data";

const char* DEVICE_ID = "room_001";
const char* DEVICE_LOCATION = "침실";

// =======================
// 핀 설정
// =======================
// 이 보드는 침대 사용 여부(avoid 모듈)만 담당한다. PIR/움직임은 레이더 보드가 담당.
#define AVOID_PIN 27

// =======================
// 전송 주기 설정
// =======================
const unsigned long SEND_INTERVAL = 5000; // 5초마다 전송
unsigned long lastSendTime = 0;

// =======================
// Avoid 센서 감지 조건
// =======================
// 대부분 IR Avoid 센서는 감지 시 LOW가 나옴.
// 만약 시리얼에서 반대로 나오면 false로 바꾸면 됨.
const bool AVOID_DETECTED_IS_LOW = true;

// =======================
// Wi-Fi 연결 함수
// =======================
void connectWiFi() {
  Serial.print("Wi-Fi 연결 중: ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int retryCount = 0;

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");

    retryCount++;

    if (retryCount > 40) {
      Serial.println();
      Serial.println("Wi-Fi 연결 실패. 재시도합니다.");
      retryCount = 0;
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }

  Serial.println();
  Serial.println("Wi-Fi 연결 완료!");
  Serial.print("ESP32 IP 주소: ");
  Serial.println(WiFi.localIP());
}

// =======================
// 센서 읽기 함수
// =======================
bool readAvoidDetected() {
  int avoidValue = digitalRead(AVOID_PIN);

  if (AVOID_DETECTED_IS_LOW) {
    return avoidValue == LOW;
  } else {
    return avoidValue == HIGH;
  }
}

// =======================
// 서버 전송 함수
// =======================
void sendSensorData(bool seatDetected, int avoidRawValue) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi 끊김. 재연결 시도.");
    connectWiFi();
  }

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;

  doc["device_id"] = DEVICE_ID;
  doc["location"] = DEVICE_LOCATION;

  // 이 보드는 '침대 사용 여부'만 담당한다.
  // 움직임(pir_motion)은 레이더 보드가 보내므로 여기서는 보내지 않는다.
  // avoid 모듈은 디지털이라 pressure_value(아날로그)도 보내지 않는다.
  // (부분 업데이트: 보내지 않은 필드는 서버가 건드리지 않아 서로 덮어쓰지 않는다.)
  doc["pressure_detected"] = seatDetected;

  // Avoid 센서 원본값(디버그용)
  doc["avoid_detected"] = seatDetected;
  doc["avoid_raw"] = avoidRawValue;

  String jsonData;
  serializeJson(doc, jsonData);

  Serial.println("전송 JSON:");
  Serial.println(jsonData);

  int httpResponseCode = http.POST(jsonData);

  Serial.print("HTTP 응답 코드: ");
  Serial.println(httpResponseCode);

  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.print("서버 응답: ");
    Serial.println(response);
  } else {
    Serial.print("전송 실패: ");
    Serial.println(http.errorToString(httpResponseCode));
  }

  http.end();
}

// =======================
// setup
// =======================
void setup() {
  Serial.begin(115200);

  pinMode(AVOID_PIN, INPUT);

  Serial.println();
  Serial.println("Avoid(침대 사용 여부) 센서 JSON 전송 시작");

  connectWiFi();
}

// =======================
// loop
// =======================
void loop() {
  int avoidRawValue = digitalRead(AVOID_PIN);
  bool seatDetected = readAvoidDetected();

  Serial.print("Avoid 원본값: ");
  Serial.print(avoidRawValue);

  Serial.print(" / 침대·의자 사용 여부: ");
  Serial.println(seatDetected ? "감지" : "없음");

  unsigned long currentTime = millis();

  if (currentTime - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = currentTime;
    sendSensorData(seatDetected, avoidRawValue);
  }

  delay(500);
}