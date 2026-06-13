const PAGE_SIZE = 12;
const statusLabels = { normal: "안전", warning: "주의", danger: "위험" };
const statusPriority = { danger: 0, warning: 1, normal: 2 };

let allDevices = [];
let offlineSeconds = 30;
let currentPage = 1;
let activityRequestId = 0;

const filters = {
  search: document.querySelector("#search-filter"),
  status: document.querySelector("#status-filter"),
  connection: document.querySelector("#connection-filter"),
  location: document.querySelector("#location-filter"),
  condition: document.querySelector("#condition-filter"),
  sort: document.querySelector("#sort-filter"),
};

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value);
  return node.innerHTML;
}

function escapeAttribute(value) {
  return escapeHtml(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseDate(value) {
  const normalized = (
    typeof value === "string" && !/(Z|[+-]\d{2}:\d{2})$/i.test(value)
  ) ? `${value}Z` : value;
  return new Date(normalized);
}

function relativeTime(value) {
  const seconds = Math.max(0, Math.floor((Date.now() - parseDate(value).getTime()) / 1000));
  if (seconds < 5) return "방금 전";
  if (seconds < 60) return `${seconds}초 전`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  return `${Math.floor(seconds / 86400)}일 전`;
}

function duration(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  if (value < 60) return `${value}초`;
  if (value < 3600) return `${Math.floor(value / 60)}분`;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${hours}시간 ${minutes}분`;
}

function wifiLabel(rssi) {
  if (rssi == null) return "정보 없음";
  if (rssi >= -60) return "매우 좋음";
  if (rssi >= -70) return "정상";
  if (rssi >= -80) return "약함";
  return "불안정";
}

function chartTime(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
  }).format(parseDate(value));
}

function isOnline(device) {
  return (Date.now() - parseDate(device.last_seen_at).getTime()) / 1000 <= offlineSeconds;
}

function sensorCondition(device) {
  if (device.last_pressure_detected && !device.last_pir_motion) {
    return { className: "warning", label: "압력 유지 · 움직임 없음" };
  }
  if (device.last_pir_motion) {
    return { className: "normal", label: "움직임 감지" };
  }
  return { className: "muted", label: "변화 없음" };
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `${url}: ${response.status}`);
  }
  return response.json();
}

function populateLocations(devices) {
  const selected = filters.location.dataset.pending || filters.location.value;
  const locations = [...new Set(
    devices.map((device) => device.location).filter(Boolean),
  )].sort((a, b) => a.localeCompare(b, "ko"));

  filters.location.innerHTML = [
    '<option value="all">전체 위치</option>',
    '<option value="unset">미설정</option>',
    ...locations.map((location) => (
      `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`
    )),
  ].join("");
  filters.location.value = [...filters.location.options].some(
    (option) => option.value === selected,
  ) ? selected : "all";
  delete filters.location.dataset.pending;
}

function updateSummary(devices) {
  const counts = { normal: 0, warning: 0, danger: 0, offline: 0 };
  devices.forEach((device) => {
    counts[device.status] += 1;
    if (!isOnline(device)) counts.offline += 1;
  });
  document.querySelector("#total-count").textContent = devices.length;
  document.querySelector("#safe-count").textContent = counts.normal;
  document.querySelector("#caution-count").textContent = counts.warning;
  document.querySelector("#risk-count").textContent = counts.danger;
  document.querySelector("#offline-count").textContent = counts.offline;
}

function updateQuickSelection() {
  document.querySelectorAll(".management-stat").forEach((button) => {
    const matchesStatus = (
      button.dataset.quickStatus
      && button.dataset.quickStatus === filters.status.value
      && filters.connection.value === "all"
    );
    const matchesConnection = (
      button.dataset.quickConnection
      && button.dataset.quickConnection === filters.connection.value
      && filters.status.value === "all"
    );
    button.classList.toggle("active", Boolean(matchesStatus || matchesConnection));
  });
}

function matchesCondition(device, condition) {
  if (condition === "pressure") {
    return device.last_pressure_detected && !device.last_pir_motion;
  }
  if (condition === "low-battery") {
    return device.battery_level != null && device.battery_level <= 20;
  }
  if (condition === "no-battery") return device.battery_level == null;
  if (condition === "needs-attention") {
    return device.status !== "normal" || !isOnline(device);
  }
  return true;
}

function filteredDevices() {
  const query = filters.search.value.trim().toLocaleLowerCase("ko");
  const location = filters.location.value;

  const result = allDevices.filter((device) => {
    const searchable = `${device.device_id} ${device.location || ""}`.toLocaleLowerCase("ko");
    if (query && !searchable.includes(query)) return false;
    if (filters.status.value !== "all" && device.status !== filters.status.value) return false;
    if (filters.connection.value === "online" && !isOnline(device)) return false;
    if (filters.connection.value === "offline" && isOnline(device)) return false;
    if (location === "unset" && device.location) return false;
    if (location !== "all" && location !== "unset" && device.location !== location) return false;
    return matchesCondition(device, filters.condition.value);
  });

  result.sort((a, b) => {
    if (filters.sort.value === "recent") {
      return parseDate(b.last_seen_at) - parseDate(a.last_seen_at);
    }
    if (filters.sort.value === "inactive") {
      return b.inactive_seconds - a.inactive_seconds;
    }
    if (filters.sort.value === "name") {
      return a.device_id.localeCompare(b.device_id, "ko");
    }
    return (
      statusPriority[a.status] - statusPriority[b.status]
      || Number(isOnline(a)) - Number(isOnline(b))
      || b.inactive_seconds - a.inactive_seconds
    );
  });
  return result;
}

function rowMarkup(device) {
  const online = isOnline(device);
  const condition = sensorCondition(device);
  return `
    <tr
      class="activity-device-trigger"
      data-activity-device="${encodeURIComponent(device.device_id)}"
      tabindex="0"
      aria-label="${escapeAttribute(device.device_id)} 장치의 24시간 활동 그래프 보기"
    >
      <td>
        <strong class="device-name">${escapeHtml(device.device_id)}</strong>
        <span class="device-location">${escapeHtml(device.location || "위치 미설정")}</span>
      </td>
      <td><span class="management-badge ${device.status}">${statusLabels[device.status]}</span></td>
      <td><span class="management-badge ${online ? "online" : "offline"}">${online ? "온라인" : "오프라인"}</span></td>
      <td><strong>${relativeTime(device.last_seen_at)}</strong></td>
      <td>${duration(device.inactive_seconds)}</td>
      <td>${device.battery_level != null ? `${device.battery_level}%` : "정보 없음"}</td>
      <td title="${device.wifi_rssi != null ? `${device.wifi_rssi} dBm` : ""}">${wifiLabel(device.wifi_rssi)}</td>
      <td><span class="sensor-condition ${condition.className}">${condition.label}</span></td>
      <td>${device.status === "danger" ? `<button class="confirm-safety-button" type="button" data-confirm-device="${escapeHtml(device.device_id)}">안전 확인 완료</button>` : ""}</td>
    </tr>`;
}

function cardMarkup(device) {
  const online = isOnline(device);
  const condition = sensorCondition(device);
  return `
    <article
      class="management-device-card ${device.status} activity-device-trigger"
      data-activity-device="${encodeURIComponent(device.device_id)}"
      tabindex="0"
      aria-label="${escapeAttribute(device.device_id)} 장치의 24시간 활동 그래프 보기"
    >
      <div class="management-card-head">
        <div>
          <span>${escapeHtml(device.location || "위치 미설정")}</span>
          <h3>${escapeHtml(device.device_id)}</h3>
        </div>
        <span class="management-badge ${device.status}">${statusLabels[device.status]}</span>
      </div>
      <div class="management-card-badges">
        <span class="management-badge ${online ? "online" : "offline"}">${online ? "온라인" : "오프라인"}</span>
        <span class="sensor-condition ${condition.className}">${condition.label}</span>
      </div>
      <dl>
        <div><dt>마지막 수신</dt><dd>${relativeTime(device.last_seen_at)}</dd></div>
        <div><dt>무활동</dt><dd>${duration(device.inactive_seconds)}</dd></div>
        <div><dt>배터리</dt><dd>${device.battery_level != null ? `${device.battery_level}%` : "정보 없음"}</dd></div>
        <div><dt>Wi-Fi</dt><dd>${wifiLabel(device.wifi_rssi)}</dd></div>
      </dl>
      ${device.status === "danger" ? `<button class="confirm-safety-button mobile" type="button" data-confirm-device="${escapeHtml(device.device_id)}">안전 확인 완료</button>` : ""}
    </article>`;
}

async function confirmSafety(deviceId, button) {
  button.disabled = true;
  button.textContent = "처리 중...";
  try {
    const response = await fetch(
      `/api/alerts/device/${encodeURIComponent(deviceId)}/resolve`,
      { method: "POST" },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `처리에 실패했습니다 (${response.status})`);
    }
    await refresh();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
    button.textContent = "안전 확인 완료";
  }
}

function renderDeviceActivityChart(buckets) {
  const container = document.querySelector("#device-activity-chart");
  const totalReceived = buckets.reduce((sum, bucket) => sum + bucket.total_count, 0);
  const totalActivity = buckets.reduce((sum, bucket) => sum + bucket.activity_count, 0);
  const activeHours = buckets.filter((bucket) => bucket.activity_count > 0).length;
  const maxActivity = Math.max(0, ...buckets.map((bucket) => bucket.activity_count));
  const maxY = Math.max(4, Math.ceil(maxActivity / 4) * 4);
  const width = 900;
  const height = 270;
  const left = 48;
  const right = 18;
  const top = 18;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const baseline = top + plotHeight;
  const points = buckets.map((bucket, index) => {
    const x = left + (index / Math.max(1, buckets.length - 1)) * plotWidth;
    const y = baseline - (bucket.activity_count / maxY) * plotHeight;
    return { bucket, x, y };
  });
  const linePath = points.map((point, index) => (
    `${index ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  )).join(" ");
  const areaPath = points.length
    ? `${linePath} L ${points.at(-1).x.toFixed(2)} ${baseline}`
      + ` L ${points[0].x.toFixed(2)} ${baseline} Z`
    : "";
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const value = maxY - (maxY / 4) * index;
    const y = top + (plotHeight / 4) * index;
    return `
      <line class="activity-grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line>
      <text class="activity-y-label" x="${left - 10}" y="${y + 4}">${value}</text>`;
  }).join("");
  const labelIndexes = [...new Set([0, 6, 12, 18, buckets.length - 1])]
    .filter((index) => index >= 0 && index < buckets.length);
  const xLabels = labelIndexes.map((index) => `
    <text
      class="activity-x-label"
      x="${points[index].x}"
      y="${height - 10}"
      text-anchor="${index === 0 ? "start" : index === buckets.length - 1 ? "end" : "middle"}"
    >${escapeHtml(chartTime(buckets[index].started_at))}</text>
  `).join("");

  container.innerHTML = `
    <div class="activity-dialog-metrics">
      <div><span>활동 감지</span><strong>${totalActivity}건</strong></div>
      <div><span>활동 시간대</span><strong>${activeHours}시간</strong></div>
      <div><span>센서 수신</span><strong>${totalReceived}건</strong></div>
    </div>
    <div class="activity-line-chart-wrap">
      <svg class="activity-line-chart" viewBox="0 0 ${width} ${height}" role="img">
        <defs>
          <linearGradient id="device-activity-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#45ae83" stop-opacity="0.32"></stop>
            <stop offset="100%" stop-color="#45ae83" stop-opacity="0.03"></stop>
          </linearGradient>
        </defs>
        ${yTicks}
        ${totalReceived ? `
          <path class="activity-chart-area" d="${areaPath}"></path>
          <path class="activity-chart-line" d="${linePath}"></path>
          ${points.map(({ bucket, x, y }) => `
            <circle class="activity-chart-point" cx="${x}" cy="${y}" r="4">
              <title>${escapeHtml(chartTime(bucket.started_at))} · 활동 ${bucket.activity_count}건 · 수신 ${bucket.total_count}건</title>
            </circle>
          `).join("")}
        ` : ""}
        ${xLabels}
      </svg>
      ${totalReceived ? "" : '<p class="activity-chart-overlay">최근 24시간 동안 수신된 데이터가 없습니다.</p>'}
    </div>`;
}

async function openActivityDialog(deviceId) {
  const dialog = document.querySelector("#device-activity-dialog");
  const device = allDevices.find((item) => item.device_id === deviceId);
  const requestId = ++activityRequestId;
  const location = device?.location || "위치 미설정";
  const status = statusLabels[device?.status] || "상태 정보 없음";

  document.querySelector("#activity-dialog-device").textContent =
    `${deviceId} · ${location} · ${status}`;
  document.querySelector("#device-activity-chart").innerHTML =
    '<div class="activity-chart-message">활동 데이터를 불러오는 중입니다.</div>';
  if (!dialog.open) dialog.showModal();

  try {
    const buckets = await getJson(
      `/api/activity?hours=24&buckets=24&device_id=${encodeURIComponent(deviceId)}`,
    );
    if (requestId === activityRequestId && dialog.open) {
      renderDeviceActivityChart(buckets);
    }
  } catch (error) {
    if (requestId !== activityRequestId) return;
    document.querySelector("#device-activity-chart").innerHTML =
      `<div class="activity-chart-message error">${escapeHtml(error.message)}</div>`;
  }
}

function closeActivityDialog() {
  activityRequestId += 1;
  document.querySelector("#device-activity-dialog").close();
}

function renderPagination(total) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  currentPage = Math.min(currentPage, pages);
  const nav = document.querySelector("#pagination");
  if (pages <= 1) {
    nav.innerHTML = "";
    return;
  }

  const start = Math.max(1, currentPage - 2);
  const end = Math.min(pages, start + 4);
  nav.innerHTML = `
    <button type="button" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>이전</button>
    ${Array.from({ length: end - start + 1 }, (_, index) => start + index).map((page) => (
      `<button type="button" data-page="${page}" class="${page === currentPage ? "active" : ""}">${page}</button>`
    )).join("")}
    <button type="button" data-page="${currentPage + 1}" ${currentPage === pages ? "disabled" : ""}>다음</button>`;
}

function syncUrl() {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, element]) => {
    const defaultValue = key === "sort" ? "priority" : "all";
    if (element.value && element.value !== defaultValue) params.set(key, element.value);
  });
  if (currentPage > 1) params.set("page", currentPage);
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
}

function render() {
  const devices = filteredDevices();
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = devices.slice(start, start + PAGE_SIZE);

  document.querySelector("#result-count").textContent = devices.length;
  document.querySelector("#device-table-body").innerHTML = visible.map(rowMarkup).join("");
  document.querySelector("#device-card-list").innerHTML = visible.map(cardMarkup).join("");
  document.querySelector("#no-results").hidden = devices.length > 0;
  renderPagination(devices.length);
  updateQuickSelection();
  syncUrl();
}

function restoreFilters() {
  const params = new URLSearchParams(location.search);
  Object.entries(filters).forEach(([key, element]) => {
    const value = params.get(key);
    if (!value) return;
    if (key === "location") {
      element.dataset.pending = value;
    } else {
      element.value = value;
    }
  });
  currentPage = Math.max(1, Number(params.get("page")) || 1);
}

function resetFilters() {
  filters.search.value = "";
  filters.status.value = "all";
  filters.connection.value = "all";
  filters.location.value = "all";
  filters.condition.value = "all";
  filters.sort.value = "priority";
  currentPage = 1;
  document.querySelectorAll(".management-stat").forEach((button) => {
    button.classList.toggle("active", button.dataset.quickStatus === "all");
  });
  render();
}

async function refresh() {
  const dot = document.querySelector("#connection-dot");
  try {
    const [devices, config] = await Promise.all([
      getJson("/api/status"),
      getJson("/api/config"),
    ]);
    allDevices = devices;
    offlineSeconds = config.sensor_offline_seconds;
    populateLocations(devices);
    updateSummary(devices);
    render();
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

Object.values(filters).forEach((element) => {
  element.addEventListener(element.type === "search" ? "input" : "change", () => {
    currentPage = 1;
    render();
  });
});

document.querySelector("#reset-filters").addEventListener("click", resetFilters);
document.querySelector(".management-summary").addEventListener("click", (event) => {
  const button = event.target.closest(".management-stat");
  if (!button) return;
  document.querySelectorAll(".management-stat").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  if (button.dataset.quickStatus) {
    filters.status.value = button.dataset.quickStatus;
    filters.connection.value = "all";
  } else {
    filters.status.value = "all";
    filters.connection.value = button.dataset.quickConnection;
  }
  currentPage = 1;
  render();
});

document.querySelector("#pagination").addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button || button.disabled) return;
  currentPage = Number(button.dataset.page);
  render();
  document.querySelector(".device-results").scrollIntoView({ behavior: "smooth" });
});

document.querySelector(".device-table-wrap").addEventListener("click", (event) => {
  const button = event.target.closest("[data-confirm-device]");
  if (button) {
    confirmSafety(button.dataset.confirmDevice, button);
    return;
  }

  const trigger = event.target.closest("[data-activity-device]");
  if (trigger) {
    openActivityDialog(decodeURIComponent(trigger.dataset.activityDevice));
  }
});

document.querySelector(".device-table-wrap").addEventListener("keydown", (event) => {
  if (event.target.closest("button, input, select, a")) return;
  const trigger = event.target.closest("[data-activity-device]");
  if (!trigger || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  openActivityDialog(decodeURIComponent(trigger.dataset.activityDevice));
});

document.querySelector("[data-close-activity]").addEventListener("click", closeActivityDialog);
document.querySelector("#device-activity-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeActivityDialog();
});

restoreFilters();
refresh();
setInterval(refresh, 5000);
