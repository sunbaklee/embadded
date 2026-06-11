const labels = { normal: "안전", warning: "주의", danger: "위험" };
const descriptions = {
  normal: "최근 움직임이 확인되었습니다.",
  warning: "활동이 한동안 감지되지 않았습니다.",
  danger: "안전 확인이 즉시 필요합니다.",
};
let activityHours = 6;
let monitoringConfig = {
  warning_seconds: 21600,
  danger_seconds: 43200,
  pressure_delta_threshold: 100,
  sensor_offline_seconds: 30,
};

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value);
  return node.innerHTML;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(parseDate(value));
}

function parseDate(value) {
  const normalized = (
    typeof value === "string" && !/(Z|[+-]\d{2}:\d{2})$/i.test(value)
  ) ? `${value}Z` : value;
  return new Date(normalized);
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  if (value < 60) return `${value}초`;
  if (value < 3600) return `${Math.floor(value / 60)}분 ${value % 60}초`;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${hours}시간 ${minutes}분`;
}

function formatRelativeDate(value) {
  if (!value) return "수신 기록 없음";
  const seconds = Math.max(0, Math.floor((Date.now() - parseDate(value).getTime()) / 1000));
  if (seconds < 5) return "방금 전";
  if (seconds < 60) return `${seconds}초 전`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  return `${Math.floor(seconds / 86400)}일 전`;
}

function wifiLabel(rssi) {
  if (rssi === null || rssi === undefined) return "정보 없음";
  if (rssi >= -60) return `매우 좋음 (${rssi} dBm)`;
  if (rssi >= -70) return `정상 (${rssi} dBm)`;
  if (rssi >= -80) return `약함 (${rssi} dBm)`;
  return `불안정 (${rssi} dBm)`;
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `요청에 실패했습니다 (${response.status})`);
  }
  return response.json();
}

function renderStatus(devices) {
  const counts = { normal: 0, warning: 0, danger: 0 };
  devices.forEach((device) => {
    if (counts[device.status] !== undefined) counts[device.status] += 1;
  });

  document.querySelector("#device-count").textContent = devices.length;
  Object.entries(counts).forEach(([key, count]) => {
    document.querySelector(`#${key}-count`).textContent = count;
  });

  const grid = document.querySelector("#device-grid");
  if (!devices.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <strong>등록된 장치가 없습니다</strong>
        <p>센서 데이터를 보내거나 위 테스트 기능으로 화면을 확인해 보세요.</p>
      </div>`;
    return;
  }

  const priority = { danger: 0, warning: 1, normal: 2 };
  const visibleDevices = [...devices]
    .sort((a, b) => (
      priority[a.status] - priority[b.status]
      || b.inactive_seconds - a.inactive_seconds
    ))
    .slice(0, 6);

  grid.innerHTML = visibleDevices.map((device) => {
    const progress = Math.min(
      100,
      Math.round((device.inactive_seconds / device.threshold_seconds) * 100),
    );
    const lastSeenSeconds = Math.max(
      0,
      Math.floor((Date.now() - parseDate(device.last_seen_at).getTime()) / 1000),
    );
    const isOnline = lastSeenSeconds <= monitoringConfig.sensor_offline_seconds;
    const needsConfirmation = device.last_pressure_detected && !device.last_pir_motion;
    return `
      <article class="device-card ${device.status}">
        <div class="device-head">
          <div>
            <span class="device-kicker">${device.device_id.startsWith("demo-") ? "테스트 장치" : "연결 장치"}</span>
            <h3>${escapeHtml(device.device_id)}</h3>
          </div>
          <span class="status-badge"><i></i>${labels[device.status] || device.status}</span>
        </div>
        <p class="status-description">${descriptions[device.status] || ""}</p>
        <div class="device-health">
          <span class="connection-state ${isOnline ? "online" : "offline"}">
            <i></i>${isOnline ? "온라인" : "오프라인"}
          </span>
          ${needsConfirmation ? '<span class="confirmation-state">압력 유지 · 움직임 없음</span>' : ""}
        </div>
        <div class="inactivity">
          <div>
            <span>활동 없음</span>
            <strong>${formatDuration(device.inactive_seconds)}</strong>
          </div>
          <div class="progress" aria-label="위험 기준까지 ${progress}% 경과">
            <span style="width: ${progress}%"></span>
          </div>
          <small>위험 기준 ${formatDuration(device.threshold_seconds)}</small>
        </div>
        <dl class="device-meta">
          <div><dt>마지막 수신</dt><dd title="${formatDate(device.last_seen_at)}">${formatRelativeDate(device.last_seen_at)}</dd></div>
          <div><dt>배터리</dt><dd>${device.battery_level != null ? `${device.battery_level}%` : "정보 없음"}</dd></div>
          <div><dt>Wi-Fi 신호</dt><dd>${wifiLabel(device.wifi_rssi)}</dd></div>
          <div><dt>설치 위치</dt><dd>${escapeHtml(device.location || "미설정")}</dd></div>
          <div><dt>압력 센서</dt><dd>${device.last_pressure_detected ? `감지 (${device.last_pressure_value ?? "-"})` : "미감지"}</dd></div>
        </dl>
      </article>`;
  }).join("");
}

function renderReceiveLog(logs) {
  const container = document.querySelector("#receive-log");
  if (!logs.length) {
    container.innerHTML = '<div class="empty-state compact"><strong>수신 대기 중</strong></div>';
    return;
  }

  const latest = logs[0];
  const isSimulation = latest.device_id.startsWith("demo-");
  const source = isSimulation ? "시뮬레이터" : "ESP32";
  const endpoint = isSimulation
    ? "POST /api/simulation/scenario"
    : "POST /api/sensor-data";
  const responseStatus = isSimulation ? "200 OK" : "201 Created";
  container.innerHTML = `
    <div class="receive-summary">
      <span class="terminal-icon" aria-hidden="true">&gt;_</span>
      <div>
        <strong>${formatRelativeDate(latest.received_at)} ${source}에서 데이터 수신됨</strong>
        <p>${escapeHtml(latest.device_id)} · ${latest.activity_detected ? "움직임 감지" : "상태 유지"}</p>
      </div>
    </div>
    <div class="http-log">
      <code>${endpoint}</code>
      <strong>${responseStatus}</strong>
    </div>
    <div class="payload-log">
      PIR=${latest.pir_motion ? "1" : "0"} · PRESSURE=${latest.pressure_value} · ACTIVITY=${latest.activity_detected ? "1" : "0"}
    </div>`;
}

function renderCriteria() {
  document.querySelector("#criteria-list").innerHTML = `
    <div class="criterion warning">
      <span>주의</span>
      <strong>${formatDuration(monitoringConfig.warning_seconds)} 동안 움직임 미감지</strong>
    </div>
    <div class="criterion danger">
      <span>위험</span>
      <strong>${formatDuration(monitoringConfig.danger_seconds)} 동안 움직임 미감지</strong>
    </div>
    <div class="criterion check">
      <span>확인</span>
      <strong>압력 감지 유지 + 움직임 없음</strong>
    </div>
    <p class="criteria-note">압력 변화량 ${monitoringConfig.pressure_delta_threshold} 이상은 활동으로 판정합니다.</p>`;
}

function renderActivityChart(buckets) {
  const chart = document.querySelector("#activity-chart");
  const hasData = buckets.some((bucket) => bucket.total_count > 0);
  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.total_count));

  chart.innerHTML = `
    <div class="chart-bars ${hasData ? "" : "no-data"}">
      ${buckets.map((bucket) => {
        const activityRatio = bucket.total_count
          ? bucket.activity_count / bucket.total_count
          : 0;
        const volumeRatio = bucket.total_count / maxCount;
        const height = bucket.total_count
          ? Math.max(12, Math.round((0.35 + volumeRatio * 0.65) * 100))
          : 6;
        const detected = bucket.activity_count > 0;
        return `
          <div class="chart-column" title="${formatDate(bucket.started_at)} · 수신 ${bucket.total_count}건 · 활동 ${bucket.activity_count}건">
            <span class="chart-value">${bucket.activity_count || ""}</span>
            <i class="${detected ? "detected" : ""}" style="height:${height}%">
              ${detected ? `<b style="height:${Math.max(18, Math.round(activityRatio * 100))}%"></b>` : ""}
            </i>
          </div>`;
      }).join("")}
    </div>
    <div class="chart-axis">
      <span>${activityHours}시간 전</span>
      <span>현재</span>
    </div>
    ${hasData ? "" : '<p class="chart-overlay">선택한 시간 범위에 수신된 데이터가 없습니다.</p>'}`;
}

function renderAlerts(alerts) {
  const list = document.querySelector("#alert-list");
  if (!alerts.length) {
    list.innerHTML = '<div class="empty-state compact"><strong>발생한 알림이 없습니다</strong></div>';
    return;
  }

  list.innerHTML = alerts.map((alert) => `
    <article class="list-row alert-row ${alert.is_resolved ? "resolved" : ""}">
      <span class="list-icon" aria-hidden="true">${alert.is_resolved ? "✓" : "!"}</span>
      <div class="list-content">
        <div class="list-heading">
          <strong>${escapeHtml(alert.device_id)}</strong>
          <span>${alert.is_resolved ? "해결됨" : "확인 필요"}</span>
        </div>
        <p>${escapeHtml(alert.message)}</p>
        <time>${formatDate(alert.created_at)}</time>
      </div>
      ${alert.is_resolved ? "" : `<button class="button small resolve-alert" type="button" data-alert-id="${alert.id}">안전 확인 완료</button>`}
    </article>
  `).join("");
}

function renderLogs(logs) {
  const list = document.querySelector("#log-list");
  if (!logs.length) {
    list.innerHTML = '<div class="empty-state compact"><strong>센서 기록이 없습니다</strong></div>';
    return;
  }

  list.innerHTML = logs.map((log) => `
    <article class="list-row log-row">
      <span class="activity-dot ${log.activity_detected ? "active" : ""}" aria-hidden="true"></span>
      <div class="list-content">
        <div class="list-heading">
          <strong>${escapeHtml(log.device_id)}</strong>
          <span>${log.activity_detected ? "활동 감지" : "변화 없음"}</span>
        </div>
        <p>PIR ${log.pir_motion ? "감지" : "없음"} · 압력 ${log.pressure_value} · 변화량 ${log.pressure_delta ?? "-"}</p>
        <time>${formatDate(log.received_at)}</time>
      </div>
    </article>
  `).join("");
}

function showToast(message, type = "success") {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.className = `toast visible ${type}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.className = "toast";
  }, 3000);
}

async function resolveAlert(id) {
  await getJson(`/api/alerts/${id}/resolve`, { method: "POST" });
  showToast("안전 확인을 완료하고 장치 상태를 안전으로 변경했습니다.");
  await refresh();
}

function setSimulationBusy(busy) {
  document.querySelectorAll("[data-scenario], #clear-simulation").forEach((button) => {
    button.disabled = busy;
  });
}

async function runSimulation(scenario) {
  const input = document.querySelector("#simulation-device");
  const deviceId = input.value.trim();
  if (!/^demo-[A-Za-z0-9_-]+$/.test(deviceId)) {
    showToast("장치 이름은 demo-로 시작하고 영문, 숫자, -, _만 사용할 수 있습니다.", "error");
    input.focus();
    return;
  }

  setSimulationBusy(true);
  try {
    await getJson("/api/simulation/scenario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId, scenario }),
    });
    showToast(`${deviceId} 장치를 ${labels[scenario]} 상태로 만들었습니다.`);
    await refresh();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setSimulationBusy(false);
  }
}

async function clearSimulation() {
  const input = document.querySelector("#simulation-device");
  const deviceId = input.value.trim();
  if (!/^demo-[A-Za-z0-9_-]+$/.test(deviceId)) {
    showToast("초기화할 테스트 장치 이름을 확인해 주세요.", "error");
    input.focus();
    return;
  }

  setSimulationBusy(true);
  try {
    const result = await getJson(
      `/api/simulation/devices/${encodeURIComponent(deviceId)}`,
      { method: "DELETE" },
    );
    showToast(
      result.deleted_count
        ? `${deviceId} 장치를 초기화했습니다.`
        : `${deviceId} 장치가 없습니다.`,
    );
    await refresh();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setSimulationBusy(false);
  }
}

async function configureSimulation() {
  try {
    const config = await getJson("/api/simulation");
    if (!config.enabled) return;
    document.querySelector("#simulation-panel").hidden = false;
    document.querySelector("#simulation-help").textContent =
      `현재 위험 판단 기준: ${formatDuration(config.threshold_seconds)}`;
  } catch (error) {
    console.info("Simulation mode unavailable", error);
  }
}

async function configureMonitoring() {
  monitoringConfig = await getJson("/api/config");
  renderCriteria();
}

async function refresh() {
  const dot = document.querySelector("#connection-dot");
  try {
    const [devices, alerts, logs, activity] = await Promise.all([
      getJson("/api/status"),
      getJson("/api/alerts?limit=10"),
      getJson("/api/logs?limit=10"),
      getJson(`/api/activity?hours=${activityHours}&buckets=12`),
    ]);
    renderStatus(devices);
    renderAlerts(alerts);
    renderLogs(logs);
    renderReceiveLog(logs);
    renderActivityChart(activity);
    dot.className = "online";
    document.querySelector("#connection-text").textContent = "서버 연결됨";
    document.querySelector("#updated-at").textContent =
      `마지막 갱신 ${new Date().toLocaleTimeString("ko-KR")}`;
  } catch (error) {
    console.error(error);
    dot.className = "offline";
    document.querySelector("#connection-text").textContent = "서버 연결 끊김";
    document.querySelector("#updated-at").textContent = "잠시 후 다시 확인합니다";
  }
}

document.addEventListener("click", (event) => {
  const scenarioButton = event.target.closest("[data-scenario]");
  if (scenarioButton) runSimulation(scenarioButton.dataset.scenario);

  const resolveButton = event.target.closest(".resolve-alert");
  if (resolveButton) resolveAlert(resolveButton.dataset.alertId);

  const rangeButton = event.target.closest("[data-hours]");
  if (rangeButton) {
    activityHours = Number(rangeButton.dataset.hours);
    document.querySelectorAll("[data-hours]").forEach((button) => {
      button.classList.toggle("active", button === rangeButton);
    });
    refresh();
  }
});
document.querySelector("#clear-simulation").addEventListener("click", clearSimulation);

async function initialize() {
  await Promise.all([configureSimulation(), configureMonitoring()]);
  await refresh();
}

initialize();
setInterval(refresh, 5000);
