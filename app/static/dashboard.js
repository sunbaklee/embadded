const labels = { normal: "안전", warning: "주의", danger: "위험" };
const descriptions = {
  normal: "최근 움직임이 확인되었습니다.",
  warning: "활동이 한동안 감지되지 않았습니다.",
  danger: "안전 확인이 즉시 필요합니다.",
};
let activityHours = 6;
let dashboardResolutionRequestId = 0;
let pendingDashboardResolutionDeviceId = null;
let pendingDashboardWorkflowAlertId = null;
const recentDashboardResolutions = new Map();
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
  renderDashboardResolutions();
  if (!alerts.length) {
    list.innerHTML = '<div class="empty-state compact"><strong>확인이 필요한 위험 알림이 없습니다</strong></div>';
    return;
  }

  list.innerHTML = alerts.map((alert) => `
    <article class="list-row alert-row">
      <span class="list-icon" aria-hidden="true">!</span>
      <div class="list-content">
        <div class="list-heading">
          <strong>${escapeHtml(alert.device_id)}</strong>
          <span>확인 필요</span>
        </div>
        <p>${escapeHtml(alert.message)}</p>
        <span class="alert-workflow-stage">${escapeHtml(alert.workflow_stage_label)}</span>
        <time>${formatDate(alert.created_at)}</time>
      </div>
      <div class="alert-action-buttons">
        <button class="alert-detail-button" type="button" data-dashboard-workflow="${alert.id}">대응 단계 보기</button>
        <button class="button small resolve-alert" type="button" data-resolve-device="${encodeURIComponent(alert.device_id)}">안전 확인 완료</button>
      </div>
    </article>
  `).join("");
}

function dashboardReasonMarkup(context) {
  return context.reasons.map((reason) => `
    <article class="dashboard-reason-card ${reason.level}">
      <span>${reason.level === "danger" ? "!" : "i"}</span>
      <div>
        <strong>${escapeHtml(reason.title)}</strong>
        <p>${escapeHtml(reason.detail)}</p>
      </div>
    </article>
  `).join("");
}

function renderDashboardResolutions() {
  const container = document.querySelector("#dashboard-resolution-list");
  const resolutions = [...recentDashboardResolutions.values()].reverse();
  container.hidden = resolutions.length === 0;
  if (!resolutions.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = resolutions.map((resolution) => `
    <article class="dashboard-resolved-card">
      <span class="dashboard-resolved-check">✓</span>
      <div>
        <div class="dashboard-resolved-heading">
          <strong>${escapeHtml(resolution.device_id)}</strong>
          <span>해결됨 · ${formatDate(resolution.confirmed_at)}</span>
        </div>
        <p><b>해결 방식</b>${escapeHtml(resolution.resolution_method_label)}</p>
        ${resolution.resolution_detail ? `<p><b>상세 내용</b>${escapeHtml(resolution.resolution_detail)}</p>` : ""}
        <p><b>확인이 안 된 이유</b>${resolution.unconfirmed_reasons.map(escapeHtml).join(" · ")}</p>
        <small>페이지 새로고침 시 이 해결 안내는 사라집니다.</small>
      </div>
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

async function openDashboardResolutionDialog(deviceId) {
  const dialog = document.querySelector("#dashboard-resolution-dialog");
  const requestId = ++dashboardResolutionRequestId;
  pendingDashboardResolutionDeviceId = deviceId;
  document.querySelector("#dashboard-resolution-device").textContent = deviceId;
  document.querySelector("#dashboard-reason-list").innerHTML =
    '<div class="dashboard-dialog-message">미확인 원인을 불러오는 중입니다.</div>';
  document.querySelector("#dashboard-resolution-form").reset();
  document.querySelector("#dashboard-resolution-other-field").hidden = true;
  document.querySelector("#dashboard-resolution-other-detail").required = false;
  document.querySelector("#dashboard-resolution-submit").disabled = true;
  if (!dialog.open) dialog.showModal();

  try {
    const context = await getJson(
      `/api/alerts/device/${encodeURIComponent(deviceId)}/context`,
    );
    if (requestId !== dashboardResolutionRequestId || !dialog.open) return;
    document.querySelector("#dashboard-reason-list").innerHTML =
      dashboardReasonMarkup(context);
    document.querySelector("#dashboard-resolution-submit").disabled =
      !context.requires_confirmation;
  } catch (error) {
    if (requestId !== dashboardResolutionRequestId) return;
    document.querySelector("#dashboard-reason-list").innerHTML =
      `<div class="dashboard-dialog-message error">${escapeHtml(error.message)}</div>`;
  }
}

function closeDashboardResolutionDialog() {
  dashboardResolutionRequestId += 1;
  pendingDashboardResolutionDeviceId = null;
  document.querySelector("#dashboard-resolution-dialog").close();
}

async function submitDashboardResolution(event) {
  event.preventDefault();
  if (!pendingDashboardResolutionDeviceId) return;

  const deviceId = pendingDashboardResolutionDeviceId;
  const submit = document.querySelector("#dashboard-resolution-submit");
  const method = new FormData(event.currentTarget).get("resolution_method");
  const detail = document.querySelector("#dashboard-resolution-other-detail").value.trim();
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
    recentDashboardResolutions.set(deviceId, resolution);
    closeDashboardResolutionDialog();
    showToast(`${deviceId} 장치의 안전 확인을 완료했습니다.`);
    await refresh();
    document.querySelector("#dashboard-resolution-list").scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  } catch (error) {
    document.querySelector("#dashboard-reason-list").insertAdjacentHTML(
      "afterbegin",
      `<div class="dashboard-submit-error">${escapeHtml(error.message)}</div>`,
    );
    submit.disabled = false;
  } finally {
    submit.textContent = "안전 확인 완료";
    if (pendingDashboardResolutionDeviceId) submit.disabled = false;
  }
}

function dashboardWorkflowButtons(workflow) {
  const stages = [
    "danger_detected",
    "guardian_notified",
    "guardian_waiting",
    "admin_required",
    "visit_requested",
    "field_confirmed",
  ];
  const current = stages.indexOf(workflow.current_stage);
  return `
    <button class="${current < 2 ? "primary" : ""}" type="button" data-dashboard-workflow-action="notify_guardian" ${current >= 2 ? "disabled" : ""}>보호자 알림 발송</button>
    <button class="${current === 2 ? "primary" : ""}" type="button" data-dashboard-workflow-action="escalate_admin" ${current >= 3 || current < 2 ? "disabled" : ""}>관리자에게 전달</button>
    <button class="${current === 3 ? "primary" : ""}" type="button" data-dashboard-workflow-action="request_visit" ${current >= 4 || current < 3 ? "disabled" : ""}>현장 방문 요청</button>
    <button class="${current === 4 ? "primary" : ""}" type="button" data-dashboard-workflow-action="complete_visit" ${current !== 4 ? "disabled" : ""}>현장 확인 완료</button>`;
}

function renderDashboardWorkflow(workflow) {
  const contact = workflow.contact;
  document.querySelector("#dashboard-workflow-device").textContent =
    `${workflow.device_name} · ${workflow.device_id}`;
  document.querySelector("#dashboard-workflow-content").innerHTML = `
    <div class="dashboard-workflow-summary">
      <div><span>현재 처리 단계</span><strong>${escapeHtml(workflow.current_stage_label)}</strong></div>
      <span>${workflow.is_resolved ? "대응 완료" : "대응 진행 중"}</span>
    </div>
    <div class="dashboard-workflow-timeline">
      ${workflow.stages.map((stage) => `
        <div class="dashboard-workflow-stage ${stage.completed ? "completed" : ""} ${stage.current ? "current" : ""}">
          <span class="dashboard-workflow-check">${stage.completed ? "✓" : ""}</span>
          <div><strong>${escapeHtml(stage.label)}</strong><small>${stage.current ? "현재 단계" : stage.completed ? "처리 완료" : "대기"}</small></div>
        </div>`).join("")}
    </div>
    <section class="dashboard-workflow-card">
      <h3>긴급 연락망</h3>
      <p>1순위 보호자: ${escapeHtml(contact.guardian_name || "미등록")} / ${escapeHtml(contact.guardian_relation || "관계 미등록")} / ${escapeHtml(contact.guardian_phone || "연락처 미등록")}</p>
      <p>2순위 담당 복지사: ${escapeHtml(contact.worker_name || "미등록")} / ${escapeHtml(contact.worker_phone || "연락처 미등록")}</p>
      <p>3순위 관리센터: ${escapeHtml(contact.center_phone || "연락처 미등록")}</p>
    </section>
    <section class="dashboard-workflow-card">
      <h3>대응 로그</h3>
      ${workflow.logs.length ? workflow.logs.map((log) => `
        <div class="dashboard-workflow-log"><span>${escapeHtml(log.message)}</span><time>${formatDate(log.created_at)}</time></div>
      `).join("") : "<p>기록된 대응 로그가 없습니다.</p>"}
    </section>
    <div class="dashboard-workflow-actions">${dashboardWorkflowButtons(workflow)}</div>`;
}

async function openDashboardWorkflow(alertId) {
  pendingDashboardWorkflowAlertId = Number(alertId);
  const dialog = document.querySelector("#dashboard-workflow-dialog");
  document.querySelector("#dashboard-workflow-content").innerHTML =
    '<div class="dashboard-dialog-message">처리 단계를 불러오는 중입니다.</div>';
  if (!dialog.open) dialog.showModal();
  try {
    renderDashboardWorkflow(
      await getJson(`/api/alerts/${alertId}/workflow`),
    );
  } catch (error) {
    document.querySelector("#dashboard-workflow-content").innerHTML =
      `<div class="dashboard-dialog-message error">${escapeHtml(error.message)}</div>`;
  }
}

function closeDashboardWorkflow() {
  pendingDashboardWorkflowAlertId = null;
  document.querySelector("#dashboard-workflow-dialog").close();
}

async function progressDashboardWorkflow(action) {
  if (!pendingDashboardWorkflowAlertId) return;
  document.querySelectorAll("[data-dashboard-workflow-action]").forEach((button) => {
    button.disabled = true;
  });
  try {
    const workflow = await getJson(
      `/api/alerts/${pendingDashboardWorkflowAlertId}/workflow/action`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
    );
    renderDashboardWorkflow(workflow);
    await refresh();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderReports(report) {
  const items = [
    ["총 수신 데이터", report.summary.total_received, "건"],
    ["움직임 감지", report.summary.activity_count, "회"],
    ["위험 알림 발생", report.summary.danger_alerts, "건"],
    ["주의 장치", report.summary.warning_devices, "대"],
    ["안전 확인 완료", report.summary.completed_count, "건"],
    ["오프라인 장치", report.summary.offline_devices, "대"],
  ];
  document.querySelector("#report-summary").innerHTML = items.map(([label, value, unit]) => `
    <article class="report-summary-card"><span>${label}</span><strong>${value}${unit}</strong></article>
  `).join("");
  document.querySelector("#device-report-list").innerHTML = report.devices.map((device) => `
    <article class="device-report-card ${device.status}">
      <div class="device-report-head">
        <strong>${escapeHtml(device.device_name)}</strong>
        <span>${labels[device.status] || device.status}</span>
      </div>
      <dl>
        <div><dt>최근 24시간 움직임 감지</dt><dd>${device.activity_count}회</dd></div>
        <div><dt>마지막 움직임 감지</dt><dd>${formatDate(device.last_activity_at)}</dd></div>
        <div><dt>마지막 센서 수신</dt><dd>${formatRelativeDate(device.last_seen_at)}</dd></div>
        <div><dt>위험 상태 지속 시간</dt><dd>${formatDuration(device.inactive_seconds)}</dd></div>
        <div><dt>현재 상태</dt><dd>${labels[device.status] || device.status}</dd></div>
      </dl>
    </article>
  `).join("");

  const maxValue = Math.max(
    1,
    ...report.weekly.flatMap((day) => [
      day.danger_alerts,
      day.activity_count,
      day.completed_count,
    ]),
  );
  document.querySelector("#weekly-report-chart").innerHTML = report.weekly.map((day) => {
    const date = new Date(`${day.date}T00:00:00`);
    const label = `${date.getMonth() + 1}/${date.getDate()}`;
    const height = (value) => `${Math.max(value ? 10 : 2, (value / maxValue) * 100)}%`;
    return `
      <div class="weekly-day">
        <div class="weekly-bars">
          <i style="height:${height(day.danger_alerts)}" title="위험 알림 ${day.danger_alerts}건"></i>
          <i class="activity" style="height:${height(day.activity_count)}" title="움직임 감지 ${day.activity_count}회"></i>
          <i class="resolved" style="height:${height(day.completed_count)}" title="안전 확인 완료 ${day.completed_count}건"></i>
        </div>
        <span>${label}</span>
      </div>`;
  }).join("");
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
    const [devices, alerts, logs, activity, report] = await Promise.all([
      getJson("/api/status"),
      getJson("/api/alerts?resolved=false&limit=10"),
      getJson("/api/logs?limit=10"),
      getJson(`/api/activity?hours=${activityHours}&buckets=12`),
      getJson("/api/reports"),
    ]);
    renderStatus(devices);
    renderAlerts(alerts);
    renderLogs(logs);
    renderReceiveLog(logs);
    renderActivityChart(activity);
    renderReports(report);
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
  if (resolveButton) {
    openDashboardResolutionDialog(
      decodeURIComponent(resolveButton.dataset.resolveDevice),
    );
  }

  const workflowButton = event.target.closest("[data-dashboard-workflow]");
  if (workflowButton) {
    openDashboardWorkflow(workflowButton.dataset.dashboardWorkflow);
  }

  const workflowAction = event.target.closest("[data-dashboard-workflow-action]");
  if (workflowAction) {
    progressDashboardWorkflow(workflowAction.dataset.dashboardWorkflowAction);
  }

  const reportTab = event.target.closest("[data-report-tab]");
  if (reportTab) {
    document.querySelectorAll("[data-report-tab]").forEach((button) => {
      button.classList.toggle("active", button === reportTab);
    });
    document.querySelector("#daily-report-panel").hidden =
      reportTab.dataset.reportTab !== "daily";
    document.querySelector("#weekly-report-panel").hidden =
      reportTab.dataset.reportTab !== "weekly";
  }

  const rangeButton = event.target.closest("[data-hours]");
  if (rangeButton) {
    activityHours = Number(rangeButton.dataset.hours);
    document.querySelectorAll("[data-hours]").forEach((button) => {
      button.classList.toggle("active", button === rangeButton);
    });
    refresh();
  }
});
document.querySelectorAll("[data-close-dashboard-resolution]").forEach((button) => {
  button.addEventListener("click", closeDashboardResolutionDialog);
});
document.querySelector("#dashboard-resolution-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeDashboardResolutionDialog();
});
document.querySelector("#dashboard-resolution-form").addEventListener(
  "submit",
  submitDashboardResolution,
);
document.querySelector("#dashboard-resolution-form").addEventListener("change", (event) => {
  if (event.target.name !== "resolution_method") return;
  const isOther = event.target.value === "other";
  document.querySelector("#dashboard-resolution-other-field").hidden = !isOther;
  document.querySelector("#dashboard-resolution-other-detail").required = isOther;
});
document.querySelectorAll("[data-close-dashboard-workflow]").forEach((button) => {
  button.addEventListener("click", closeDashboardWorkflow);
});
document.querySelector("#dashboard-workflow-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeDashboardWorkflow();
});
document.querySelector("#clear-simulation").addEventListener("click", clearSimulation);

async function initialize() {
  await Promise.all([configureSimulation(), configureMonitoring()]);
  await refresh();
}

initialize();
setInterval(refresh, 5000);
