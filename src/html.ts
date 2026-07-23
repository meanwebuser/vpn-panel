export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function sidebarHtml(currentPath: string): string {
  const isActive = (path: string) => currentPath === path ? 'active' : '';
  
  return `
  <div class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <h1>\uD83D\uDEE1\uFE0F BezVPN</h1>
      <p>Admin Panel</p>
    </div>
    <nav class="sidebar-nav">
      <div class="sidebar-section">
        <div class="sidebar-section-title">Main</div>
        <a href="/admin" class="sidebar-link ${isActive('/admin')}">
          <span class="icon">\uD83D\uDCCA</span>
          <span>Dashboard</span>
        </a>
        <a href="/admin/tests" class="sidebar-link ${isActive('/admin/tests')}">
          <span class="icon">\uD83E\uDEE0</span>
          <span>Tests</span>
        </a>
        <a href="/admin/vps" class="sidebar-link ${isActive('/admin/vps')}">
          <span class="icon">\uD83D\uDCBB</span>
          <span>VPS</span>
        </a>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">Network</div>
        <a href="/admin/smart-dns" class="sidebar-link ${isActive('/admin/smart-dns')}">
          <span class="icon">\uD83C\uDF10</span>
          <span>Smart DNS</span>
        </a>
        <a href="/admin/tests#current-endpoints" class="sidebar-link ${isActive('/admin/tests')}" title="Текущее состояние endpoint’ов и история проверок">
          <span class="icon">\uD83D\uDD0C</span>
          <span>Endpoints</span>
        </a>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">Account</div>
        <form method="post" action="/api/logout" style="margin:0">
          <button type="submit" class="sidebar-link" style="width:100%;border:none;background:none;cursor:pointer">
            <span class="icon">\uD83D\uDEAA</span>
            <span>Logout</span>
          </button>
        </form>
      </div>
    </nav>
  </div>
  <button class="sidebar-toggle" id="sidebar-toggle" onclick="toggleSidebar()">\u2630</button>
  <script>
    function toggleSidebar() {
      const sidebar = document.getElementById('sidebar');
      sidebar.classList.toggle('collapsed');
      localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
    }
    // Restore sidebar state
    document.addEventListener('DOMContentLoaded', () => {
      const sidebar = document.getElementById('sidebar');
      if (localStorage.getItem('sidebar-collapsed') === 'true') {
        sidebar.classList.add('collapsed');
      }
    });
  </script>`;
}

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="ru">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root {
  --bg: #0c0e14;
  --bg-surface: #141722;
  --bg-elevated: #1c2030;
  --bg-hover: #252a3a;
  --border: #2a2f42;
  --border-light: #1f2435;
  --primary: #6366f1;
  --primary-hover: #818cf8;
  --primary-bg: rgba(99,102,241,.12);
  --success: #22c55e;
  --success-bg: rgba(34,197,94,.12);
  --error: #ef4444;
  --error-bg: rgba(239,68,68,.12);
  --warning: #f59e0b;
  --warning-bg: rgba(245,158,11,.12);
  --info: #3b82f6;
  --info-bg: rgba(59,130,246,.12);
  --text: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --radius: 12px;
  --radius-lg: 16px;
  --radius-sm: 8px;
  --shadow: 0 4px 24px rgba(0,0,0,.25);
  --shadow-sm: 0 2px 8px rgba(0,0,0,.15);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  min-height: 100vh;
}

a { color: var(--primary-hover); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ── Layout ── */
.shell { max-width: 1280px; margin: 0 auto; padding: 24px 32px 64px; }

/* ── Sidebar Layout ── */
.app-layout {
  display: flex;
  min-height: 100vh;
}
.sidebar {
  width: 260px;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  padding: 24px 0;
  position: fixed;
  top: 0;
  left: 0;
  height: 100vh;
  overflow-y: auto;
  z-index: 100;
  transition: transform 0.3s ease;
}
.sidebar.collapsed {
  transform: translateX(-260px);
}
.sidebar-header {
  padding: 0 20px 20px 20px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}
.sidebar-header h1 {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 4px;
}
.sidebar-header p {
  font-size: 12px;
  color: var(--text-muted);
}
.sidebar-nav {
  padding: 0 12px;
}
.sidebar-section {
  margin-bottom: 24px;
}
.sidebar-section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  padding: 0 8px 8px 8px;
}
.sidebar-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.15s;
  margin-bottom: 2px;
}
.sidebar-link:hover {
  background: var(--bg-elevated);
  color: var(--text);
  text-decoration: none;
}
.sidebar-link.active {
  background: var(--primary-bg);
  color: var(--primary-hover);
}
.sidebar-link .icon {
  width: 20px;
  text-align: center;
  font-size: 16px;
}
.sidebar-toggle {
  position: fixed;
  top: 20px;
  left: 20px;
  z-index: 101;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  cursor: pointer;
  color: var(--text);
  font-size: 18px;
  transition: all 0.15s;
  display: none;
}
.sidebar-toggle:hover {
  background: var(--bg-elevated);
}
.sidebar.collapsed + .main-content .sidebar-toggle {
  left: 20px;
}
.main-content {
  flex: 1;
  margin-left: 260px;
  padding: 24px 32px 64px;
  transition: margin-left 0.3s ease;
}
.sidebar.collapsed + .main-content {
  margin-left: 0;
}
@media (max-width: 768px) {
  .sidebar {
    transform: translateX(-260px);
  }
  .sidebar.open {
    transform: translateX(0);
  }
  .main-content {
    margin-left: 0;
  }
  .sidebar-toggle {
    display: block;
  }
}

/* ── Header / Nav ── */
.nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 0; margin-bottom: 32px;
  border-bottom: 1px solid var(--border);
}
.nav-brand { display: flex; align-items: center; gap: 12px; }
.nav-brand h1 {
  font-size: 22px; font-weight: 700; letter-spacing: -.02em; color: var(--text);
}
.nav-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em;
  padding: 3px 10px; border-radius: 20px;
}
.nav-badge.admin { background: var(--primary-bg); color: var(--primary-hover); }
.nav-badge.user { background: var(--success-bg); color: var(--success); }
.nav-actions { display: flex; align-items: center; gap: 10px; }

/* ── Page header ── */
.page-header {
  margin-bottom: 28px;
}
.page-header h2 {
  font-size: 28px; font-weight: 700; letter-spacing: -.03em; margin-bottom: 4px;
}
.page-header p { color: var(--text-secondary); font-size: 14px; }

/* ── Stats row ── */
.stats-row {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px; margin-bottom: 28px;
}
.stat-card {
  background: var(--bg-surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px 18px;
}
.stat-card .stat-label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
.stat-card .stat-value { font-size: 26px; font-weight: 700; }
.stat-card .stat-value.green { color: var(--success); }
.stat-card .stat-value.red { color: var(--error); }
.stat-card .stat-value.blue { color: var(--info); }
.stat-card .stat-value.purple { color: var(--primary-hover); }

/* ── Cards ── */
.card {
  background: var(--bg-surface); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 20px; margin-bottom: 16px;
}
.card-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px; padding-bottom: 14px; border-bottom: 1px solid var(--border);
}
.card-header h3 { font-size: 16px; font-weight: 600; }

/* ── Buttons ── */
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: var(--radius-sm);
  font-size: 13px; font-weight: 500; cursor: pointer;
  border: 1px solid transparent; transition: all .15s;
  text-decoration: none; white-space: nowrap;
}
.btn:hover { text-decoration: none; }
.btn-primary { background: var(--primary); color: #fff; border-color: var(--primary); }
.btn-primary:hover { background: var(--primary-hover); }
.btn-secondary { background: var(--bg-elevated); color: var(--text); border-color: var(--border); }
.btn-secondary:hover { background: var(--bg-hover); border-color: var(--text-muted); }
.btn-danger { background: var(--error); color: #fff; }
.btn-danger:hover { opacity: .85; }
.btn-success { background: var(--success); color: #fff; }
.btn-success:hover { opacity: .85; }
.btn-sm { padding: 5px 10px; font-size: 12px; }
.btn-ghost {
  background: transparent; color: var(--text-secondary);
  border: 1px solid var(--border);
}
.btn-ghost:hover { background: var(--bg-elevated); color: var(--text); }
.btn:disabled, .btn[aria-disabled="true"] {
  background: var(--bg-elevated); color: var(--text-muted); border-color: var(--border);
  box-shadow: none; cursor: not-allowed; opacity: .8;
}
.btn:disabled:hover, .btn[aria-disabled="true"]:hover {
  background: var(--bg-elevated); color: var(--text-muted); border-color: var(--border);
}

/* ── Form elements ── */
.form-group { margin-bottom: 14px; }
.form-group label {
  display: block; font-size: 12px; font-weight: 500;
  color: var(--text-secondary); margin-bottom: 5px;
}
.input, select {
  width: 100%; padding: 9px 12px; font-size: 14px;
  background: var(--bg-elevated); border: 1px solid var(--border);
  border-radius: var(--radius-sm); color: var(--text);
  font-family: inherit; transition: border-color .15s;
}
.input:focus, select:focus { outline: none; border-color: var(--primary); }
.input::placeholder { color: var(--text-muted); }

/* ── Tags / Badges ── */
.tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 20px;
  font-size: 11px; font-weight: 600;
}
.tag-success { background: var(--success-bg); color: var(--success); }
.tag-error { background: var(--error-bg); color: var(--error); }
.tag-warning { background: var(--warning-bg); color: var(--warning); }
.tag-info { background: var(--info-bg); color: var(--info); }
.tag-neutral { background: var(--bg-elevated); color: var(--text-secondary); }

/* ── Toggle switch ── */
.toggle-group {
  display: inline-flex; border-radius: var(--radius-sm);
  border: 1px solid var(--border); overflow: hidden;
}
.toggle-btn {
  padding: 6px 14px; font-size: 12px; font-weight: 500;
  cursor: pointer; border: none; background: var(--bg-elevated);
  color: var(--text-secondary); transition: all .15s;
}
.toggle-btn.active {
  background: var(--primary); color: #fff;
}
.toggle-btn:hover:not(.active) { background: var(--bg-hover); }

/* ── Endpoint health grid ── */
.health-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}
.health-card {
  background: var(--bg-elevated); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 14px 16px;
  display: flex; flex-direction: column; gap: 8px;
}
.health-card-header {
  display: flex; align-items: center; justify-content: space-between;
}
.health-card-title {
  font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px;
}
.health-status-dot {
  width: 8px; height: 8px; border-radius: 50%;
  display: inline-block; flex-shrink: 0;
}
.health-status-dot.alive { background: var(--success); box-shadow: 0 0 6px rgba(34,197,94,.5); }
.health-status-dot.dead { background: var(--error); box-shadow: 0 0 6px rgba(239,68,68,.5); }
.health-status-dot.unknown { background: var(--text-muted); }
.health-metrics {
  display: flex; gap: 16px; font-size: 12px; color: var(--text-secondary);
}
.health-metric { display: flex; align-items: center; gap: 4px; }
.health-metric .value { color: var(--text); font-weight: 600; }
.health-sites {
  display: flex; flex-wrap: wrap; gap: 4px;
}
.health-site {
  font-size: 10px; padding: 1px 6px; border-radius: 10px;
}
.health-site.ok { background: var(--success-bg); color: var(--success); }
.health-site.fail { background: var(--error-bg); color: var(--error); }

/* ── Users table ── */
.users-list { display: flex; flex-direction: column; gap: 8px; }
.user-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; background: var(--bg-elevated);
  border: 1px solid var(--border); border-radius: var(--radius);
  gap: 12px; flex-wrap: wrap;
}
.user-info {
  display: flex; align-items: center; gap: 12px; min-width: 0;
}
.user-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--primary-bg); color: var(--primary-hover);
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 14px; flex-shrink: 0;
}
.user-name { font-weight: 600; font-size: 14px; }
.user-login { font-size: 12px; color: var(--text-muted); }
.user-meta {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.user-actions {
  display: flex; align-items: center; gap: 6px; flex-shrink: 0;
}

/* ── Endpoint checkboxes ── */
.endpoint-checks {
  display: flex; flex-direction: column; gap: 6px;
}
.endpoint-check {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; background: var(--bg-elevated);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  font-size: 13px;
}
.endpoint-check input[type="checkbox"] {
  width: 16px; height: 16px; accent-color: var(--primary);
}

/* ── Toggle switch (iOS-style) ── */
.switch {
  position: relative; display: inline-block;
  width: 40px; height: 22px; flex-shrink: 0;
}
.switch input { opacity: 0; width: 0; height: 0; }
.switch-slider {
  position: absolute; cursor: pointer; inset: 0;
  background: var(--border); border-radius: 22px;
  transition: background .2s;
}
.switch-slider::before {
  content: ""; position: absolute; width: 16px; height: 16px;
  left: 3px; bottom: 3px; background: #fff;
  border-radius: 50%; transition: transform .2s;
}
.switch input:checked + .switch-slider { background: var(--primary); }
.switch input:checked + .switch-slider::before { transform: translateX(18px); }

/* ── Happ settings ── */
.happ-setting-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 0; border-bottom: 1px solid var(--border-light);
}
.happ-setting-row:last-child { border-bottom: none; }
.happ-select {
  width: auto; padding: 4px 8px; font-size: 12px;
  background: var(--bg-elevated); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  outline: none; cursor: pointer;
}
.happ-select:focus { border-color: var(--primary); }
.happ-input {
  padding: 4px 8px !important; font-size: 12px !important;
  max-width: 160px;
}

/* ── Link slots ── */
.link-list { display: flex; flex-direction: column; gap: 8px; }
.link-item {
  padding: 12px 14px; background: var(--bg-elevated);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
}
.link-item-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
}
.link-item-label { font-size: 13px; font-weight: 600; }
.link-item-url {
  font-family: "SF Mono", "Fira Code", ui-monospace, Menlo, monospace;
  font-size: 12px; color: var(--text-secondary);
  background: var(--bg); padding: 6px 8px;
  border-radius: 6px; word-break: break-all;
  margin-bottom: 8px;
}
.link-item-actions { display: flex; gap: 6px; }

/* ── Subscription box ── */
.sub-box {
  background: var(--bg-elevated); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px;
}
.sub-url {
  font-family: "SF Mono", "Fira Code", ui-monospace, Menlo, monospace;
  font-size: 12px; color: var(--text-secondary);
  background: var(--bg); padding: 10px 12px;
  border-radius: var(--radius-sm); word-break: break-all;
  margin: 10px 0;
}
.sub-actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* ── Login ── */
.login-wrapper {
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh; padding: 24px;
}
.login-card {
  width: 100%; max-width: 400px;
  background: var(--bg-surface); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 32px;
  box-shadow: var(--shadow);
}
.login-card h1 {
  font-size: 24px; font-weight: 700; margin-bottom: 8px;
  text-align: center;
}
.login-card .login-sub {
  text-align: center; color: var(--text-secondary);
  font-size: 14px; margin-bottom: 24px;
}
.login-card form { display: flex; flex-direction: column; gap: 14px; }

/* ── Modal ── */
.modal-overlay {
  display: none; position: fixed; inset: 0;
  background: rgba(0,0,0,.6); backdrop-filter: blur(4px);
  align-items: center; justify-content: center; z-index: 100;
}
.modal-overlay.open { display: flex; }
.modal-box {
  background: var(--bg-surface); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 24px;
  max-width: 400px; text-align: center; box-shadow: var(--shadow);
}
.modal-box img { display: block; margin: 0 auto 16px; border-radius: var(--radius); }

/* ── Two-column layout ── */
.two-col {
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
}

/* ── Pre/code ── */
code, pre {
  font-family: "SF Mono", "Fira Code", ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
}
pre {
  overflow: auto; white-space: pre-wrap;
  border-radius: var(--radius-sm); background: var(--bg);
  color: var(--text-secondary); padding: 12px;
  border: 1px solid var(--border);
}

/* ── Collapsible ── */
.collapse-trigger {
  cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 8px;
}
.collapse-trigger .arrow {
  display: inline-block; transition: transform .2s; font-size: 10px; color: var(--text-muted);
}
.collapse-trigger.open .arrow { transform: rotate(90deg); }
.collapse-body { display: none; }
.collapse-body.open { display: block; }

/* ── Animations ── */
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── Focus styles ── */
*:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.btn:focus-visible { outline-offset: 1px; }

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

/* ── Responsive ── */
@media (max-width: 768px) {
  .shell { padding: 16px; }
  .two-col { grid-template-columns: 1fr; }
  .health-grid { grid-template-columns: 1fr; }
  .user-row { flex-direction: column; align-items: flex-start; }
  .user-actions { width: 100%; justify-content: flex-end; }
  .stats-row { grid-template-columns: repeat(2, 1fr); }
  .nav { flex-wrap: wrap; gap: 12px; }
}
</style>
<main class="shell">${body}</main>
<script>
async function postJson(url, data) {
  const r = await fetch(url, {method: 'POST', credentials: 'include', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data || {})});
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function patchJson(url, data) {
  const r = await fetch(url, {method: 'PATCH', credentials: 'include', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data || {})});
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function deleteJson(url) {
  const r = await fetch(url, {method: 'DELETE', credentials: 'include'});
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    const el = document.createElement('div');
    el.textContent = 'Copied!';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--success);color:#fff;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:999;animation:fadeUp .3s';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  });
}
function openQr(token) {
  document.getElementById('qr-img').src = '/sub/' + encodeURIComponent(token) + '/qr';
  document.getElementById('qr-overlay').classList.add('open');
}
function closeQr() {
  document.getElementById('qr-overlay').classList.remove('open');
}
function toggleCollapse(id) {
  const body = document.getElementById(id + '-body');
  const trigger = document.getElementById(id + '-trigger');
  body.classList.toggle('open');
  trigger.classList.toggle('open');
}
function showToast(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--success);color:#fff;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:999;animation:fadeUp .3s';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}
</script>`;
}
