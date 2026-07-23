import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { SecureConfig } from "./secure-config.js";

const execFileAsync = promisify(execFile);

export interface SmartEdgeRoute {
  sni: string;
  backend: string;
  label?: string;
}

export interface SmartEdgeCapabilities {
  /** This target can synthesize public SmartDNS A responses. */
  publicDnsEdge: boolean;
  /** worker-dev has a prepared outbound/balancer for this target. */
  lanEgress: boolean;
  /** Existing Xray balancer tag used for LAN service routes. */
  lanBalancerTag?: string;
  /** Named public DNS profile this target can serve when it is not the active edge. */
  dedicatedPublicDnsProfile?: "vusa";
}

export interface SmartEdgeTarget {
  id: string;
  label: string;
  sshHost: string;
  sshUser: string;
  sshPort: number;
  publicIp: string;
  streamConfigPath: string;
  obsoleteStreamConfigPaths?: string[];
  streamAccessLog?: boolean;
  ownSni: string[];
  ownBackend: string;
  edgeBackend: string;
  specialRoutes: SmartEdgeRoute[];
  capabilities?: SmartEdgeCapabilities;
  source?: "secure.vps_list" | "override" | "default";
}

export interface SmartEdgeState {
  activeEdgeId: string;
  updatedAt?: string;
  lastAction?: string;
  lastActionAt?: string;
  lastActionStatus?: "ok" | "error";
  lastActionOutput?: string;
  lastPrimaryIp?: string;
}

export interface SmartEdgeConfig {
  targets: SmartEdgeTarget[];
  state: SmartEdgeState;
  targetsPath: string;
  statePath: string;
}

export interface SmartEdgeActionResult {
  ok: boolean;
  action: string;
  targetId: string;
  output: string;
}

type EdgePreset = Omit<SmartEdgeTarget, "label" | "sshHost" | "sshUser" | "sshPort" | "source"> & { label?: string };

const EDGE_PRESETS: Record<string, EdgePreset> = {
  vusa: {
    id: "vusa",
    label: "vusa / US edge",
    publicIp: "203.0.113.11",
    streamConfigPath: "/etc/nginx/stream-smart-edge.conf",
    ownSni: ["edge-us.example.com"],
    ownBackend: "127.0.0.1:8444",
    edgeBackend: "127.0.0.1:9443",
    capabilities: { publicDnsEdge: true, lanEgress: true, lanBalancerTag: "us-auto", dedicatedPublicDnsProfile: "vusa" },
    specialRoutes: [
      { sni: ".t.gptadmin.example.com", backend: "127.0.0.1:8446", label: "GPTAdmin vhost" },
      { sni: "www.google.com", backend: "127.0.0.1:23443", label: "Reality" },
      { sni: "google.com", backend: "127.0.0.1:23443", label: "Reality" },
      { sni: "smart-de.relay.example.com", backend: "198.51.100.10:443", label: "Mobile Smart DE relay" },
      { sni: "full-de.relay.example.com", backend: "198.51.100.10:443", label: "Mobile Full DE relay" },
    ],
  },
  vpn2: {
    id: "vpn2",
    label: "vpn2 / DE edge",
    publicIp: "203.0.113.10",
    streamConfigPath: "/etc/nginx/stream-smart-edge.conf",
    obsoleteStreamConfigPaths: ["/etc/nginx/stream-reality.conf"],
    streamAccessLog: true,
    ownSni: ["edge-de.example.com", "cdn.example.com", "cdn2.example.com"],
    ownBackend: "127.0.0.1:8444",
    edgeBackend: "127.0.0.1:9443",
    capabilities: { publicDnsEdge: true, lanEgress: true, lanBalancerTag: "proxy" },
    specialRoutes: [
      { sni: ".t.gptadmin.example.com", backend: "127.0.0.1:8446", label: "GPTAdmin tunnel" },
      { sni: ".v.gptadmin.example.com", backend: "127.0.0.1:8445", label: "GPTAdmin vhost" },
      { sni: "ya.ru", backend: "127.0.0.1:23443", label: "Reality" },
      { sni: "smart-us.relay.example.com", backend: "198.51.100.10:443", label: "Mobile Smart US relay" },
      { sni: "full-us.relay.example.com", backend: "198.51.100.10:443", label: "Mobile Full US relay" },
    ],
  },
};

export const DEFAULT_SMART_EDGE_TARGETS: SmartEdgeTarget[] = [
  { ...EDGE_PRESETS.vusa, label: EDGE_PRESETS.vusa.label || "vusa", sshHost: "edge-us.example.com", sshUser: "root", sshPort: 22, source: "default" },
  { ...EDGE_PRESETS.vpn2, label: EDGE_PRESETS.vpn2.label || "vpn2", sshHost: "edge-de.example.com", sshUser: "root", sshPort: 22, source: "default" },
];

/**
 * Convert deployable edge targets into explicit service-routing capabilities.
 * New VPS targets are deliberately unavailable to a service pool until their
 * public and/or LAN path is declared; guessing from a hostname can black-hole
 * production DNS.
 */
export function serviceTargetCapabilities(config: SmartEdgeConfig): SmartEdgeCapabilities[] & Array<{ id: string }> {
  return config.targets.map((target) => ({
    id: target.id,
    publicDnsEdge: target.capabilities?.publicDnsEdge === true,
    lanEgress: target.capabilities?.lanEgress === true,
    ...(target.capabilities?.lanBalancerTag ? { lanBalancerTag: target.capabilities.lanBalancerTag } : {}),
    ...(target.capabilities?.dedicatedPublicDnsProfile === "vusa" ? { dedicatedPublicDnsProfile: "vusa" as const } : {}),
  }));
}

export function smartEdgeTargetsPath(): string {
  return process.env.VPN_PANEL_SMART_EDGE_TARGETS || path.join(process.cwd(), "data", "smart-edge-targets.json");
}

export function smartEdgeStatePath(): string {
  return process.env.VPN_PANEL_SMART_EDGE_STATE || path.join(process.cwd(), "data", "smart-edge-state.json");
}

function canonicalEdgeId(value: string): "vusa" | "vpn2" | null {
  const host = value.toLowerCase();
  if (host.includes("vusa") || host.includes("185-240-120-152") || host.includes("203.0.113.11")) return "vusa";
  if (host.includes("vpn2") || host.includes("212-192-31-128") || host.includes("203.0.113.10")) return "vpn2";
  return null;
}

function normalizeTarget(input: Partial<SmartEdgeTarget>): SmartEdgeTarget | null {
  const id = String(input.id || "").trim();
  const sshHost = String(input.sshHost || "").trim();
  const publicIp = String(input.publicIp || "").trim();
  if (!id || !sshHost || !publicIp) return null;
  return {
    id,
    label: String(input.label || id),
    sshHost,
    sshUser: String(input.sshUser || "root"),
    sshPort: Number(input.sshPort || 22),
    publicIp,
    streamConfigPath: String(input.streamConfigPath || "/etc/nginx/stream-smart-edge.conf"),
    obsoleteStreamConfigPaths: Array.isArray(input.obsoleteStreamConfigPaths) ? input.obsoleteStreamConfigPaths.map(String).filter(Boolean) : [],
    streamAccessLog: Boolean(input.streamAccessLog),
    ownSni: Array.isArray(input.ownSni) ? input.ownSni.map(String).filter(Boolean) : [],
    ownBackend: String(input.ownBackend || "127.0.0.1:8444"),
    edgeBackend: String(input.edgeBackend || "127.0.0.1:9443"),
    capabilities: input.capabilities
      ? {
          publicDnsEdge: input.capabilities.publicDnsEdge === true,
          lanEgress: input.capabilities.lanEgress === true,
          ...(input.capabilities.lanBalancerTag ? { lanBalancerTag: String(input.capabilities.lanBalancerTag) } : {}),
          ...(input.capabilities.dedicatedPublicDnsProfile === "vusa" ? { dedicatedPublicDnsProfile: "vusa" } : {}),
        }
      : undefined,
    specialRoutes: Array.isArray(input.specialRoutes)
      ? input.specialRoutes
          .map((route) => ({ sni: String(route.sni || "").trim(), backend: String(route.backend || "").trim(), label: route.label ? String(route.label) : undefined }))
          .filter((route) => route.sni && route.backend)
      : [],
    source: input.source || "override",
  };
}

function targetsFromSecureConfig(secure?: SecureConfig): SmartEdgeTarget[] {
  if (!secure?.vps_list?.length) return DEFAULT_SMART_EDGE_TARGETS;
  const targets: SmartEdgeTarget[] = [];
  for (const vps of secure.vps_list) {
    const presetId = canonicalEdgeId(`${vps.id} ${vps.host}`);
    const preset = presetId ? EDGE_PRESETS[presetId] : undefined;
    targets.push({
      ...(preset || { id: vps.id, publicIp: vps.host, streamConfigPath: "/etc/nginx/stream-smart-edge.conf", ownSni: [vps.host], ownBackend: "127.0.0.1:8444", edgeBackend: "127.0.0.1:9443", specialRoutes: [] }),
      id: preset?.id || vps.id,
      label: vps.label || preset?.label || vps.id,
      sshHost: vps.host,
      sshUser: vps.username || "root",
      sshPort: Number(vps.port || 22),
      source: "secure.vps_list",
    });
  }
  return targets.length ? targets : DEFAULT_SMART_EDGE_TARGETS;
}

function mergeTargets(base: SmartEdgeTarget[], custom: Partial<SmartEdgeTarget>[]): SmartEdgeTarget[] {
  const byId = new Map(base.map((target) => [target.id, target]));
  for (const item of custom) {
    const normalized = normalizeTarget(item);
    if (normalized) byId.set(normalized.id, normalized);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadSmartEdgeConfig(secure?: SecureConfig): Promise<SmartEdgeConfig> {
  const targetsPath = smartEdgeTargetsPath();
  const statePath = smartEdgeStatePath();
  let customTargets: Partial<SmartEdgeTarget>[] = [];
  try {
    const parsed = JSON.parse(await readFile(targetsPath, "utf8"));
    customTargets = Array.isArray(parsed) ? parsed : Array.isArray(parsed.targets) ? parsed.targets : [];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  let state: SmartEdgeState = { activeEdgeId: "vusa" };
  try {
    state = { ...state, ...JSON.parse(await readFile(statePath, "utf8")) };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const targets = mergeTargets(targetsFromSecureConfig(secure), customTargets);
  if (!targets.some((target) => target.id === state.activeEdgeId)) state.activeEdgeId = targets[0]?.id || "vusa";
  return { targets, state, targetsPath, statePath };
}

export async function saveSmartEdgeState(state: SmartEdgeState, file = smartEdgeStatePath()): Promise<SmartEdgeState> {
  const next = { ...state, updatedAt: new Date().toISOString() };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

function deployScriptPath(): string {
  return process.env.VPN_PANEL_SMART_EDGE_SCRIPT || path.join(process.cwd(), "scripts", "smart-edge-deploy.mjs");
}

function clipOutput(stdout: string, stderr: string): string {
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  return combined.length > 12000 ? combined.slice(-12000) : combined;
}

export async function runSmartEdgeAction(action: "deploy" | "select-primary" | "validate", targetId: string): Promise<SmartEdgeActionResult> {
  if (action === "select-primary") {
    const config = await loadSmartEdgeConfig();
    if (config.state.activeEdgeId === targetId) {
      return { ok: true, action, targetId, output: `Smart Edge ${targetId} is already primary; no changes applied.` };
    }
  }

  const args = [deployScriptPath(), action, targetId];
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, { cwd: process.cwd(), timeout: action === "deploy" ? 120000 : 60000, maxBuffer: 1024 * 1024, env: process.env });
    const output = clipOutput(stdout, stderr);
    const config = await loadSmartEdgeConfig();
    await saveSmartEdgeState({ ...config.state, activeEdgeId: action === "select-primary" ? targetId : config.state.activeEdgeId, lastAction: `${action}:${targetId}`, lastActionAt: new Date().toISOString(), lastActionStatus: "ok", lastActionOutput: output }, config.statePath);
    return { ok: true, action, targetId, output };
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const output = clipOutput(error.stdout || "", error.stderr || error.message || String(error));
    const config = await loadSmartEdgeConfig();
    await saveSmartEdgeState({ ...config.state, lastAction: `${action}:${targetId}`, lastActionAt: new Date().toISOString(), lastActionStatus: "error", lastActionOutput: output }, config.statePath);
    return { ok: false, action, targetId, output };
  }
}
