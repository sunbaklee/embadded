#pragma once

#include <DNSServer.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>

class PortalConfig {
 public:
  explicit PortalConfig(const char* deviceType) : deviceType_(deviceType) {}

  bool begin() {
    load();

    pinMode(0, INPUT_PULLUP);
    delay(500);

    if (digitalRead(0) == LOW || !hasSettings() || !connect()) {
      startPortal();
      return false;
    }

    return true;
  }

  bool ensureConnected() {
    if (WiFi.status() == WL_CONNECTED) {
      return true;
    }

    if (connect()) {
      return true;
    }

    startPortal();
    return false;
  }

  void handleResetButton() {
    const bool pressed = digitalRead(0) == LOW;

    if (pressed && resetPressedAt_ == 0) {
      resetPressedAt_ = millis();
    }

    if (!pressed) {
      resetPressedAt_ = 0;
      resetTriggered_ = false;
      return;
    }

    if (!resetTriggered_ && millis() - resetPressedAt_ >= 5000) {
      resetTriggered_ = true;
      Serial.println("Clearing saved Wi-Fi and server settings...");

      preferences_.begin("lonecare", false);
      preferences_.clear();
      preferences_.end();

      delay(500);
      ESP.restart();
    }
  }

  String sensorUrl() const {
    return "http://" + serverHost_ + ":" + String(serverPort_) +
           "/api/sensor-data";
  }

 private:
  static constexpr byte DNS_PORT = 53;
  static constexpr unsigned long CONNECT_TIMEOUT_MS = 20000;

  Preferences preferences_;
  DNSServer dnsServer_;
  WebServer webServer_{80};

  String ssid_;
  String password_;
  String serverHost_;
  uint16_t serverPort_ = 8000;
  String deviceType_;
  unsigned long resetPressedAt_ = 0;
  bool resetTriggered_ = false;

  void load() {
    preferences_.begin("lonecare", true);
    ssid_ = preferences_.getString("ssid", "");
    password_ = preferences_.getString("password", "");
    serverHost_ = preferences_.getString("server", "");
    serverPort_ = preferences_.getUShort("port", 8000);
    preferences_.end();

    if (serverPort_ == 0) {
      serverPort_ = 8000;
    }
  }

  bool hasSettings() const {
    return !ssid_.isEmpty() && !serverHost_.isEmpty();
  }

  bool connect() {
    if (!hasSettings()) {
      return false;
    }

    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.begin(ssid_.c_str(), password_.c_str());

    Serial.print("Wi-Fi connecting to ");
    Serial.println(ssid_);

    const unsigned long startedAt = millis();
    while (WiFi.status() != WL_CONNECTED &&
           millis() - startedAt < CONNECT_TIMEOUT_MS) {
      delay(500);
      Serial.print(".");
    }
    Serial.println();

    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("Wi-Fi connection failed.");
      WiFi.disconnect(true);
      return false;
    }

    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Server URL: ");
    Serial.println(sensorUrl());
    return true;
  }

  String apName() const {
    const uint64_t chipId = ESP.getEfuseMac();
    char suffix[7];
    snprintf(suffix, sizeof(suffix), "%06llX", chipId & 0xFFFFFF);
    return "LoneCare-" + deviceType_ + "-Open-Router-" + String(suffix);
  }

  static String escapeHtml(const String& value) {
    String escaped = value;
    escaped.replace("&", "&amp;");
    escaped.replace("<", "&lt;");
    escaped.replace(">", "&gt;");
    escaped.replace("\"", "&quot;");
    escaped.replace("'", "&#39;");
    return escaped;
  }

  String page(const String& message = "") const {
    String html;
    html.reserve(4500);
    html += F(
        "<!doctype html><html lang='ko'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>LoneCare ESP32 설정</title><style>"
        "*{box-sizing:border-box}body{margin:0;background:#eef2f7;color:#172033;"
        "font-family:Arial,sans-serif}.card{max-width:520px;margin:30px auto;"
        "padding:24px;background:#fff;border-radius:18px;box-shadow:0 12px 35px "
        "rgba(23,32,51,.12)}h1{font-size:24px}label{display:block;margin-top:16px;"
        "font-weight:700}input{width:100%;margin-top:7px;padding:12px;border:1px "
        "solid #cbd5e1;border-radius:10px;font-size:16px}button{width:100%;"
        "margin-top:22px;padding:13px;border:0;border-radius:10px;background:#1769e0;"
        "color:#fff;font-size:16px;font-weight:700}.notice{padding:12px;"
        "background:#e8f5ee;border-radius:10px}</style></head><body><main class='card'>"
        "<h1>LoneCare ESP32 설정</h1><p>Wi-Fi와 서버 IP를 입력하세요.</p>");

    if (!message.isEmpty()) {
      html += "<div class='notice'>" + escapeHtml(message) + "</div>";
    }

    html += "<form method='post' action='/save'>";
    html += "<label>Wi-Fi 이름(SSID)</label><input name='ssid' maxlength='32' "
            "required value='" + escapeHtml(ssid_) + "'>";
    html += F(
        "<label>Wi-Fi 비밀번호</label><input name='password' type='password' "
        "maxlength='64' placeholder='변경하지 않으면 기존 값 유지'>");
    html += "<label>서버 IP 또는 호스트명</label><input name='server' "
            "maxlength='100' required placeholder='192.168.0.10' value='" +
            escapeHtml(serverHost_) + "'>";
    html += "<label>서버 포트</label><input name='port' type='number' min='1' "
            "max='65535' required value='" + String(serverPort_) + "'>";
    html += F("<button type='submit'>저장하고 재시작</button></form></main></body></html>");
    return html;
  }

  void save() {
    String newSsid = webServer_.arg("ssid");
    String newPassword = webServer_.arg("password");
    String newServer = webServer_.arg("server");
    const long newPort = webServer_.arg("port").toInt();

    newSsid.trim();
    newServer.trim();
    newServer.replace("http://", "");
    newServer.replace("https://", "");

    const int slash = newServer.indexOf('/');
    if (slash >= 0) {
      newServer = newServer.substring(0, slash);
    }

    long normalizedPort = newPort;
    const int colon = newServer.lastIndexOf(':');
    if (colon > 0 && newServer.indexOf(':') == colon) {
      const long portFromServer = newServer.substring(colon + 1).toInt();
      if (portFromServer >= 1 && portFromServer <= 65535) {
        normalizedPort = portFromServer;
        newServer = newServer.substring(0, colon);
      }
    }

    if (newSsid.isEmpty() || newServer.isEmpty() ||
        normalizedPort < 1 || normalizedPort > 65535) {
      webServer_.send(400, "text/html; charset=utf-8",
                      page("입력값을 확인하세요."));
      return;
    }

    preferences_.begin("lonecare", false);
    preferences_.putString("ssid", newSsid);
    if (!newPassword.isEmpty() || password_.isEmpty()) {
      preferences_.putString("password", newPassword);
    }
    preferences_.putString("server", newServer);
    preferences_.putUShort("port", static_cast<uint16_t>(normalizedPort));
    preferences_.end();

    webServer_.send(
        200, "text/html; charset=utf-8",
        "<!doctype html><html lang='ko'><meta charset='utf-8'><body>"
        "<h2>저장 완료</h2><p>ESP32를 재시작합니다.</p></body></html>");
    delay(1500);
    ESP.restart();
  }

  void showPortal() {
    webServer_.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    webServer_.sendHeader("Pragma", "no-cache");
    webServer_.sendHeader("Expires", "-1");
    webServer_.send(200, "text/html; charset=utf-8", page());
  }

  void redirectToPortal() {
    webServer_.sendHeader("Location", "http://192.168.4.1/", true);
    webServer_.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    webServer_.send(302, "text/plain; charset=utf-8",
                    "Open http://192.168.4.1/");
  }

  void startPortal() {
    WiFi.disconnect(true);
    delay(200);
    WiFi.mode(WIFI_AP);

    const String name = apName();
    const IPAddress portalIp(192, 168, 4, 1);
    const IPAddress subnetMask(255, 255, 255, 0);
    WiFi.softAPConfig(portalIp, portalIp, subnetMask);

    if (!WiFi.softAP(name.c_str())) {
      Serial.println("Failed to start configuration AP.");
    }

    delay(300);
    dnsServer_.setErrorReplyCode(DNSReplyCode::NoError);
    dnsServer_.start(DNS_PORT, "*", portalIp);

    webServer_.on("/", HTTP_ANY, [this]() { showPortal(); });
    webServer_.on("/save", HTTP_POST, [this]() { save(); });
    // Android expects its 204 probe to be redirected before opening the
    // captive portal sign-in activity.
    webServer_.on("/generate_204", HTTP_ANY,
                  [this]() { redirectToPortal(); });
    webServer_.on("/gen_204", HTTP_ANY, [this]() { redirectToPortal(); });
    webServer_.on("/mobile/status.php", HTTP_ANY,
                  [this]() { redirectToPortal(); });

    // Apple opens the captive assistant when this probe does not contain the
    // normal "Success" response.
    webServer_.on("/hotspot-detect.html", HTTP_ANY, [this]() { showPortal(); });
    webServer_.on("/library/test/success.html", HTTP_ANY,
                  [this]() { showPortal(); });
    webServer_.on("/success.txt", HTTP_ANY, [this]() { showPortal(); });
    webServer_.on("/canonical.html", HTTP_ANY, [this]() { showPortal(); });

    // Windows expects fixed test content. Redirecting these probes marks the
    // network as captive and opens the sign-in window.
    webServer_.on("/ncsi.txt", HTTP_ANY, [this]() { redirectToPortal(); });
    webServer_.on("/connecttest.txt", HTTP_ANY,
                  [this]() { redirectToPortal(); });
    webServer_.on("/redirect", HTTP_ANY, [this]() { redirectToPortal(); });
    webServer_.on("/fwlink", HTTP_ANY, [this]() { redirectToPortal(); });
    webServer_.onNotFound([this]() { redirectToPortal(); });
    webServer_.begin();

    Serial.println("=== Captive Portal mode ===");
    Serial.print("Connect to: ");
    Serial.println(name);
    Serial.print("Open: http://");
    Serial.println(WiFi.softAPIP());

    while (true) {
      dnsServer_.processNextRequest();
      webServer_.handleClient();
      delay(2);
    }
  }
};
