#include <ArduinoJson.h>
#include <HTTPClient.h>

#include "PortalConfig.h"

const char* DEVICE_ID = "room_001";
const char* DEVICE_LOCATION = "침실";

#define AVOID_PIN 27

const unsigned long SEND_INTERVAL = 5000;
const bool AVOID_DETECTED_IS_LOW = true;

unsigned long lastSendTime = 0;
PortalConfig portal("AVOID");

bool readAvoidDetected() {
  const int avoidValue = digitalRead(AVOID_PIN);
  return AVOID_DETECTED_IS_LOW ? avoidValue == LOW : avoidValue == HIGH;
}

void sendSensorData(bool seatDetected, int avoidRawValue) {
  if (!portal.ensureConnected()) {
    return;
  }

  HTTPClient http;
  http.begin(portal.sensorUrl());
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> document;
  document["device_id"] = DEVICE_ID;
  document["location"] = DEVICE_LOCATION;
  document["pressure_detected"] = seatDetected;
  document["avoid_detected"] = seatDetected;
  document["avoid_raw"] = avoidRawValue;

  String body;
  serializeJson(document, body);

  Serial.println("========== SEND DATA ==========");
  Serial.println(body);

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
  pinMode(AVOID_PIN, INPUT);

  Serial.println();
  Serial.println("ESP32 Avoid Captive Portal");
  portal.begin();
}

void loop() {
  portal.handleResetButton();
  const int avoidRawValue = digitalRead(AVOID_PIN);
  const bool seatDetected = readAvoidDetected();

  Serial.print("Avoid raw: ");
  Serial.print(avoidRawValue);
  Serial.print(" / seat: ");
  Serial.println(seatDetected ? "detected" : "empty");

  const unsigned long now = millis();
  if (now - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = now;
    sendSensorData(seatDetected, avoidRawValue);
  }

  delay(500);
}
