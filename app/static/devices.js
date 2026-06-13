const PAGE_SIZE = 12;
const statusLabels = { normal: "안전", warning: "주의", danger: "위험" };
const statusPriority = { danger: 0, warning: 1, normal: 2 };

let allDevices = [];
let allAlerts = [];
let offlineSeconds = 30;
let currentPage = 1;
let activityRequestId = 0;
let activeActivityDeviceId = null;
let resolutionRequestId = 0;
let pendingResolutionDeviceId = null;
let pendingContactDeviceId = null;
let pendingWorkflowAlertId = null;
const recentResolutions = new Map();

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

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parseDate(value));
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
  if (device.last_pir_motion) {
    return { className: "normal", label: "움직임 감지" };
  }
  return { className: "muted", label: "움직임 없음" };
}

// avoid 모듈 신호(last_pressure_detected)를 침대 사용 여부로 표시하는 부가 배지
function bedUsage(device) {
  return device.last_pressure_detected
    ? { className: "normal", label: "침대 사용 중" }
    : { className: "muted", label: "침대 비어 있음" };
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `${url}: ${response.status}`);
  }
  return response.json();
}

function safetyReasonMarkup(context) {
  if (!context.requires_confirmation) {
    return `
      <article class="safety-clear-card">
        <span class="safety-reason-icon">✓</span>
        <div>
          <strong>현재 미확인 위험 없음</strong>
          <p>최근 활동 또는 안전 확인이 반영되어 추가 확인이 필요하지 않습니다.</p>
        </div>
      </article>`;
  }

  return context.reasons.map((reason) => `
    <article class="safety-reason-card ${reason.level}">
      <span class="safety-reason-icon">${reason.level === "danger" ? "!" : "i"}</span>
      <div>
        <strong>${escapeHtml(reason.title)}</strong>
        <p>${escapeHtml(reason.detail)}</p>
      </div>
    </article>
  `).join("");
}

function renderSafetyContext(context) {
  const container = document.querySelector("#device-safety-context");
  container.innerHTML = `
    <div class="safety-context-heading">
      <div>
        <p class="eyebrow">SAFETY CONTEXT</p>
        <h3>${context.requires_confirmation ? "안전이 확인되지 않은 이유" : "안전 확인 상태"}</h3>
      </div>
      <span class="safety-context-status ${context.requires_confirmation ? "pending" : "clear"}">
        ${context.requires_confirmation ? "확인 필요" : "확인 완료"}
      </span>
    </div>
    <div class="safety-reason-list">${safetyReasonMarkup(context)}</div>
    <div class="safety-context-meta">
      <span>마지막 활동 ${formatDate(context.last_activity_at)}</span>
      <span>마지막 수신 ${formatDate(context.last_seen_at)}</span>
      ${context.alert_created_at ? `<span>알림 발생 ${formatDate(context.alert_created_at)}</span>` : ""}
    </div>`;
}

function renderRecentResolutions() {
  const container = document.querySelector("#recent-resolution-list");
  const resolutions = [...recentResolutions.values()].reverse();
  container.hidden = resolutions.length === 0;
  if (!resolutions.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="recent-resolution-heading">
      <div>
        <p class="eyebrow">JUST RESOLVED</p>
        <h3>방금 안전 확인한 장치</h3>
      </div>
      <span>페이지 새로고침 시 이 안내는 사라집니다.</span>
    </div>
    <div class="recent-resolution-items">
      ${resolutions.map((resolution) => `
        <article class="recent-resolution-card">
          <span class="recent-resolution-check">✓</span>
          <div class="recent-resolution-content">
            <div>
              <strong>${escapeHtml(resolution.device_id)}</strong>
              <span>해결됨 · ${formatDate(resolution.confirmed_at)}</span>
            </div>
            <dl>
              <div>
                <dt>해결 방식</dt>
                <dd>${escapeHtml(resolution.resolution_method_label)}</dd>
              </div>
              ${resolution.resolution_detail ? `
              <div>
                <dt>상세 내용</dt>
                <dd>${escapeHtml(resolution.resolution_detail)}</dd>
              </div>` : ""}
              <div>
                <dt>확인이 안 된 이유</dt>
                <dd>${resolution.unconfirmed_reasons.map(escapeHtml).join(" · ")}</dd>
              </div>
            </dl>
          </div>
        </article>
      `).join("")}
    </div>`;
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
  const bed = bedUsage(device);
  const alert = allAlerts.find((item) => item.device_id === device.device_id);
  return `
    <tr
      class="activity-device-trigger"
      data-activity-device="${encodeURIComponent(device.device_id)}"
      tabindex="0"
      aria-label="${escapeAttribute(device.device_id)} 장치의 24시간 활동 그래프 보기"
    >
      <td>
        <strong class="device-name">${escapeHtml(device.name || device.device_id)}</strong>
        <span class="device-location">${escapeHtml(device.device_id)} · ${escapeHtml(device.location || "위치 미설정")}</span>
      </td>
      <td><span class="management-badge ${device.status}">${statusLabels[device.status]}</span></td>
      <td><span class="management-badge ${online ? "online" : "offline"}">${online ? "온라인" : "오프라인"}</span></td>
      <td><strong>${relativeTime(device.last_seen_at)}</strong></td>
      <td>${duration(device.inactive_seconds)}</td>
      <td>${device.battery_level != null ? `${device.battery_level}%` : "정보 없음"}</td>
      <td title="${device.wifi_rssi != null ? `${device.wifi_rssi} dBm` : ""}">${wifiLabel(device.wifi_rssi)}</td>
      <td>
        <span class="sensor-condition ${condition.className}">${condition.label}</span>
        <span class="sensor-condition ${bed.className}">${bed.label}</span>
      </td>
      <td>
        <div class="device-action-group">
          ${alert ? `<button class="device-action-button workflow" type="button" data-workflow-alert="${alert.id}">대응 단계</button>` : ""}
          ${device.status === "danger" ? `<button class="confirm-safety-button" type="button" data-confirm-device="${escapeAttribute(device.device_id)}">안전 확인 완료</button>` : ""}
        </div>
      </td>
    </tr>`;
}

function cardMarkup(device) {
  const online = isOnline(device);
  const condition = sensorCondition(device);
  const bed = bedUsage(device);
  const alert = allAlerts.find((item) => item.device_id === device.device_id);
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
          <h3>${escapeHtml(device.name || device.device_id)}</h3>
          <small>${escapeHtml(device.device_id)}</small>
        </div>
        <span class="management-badge ${device.status}">${statusLabels[device.status]}</span>
      </div>
      <div class="management-card-badges">
        <span class="management-badge ${online ? "online" : "offline"}">${online ? "온라인" : "오프라인"}</span>
        <span class="sensor-condition ${condition.className}">${condition.label}</span>
        <span class="sensor-condition ${bed.className}">${bed.label}</span>
      </div>
      <dl>
        <div><dt>마지막 수신</dt><dd>${relativeTime(device.last_seen_at)}</dd></div>
        <div><dt>무활동</dt><dd>${duration(device.inactive_seconds)}</dd></div>
        <div><dt>배터리</dt><dd>${device.battery_level != null ? `${device.battery_level}%` : "정보 없음"}</dd></div>
        <div><dt>Wi-Fi</dt><dd>${wifiLabel(device.wifi_rssi)}</dd></div>
      </dl>
      <div class="device-action-group">
        ${alert ? `<button class="device-action-button workflow" type="button" data-workflow-alert="${alert.id}">대응 단계</button>` : ""}
        ${device.status === "danger" ? `<button class="confirm-safety-button mobile" type="button" data-confirm-device="${escapeAttribute(device.device_id)}">안전 확인 완료</button>` : ""}
      </div>
    </article>`;
}

async function openSafetyResolutionDialog(deviceId) {
  const dialog = document.querySelector("#safety-resolution-dialog");
  const device = allDevices.find((item) => item.device_id === deviceId);
  const requestId = ++resolutionRequestId;
  pendingResolutionDeviceId = deviceId;
  document.querySelector("#resolution-dialog-device").textContent =
    `${deviceId} · ${device?.location || "위치 미설정"}`;
  document.querySelector("#resolution-reason-list").innerHTML =
    '<div class="activity-chart-message compact">미확인 원인을 불러오는 중입니다.</div>';
  document.querySelector("#safety-resolution-form").reset();
  document.querySelector("#resolution-other-field").hidden = true;
  document.querySelector("#resolution-other-detail").required = false;
  document.querySelector("#submit-resolution").disabled = true;
  if (!dialog.open) dialog.showModal();

  try {
    const context = await getJson(
      `/api/alerts/device/${encodeURIComponent(deviceId)}/context`,
    );
    if (requestId !== resolutionRequestId || !dialog.open) return;
    document.querySelector("#resolution-reason-list").innerHTML =
      safetyReasonMarkup(context);
    document.querySelector("#submit-resolution").disabled =
      !context.requires_confirmation;
  } catch (error) {
    if (requestId !== resolutionRequestId) return;
    document.querySelector("#resolution-reason-list").innerHTML =
      `<div class="activity-chart-message compact error">${escapeHtml(error.message)}</div>`;
  }
}

function closeSafetyResolutionDialog() {
  resolutionRequestId += 1;
  pendingResolutionDeviceId = null;
  document.querySelector("#safety-resolution-dialog").close();
}

async function submitSafetyResolution(event) {
  event.preventDefault();
  if (!pendingResolutionDeviceId) return;

  const deviceId = pendingResolutionDeviceId;
  const submit = document.querySelector("#submit-resolution");
  const form = event.currentTarget;
  const method = new FormData(form).get("resolution_method");
  const detail = document.querySelector("#resolution-other-detail").value.trim();
  submit.disabled = true;
  submit.textContent = "처리 중...";

  try {
    const resolution = await getJson(
      `/api/alerts/device/${encodeURIComponent(deviceId)}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resolution_method: method,
          resolution_detail: method === "other" ? detail : null,
        }),
      },
    );
    recentResolutions.set(deviceId, resolution);
    closeSafetyResolutionDialog();
    await refresh();
    document.querySelector("#recent-resolution-list").scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  } catch (error) {
    document.querySelector("#resolution-reason-list").insertAdjacentHTML(
      "afterbegin",
      `<div class="resolution-submit-error">${escapeHtml(error.message)}</div>`,
    );
    submit.disabled = false;
  } finally {
    submit.textContent = "안전 확인 완료";
    if (pendingResolutionDeviceId) {
      submit.disabled = false;
    }
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
  activeActivityDeviceId = deviceId;
  const location = device?.location || "위치 미설정";
  const status = statusLabels[device?.status] || "상태 정보 없음";

  document.querySelector("#activity-dialog-device").textContent =
    `${deviceId} · ${location} · ${status}`;
  document.querySelector("#device-activity-chart").innerHTML =
    '<div class="activity-chart-message">활동 데이터를 불러오는 중입니다.</div>';
  document.querySelector("#device-safety-context").innerHTML =
    '<div class="activity-chart-message compact">안전 확인 상태를 불러오는 중입니다.</div>';
  if (!dialog.open) dialog.showModal();

  try {
    const [buckets, context] = await Promise.all([
      getJson(
        `/api/activity?hours=24&buckets=24&device_id=${encodeURIComponent(deviceId)}`,
      ),
      getJson(`/api/alerts/device/${encodeURIComponent(deviceId)}/context`),
    ]);
    if (requestId === activityRequestId && dialog.open) {
      renderDeviceActivityChart(buckets);
      renderSafetyContext(context);
    }
  } catch (error) {
    if (requestId !== activityRequestId) return;
    document.querySelector("#device-activity-chart").innerHTML =
      `<div class="activity-chart-message error">${escapeHtml(error.message)}</div>`;
    document.querySelector("#device-safety-context").innerHTML = "";
  }
}

function closeActivityDialog() {
  activityRequestId += 1;
  activeActivityDeviceId = null;
  document.querySelector("#device-activity-dialog").close();
}

function closeDeviceEditor() {
  document.querySelector("#device-editor-dialog").close();
}

function openDeviceEditor() {
  const form = document.querySelector("#device-editor-form");
  const dialog = document.querySelector("#device-editor-dialog");
  form.reset();
  document.querySelector("#device-editor-error").hidden = true;
  if (!dialog.open) dialog.showModal();
}

async function submitDeviceEditor(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#device-editor-error");
  const submit = document.querySelector("#device-editor-submit");
  const sensorTypes = [...form.querySelectorAll('[name="sensor_types"]:checked')]
    .map((input) => input.value);
  if (!sensorTypes.length) {
    error.textContent = "센서 종류를 하나 이상 선택해 주세요.";
    error.hidden = false;
    return;
  }

  const deviceId = form.elements.device_id.value.trim();
  const payload = {
    device_id: deviceId,
    name: form.elements.name.value.trim(),
    location: form.elements.location.value.trim(),
    room_name: form.elements.room_name.value.trim(),
    sensor_types: sensorTypes,
    risk_profile: form.elements.risk_profile.value,
  };
  submit.disabled = true;
  submit.textContent = "저장 중...";
  error.hidden = true;

  try {
    const saved = await getJson("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await getJson(`/api/devices/${encodeURIComponent(deviceId)}/contacts`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guardian_name: form.elements.guardian_name.value.trim() || null,
        guardian_phone: form.elements.guardian_phone.value.trim() || null,
        guardian_relation: saved.guardian_relation || null,
        worker_name: form.elements.worker_name.value.trim() || null,
        worker_phone: form.elements.worker_phone.value.trim() || null,
        emergency_priority: saved.emergency_priority || "guardian_first",
        center_phone: saved.center_phone || null,
      }),
    });
    closeDeviceEditor();
    await refresh();
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = "장치 저장";
  }
}

function renderContactPreview(form) {
  const guardian = form.elements.guardian_name.value.trim() || "미등록";
  const relation = form.elements.guardian_relation.value.trim() || "관계 미등록";
  const guardianPhone = form.elements.guardian_phone.value.trim() || "연락처 미등록";
  const worker = form.elements.worker_name.value.trim() || "미등록";
  const workerPhone = form.elements.worker_phone.value.trim() || "연락처 미등록";
  const center = form.elements.center_phone.value.trim() || "연락처 미등록";
  const priority = form.elements.emergency_priority.value;
  const entries = {
    guardian_first: [
      `보호자 ${guardian} / ${relation} / ${guardianPhone}`,
      `담당 복지사 ${worker} / ${workerPhone}`,
      `관리센터 / ${center}`,
    ],
    worker_first: [
      `담당 복지사 ${worker} / ${workerPhone}`,
      `보호자 ${guardian} / ${relation} / ${guardianPhone}`,
      `관리센터 / ${center}`,
    ],
    center_first: [
      `관리센터 / ${center}`,
      `보호자 ${guardian} / ${relation} / ${guardianPhone}`,
      `담당 복지사 ${worker} / ${workerPhone}`,
    ],
  }[priority];
  document.querySelector("#contact-priority-preview").innerHTML = `
    <h3>긴급 연락 순서 미리보기</h3>
    ${entries.map((entry, index) => `<p>${index + 1}순위: ${escapeHtml(entry)}</p>`).join("")}`;
}

async function openContactDialog(deviceId) {
  const dialog = document.querySelector("#contact-dialog");
  const form = document.querySelector("#contact-form");
  pendingContactDeviceId = deviceId;
  form.reset();
  document.querySelector("#contact-dialog-device").textContent = deviceId;
  document.querySelector("#contact-form-error").hidden = true;
  if (!dialog.open) dialog.showModal();
  try {
    const contact = await getJson(
      `/api/devices/${encodeURIComponent(deviceId)}/contacts`,
    );
    Object.entries(contact).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value || "";
    });
    renderContactPreview(form);
  } catch (error) {
    const message = document.querySelector("#contact-form-error");
    message.textContent = error.message;
    message.hidden = false;
  }
}

function closeContactDialog() {
  pendingContactDeviceId = null;
  document.querySelector("#contact-dialog").close();
}

async function submitContacts(event) {
  event.preventDefault();
  if (!pendingContactDeviceId) return;
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  Object.keys(payload).forEach((key) => {
    if (key !== "emergency_priority" && !payload[key].trim()) payload[key] = null;
  });
  try {
    await getJson(
      `/api/devices/${encodeURIComponent(pendingContactDeviceId)}/contacts`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    closeContactDialog();
    await refresh();
  } catch (error) {
    const message = document.querySelector("#contact-form-error");
    message.textContent = error.message;
    message.hidden = false;
  }
}

function workflowButtonMarkup(workflow) {
  const stageOrder = [
    "danger_detected",
    "guardian_notified",
    "guardian_waiting",
    "admin_required",
    "visit_requested",
    "field_confirmed",
  ];
  const current = stageOrder.indexOf(workflow.current_stage);
  return `
    <button class="${current < 2 ? "primary" : ""}" type="button" data-workflow-action="notify_guardian" ${current >= 2 ? "disabled" : ""}>보호자 알림 발송</button>
    <button class="${current === 2 ? "primary" : ""}" type="button" data-workflow-action="escalate_admin" ${current >= 3 || current < 2 ? "disabled" : ""}>관리자에게 전달</button>
    <button class="${current === 3 ? "primary" : ""}" type="button" data-workflow-action="request_visit" ${current >= 4 || current < 3 ? "disabled" : ""}>현장 방문 요청</button>
    <button class="${current === 4 ? "primary" : ""}" type="button" data-workflow-action="complete_visit" ${current !== 4 ? "disabled" : ""}>현장 확인 완료</button>`;
}

function renderWorkflow(workflow) {
  const contact = workflow.contact;
  document.querySelector("#workflow-dialog-device").textContent =
    `${workflow.device_name} · ${workflow.device_id}`;
  document.querySelector("#workflow-content").innerHTML = `
    <div class="workflow-summary">
      <div><span>현재 처리 단계</span><strong>${escapeHtml(workflow.current_stage_label)}</strong></div>
      <span>${workflow.is_resolved ? "대응 완료" : "대응 진행 중"}</span>
    </div>
    <div class="workflow-timeline">
      ${workflow.stages.map((stage) => `
        <div class="workflow-stage ${stage.completed ? "completed" : ""} ${stage.current ? "current" : ""}">
          <span class="workflow-check">${stage.completed ? "✓" : ""}</span>
          <div><strong>${escapeHtml(stage.label)}</strong><small>${stage.current ? "현재 단계" : stage.completed ? "처리 완료" : "대기"}</small></div>
        </div>`).join("")}
    </div>
    <section class="workflow-contact-card">
      <h3>긴급 연락망</h3>
      <p>1순위 보호자: ${escapeHtml(contact.guardian_name || "미등록")} / ${escapeHtml(contact.guardian_relation || "관계 미등록")} / ${escapeHtml(contact.guardian_phone || "연락처 미등록")}</p>
      <p>2순위 담당 복지사: ${escapeHtml(contact.worker_name || "미등록")} / ${escapeHtml(contact.worker_phone || "연락처 미등록")}</p>
      <p>3순위 관리센터: ${escapeHtml(contact.center_phone || "연락처 미등록")}</p>
    </section>
    <section class="workflow-log-card">
      <h3>대응 로그</h3>
      ${workflow.logs.length ? workflow.logs.map((log) => `
        <div class="workflow-log-item"><span>${escapeHtml(log.message)}</span><time>${formatDate(log.created_at)}</time></div>
      `).join("") : "<p>기록된 대응 로그가 없습니다.</p>"}
    </section>
    <div class="workflow-actions">${workflowButtonMarkup(workflow)}</div>`;
}

async function openWorkflowDialog(alertId) {
  pendingWorkflowAlertId = Number(alertId);
  const dialog = document.querySelector("#workflow-dialog");
  document.querySelector("#workflow-content").innerHTML =
    '<div class="activity-chart-message compact">처리 단계를 불러오는 중입니다.</div>';
  if (!dialog.open) dialog.showModal();
  try {
    renderWorkflow(await getJson(`/api/alerts/${alertId}/workflow`));
  } catch (error) {
    document.querySelector("#workflow-content").innerHTML =
      `<div class="activity-chart-message compact error">${escapeHtml(error.message)}</div>`;
  }
}

function closeWorkflowDialog() {
  pendingWorkflowAlertId = null;
  document.querySelector("#workflow-dialog").close();
}

async function progressWorkflow(action) {
  if (!pendingWorkflowAlertId) return;
  document.querySelectorAll("[data-workflow-action]").forEach((button) => {
    button.disabled = true;
  });
  try {
    const workflow = await getJson(
      `/api/alerts/${pendingWorkflowAlertId}/workflow/action`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
    );
    renderWorkflow(workflow);
    await refresh();
  } catch (error) {
    document.querySelector("#workflow-content").insertAdjacentHTML(
      "afterbegin",
      `<p class="management-form-error">${escapeHtml(error.message)}</p>`,
    );
  }
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
  renderRecentResolutions();
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
    const [devices, config, alerts] = await Promise.all([
      getJson("/api/status"),
      getJson("/api/config"),
      getJson("/api/alerts?resolved=false&limit=500"),
    ]);
    allDevices = devices;
    allAlerts = alerts;
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
  const workflowButton = event.target.closest("[data-workflow-alert]");
  if (workflowButton) {
    openWorkflowDialog(workflowButton.dataset.workflowAlert);
    return;
  }
  const button = event.target.closest("[data-confirm-device]");
  if (button) {
    openSafetyResolutionDialog(button.dataset.confirmDevice);
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
document.querySelector("#activity-contact-button").addEventListener("click", () => {
  if (!activeActivityDeviceId) return;
  const deviceId = activeActivityDeviceId;
  closeActivityDialog();
  openContactDialog(deviceId);
});
document.querySelectorAll("[data-close-resolution]").forEach((button) => {
  button.addEventListener("click", closeSafetyResolutionDialog);
});
document.querySelector("#safety-resolution-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeSafetyResolutionDialog();
});
document.querySelector("#safety-resolution-form").addEventListener(
  "submit",
  submitSafetyResolution,
);
document.querySelector("#safety-resolution-form").addEventListener("change", (event) => {
  if (event.target.name !== "resolution_method") return;
  const isOther = event.target.value === "other";
  document.querySelector("#resolution-other-field").hidden = !isOther;
  document.querySelector("#resolution-other-detail").required = isOther;
});
document.querySelector("#create-device-button").addEventListener(
  "click",
  () => openDeviceEditor(),
);
document.querySelectorAll("[data-close-device-editor]").forEach((button) => {
  button.addEventListener("click", closeDeviceEditor);
});
document.querySelector("#device-editor-form").addEventListener(
  "submit",
  submitDeviceEditor,
);
document.querySelector("#device-editor-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeDeviceEditor();
});
document.querySelectorAll("[data-close-contact]").forEach((button) => {
  button.addEventListener("click", closeContactDialog);
});
document.querySelector("#contact-form").addEventListener("submit", submitContacts);
document.querySelector("#contact-form").addEventListener("input", (event) => {
  renderContactPreview(event.currentTarget);
});
document.querySelector("#contact-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeContactDialog();
});
document.querySelectorAll("[data-close-workflow]").forEach((button) => {
  button.addEventListener("click", closeWorkflowDialog);
});
document.querySelector("#workflow-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) {
    closeWorkflowDialog();
    return;
  }
  const button = event.target.closest("[data-workflow-action]");
  if (button) progressWorkflow(button.dataset.workflowAction);
});

restoreFilters();
refresh();
setInterval(refresh, 5000);
