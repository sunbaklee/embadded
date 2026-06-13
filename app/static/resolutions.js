let resolutionLogs = [];

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value);
  return node.innerHTML;
}

function parseDate(value) {
  const normalized = typeof value === "string" && !/(Z|[+-]\d{2}:\d{2})$/i.test(value)
    ? `${value}Z`
    : value;
  return new Date(normalized);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parseDate(value));
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`로그 조회에 실패했습니다 (${response.status})`);
  return response.json();
}

function renderHistory() {
  const query = document.querySelector("#history-search").value.trim().toLowerCase();
  const method = document.querySelector("#history-method").value;
  const filtered = resolutionLogs.filter((log) => {
    const text = `${log.device_id} ${log.device_name} ${log.location || ""} ${log.resolution_method_label} ${log.resolution_detail || ""}`.toLowerCase();
    return (!query || text.includes(query))
      && (method === "all" || log.resolution_method === method);
  });
  const today = new Date().toDateString();
  document.querySelector("#history-summary").innerHTML = `
    <article><span>전체 완료</span><strong>${resolutionLogs.length}건</strong></article>
    <article><span>오늘 완료</span><strong>${resolutionLogs.filter((log) => parseDate(log.resolved_at).toDateString() === today).length}건</strong></article>
    <article><span>현재 조회 결과</span><strong>${filtered.length}건</strong></article>`;

  const list = document.querySelector("#resolution-history-list");
  if (!filtered.length) {
    list.innerHTML = '<div class="history-empty">조건에 맞는 안전 확인 완료 로그가 없습니다.</div>';
    return;
  }
  list.innerHTML = filtered.map((log) => `
    <article class="resolution-history-item">
      <span class="history-check">✓</span>
      <div>
        <div class="history-heading">
          <strong>${escapeHtml(log.device_name)}</strong>
          <span>${escapeHtml(log.device_id)} · ${escapeHtml(log.location || "위치 미설정")}</span>
        </div>
        <dl class="history-details">
          <dt>해결 방식</dt><dd>${escapeHtml(log.resolution_method_label)}</dd>
          ${log.resolution_detail ? `<dt>상세 내용</dt><dd>${escapeHtml(log.resolution_detail)}</dd>` : ""}
          <dt>확인이 안 된 이유</dt><dd>${escapeHtml(log.original_reason)}</dd>
          <dt>최종 처리 단계</dt><dd>현장 확인 완료</dd>
        </dl>
      </div>
      <time>${formatDate(log.resolved_at)}</time>
    </article>
  `).join("");
}

document.querySelector("#history-search").addEventListener("input", renderHistory);
document.querySelector("#history-method").addEventListener("change", renderHistory);

getJson("/api/alerts/resolved?limit=500")
  .then((logs) => {
    resolutionLogs = logs;
    renderHistory();
  })
  .catch((error) => {
    document.querySelector("#resolution-history-list").innerHTML =
      `<div class="history-empty">${escapeHtml(error.message)}</div>`;
  });
