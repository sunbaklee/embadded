#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// 사용 환경에 맞게 수정하세요.
const char* WIFI_SSID = "KT_GIGA_2G_Wave2_1C1F";
const char* WIFI_PASSWORD = "eb31eg3796";
const char* SERVER_URL = "http://172.30.1.83:8000/api/sensor-data";
const char* DEVICE_ID = "room_001";
const char* DEVICE_LOCATION = "침실";

const int PIR_PIN = 27;
const int PRESSURE_PIN = 34;
const unsigned long SEND_INTERVAL_MS = 5000;

unsigned long lastSentAt = 0;

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);

  Serial.println();
  Serial.println("=== Wi-Fi 연결 시작 ===");
  Serial.print("SSID: ");
  Serial.println(WIFI_SSID);

  WiFi.disconnect(true);
  delay(1000);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startTime = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - startTime < 20000) {
    delay(500);
    Serial.print(".");
    Serial.print(WiFi.status());
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Wi-Fi 연결 성공!");
    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("RSSI: ");
    Serial.println(WiFi.RSSI());
  } else {
    Serial.println("Wi-Fi 연결 실패");
    Serial.print("최종 WiFi.status(): ");
    Serial.println(WiFi.status());
  }
}

void sendSensorData() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  const bool pirMotion = digitalRead(PIR_PIN) == HIGH;
  const int pressureValue = analogRead(PRESSURE_PIN);
  const bool pressureDetected = pressureValue > 0;

  JsonDocument document;
  document["device_id"] = DEVICE_ID;
  document["pir_motion"] = pirMotion;
  document["pressure_detected"] = pressureDetected;
  document["pressure_value"] = pressureValue;
  document["wifi_rssi"] = WiFi.RSSI();
  document["location"] = DEVICE_LOCATION;
  // 배터리 측정 회로가 있다면 0~100 값을 함께 전송할 수 있습니다.
  // document["battery_level"] = 87;

  String body;
  serializeJson(document, body);

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  const int responseCode = http.POST(body);

  Serial.printf("POST %d: ", responseCode);
  if (responseCode > 0) {
    Serial.println(http.getString());
  } else {
    Serial.println(http.errorToString(responseCode));
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  pinMode(PIR_PIN, INPUT);
  pinMode(PRESSURE_PIN, INPUT);
  connectWiFi();
}

void loop() {
  const unsigned long now = millis();
  if (now - lastSentAt >= SEND_INTERVAL_MS) {
    lastSentAt = now;
    sendSensorData();
  }
  delay(50);
}
