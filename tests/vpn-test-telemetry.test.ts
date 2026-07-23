import assert from "node:assert/strict";
import test from "node:test";
import type { DbPool } from "../src/db.js";
import { getVpnTestEndpointDetail, getVpnTestEndpointScores, parseVpnTestEvent, recordVpnTestEvent } from "../src/vpn-test-telemetry.js";
import { networkClassForWireMethod } from "../src/vpn-test-contract.js";

test("vpn test dimensions keep an unverified Mac path explicitly unknown", () => {
  assert.equal(networkClassForWireMethod("unknown"), "external-unknown");
  assert.doesNotThrow(() => parseVpnTestEvent({
    schemaVersion: 1,
    eventId: "evt-mac-unknown",
    runId: "run-mac-unknown",
    sequence: 1,
    timestamp: "2026-07-19T12:00:00Z",
    type: "run_started",
    profile: "health",
    target: {
      id: "external-mac",
      networkClass: "external-unknown",
      client: "xray",
      accessMethod: "socks-proxy",
      wireMethod: "unknown",
      hostRole: "mac",
    },
    payload: { engine: "xray-native" },
  }));
});

test("vpn telemetry accepts one incremental stage event", () => {
  const event = parseVpnTestEvent({
    schemaVersion: 1,
    eventId: "evt-1",
    runId: "run-1",
    sequence: 3,
    timestamp: "2026-07-14T12:00:00Z",
    type: "stage_finished",
    profile: "health",
    target: {
      id: "external-wireless-android",
      networkClass: "external-mobile",
      client: "xray",
      accessMethod: "socks-proxy",
      wireMethod: "4g",
      hostRole: "android",
    },
    endpoint: "de-direct",
    stage: "telegram",
    payload: { code: 403, reachable: true, contentOk: false },
  });

  assert.equal(event.sequence, 3);
  assert.equal(event.target.networkClass, "external-mobile");
  assert.equal(event.target.client, "xray");
  assert.equal(event.target.accessMethod, "socks-proxy");
  assert.equal(event.target.wireMethod, "4g");
  assert.equal(event.payload.reachable, true);
});

test("vpn telemetry rejects events without stable identity", () => {
  assert.throws(() => parseVpnTestEvent({ schemaVersion: 1, type: "stage_finished" }));
});

test("run_finished without a client summary derives status from endpoint events", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("event_type='endpoint_finished'")) {
        return { rows: [{ total: 1, eligible: 1, errors: 0 }] };
      }
      return { rows: [] };
    },
  } as unknown as DbPool;
  const event = parseVpnTestEvent({
    schemaVersion: 1,
    eventId: "evt-finished",
    runId: "run-mobile",
    sequence: 18,
    timestamp: "2026-07-17T21:30:00Z",
    type: "run_finished",
    profile: "benchmark",
    target: {
      id: "external-wireless-android",
      networkClass: "external-mobile",
      client: "xray",
      accessMethod: "socks-proxy",
      wireMethod: "4g",
      hostRole: "android",
    },
    endpoint: "smart-de-relay",
    payload: { endpointTotal: 1 },
  });

  await recordVpnTestEvent(pool, event);

  assert.equal(calls.length, 3);
  assert.equal(calls[0].params[7], "xray");
  assert.equal(calls[0].params[8], "socks-proxy");
  assert.equal(calls[0].params[9], "4g");
  assert.equal(calls[2].params[9], "passed");
  assert.deepEqual(JSON.parse(String(calls[2].params[10])), { total: 1, eligible: 1, errors: 0 });
});

test("vpn telemetry rejects a target without the explicit matrix dimensions", () => {
  assert.throws(() => parseVpnTestEvent({
    schemaVersion: 1,
    eventId: "evt-missing-matrix",
    runId: "run-missing-matrix",
    sequence: 1,
    timestamp: "2026-07-17T21:30:00Z",
    type: "run_started",
    profile: "quick",
    target: { id: "lan-server44", networkClass: "lan" },
    payload: {},
  }));
});

test("endpoint score mapping keeps runner errors separate from endpoint failures", async () => {
  let executedSql = "";
  const pool = {
    query: async (sql: string) => {
      executedSql = sql;
      return {
        rows: [{
          endpoint_id: "de-xhttp-h2",
          passed: 9,
          effective_observations: 10,
          endpoint_failures: 1,
          runner_errors: 4,
          score: 90,
          telegram_median_ms: 420,
          telegram_p95_ms: 900,
        }],
      };
    },
  } as unknown as DbPool;

  const scores = await getVpnTestEndpointScores(pool);

  assert.match(executedSql, /vpn_test_events/);
  assert.deepEqual(scores, [{
    endpointId: "de-xhttp-h2",
    score: 90,
    passed: 9,
    effectiveObservations: 10,
    endpointFailures: 1,
    runnerErrors: 4,
    telegramMedianMs: 420,
    telegramP95Ms: 900,
  }]);
});

test("endpoint detail aggregates matrix dimensions and stage metrics", async () => {
  const calls: string[] = [];
  const pool = {
    query: async (sql: string) => {
      calls.push(sql);
      if (sql.includes("group by target_id, network_class, client, access_method, wire_method, host_role")) {
        return {
          rows: [{
            endpoint_id: "de-xhttp-h2",
            target_id: "external-wireless-android",
            network_class: "external-mobile",
            client: "sing-box",
            access_method: "socks-proxy",
            wire_method: "4g",
            host_role: "android",
            score: 100,
            total_observations: 2,
            passed: 1,
            effective_observations: 1,
            endpoint_failures: 0,
            runner_errors: 1,
            stage_stats: [{
              stageId: "telegram",
              total: 1,
              passed: 1,
              reachable: 1,
              meanMs: 240,
              medianMs: 240,
              p95Ms: 240,
              meanMbps: null,
              medianMbps: null,
              p95Mbps: null,
            }],
          }],
        };
      }
      return {
        rows: [{
          endpoint_id: "de-xhttp-h2",
          score: 100,
          total_observations: 2,
          passed: 1,
          effective_observations: 1,
          endpoint_failures: 0,
          runner_errors: 1,
          stage_stats: [{
            stageId: "throughput",
            total: 1,
            passed: 1,
            reachable: 1,
            meanMs: null,
            medianMs: null,
            p95Ms: null,
            meanMbps: 12.3,
            medianMbps: 12.3,
            p95Mbps: 12.3,
          }],
        }],
      };
    },
  } as unknown as DbPool;

  const detail = await getVpnTestEndpointDetail(pool, "de-xhttp-h2");

  assert.equal(calls.length, 2);
  assert.match(calls[1], /order by score desc nulls last/);
  assert.equal(detail.endpointId, "de-xhttp-h2");
  assert.equal(detail.summary.runnerErrors, 1);
  assert.equal(detail.summary.stages[0]?.meanMbps, 12.3);
  assert.equal(detail.matrix[0]?.client, "sing-box");
  assert.equal(detail.matrix[0]?.stages[0]?.p95Ms, 240);
});
