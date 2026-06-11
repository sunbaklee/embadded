const labels = { normal: "정상", warning: "주의", danger: "위험" };

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value);
  return node.innerHTML;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}초`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분`;
  return `${Math.floor(seconds / 3600)}시간 ${Math.floor((seconds % 3600) / 60)}분`;
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

function renderStatus(devices) {
  const counts = { normal: 0, warning: 0, danger: 0 };
  devices.forEach((device) => counts[device.status]++);
  document.querySelector("#device-count").textContent = devices.length;
  Object.keys(counts).forEach((key) => {
    document.querySelector(`#${key}-count`).textContent = counts[key];
  });

  const grid = document.querySelector("#device-grid");
  if (!devices.length) {
    grid.innerHTML = '<p class="empty">아직 등록된 장치가 없습니다.</p>';
    return;
  }
  grid.innerHTML = devices.map((device) => `
    <article class="device-card ${device.status}">
      <div class="device-head">
        <h3>${escapeHtml(device.device_id)}</h3>
        <span class="status-badge">${labels[device.status]}</span>
      </div>
      <div class="device-meta">
        <div><span>무활동 시간</span><strong>${formatDuration(device.inactive_seconds)}</strong></div>
        <div><span>최근 활동</span><strong>${formatDate(device.last_activity_at)}</strong></div>
        <div><span>최근 수신</span><strong>${formatDate(device.last_seen_at)}</strong></div>
        <div><span>압력 값</span><strong>${device.last_pressure_value ?? "-"}</strong></div>
      </div>
    </article>
  `).join("");
}

function renderAlerts(alerts) {
  const list = document.querySelector("#alert-list");
  if (!alerts.length) {
    list.innerHTML = '<p class="empty">알림이 없습니다.</p>';
    return;
  }
  list.innerHTML = alerts.map((alert) => `
    <div class="list-row ${alert.is_resolved ? "resolved" : ""}">
      <div>
        <strong>${escapeHtml(alert.device_id)} · ${alert.is_resolved ? "해제됨" : "위험"}</strong>
        <p>${escapeHtml(alert.message)} · ${formatDate(alert.created_at)}</p>
      </div>
      ${alert.is_resolved ? "" : `<button onclick="resolveAlert(${alert.id})">해제</button>`}
    </div>
  `).join("");
}

function renderLogs(logs) {
  const list = document.querySelector("#log-list");
  if (!logs.length) {
    list.innerHTML = '<p class="empty">센서 기록이 없습니다.</p>';
    return;
  }
  list.innerHTML = logs.map((log) => `
    <div class="list-row">
      <div>
        <strong>${escapeHtml(log.device_id)}</strong>
        <p>PIR ${log.pir_motion ? "감지" : "없음"} · 압력 ${log.pressure_value} · 변화량 ${log.pressure_delta ?? "-"}</p>
      </div>
      <div class="${log.activity_detected ? "activity" : "no-activity"}">
        ${log.activity_detected ? "활동"} · ${formatDate(log.received_at)}
      </div>
    </div>
  `).join("");
}

async function resolveAlert(id) {
  await fetch(`/api/alerts/${id}/resolve`, { method: "POST" });
  await refresh();
}

async function refresh() {
  const dot = document.querySelector("#connection-dot");
  try {
    const [devices, alerts, logs] = await Promise.all([
      getJson("/api/status"),
      getJson("/api/alerts?limit=10"),
      getJson("/api/logs?limit=10"),
    ]);
    renderStatus(devices);
    renderAlerts(alerts);
    renderLogs(logs);
    dot.className = "online";
    document.querySelector("#connection-text").textContent = "서버 연결됨";
    document.querySelector("#updated-at").textContent = `최근 갱신 ${new Date().toLocaleTimeString("ko-KR")}`;
  } catch (error) {
    console.error(error);
    dot.className = "offline";
    document.querySelector("#connection-text").textContent = "서버 연결 실패";
  }
}

refresh();
setInterval(refresh, 5000);
