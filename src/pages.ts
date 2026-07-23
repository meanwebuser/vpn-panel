import { escapeHtml, page, sidebarHtml } from "./html.js";
import type { UserSummary, EndpointHealth, HappInstallRecord, HappHwidRecord, SmartDnsClient } from "./repository.js";
import type { LinkSlot } from "./subscriptions.js";
import { happDeeplink, subscriptionUrl } from "./subscriptions.js";
import { macosInstallerCommand } from "./macos-installer.js";
import { happInstallDeeplink } from "./happ-api.js";
import type { Endpoint } from "./types.js";
import type { SecureConfig } from "./secure-config.js";
import { isUserFacingEndpoint } from "./secure-config.js";
import type { VpsSystemStats, XrayUserTraffic, XrayInboundTraffic } from "./vps-ssh.js";
import type { SmartDnsPolicy, SmartDnsRouteCheck } from "./smart-dns-policy.js";
import type { SmartEdgeConfig, SmartEdgeTarget } from "./smart-edge-config.js";
import type { RestrictedServiceDefinition, RestrictedServiceProbeResult, RestrictedServicesView } from "./restricted-services.js";
import type { ServiceCatalog, ServiceTargetCapability } from "./service-catalog.js";
import type { VpnTestEndpointScore } from "./vpn-test-telemetry.js";
import { serviceCatalogEditor } from "./service-catalog-ui.js";
import { testDashboardPage, type TestHttpCheck, type TestTarget } from "./test-dashboard.js";

function qrModal(): string {
  return '<div id="qr-overlay" class="modal-overlay" onclick="closeQr()"><div class="modal-box" onclick="event.stopPropagation()"><img id="qr-img" width="320" height="320" alt="QR"><button class="btn btn-secondary" onclick="closeQr()" style="margin-top:12px">Close</button></div></div>';
}

function flagForEndpoint(id: string): string {
  if (id.startsWith("de-") || id.includes("-de-")) return "\u{1F1E9}\u{1F1EA}";
  if (id.startsWith("us-") || id.includes("-us-")) return "\u{1F1FA}\u{1F1F8}";
  if (id.startsWith("ru-")) return "\u{1F1F7}\u{1F1FA}";
  if (id.startsWith("nl-")) return "\u{1F1F3}\u{1F1F1}";
  return "";
}

function formatLatency(ms: number | null): string {
  if (ms === null) return "\u2014";
  if (ms < 100) return `${ms}ms`;
  if (ms < 300) return `${ms}ms`;
  return `${ms}ms`;
}

function latencyClass(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 100) return "green";
  if (ms < 300) return "blue";
  return "red";
}

function formatSpeed(mbps: number | null): string {
  if (mbps === null) return "\u2014";
  return `${mbps} Mbps`;
}

function formatTimeAgo(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  } catch {
    return "";
  }
}

export function loginPage(kind: "admin" | "user", error = ""): string {
  const title = kind === "admin" ? "BezVPN Admin" : "BezVPN";
  const subtitle = kind === "admin" ? "Administrative access" : "VPN access";
  const action = kind === "admin" ? "/api/admin/login" : "/api/user/login";
  return page(
    title,
    `<div class="login-wrapper">
      <div class="login-card">
        <h1>${escapeHtml(title)}</h1>
        <p class="login-sub">${escapeHtml(subtitle)}</p>
        ${error ? `<div class="tag tag-error" style="margin-bottom:16px;justify-content:center">${escapeHtml(error)}</div>` : ""}
        <form method="post" action="${action}">
          <div class="form-group">
            <label>Login</label>
            <input class="input" name="login" autocomplete="username" required placeholder="Enter login">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input class="input" name="password" type="password" autocomplete="current-password" required placeholder="Enter password">
          </div>
          <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center;margin-top:4px">Sign in</button>
        </form>
      </div>
    </div>`,
  );
}

function endpointCheckboxes(endpoints: Endpoint[], selected: string[] = [], health: EndpointHealth[] = []): string {
  const healthMap = new Map(health.map((h) => [h.endpoint_id, h]));
  const renderEndpoints = (items: Endpoint[]): string => items
    .map((endpoint) => {
      const checked = selected.includes(endpoint.id) ? "checked" : "";
      const status = endpoint.enabled ? "tag-success" : "tag-error";
      const statusText = endpoint.enabled ? "ON" : "OFF";
      const flag = flagForEndpoint(endpoint.id);
      const h = healthMap.get(endpoint.id);
      const isAlive = h ? h.pass_count > 0 && h.pass_count >= h.fail_count : null;
      const healthClass = isAlive === null ? "tag-neutral" : isAlive ? "tag-success" : "tag-error";
      const healthText = isAlive === null ? "no check" : isAlive ? "works" : "fails";
      const pingText = h ? formatLatency(h.latency_ms) : "—";
      const passText = h ? `${h.pass_count}/${h.pass_count + h.fail_count}` : "—";
      const siteTags = h?.sites?.length
        ? h.sites.slice(0, 4).map((site) => `<span class="health-site ${site.ok ? "ok" : "fail"}" title="${escapeHtml(site.code || "")}${site.ms ? ` · ${site.ms}ms` : ""}">${escapeHtml(site.label)}</span>`).join("")
        : `<span class="health-site fail">no sites</span>`;
      const checkedText = h ? formatTimeAgo(h.checked_at) : "never";
      return `<div class="endpoint-check" style="align-items:flex-start">
        <input type="checkbox" name="endpointIds" value="${escapeHtml(endpoint.id)}" ${checked} id="ep-${escapeHtml(endpoint.id)}" style="margin-top:8px">
        <label for="ep-${escapeHtml(endpoint.id)}" style="flex:1;display:block;cursor:pointer;margin:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span>${flag} ${escapeHtml(endpoint.label)}</span>
            <span class="tag ${status}">${statusText}</span>
            <span class="tag tag-neutral">${escapeHtml(endpoint.kind)}</span>
            <span class="tag ${healthClass}">${healthText}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px;font-size:11px;color:var(--text-muted)">
            <span>ping <strong class="${h ? latencyClass(h.latency_ms) : ""}">${escapeHtml(pingText)}</strong></span>
            <span>pass <strong>${escapeHtml(passText)}</strong></span>
            <span>checked ${escapeHtml(checkedText)}</span>
            ${siteTags}
          </div>
        </label>
      </div>`;
    })
    .join("");
  const products = endpoints.filter((endpoint) => isUserFacingEndpoint(endpoint.id));
  const diagnostics = endpoints.filter((endpoint) => !isUserFacingEndpoint(endpoint.id));
  const productHtml = renderEndpoints(products);
  const diagnosticHtml = diagnostics.length
    ? `<details style="margin-top:10px"><summary style="cursor:pointer;color:var(--text-muted)">Diagnostic transports (${diagnostics.length})</summary><div style="margin-top:8px">${renderEndpoints(diagnostics)}</div><p style="font-size:11px;color:var(--text-muted);margin:6px 0 0">Low-level routes for health checks only. Deprecated gRPC/HTTPUpgrade and duplicate WS paths are not user products.</p></details>`
    : "";
  return productHtml + diagnosticHtml;
}

function renderHealthGrid(endpoints: Endpoint[], health: EndpointHealth[]): string {
  const healthMap = new Map(health.map((h) => [h.endpoint_id, h]));
  const cards = endpoints
    .map((ep) => {
      const h = healthMap.get(ep.id);
      const flag = flagForEndpoint(ep.id);
      const isAlive = h ? h.pass_count > 0 && h.pass_count >= h.fail_count : null;
      const dotClass = isAlive === null ? "unknown" : isAlive ? "alive" : "dead";

      let metricsHtml = "";
      if (h) {
        const latClass = latencyClass(h.latency_ms);
        metricsHtml = `<div class="health-metrics">
          <div class="health-metric">Ping: <span class="value ${latClass}">${formatLatency(h.latency_ms)}</span></div>
          <div class="health-metric">Speed: <span class="value">${formatSpeed(h.speed_mbps)}</span></div>
          <div class="health-metric">Pass: <span class="value">${h.pass_count}/${h.pass_count + h.fail_count}</span></div>
        </div>`;
      } else {
        metricsHtml = `<div class="health-metrics"><span style="color:var(--text-muted)">No health data</span></div>`;
      }

      let sitesHtml = "";
      if (h && h.sites && h.sites.length > 0) {
        const siteTags = h.sites
          .map((s) => `<span class="health-site ${s.ok ? "ok" : "fail"}">${escapeHtml(s.label)}</span>`)
          .join("");
        sitesHtml = `<div class="health-sites">${siteTags}</div>`;
      }

      const epStatus = ep.enabled ? "tag-success" : "tag-error";
      const epStatusText = ep.enabled ? "ENABLED" : "DISABLED";

      return `<div class="health-card">
        <div class="health-card-header">
          <span class="health-card-title">
            <span class="health-status-dot ${dotClass}"></span>
            ${flag} ${escapeHtml(ep.label)}
          </span>
          <span class="tag ${epStatus}">${epStatusText}</span>
        </div>
        ${metricsHtml}
        ${sitesHtml}
        ${h ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">Checked ${formatTimeAgo(h.checked_at)}</div>` : ""}
      </div>`;
    })
    .join("");

  return `<div class="health-grid">${cards}</div>`;
}

function renderHappSettings(settings: Record<string, unknown>): string {
  const happSettingsOptions = [
    { key: "subscription-auto-update-enable", label: "Auto-update subscriptions", type: "bool" },
    { key: "subscription-autoconnect", label: "Auto-connect on subscription load", type: "bool" },
    { key: "subscription-autoconnect-type", label: "Auto-connect type", type: "select", options: ["lastused", "lowestdelay"] },
    { key: "subscription-ping-onopen-enabled", label: "Ping on open", type: "bool" },
    { key: "subscription-always-hwid-enable", label: "Always send HWID", type: "bool" },
    { key: "subscription-auto-update-open-enable", label: "Auto-update on open", type: "bool" },
    { key: "local-dns-enable", label: "Local DNS", type: "bool" },
    { key: "fragmentation-enable", label: "Fragmentation", type: "bool" },
    { key: "fragmentation-type", label: "Fragmentation type", type: "select", options: ["xray", "advanced"] },
    { key: "fragmentation-packets", label: "Fragmentation packets", type: "select", options: ["tlshello", "1-3"] },
    { key: "ping-type", label: "Ping type", type: "select", options: ["proxy", "tcp", "icmp"] },
    { key: "app-auto-start", label: "App auto-start", type: "bool" },
    { key: "notification-subs-expire", label: "Subscription expiry notification", type: "bool" },
    { key: "server-address-resolve-enable", label: "Server address resolve", type: "bool" },
    { key: "per-app-proxy-mode", label: "Per-app proxy mode", type: "select", options: ["off", "on", "bypass"] },
  ];

  return happSettingsOptions
    .map((opt) => {
      const currentValue = settings[opt.key];
      const safeKey = escapeHtml(opt.key);
      if (opt.type === "bool") {
        const isOn = currentValue === true || currentValue === "true";
        return `<div class="happ-setting-row">
          <label for="happ-${safeKey}" style="margin:0;font-size:13px;color:var(--text);cursor:pointer;flex:1">${escapeHtml(opt.label)}</label>
          <input type="hidden" name="happ_${safeKey}" value="${isOn ? "true" : "false"}">
          <label class="switch"><input type="checkbox" ${isOn ? "checked" : ""} onchange="this.parentElement.previousElementSibling.value=this.checked?'true':'false'"><span class="switch-slider"></span></label>
        </div>`;
      }
      if (opt.type === "select") {
        const optionsHtml = opt.options!
          .map((o) => `<option value="${escapeHtml(o)}" ${currentValue === o ? "selected" : ""}>${escapeHtml(o)}</option>`)
          .join("");
        return `<div class="happ-setting-row">
          <label style="margin:0;font-size:13px;color:var(--text);flex:1">${escapeHtml(opt.label)}</label>
          <select name="happ_${safeKey}" class="happ-select">${optionsHtml}</select>
        </div>`;
      }
      return `<div class="happ-setting-row">
        <label style="margin:0;font-size:13px;color:var(--text);flex:1">${escapeHtml(opt.label)}</label>
        <input class="input happ-input" name="happ_${safeKey}" value="${escapeHtml(String(currentValue ?? ""))}">
      </div>`;
    })
    .join("");
}

export function adminPage(input: {
  users: UserSummary[];
  endpoints: Endpoint[];
  health: EndpointHealth[];
  baseUrl: string;
  totalDevices: number;
}): string {
  const enabledCount = input.endpoints.filter((e) => e.enabled).length;
  const totalEndpoints = input.endpoints.length;
  const activeUsers = input.users.filter((u) => u.enabled && u.client_enabled).length;
  const totalUsers = input.users.length;
  const happLinkedUsers = input.users.filter((u) => u.happ_status !== null).length;

  const usersHtml = input.users
    .map((user) => {
      const isActive = user.enabled && user.client_enabled;
      const initials = user.display_name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
      const subUrl = user.token ? subscriptionUrl(input.baseUrl, user.token) : "";
      const macCommand = user.token ? macosInstallerCommand(input.baseUrl, user.token) : "";
      const smartDnsTag = user.smart_dns_client_id
        ? `<span class="tag ${user.smart_dns_enabled ? "tag-info" : "tag-error"}" title="${escapeHtml(user.smart_dns_client_id)}">DNS ${user.smart_dns_enabled ? "on" : "off"}</span>`
        : "";

      // Device indicator
      const deviceTag = user.happ_status !== null
        ? (user.device_count > 0
          ? `<span class="tag tag-info">${user.device_count} device${user.device_count !== 1 ? "s" : ""}</span>`
          : `<span class="tag tag-warning">0 devices</span>`)
        : "";

      // Happ status indicator
      const happTag = user.happ_status !== null
        ? `<span class="tag ${user.happ_status === 10 ? "tag-success" : "tag-error"}" style="font-size:10px">Happ</span>`
        : "";

      return `<div class="user-row">
        <div class="user-info">
          <div class="user-avatar">${escapeHtml(initials)}</div>
          <div>
            <div class="user-name">${escapeHtml(user.display_name)}</div>
            <div class="user-login">@${escapeHtml(user.login)}</div>
          </div>
        </div>
        <div class="user-meta">
          <span class="tag ${isActive ? "tag-success" : "tag-error"}">${isActive ? "Active" : "Disabled"}</span>
          ${happTag}
          ${smartDnsTag}
          ${deviceTag}
          ${user.profiles.filter(isUserFacingEndpoint).map((p) => `<span class="tag tag-neutral">${flagForEndpoint(p)} ${escapeHtml(p)}</span>`).join("")}
        </div>
        <div class="user-actions">
          <a class="btn btn-secondary btn-sm" href="/admin/users/${escapeHtml(user.account_id)}">Edit</a>
          ${subUrl ? `<button class="btn btn-ghost btn-sm" onclick="copyText('${escapeHtml(subUrl)}')">Sub</button>` : ""}
          ${macCommand ? `<button class="btn btn-ghost btn-sm" onclick="copyText('${escapeHtml(macCommand)}')">Mac</button>` : ""}
          ${user.token ? `<button class="btn btn-ghost btn-sm" onclick="openQr('${escapeHtml(user.token)}')">QR</button>` : ""}
        </div>
      </div>`;
    })
    .join("");

  return page(
    "VPN Admin",
    `${sidebarHtml('/admin')}
    <div class="main-content">
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">Users</div>
        <div class="stat-value green">${activeUsers}<span style="font-size:14px;color:var(--text-muted);font-weight:400">/${totalUsers}</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Endpoints</div>
        <div class="stat-value blue">${enabledCount}<span style="font-size:14px;color:var(--text-muted);font-weight:400">/${totalEndpoints}</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Health</div>
        <div class="stat-value purple">${input.health.filter((h) => h.fail_count === 0 && h.pass_count > 0).length}<span style="font-size:14px;color:var(--text-muted);font-weight:400"> healthy</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Devices</div>
        <div class="stat-value ${input.totalDevices > 0 ? "blue" : ""}">${input.totalDevices}<span style="font-size:14px;color:var(--text-muted);font-weight:400"> / ${happLinkedUsers} linked</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Last check</div>
        <div class="stat-value" style="font-size:16px">${input.health.length > 0 ? formatTimeAgo(input.health[0].checked_at) : "Never"}</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h3>Центр тестирования</h3><p style="color:var(--text-muted);font-size:12px;margin-top:3px">Текущее состояние endpoint’ов, запуск проверок, probe и история теперь собраны на одной странице.</p></div>
        <a class="btn btn-primary btn-sm" href="/admin/tests">Открыть центр тестирования →</a>
      </div>
    </div>

    <div class="card" id="admin-legacy-health" style="display:none">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <h3>Endpoint Health</h3>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" id="check-health-btn" onclick="checkEndpointHealth()">Quick Check</button>
          <button class="btn btn-primary btn-sm" id="run-bench-btn" onclick="runBenchmark()">Run Benchmark</button>
        </div>
      </div>
      ${renderHealthGrid(input.endpoints, input.health)}
    </div>

    <div class="card" id="admin-legacy-probe" style="display:none">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h3>Probe Results</h3>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <select id="probe-node" class="input" style="width:auto;padding:4px 8px;font-size:12px">
            <option value="worker-main">worker-main</option>
            <option value="mac">mac</option>
            <option value="worker-lan">worker-lan</option>
            <option value="worker-dev">worker-dev</option>
            <option value="auto">auto (all nodes)</option>
          </select>
          <select id="probe-engine" class="input" style="width:auto;padding:4px 8px;font-size:12px">
            <option value="xray">xray</option>
            <option value="singbox">singbox</option>
            <option value="both">both</option>
          </select>
          <button class="btn btn-primary btn-sm" id="run-probe-btn" onclick="runProbe()">Run Probe</button>
        </div>
      </div>
      <div id="probe-status" style="font-size:12px;color:var(--text-muted);margin-bottom:8px"></div>
      <div id="probe-logs" style="display:none;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:12px;max-height:400px;overflow-y:auto;font-family:monospace;font-size:11px;line-height:1.5;color:var(--text-secondary)"></div>
      <div id="probe-results-container">
        <div style="color:var(--text-muted);font-size:13px;padding:8px 0">Loading probe results...</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>Users (${totalUsers})</h3>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="bulkGrant('all')">All → all users</button>
          <button class="btn btn-secondary btn-sm" onclick="bulkGrant('working')">Working → all users</button>
          <button class="btn btn-ghost btn-sm" onclick="syncAllHwids()">Sync all HWIDs</button>
          <button class="btn btn-primary btn-sm" onclick="toggleCollapse('create-user')">+ New user</button>
        </div>
      </div>
      <div id="create-user-trigger" class="collapse-trigger" onclick="toggleCollapse('create-user')" style="display:none">
        <span class="arrow">\u25B6</span>
      </div>
      <div id="create-user-body" class="collapse-body" style="margin-bottom:16px">
        <div class="card" style="border:1px dashed var(--border);background:var(--bg-elevated)">
          <form method="post" action="/api/admin/users" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label>Display name</label>
              <input class="input" name="displayName" required placeholder="John Doe">
            </div>
            <div class="form-group">
              <label>Login</label>
              <input class="input" name="login" required placeholder="johndoe">
            </div>
            <div class="form-group">
              <label>Password</label>
              <input class="input" name="password" required placeholder="Secure password">
            </div>
            <div class="form-group">
              <label>Xray UUID</label>
              <input class="input" name="xrayUuid" placeholder="Auto-generate if empty">
            </div>
            <div style="grid-column:span 2">
              <label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:8px">Endpoints</label>
              ${endpointCheckboxes(input.endpoints, input.endpoints.map((e) => e.id))}
            </div>
            <div style="grid-column:span 2;display:flex;gap:8px">
              <button class="btn btn-primary" type="submit">Create user</button>
              <button class="btn btn-ghost" type="button" onclick="toggleCollapse('create-user')">Cancel</button>
            </div>
          </form>
        </div>
      </div>
      <div class="users-list">
        ${usersHtml || '<div style="padding:20px;text-align:center;color:var(--text-muted)">No users yet</div>'}
      </div>
    </div>

    ${qrModal()}

    <script>
    function syncAllHwids() {
      if (!confirm('Sync HWIDs from Happ for all users? This may take a moment.')) return;
      postJson('/api/admin/happ/sync-all-hwids', {}).then(r => {
        showToast('Synced ' + r.synced + ' HWIDs from ' + r.total_installs + ' installs' + (r.errors > 0 ? ' (' + r.errors + ' errors)' : ''));
        setTimeout(() => location.reload(), 1500);
      }).catch(e => alert('Error: ' + e.message));
    }
    function bulkGrant(scope) {
      const msg = scope === 'all'
        ? 'Grant ALL endpoints to ALL users? This overrides the working-set filter.'
        : 'Grant only WORKING endpoints to non-privileged users (Dasha+Nikita get all)?';
      if (!confirm(msg)) return;
      postJson('/api/admin/clients/grant-' + scope, {}).then(r => {
        showToast('Granted ' + r.granted + ' profile rows across ' + r.users + ' users');
        setTimeout(() => location.reload(), 1200);
      }).catch(e => alert('Error: ' + e.message));
    }
    function checkEndpointHealth() {
      const btn = document.getElementById('check-health-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }
      postJson('/api/admin/endpoint-health/check', {}).then(r => {
        showToast('Quick check started — testing Telegram via all endpoints (~30s)');
        pollQuickCheckStatus();
      }).catch(e => {
        if (e.message && e.message.includes('already running')) {
          showToast('Quick check already running...');
          pollQuickCheckStatus();
        } else {
          if (btn) { btn.disabled = false; btn.textContent = 'Quick Check'; }
          alert('Error: ' + e.message);
        }
      });
    }
    function pollQuickCheckStatus() {
      const btn = document.getElementById('check-health-btn');
      const startTime = Date.now();
      const poll = () => {
        fetch('/api/admin/endpoint-health/check/status', { headers: { 'Accept': 'application/json' } })
          .then(r => r.json())
          .then(data => {
            if (!data.running) {
              showToast('Quick check complete!');
              setTimeout(() => location.reload(), 1000);
            } else {
              const elapsed = Math.floor((Date.now() - startTime) / 1000);
              if (btn) { btn.textContent = 'Checking (' + elapsed + 's)...'; }
              setTimeout(poll, 3000);
            }
          })
          .catch(() => setTimeout(poll, 3000));
      };
      setTimeout(poll, 3000);
    }
    function runBenchmark() {
      const btn = document.getElementById('run-bench-btn');
      if (!confirm('Run full benchmark on VPS? This takes 2-5 minutes and tests all endpoints through Xray.')) return;
      if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }
      postJson('/api/admin/endpoint-health/benchmark', {}).then(r => {
        if (btn) { btn.textContent = 'Running...'; }
        showToast('Benchmark started on VPS — results will appear automatically');
        pollBenchmarkStatus();
      }).catch(e => {
        if (e.message && e.message.includes('already running')) {
          showToast('Benchmark already running, waiting for results...');
          pollBenchmarkStatus();
        } else {
          if (btn) { btn.disabled = false; btn.textContent = 'Run Benchmark'; }
          alert('Error: ' + e.message);
        }
      });
    }
    function pollBenchmarkStatus() {
      const btn = document.getElementById('run-bench-btn');
      const poll = () => {
        fetch('/api/admin/endpoint-health/benchmark/status', { headers: { 'Accept': 'application/json' } })
          .then(r => r.json())
          .then(data => {
            if (!data.running) {
              showToast('Benchmark complete!');
              setTimeout(() => location.reload(), 1000);
            } else {
              if (btn) { btn.textContent = 'Running (' + Math.floor((Date.now() - benchmarkStart) / 1000) + 's)...'; }
              setTimeout(poll, 5000);
            }
          })
          .catch(() => setTimeout(poll, 5000));
      };
      window.benchmarkStart = Date.now();
      setTimeout(poll, 5000);
    }

    // ─── Probe Results ─────────────────────────────────────────────
    const PROBE_SITES = ['chatgpt.com','youtube.com','telegram.org','instagram.com','discord.com','whatsapp.com'];
    const PROBE_SITE_LABELS = {'chatgpt.com':'ChatGPT','youtube.com':'YouTube','telegram.org':'Telegram','instagram.com':'Instagram','discord.com':'Discord','whatsapp.com':'WhatsApp'};

    function runProbe() {
      const btn = document.getElementById('run-probe-btn');
      const node = document.getElementById('probe-node').value;
      const engine = document.getElementById('probe-engine').value;
      if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }
      
      // Clear previous logs
      const logsDiv = document.getElementById('probe-logs');
      if (logsDiv) { logsDiv.innerHTML = ''; logsDiv.style.display = 'block'; }
      document.getElementById('probe-status').textContent = 'Starting probe...';
      
      fetch('/api/admin/probe/run?node=' + encodeURIComponent(node) + '&engine=' + encodeURIComponent(engine), {
        method: 'POST', credentials: 'include'
      }).then(r => r.json()).then(data => {
        if (data.error) {
          if (btn) { btn.disabled = false; btn.textContent = 'Run Probe'; }
          if (logsDiv) logsDiv.style.display = 'none';
          alert('Error: ' + data.error);
          return;
        }
        if (btn) { btn.textContent = 'Running...'; }
        document.getElementById('probe-status').textContent = 'Probe running (PID ' + data.pid + ')... Streaming logs below.';
        
        // Start SSE log streaming
        streamProbeLogs();
        pollProbeStatus();
      }).catch(e => {
        if (btn) { btn.disabled = false; btn.textContent = 'Run Probe'; }
        if (logsDiv) logsDiv.style.display = 'none';
        alert('Failed: ' + e.message);
      });
    }

    function streamProbeLogs() {
      const logsDiv = document.getElementById('probe-logs');
      if (!logsDiv) return;
      
      const eventSource = new EventSource('/api/admin/probe/logs');
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'init' || data.type === 'logs') {
            // Append new logs
            for (const log of data.logs) {
              const line = document.createElement('div');
              line.style.marginBottom = '2px';
              
              // Color-code different log types
              if (log.includes('[OK]') || log.includes('✓')) {
                line.style.color = 'var(--success)';
              } else if (log.includes('[FAIL]') || log.includes('✗') || log.includes('ERROR')) {
                line.style.color = 'var(--error)';
              } else if (log.includes('[WARN]')) {
                line.style.color = 'var(--warning)';
              } else if (log.includes('[DONE]')) {
                line.style.color = 'var(--success)';
                line.style.fontWeight = 'bold';
                line.style.marginTop = '8px';
              }
              
              line.textContent = log;
              logsDiv.appendChild(line);
            }
            
            // Auto-scroll to bottom
            logsDiv.scrollTop = logsDiv.scrollHeight;
          }
          
          if (data.type === 'done') {
            eventSource.close();
          }
        } catch (e) {
          console.error('Failed to parse log:', e);
        }
      };
      
      eventSource.onerror = (err) => {
        console.error('SSE connection error:', err);
        eventSource.close();
      };
      
      // Store reference to close later if needed
      window._probeEventSource = eventSource;
    }

    function pollProbeStatus() {
      const btn = document.getElementById('run-probe-btn');
      const poll = () => {
        fetch('/api/admin/probe/status', { credentials: 'include' })
          .then(r => r.json())
          .then(data => {
            if (data.status === 'running') {
              const elapsed = data.started_at ? Math.floor((Date.now() - new Date(data.started_at).getTime()) / 1000) : 0;
              if (btn) { btn.textContent = 'Running (' + elapsed + 's)...'; }
              document.getElementById('probe-status').textContent = 'Probe running (PID ' + data.pid + ')... ' + elapsed + 's elapsed';
              setTimeout(poll, 5000);
            } else {
              if (btn) { btn.disabled = false; btn.textContent = 'Run Probe'; }
              document.getElementById('probe-status').textContent = 'Probe complete.';
              showToast('Probe complete!');
              loadProbeResults();
            }
          })
          .catch(() => setTimeout(poll, 5000));
      };
      setTimeout(poll, 5000);
    }

    function loadProbeResults() {
      fetch('/api/admin/probe/results', { credentials: 'include' })
        .then(r => r.json())
        .then(data => {
          const container = document.getElementById('probe-results-container');
          if (!data.results || data.results.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">No probe results yet. Run a probe to test endpoints.</div>';
            return;
          }
          container.innerHTML = renderProbeResults(data.results);
        })
        .catch(e => {
          document.getElementById('probe-results-container').innerHTML = '<div style="color:var(--error)">Failed to load: ' + e.message + '</div>';
        });
    }

    function renderProbeResults(results) {
      // Show most recent result first
      const latest = results[0];
      if (!latest || !latest.endpoints) return '<div style="color:var(--text-muted)">No data</div>';

      const header = '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">' +
        'Tested from: <strong style="color:var(--text)">' + escapeHtml(latest.node || '?') + '</strong>' +
        (latest.network_ip ? ' (' + escapeHtml(latest.network_ip) + ')' : '') +
        ' &nbsp;|&nbsp; Engine: <strong style="color:var(--text)">' + escapeHtml(latest.engine || '?') + '</strong>' +
        ' &nbsp;|&nbsp; ' + escapeHtml(latest.timestamp ? new Date(latest.timestamp).toLocaleString() : '') +
        '</div>';

      // Build table
      const siteHeaders = PROBE_SITES.map(s => '<th style="font-size:10px;text-align:center;min-width:60px">' + (PROBE_SITE_LABELS[s] || s) + '</th>').join('');
      let rows = '';
      for (const ep of latest.endpoints) {
        const tcpIcon = ep.tcp_reachable ? '<span style="color:var(--success)">✓</span>' : '<span style="color:var(--error)">✗</span>';
        const tunnelIcon = ep.tunnel_up ? '<span style="color:var(--success)">✓</span>' : '<span style="color:var(--error)">✗</span>';
        const exitIp = ep.exit_ip || '—';
        const speed = ep.speed_mbps ? parseFloat(ep.speed_mbps).toFixed(1) + ' Mbps' : '—';
        const largeTransfer = ep.large_transfer_ok
          ? '<span style="color:var(--success)">' + (ep.large_transfer_mbps ? parseFloat(ep.large_transfer_mbps).toFixed(1) : '0') + ' Mbps</span>'
          : '<span style="color:var(--error)">' + (ep.large_transfer_mbps ? parseFloat(ep.large_transfer_mbps).toFixed(1) : '0') + ' Mbps</span>';

        const siteCells = PROBE_SITES.map(siteUrl => {
          const siteResult = (ep.sites || []).find(s => s.url === siteUrl);
          if (!siteResult) return '<td style="text-align:center;background:var(--bg-elevated)">—</td>';
          const code = siteResult.http_code || 0;
          const ms = siteResult.latency_ms || 0;
          const isOk = code === 200;
          const isSlow = ms > 2000;
          const bg = isOk && !isSlow ? 'rgba(34,197,94,0.15)' : isOk && isSlow ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)';
          const color = isOk && !isSlow ? 'var(--success)' : isOk && isSlow ? 'var(--warning)' : 'var(--error)';
          return '<td style="text-align:center;background:' + bg + ';color:' + color + ';font-size:10px;font-weight:600">' +
            (code === 0 ? '×' : code + '<br><span style="font-weight:400;opacity:.7">' + ms + 'ms</span>') + '</td>';
        }).join('');

        rows += '<tr>' +
          '<td style="font-weight:600;font-size:12px;white-space:nowrap">' + escapeHtml(ep.id || '?') + '</td>' +
          '<td style="text-align:center">' + tcpIcon + '</td>' +
          '<td style="text-align:center">' + tunnelIcon + '</td>' +
          '<td style="font-size:11px;font-family:monospace">' + escapeHtml(exitIp) + '</td>' +
          siteCells +
          '<td style="text-align:right;font-size:11px">' + speed + '</td>' +
          '<td style="text-align:right;font-size:11px">' + largeTransfer + '</td>' +
          '</tr>';
      }

      return header + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">' +
        '<thead><tr style="border-bottom:2px solid var(--border)">' +
        '<th style="text-align:left;padding:4px 8px">Endpoint</th>' +
        '<th style="text-align:center;padding:4px">TCP</th>' +
        '<th style="text-align:center;padding:4px">Tunnel</th>' +
        '<th style="text-align:left;padding:4px">Exit IP</th>' +
        siteHeaders +
        '<th style="text-align:right;padding:4px">Speed</th>' +
        '<th style="text-align:right;padding:4px">10MB</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    // Load probe results on page load
    loadProbeResults();
    </script>
    </div>`,
  );
}

export function userDetailPage(input: {
  user: UserSummary;
  endpoints: Endpoint[];
  health: EndpointHealth[];
  slots: LinkSlot[];
  happInstall: HappInstallRecord | null;
  hwids: HappHwidRecord[];
  smartDnsClient: SmartDnsClient | null;
  smartDnsMobileconfigUrl?: string;
  baseUrl: string;
  secure: SecureConfig;
}): string {
  const subUrl = input.user.token ? subscriptionUrl(input.baseUrl, input.user.token) : "";
  const macCommand = input.user.token ? macosInstallerCommand(input.baseUrl, input.user.token) : "";
  const isActive = input.user.enabled && input.user.client_enabled;
  const initials = input.user.display_name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const slotsHtml = input.slots
    .map((slot) => {
      if (!slot.available || !slot.url) {
        return `<div class="link-item">
          <div class="link-item-header">
            <span class="link-item-label">${escapeHtml(slot.label)}</span>
            <span class="tag tag-error">${escapeHtml(slot.reason || "not configured")}</span>
          </div>
        </div>`;
      }
      return `<div class="link-item">
        <div class="link-item-header">
          <span class="link-item-label">${escapeHtml(slot.label)}</span>
          <span class="tag tag-success">Available</span>
        </div>
        <div class="link-item-url">${escapeHtml(slot.url)}</div>
        <div class="link-item-actions">
          <button class="btn btn-secondary btn-sm" onclick="copyText('${escapeHtml(slot.url)}')">Copy</button>
        </div>
      </div>`;
    })
    .join("");

  // Happ section
  const happInstall = input.happInstall;
  const providerCode = input.secure.happ.provider_code;
  const installDeeplink = happInstall ? happInstallDeeplink(input.secure, happInstall.install_code) : "";
  const subDeeplink = subUrl ? happDeeplink(subUrl) : "";

  const hwidsHtml = input.hwids.length > 0
    ? input.hwids.map((hwid) => {
      // Calculate if device was seen recently (within 7 days)
      const lastSeen = new Date(hwid.last_seen_at);
      const daysSinceSeen = Math.floor((Date.now() - lastSeen.getTime()) / 86400000);
      const activityClass = daysSinceSeen <= 1 ? "tag-success" : daysSinceSeen <= 7 ? "tag-info" : "tag-neutral";
      const activityLabel = daysSinceSeen === 0 ? "Online today" : daysSinceSeen === 1 ? "Yesterday" : `${daysSinceSeen}d ago`;

      // Device info line
      const deviceInfoParts: string[] = [];
      if (hwid.device_model) deviceInfoParts.push(hwid.device_model);
      if (hwid.os_version) deviceInfoParts.push(hwid.os_version);
      if (hwid.app_version) deviceInfoParts.push(`Happ ${hwid.app_version}`);
      const deviceInfoHtml = deviceInfoParts.length > 0
        ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escapeHtml(deviceInfoParts.join(" / "))}</div>`
        : "";

      return `<div class="link-item">
        <div class="link-item-header">
          <div>
            <span class="link-item-label" style="font-family:monospace;font-size:12px">${escapeHtml(hwid.hwid)}</span>
            ${hwid.device_name ? `<span style="margin-left:8px;font-size:12px;color:var(--text-secondary)">${escapeHtml(hwid.device_name)}</span>` : ""}
            ${deviceInfoHtml}
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
            <span class="tag ${activityClass}">${activityLabel}</span>
            <button class="btn btn-ghost btn-sm" onclick="if(confirm('Delete this HWID?')) postJson('/api/admin/users/${escapeHtml(input.user.account_id)}/happ/hwid/${escapeHtml(hwid.id)}/delete',{}).then(()=>location.reload())">Delete</button>
          </div>
        </div>
      </div>`;
    }).join("")
    : '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">No HWIDs registered yet. HWIDs are captured automatically when a Happ client updates its subscription.</div>';

  const smartDnsClient = input.smartDnsClient;
  const smartDnsDohUrl = smartDnsClient ? `https://dns.example.com/dns-query/${smartDnsClient.client_id}` : "";
  const smartDnsDotHost = smartDnsClient ? `${smartDnsClient.client_id}.dns.example.com` : "";
  const smartDnsSection = `<div class="card">
    <div class="card-header">
      <h3>Smart DNS</h3>
      ${smartDnsClient ? `<span class="tag ${smartDnsClient.enabled ? "tag-success" : "tag-error"}">${smartDnsClient.enabled ? "Enabled" : "Disabled"}</span>` : `<span class="tag tag-neutral">No client_id</span>`}
    </div>
    <div style="margin-bottom:12px;padding:10px 12px;border:1px solid var(--warning);border-radius:8px;color:var(--text-secondary);font-size:12px">
      SmartDNS исправляет DNS-маршрутизацию, но не является VPN. При активном DPI Telegram, Discord, YouTube и Instagram через SmartDNS alone считаются неподдерживаемыми — для них нужен Xray/VPN/SmartRelay.
    </div>
    ${smartDnsClient ? `
      <div style="display:grid;gap:12px">
        <div>
          <label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px">client_id</label>
          <div class="sub-box">
            <div class="sub-url" style="font-family:monospace;font-size:13px;word-break:break-all">${escapeHtml(smartDnsClient.client_id)}</div>
            <div class="sub-actions" style="margin-top:8px">
              <button class="btn btn-secondary btn-sm" onclick="copyText('${escapeHtml(smartDnsClient.client_id)}')">Copy client_id</button>
            </div>
          </div>
        </div>
        <div>
          <label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px">DoH</label>
          <div class="link-item-url">${escapeHtml(smartDnsDohUrl)}</div>
          <div class="link-item-actions"><button class="btn btn-secondary btn-sm" onclick="copyText('${escapeHtml(smartDnsDohUrl)}')">Copy DoH URL</button></div>
        </div>
        <div>
          <label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px">DoT / Android Private DNS</label>
          <div class="link-item-url">${escapeHtml(smartDnsDotHost)}</div>
          <div class="link-item-actions"><button class="btn btn-secondary btn-sm" onclick="copyText('${escapeHtml(smartDnsDotHost)}')">Copy DoT host</button></div>
        </div>
        ${input.smartDnsMobileconfigUrl ? `
        <div>
          <label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:6px">iPhone / iPad / macOS profile</label>
          <div class="link-item-url">${escapeHtml(input.smartDnsMobileconfigUrl)}</div>
          <div class="link-item-actions">
            <a class="btn btn-primary btn-sm" href="${escapeHtml(input.smartDnsMobileconfigUrl)}">Download mobileconfig</a>
            <button class="btn btn-secondary btn-sm" onclick="copyText('${escapeHtml(input.smartDnsMobileconfigUrl)}')">Copy link</button>
          </div>
        </div>` : ""}
        <div style="display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:12px">
          <form method="post" action="/api/admin/users/${escapeHtml(input.user.account_id)}/smart-dns/generate" onsubmit="return confirm('Rotate Smart DNS client_id for this user? Old DNS settings will stop working.')">
            <button class="btn btn-warning btn-sm" type="submit">Rotate client_id</button>
          </form>
          <form method="post" action="/api/admin/users/${escapeHtml(input.user.account_id)}/smart-dns/toggle">
            <input type="hidden" name="enabled" value="${smartDnsClient.enabled ? "false" : "true"}">
            <button class="btn ${smartDnsClient.enabled ? "btn-ghost" : "btn-success"} btn-sm" type="submit">${smartDnsClient.enabled ? "Disable" : "Enable"}</button>
          </form>
        </div>
        <div style="font-size:12px;color:var(--text-muted)">Public endpoints: DoH over 443 and DoT over 853. Runtime sync to worker-lan must include this client_id in /opt/smart-dns/config.json.</div>
      </div>
    ` : `
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:12px">No Smart DNS client_id linked to this VPN user.</p>
      <form method="post" action="/api/admin/users/${escapeHtml(input.user.account_id)}/smart-dns/generate">
        <button class="btn btn-primary btn-sm" type="submit">Create client_id</button>
      </form>
    `}
  </div>`;

  const happSection = `<div class="card">
    <div class="card-header">
      <h3>Happ Integration</h3>
      ${happInstall ? `<span class="tag tag-success">Linked</span>` : `<span class="tag tag-warning">Not linked</span>`}
    </div>
    ${happInstall ? `
      <div style="margin-bottom:16px">
        <label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:8px">Install code</label>
        <div class="sub-box">
          <div class="sub-url" style="font-size:14px;text-align:center;letter-spacing:.1em">${escapeHtml(happInstall.install_code)}</div>
          <div class="sub-actions" style="margin-top:8px">
            <button class="btn btn-secondary btn-sm" onclick="copyText('${escapeHtml(happInstall.install_code)}')">Copy code</button>
            <button class="btn btn-secondary btn-sm" onclick="copyText('${escapeHtml(installDeeplink)}')">Copy install deeplink</button>
            <button class="btn btn-ghost btn-sm" onclick="copyText('${escapeHtml(subDeeplink)}')">Copy sub deeplink</button>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:16px;font-size:12px;color:var(--text-secondary)">
        <span>Limit: <strong style="color:var(--text)">${happInstall.install_limit}</strong> devices</span>
        <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:2px 6px" onclick="const n=prompt('New device limit:',${happInstall.install_limit});if(n&&+n>0)postJson('/api/admin/users/${escapeHtml(input.user.account_id)}/happ/update-limit',{installLimit:+n}).then(()=>location.reload())">Change</button>
        <span>Registered: <strong style="color:${input.hwids.length >= happInstall.install_limit ? "var(--error)" : "var(--text)"}">${input.hwids.length}</strong>/${happInstall.install_limit}</span>
        <span>Status: <span class="tag ${happInstall.status === 10 ? "tag-success" : "tag-error"}" style="font-size:10px">${happInstall.status === 10 ? "Active" : "Disabled"}</span></span>
        ${input.hwids.length >= happInstall.install_limit ? '<span class="tag tag-error">Limit reached!</span>' : ''}
      </div>
      <div style="margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <label style="font-size:12px;font-weight:500;color:var(--text-secondary)">Devices (HWID)</label>
          <button class="btn btn-ghost btn-sm" onclick="postJson('/api/admin/users/${escapeHtml(input.user.account_id)}/happ/sync-hwids',{}).then(()=>location.reload())">Sync from Happ</button>
        </div>
        <div class="link-list">${hwidsHtml}</div>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:16px">
        <form method="post" action="/api/admin/users/${escapeHtml(input.user.account_id)}/happ/settings">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <label style="font-size:12px;font-weight:500;color:var(--text-secondary)">App settings</label>
            <div style="display:flex;gap:6px">
              <button class="btn btn-primary btn-sm" type="submit">Save settings</button>
              <button class="btn btn-secondary btn-sm" type="button" onclick="postJson('/api/admin/users/${escapeHtml(input.user.account_id)}/happ/push-settings',{}).then(r=>alert(r.ok?'Settings pushed!':'Error: '+JSON.stringify(r)))">Push to devices</button>
            </div>
          </div>
          ${renderHappSettings(happInstall.happ_settings)}
        </form>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:16px;display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" onclick="postJson('/api/admin/users/${escapeHtml(input.user.account_id)}/happ/push-subscription',{}).then(r=>alert(r.ok?'Subscription update sent!':'Error: '+JSON.stringify(r)))">Force subscription update</button>
        <button class="btn btn-ghost btn-sm" onclick="if(confirm('Disable Happ install?')) postJson('/api/admin/users/${escapeHtml(input.user.account_id)}/happ/toggle-status',{}).then(()=>location.reload())">${happInstall.status === 10 ? "Disable install" : "Enable install"}</button>
      </div>
    ` : `
      <div style="text-align:center;padding:20px">
        <p style="color:var(--text-secondary);font-size:13px;margin-bottom:12px">No Happ install linked. Create one to enable HWID tracking and remote management.</p>
        <button class="btn btn-primary btn-sm" onclick="postJson('/api/admin/users/${escapeHtml(input.user.account_id)}/happ/create-install',{}).then(()=>location.reload())">Create Happ install</button>
      </div>
    `}
  </div>`;

  return page(
    `User ${input.user.login}`,
    `<nav class="nav">
      <div class="nav-brand">
        <a href="/admin" style="color:var(--text-muted);font-size:13px;margin-right:8px">\u2190 Back</a>
        <h1>BezVPN</h1>
        <span class="nav-badge admin">Admin</span>
      </div>
      <div class="nav-actions">
        <form method="post" action="/api/logout" style="display:inline"><button class="btn btn-ghost btn-sm" type="submit">Logout</button></form>
      </div>
    </nav>

    <div class="page-header" style="display:flex;align-items:center;gap:16px">
      <div class="user-avatar" style="width:52px;height:52px;font-size:20px">${escapeHtml(initials)}</div>
      <div>
        <h2>${escapeHtml(input.user.display_name)}</h2>
        <p>@${escapeHtml(input.user.login)}</p>
      </div>
      <span class="tag ${isActive ? "tag-success" : "tag-error"}" style="margin-left:auto">${isActive ? "Active" : "Disabled"}</span>
    </div>

    <div class="two-col">
      <div>
        <div class="card">
          <div class="card-header"><h3>User Settings</h3></div>
          <form method="post" action="/api/admin/users/${escapeHtml(input.user.account_id)}/update">
            <div class="form-group">
              <label>Display name</label>
              <input class="input" name="displayName" value="${escapeHtml(input.user.display_name)}" required>
            </div>
            <div class="form-group">
              <label>Login</label>
              <input class="input" name="login" value="${escapeHtml(input.user.login)}" required>
            </div>
            <div class="form-group">
              <label>New password</label>
              <input class="input" name="password" placeholder="Leave empty to keep current">
            </div>
            <div class="form-group" style="display:flex;align-items:center;gap:10px">
              <input type="hidden" name="enabled" id="enabled-input" value="${input.user.enabled ? "true" : "false"}">
              <input type="checkbox" value="true" ${input.user.enabled ? "checked" : ""} id="enabled-check" style="width:18px;height:18px;accent-color:var(--primary)" onchange="document.getElementById('enabled-input').value=this.checked?'true':'false'">
              <label for="enabled-check" style="margin:0;font-size:14px;color:var(--text)">Enabled</label>
            </div>
            <div class="form-group">
              <label>Assigned endpoints</label>
              ${endpointCheckboxes(input.endpoints, input.user.profiles, input.health)}
            </div>
            <div style="display:flex;gap:8px;margin-top:16px">
              <button class="btn btn-primary" type="submit">Save changes</button>
            </div>
          </form>
          <div style="border-top:1px solid var(--border);margin-top:16px;padding-top:16px">
            <label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:8px">Endpoint scope</label>
            <div style="display:flex;gap:8px">
              <button class="btn btn-primary btn-sm" onclick="postJson('/api/admin/users/${escapeHtml(input.user.account_id)}/endpoint-scope', {scope:'all'}).then(() => location.reload())">All endpoints</button>
              <button class="btn btn-secondary btn-sm" onclick="postJson('/api/admin/users/${escapeHtml(input.user.account_id)}/endpoint-scope', {scope:'working'}).then(() => location.reload())">Working only</button>
            </div>
          </div>
          <div style="border-top:1px solid var(--border);margin-top:16px;padding-top:16px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" onclick="postJson('/api/admin/users/${escapeHtml(input.user.account_id)}/rotate-token', {}).then(() => location.reload())">Rotate token</button>
            <button class="btn btn-danger btn-sm" onclick="if(confirm('Delete this user?')) deleteJson('/api/admin/users/${escapeHtml(input.user.account_id)}').then(() => location.href='/admin')">Delete user</button>
          </div>
        </div>

        ${smartDnsSection}
        ${happSection}
      </div>

      <div>
        <div class="card">
          <div class="card-header"><h3>Subscription</h3></div>
          ${subUrl ? `<div style="display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:16px;align-items:start">
            <div class="sub-box">
              <div class="sub-url">${escapeHtml(subUrl)}</div>
              <div class="sub-actions">
                <button class="btn btn-primary btn-sm" onclick="copyText('${escapeHtml(subUrl)}')">Copy URL</button>
                <button class="btn btn-secondary btn-sm" onclick="copyText('${escapeHtml(subDeeplink)}')">Happ deeplink</button>
                ${input.user.token ? `<button class="btn btn-ghost btn-sm" onclick="openQr('${escapeHtml(input.user.token)}')">Открыть QR</button>` : ""}
              </div>
            </div>
            ${input.user.token ? `<div style="text-align:center">
              <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">QR подписки</div>
              <a href="/sub/${escapeHtml(input.user.token)}/qr" target="_blank" rel="noopener noreferrer" title="Открыть QR подписки">
                <img src="/sub/${escapeHtml(input.user.token)}/qr" width="200" height="200" alt="QR-код подписки" style="display:block;width:200px;height:200px;margin:0 auto;background:#fff;border-radius:8px;padding:6px">
              </a>
              <div style="font-size:11px;color:var(--text-muted);margin-top:6px">Наведите камеру или откройте отдельно</div>
            </div>` : ""}
          </div>` : '<span class="tag tag-error">No token</span>'}
          <div style="margin-top:12px;font-size:12px;color:var(--text-muted)">UUID: <code style="color:var(--text-secondary)">${escapeHtml(input.user.xray_uuid)}</code></div>
          ${macCommand ? `<div style="border-top:1px solid var(--border);margin-top:16px;padding-top:16px">
            <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">macOS MVP installer command</div>
            <code style="display:block;overflow-wrap:anywhere;color:var(--text-secondary);font-size:12px;line-height:1.5">${escapeHtml(macCommand)}</code>
            <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="copyText('${escapeHtml(macCommand)}')">Copy macOS command</button>
          </div>` : ""}
        </div>

        <div class="card">
          <div class="card-header"><h3>Individual links</h3></div>
          <div class="link-list">${slotsHtml || '<div style="color:var(--text-muted);font-size:13px">No links available</div>'}</div>
        </div>
      </div>
    </div>

    ${qrModal()}`,
  );
}

// ─── Helper functions for VPS page ────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function progressBar(percent: number, color: string): string {
  const cls = percent > 90 ? "var(--error)" : percent > 70 ? "var(--warning)" : color;
  return `<div style="background:var(--bg);border-radius:4px;height:8px;overflow:hidden;margin-top:4px">
    <div style="width:${Math.min(percent, 100)}%;background:${cls};height:100%;border-radius:4px;transition:width .3s"></div>
  </div>`;
}

export function vpsPage(input: {
  connected: boolean;
  error?: string;
  system?: VpsSystemStats;
  xray?: {
    running: boolean;
    pid: number | null;
    memory_mb: number;
    cpu_time: string;
    uptime: string;
    version: string;
  };
  userTraffic?: XrayUserTraffic[];
  inboundTraffic?: XrayInboundTraffic[];
  vpsLabel?: string;
  vpsList?: { id: string; host: string; label: string }[];
  activeVpsId?: string;
  allVpsFull?: { id: string; host: string; port: number; username: string; label: string }[];
}): string {
  const vpsList = input.vpsList || [];
  const activeVpsId = input.activeVpsId;
  const allVpsFull = input.allVpsFull || [];

  const vpsSelectorHtml = vpsList.length > 1
    ? `<div style="display:flex;gap:4px;margin-bottom:16px;padding:8px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border)">
        ${vpsList.map(v => `<a class="btn btn-sm ${v.id === activeVpsId ? "btn-primary" : "btn-ghost"}" href="/admin/vps?vps=${escapeHtml(v.id)}" style="text-decoration:none">${escapeHtml(v.label || v.host)}</a>`).join("")}
      </div>`
    : "";

  if (!input.connected) {
    const vpsManageHtml = allVpsFull.length > 0 || true ? `
    <div class="card" id="vps-manage-card">
      <div class="card-header">
        <h3>VPS Servers</h3>
        <button class="btn btn-primary btn-sm" onclick="document.getElementById('vps-edit-form').style.display='block';document.getElementById('vps-edit-id').value=''">+ Add VPS</button>
      </div>
      <div id="vps-manage-list">
        ${allVpsFull.map(v => `<div class="link-item">
          <div class="link-item-header">
            <div>
              <span class="link-item-label">${escapeHtml(v.label)}</span>
              <span style="font-size:12px;color:var(--text-muted);margin-left:8px">${escapeHtml(v.username + "@" + v.host)}:${v.port}</span>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              <a class="btn btn-secondary btn-sm" href="/admin/vps?vps=${escapeHtml(v.id)}">Switch</a>
              <button class="btn btn-ghost btn-sm" onclick="editVps('${escapeHtml(v.id)}')">Edit</button>
              ${allVpsFull.length > 1 ? `<button class="btn btn-danger btn-sm" onclick="deleteVps('${escapeHtml(v.id)}','${escapeHtml(v.label)}')">Delete</button>` : ""}
            </div>
          </div>
        </div>`).join("")}
      </div>
      <div id="vps-edit-form" style="display:none;margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group">
            <label>Label</label>
            <input class="input" id="vps-label" placeholder="e.g. DE VPS">
          </div>
          <div class="form-group">
            <label>Host</label>
            <input class="input" id="vps-host" placeholder="e.g. vpn.example.com">
          </div>
          <div class="form-group">
            <label>Port</label>
            <input class="input" id="vps-port" type="number" value="22" placeholder="22">
          </div>
          <div class="form-group">
            <label>Username</label>
            <input class="input" id="vps-username" value="root" placeholder="root">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input class="input" id="vps-password" type="password" placeholder="Leave empty if using SSH key">
          </div>
          <div class="form-group">
            <label>Private Key</label>
            <input class="input" id="vps-key" type="password" placeholder="Or paste SSH private key">
          </div>
          <input type="hidden" id="vps-edit-id" value="">
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-primary btn-sm" onclick="saveVps()">Save</button>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('vps-edit-form').style.display='none'">Cancel</button>
        </div>
      </div>
      <script>
      const vpsData = ${JSON.stringify(allVpsFull)};
      function editVps(id) {
        const vps = vpsData.find(v => v.id === id);
        if (!vps) return;
        document.getElementById('vps-edit-id').value = vps.id;
        document.getElementById('vps-label').value = vps.label || '';
        document.getElementById('vps-host').value = vps.host || '';
        document.getElementById('vps-port').value = vps.port || 22;
        document.getElementById('vps-username').value = vps.username || 'root';
        document.getElementById('vps-password').value = '';
        document.getElementById('vps-key').value = '';
        document.getElementById('vps-edit-form').style.display = 'block';
      }
      async function saveVps() {
        const editId = document.getElementById('vps-edit-id').value;
        const body = {
          id: editId || undefined,
          label: document.getElementById('vps-label').value.trim(),
          host: document.getElementById('vps-host').value.trim(),
          port: parseInt(document.getElementById('vps-port').value) || 22,
          username: document.getElementById('vps-username').value.trim() || 'root',
          password: document.getElementById('vps-password').value,
          private_key: document.getElementById('vps-key').value,
        };
        if (!body.host) return alert('Host is required');
        if (!body.label) return alert('Label is required');
        try {
          const r = await fetch('/api/admin/vps/config', {
            method: editId ? 'PUT' : 'POST',
            credentials: 'include',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body),
          });
          const data = await r.json();
          if (data.ok) { setTimeout(() => location.reload(), 500); }
          else { alert('Error: ' + (data.error || 'Unknown')); }
        } catch(e) { alert('Failed: ' + e); }
      }
      async function deleteVps(id, label) {
        if (!confirm('Delete VPS "' + label + '"? This cannot be undone.')) return;
        try {
          const r = await fetch('/api/admin/vps/config', {
            method: 'DELETE',
            credentials: 'include',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({id}),
          });
          const data = await r.json();
          if (data.ok) { setTimeout(() => location.reload(), 500); }
          else { alert('Error: ' + (data.error || 'Unknown')); }
        } catch(e) { alert('Failed: ' + e); }
      }
      </script>
    </div>` : "";

    return page(
      "VPS Management",
      `<nav class="nav">
        <div class="nav-brand">
          <a href="/admin" style="color:var(--text-muted);font-size:13px;margin-right:8px">\u2190 Back</a>
          <h1>BezVPN</h1>
          <span class="nav-badge admin">Admin</span>
        </div>
        <div class="nav-actions">
          <form method="post" action="/api/logout" style="display:inline"><button class="btn btn-ghost btn-sm" type="submit">Logout</button></form>
        </div>
      </nav>
      ${vpsSelectorHtml}
      <div class="card" style="text-align:center;padding:40px">
        <h3 style="margin-bottom:12px">VPS Not Connected</h3>
        <p style="color:var(--text-secondary);max-width:500px;margin:0 auto">${escapeHtml(input.error || "Add a VPS server or select one from the list below.")}</p>
      </div>
      ${vpsManageHtml}`,
    );
  }

  const sys = input.system!;
  const xray = input.xray!;
  const label = input.vpsLabel || sys.hostname;

  const cpuPercent = sys.cpu_count > 0 ? Math.round((sys.cpu_load_1m / sys.cpu_count) * 100) : 0;
  const memPercent = sys.mem_total_mb > 0 ? Math.round((sys.mem_used_mb / sys.mem_total_mb) * 100) : 0;
  const diskPercent = sys.disk_use_percent;

  const systemHtml = `
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">Hostname</div>
        <div class="stat-value" style="font-size:18px">${escapeHtml(label)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${escapeHtml(sys.os)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Uptime</div>
        <div class="stat-value blue">${formatUptime(sys.uptime_seconds)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">CPU</div>
        <div class="stat-value ${cpuPercent > 80 ? "red" : "green"}">${cpuPercent}%</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${sys.cpu_load_1m.toFixed(1)} / ${sys.cpu_load_5m.toFixed(1)} / ${sys.cpu_load_15m.toFixed(1)}</div>
        ${progressBar(cpuPercent, "var(--success)")}
      </div>
      <div class="stat-card">
        <div class="stat-label">Memory</div>
        <div class="stat-value ${memPercent > 80 ? "red" : "green"}">${memPercent}%</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${sys.mem_used_mb} / ${sys.mem_total_mb} MB</div>
        ${progressBar(memPercent, "var(--success)")}
      </div>
      <div class="stat-card">
        <div class="stat-label">Disk</div>
        <div class="stat-value ${diskPercent > 90 ? "red" : diskPercent > 70 ? "" : "blue"}">${diskPercent}%</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${sys.disk_used_gb} / ${sys.disk_total_gb} GB</div>
        ${progressBar(diskPercent, "var(--info)")}
      </div>
      <div class="stat-card">
        <div class="stat-label">CPU Model</div>
        <div class="stat-value" style="font-size:13px">${sys.cpu_count}x ${escapeHtml(sys.cpu_model)}</div>
      </div>
    </div>`;

  const xrayStatusDot = xray.running ? "alive" : "dead";
  const xrayStatusText = xray.running ? "Running" : "Stopped";
  const xrayStatusTag = xray.running ? "tag-success" : "tag-error";

  // Smart toggle: only show the action that makes sense
  const xrayToggleHtml = xray.running
    ? `<div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="postJson('/api/admin/vps/xray/restart'+vpsQ(),{}).then(r=>{if(r.ok){showToast('Xray restarted')}else{alert('Error: '+r.error)}}).then(()=>setTimeout(()=>location.reload(),2000))">Restart</button>
        <button class="btn btn-danger btn-sm" onclick="if(confirm('Stop Xray? All connections will be dropped.')) postJson('/api/admin/vps/xray/stop'+vpsQ(),{}).then(r=>{if(r.ok){showToast('Xray stopped')}else{alert('Error: '+r.error)}}).then(()=>setTimeout(()=>location.reload(),2000))">Stop</button>
      </div>`
    : `<button class="btn btn-primary btn-sm" onclick="postJson('/api/admin/vps/xray/start'+vpsQ(),{}).then(r=>{if(r.ok){showToast('Xray started')}else{alert('Error: '+r.error)}}).then(()=>setTimeout(()=>location.reload(),2000))">Start Xray</button>`;

  const xrayHtml = `
    <div class="card">
      <div class="card-header">
        <h3>Xray</h3>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="health-status-dot ${xrayStatusDot}"></span>
          <span class="tag ${xrayStatusTag}">${xrayStatusText}</span>
          ${xray.running ? `<span class="tag tag-neutral">PID ${xray.pid}</span>` : ""}
          <button class="btn btn-ghost btn-sm" onclick="location.reload()" title="Refresh status" style="margin-left:4px;padding:2px 8px;font-size:11px">Refresh</button>
        </div>
      </div>
      ${xray.running ? `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px">
        <div style="background:var(--bg-elevated);padding:12px;border-radius:var(--radius-sm);border:1px solid var(--border)">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Version</div>
          <div style="font-size:14px;font-weight:600">${escapeHtml(xray.version)}</div>
        </div>
        <div style="background:var(--bg-elevated);padding:12px;border-radius:var(--radius-sm);border:1px solid var(--border)">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Memory</div>
          <div style="font-size:14px;font-weight:600">${xray.memory_mb} MB</div>
        </div>
        <div style="background:var(--bg-elevated);padding:12px;border-radius:var(--radius-sm);border:1px solid var(--border)">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Uptime</div>
          <div style="font-size:14px;font-weight:600">${escapeHtml(xray.uptime || "N/A")}</div>
        </div>
        <div style="background:var(--bg-elevated);padding:12px;border-radius:var(--radius-sm);border:1px solid var(--border)">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">CPU Time</div>
          <div style="font-size:14px;font-weight:600">${escapeHtml(xray.cpu_time || "N/A")}</div>
        </div>
      </div>` : `
      <div style="padding:16px;text-align:center;color:var(--text-secondary);font-size:13px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px dashed var(--border);margin-bottom:16px">
        Xray is not running. Version ${escapeHtml(xray.version)} is installed.
      </div>`}
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${xrayToggleHtml}
        <div style="width:1px;height:24px;background:var(--border);margin:0 4px"></div>
        <button class="btn btn-secondary btn-sm" onclick="postJson('/api/admin/vps/xray/sync-clients'+vpsQ(),{}).then(r=>{if(r.ok){showToast('Config synced & restarted')}else{alert('Error: '+(r.error||JSON.stringify(r)))}}).then(()=>setTimeout(()=>location.reload(),2000))">Sync clients</button>
        <button class="btn btn-primary btn-sm" onclick="deployServer()">Deploy All Endpoints</button>
        <button class="btn btn-secondary btn-sm" onclick="checkXrayUpdate()">Check update</button>
        <button class="btn btn-ghost btn-sm" onclick="loadXrayConfig()">Config</button>
        <button class="btn btn-ghost btn-sm" onclick="loadXrayLogs()">Logs</button>
        <button class="btn btn-ghost btn-sm" onclick="postJson('/api/admin/vps/xray/reset-stats'+vpsQ(),{}).then(r=>showToast(r.ok?'Stats reset':'Error')).then(()=>setTimeout(()=>location.reload(),1000))">Reset stats</button>
        <button class="btn btn-ghost btn-sm" onclick="loadVpsProcesses()">Processes</button>
        <button class="btn btn-ghost btn-sm" onclick="loadVpsConnections()">Connections</button>
      </div>
    </div>

    <div class="card" id="xray-update-card" style="display:none">
      <div class="card-header">
        <h3>Xray Update</h3>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('xray-update-card').style.display='none'">Close</button>
      </div>
      <div id="xray-update-content" style="font-size:13px"></div>
    </div>`;

  const inboundHtml = (input.inboundTraffic || [])
    .filter((t) => t.tag !== "api")
    .map((t) => {
      const total = t.uplink_bytes + t.downlink_bytes;
      return `<div class="link-item">
        <div class="link-item-header">
          <span class="link-item-label">${escapeHtml(t.tag)}</span>
          <span class="tag tag-neutral">${formatBytes(total)}</span>
        </div>
        <div style="display:flex;gap:16px;font-size:12px;color:var(--text-secondary);margin-top:4px">
          <span>\u2B06 ${formatBytes(t.uplink_bytes)}</span>
          <span>\u2B07 ${formatBytes(t.downlink_bytes)}</span>
        </div>
      </div>`;
    }).join("");

  const userTrafficHtml = (input.userTraffic || [])
    .sort((a, b) => (b.uplink_bytes + b.downlink_bytes) - (a.uplink_bytes + a.downlink_bytes))
    .map((t) => {
      const total = t.uplink_bytes + t.downlink_bytes;
      return `<div class="link-item">
        <div class="link-item-header">
          <span class="link-item-label">${escapeHtml(t.email)}</span>
          <span class="tag tag-info">${formatBytes(total)}</span>
        </div>
        <div style="display:flex;gap:16px;font-size:12px;color:var(--text-secondary);margin-top:4px">
          <span>\u2B06 ${formatBytes(t.uplink_bytes)}</span>
          <span>\u2B07 ${formatBytes(t.downlink_bytes)}</span>
        </div>
      </div>`;
    }).join("");

  const totalUp = (input.inboundTraffic || []).reduce((s, t) => s + t.uplink_bytes, 0);
  const totalDown = (input.inboundTraffic || []).reduce((s, t) => s + t.downlink_bytes, 0);
  const totalAll = totalUp + totalDown;

  return page(
    "VPS Management",
    `<nav class="nav">
      <div class="nav-brand">
        <a href="/admin" style="color:var(--text-muted);font-size:13px;margin-right:8px">\u2190 Back</a>
        <h1>BezVPN</h1>
        <span class="nav-badge admin">VPS</span>
      </div>
      <div class="nav-actions">
        <button class="btn btn-ghost btn-sm" onclick="location.reload()">Refresh</button>
        <form method="post" action="/api/logout" style="display:inline"><button class="btn btn-ghost btn-sm" type="submit">Logout</button></form>
      </div>
    </nav>

    ${vpsSelectorHtml}

    ${systemHtml}

    ${xrayHtml}

    <div class="card">
      <div class="card-header">
        <h3>Traffic Overview</h3>
        <div style="display:flex;gap:12px;font-size:13px">
          <span style="color:var(--text-secondary)">Total: <strong style="color:var(--text)">${formatBytes(totalAll)}</strong></span>
          <span style="color:var(--text-secondary)">Up: ${formatBytes(totalUp)}</span>
          <span style="color:var(--text-secondary)">Down: ${formatBytes(totalDown)}</span>
        </div>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-header"><h3>Inbound Traffic</h3></div>
        <div class="link-list">${inboundHtml || '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">No traffic data yet</div>'}</div>
      </div>

      <div class="card">
        <div class="card-header"><h3>User Traffic</h3></div>
        <div class="link-list">${userTrafficHtml || '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">No user traffic data yet</div>'}</div>
      </div>
    </div>

    <div class="card" id="xray-config-card" style="display:none">
      <div class="card-header">
        <h3>Xray Configuration</h3>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" onclick="saveXrayConfig()">Save & Restart</button>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('xray-config-card').style.display='none'">Close</button>
        </div>
      </div>
      <textarea id="xray-config-editor" style="width:100%;min-height:500px;font-family:monospace;font-size:12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;resize:vertical"></textarea>
    </div>

    <div class="card" id="xray-logs-card" style="display:none">
      <div class="card-header">
        <h3>Xray Logs</h3>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="loadXrayLogs()">Refresh</button>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('xray-logs-card').style.display='none'">Close</button>
        </div>
      </div>
      <pre id="xray-logs-content" style="max-height:400px;overflow:auto;font-size:11px;line-height:1.5"></pre>
    </div>

    <div class="card" id="vps-processes-card" style="display:none">
      <div class="card-header">
        <h3>Processes</h3>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="loadVpsProcesses()">Refresh</button>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('vps-processes-card').style.display='none'">Close</button>
        </div>
      </div>
      <pre id="vps-processes-content" style="max-height:400px;overflow:auto;font-size:11px;line-height:1.5"></pre>
    </div>

    <div class="card" id="vps-connections-card" style="display:none">
      <div class="card-header">
        <h3>Connections</h3>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="loadVpsConnections()">Refresh</button>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('vps-connections-card').style.display='none'">Close</button>
        </div>
      </div>
      <pre id="vps-connections-content" style="max-height:400px;overflow:auto;font-size:11px;line-height:1.5"></pre>
    </div>

    <div class="card" id="vps-manage-card">
      <div class="card-header">
        <h3>VPS Servers</h3>
        <button class="btn btn-primary btn-sm" onclick="showAddVps()">+ Add VPS</button>
      </div>
      <div id="vps-manage-list">
        ${allVpsFull.map(v => `<div class="link-item">
          <div class="link-item-header">
            <div>
              <span class="link-item-label">${escapeHtml(v.label)}</span>
              <span style="font-size:12px;color:var(--text-muted);margin-left:8px">${escapeHtml(v.username + "@" + v.host)}:${v.port}</span>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              ${v.id === activeVpsId ? '<span class="tag tag-success">Active</span>' : `<a class="btn btn-secondary btn-sm" href="/admin/vps?vps=${escapeHtml(v.id)}">Switch</a>`}
              <button class="btn btn-ghost btn-sm" onclick="editVps('${escapeHtml(v.id)}')">Edit</button>
              ${allVpsFull.length > 1 ? `<button class="btn btn-danger btn-sm" onclick="deleteVps('${escapeHtml(v.id)}','${escapeHtml(v.label)}')">Delete</button>` : ""}
            </div>
          </div>
        </div>`).join("")}
        ${allVpsFull.length === 0 ? '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">No VPS configured. Add one to get started.</div>' : ""}
      </div>
      <div id="vps-edit-form" style="display:none;margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group">
            <label>Label</label>
            <input class="input" id="vps-label" placeholder="e.g. DE VPS">
          </div>
          <div class="form-group">
            <label>Host</label>
            <input class="input" id="vps-host" placeholder="e.g. vpn.example.com">
          </div>
          <div class="form-group">
            <label>Port</label>
            <input class="input" id="vps-port" type="number" value="22" placeholder="22">
          </div>
          <div class="form-group">
            <label>Username</label>
            <input class="input" id="vps-username" value="root" placeholder="root">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input class="input" id="vps-password" type="password" placeholder="Leave empty if using SSH key">
          </div>
          <div class="form-group">
            <label>Private Key</label>
            <input class="input" id="vps-key" type="password" placeholder="Or paste SSH private key">
          </div>
          <input type="hidden" id="vps-edit-id" value="">
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-primary btn-sm" onclick="saveVps()">Save</button>
          <button class="btn btn-ghost btn-sm" onclick="cancelVpsEdit()">Cancel</button>
        </div>
      </div>
    </div>

    <script>
    function vpsQ() {
      const vps = new URLSearchParams(location.search).get('vps');
      return vps ? '?vps=' + encodeURIComponent(vps) : '';
    }

    function showToast(msg) {
      const el = document.createElement('div');
      el.textContent = msg;
      el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--success);color:#fff;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:999';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2000);
    }

    async function deployServer() {
      if (!confirm('Deploy all endpoints? This will generate the full Xray server config from secure.json, push it to this VPS, and restart Xray. Existing manual config changes will be overwritten.')) return;
      showToast('Deploying...');
      try {
        const r = await fetch('/api/admin/vps/deploy-server' + vpsQ(), {
          method: 'POST',
          credentials: 'include',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({}),
        });
        const data = await r.json();
        if (data.ok) {
          const ibList = (data.inbounds || []).map(ib => ib.tag + ':' + ib.port + ' (' + ib.clients + ' clients)').join(', ');
          showToast('Deployed: ' + ibList);
          setTimeout(() => location.reload(), 2000);
        } else {
          alert('Deploy failed: ' + (data.error || 'Unknown error'));
        }
      } catch(e) { alert('Deploy failed: ' + e); }
    }

    async function loadXrayConfig() {
      try {
        const r = await fetch('/api/admin/vps/xray/config' + vpsQ(), {credentials:'include'});
        const text = await r.text();
        document.getElementById('xray-config-editor').value = text;
        document.getElementById('xray-config-card').style.display = 'block';
      } catch(e) { alert('Failed to load config: ' + e); }
    }

    async function saveXrayConfig() {
      const config = document.getElementById('xray-config-editor').value;
      try {
        const r = await fetch('/api/admin/vps/xray/config' + vpsQ(), {
          method: 'POST',
          credentials: 'include',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({config})
        });
        const result = await r.json();
        if (result.ok) {
          showToast('Config saved. Restarting...');
          await fetch('/api/admin/vps/xray/restart' + vpsQ(), {method:'POST',credentials:'include'});
          setTimeout(() => location.reload(), 3000);
        } else {
          alert('Validation failed: ' + (result.error || 'Unknown error'));
        }
      } catch(e) { alert('Failed to save config: ' + e); }
    }

    async function loadXrayLogs() {
      try {
        const vps = new URLSearchParams(location.search).get('vps');
        const logUrl = vps ? '/api/admin/vps/xray/logs?lines=100&vps=' + encodeURIComponent(vps) : '/api/admin/vps/xray/logs?lines=100';
        const r = await fetch(logUrl, {credentials:'include'});
        const data = await r.json();
        const content = (data.logs || []).map(l => l.timestamp ? l.timestamp + '  ' + l.message : l.message).join('\\n');
        document.getElementById('xray-logs-content').textContent = content;
        document.getElementById('xray-logs-card').style.display = 'block';
      } catch(e) { alert('Failed to load logs: ' + e); }
    }

    async function checkXrayUpdate() {
      const card = document.getElementById('xray-update-card');
      const content = document.getElementById('xray-update-content');
      card.style.display = 'block';
      content.innerHTML = '<div style="color:var(--text-muted)">Checking for updates...</div>';
      try {
        const r = await fetch('/api/admin/vps/xray/check-update' + vpsQ(), {credentials:'include'});
        const data = await r.json();
        if (data.error) {
          content.innerHTML = '<div style="color:var(--error)">Error: ' + escapeHtml(data.error) + '</div>';
          return;
        }
        const current = data.current_version || '';
        const releases = data.releases || [];
        const stable = releases.filter(r => !r.prerelease);
        const pre = releases.filter(r => r.prerelease);

        let html = '<div style="margin-bottom:12px;font-size:13px">Current: <strong>' + escapeHtml(current) + '</strong></div>';
        html += '<div style="display:flex;gap:4px;margin-bottom:12px">';
        html += '<button class="btn btn-sm btn-primary" id="tab-stable" onclick="showReleaseTab(&apos;stable&apos;)">Stable (' + stable.length + ')</button>';
        html += '<button class="btn btn-sm btn-ghost" id="tab-pre" onclick="showReleaseTab(&apos;pre&apos;)">Pre-release (' + pre.length + ')</button>';
        html += '</div>';
        html += '<div id="releases-stable" class="release-list">';
        html += renderReleases(stable, current);
        html += '</div>';
        html += '<div id="releases-pre" class="release-list" style="display:none">';
        html += renderReleases(pre, current);
        html += '</div>';
        content.innerHTML = html;
      } catch(e) {
        content.innerHTML = '<div style="color:var(--error)">Failed to check: ' + escapeHtml(String(e)) + '</div>';
      }
    }

    function renderReleases(list, current) {
      if (!list.length) return '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">No releases found</div>';
      return list.map(r => {
        const isCurrent = r.version === current;
        const newer = versionNewer(r.version, current);
        const tag = isCurrent ? '<span class="tag tag-info" style="margin-left:6px;font-size:10px">Installed</span>' :
                    newer ? '<span class="tag tag-success" style="margin-left:6px;font-size:10px">Newer</span>' : '';
        const date = r.published_at ? new Date(r.published_at).toLocaleDateString() : '';
        let notes = '';
        if (r.release_notes) {
          const truncated = r.release_notes.length > 300 ? r.release_notes.slice(0, 300) + '...' : r.release_notes;
          notes = '<details style="margin-top:6px"><summary style="cursor:pointer;font-size:11px;color:var(--text-secondary)">Release notes</summary><pre style="margin-top:4px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:11px;max-height:150px;overflow:auto;white-space:pre-wrap">' + escapeHtml(r.release_notes) + '</pre></details>';
        }
        const btn = isCurrent ? '' :
          '<button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="performXrayUpdate(&apos;' + escapeHtml(r.version) + '&apos;)">Install v' + escapeHtml(r.version) + '</button>';
        return '<div style="padding:10px 0;border-bottom:1px solid var(--border)">' +
          '<div style="display:flex;align-items:center;gap:6px"><strong style="font-size:14px">v' + escapeHtml(r.version) + '</strong>' + tag +
          '<span style="font-size:11px;color:var(--text-muted);margin-left:auto">' + date + '</span></div>' +
          notes + btn + '</div>';
      }).join('');
    }

    function versionNewer(a, b) {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0, nb = pb[i] || 0;
        if (na > nb) return true;
        if (na < nb) return false;
      }
      return false;
    }

    function showReleaseTab(tab) {
      document.getElementById('releases-stable').style.display = tab === 'stable' ? 'block' : 'none';
      document.getElementById('releases-pre').style.display = tab === 'pre' ? 'block' : 'none';
      document.getElementById('tab-stable').className = tab === 'stable' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
      document.getElementById('tab-pre').className = tab === 'pre' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
    }

    async function performXrayUpdate(version) {
      if (!confirm('Update Xray to v' + version + '? Service will restart.')) return;
      const content = document.getElementById('xray-update-content');
      content.innerHTML = '<div style="color:var(--text-muted)">Downloading and installing v' + escapeHtml(version) + '... Do not close this page.</div>';
      try {
        const r = await fetch('/api/admin/vps/xray/update' + vpsQ(), {
          method: 'POST',
          credentials: 'include',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({version})
        });
        const data = await r.json();
        if (data.ok) {
          content.innerHTML = '<div style="color:var(--success);font-weight:600;margin-bottom:8px">Update complete!</div>' +
            '<div style="font-size:13px">Old: ' + escapeHtml(data.old_version||'?') + ' &rarr; New: <strong>' + escapeHtml(data.new_version||'?') + '</strong></div>';
          setTimeout(() => location.reload(), 2000);
        } else {
          content.innerHTML = '<div style="color:var(--error);font-weight:600;margin-bottom:8px">Update failed</div>' +
            '<div style="font-size:12px;color:var(--text-secondary)">' + escapeHtml(data.error||'Unknown error') + '</div>' +
            '<div style="margin-top:8px;font-size:12px;color:var(--text-muted)">Automatic rollback was attempted.</div>';
        }
      } catch(e) {
        content.innerHTML = '<div style="color:var(--error)">Request failed: ' + escapeHtml(String(e)) + '</div>';
      }
    }

    async function loadVpsProcesses() {
      try {
        const r = await fetch('/api/admin/vps/processes' + vpsQ(), {credentials:'include'});
        const data = await r.json();
        const text = (data.processes || []).map(p => {
          return [p.user, p.pid, p.cpu, p.mem, p.command].filter(Boolean).join('\t');
        }).join('\n');
        document.getElementById('vps-processes-content').textContent = text || 'No process data';
        document.getElementById('vps-processes-card').style.display = 'block';
      } catch(e) { alert('Failed to load processes: ' + e); }
    }

    async function loadVpsConnections() {
      try {
        const r = await fetch('/api/admin/vps/connections' + vpsQ(), {credentials:'include'});
        const data = await r.json();
        const text = (data.connections || []).map(c => {
          return [c.proto, c.local, c.foreign, c.state].filter(Boolean).join('\t');
        }).join('\n');
        document.getElementById('vps-connections-content').textContent = text || 'No connection data';
        document.getElementById('vps-connections-card').style.display = 'block';
      } catch(e) { alert('Failed to load connections: ' + e); }
    }

    function escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    // ─── VPS Management ────────────────────────────────────────
    const vpsData = ${JSON.stringify(allVpsFull)};

    function showAddVps() {
      document.getElementById('vps-edit-id').value = '';
      document.getElementById('vps-label').value = '';
      document.getElementById('vps-host').value = '';
      document.getElementById('vps-port').value = '22';
      document.getElementById('vps-username').value = 'root';
      document.getElementById('vps-password').value = '';
      document.getElementById('vps-key').value = '';
      document.getElementById('vps-edit-form').style.display = 'block';
    }

    function editVps(id) {
      const vps = vpsData.find(v => v.id === id);
      if (!vps) return;
      document.getElementById('vps-edit-id').value = vps.id;
      document.getElementById('vps-label').value = vps.label || '';
      document.getElementById('vps-host').value = vps.host || '';
      document.getElementById('vps-port').value = vps.port || 22;
      document.getElementById('vps-username').value = vps.username || 'root';
      document.getElementById('vps-password').value = '';
      document.getElementById('vps-key').value = '';
      document.getElementById('vps-edit-form').style.display = 'block';
    }

    function cancelVpsEdit() {
      document.getElementById('vps-edit-form').style.display = 'none';
    }

    async function saveVps() {
      const editId = document.getElementById('vps-edit-id').value;
      const body = {
        id: editId || undefined,
        label: document.getElementById('vps-label').value.trim(),
        host: document.getElementById('vps-host').value.trim(),
        port: parseInt(document.getElementById('vps-port').value) || 22,
        username: document.getElementById('vps-username').value.trim() || 'root',
        password: document.getElementById('vps-password').value,
        private_key: document.getElementById('vps-key').value,
      };
      if (!body.host) return alert('Host is required');
      if (!body.label) return alert('Label is required');
      try {
        const r = await fetch('/api/admin/vps/config' + (editId ? '' : ''), {
          method: editId ? 'PUT' : 'POST',
          credentials: 'include',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body),
        });
        const data = await r.json();
        if (data.ok) {
          showToast('VPS saved. Reloading...');
          setTimeout(() => location.reload(), 1000);
        } else {
          alert('Error: ' + (data.error || 'Unknown'));
        }
      } catch(e) { alert('Failed: ' + e); }
    }

    async function deleteVps(id, label) {
      if (!confirm('Delete VPS "' + label + '"? This cannot be undone.')) return;
      try {
        const r = await fetch('/api/admin/vps/config', {
          method: 'DELETE',
          credentials: 'include',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({id}),
        });
        const data = await r.json();
        if (data.ok) {
          showToast('VPS deleted. Redirecting...');
          setTimeout(() => location.href = '/admin/vps', 1000);
        } else {
          alert('Error: ' + (data.error || 'Unknown'));
        }
      } catch(e) { alert('Failed: ' + e); }
    }

    // ─── Auto-refresh Xray status ─────────────────────────────
    let _autoRefresh = null;
    function startAutoRefresh() {
      if (_autoRefresh) return;
      _autoRefresh = setInterval(async () => {
        try {
          const r = await fetch('/api/admin/vps/xray/status' + vpsQ(), {credentials: 'include'});
          const data = await r.json();
          if (data.xray) {
            const dot = document.querySelector('.health-status-dot');
            const tag = dot?.parentElement?.querySelector('.tag');
            if (dot) dot.className = 'health-status-dot ' + (data.xray.running ? 'alive' : 'dead');
            if (tag) {
              tag.className = 'tag ' + (data.xray.running ? 'tag-success' : 'tag-error');
              tag.textContent = data.xray.running ? 'Running' : 'Stopped';
            }
          }
        } catch(e) { /* silently ignore */ }
      }, 15000);
    }
    // Start auto-refresh when page is idle
    setTimeout(startAutoRefresh, 30000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { clearInterval(_autoRefresh); _autoRefresh = null; }
      else if (!document.hidden) startAutoRefresh();
    });
    </script>`,
  );
}

export function accountPage(input: { displayName: string; subUrl: string; slots: LinkSlot[]; token?: string; smartDnsClient?: SmartDnsClient | null; smartDnsMobileconfigUrl?: string }): string {
  const initials = input.displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const slotsHtml = input.slots
    .map((slot) => {
      if (!slot.available || !slot.url) {
        return `<div class="link-item">
          <div class="link-item-header">
            <span class="link-item-label">${escapeHtml(slot.label)}</span>
            <span class="tag tag-error">${escapeHtml(slot.reason || "not configured")}</span>
          </div>
        </div>`;
      }
      return `<div class="link-item">
        <div class="link-item-header">
          <span class="link-item-label">${escapeHtml(slot.label)}</span>
          <span class="tag tag-success">Available</span>
        </div>
        <div class="link-item-url">${escapeHtml(slot.url)}</div>
        <div class="link-item-actions">
          <button class="btn btn-secondary btn-sm" onclick="copyText('${escapeHtml(slot.url)}')">Copy</button>
        </div>
      </div>`;
    })
    .join("");

  const availableCount = input.slots.filter((s) => s.available).length;
  const subDeeplink = happDeeplink(input.subUrl);

  return page(
    "VPN Account",
    `<nav class="nav">
      <div class="nav-brand">
        <h1>BezVPN</h1>
        <span class="nav-badge user">User</span>
      </div>
      <div class="nav-actions">
        <form method="post" action="/api/logout" style="display:inline"><button class="btn btn-ghost btn-sm" type="submit">Logout</button></form>
      </div>
    </nav>

    <div class="page-header" style="display:flex;align-items:center;gap:16px">
      <div class="user-avatar" style="width:52px;height:52px;font-size:20px">${escapeHtml(initials)}</div>
      <div>
        <h2>${escapeHtml(input.displayName)}</h2>
        <p>${availableCount} of ${input.slots.length} endpoints available</p>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h3>Subscription URL</h3></div>
      <div class="sub-box">
        <div class="sub-url">${escapeHtml(input.subUrl)}</div>
        <div class="sub-actions">
          <button class="btn btn-primary btn-sm" onclick="copyText('${escapeHtml(input.subUrl)}')">Copy URL</button>
          <button class="btn btn-secondary btn-sm" onclick="copyText('${escapeHtml(subDeeplink)}')">Happ deeplink</button>
          ${input.token ? `<button class="btn btn-ghost btn-sm" onclick="openQr('${escapeHtml(input.token)}')">QR Code</button>` : ""}
        </div>
      </div>
    </div>

    ${input.smartDnsClient ? `
    <div class="card">
      <div class="card-header"><h3>Smart DNS</h3><span class="tag ${input.smartDnsClient.enabled ? "tag-success" : "tag-error"}">${input.smartDnsClient.enabled ? "Enabled" : "Disabled"}</span></div>
      <p style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">SmartDNS помогает при DNS/IP-блокировках, но не заменяет VPN. Telegram, Discord, YouTube и Instagram при активном DPI требуют Xray/VPN/SmartRelay.</p>
      ${input.smartDnsMobileconfigUrl ? `
      <div class="sub-box">
        <div class="sub-url">${escapeHtml(input.smartDnsMobileconfigUrl)}</div>
        <div class="sub-actions">
          <a class="btn btn-primary btn-sm" href="${escapeHtml(input.smartDnsMobileconfigUrl)}">Download iOS/macOS profile</a>
          <button class="btn btn-secondary btn-sm" onclick="copyText('${escapeHtml(input.smartDnsMobileconfigUrl)}')">Copy link</button>
        </div>
      </div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:10px">Open this link on iPhone/iPad/macOS and install the downloaded profile in Settings.</p>
      ` : `<p style="font-size:13px;color:var(--text-muted)">Smart DNS is disabled.</p>`}
    </div>
    ` : ""}

    <div class="card">
      <div class="card-header"><h3>Individual links</h3></div>
      <div class="link-list">${slotsHtml || '<div style="color:var(--text-muted);font-size:13px">No links available</div>'}</div>
    </div>

    ${qrModal()}`,
  );
}


function textList(values: string[]): string {
  return values.join("\n");
}

function smartEdgeTargetCard(target: SmartEdgeTarget, activeEdgeId: string): string {
  const isActive = target.id === activeEdgeId;
  const routes = [
    ...target.specialRoutes.map((route) => `${route.sni} -> ${route.backend}`),
    ...target.ownSni.map((sni) => `${sni} -> ${target.ownBackend}`),
    `default -> ${target.edgeBackend}`,
  ];
  return `<div class="card" style="border-color:${isActive ? "var(--success)" : "var(--border)"}">
    <div class="card-header">
      <h3>${escapeHtml(target.label)}</h3>
      <span class="tag ${isActive ? "tag-success" : "tag-neutral"}">${isActive ? "PRIMARY" : "standby"}</span>
    </div>
    <div style="display:grid;grid-template-columns:140px 1fr;gap:7px;font-size:13px">
      <div style="color:var(--text-muted)">target</div><div><code>${escapeHtml(target.id)}</code></div>
      <div style="color:var(--text-muted)">ssh</div><div><code>${escapeHtml(target.sshUser)}@${escapeHtml(target.sshHost)}</code></div>
      <div style="color:var(--text-muted)">edge IP</div><div><code>${escapeHtml(target.publicIp)}</code></div>
      <div style="color:var(--text-muted)">stream config</div><div><code>${escapeHtml(target.streamConfigPath)}</code></div>
    </div>
    <details style="margin-top:10px"><summary>routes</summary><pre style="white-space:pre-wrap;font-size:12px">${escapeHtml(routes.join("\n"))}</pre></details>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
      <form method="post" action="/api/admin/smart-edge/deploy"><input type="hidden" name="targetId" value="${escapeHtml(target.id)}"><button class="btn btn-primary btn-sm" type="submit">Deploy / repair here</button></form>
      ${isActive
        ? '<button class="btn btn-secondary btn-sm" type="button" disabled aria-disabled="true">Already primary</button>'
        : `<form method="post" action="/api/admin/smart-edge/select-primary"><input type="hidden" name="targetId" value="${escapeHtml(target.id)}"><button class="btn btn-success btn-sm" type="submit">Set primary DNS edge</button></form>`}
      <form method="post" action="/api/admin/smart-edge/validate"><input type="hidden" name="targetId" value="${escapeHtml(target.id)}"><button class="btn btn-secondary btn-sm" type="submit">Validate</button></form>
    </div>
  </div>`;
}

const RESTRICTED_STATUS_STALE_AFTER_MS = 90 * 60 * 1000;

interface RestrictedProbeLaneView {
  id: string;
  label: string;
  description: string;
}

function safeExternalHttpHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function restrictedProbeCell(result: RestrictedServiceProbeResult | undefined): string {
  if (!result) return '<span class="tag tag-neutral" title="Для этой полосы нет результата">нет измерения</span>';
  const attempts = Number.isInteger(result.attempts) && result.attempts >= 0 ? result.attempts : 0;
  const successes = Number.isInteger(result.successes) && result.successes >= 0 ? result.successes : 0;
  const attemptText = attempts > 0 ? ` · ${escapeHtml(successes)}/${escapeHtml(attempts)} попыток` : "";
  const errorTitle = escapeHtml(result.error ?? "нет диагностического сообщения");
  if (attempts === 0) return `<span class="tag tag-neutral" title="${errorTitle}">пропущено</span>`;

  const stability = String(result.stability);
  if (stability === "flaky") {
    return `<span class="tag tag-warning" title="${errorTitle}">нестабильно${attemptText}</span>`;
  }
  if (stability === "down") {
    return `<span class="tag tag-error" title="${errorTitle}">недоступно${attemptText}</span>`;
  }
  if (stability !== "stable" || !result.reachable) {
    return `<span class="tag tag-neutral" title="Неизвестное или противоречивое состояние: ${escapeHtml(stability)}">нет измерения</span>`;
  }

  const code = Number.isInteger(result.httpCode) ? `HTTP ${escapeHtml(result.httpCode)}` : "TLS/HTTP доступен";
  const latency = Number.isFinite(result.latencyMs) && result.latencyMs !== null ? ` · ${escapeHtml(result.latencyMs)} ms` : "";
  const remoteIp = result.remoteIp ? ` · remote ${result.remoteIp}` : "";
  return `<span class="tag tag-success" title="${escapeHtml(`Доступен${remoteIp}`)}">стабильно · ${code}${latency}</span>`;
}

function restrictedStatusMeta(view: RestrictedServicesView, statusError?: string): string {
  if (statusError) return `<span class="tag tag-warning">ошибка status-файла</span><br><span>${escapeHtml(statusError)}</span>`;
  if (!view.status) {
    return '<span class="tag tag-neutral" title="Waiting for the first scheduled probe.">нет измерения</span><br><span>Первый probe ещё не запускался.</span>';
  }
  const generatedMs = Date.parse(view.status.generatedAt);
  const ageMs = Date.now() - generatedMs;
  const invalidTime = !Number.isFinite(generatedMs) || ageMs < -5 * 60 * 1000;
  const catalogChanged = view.status.catalogUpdatedAt !== view.catalog.updatedAt;
  const stale = invalidTime || ageMs > RESTRICTED_STATUS_STALE_AFTER_MS || catalogChanged;
  const state = stale ? '<span class="tag tag-warning">устарело</span>' : '<span class="tag tag-success">актуально</span>';
  const reason = invalidTime
    ? " · некорректное время"
    : catalogChanged
      ? " · каталог изменён после замера"
      : "";
  return `${state}${reason}<br>Последний запуск: <code>${escapeHtml(view.status.generatedAt)}</code> · ${escapeHtml(view.status.durationMs)} ms`;
}

function restrictedSourceEvidence(view: RestrictedServicesView): string {
  const feedStatus = new Map(Array.isArray(view.status?.feeds) ? view.status.feeds.map((feed) => [feed.id, feed]) : []);
  return view.catalog.sources.map((source) => {
    const href = safeExternalHttpHref(source.homepage);
    const sourceName = href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"><code>${escapeHtml(source.repository)}</code></a>`
      : `<code>${escapeHtml(source.repository)}</code>`;
    const feeds = source.feeds.map((feed) => {
      const status = feedStatus.get(feed.id);
      if (!status) return `<span class="tag tag-neutral">${escapeHtml(feed.id)}: нет данных</span>`;
      if (status.state === "skipped") return `<span class="tag tag-neutral" title="${escapeHtml(status.error ?? "fetch отключён")}">${escapeHtml(feed.id)}: пропущен</span>`;
      if (status.state === "error" || status.error) return `<span class="tag tag-warning" title="${escapeHtml(status.error ?? "ошибка источника")}">${escapeHtml(feed.id)}: источник недоступен</span>`;
      return `<span class="tag tag-info" title="Получено ${escapeHtml(status.fetchedAt ?? "время неизвестно")}">${escapeHtml(feed.id)}: ${escapeHtml(status.ruleCount)} правил</span>`;
    }).join(" ");
    return `<div>${sourceName} · справочный источник · refresh ${escapeHtml(source.refreshHours)}h<br>${feeds}</div>`;
  }).join("");
}

function restrictedServicesCard(view: RestrictedServicesView, statusError?: string): string {
  const statusRows = new Map(Array.isArray(view.status?.rows) ? view.status.rows.map((row) => [row.id, row]) : []);
  const catalogLanes: RestrictedProbeLaneView[] = [
    { id: "direct_ru", label: "RU напрямую", description: "HTTPS с российского выхода без обхода" },
    { id: "lan_sni", label: `LAN Xray ${view.catalog.lanEdgeIp}`, description: "Локальный SNI gateway; доступен только внутри LAN" },
    ...view.catalog.publicEdges.map((edge) => ({
      id: edge.id,
      label: `${edge.label} · Remote Edge`,
      description: `Публичный Smart Edge ${edge.ip}; проба web-front не означает DPI bypass`,
    })),
    ...view.catalog.lanProxies.map((proxy) => ({
      id: proxy.id,
      label: proxy.label,
      description: `Отдельная HTTP proxy полоса ${proxy.url}; не объединяется с SNI probe`,
    })),
  ];
  const catalogLaneDescriptions = new Map(catalogLanes.map((lane) => [lane.id, lane.description]));
  const lanes: RestrictedProbeLaneView[] = view.status?.laneDefinitions?.length
    ? view.status.laneDefinitions.map((lane) => ({
      id: lane.id,
      label: lane.label,
      description: catalogLaneDescriptions.get(lane.id) ?? `Отдельная ${lane.kind} probe-полоса`,
    }))
    : catalogLanes;
  const routeBadge = (route: RestrictedServiceDefinition["route"]): string => route === "local-proxy"
    ? `<span class="tag tag-warning">Только локальная сеть</span><br><small style="color:var(--text-muted)">через Xray ${escapeHtml(view.catalog.lanEdgeIp)}</small>`
    : route === "proxy"
      ? '<span class="tag tag-info">LAN + Remote Smart Edge</span>'
      : '<span class="tag tag-neutral">Только наблюдение</span>';
  const serviceRow = (service: RestrictedServiceDefinition): string => {
    const status = statusRows.get(service.id);
    const externalFeeds = Array.isArray(status?.externalFeeds) ? status.externalFeeds : [];
    return `<tr>
      <td><strong>${escapeHtml(service.label)}</strong><br><small style="color:var(--text-muted)">${escapeHtml(service.restriction)}</small><details><summary style="font-size:11px">проверенные доменные группы (${escapeHtml(service.domains.length)})</summary><code style="font-size:11px">${escapeHtml(service.domains.join(", "))}</code></details></td>
      <td>${routeBadge(service.route)}</td>
      ${lanes.map((lane) => `<td>${restrictedProbeCell(status?.lanes?.[lane.id])}</td>`).join("")}
      <td>${externalFeeds.length ? externalFeeds.map((feed) => `<span class="tag tag-info">${escapeHtml(feed)}</span>`).join(" ") : '<span class="tag tag-neutral">совпадений корня нет</span>'}</td>
    </tr>`;
  };
  const sectionRows = (route: "local-proxy" | "other", title: string): string => {
    const services = view.catalog.services.filter((service) => route === "local-proxy" ? service.route === route : service.route !== "local-proxy");
    if (!services.length) return "";
    return `<tr><th colspan="${lanes.length + 3}" style="text-align:left;background:var(--bg-elevated)">${escapeHtml(title)} · ${escapeHtml(services.length)}</th></tr>${services.map(serviceRow).join("")}`;
  };
  const laneSummary = lanes.map((lane) => {
    const summary = view.status?.summary?.[lane.id];
    if (summary) {
      return `${escapeHtml(lane.label)}: <strong>${escapeHtml(summary.stable)}</strong> стабильно, ${escapeHtml(summary.flaky)} нестабильно, ${escapeHtml(summary.down)} недоступно, ${escapeHtml(summary.skipped)} пропущено`;
    }
    const results = view.catalog.services.map((service) => statusRows.get(service.id)?.lanes?.[lane.id]);
    const measured = results.filter((result) => result && result.attempts > 0).length;
    const reachable = results.filter((result) => result?.reachable && result.attempts > 0).length;
    return `${escapeHtml(lane.label)}: <strong>${escapeHtml(reachable)}/${escapeHtml(measured)}</strong> доступно`;
  }).join(" · ");

  return `<details class="card" id="restricted-services">
    <summary class="card-header"><h3>Активный список ограниченных сервисов</h3><span class="tag tag-info">probe каждый час</span></summary>
    <p style="font-size:13px;color:var(--text-secondary)">Каталог задаёт проверенную политику маршрута. Внешние feeds — только справочные сигналы, а HTTPS-probe — свидетельство здоровья конкретной полосы. Совпадение policy не доказывает доступность приложения.</p>
    <p style="font-size:12px;color:var(--text-muted);margin-top:8px">HTTP-ответ, включая 403, считается <strong style="color:var(--success)">reachable</strong>: TCP/TLS и web-front ответили. Это не проверка звонков, MTProto, media CDN, QUIC, push или полного app-flow.</p>
    <div style="display:grid;grid-template-columns:minmax(280px,1fr) minmax(280px,1fr);gap:16px;font-size:12px;color:var(--text-muted);margin:12px 0"><div>${restrictedSourceEvidence(view)}</div><div>${restrictedStatusMeta(view, statusError)}<br>${view.status ? laneSummary : ""}</div></div>
    <div style="overflow-x:auto"><table><thead><tr><th>Сервис</th><th>Маршрут</th>${lanes.map((lane) => `<th title="${escapeHtml(lane.description)}">${escapeHtml(lane.label)}</th>`).join("")}<th>Внешние feeds</th></tr></thead><tbody>${sectionRows("local-proxy", "Только локальная сеть: DPI/SNI обходится локальным Xray")}${sectionRows("other", "Remote Smart Edge / наблюдение")}</tbody></table></div>
  </details>`;
}

export function smartDnsPage(input: {
  policy: SmartDnsPolicy;
  check?: SmartDnsRouteCheck;
  smartEdge?: SmartEdgeConfig;
  serviceCatalog?: { catalog: ServiceCatalog; targets: ServiceTargetCapability[] };
  restrictedServices?: RestrictedServicesView;
  restrictedServicesStatusError?: string;
  error?: string;
  edgeMessage?: string;
  edgeError?: string;
}): string {
  const policy = input.policy;
  const routeColor = input.check?.route === "proxy" || input.check?.route === "vusa-proxy" ? "var(--primary)" : input.check?.route === "local-proxy" ? "var(--warning)" : "var(--success)";
  const routeTag = input.check?.route === "proxy" || input.check?.route === "vusa-proxy" ? "tag-info" : input.check?.route === "local-proxy" ? "tag-warning" : "tag-success";
  const verdict = input.check?.route === "local-proxy"
    ? { title: "Да — только в локальной сети.", detail: "LAN DNS направляет домен в локальный Xray SNI gateway. Публичный SmartDNS оставляет домен direct, поэтому это не внешний DPI-bypass." }
    : input.check?.route === "vusa-proxy"
      ? { title: "Да — проксируется через VUSA (US), не через VPN2.", detail: "И LAN, и публичный SmartDNS выбирают VUSA edge для этого домена." }
      : input.check?.route === "proxy"
        ? { title: "Да — проксируется через Smart Edge.", detail: "И LAN, и публичный SmartDNS выбирают proxy-маршрут для этого домена." }
        : input.check
          ? { title: "Нет — домен идёт напрямую.", detail: "И LAN, и публичный SmartDNS возвращают direct-маршрут для этого домена." }
          : null;
  const checkHtml = input.check
    ? `<div class="card" role="status" aria-live="polite" style="border-color:${routeColor}">
        <div class="card-header"><h3>Проверка маршрута</h3><span class="tag ${routeTag}">${escapeHtml(input.check.route.toUpperCase())}</span></div>
        <p style="margin:0 0 10px"><strong>${escapeHtml(verdict!.title)}</strong><br><span style="color:var(--text-secondary);font-size:13px">${escapeHtml(verdict!.detail)}</span></p>
        <div style="display:grid;grid-template-columns:160px 1fr;gap:8px;font-size:13px">
          <div style="color:var(--text-muted)">Input</div><div><code>${escapeHtml(input.check.input)}</code></div>
          <div style="color:var(--text-muted)">Host</div><div><code>${escapeHtml(input.check.host)}</code></div>
          <div style="color:var(--text-muted)">Reason</div><div>${escapeHtml(input.check.reason)}</div>
          <div style="color:var(--text-muted)">Matched</div><div><code>${escapeHtml(input.check.matched ?? "—")}</code></div>
          <div style="color:var(--text-muted)">LAN</div><div><span class="tag ${input.check.localRoute === "proxy" ? "tag-info" : "tag-success"}">${escapeHtml(input.check.localRoute.toUpperCase())}</span></div>
          <div style="color:var(--text-muted)">PUBLIC</div><div><span class="tag ${input.check.publicRoute === "proxy" ? "tag-info" : "tag-success"}">${escapeHtml(input.check.publicRoute.toUpperCase())}</span></div>
        </div>
      </div>`
    : "";
  const serviceCatalogHtml = input.serviceCatalog
    ? `<details class="card" id="service-catalog">
        <summary class="card-header"><h3>Service routes (draft)</h3><span class="tag tag-warning">not active</span></summary>
        <p style="font-size:13px;color:var(--warning)">Saved changes are drafts only and do not activate DNS/Xray until a later Apply step.</p>
        ${serviceCatalogEditor({ catalog: input.serviceCatalog.catalog, targets: input.serviceCatalog.targets, saveAction: "/api/admin/service-catalog" }).replace('id="service-catalog"', 'id="service-catalog-editor"')}
      </details>`
    : "";

  return page(
    "Smart DNS",
    `<nav class="nav">
      <div class="nav-brand"><h1>BezVPN</h1><span class="nav-badge admin">Smart DNS</span></div>
      <div class="nav-actions">
        <a class="btn btn-secondary" href="/admin">Admin</a>
        <form method="post" action="/api/logout"><button class="btn btn-ghost">Logout</button></form>
      </div>
    </nav>

    <div class="page-header">
      <h2>Smart DNS routing</h2>
      <p>Глобальная DNS-политика для всех клиентов: direct / Smart Edge selection. Это не полный VPN-туннель.</p>
    </div>

    <div class="card" style="border-color:var(--warning)">
      <div class="card-header"><h3>Граница применимости</h3><span class="tag tag-warning">DNS ≠ app E2E</span></div>
      <p style="font-size:13px;color:var(--text-secondary)">SmartDNS хорошо работает против DNS/IP-ограничений, если дальнейший протокол не блокируется DPI. Успешный DNS-ответ или маршрут <code>proxy</code> подтверждает только DNS/control-plane. Сервисы с политикой <code>local-proxy</code> при активном SNI/DPI через публичный Smart Edge считаются неподдерживаемыми и направляются только на LAN Xray.</p>
    </div>

    ${input.restrictedServices ? restrictedServicesCard(input.restrictedServices, input.restrictedServicesStatusError) : ""}

    ${serviceCatalogHtml}

    ${input.error ? `<div class="card" style="border-color:var(--error);color:var(--error)">${escapeHtml(input.error)}</div>` : ""}
    ${input.edgeMessage ? `<div class="card" style="border-color:var(--success);color:var(--success)">${escapeHtml(input.edgeMessage)}</div>` : ""}
    ${input.edgeError ? `<div class="card" style="border-color:var(--error);color:var(--error)">${escapeHtml(input.edgeError)}</div>` : ""}

    ${input.smartEdge ? `<div class="card">
      <div class="card-header"><h3>Smart Edge VPS deploy</h3><span class="tag tag-info">primary ${escapeHtml(input.smartEdge.state.activeEdgeId)}</span></div>
      <p style="font-size:13px;color:var(--text-muted)">Кнопки ниже переустанавливают SNI edge на VPS и переключают public edge profile в едином Smart DNS на worker-main. Custom targets можно добавить в <code>${escapeHtml(input.smartEdge.targetsPath)}</code>.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px">
        ${input.smartEdge.targets.map((target) => smartEdgeTargetCard(target, input.smartEdge!.state.activeEdgeId)).join("")}
      </div>
      ${input.smartEdge.state.lastAction ? `<details style="margin-top:12px"><summary>Last action: ${escapeHtml(input.smartEdge.state.lastAction)} / ${escapeHtml(input.smartEdge.state.lastActionStatus ?? "")}</summary><pre style="white-space:pre-wrap;font-size:12px">${escapeHtml(input.smartEdge.state.lastActionOutput ?? "")}</pre></details>` : ""}
    </div>` : ""}

    <div class="card" id="smart-dns-check">
      <div class="card-header"><h3>Проверить URL или домен</h3></div>
      <form method="get" action="/admin/smart-dns#smart-dns-check" style="display:flex;gap:10px;align-items:end">
        <div class="form-group" style="flex:1;margin-bottom:0">
          <label>URL / domain</label>
          <input class="input" name="check" placeholder="telegram.org / https://chatgpt.com / ya.ru" value="${escapeHtml(input.check?.input ?? "")}" ${input.check ? "" : "autofocus"}>
        </div>
        <button class="btn btn-primary" type="submit">Проверить маршрут</button>
      </form>
      <p style="margin:10px 0 0;font-size:13px;color:var(--text-muted)">Примеры: <a href="/admin/smart-dns?check=antigravity.google#smart-dns-check">Antigravity (VUSA)</a> · <a href="/admin/smart-dns?check=chatgpt.com#smart-dns-check">ChatGPT</a> · <a href="/admin/smart-dns?check=instagram.com#smart-dns-check">Instagram (только LAN)</a> · <a href="/admin/smart-dns?check=ya.ru#smart-dns-check">ya.ru (direct)</a></p>
      ${checkHtml}
    </div>

    <form method="post" action="/api/admin/smart-dns/policy">
      <div class="card">
        <div class="card-header"><h3>Глобальная политика</h3><span class="tag tag-neutral">updated ${escapeHtml(policy.updatedAt ?? "never")}</span></div>
        <div class="form-group">
          <label>Default route для всего, что не совпало со списками</label>
          <select name="defaultRoute">
            <option value="proxy" ${policy.defaultRoute === "proxy" ? "selected" : ""}>proxy — Smart Edge candidate (не VPN и не DPI proof)</option>
            <option value="direct" ${policy.defaultRoute === "direct" ? "selected" : ""}>direct — всё неизвестное напрямую</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="form-group">
            <label>Direct suffixes, по одному на строку</label>
            <textarea class="input" name="directSuffixes" rows="10">${escapeHtml(textList(policy.directSuffixes))}</textarea>
          </div>
          <div class="form-group">
            <label>Proxy suffixes, по одному на строку</label>
            <textarea class="input" name="proxySuffixes" rows="10">${escapeHtml(textList(policy.proxySuffixes))}</textarea>
          </div>
          <div class="form-group">
            <label>Direct exact domains</label>
            <textarea class="input" name="directDomains" rows="8">${escapeHtml(textList(policy.directDomains))}</textarea>
          </div>
          <div class="form-group">
            <label>Proxy exact domains</label>
            <textarea class="input" name="proxyDomains" rows="8">${escapeHtml(textList(policy.proxyDomains))}</textarea>
          </div>
        </div>
      </div>

      <div class="card" style="border-color:var(--warning)">
        <div class="card-header"><h3>Только локальная сеть</h3><span class="tag tag-warning">local-proxy</span></div>
        <p style="font-size:13px;color:var(--text-secondary)">Эти домены получают <code>192.0.2.75</code> только через LAN DNS и идут в локальный Xray SNI gateway. Публичный SmartDNS отвечает для них напрямую: DNS не скрывает SNI, поэтому внешний DPI таким способом не обходится.</p>
        <div class="form-group">
          <label>Local default route для доменов вне явных списков</label>
          <select name="localDefaultRoute">
            <option value="direct" ${policy.localDefaultRoute === "direct" ? "selected" : ""}>direct — сохранить обычное LAN-поведение</option>
            <option value="proxy" ${policy.localDefaultRoute === "proxy" ? "selected" : ""}>proxy — отправлять всё неизвестное в LAN Xray</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="form-group">
            <label>Local-only suffixes, по одному на строку</label>
            <textarea class="input" name="localProxySuffixes" rows="12">${escapeHtml(textList(policy.localProxySuffixes))}</textarea>
          </div>
          <div class="form-group">
            <label>Local-only exact domains</label>
            <textarea class="input" name="localProxyDomains" rows="12">${escapeHtml(textList(policy.localProxyDomains))}</textarea>
          </div>
        </div>
      </div>

      <div class="card" style="border-color:var(--success)">
        <div class="card-header"><h3>Применить изменения</h3><span class="tag tag-success">глобальная policy</span></div>
        <p style="font-size:13px;color:var(--text-secondary)">Сохраняет все три раздела выше и ниже: global, только LAN и только VUSA.</p>
        <button class="btn btn-success" type="submit">Сохранить всю DNS-политику</button>
      </div>

      <div class="card" style="border-color:var(--primary)">
        <div class="card-header"><h3>Только VUSA</h3><span class="tag tag-info">vusa-proxy</span></div>
        <p style="font-size:13px;color:var(--text-secondary)">Эти домены на публичном SmartDNS получают только VUSA edge, а в LAN идут в Xray через пул <code>us-auto</code>. Это отдельный маршрут и он не использует VPN2/DE.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="form-group">
            <label>VUSA suffixes, по одному на строку</label>
            <textarea class="input" name="vusaProxySuffixes" rows="8">${escapeHtml(textList(policy.vusaProxySuffixes ?? []))}</textarea>
          </div>
          <div class="form-group">
            <label>VUSA exact domains</label>
            <textarea class="input" name="vusaProxyDomains" rows="8">${escapeHtml(textList(policy.vusaProxyDomains ?? []))}</textarea>
          </div>
        </div>
      </div>
    </form>

    <div class="card">
      <div class="card-header"><h3>Ожидаемые DNS-маршруты</h3></div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Результат ниже показывает решение policy engine, а не доступность сайта или приложения.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
        <div><code>telegram.org</code> → <span class="tag tag-info">proxy</span></div>
        <div><code>chatgpt.com</code> → <span class="tag tag-info">proxy</span></div>
        <div><code>instagram.com</code> → <span class="tag tag-warning">local-proxy</span></div>
        <div><code>youtube.com</code> → <span class="tag tag-warning">local-proxy</span></div>
        <div><code>ya.ru</code> → <span class="tag tag-success">direct</span></div>
        <div><code>yandex.ru</code> → <span class="tag tag-success">direct</span></div>
      </div>
    </div>`
  );
}

export function testsPage(input: {
  endpoints: Endpoint[];
  health: EndpointHealth[];
  scores?: VpnTestEndpointScore[];
  httpChecks?: TestHttpCheck[];
  testTargets?: TestTarget[];
}): string {
  return testDashboardPage({ ...input, scores: input.scores ?? [] });

  return page(
    "VPN Tests",
    `${sidebarHtml('/admin/tests')}
    <div class="main-content">
    <div style="margin-bottom:16px">
      <div style="display:flex;gap:8px;border-bottom:2px solid var(--border);padding-bottom:0">
        <button class="tab-btn active" data-tab="quick-test" onclick="switchTab('quick-test')">\u26A1 Quick Test</button>
        <button class="tab-btn" data-tab="health" onclick="switchTab('health')">\U0001F4CA Endpoint Health</button>
        <button class="tab-btn" data-tab="probe" onclick="switchTab('probe')">\U0001F50D Probe Results</button>
        <button class="tab-btn" data-tab="history" onclick="switchTab('history')">\U0001F4DA Test History</button>
      </div>
    </div>

    <div id="tab-quick-test" class="tab-content active">
      ${renderQuickTestTab()}
    </div>

    <div id="tab-health" class="tab-content">
      ${renderHealthTab(input)}
    </div>

    <div id="tab-probe" class="tab-content">
      ${renderProbeTab()}
    </div>

    <div id="tab-history" class="tab-content">
      ${renderVpnTestHistoryTab()}
    </div>

    <style>
      .tab-btn {
        background: none;
        border: none;
        padding: 12px 24px;
        font-size: 14px;
        font-weight: 500;
        color: var(--text-secondary);
        cursor: pointer;
        border-bottom: 3px solid transparent;
        transition: all 0.2s;
      }
      .tab-btn:hover {
        color: var(--text);
        background: var(--bg-elevated);
      }
      .tab-btn.active {
        color: var(--primary);
        border-bottom-color: var(--primary);
        font-weight: 600;
      }
      .tab-content {
        display: none;
        padding: 16px 0;
      }
      .tab-content.active {
        display: block;
      }
      .vpn-test-run {
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--bg-elevated);
        margin-bottom: 10px;
      }
      .vpn-test-run > summary {
        cursor: pointer;
        list-style: none;
        padding: 12px 14px;
      }
      .vpn-test-run > summary::-webkit-details-marker { display: none; }
      .vpn-test-stage {
        display: grid;
        grid-template-columns: minmax(120px, 1.2fr) minmax(110px, .8fr) minmax(80px, .6fr) 2fr auto;
        gap: 10px;
        align-items: center;
        padding: 9px 14px;
        border-top: 1px solid var(--border);
        font-size: 12px;
      }
      .vpn-outcome { display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;white-space:nowrap; }
      .vpn-outcome.fatal { color: var(--error); }
      .vpn-outcome.warning { color: var(--warning); }
      .vpn-outcome.ok { color: var(--success); }
      .vpn-outcome.pending { color: var(--text-muted); }
      @media (max-width: 900px) {
        .vpn-test-stage { grid-template-columns: 1fr 1fr; }
      }
    </style>

    <script>
    function switchTab(tabName) {
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
      });
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === 'tab-' + tabName);
      });
      if (tabName === 'probe') loadAllProbeResults();
      if (tabName === 'history') loadVpnTestHistory();
    }

    function runQuickTest() {
      const btn = document.getElementById('quick-test-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }
      postJson('/api/admin/endpoint-health/check', {}).then(r => {
        showToast('Quick test started (~30s)');
        pollQuickTestStatus();
      }).catch(e => {
        if (e.message && e.message.includes('already running')) {
          showToast('Quick test already running...');
          pollQuickTestStatus();
        } else {
          if (btn) { btn.disabled = false; btn.textContent = 'Run Quick Test'; }
          alert('Error: ' + e.message);
        }
      });
    }

    function pollQuickTestStatus() {
      const btn = document.getElementById('quick-test-btn');
      const startTime = Date.now();
      const poll = () => {
        fetch('/api/admin/endpoint-health/check/status', { headers: { 'Accept': 'application/json' } })
          .then(r => r.json()).then(data => {
            if (!data.running) {
              showToast('Quick test complete!');
              if (btn) { btn.disabled = false; btn.textContent = 'Run Quick Test'; }
              setTimeout(() => location.reload(), 1000);
            } else {
              const elapsed = Math.floor((Date.now() - startTime) / 1000);
              if (btn) { btn.textContent = 'Testing (' + elapsed + 's)...'; }
              setTimeout(poll, 3000);
            }
          }).catch(() => setTimeout(poll, 3000));
      };
      setTimeout(poll, 3000);
    }

    function runBenchmark() {
      const btn = document.getElementById('benchmark-btn');
      if (!confirm('Run full benchmark on VPS? This takes 2-5 minutes.')) return;
      if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }
      postJson('/api/admin/endpoint-health/benchmark', {}).then(r => {
        if (btn) { btn.textContent = 'Running...'; }
        showToast('Benchmark started on VPS');
        pollBenchmarkStatus();
      }).catch(e => {
        if (e.message && e.message.includes('already running')) {
          showToast('Benchmark already running');
          pollBenchmarkStatus();
        } else {
          if (btn) { btn.disabled = false; btn.textContent = 'Run Benchmark'; }
          alert('Error: ' + e.message);
        }
      });
    }

    function pollBenchmarkStatus() {
      const btn = document.getElementById('benchmark-btn');
      const benchmarkStart = Date.now();
      const poll = () => {
        fetch('/api/admin/endpoint-health/benchmark/status', { headers: { 'Accept': 'application/json' } })
          .then(r => r.json()).then(data => {
            if (!data.running) {
              showToast('Benchmark complete!');
              if (btn) { btn.disabled = false; btn.textContent = 'Run Benchmark'; }
              setTimeout(() => location.reload(), 1000);
            } else {
              const elapsed = Math.floor((Date.now() - benchmarkStart) / 1000);
              if (btn) { btn.textContent = 'Running (' + elapsed + 's)...'; }
              setTimeout(poll, 5000);
            }
          }).catch(() => setTimeout(poll, 5000));
      };
      setTimeout(poll, 5000);
    }

    function refreshHealth() {
      showToast('Refreshing health data...');
      setTimeout(() => location.reload(), 500);
    }

    function runProbe() {
      const btn = document.getElementById('run-probe-btn');
      const node = document.getElementById('probe-node').value;
      const engine = document.getElementById('probe-engine').value;
      if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }
      const logsDiv = document.getElementById('probe-logs');
      if (logsDiv) { logsDiv.innerHTML = ''; logsDiv.style.display = 'block'; }
      document.getElementById('probe-status').textContent = 'Starting probe...';
      fetch('/api/admin/probe/run?node=' + encodeURIComponent(node) + '&engine=' + encodeURIComponent(engine), {
        method: 'POST', credentials: 'include'
      }).then(r => r.json()).then(data => {
        if (data.error) {
          if (btn) { btn.disabled = false; btn.textContent = 'Run Probe'; }
          if (logsDiv) logsDiv.style.display = 'none';
          alert('Error: ' + data.error);
          return;
        }
        if (btn) { btn.textContent = 'Running...'; }
        document.getElementById('probe-status').textContent = 'Probe running (PID ' + data.pid + ')... Streaming logs below.';
        streamProbeLogs();
        pollProbeStatus();
      }).catch(e => {
        if (btn) { btn.disabled = false; btn.textContent = 'Run Probe'; }
        if (logsDiv) logsDiv.style.display = 'none';
        alert('Failed: ' + e.message);
      });
    }

    function streamProbeLogs() {
      const logsDiv = document.getElementById('probe-logs');
      if (!logsDiv) return;
      const eventSource = new EventSource('/api/admin/probe/logs');
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'init' || data.type === 'logs') {
            for (const log of data.logs) {
              const line = document.createElement('div');
              line.style.marginBottom = '2px';
              if (log.includes('[OK]') || log.includes('\u2713')) {
                line.style.color = 'var(--success)';
              } else if (log.includes('[FAIL]') || log.includes('\u2717') || log.includes('ERROR')) {
                line.style.color = 'var(--error)';
              } else if (log.includes('[WARN]')) {
                line.style.color = 'var(--warning)';
              } else if (log.includes('[DONE]')) {
                line.style.color = 'var(--success)';
                line.style.fontWeight = 'bold';
                line.style.marginTop = '8px';
              }
              line.textContent = log;
              logsDiv.appendChild(line);
            }
            logsDiv.scrollTop = logsDiv.scrollHeight;
          }
          if (data.type === 'done') eventSource.close();
        } catch (e) { console.error('Failed to parse log:', e); }
      };
      eventSource.onerror = (err) => { console.error('SSE error:', err); eventSource.close(); };
      window._probeEventSource = eventSource;
    }

    function pollProbeStatus() {
      const btn = document.getElementById('run-probe-btn');
      const poll = () => {
        fetch('/api/admin/probe/status', { credentials: 'include' })
          .then(r => r.json()).then(data => {
            if (data.status === 'running') {
              const elapsed = data.started_at ? Math.floor((Date.now() - new Date(data.started_at).getTime()) / 1000) : 0;
              if (btn) { btn.textContent = 'Running (' + elapsed + 's)...'; }
              document.getElementById('probe-status').textContent = 'Probe running... ' + elapsed + 's elapsed';
              setTimeout(poll, 5000);
            } else {
              if (btn) { btn.disabled = false; btn.textContent = 'Run Probe'; }
              document.getElementById('probe-status').textContent = 'Probe complete.';
              showToast('Probe complete!');
              loadAllProbeResults();
            }
          }).catch(() => setTimeout(poll, 5000));
      };
      setTimeout(poll, 5000);
    }

    function loadAllProbeResults() {
      fetch('/api/admin/probe/results?limit=50', { credentials: 'include' })
        .then(r => r.json()).then(data => {
          const container = document.getElementById('all-probe-results');
          if (!container) return;
          if (!data.results || data.results.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:20px;text-align:center">No probe results yet. Run a probe to test endpoints.</div>';
            return;
          }
          container.innerHTML = renderAllProbeResults(data.results, data.total);
        }).catch(e => {
          const container = document.getElementById('all-probe-results');
          if (container) container.innerHTML = '<div style="color:var(--error)">Failed to load: ' + e.message + '</div>';
        });
    }

    function loadVpnTestHistory() {
      const container = document.getElementById('vpn-test-history-runs');
      if (!container) return;
      container.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center">Loading test history...</div>';
      const params = new URLSearchParams();
      const filters = {
        networkClass: 'history-network-class', target: 'history-target', profile: 'history-profile',
        endpoint: 'history-endpoint', status: 'history-status', from: 'history-date-from', to: 'history-date-to'
      };
      for (const [key, id] of Object.entries(filters)) {
        const value = document.getElementById(id)?.value;
        if (value) params.set(key, key === 'from' || key === 'to' ? new Date(value).toISOString() : value);
      }
      params.set('limit', '100');
      fetch('/api/admin/vpn-tests/runs?' + params.toString(), { credentials: 'include' })
        .then(async response => {
          if (!response.ok) throw new Error(await response.text() || 'HTTP ' + response.status);
          return response.json();
        })
        .then(data => {
          const runs = Array.isArray(data) ? data : (data.runs || []);
          if (runs.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted);padding:24px;text-align:center">No runs match these filters.</div>';
            return;
          }
          container.innerHTML = runs.map(renderVpnTestRun).join('');
        })
        .catch(error => {
          container.innerHTML = '<div style="color:var(--error);padding:20px">Failed to load history: ' + escapeHtml(error.message) + '</div>';
        });
    }

    function vpnTestOutcome(item) {
      const declared = String(item.outcome_class || item.outcome || item.status || '').toLowerCase();
      const category = String(item.category || item.failure_category || '').toLowerCase();
      const code = Number(item.http_code ?? item.code ?? 0);
      if (['fatal', 'transport_error', 'timeout', 'unreachable', 'failed', 'error'].includes(declared) ||
          ['transport', 'dns', 'tcp', 'tls', 'tunnel'].includes(category) && ['failed', 'error', 'fatal'].includes(declared)) {
        return { kind: 'fatal', label: 'Fatal transport' };
      }
      if (['warning', 'auth', 'challenge', 'site_policy', 'blocked', 'degraded'].includes(declared) ||
          ['auth', 'challenge', 'site-policy', 'site_policy'].includes(category) || [401, 403, 407, 429].includes(code)) {
        return { kind: 'warning', label: 'Warning: auth / challenge / site policy' };
      }
      if (['ok', 'success', 'content_ok', 'passed'].includes(declared) || code >= 200 && code < 400) {
        return { kind: 'ok', label: 'Content OK' };
      }
      return { kind: 'pending', label: declared || 'In progress / unknown' };
    }

    function vpnTestArtifact(item) {
      const url = item.artifact_url || item.artifactUrl || item.payload?.artifact_url || '';
      if (!url) return '<span style="color:var(--text-muted)">\u2014</span>';
      try {
        const parsed = new URL(url, location.origin);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '<span style="color:var(--warning)">Unsupported artifact</span>';
        return '<a href="' + escapeHtml(parsed.href) + '" target="_blank" rel="noopener noreferrer">Artifact \u2197</a>';
      } catch { return '<span style="color:var(--warning)">Invalid artifact URL</span>'; }
    }

    function renderVpnTestRun(run) {
      const hasEmbeddedStages = Array.isArray(run.stages);
      const stages = hasEmbeddedStages ? run.stages : [];
      const outcome = vpnTestOutcome(run);
      const started = run.started_at || run.startedAt || run.timestamp;
      const target = run.target_id || run.target?.id || run.target || '?';
      const completed = stages.filter(stage => ['stage_finished', 'finished'].includes(stage.event_type || stage.type) || stage.finished_at).length;
      const endpointCount = new Set(stages.map(stage => stage.endpoint || stage.endpoint_id).filter(Boolean)).size;
      const stageSummary = hasEmbeddedStages ? endpointCount + ' endpoints \u00b7 ' + completed + '/' + stages.length + ' stages' : 'stages on demand';
      return '<details class="vpn-test-run" data-run-id="' + escapeHtml(run.run_id || run.runId || '') + '" ontoggle="loadVpnTestRunStages(this)">' +
        '<summary><div style="display:flex;justify-content:space-between;gap:12px;align-items:start;flex-wrap:wrap">' +
          '<div><strong>' + escapeHtml(run.run_id || run.runId || '?') + '</strong>' +
          '<div style="font-size:11px;color:var(--text-muted);margin-top:3px">' +
            escapeHtml(run.network_class || run.networkClass || run.target?.networkClass || '?') + ' \u00b7 ' + escapeHtml(target) +
            ' \u00b7 ' + escapeHtml(run.profile || '?') + ' \u00b7 ' + escapeHtml(started ? new Date(started).toLocaleString() : '?') +
          '</div></div>' +
          '<div style="display:flex;gap:10px;align-items:center"><span style="font-size:11px;color:var(--text-muted)">' +
            stageSummary + '</span>' +
            '<span class="vpn-outcome ' + outcome.kind + '">' + escapeHtml(outcome.label) + '</span>' + vpnTestArtifact(run) + '</div>' +
        '</div></summary><div data-stage-container>' + (hasEmbeddedStages ? renderVpnTestStages(stages) : '<div style="padding:12px 14px;color:var(--text-muted);border-top:1px solid var(--border)">Open to load stage events.</div>') + '</div></details>';
    }

    function loadVpnTestRunStages(details) {
      if (!details.open || details.dataset.loaded === 'true') return;
      const container = details.querySelector('[data-stage-container]');
      const runId = details.dataset.runId;
      if (!container || !runId) return;
      details.dataset.loaded = 'true';
      container.innerHTML = '<div style="padding:12px 14px;color:var(--text-muted);border-top:1px solid var(--border)">Loading stage events...</div>';
      fetch('/api/admin/vpn-tests/runs/' + encodeURIComponent(runId), { credentials: 'include' })
        .then(async response => {
          if (!response.ok) throw new Error(await response.text() || 'HTTP ' + response.status);
          return response.json();
        })
        .then(data => { container.innerHTML = renderVpnTestStages(data.events || []); })
        .catch(error => {
          details.dataset.loaded = 'false';
          container.innerHTML = '<div style="padding:12px 14px;color:var(--error);border-top:1px solid var(--border)">Failed to load stages: ' + escapeHtml(error.message) + '</div>';
        });
    }

    function renderVpnTestStages(stages) {
      if (stages.length === 0) return '<div style="padding:12px 14px;color:var(--text-muted);border-top:1px solid var(--border)">No stage events received.</div>';
      return stages.map(stage => {
        const payload = stage.payload || {};
        const outcome = vpnTestOutcome({ ...payload, ...stage });
        const code = stage.http_code ?? payload.http_code ?? stage.code ?? payload.code;
        const latency = stage.latency_ms ?? payload.latency_ms;
        const message = stage.message || payload.message || payload.error || '';
        return '<div class="vpn-test-stage">' +
          '<strong>' + escapeHtml(stage.endpoint || stage.endpoint_id || '\u2014') + '</strong>' +
          '<span>' + escapeHtml(stage.stage || stage.name || stage.event_type || '\u2014') + '</span>' +
          '<span>' + escapeHtml(code ? 'HTTP ' + code : (latency != null ? latency + ' ms' : '\u2014')) + '</span>' +
          '<span style="color:var(--text-secondary);overflow-wrap:anywhere">' + escapeHtml(message || '\u2014') + '</span>' +
          '<span style="display:flex;gap:10px;align-items:center"><span class="vpn-outcome ' + outcome.kind + '">' + escapeHtml(outcome.label) + '</span>' + vpnTestArtifact(stage) + '</span>' +
        '</div>';
      }).join('');
    }

    function renderAllProbeResults(results, total) {
      let html = '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Showing ' + results.length + ' of ' + total + ' results (newest first)</div>';
      for (const result of results) {
        if (!result.endpoints || result.endpoints.length === 0) continue;
        const timestamp = result.timestamp ? new Date(result.timestamp).toLocaleString() : 'Unknown';
        const node = result.node || '?';
        const ip = result.network_ip || '';
        const engine = result.engine || '?';
        const filename = result._filename || '';
        html += '<div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:12px">';
        html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">';
        html += '<span>' + escapeHtml(timestamp) + ' &nbsp;|&nbsp; ' + escapeHtml(node) + (ip ? ' (' + escapeHtml(ip) + ')' : '') + ' &nbsp;|&nbsp; Engine: ' + escapeHtml(engine) + '</span>';
        html += '<span style="font-family:monospace;font-size:10px">' + escapeHtml(filename) + '</span>';
        html += '</div>';
        html += renderProbeTable(result.endpoints);
        html += '</div>';
      }
      return html;
    }

    function renderProbeTable(endpoints) {
      const PROBE_SITES = ['chatgpt.com','youtube.com','telegram.org','instagram.com','discord.com','whatsapp.com'];
      const PROBE_SITE_LABELS = {'chatgpt.com':'ChatGPT','youtube.com':'YouTube','telegram.org':'Telegram','instagram.com':'Instagram','discord.com':'Discord','whatsapp.com':'WhatsApp'};
      const siteHeaders = PROBE_SITES.map(s => '<th style="font-size:10px;text-align:center;min-width:60px">' + (PROBE_SITE_LABELS[s] || s) + '</th>').join('');
      let rows = '';
      for (const ep of endpoints) {
        const tcpIcon = ep.tcp_reachable ? '<span style="color:var(--success)">\u2713</span>' : '<span style="color:var(--error)">\u2717</span>';
        const tunnelIcon = ep.tunnel_up ? '<span style="color:var(--success)">\u2713</span>' : '<span style="color:var(--error)">\u2717</span>';
        const exitIp = ep.exit_ip || '\u2014';
        const speed = ep.speed_mbps ? parseFloat(ep.speed_mbps).toFixed(1) + ' Mbps' : '\u2014';
        const largeTransfer = ep.large_transfer_ok
          ? '<span style="color:var(--success)">' + (ep.large_transfer_mbps ? parseFloat(ep.large_transfer_mbps).toFixed(1) : '0') + ' Mbps</span>'
          : '<span style="color:var(--error)">' + (ep.large_transfer_mbps ? parseFloat(ep.large_transfer_mbps).toFixed(1) : '0') + ' Mbps</span>';
        const siteCells = PROBE_SITES.map(siteUrl => {
          const siteResult = (ep.sites || []).find(s => s.url === siteUrl);
          if (!siteResult) return '<td style="text-align:center;background:var(--bg-elevated)">\u2014</td>';
          const code = siteResult.http_code || 0;
          const ms = siteResult.latency_ms || 0;
          const isOk = code === 200;
          const isSlow = ms > 2000;
          const bg = isOk && !isSlow ? 'rgba(34,197,94,0.15)' : isOk && isSlow ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)';
          const color = isOk && !isSlow ? 'var(--success)' : isOk && isSlow ? 'var(--warning)' : 'var(--error)';
          return '<td style="text-align:center;background:' + bg + ';color:' + color + ';font-size:10px;font-weight:600">' +
            (code === 0 ? '\u00d7' : code + '<br><span style="font-weight:400;opacity:.7">' + ms + 'ms</span>') + '</td>';
        }).join('');
        rows += '<tr>' +
          '<td style="font-weight:600;font-size:12px;white-space:nowrap">' + escapeHtml(ep.id || '?') + '</td>' +
          '<td style="text-align:center">' + tcpIcon + '</td>' +
          '<td style="text-align:center">' + tunnelIcon + '</td>' +
          '<td style="font-size:11px;font-family:monospace">' + escapeHtml(exitIp) + '</td>' +
          siteCells +
          '<td style="text-align:right;font-size:11px">' + speed + '</td>' +
          '<td style="text-align:right;font-size:11px">' + largeTransfer + '</td>' +
          '</tr>';
      }
      return '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">' +
        '<thead><tr style="border-bottom:2px solid var(--border)">' +
        '<th style="text-align:left;padding:4px 8px">Endpoint</th>' +
        '<th style="text-align:center;padding:4px">TCP</th>' +
        '<th style="text-align:center;padding:4px">Tunnel</th>' +
        '<th style="text-align:left;padding:4px">Exit IP</th>' +
        siteHeaders +
        '<th style="text-align:right;padding:4px">Speed</th>' +
        '<th style="text-align:right;padding:4px">10MB</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function postJson(url, body) {
      return fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    }

    function showToast(message) {
      const toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--bg-elevated);border:1px solid var(--border);padding:12px 20px;border-radius:6px;font-size:13px;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.15)';
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }
    </script>
    </div>`,
  );
}

function renderQuickTestTab(): string {
  return `<div class="card">
    <div class="card-header"><h3>\u26A1 Quick Test</h3></div>
    <div style="padding:20px">
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">
        Quick test checks all endpoints against <strong>Telegram</strong> only. Runs on VPS via SSH.
      </p>
      <div style="display:flex;gap:12px">
        <button class="btn btn-secondary" id="quick-test-btn" onclick="runQuickTest()">Run Quick Test (~30s)</button>
        <button class="btn btn-primary" id="benchmark-btn" onclick="runBenchmark()">Run Full Benchmark (2-5 min)</button>
      </div>
      <div style="margin-top:16px;font-size:12px;color:var(--text-muted)">
        <strong>Quick Test:</strong> Tests Telegram access through all endpoints, measures latency and speed<br>
        <strong>Full Benchmark:</strong> Tests multiple sites, measures download speed and large file transfer
      </div>
    </div>
  </div>`;
}

function renderHealthTab(input: { endpoints: Endpoint[]; health: EndpointHealth[] }): string {
  const healthHtml = renderHealthGrid(input.endpoints, input.health);
  return `<div class="card">
    <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
      <h3>\U0001F4CA Current Endpoint Health</h3>
      <button class="btn btn-secondary btn-sm" onclick="refreshHealth()">\U0001F504 Refresh</button>
    </div>
    ${healthHtml}
    <div style="margin-top:16px;font-size:12px;color:var(--text-muted);padding:0 20px 20px 20px">
      Health data is updated by Quick Test and Benchmark runs. Shows last known status of each endpoint.
    </div>
  </div>`;
}

function renderProbeTab(): string {
  return `<div class="card">
    <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <h3>\U0001F50D Run New Probe</h3>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <select id="probe-node" class="input" style="width:auto;padding:4px 8px;font-size:12px">
          <option value="worker-main">worker-main</option>
          <option value="mac">mac</option>
          <option value="worker-lan">worker-lan</option>
          <option value="worker-dev">worker-dev</option>
          <option value="auto">auto (all nodes)</option>
        </select>
        <select id="probe-engine" class="input" style="width:auto;padding:4px 8px;font-size:12px">
          <option value="xray">xray</option>
          <option value="singbox">singbox</option>
          <option value="both">both</option>
        </select>
        <button class="btn btn-primary btn-sm" id="run-probe-btn" onclick="runProbe()">Run Probe</button>
      </div>
    </div>
    <div id="probe-status" style="font-size:12px;color:var(--text-muted);margin-bottom:8px;padding:0 20px"></div>
    <div id="probe-logs" style="display:none;background:var(--bg-elevated);border:1px solid var(--border);border-radius:6px;padding:12px;margin:0 20px 12px 20px;max-height:400px;overflow-y:auto;font-family:monospace;font-size:11px;line-height:1.5;color:var(--text-secondary)"></div>
  </div>

  <div class="card" style="margin-top:16px">
    <div class="card-header"><h3>\U0001F4C1 Probe History</h3></div>
    <div id="all-probe-results" style="padding:20px">
      <div style="color:var(--text-muted);font-size:13px;padding:8px 0">Loading probe history...</div>
    </div>
  </div>`;
}

/** Render filters and the client-populated list of incremental VPN test runs. */
function renderVpnTestHistoryTab(): string {
  return `<div class="card">
    <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div>
        <h3>\U0001F4DA Unified Test History</h3>
        <div style="font-size:12px;color:var(--text-muted);margin-top:3px">Quick, health and benchmark stages from LAN, external wired, external wireless and mobile targets.</div>
      </div>
      <button class="btn btn-secondary btn-sm" type="button" onclick="loadVpnTestHistory()">Refresh</button>
    </div>
    <form onsubmit="event.preventDefault();loadVpnTestHistory()" style="padding:0 20px 16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;align-items:end">
      <div class="form-group" style="margin:0"><label for="history-network-class">Network</label><select class="input" id="history-network-class"><option value="">All networks</option><option value="lan">LAN</option><option value="external-wired">External wired</option><option value="external-wireless">External wireless</option><option value="external-mobile">External mobile</option><option value="external-unknown">External, path unverified</option></select></div>
      <div class="form-group" style="margin:0"><label for="history-target">Target</label><input class="input" id="history-target" placeholder="android, mac, worker-lan"></div>
      <div class="form-group" style="margin:0"><label for="history-profile">Profile</label><select class="input" id="history-profile"><option value="">All profiles</option><option value="quick">Quick</option><option value="health">Health</option><option value="benchmark">Benchmark</option></select></div>
      <div class="form-group" style="margin:0"><label for="history-endpoint">Endpoint</label><input class="input" id="history-endpoint" placeholder="de-direct"></div>
      <div class="form-group" style="margin:0"><label for="history-status">Status</label><select class="input" id="history-status"><option value="">All outcomes</option><option value="passed">Passed / content OK</option><option value="degraded">Degraded / warning</option><option value="failed">Failed transport</option><option value="error">Runner error</option><option value="running">Running</option></select></div>
      <div class="form-group" style="margin:0"><label for="history-date-from">From</label><input class="input" id="history-date-from" type="datetime-local"></div>
      <div class="form-group" style="margin:0"><label for="history-date-to">To</label><input class="input" id="history-date-to" type="datetime-local"></div>
      <button class="btn btn-primary" type="submit">Apply filters</button>
    </form>
    <div style="display:flex;gap:14px;flex-wrap:wrap;padding:0 20px 14px;font-size:11px">
      <span class="vpn-outcome fatal">\u25CF Fatal transport</span>
      <span class="vpn-outcome warning">\u25CF Warning: auth / challenge / site policy</span>
      <span class="vpn-outcome ok">\u25CF Content OK</span>
      <span style="color:var(--text-muted)">HTTP 204 and other 2xx/3xx responses count as content reachable unless the event declares a stricter outcome.</span>
    </div>
    <div id="vpn-test-history-runs" style="padding:0 20px 20px">
      <details class="vpn-test-run"><summary style="color:var(--text-muted)">Open this tab to load runs and their endpoint stages.</summary></details>
    </div>
  </div>`;
}
