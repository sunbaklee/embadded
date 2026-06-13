#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <MyLD2410.h>

// =======================
// Wi-Fi / Server 설정
// =======================
const char* WIFI_SSID = "DoD_2.4G";
const char* WIFI_PASSWORD = "dod54321";
const char* SERVER_URL = "http://192.168.0.13:8000/api/sensor-data";
const char* DEVICE_ID = "room_001";
const char* DEVICE_LOCATION = "침실";

// =======================
// LD2410C-P UART 핀 설정
// =======================
// LD2410C-P TX → ESP32 GPIO16
// LD2410C-P RX → ESP32 GPIO17
const int LD2410_RX_PIN = 16;  // ESP32가 받는 핀
const int LD2410_TX_PIN = 17;  // ESP32가 보내는 핀

const unsigned long SEND_INTERVAL_MS = 5000;

unsigned long lastSentAt = 0;
unsigned long lastRadarDataAt = 0;

// ESP32의 UART2 사용
HardwareSerial radarSerial(2);
MyLD2410 radar(radarSerial);

// 레이더 상태 저장 변수
bool radarOnline = false;
bool presenceDetected = false;
bool movingDetected = false;
bool stationaryDetected = false;

int radarDistanceCm = 0;
int movingDistanceCm = 0;
int stationaryDistanceCm = 0;
int movingSignal = 0;
int stationarySignal = 0;

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

void updateRadarData() {
  MyLD2410::Response response = radar.check();

  if (response == MyLD2410::Response::DATA) {
    radarOnline = true;
    lastRadarDataAt = millis();

    presenceDetected = radar.presenceDetected();
    movingDetected = radar.movingTargetDetected();
    stationaryDetected = radar.stationaryTargetDetected();

    if (presenceDetected) {
      radarDistanceCm = radar.detectedDistance();
    } else {
      radarDistanceCm = 0;
    }

    if (movingDetected) {
      movingDistanceCm = radar.movingTargetDistance();
      movingSignal = radar.movingTargetSignal();
    } else {
      movingDistanceCm = 0;
      movingSignal = 0;
    }

    if (stationaryDetected) {
      stationaryDistanceCm = radar.stationaryTargetDistance();
      stationarySignal = radar.stationaryTargetSignal();
    } else {
      stationaryDistanceCm = 0;
      stationarySignal = 0;
    }
  }

  // 10초 이상 데이터가 안 들어오면 레이더 통신 실패로 판단
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
  if (!radarOnline) {
    return "radar_offline";
  }

  if (movingDetected) {
    return "moving";
  }

  if (stationaryDetected) {
    return "stationary";
  }

  if (presenceDetected) {
    return "presence";
  }

  return "empty";
}

void sendSensorData() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  JsonDocument document;

  document["device_id"] = DEVICE_ID;
  document["location"] = DEVICE_LOCATION;

  // 이 보드는 '움직임'만 담당한다.
  // 침대 사용 여부(pressure_detected)는 avoid 보드가 보내므로 여기서는 보내지 않는다.
  // (부분 업데이트: 보내지 않은 필드는 서버가 건드리지 않아 서로 덮어쓰지 않는다.)
  document["pir_motion"] = movingDetected;

  // LD2410C-P 전용 데이터
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
  http.begin(SERVER_URL);
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

  Serial.println();
  Serial.println("ESP32 + LD2410C-P TEST START");

  connectWiFi();

  // LD2410C-P UART 시작
  // 기본 통신속도는 256000
  radarSerial.begin(LD2410_BAUD_RATE, SERIAL_8N1, LD2410_RX_PIN, LD2410_TX_PIN);

  delay(2000);

  if (radar.begin()) {
    radarOnline = true;
    lastRadarDataAt = millis();

    // 일반 모드
    radar.enhancedMode(false);

    Serial.println("LD2410C-P connected.");
  } else {
    radarOnline = false;
    Serial.println("LD2410C-P connection failed.");
    Serial.println("Check wiring: LD2410 TX -> ESP32 GPIO16, LD2410 RX -> ESP32 GPIO17");
  }
  
}

void loop() {
  // LD2410C-P는 계속 읽어줘야 함
  updateRadarData();

  const unsigned long now = millis();

  if (now - lastSentAt >= SEND_INTERVAL_MS) {
    lastSentAt = now;
    sendSensorData();
  }

  delay(20);
}