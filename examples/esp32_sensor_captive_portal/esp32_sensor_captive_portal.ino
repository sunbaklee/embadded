#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>

const char* DEVICE_ID = "room_001";
const char* DEVICE_LOCATION = "침실";

const int PIR_PIN = 27;
const int PRESSURE_PIN = 34;
const int CONFIG_BUTTON_PIN = 0;  // ESP32 BOOT button

const unsigned long SEND_INTERVAL_MS = 5000;
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 20000;
const byte DNS_PORT = 53;

Preferences preferences;
DNSServer dnsServer;
WebServer webServer(80);

String wifiSsid;
String wifiPassword;
String serverHost;
uint16_t serverPort = 8000;
String serverUrl;

unsigned long lastSentAt = 0;

String htmlEscape(const String& value) {
  String escaped = value;
  escaped.replace("&", "&amp;");
  escaped.replace("<", "&lt;");
  escaped.replace(">", "&gt;");
  escaped.replace("\"", "&quot;");
  escaped.replace("'", "&#39;");
  return escaped;
}

String makeAccessPointName() {
  const uint64_t chipId = ESP.getEfuseMac();
  char suffix[7];
  snprintf(suffix, sizeof(suffix), "%06llX", chipId & 0xFFFFFF);
  return "LoneCare-" + String(suffix);
}

void loadSettings() {
  preferences.begin("lonecare", true);
  wifiSsid = preferences.getString("ssid", "");
  wifiPassword = preferences.getString("password", "");
  serverHost = preferences.getString("server", "");
  serverPort = preferences.getUShort("port", 8000);
  preferences.end();

  if (serverPort == 0) {
    serverPort = 8000;
  }

  serverUrl = "http://" + serverHost + ":" + String(serverPort) + "/api/sensor-data";
}

bool hasSavedSettings() {
  return !wifiSsid.isEmpty() && !serverHost.isEmpty();
}

bool connectWiFi() {
  if (!hasSavedSettings()) {
    return false;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());

  Serial.print("Wi-Fi connecting to ");
  Serial.println(wifiSsid);

  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED &&
         millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi connection failed.");
    WiFi.disconnect(true);
    return false;
  }

  Serial.println("Wi-Fi connected.");
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());
  Serial.print("Server URL: ");
  Serial.println(serverUrl);
  return true;
}

String configurationPage(const String& message = "") {
  String page;
  page.reserve(5000);
  page += F(
      "<!doctype html><html lang='ko'><head>"
      "<meta charset='utf-8'>"
      "<meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<title>LoneCare ESP32 설정</title>"
      "<style>"
      "*{box-sizing:border-box}body{margin:0;background:#eef2f7;color:#172033;"
      "font-family:Arial,'Noto Sans KR',sans-serif}.card{max-width:520px;margin:32px "
      "auto;padding:24px;background:#fff;border-radius:18px;box-shadow:0 12px 35px "
      "rgba(23,32,51,.12)}h1{margin:0 0 8px;font-size:24px}p{line-height:1.55;"
      "color:#526078}.notice{padding:12px;margin:16px 0;background:#e8f5ee;"
      "color:#17643a;border-radius:10px}label{display:block;margin-top:16px;"
      "font-weight:700}input{width:100%;margin-top:7px;padding:12px;border:1px "
      "solid #cbd5e1;border-radius:10px;font-size:16px}button{width:100%;"
      "margin-top:22px;padding:13px;border:0;border-radius:10px;background:#1769e0;"
      "color:#fff;font-size:16px;font-weight:700}small{display:block;margin-top:6px;"
      "color:#718096}.url{word-break:break-all;font-family:monospace}"
      "</style></head><body><main class='card'>"
      "<h1>LoneCare ESP32 설정</h1>"
      "<p>ESP32가 사용할 Wi-Fi와 센서 데이터를 받을 서버를 입력하세요.</p>");

  if (!message.isEmpty()) {
    page += "<div class='notice'>" + htmlEscape(message) + "</div>";
  }

  page += F("<form method='post' action='/save'>");
  page += "<label for='ssid'>Wi-Fi 이름(SSID)</label>";
  page += "<input id='ssid' name='ssid' maxlength='32' required value='" +
          htmlEscape(wifiSsid) + "'>";
  page += F(
      "<label for='password'>Wi-Fi 비밀번호</label>"
      "<input id='password' name='password' type='password' maxlength='64' "
      "placeholder='변경하지 않으면 기존 값 유지'>"
      "<label for='server'>서버 IP 또는 호스트명</label>");
  page += "<input id='server' name='server' maxlength='100' required "
          "placeholder='예: 192.168.0.10' value='" + htmlEscape(serverHost) + "'>";
  page += F(
      "<small>http:// 또는 경로를 붙이지 말고 IP만 입력하세요.</small>"
      "<label for='port'>서버 포트</label>");
  page += "<input id='port' name='port' type='number' min='1' max='65535' "
          "required value='" + String(serverPort) + "'>";
  page += F(
      "<small>기본값은 8000입니다.</small>"
      "<button type='submit'>저장하고 재시작</button></form>");

  if (!serverHost.isEmpty()) {
    page += "<p>현재 전송 주소<br><span class='url'>" +
            htmlEscape(serverUrl) + "</span></p>";
  }

  page += F("</main></body></html>");
  return page;
}

void redirectToPortal() {
  webServer.sendHeader("Location", "http://" + WiFi.softAPIP().toString(), true);
  webServer.send(302, "text/plain", "");
}

void saveSettings() {
  String newSsid = webServer.arg("ssid");
  String newPassword = webServer.arg("password");
  String newServerHost = webServer.arg("server");
  const long newPort = webServer.arg("port").toInt();

  newSsid.trim();
  newServerHost.trim();
  newServerHost.replace("http://", "");
  newServerHost.replace("https://", "");
  const int slashPosition = newServerHost.indexOf('/');
  if (slashPosition >= 0) {
    newServerHost = newServerHost.substring(0, slashPosition);
  }

  if (newSsid.isEmpty() || newServerHost.isEmpty() ||
      newPort < 1 || newPort > 65535) {
    webServer.send(400, "text/html; charset=utf-8",
                   configurationPage("입력값을 확인하세요."));
    return;
  }

  preferences.begin("lonecare", false);
  preferences.putString("ssid", newSsid);
  if (!newPassword.isEmpty() || wifiPassword.isEmpty()) {
    preferences.putString("password", newPassword);
  }
  preferences.putString("server", newServerHost);
  preferences.putUShort("port", static_cast<uint16_t>(newPort));
  preferences.end();

  webServer.send(
      200, "text/html; charset=utf-8",
      "<!doctype html><html lang='ko'><head><meta charset='utf-8'>"
      "<meta name='viewport' content='width=device-width,initial-scale=1'>"
      "</head><body style='font-family:Arial,sans-serif;padding:28px'>"
      "<h2>설정을 저장했습니다.</h2><p>ESP32를 재시작합니다. 설정 Wi-Fi에 "
      "연결된 뒤 잠시 기다려 주세요.</p></body></html>");

  delay(1500);
  ESP.restart();
}

void startConfigurationPortal() {
  WiFi.disconnect(true);
  delay(200);
  WiFi.mode(WIFI_AP);

  const String accessPointName = makeAccessPointName();
  WiFi.softAP(accessPointName.c_str());
  delay(200);

  dnsServer.start(DNS_PORT, "*", WiFi.softAPIP());

  webServer.on("/", HTTP_GET, []() {
    webServer.send(200, "text/html; charset=utf-8", configurationPage());
  });
  webServer.on("/save", HTTP_POST, saveSettings);

  // Common captive portal detection URLs.
  webServer.on("/generate_204", HTTP_ANY, redirectToPortal);
  webServer.on("/gen_204", HTTP_ANY, redirectToPortal);
  webServer.on("/hotspot-detect.html", HTTP_ANY, redirectToPortal);
  webServer.on("/library/test/success.html", HTTP_ANY, redirectToPortal);
  webServer.on("/ncsi.txt", HTTP_ANY, redirectToPortal);
  webServer.on("/connecttest.txt", HTTP_ANY, redirectToPortal);
  webServer.onNotFound(redirectToPortal);
  webServer.begin();

  Serial.println();
  Serial.println("=== Captive Portal mode ===");
  Serial.print("Connect to Wi-Fi: ");
  Serial.println(accessPointName);
  Serial.print("Open: http://");
  Serial.println(WiFi.softAPIP());

  while (true) {
    dnsServer.processNextRequest();
    webServer.handleClient();
    delay(2);
  }
}

void sendSensorData() {
  if (WiFi.status() != WL_CONNECTED && !connectWiFi()) {
    startConfigurationPortal();
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

  String body;
  serializeJson(document, body);

  HTTPClient http;
  http.begin(serverUrl);
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
  pinMode(CONFIG_BUTTON_PIN, INPUT_PULLUP);
  delay(500);

  loadSettings();

  // Hold the BOOT button while powering on to reopen the setup portal.
  if (digitalRead(CONFIG_BUTTON_PIN) == LOW ||
      !hasSavedSettings() ||
      !connectWiFi()) {
    startConfigurationPortal();
  }
}

void loop() {
  const unsigned long now = millis();
  if (now - lastSentAt >= SEND_INTERVAL_MS) {
    lastSentAt = now;
    sendSensorData();
  }
  delay(50);
}
