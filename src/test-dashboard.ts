import { escapeHtml, page, sidebarHtml } from "./html.js";
import type { EndpointHealth } from "./repository.js";
import { isUserFacingEndpoint } from "./secure-config.js";
import { PUBLIC_ENDPOINT_MIN_SCORE } from "./subscriptions.js";
import type { Endpoint } from "./types.js";
import type { VpnTestEndpointScore } from "./vpn-test-telemetry.js";

type TestDashboardInput = {
  endpoints: Endpoint[];
  health: EndpointHealth[];
  scores: VpnTestEndpointScore[];
  httpChecks?: TestHttpCheck[];
  testTargets?: TestTarget[];
};

export type TestHttpCheck = {
  id: string;
  label: string;
  url: string;
  group: string;
  enabled?: boolean;
};

export type TestTarget = {
  id: string;
  label: string;
  runner: "ssh" | "android-adb";
  mode: "docker" | "native" | "android";
  engine: "xray" | "singbox";
  enabled?: boolean;
};

const DEFAULT_TEST_TARGETS: TestTarget[] = [
  { id: "lan-server44", label: "worker-lan · Xray Docker", runner: "ssh", mode: "docker", engine: "xray", enabled: true },
  { id: "lan-server44-singbox-http", label: "worker-lan · sing-box HTTP", runner: "ssh", mode: "docker", engine: "singbox", enabled: true },
  { id: "lan-server44-singbox-socks", label: "worker-lan · sing-box SOCKS", runner: "ssh", mode: "docker", engine: "singbox", enabled: true },
  { id: "external-mac", label: "Mac · native Xray", runner: "ssh", mode: "native", engine: "xray", enabled: true },
  { id: "external-wireless-android", label: "Android 4G · worker-main", runner: "android-adb", mode: "android", engine: "xray", enabled: true },
];

const DEFAULT_HTTP_CHECKS: TestHttpCheck[] = [
  { id: "telegram", label: "Telegram", url: "https://telegram.org", group: "gate", enabled: true },
  { id: "gstatic", label: "Google 204", url: "https://www.gstatic.com/generate_204", group: "gate", enabled: false },
  { id: "youtube", label: "YouTube", url: "https://www.youtube.com", group: "world", enabled: true },
  { id: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com", group: "world", enabled: true },
  { id: "reddit", label: "Reddit", url: "https://www.reddit.com", group: "world", enabled: false },
  { id: "wikipedia", label: "Wikipedia", url: "https://en.wikipedia.org", group: "world", enabled: true },
  { id: "vk", label: "VK", url: "https://vk.com", group: "ru", enabled: true },
  { id: "yandex", label: "Yandex", url: "https://yandex.ru", group: "ru", enabled: true },
  { id: "2ip", label: "2ip", url: "https://2ip.ru", group: "ru", enabled: true },
];

function renderHttpCheckSelector(checks: TestHttpCheck[] | undefined): string {
  const values = checks && checks.length > 0 ? checks : DEFAULT_HTTP_CHECKS;
  const requiredIds = new Set(["telegram"]);
  const rows = values.map((check) => {
    const required = requiredIds.has(check.id);
    const checked = check.enabled !== false || required;
    const requiredNote = required ? " · обязательная" : "";
    return `<label class="test-target-option"><input type="checkbox" id="test-check-${escapeHtml(check.id)}" data-test-check-id="${escapeHtml(check.id)}"${checked ? " checked" : ""}${required ? " disabled" : ""}><span><strong>${escapeHtml(check.label)}</strong><small>${escapeHtml(check.url)}${requiredNote}</small></span></label>`;
  }).join("");
  return `<section class="card test-card" id="test-checks">
    <div class="card-header test-section-header">
      <div><h3>Цели проверки</h3><p>Выберите сайты для quick и полного health-check. Reddit и Google 204 выключены по умолчанию, но их можно включить здесь.</p></div>
      <button class="btn btn-quiet btn-sm" type="button" onclick="resetTestChecks()">Сбросить по умолчанию</button>
    </div>
    <div class="test-target-grid">${rows}</div>
  </section>`;
}

function renderTestTargetSelector(targets: TestTarget[] | undefined): string {
  const values = targets && targets.length > 0 ? targets : DEFAULT_TEST_TARGETS;
  const rows = values.map((target) => {
    const runnerLabel = target.runner === "android-adb" ? "ADB" : target.mode === "native" ? "SSH · native" : `SSH · ${target.engine}`;
    return `<label class="test-target-option"><input type="checkbox" id="test-target-${escapeHtml(target.id)}" data-test-target-id="${escapeHtml(target.id)}"${target.enabled === false ? "" : " checked"}><span><strong>${escapeHtml(target.label)}</strong><small>${escapeHtml(runnerLabel)}</small></span></label>`;
  }).join("");
  return `<section class="card test-card" id="test-targets">
    <div class="card-header test-section-header">
      <div><h3>Источники теста</h3><p>Выберите разрешённые SSH/ADB targets. Хосты и режимы выполнения задаются на сервере, браузер отправляет только ID.</p></div>
      <button class="btn btn-quiet btn-sm" type="button" onclick="resetTestTargets()">Сбросить по умолчанию</button>
    </div>
    <div class="test-target-grid">${rows}</div>
  </section>`;
}

type EndpointViewStatus = {
  className: "ok" | "warning" | "error" | "unknown";
  label: string;
};

function endpointFlag(id: string): string {
  if (id.startsWith("de-") || id.includes("-de-")) return "🇩🇪";
  if (id.startsWith("us-") || id.includes("-us-")) return "🇺🇸";
  if (id.startsWith("ru-")) return "🇷🇺";
  return "";
}

function formatDateTime(dateString: string | null): string {
  if (!dateString) return "Нет данных";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Нет данных";
  return date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return "Не проверялся";
  const time = new Date(dateString).getTime();
  if (!Number.isFinite(time)) return "Не проверялся";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} дн назад`;
}

function endpointStatus(health: EndpointHealth | undefined): EndpointViewStatus {
  if (!health) return { className: "unknown", label: "Нет проверки" };
  if (health.pass_count > 0 && health.pass_count >= health.fail_count) {
    return { className: "ok", label: "Работает" };
  }
  return { className: "error", label: "Ошибка" };
}

function endpointSitesSummary(health: EndpointHealth | undefined): string {
  if (!health || health.sites.length === 0) return "Нет данных о сайтах";
  const passed = health.sites.filter((site) => site.ok).length;
  return `${passed} из ${health.sites.length} сайтов`;
}

function scorePill(score: VpnTestEndpointScore): { className: EndpointViewStatus["className"]; label: string } {
  if (score.effectiveObservations < 20) return { className: "unknown", label: "Мало данных" };
  if (score.score < PUBLIC_ENDPOINT_MIN_SCORE) return { className: "error", label: "Не выдаётся пользователям" };
  if (score.score < 90) return { className: "warning", label: "Рабочий резерв" };
  return { className: "ok", label: "Рекомендуется" };
}

function renderScorePanel(input: TestDashboardInput): string {
  const scores = [...input.scores].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return (left.telegramMedianMs ?? Number.MAX_SAFE_INTEGER) - (right.telegramMedianMs ?? Number.MAX_SAFE_INTEGER)
      || left.endpointId.localeCompare(right.endpointId);
  });
  if (scores.length === 0) {
    return `<section class="card test-card" id="endpoint-scores"><div class="card-header test-section-header"><div><h3>Score за 3 дня</h3><p>Пока нет завершённых endpoint-проверок.</p></div></div></section>`;
  }

  const labels = new Map(input.endpoints.map((endpoint) => [endpoint.id, endpoint.label]));
  const rows = scores.map((score, index) => {
    const status = scorePill(score);
    const scoreText = Number.isFinite(score.score) ? `${score.score.toFixed(1)}%` : "—";
    const latency = score.telegramMedianMs == null ? "—" : `${score.telegramMedianMs} ms`;
    return `<tr class="score-row endpoint-clickable ${status.className === "error" ? "score-row-disabled" : ""}" data-endpoint-id="${escapeHtml(score.endpointId)}" role="button" tabindex="0" onclick="openEndpointDetail(this.dataset.endpointId)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openEndpointDetail(this.dataset.endpointId)}">
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(labels.get(score.endpointId) ?? score.endpointId)}</strong><div class="endpoint-id">${escapeHtml(score.endpointId)}</div></td>
      <td><span class="score-value ${status.className}">${scoreText}</span></td>
      <td>${score.passed} / ${score.effectiveObservations}<div class="metric-sub">${score.endpointFailures} ошибок endpoint</div></td>
      <td>${latency}</td>
      <td>${score.runnerErrors} runner-ошибок исключено</td>
      <td><span class="state-pill ${status.className}"><span class="state-dot"></span>${status.label}</span></td>
    </tr>`;
  }).join("");

  return `<section class="card test-card" id="endpoint-scores">
    <div class="card-header test-section-header">
      <div><h3>Score за 3 дня</h3><p>Рейтинг по eligible-проверкам. Runner-ошибки считаются отдельно и не портят endpoint score.</p></div>
      <span class="section-kicker">Лучшие сверху</span>
    </div>
    <div class="score-note">Endpoint со score ниже ${PUBLIC_ENDPOINT_MIN_SCORE}% и минимум 20 эффективными проверками не выдаётся в пользовательских подписках. Он остаётся в диагностике для разбора.</div>
    <div class="table-scroll"><table class="endpoint-table score-table" aria-label="Score endpoint-ов за последние 3 дня">
      <thead><tr><th>#</th><th>Endpoint</th><th>Score</th><th>Успешно</th><th>Telegram median</th><th>Runner</th><th>Для пользователей</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

function renderEndpointMatrix(endpoints: Endpoint[], health: EndpointHealth[]): string {
  const healthByEndpoint = new Map(health.map((item) => [item.endpoint_id, item]));
  if (endpoints.length === 0) {
    return `<div class="test-empty">В каталоге пока нет endpoint’ов.</div>`;
  }

  const rows = endpoints.map((endpoint) => {
    const item = healthByEndpoint.get(endpoint.id);
    const status = endpointStatus(item);
    const speed = item?.speed_mbps == null ? "—" : `${item.speed_mbps} Mbps`;
    const latency = item?.latency_ms == null ? "—" : `${item.latency_ms} ms`;
    const purpose = isUserFacingEndpoint(endpoint.id) ? "Пользовательский relay" : "Диагностический fallback";
    const enabled = endpoint.enabled ? "Включён" : "Отключён";
    return `<tr class="endpoint-clickable" data-endpoint-id="${escapeHtml(endpoint.id)}" role="button" tabindex="0" onclick="openEndpointDetail(this.dataset.endpointId)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openEndpointDetail(this.dataset.endpointId)}">
      <td>
        <div class="endpoint-name"><span class="endpoint-flag">${endpointFlag(endpoint.id)}</span><strong>${escapeHtml(endpoint.label)}</strong></div>
        <div class="endpoint-id">${escapeHtml(endpoint.id)}</div>
      </td>
      <td><span class="endpoint-purpose">${purpose}</span><span class="endpoint-kind">${escapeHtml(endpoint.kind)} · ${enabled}</span></td>
      <td><span class="state-pill ${status.className}"><span class="state-dot"></span>${status.label}</span></td>
      <td><div class="metric-main">${latency}</div><div class="metric-sub">${speed}</div></td>
      <td><div class="metric-main">${endpointSitesSummary(item)}</div><div class="metric-sub">${item ? `${item.pass_count} успешных · ${item.fail_count} ошибок` : "Запустите health-check"}</div></td>
      <td><div class="metric-main">${formatRelativeTime(item?.checked_at ?? null)}</div><div class="metric-sub">${formatDateTime(item?.checked_at ?? null)}</div></td>
    </tr>`;
  }).join("");

  return `<div class="table-scroll"><table class="endpoint-table" aria-label="Текущее состояние endpoint’ов">
    <thead><tr><th>Endpoint</th><th>Назначение</th><th>Статус</th><th>Задержка / скорость</th><th>Проверки сайтов</th><th>Последняя проверка</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderSummary(input: TestDashboardInput): string {
  const healthByEndpoint = new Map(input.health.map((item) => [item.endpoint_id, item]));
  const working = input.endpoints.filter((endpoint) => endpointStatus(healthByEndpoint.get(endpoint.id)).className === "ok").length;
  const attention = input.endpoints.length - working;
  const latestCheck = input.health
    .map((item) => item.checked_at)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;

  return `<div class="test-summary-grid" aria-label="Сводка тестирования">
    <div class="test-summary-card"><div class="summary-label">Endpoint’ов в каталоге</div><div class="summary-value">${input.endpoints.length}</div><div class="summary-note">Пользовательские и диагностические маршруты</div></div>
    <div class="test-summary-card"><div class="summary-label">Работают сейчас</div><div class="summary-value success-text">${working}</div><div class="summary-note">Подтверждено последним health-check</div></div>
    <div class="test-summary-card"><div class="summary-label">Требуют внимания</div><div class="summary-value ${attention > 0 ? "warning-text" : "success-text"}">${attention}</div><div class="summary-note">Нет проверки или есть ошибка</div></div>
    <div class="test-summary-card"><div class="summary-label">Последний health-check</div><div class="summary-value summary-date">${formatDateTime(latestCheck)}</div><div class="summary-note">${formatRelativeTime(latestCheck)}</div></div>
  </div>`;
}

function renderTestDashboard(input: TestDashboardInput): string {
  return page(
    "VPN Test Center",
    `${sidebarHtml("/admin/tests")}
    <main class="main-content test-dashboard" id="test-workspace">
      <section class="test-hero">
        <div>
          <div class="eyebrow">VPN / диагностика</div>
          <h2>Центр тестирования</h2>
          <p>Все проверки собраны здесь: запустить тест, увидеть состояние endpoint’ов и открыть историю любого запуска.</p>
        </div>
        <div class="test-actions">
          <button class="btn btn-primary" id="quick-test-btn" type="button" onclick="runQuickTest()">⚡ Быстрая проверка</button>
          <button class="btn btn-secondary" id="benchmark-btn" type="button" onclick="runBenchmark()">🌐 Полный health-check</button>
          <button class="btn btn-secondary" type="button" onclick="location.reload()">↻ Обновить данные</button>
        </div>
      </section>

      ${renderTestTargetSelector(input.testTargets)}

      ${renderHttpCheckSelector(input.httpChecks)}

      ${renderSummary(input)}

      ${renderScorePanel(input)}

      <section class="card test-card endpoint-detail-card" id="endpoint-detail-card" hidden aria-live="polite"></section>

      <section class="card test-card" id="current-endpoints">
        <div class="card-header test-section-header">
          <div><h3>Текущее состояние endpoint’ов</h3><p>Последний известный результат. Для полной картины смотрите историю ниже.</p></div>
          <span class="section-kicker">Endpoint Health</span>
        </div>
        ${renderEndpointMatrix(input.endpoints, input.health)}
      </section>

      <section class="card test-card" id="recent-tests">
        <div class="card-header test-section-header">
          <div><h3>История запусков</h3><p>Здесь видны прошлые quick, health и benchmark-проверки — без перехода в другую панель.</p></div>
          <div class="history-shortcuts"><button class="btn btn-quiet btn-sm" type="button" onclick="setHistoryPreset('today')">Сегодня</button><button class="btn btn-quiet btn-sm" type="button" onclick="setHistoryPreset('week')">7 дней</button><button class="btn btn-quiet btn-sm" type="button" onclick="setHistoryPreset('all')">Вся история</button></div>
        </div>
        <form id="history-filters" onsubmit="event.preventDefault();loadVpnTestHistory()" class="history-filters">
          <div class="form-group"><label for="history-network-class">Сеть</label><select class="input" id="history-network-class"><option value="">Все сети</option><option value="lan">LAN</option><option value="external-wired">Внешняя проводная</option><option value="external-wireless">Внешняя Wi-Fi</option><option value="external-mobile">Внешняя мобильная</option><option value="external-unknown">Внешняя, путь не подтверждён</option></select></div>
          <div class="form-group"><label for="history-client">Client</label><select class="input" id="history-client"><option value="">Все client</option><option value="xray">Xray</option><option value="sing-box">sing-box</option><option value="smartdns">SmartDNS</option></select></div>
          <div class="form-group"><label for="history-access-method">Доступ</label><select class="input" id="history-access-method"><option value="">HTTP/SOCKS/DNS</option><option value="http-proxy">HTTP proxy</option><option value="socks-proxy">SOCKS proxy</option><option value="smart-http">Smart HTTP</option><option value="dns">DNS</option></select></div>
          <div class="form-group"><label for="history-wire-method">Wire method</label><select class="input" id="history-wire-method"><option value="">Все wire</option><option value="4g">4G</option><option value="wire-internal">Wire internal</option><option value="wire-external">Wire external</option></select></div>
          <div class="form-group"><label for="history-target">Откуда запуск</label><input class="input" id="history-target" placeholder="worker-lan, Mac, Android"></div>
          <div class="form-group"><label for="history-profile">Тип теста</label><select class="input" id="history-profile"><option value="">Все типы</option><option value="quick">Быстрая проверка</option><option value="health">Health-check</option><option value="benchmark">Полный benchmark</option></select></div>
          <div class="form-group"><label for="history-endpoint">Endpoint</label><input class="input" id="history-endpoint" placeholder="smart-de-relay"></div>
          <div class="form-group"><label for="history-status">Результат</label><select class="input" id="history-status"><option value="">Любой результат</option><option value="passed">Пройдено</option><option value="degraded">Частично</option><option value="failed">Провалено</option><option value="error">Ошибка runner</option><option value="running">Выполняется</option></select></div>
          <div class="form-group"><label for="history-date-from">Начало периода</label><input class="input" id="history-date-from" type="datetime-local"></div>
          <div class="form-group"><label for="history-date-to">Конец периода</label><input class="input" id="history-date-to" type="datetime-local"></div>
          <button class="btn btn-primary" type="submit">Показать историю</button>
        </form>
        <div class="history-legend"><span class="state-pill ok"><span class="state-dot"></span>Пройдено</span><span class="state-pill warning"><span class="state-dot"></span>Частично</span><span class="state-pill error"><span class="state-dot"></span>Ошибка транспорта</span><span class="history-legend-note">Раскрывайте строку, чтобы увидеть этапы и конкретный endpoint.</span></div>
        <div id="history-result-count" class="history-result-count"><span>История загружается…</span><label class="history-auto-refresh"><input id="history-auto-refresh" type="checkbox" checked><span>Автообновление</span><span id="history-live-status" class="history-live-status">Включено</span></label></div>
        <div id="vpn-test-history-runs" class="test-history-list"><div class="test-empty">Загрузка истории…</div></div>
      </section>

      <section class="card test-card" id="deep-probe">
        <div class="card-header test-section-header">
          <div><h3>Глубокий probe</h3><p>Расширенная проверка сайтов и выхода. Результаты тоже остаются на этой странице.</p></div>
          <div class="probe-controls"><select id="probe-node" class="input"><option value="worker-main">worker-main</option><option value="mac">Mac</option><option value="worker-lan">worker-lan</option><option value="worker-dev">worker-dev</option><option value="auto">Все узлы</option></select><select id="probe-engine" class="input"><option value="xray">Xray</option><option value="singbox">sing-box</option><option value="both">Оба движка</option></select><button class="btn btn-secondary" id="run-probe-btn" type="button" onclick="runProbe()">🔎 Запустить probe</button></div>
        </div>
        <div id="probe-status" class="probe-status"></div>
        <div id="probe-logs" class="probe-logs" hidden></div>
        <div id="all-probe-results" class="probe-results"><div class="test-empty">Загрузка результатов probe…</div></div>
      </section>
    </main>

    <style>
      .test-dashboard { max-width: 1480px; }
      .test-hero { display:flex;justify-content:space-between;gap:28px;align-items:flex-end;margin-bottom:22px; }
      .test-hero h2 { font-size:30px;letter-spacing:-.03em;margin:3px 0 5px; }
      .test-hero p { color:var(--text-secondary);font-size:14px;max-width:680px; }
      .eyebrow,.section-kicker { color:var(--primary-hover);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase; }
      .test-actions,.probe-controls,.history-shortcuts { display:flex;gap:8px;align-items:center;flex-wrap:wrap; }
      .test-summary-grid { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px; }
      .test-summary-card { background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;min-height:116px; }
      .summary-label { color:var(--text-secondary);font-size:12px;font-weight:600; }
      .summary-value { color:var(--text);font-size:27px;font-weight:700;line-height:1.2;margin:8px 0 5px; }
      .summary-value.summary-date { font-size:18px;margin-top:13px; }
      .summary-note { color:var(--text-muted);font-size:11px; }
      .success-text { color:var(--success); }.warning-text { color:var(--warning); }
      .score-note { color:var(--text-secondary);font-size:12px;margin:-4px 0 14px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-elevated); }
      .score-value { font-weight:700; }.score-value.ok { color:var(--success); }.score-value.warning { color:var(--warning); }.score-value.error { color:var(--error); }.score-value.unknown { color:var(--text-secondary); }
      .score-row-disabled { background:rgba(239,68,68,.045); }
      .test-card { margin-bottom:18px;overflow:hidden; }
      .test-section-header { display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap; }
      .test-section-header h3 { margin-bottom:3px; }.test-section-header p { color:var(--text-muted);font-size:12px; }
      .table-scroll { overflow-x:auto; }
      .endpoint-table { width:100%;border-collapse:collapse;min-width:920px; }
      .endpoint-table th { color:var(--text-muted);font-size:10px;font-weight:700;letter-spacing:.04em;text-align:left;text-transform:uppercase;padding:11px 18px;border-bottom:1px solid var(--border);white-space:nowrap; }
      .endpoint-table td { padding:13px 18px;border-bottom:1px solid var(--border-light);font-size:12px;vertical-align:middle; }
      .endpoint-table tbody tr:last-child td { border-bottom:0; }.endpoint-table tbody tr:hover { background:var(--bg-hover); }
      .endpoint-clickable { cursor:pointer; }.endpoint-clickable:focus { outline:2px solid var(--primary-hover);outline-offset:-2px; }.endpoint-clickable:hover { background:var(--bg-hover); }
      .endpoint-detail-card[hidden] { display:none; }.endpoint-detail-card { border-color:var(--primary); }.endpoint-detail-toolbar { display:flex;justify-content:space-between;align-items:flex-start;gap:16px; }.endpoint-detail-title { font-size:20px;font-weight:700; }.endpoint-detail-subtitle { color:var(--text-secondary);font-size:12px;margin-top:4px; }.endpoint-detail-summary { display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:10px;margin-bottom:16px; }.endpoint-detail-metric { background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:11px 12px; }.endpoint-detail-metric .summary-value { font-size:20px;margin:4px 0 0; }.endpoint-detail-metric .summary-label { font-size:10px; }.endpoint-detail-table { width:100%;border-collapse:collapse;min-width:1180px; }.endpoint-detail-table th { color:var(--text-muted);font-size:10px;text-align:left;text-transform:uppercase;padding:10px 12px;border-bottom:1px solid var(--border);white-space:nowrap; }.endpoint-detail-table td { padding:11px 12px;border-bottom:1px solid var(--border-light);font-size:11px;vertical-align:top; }.endpoint-detail-table tr:last-child td { border-bottom:0; }.matrix-dimension { color:var(--text-secondary);line-height:1.5; }.matrix-dimension strong { color:var(--text); }.matrix-metric { white-space:nowrap; }.matrix-metric .metric-sub { white-space:nowrap; }.endpoint-site-grid { display:flex;flex-wrap:wrap;gap:5px;min-width:360px; }.endpoint-site-chip { display:inline-flex;flex-direction:column;gap:1px;padding:5px 7px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);min-width:78px; }.endpoint-site-chip.ok { border-color:rgba(34,197,94,.45); }.endpoint-site-chip.warning { border-color:rgba(245,158,11,.45); }.endpoint-site-chip.error { border-color:rgba(239,68,68,.45); }.endpoint-site-chip .site-name { color:var(--text);font-weight:700; }.endpoint-site-chip .site-metric { color:var(--text-muted);font-size:10px; }.site-result-matrix { padding:14px 16px 16px;border-top:1px solid var(--border); }.site-result-matrix h4 { margin:0 0 10px;font-size:13px; }.site-result-table { width:100%;border-collapse:collapse;min-width:760px; }.site-result-table th { color:var(--text-muted);font-size:10px;text-align:left;text-transform:uppercase;padding:8px 10px;border-bottom:1px solid var(--border); }.site-result-table td { padding:9px 10px;border-bottom:1px solid var(--border-light);font-size:11px;vertical-align:top; }.site-result-table tr:last-child td { border-bottom:0; }.site-result-endpoint { padding:10px 0 14px; }.site-result-endpoint + .site-result-endpoint { border-top:1px solid var(--border); }.site-result-endpoint-header { display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:8px; }.site-result-error { color:var(--error);font-size:11px;overflow-wrap:anywhere; }.run-site-summary { color:var(--text-secondary);font-size:11px;margin-bottom:10px; }
      .endpoint-name { display:flex;align-items:center;gap:7px;font-size:13px; }.endpoint-flag { width:20px; }.endpoint-id,.endpoint-kind,.metric-sub { color:var(--text-muted);font-size:10px;margin-top:3px; }.endpoint-purpose { display:block;color:var(--text-secondary); }.state-pill { display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;white-space:nowrap; }.state-dot { width:7px;height:7px;border-radius:50%;background:currentColor;display:inline-block; }.state-pill.ok { color:var(--success); }.state-pill.warning { color:var(--warning); }.state-pill.error { color:var(--error); }.state-pill.unknown { color:var(--text-muted); }.metric-main { color:var(--text);font-weight:600; }.test-empty { color:var(--text-muted);padding:25px;text-align:center; }
      .history-filters { display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:10px;padding:0 20px 14px;align-items:end; }.history-filters .form-group { margin:0; }.history-filters label { font-size:11px; }.history-filters .btn { min-height:40px; }
      .test-target-grid { display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));gap:8px;padding:0 20px 20px; }.test-target-option { display:flex;gap:9px;align-items:flex-start;padding:10px 11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-elevated);cursor:pointer; }.test-target-option input { margin-top:2px;accent-color:var(--primary-hover); }.test-target-option strong { display:block;font-size:12px; }.test-target-option small { display:block;color:var(--text-muted);font-size:10px;margin-top:3px;overflow-wrap:anywhere; }
      .history-legend { display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:0 20px 10px;font-size:11px; }.history-legend-note { color:var(--text-muted); }.history-result-count { display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;color:var(--text-muted);font-size:11px;padding:0 20px 10px; }.history-live-status { color:var(--primary-hover); }.history-auto-refresh { display:inline-flex;align-items:center;gap:6px;color:var(--primary-hover);cursor:pointer; }.history-auto-refresh input { accent-color:var(--primary-hover); }.test-history-list { padding:0 20px 20px; }
      .vpn-test-run { background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;margin-bottom:8px; }.vpn-test-run[open] { border-color:var(--primary); }.vpn-test-run > summary { cursor:pointer;list-style:none;padding:14px 16px; }.vpn-test-run > summary::-webkit-details-marker { display:none; }.run-summary { display:flex;justify-content:space-between;align-items:center;gap:18px; }.run-topline { display:flex;gap:8px;align-items:center;flex-wrap:wrap; }.run-profile { color:var(--text);font-weight:700; }.run-meta { color:var(--text-secondary);font-size:12px;margin-top:4px; }.run-id { color:var(--text-muted);font-family:monospace;font-size:10px;margin-top:4px; }.run-result { text-align:right;white-space:nowrap; }.run-summary-text { color:var(--text-secondary);font-size:11px;margin-bottom:4px; }.run-chevron { color:var(--text-muted);font-size:18px; }.vpn-test-run[open] .run-chevron { transform:rotate(180deg); }.vpn-test-stages { border-top:1px solid var(--border); }.vpn-test-stage { display:grid;grid-template-columns:minmax(130px,1.2fr) minmax(120px,1fr) minmax(90px,.7fr) minmax(180px,2fr) auto;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border-light);font-size:11px; }.vpn-test-stage:last-child { border-bottom:0; }.stage-message { color:var(--text-secondary);overflow-wrap:anywhere; }.stage-kind { color:var(--text-muted); }
      .probe-controls .input { width:auto;min-width:120px; }.probe-status { color:var(--text-muted);font-size:12px;padding:0 20px 10px; }.probe-logs { background:var(--bg);border:1px solid var(--border);border-radius:8px;margin:0 20px 12px;padding:12px;max-height:260px;overflow:auto;color:var(--text-secondary);font:11px/1.5 monospace; }.probe-results { padding:0 20px 20px; }.probe-result-card { background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;margin-top:10px;overflow:hidden; }.probe-result-header { display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 14px;border-bottom:1px solid var(--border); }.probe-result-meta { color:var(--text-secondary);font-size:12px; }.probe-result-file { color:var(--text-muted);font:10px monospace; }.probe-result-table { width:100%;border-collapse:collapse;font-size:11px; }.probe-result-table th { color:var(--text-muted);font-size:10px;text-align:left;text-transform:uppercase;padding:8px 12px;border-bottom:1px solid var(--border); }.probe-result-table td { padding:8px 12px;border-bottom:1px solid var(--border-light); }.probe-result-table tr:last-child td { border-bottom:0; }.probe-ok { color:var(--success);font-weight:700; }.probe-fail { color:var(--error);font-weight:700; }
      .btn-quiet { background:transparent;border:1px solid var(--border);color:var(--text-secondary); }.btn-quiet:hover { background:var(--bg-hover);color:var(--text); }
      @media (max-width:1050px) { .test-summary-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }.history-filters { grid-template-columns:repeat(3,minmax(130px,1fr)); }.test-hero { align-items:flex-start;flex-direction:column; } }
      @media (max-width:700px) { .test-summary-grid,.history-filters,.endpoint-detail-summary { grid-template-columns:1fr; }.test-hero h2 { font-size:25px; }.test-actions,.test-actions .btn { width:100%; }.test-actions .btn { justify-content:center; }.run-summary { align-items:flex-start;flex-direction:column;gap:8px; }.run-result { text-align:left; }.vpn-test-stage { grid-template-columns:1fr 1fr; }.probe-controls,.probe-controls .input,.probe-controls .btn { width:100%; }.probe-controls .btn { justify-content:center; } }
    </style>

    <script>
      function testPostJson(url, body) {
        return fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(function(response) {
          return response.json().then(function(data) { if (!response.ok) throw new Error(data.error || data.message || 'HTTP ' + response.status); return data; });
        });
      }

      function testStatusPoll(url, buttonId, label, intervalMs) {
        var button = document.getElementById(buttonId);
        var startedAt = Date.now();
        var poll = function() {
          fetch(url, { credentials: 'include' }).then(function(response) { return response.json(); }).then(function(data) {
            if (!data.running) {
              if (button) { button.disabled = false; button.textContent = label; }
              testToast('Проверка завершена');
              setTimeout(function() { location.reload(); }, 700);
              return;
            }
            var seconds = Math.floor((Date.now() - startedAt) / 1000);
            if (button) button.textContent = 'Выполняется · ' + seconds + ' с';
            setTimeout(poll, intervalMs);
          }).catch(function() { setTimeout(poll, intervalMs); });
        };
        setTimeout(poll, intervalMs);
      }

      var testChecksStorageKey = 'vpn-test-http-checks';
      var testTargetsStorageKey = 'vpn-test-targets';
      function selectedTestTargets() {
        var boxes = Array.prototype.slice.call(document.querySelectorAll('[data-test-target-id]'));
        return boxes.filter(function(box) { return box.checked; }).map(function(box) { return box.getAttribute('data-test-target-id'); });
      }
      function saveTestTargets() {
        try { localStorage.setItem(testTargetsStorageKey, JSON.stringify(selectedTestTargets())); } catch (_) {}
      }
      function resetTestTargets() {
        try { localStorage.removeItem(testTargetsStorageKey); } catch (_) {}
        location.reload();
      }
      (function setupTestTargets() {
        var boxes = Array.prototype.slice.call(document.querySelectorAll('[data-test-target-id]'));
        var saved = null;
        try { saved = JSON.parse(localStorage.getItem(testTargetsStorageKey) || 'null'); } catch (_) {}
        if (Array.isArray(saved)) boxes.forEach(function(box) { box.checked = saved.indexOf(box.getAttribute('data-test-target-id')) !== -1; });
        boxes.forEach(function(box) { box.addEventListener('change', saveTestTargets); });
      })();
      function selectedTestChecks() {
        var boxes = Array.prototype.slice.call(document.querySelectorAll('[data-test-check-id]'));
        return boxes.filter(function(box) { return box.checked || box.disabled; }).map(function(box) { return box.getAttribute('data-test-check-id'); });
      }
      function saveTestChecks() {
        try { localStorage.setItem(testChecksStorageKey, JSON.stringify(selectedTestChecks())); } catch (_) {}
      }
      function resetTestChecks() {
        try { localStorage.removeItem(testChecksStorageKey); } catch (_) {}
        location.reload();
      }
      (function setupTestChecks() {
        var boxes = Array.prototype.slice.call(document.querySelectorAll('[data-test-check-id]'));
        var saved = null;
        try { saved = JSON.parse(localStorage.getItem(testChecksStorageKey) || 'null'); } catch (_) {}
        if (Array.isArray(saved)) boxes.forEach(function(box) { if (!box.disabled) box.checked = saved.indexOf(box.getAttribute('data-test-check-id')) !== -1; });
        boxes.forEach(function(box) { box.addEventListener('change', saveTestChecks); });
      })();

      function runQuickTest() {
        var button = document.getElementById('quick-test-btn');
        if (button) { button.disabled = true; button.textContent = 'Запускаю…'; }
        testPostJson('/api/admin/endpoint-health/check', { targets: selectedTestTargets(), checks: selectedTestChecks() }).then(function() {
          testToast('Быстрая проверка запущена');
          testStatusPoll('/api/admin/endpoint-health/check/status', 'quick-test-btn', '⚡ Быстрая проверка', 3000);
        }).catch(function(error) {
          if (button) { button.disabled = false; button.textContent = '⚡ Быстрая проверка'; }
          if (error.message.toLowerCase().includes('already running')) {
            testStatusPoll('/api/admin/endpoint-health/check/status', 'quick-test-btn', '⚡ Быстрая проверка', 3000);
          } else alert('Не удалось запустить проверку: ' + error.message);
        });
      }

      function runBenchmark() {
        var button = document.getElementById('benchmark-btn');
        if (!confirm('Запустить полный health-check? Он занимает до 5 минут.')) return;
        if (button) { button.disabled = true; button.textContent = 'Запускаю…'; }
        testPostJson('/api/admin/endpoint-health/benchmark', { targets: selectedTestTargets(), checks: selectedTestChecks() }).then(function() {
          testToast('Полный health-check запущен');
          testStatusPoll('/api/admin/endpoint-health/benchmark/status', 'benchmark-btn', '🌐 Полный health-check', 5000);
        }).catch(function(error) {
          if (button) { button.disabled = false; button.textContent = '🌐 Полный health-check'; }
          if (error.message.toLowerCase().includes('already running')) {
            testStatusPoll('/api/admin/endpoint-health/benchmark/status', 'benchmark-btn', '🌐 Полный health-check', 5000);
          } else alert('Не удалось запустить health-check: ' + error.message);
        });
      }

      function testEscape(value) { var node = document.createElement('div'); node.textContent = value == null ? '' : String(value); return node.innerHTML; }
      function targetLabel(value) {
        var labels = { 'local-server100': 'worker-main', 'lan-server44': 'worker-lan', 'external-wired-mac': 'Mac (wired)', 'external-mac': 'Mac (path unknown)', 'external-wireless-android': 'Android (4G)' };
        return labels[value] || value || 'Неизвестный источник';
      }
      function networkLabel(value) { return { lan: 'LAN', 'external-wired': 'внешняя проводная сеть', 'external-wireless': 'внешняя Wi-Fi сеть', 'external-mobile': 'внешняя мобильная сеть', 'external-unknown': 'внешняя сеть (путь не подтверждён)' }[value] || value || 'сеть не указана'; }
      function profileLabel(value) { return { quick: 'Быстрая проверка', health: 'Health-check', benchmark: 'Полный benchmark' }[value] || value || 'Тест'; }
      function runStatus(status) {
        return { passed: { className: 'ok', label: 'Пройдено' }, degraded: { className: 'warning', label: 'Частично' }, failed: { className: 'error', label: 'Провалено' }, error: { className: 'error', label: 'Ошибка runner' }, running: { className: 'unknown', label: 'Выполняется' } }[status] || { className: 'unknown', label: 'Без статуса' };
      }
      function runSummaryText(run) {
        var summary = run.summary || {};
        var total = Number(summary.total || 0), eligible = Number(summary.eligible || 0), errors = Number(summary.errors || 0);
        if (total) return eligible + ' из ' + total + ' endpoint’ов прошли' + (errors ? ' · ошибок runner: ' + errors : '');
        return run.status === 'running' ? 'События поступают' : 'Сводка не передана';
      }
      function statusPill(status) { return '<span class="state-pill ' + status.className + '"><span class="state-dot"></span>' + testEscape(status.label) + '</span>'; }

      function setHistoryPreset(preset) {
        var from = document.getElementById('history-date-from'), to = document.getElementById('history-date-to');
        if (preset === 'all') { from.value = ''; to.value = ''; }
        else {
          var now = new Date();
          var start = new Date(now);
          if (preset === 'today') start.setHours(0, 0, 0, 0); else start.setDate(start.getDate() - 7);
          var localValue = function(date) { var offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); };
          from.value = localValue(start); to.value = localValue(now);
        }
        loadVpnTestHistory();
      }

      var historyRefreshTimer = null;
      var historyAutoRefreshKey = 'vpn-test-history-auto-refresh';
      function historyAutoRefreshEnabled() {
        var toggle = document.getElementById('history-auto-refresh');
        if (!toggle) return true;
        if (toggle.dataset.initialized !== 'true') {
          try { toggle.checked = localStorage.getItem(historyAutoRefreshKey) !== 'off'; } catch (_) {}
          toggle.dataset.initialized = 'true';
        }
        return toggle.checked;
      }
      function scheduleHistoryRefresh(delayMs) {
        if (historyRefreshTimer) clearTimeout(historyRefreshTimer);
        if (!historyAutoRefreshEnabled()) {
          document.getElementById('history-live-status').textContent = 'Автообновление выключено';
          historyRefreshTimer = null;
          return;
        }
        historyRefreshTimer = setTimeout(function() { loadVpnTestHistory({ silent: true }); }, delayMs);
      }

      function loadVpnTestHistory(options) {
        options = options || {};
        var container = document.getElementById('vpn-test-history-runs');
        if (!container) return;
        if (!options.silent) container.innerHTML = '<div class="test-empty">Загрузка истории…</div>';
        var openRunIds = options.silent ? Array.prototype.map.call(container.querySelectorAll('details[open][data-run-id]'), function(details) { return details.dataset.runId; }) : [];
        var params = new URLSearchParams();
        [['networkClass', 'history-network-class'], ['client', 'history-client'], ['accessMethod', 'history-access-method'], ['wireMethod', 'history-wire-method'], ['target', 'history-target'], ['profile', 'history-profile'], ['endpoint', 'history-endpoint'], ['status', 'history-status']].forEach(function(pair) { var value = document.getElementById(pair[1]).value; if (value) params.set(pair[0], value); });
        [['from', 'history-date-from'], ['to', 'history-date-to']].forEach(function(pair) { var value = document.getElementById(pair[1]).value; if (value) params.set(pair[0], new Date(value).toISOString()); });
        params.set('limit', '100');
        fetch('/api/admin/vpn-tests/runs?' + params.toString(), { credentials: 'include' }).then(function(response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); }).then(function(data) {
          var runs = Array.isArray(data) ? data : (data.runs || []), total = Array.isArray(data) ? runs.length : (data.total || runs.length);
          document.getElementById('history-result-count').firstElementChild.textContent = total + ' запусков найдено';
          container.innerHTML = runs.length ? runs.map(renderVpnTestRun).join('') : '<div class="test-empty">За этот период запусков не найдено.</div>';
          openRunIds.forEach(function(runId) { var details = Array.prototype.find.call(container.querySelectorAll('details[data-run-id]'), function(item) { return item.dataset.runId === runId; }); if (details) { details.open = true; loadVpnTestRunStages(details); } });
          var hasRunning = runs.some(function(run) { return run.status === 'running'; });
          document.getElementById('history-live-status').textContent = historyAutoRefreshEnabled() ? (hasRunning ? 'Онлайн: события поступают' : 'Автообновление каждые 15 с') : 'Автообновление выключено';
          scheduleHistoryRefresh(hasRunning ? 3000 : 15000);
        }).catch(function(error) { document.getElementById('history-result-count').firstElementChild.textContent = 'История недоступна'; document.getElementById('history-live-status').textContent = 'Повтор через 15 с'; if (!options.silent) container.innerHTML = '<div class="test-empty" style="color:var(--error)">Не удалось загрузить историю: ' + testEscape(error.message) + '</div>'; scheduleHistoryRefresh(15000); });
      }

      function vpnTestArtifact(item) {
        var url = item.artifact_url || item.artifactUrl || (item.payload && (item.payload.artifact_url || item.payload.artifactUrl)) || '';
        if (!url) return '';
        try { var parsed = new URL(url, location.origin); if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''; return '<a class="artifact-link" href="' + testEscape(parsed.href) + '" target="_blank" rel="noopener noreferrer">Открыть JSON ↗</a>'; } catch (_) { return ''; }
      }

      function renderVpnTestRun(run) {
        var status = runStatus(run.status);
        var runId = run.run_id || run.runId || '';
        return '<details class="vpn-test-run" data-run-id="' + testEscape(runId) + '" ontoggle="loadVpnTestRunStages(this)"><summary><div class="run-summary"><div><div class="run-topline"><span class="run-profile">' + testEscape(profileLabel(run.profile)) + '</span>' + statusPill(status) + '</div><div class="run-meta">' + testEscape(targetLabel(run.target_id)) + ' · ' + testEscape(networkLabel(run.network_class)) + ' · client=' + testEscape(run.client || '—') + ' · access=' + testEscape(run.access_method || '—') + ' · wire=' + testEscape(run.wire_method || '—') + ' · ' + testEscape(run.engine || 'движок не указан') + ' · ' + testEscape(run.started_at ? new Date(run.started_at).toLocaleString('ru-RU') : 'дата не указана') + '</div><div class="run-id">ID: ' + testEscape(runId) + '</div></div><div class="run-result"><div class="run-summary-text">' + testEscape(runSummaryText(run)) + '</div><span class="run-chevron">⌄</span>' + vpnTestArtifact(run) + '</div></div></summary><div class="vpn-test-stages" data-stage-container><div class="test-empty">Раскройте, чтобы загрузить этапы…</div></div></details>';
      }

      function stageStatus(stage) {
        var payload = stage.payload && typeof stage.payload === 'object' ? stage.payload : {};
        var declared = String(stage.outcome || stage.outcome_class || payload.outcome || payload.severity || '').toLowerCase();
        var code = Number(stage.code ?? stage.http_code ?? payload.code ?? payload.http_code ?? 0);
        var reachable = stage.reachable ?? payload.reachable;
        var contentOk = stage.contentOk ?? stage.content_ok ?? payload.contentOk ?? payload.content_ok;
        if (declared === 'fatal' || declared === 'error' || declared === 'transport' || (reachable === false && !code)) return { className: 'error', label: 'Ошибка транспорта' };
        if (declared === 'warning' || declared === 'degraded' || declared === 'auth' || (reachable === true && contentOk === false) || [401, 403, 407, 429].includes(code)) return { className: 'warning', label: 'Ответ получен, нужен разбор' };
        if (declared === 'ok' || declared === 'success' || declared === 'passed' || contentOk === true || (code >= 200 && code < 400)) return { className: 'ok', label: 'Успешно' };
        return { className: 'unknown', label: 'Событие' };
      }

      function stageLabel(value) { return { run_started: 'Запуск теста', endpoint_started: 'Запуск endpoint', endpoint_finished: 'Endpoint завершён', stage_started: 'Начало этапа', stage_finished: 'Этап проверки' }[value] || value || 'Этап'; }
      function stageSiteLabel(value) { return { telegram: 'Telegram', gstatic: 'Google 204', youtube: 'YouTube', chatgpt: 'ChatGPT', reddit: 'Reddit', wikipedia: 'Wikipedia', vk: 'VK', yandex: 'Yandex', '2ip': '2ip', preflight: 'Подготовка', udp: 'UDP / DNS', quic: 'QUIC', throughput: 'Скорость' }[value] || value || '—'; }

      function eventPayload(event) { return event && event.payload && typeof event.payload === 'object' ? event.payload : {}; }
      function eventEndpoint(event) { return event.endpoint || event.endpoint_id || ''; }

      function renderRunSiteMatrix(stages) {
        var groups = Object.create(null), finished = Object.create(null), order = [];
        (stages || []).forEach(function(stage) {
          var type = stage.event_type || stage.type || '', endpoint = eventEndpoint(stage), payload = eventPayload(stage);
          if (type === 'endpoint_finished' && endpoint) finished[endpoint] = stage;
          if (type !== 'stage_finished' || !endpoint) return;
          var stageName = stage.stage || '';
          if (['preflight', 'udp', 'throughput', 'quic'].includes(stageName)) return;
          if (!groups[endpoint]) { groups[endpoint] = []; order.push(endpoint); }
          groups[endpoint].push(stage);
        });
        Object.keys(finished).forEach(function(endpoint) { if (!groups[endpoint]) { groups[endpoint] = []; order.push(endpoint); } });
        if (!order.length) return '<div class="test-empty">Сайты ещё не проверялись.</div>';
        return '<div class="site-result-matrix"><h4>Результаты сайтов по endpoint</h4>' + order.map(function(endpoint) {
          var events = groups[endpoint], finishPayload = finished[endpoint] ? eventPayload(finished[endpoint]) : {};
          var passed = events.filter(function(stage) { return stageStatus(stage).className === 'ok'; }).length;
          var finishStatus = finishPayload.eligible === true ? { className: 'ok', label: 'Endpoint прошёл' } : { className: 'error', label: 'Endpoint не прошёл' };
          var finishError = finishPayload.error ? '<div class="site-result-error">' + testEscape(finishPayload.error) + '</div>' : '';
          var rows = events.length ? events.map(function(stage) {
            var payload = eventPayload(stage), stageName = stage.stage || '', status = stageStatus(stage);
            var code = stage.code ?? stage.http_code ?? payload.code ?? payload.http_code;
            var latency = stage.latency_ms ?? stage.latencyMs ?? payload.latency_ms ?? payload.latencyMs;
            var message = stage.message || payload.message || payload.error || '';
            var metric = code ? 'HTTP ' + code : (latency != null ? latency + ' ms' : '—');
            return '<tr><td><strong>' + testEscape(stageSiteLabel(stageName)) + '</strong><div class="endpoint-id">' + testEscape(stageName) + '</div></td><td>' + statusPill(status) + '</td><td>' + testEscape(metric) + '</td><td>' + testEscape(message || '—') + '</td></tr>';
          }).join('') : '<tr><td colspan="4">Сайты не успели отработать.</td></tr>';
          return '<div class="site-result-endpoint"><div class="site-result-endpoint-header"><strong>' + testEscape(endpoint) + '</strong>' + statusPill(finishStatus) + '</div><div class="run-site-summary">' + passed + ' из ' + events.length + ' сайтов успешно' + finishError + '</div><div class="table-scroll"><table class="site-result-table"><thead><tr><th>Сайт</th><th>Результат</th><th>Задержка / код</th><th>Ошибка</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
        }).join('') + '</div>';
      }

      function loadVpnTestRunStages(details) {
        if (!details.open || details.dataset.loaded === 'true') return;
        var container = details.querySelector('[data-stage-container]'), runId = details.dataset.runId;
        if (!container || !runId) return;
        details.dataset.loaded = 'true'; container.innerHTML = '<div class="test-empty">Загрузка этапов…</div>';
        fetch('/api/admin/vpn-tests/runs/' + encodeURIComponent(runId), { credentials: 'include' }).then(function(response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); }).then(function(data) { container.innerHTML = renderVpnTestStages(data.events || []); }).catch(function(error) { details.dataset.loaded = 'false'; container.innerHTML = '<div class="test-empty" style="color:var(--error)">Не удалось загрузить этапы: ' + testEscape(error.message) + '</div>'; });
      }

      function renderVpnTestStages(stages) {
        return renderRunSiteMatrix(stages);
      }

      function detailStage(stages, stageId) { return (stages || []).find(function(stage) { return stage.stageId === stageId; }) || null; }
      function formatMetric(metric, unit) {
        if (!metric || !metric.total) return '—';
        var mean = metric.meanMs != null ? metric.meanMs : metric.meanMbps;
        var median = metric.medianMs != null ? metric.medianMs : metric.medianMbps;
        var p95 = metric.p95Ms != null ? metric.p95Ms : metric.p95Mbps;
        return 'mean ' + (mean == null ? '—' : mean) + ' / median ' + (median == null ? '—' : median) + ' / p95 ' + (p95 == null ? '—' : p95) + ' ' + unit;
      }
      function formatStagePass(metric) { return metric && metric.total ? metric.passed + '/' + metric.total + ' прошло' : '—'; }
      function endpointScoreText(score) { return score == null || !Number.isFinite(Number(score)) ? '—' : Number(score).toFixed(1) + '%'; }
      function renderEndpointSiteChips(stages) {
        var ignored = ['preflight', 'telegram', 'gstatic', 'udp', 'throughput', 'quic'];
        var sites = (stages || []).filter(function(stage) { return !ignored.includes(stage.stageId); });
        if (!sites.length) return '<span class="endpoint-id">Нет отдельных site-этапов</span>';
        return '<div class="endpoint-site-grid">' + sites.map(function(site) {
          var rate = site.total && site.passed === site.total ? 'ok' : (site.passed ? 'warning' : 'error');
          var latency = site.meanMs == null ? '—' : site.meanMs + '/' + (site.p95Ms == null ? '—' : site.p95Ms) + ' ms';
          return '<span class="endpoint-site-chip ' + rate + '"><span class="site-name">' + testEscape(stageSiteLabel(site.stageId)) + '</span><span class="site-metric">' + formatStagePass(site) + ' · ' + latency + '</span></span>';
        }).join('') + '</div>';
      }
      function renderEndpointMatrixRow(row) {
        var stages = row.stages || [], telegram = detailStage(stages, 'telegram'), throughput = detailStage(stages, 'throughput');
        var dimensions = '<div class="matrix-dimension"><strong>' + testEscape(row.targetId) + '</strong><br>' + testEscape(row.networkClass) + ' · ' + testEscape(row.hostRole) + '</div>';
        var client = '<div class="matrix-dimension"><strong>' + testEscape(row.client) + '</strong><br>' + testEscape(row.accessMethod) + ' · ' + testEscape(row.wireMethod) + '</div>';
        var telegramText = '<div class="matrix-metric">' + formatStagePass(telegram) + '<div class="metric-sub">' + formatMetric(telegram, 'ms') + '</div></div>';
        var speedText = '<div class="matrix-metric">' + (throughput && throughput.total ? throughput.total + ' замеров' : '—') + '<div class="metric-sub">' + formatMetric(throughput, 'Mbps') + '</div></div>';
        return '<tr><td>' + dimensions + '</td><td>' + client + '</td><td><strong>' + endpointScoreText(row.score) + '</strong><div class="metric-sub">' + row.passed + '/' + row.effectiveObservations + ' · ' + row.runnerErrors + ' runner</div></td><td>' + telegramText + '</td><td>' + speedText + '</td><td>' + renderEndpointSiteChips(stages) + '</td></tr>';
      }
      function renderEndpointDetail(data) {
        var summary = data.summary || {}, telegram = detailStage(summary.stages, 'telegram'), throughput = detailStage(summary.stages, 'throughput');
        var matrix = data.matrix || [];
        var rows = matrix.length ? matrix.map(renderEndpointMatrixRow).join('') : '<tr><td colspan="6">За последние ' + testEscape(data.windowDays || 3) + ' дня матрица не набрала данных.</td></tr>';
        return '<div class="endpoint-detail-toolbar"><div><div class="eyebrow">Агрегированная статистика</div><div class="endpoint-detail-title">' + testEscape(data.endpointId || 'Endpoint') + '</div><div class="endpoint-detail-subtitle">Последние ' + testEscape(data.windowDays || 3) + ' дня · runner-ошибки показаны отдельно</div></div><button class="btn btn-quiet btn-sm" type="button" onclick="closeEndpointDetail()">Закрыть</button></div><div class="endpoint-detail-summary"><div class="endpoint-detail-metric"><div class="summary-label">Score</div><div class="summary-value success-text">' + endpointScoreText(summary.score) + '</div></div><div class="endpoint-detail-metric"><div class="summary-label">Проверки</div><div class="summary-value">' + summary.passed + '/' + summary.effectiveObservations + '</div><div class="metric-sub">' + summary.runnerErrors + ' runner · ' + summary.endpointFailures + ' endpoint</div></div><div class="endpoint-detail-metric"><div class="summary-label">Telegram</div><div class="summary-value">' + formatStagePass(telegram) + '</div><div class="metric-sub">' + formatMetric(telegram, 'ms') + '</div></div><div class="endpoint-detail-metric"><div class="summary-label">Скорость</div><div class="summary-value">' + (throughput && throughput.total ? throughput.total + ' замеров' : '—') + '</div><div class="metric-sub">' + formatMetric(throughput, 'Mbps') + '</div></div><div class="endpoint-detail-metric"><div class="summary-label">Матрица</div><div class="summary-value">' + matrix.length + '</div><div class="metric-sub">сочетаний условий</div></div></div><div class="table-scroll"><table class="endpoint-detail-table"><thead><tr><th>Источник / сеть</th><th>Client / доступ</th><th>Score</th><th>Telegram</th><th>Speed</th><th>Сайты</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }
      function openEndpointDetail(endpointId) {
        var card = document.getElementById('endpoint-detail-card');
        if (!card || !endpointId) return;
        card.hidden = false; card.innerHTML = '<div class="test-empty">Загрузка агрегированной статистики endpoint…</div>'; card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        fetch('/api/admin/vpn-tests/endpoints/' + encodeURIComponent(endpointId) + '/summary?days=3', { credentials: 'include' }).then(function(response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); }).then(function(data) { card.innerHTML = renderEndpointDetail(data); }).catch(function(error) { card.innerHTML = '<div class="endpoint-detail-toolbar"><strong>Не удалось загрузить endpoint</strong><button class="btn btn-quiet btn-sm" type="button" onclick="closeEndpointDetail()">Закрыть</button></div><div class="site-result-error">' + testEscape(error.message) + '</div>'; });
      }
      function closeEndpointDetail() { var card = document.getElementById('endpoint-detail-card'); if (card) { card.hidden = true; card.innerHTML = ''; } }

      function runProbe() {
        var button = document.getElementById('run-probe-btn'), logs = document.getElementById('probe-logs');
        if (button) { button.disabled = true; button.textContent = 'Запускаю…'; }
        logs.hidden = false; logs.textContent = '';
        document.getElementById('probe-status').textContent = 'Подготовка probe…';
        var node = document.getElementById('probe-node').value, engine = document.getElementById('probe-engine').value;
        fetch('/api/admin/probe/run?node=' + encodeURIComponent(node) + '&engine=' + encodeURIComponent(engine), { method: 'POST', credentials: 'include' }).then(function(response) { return response.json(); }).then(function(data) {
          if (data.error) throw new Error(data.error);
          document.getElementById('probe-status').textContent = 'Probe выполняется. Логи появляются ниже.'; streamProbeLogs(); pollProbe();
        }).catch(function(error) { if (button) { button.disabled = false; button.textContent = '🔎 Запустить probe'; } logs.hidden = true; alert('Не удалось запустить probe: ' + error.message); });
      }
      function streamProbeLogs() {
        var logs = document.getElementById('probe-logs'), source = new EventSource('/api/admin/probe/logs');
        source.onmessage = function(event) { try { var data = JSON.parse(event.data); if (data.type === 'init' || data.type === 'logs') { (data.logs || []).forEach(function(line) { var row = document.createElement('div'); row.textContent = line; logs.appendChild(row); }); logs.scrollTop = logs.scrollHeight; } if (data.type === 'done') source.close(); } catch (_) {} };
        source.onerror = function() { source.close(); };
      }
      function pollProbe() {
        fetch('/api/admin/probe/status', { credentials: 'include' }).then(function(response) { return response.json(); }).then(function(data) { if (data.status === 'running') setTimeout(pollProbe, 3000); else { var button = document.getElementById('run-probe-btn'); if (button) { button.disabled = false; button.textContent = '🔎 Запустить probe'; } document.getElementById('probe-status').textContent = 'Probe завершён.'; loadProbeResults(); } }).catch(function() { setTimeout(pollProbe, 3000); });
      }
      function loadProbeResults() {
        fetch('/api/admin/probe/results?limit=10', { credentials: 'include' }).then(function(response) { return response.json(); }).then(function(data) { var container = document.getElementById('all-probe-results'); container.innerHTML = data.results && data.results.length ? data.results.map(renderProbeResult).join('') : '<div class="test-empty">Результатов probe пока нет.</div>'; }).catch(function(error) { document.getElementById('all-probe-results').innerHTML = '<div class="test-empty" style="color:var(--error)">Не удалось загрузить probe: ' + testEscape(error.message) + '</div>'; });
      }
      function renderProbeResult(result) {
        var endpoints = result.endpoints || [];
        var rows = endpoints.map(function(endpoint) { var sites = endpoint.sites || [], passed = sites.filter(function(site) { return Number(site.http_code || 0) >= 200 && Number(site.http_code || 0) < 400; }).length; return '<tr><td><strong>' + testEscape(endpoint.id || endpoint.endpoint || '—') + '</strong></td><td class="' + (endpoint.tcp_reachable ? 'probe-ok' : 'probe-fail') + '">' + (endpoint.tcp_reachable ? 'TCP OK' : 'TCP ошибка') + '</td><td class="' + (endpoint.tunnel_up ? 'probe-ok' : 'probe-fail') + '">' + (endpoint.tunnel_up ? 'Туннель OK' : 'Туннель ошибка') + '</td><td>' + testEscape(endpoint.exit_ip || '—') + '</td><td>' + passed + ' из ' + sites.length + ' сайтов</td><td>' + testEscape(endpoint.speed_mbps ? endpoint.speed_mbps + ' Mbps' : '—') + '</td></tr>'; }).join('');
        return '<div class="probe-result-card"><div class="probe-result-header"><span class="probe-result-meta">' + testEscape(result.timestamp ? new Date(result.timestamp).toLocaleString('ru-RU') : 'Дата не указана') + ' · ' + testEscape(result.node || 'узел не указан') + ' · ' + testEscape(result.engine || 'движок не указан') + '</span><span class="probe-result-file">' + testEscape(result._filename || '') + '</span></div><div class="table-scroll"><table class="probe-result-table"><thead><tr><th>Endpoint</th><th>TCP</th><th>Туннель</th><th>Exit IP</th><th>Сайты</th><th>Скорость</th></tr></thead><tbody>' + (rows || '<tr><td colspan="6">Нет endpoint’ов</td></tr>') + '</tbody></table></div></div>';
      }
      function testToast(message) { var toast = document.createElement('div'); toast.textContent = message; toast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--bg-elevated);border:1px solid var(--border);padding:12px 18px;border-radius:8px;font-size:13px;z-index:10000;box-shadow:var(--shadow)'; document.body.appendChild(toast); setTimeout(function() { toast.remove(); }, 3000); }

      (function setupHistoryAutoRefresh() {
        var toggle = document.getElementById('history-auto-refresh');
        if (!toggle) return;
        historyAutoRefreshEnabled();
        toggle.addEventListener('change', function() {
          try { localStorage.setItem(historyAutoRefreshKey, toggle.checked ? 'on' : 'off'); } catch (_) {}
          if (toggle.checked) {
            document.getElementById('history-live-status').textContent = 'Обновляю…';
            loadVpnTestHistory({ silent: true });
          } else {
            if (historyRefreshTimer) clearTimeout(historyRefreshTimer);
            historyRefreshTimer = null;
            document.getElementById('history-live-status').textContent = 'Автообновление выключено';
          }
        });
      })();
      loadVpnTestHistory();
      loadProbeResults();
    </script>`,
  );
}

/** Render the single admin workspace for current endpoint state and test history. */
export function testDashboardPage(input: TestDashboardInput): string {
  return renderTestDashboard(input);
}
