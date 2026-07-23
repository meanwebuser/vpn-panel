import crypto from "node:crypto";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { loadAppConfig } from "../config.js";
import { createPool } from "../db.js";
import { recordVpnTestEvent, type VpnTestEvent } from "../vpn-test-telemetry.js";

type LegacyEndpoint = {
  endpoint?: string;
  id?: string;
  pass?: number;
  fail?: number;
  eligible?: boolean;
  error?: string;
  sites?: Array<Record<string, unknown>>;
};

type LegacyRun = {
  timestamp?: string;
  startedAt?: string;
  host?: string;
  node?: string;
  engine?: string;
  profile?: string;
  results?: LegacyEndpoint[];
  endpoints?: LegacyEndpoint[];
  summary?: Record<string, unknown>;
};

function wireMethod(node: string): "4g" | "wire-internal" | "wire-external" {
  if (node.includes("android") || node.includes("4g") || node.includes("mobile")) return "4g";
  if (node.includes("mac") || node.includes("external")) return "wire-external";
  return "wire-internal";
}

function hostRole(node: string): "worker-lan" | "worker-dev" | "worker-main" | "mac" | "android" {
  if (node.includes("android")) return "android";
  if (node.includes("mac")) return "mac";
  if (node.includes("44")) return "worker-lan";
  if (node.includes("88")) return "worker-dev";
  return "worker-main";
}

function event(input: Omit<VpnTestEvent, "schemaVersion" | "eventId">): VpnTestEvent {
  return { schemaVersion: 1, eventId: crypto.randomUUID(), ...input };
}

async function filesUnder(root: string): Promise<string[]> {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

async function importFile(pool: ReturnType<typeof createPool>, file: string): Promise<boolean> {
  const content = await readFile(file, "utf8");
  const parsed = JSON.parse(content) as LegacyRun;
  const endpoints = parsed.endpoints ?? parsed.results ?? [];
  if (endpoints.length === 0) return false;
  const runId = `legacy-${crypto.createHash("sha256").update(content).digest("hex").slice(0, 32)}`;
  const timestamp = parsed.startedAt ?? parsed.timestamp ?? new Date().toISOString();
  const targetId = parsed.node ?? parsed.host ?? "legacy-unknown";
  const selectedWireMethod = wireMethod(targetId);
  const target: VpnTestEvent["target"] = {
    id: targetId,
    networkClass: selectedWireMethod === "4g" ? "external-mobile" : selectedWireMethod === "wire-external" ? "external-wired" : "lan",
    client: parsed.engine?.includes("sing-box") ? "sing-box" : parsed.engine?.includes("smartdns") ? "smartdns" : "xray",
    accessMethod: "socks-proxy" as const,
    wireMethod: selectedWireMethod,
    hostRole: hostRole(targetId),
  };
  const profile = parsed.profile === "quick" || parsed.profile === "health" ? parsed.profile : "benchmark";
  let sequence = 1;
  await recordVpnTestEvent(pool, event({ runId, sequence: sequence++, timestamp, type: "run_started", profile, target, payload: { engine: parsed.engine ?? "legacy", artifactPath: file } }));
  let eligible = 0;
  let errors = 0;
  for (const endpoint of endpoints) {
    const endpointId = endpoint.endpoint ?? endpoint.id ?? "unknown";
    for (const site of endpoint.sites ?? []) {
      await recordVpnTestEvent(pool, event({
        runId,
        sequence: sequence++,
        timestamp,
        type: "stage_finished",
        profile,
        target,
        endpoint: endpointId,
        stage: String(site.label ?? site.url ?? "site"),
        payload: site,
      }));
    }
    const isEligible = endpoint.eligible ?? (!endpoint.error && Number(endpoint.fail ?? 0) === 0);
    if (isEligible) eligible++;
    if (endpoint.error) errors++;
    await recordVpnTestEvent(pool, event({ runId, sequence: sequence++, timestamp, type: "endpoint_finished", profile, target, endpoint: endpointId, payload: { ...endpoint, eligible: isEligible } }));
  }
  const summary = parsed.summary ?? { total: endpoints.length, eligible, failed: endpoints.length - eligible - errors, errors };
  await recordVpnTestEvent(pool, event({ runId, sequence, timestamp, type: "run_finished", profile, target, payload: { summary, artifactPath: file } }));
  return true;
}

async function main(): Promise<void> {
  const config = loadAppConfig();
  const pool = createPool(config);
  const roots = [path.resolve("bench-results"), path.resolve("vpn-testing/results")];
  const files = (await Promise.all(roots.map(filesUnder))).flat();
  let imported = 0;
  for (const file of files) {
    try {
      if (await importFile(pool, file)) imported++;
    } catch (error) {
      console.error(`skip ${file}: ${String(error)}`);
    }
  }
  await pool.end();
  console.log(JSON.stringify({ scanned: files.length, imported }));
}

await main();
