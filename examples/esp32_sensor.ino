#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// 사용 환경에 맞게 수정하세요.
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL = "http://192.168.0.10:8000/api/sensor-data";
const char* DEVICE_ID = "room_001";

const int PIR_PIN = 27;
const int PRESSURE_PIN = 34;
const unsigned long SEND_INTERVAL_MS = 5000;

unsigned long lastSentAt = 0;

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Wi-Fi connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());
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
