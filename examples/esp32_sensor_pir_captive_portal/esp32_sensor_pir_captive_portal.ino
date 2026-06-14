#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <MyLD2410.h>

#include "PortalConfig.h"

const char* DEVICE_ID = "room_001";

const int LD2410_RX_PIN = 16;
const int LD2410_TX_PIN = 17;
const unsigned long SEND_INTERVAL_MS = 5000;

unsigned long lastSentAt = 0;
unsigned long lastRadarDataAt = 0;

HardwareSerial radarSerial(2);
MyLD2410 radar(radarSerial);
PortalConfig portal("PIR");

bool radarOnline = false;
bool presenceDetected = false;
bool movingDetected = false;
bool stationaryDetected = false;

int radarDistanceCm = 0;
int movingDistanceCm = 0;
int stationaryDistanceCm = 0;
int movingSignal = 0;
int stationarySignal = 0;

void updateRadarData() {
  const MyLD2410::Response response = radar.check();

  if (response == MyLD2410::Response::DATA) {
    radarOnline = true;
    lastRadarDataAt = millis();
    presenceDetected = radar.presenceDetected();
    movingDetected = radar.movingTargetDetected();
    stationaryDetected = radar.stationaryTargetDetected();
    radarDistanceCm = presenceDetected ? radar.detectedDistance() : 0;
    movingDistanceCm = movingDetected ? radar.movingTargetDistance() : 0;
    stationaryDistanceCm =
        stationaryDetected ? radar.stationaryTargetDistance() : 0;
    movingSignal = movingDetected ? radar.movingTargetSignal() : 0;
    stationarySignal =
        stationaryDetected ? radar.stationaryTargetSignal() : 0;
  }

  if (millis() - lastRadarDataAt > 10000) {
    radarOnline = false;
    presenceDetected = false;
    movingDetected = false;
    stationaryDetected = false;
    radarDistanceCm = 0;
    movingDistanceCm = 0;
    stationaryDistanceCm = 0;
    movingSignal = 0;
    stationarySignal = 0;
  }
}

String makeStateText() {
  if (!radarOnline) return "radar_offline";
  if (movingDetected) return "moving";
  if (stationaryDetected) return "stationary";
  if (presenceDetected) return "presence";
  return "empty";
}

void sendSensorData() {
  if (!portal.ensureConnected()) {
    return;
  }

  JsonDocument document;
  document["device_id"] = DEVICE_ID;
  document["location"] = portal.deviceLocation();
  document["room_name"] = portal.roomName();
  // Keep pir_motion for backward compatibility. Presence is the primary
  // monitoring condition used by the server.
  document["pir_motion"] = movingDetected;
  document["radar_online"] = radarOnline;
  document["presence_detected"] = presenceDetected;
  document["moving_detected"] = movingDetected;
  document["stationary_detected"] = stationaryDetected;
  document["radar_distance_cm"] = radarDistanceCm;
  document["moving_distance_cm"] = movingDistanceCm;
  document["stationary_distance_cm"] = stationaryDistanceCm;
  document["moving_signal"] = movingSignal;
  document["stationary_signal"] = stationarySignal;
  document["state"] = makeStateText();
  document["wifi_rssi"] = WiFi.RSSI();

  String body;
  serializeJson(document, body);

  HTTPClient http;
  http.begin(portal.sensorUrl());
  http.setConnectTimeout(1500);
  http.setTimeout(2000);
  http.addHeader("Content-Type", "application/json");
  const int responseCode = http.POST(body);

  Serial.println("========== SEND DATA ==========");
  Serial.println(body);
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
  delay(1000);
  Serial.println("ESP32 + LD2410C-P Captive Portal");

  portal.begin();

  radarSerial.begin(
      LD2410_BAUD_RATE, SERIAL_8N1, LD2410_RX_PIN, LD2410_TX_PIN);
  delay(2000);

  if (radar.begin()) {
    radarOnline = true;
    lastRadarDataAt = millis();
    radar.enhancedMode(false);
    Serial.println("LD2410C-P connected.");
  } else {
    Serial.println("LD2410C-P connection failed.");
    Serial.println(
        "Check wiring: LD2410 TX -> GPIO16, LD2410 RX -> GPIO17");
  }
}

void loop() {
  portal.handleConfigButton();
  updateRadarData();

  const unsigned long now = millis();
  if (now - lastSentAt >= SEND_INTERVAL_MS) {
    lastSentAt = now;
    sendSensorData();
  }

  delay(20);
}
