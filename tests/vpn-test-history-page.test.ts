import assert from "node:assert/strict";
import test from "node:test";

import { testsPage } from "../src/pages.js";

test("tests page presents one unified testing workspace", () => {
  const html = testsPage({ endpoints: [], health: [] });

  assert.match(html, /id="test-workspace"/);
  assert.match(html, /id="test-targets"/);
  assert.match(html, /data-test-target-id="external-wireless-android"/);
  assert.match(html, /function selectedTestTargets\(\)/);
  assert.match(html, /targets: selectedTestTargets\(\)/);
  assert.match(html, /data-test-check-id="gstatic"/);
  assert.match(html, /data-test-check-id="reddit"/);
  assert.match(html, /function selectedTestChecks\(\)/);
  assert.match(html, /checks: selectedTestChecks\(\)/);
  assert.match(html, /id="current-endpoints"/);
  assert.match(html, /id="recent-tests"/);
  assert.doesNotMatch(html, /data-tab="quick-test"/);
  assert.doesNotMatch(html, /data-tab="history"/);
  assert.match(html, /id="history-network-class"/);
  assert.match(html, /id="history-client"/);
  assert.match(html, /id="history-access-method"/);
  assert.match(html, /id="history-wire-method"/);
  assert.match(html, /id="history-target"/);
  assert.match(html, /id="history-profile"/);
  assert.match(html, /id="history-endpoint"/);
  assert.match(html, /id="history-status"/);
  assert.match(html, /id="history-date-from"/);
  assert.match(html, /id="history-date-to"/);
  assert.match(html, /\/api\/admin\/vpn-tests\/runs/);
  assert.match(html, /id="history-live-status"/);
  assert.match(html, /id="history-auto-refresh"/);
  assert.match(html, /localStorage/);
  assert.match(html, /if \(!historyAutoRefreshEnabled\(\)\)/);
  assert.match(html, /scheduleHistoryRefresh/);
  assert.match(html, /Ошибка транспорта/);
  assert.match(html, /Ответ получен, нужен разбор/);
  assert.match(html, /Успешно/);
  assert.match(html, /Открыть JSON/);
  assert.match(html, /Сводка тестирования/);
  assert.match(html, /Последний health-check/);
  assert.match(html, /site-result-matrix/);
  assert.match(html, /openEndpointDetail/);
});

test("history renderer groups stages into expandable runs with readable labels", () => {
  const html = testsPage({ endpoints: [], health: [] });

  assert.match(html, /<details[^>]*class="vpn-test-run/);
  assert.match(html, /renderVpnTestStages/);
  assert.match(html, /data\.events/);
  assert.match(html, /artifact_url/);
  assert.match(html, /profileLabel/);
  assert.match(html, /targetLabel/);
  assert.match(html, /run\.client/);
  assert.match(html, /run\.access_method/);
  assert.match(html, /run\.wire_method/);
});
