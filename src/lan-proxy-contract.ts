import type { SecureConfig, SecureNode } from "./secure-config.js";
import type { VpnTestWireMethod } from "./vpn-test-contract.js";

type LanRegion = "de" | "us";
type LanAccessMethod = "http-proxy" | "socks-proxy";
export type LanProxyHost = "worker-lan" | "worker-dev";

/** A shared LAN listener with a regional endpoint pool. */
export type LanLane = {
  id: `${LanRegion}-${"http" | "socks"}`;
  region: LanRegion;
  accessMethod: LanAccessMethod;
  port: number;
};

/** Enabled secure-config endpoints grouped for the two regional LAN lanes. */
export type LanEndpointCatalog = Record<LanRegion, SecureNode[]>;

/** Stable listener ports exposed by both LAN proxy hosts. */
export const LAN_PROXY_LANES: readonly LanLane[] = [
  { id: "us-http", region: "us", accessMethod: "http-proxy", port: 3127 },
  { id: "us-socks", region: "us", accessMethod: "socks-proxy", port: 1080 },
  { id: "de-http", region: "de", accessMethod: "http-proxy", port: 3128 },
  { id: "de-socks", region: "de", accessMethod: "socks-proxy", port: 1081 },
];

/** Both generated LAN clients expose the same listener contract. */
export const LAN_PROXY_HOST_LANES: Readonly<Record<LanProxyHost, readonly LanLane[]>> = {
  "worker-lan": LAN_PROXY_LANES,
  "worker-dev": LAN_PROXY_LANES,
};

/** Assert that a generated host still exposes every shared numeric LAN lane. */
export function assertSharedLanPorts(inbounds: readonly Record<string, unknown>[]): void {
  const ports = new Set(inbounds.map((inbound) => Number(inbound.port ?? inbound.listen_port)));
  for (const lane of LAN_PROXY_LANES) {
    if (!ports.has(lane.port)) throw new Error(`generated LAN config is missing ${lane.id} port ${lane.port}`);
  }
}

const LAN_SUPPORTED_ENDPOINT_KINDS = new Set([
  "vless-reality",
  "vless-ws",
  "vless-xhttp",
  "vless-httpupgrade",
  "vless-grpc",
]);

function isCompatibleEndpoint(node: SecureNode, region: LanRegion): boolean {
  return node.enabled && LAN_SUPPORTED_ENDPOINT_KINDS.has(node.kind) && node.id.startsWith(`${region}-`);
}

/**
 * Return enabled, transport-compatible endpoints for a shared regional lane.
 *
 * Throws when the requested lane cannot be generated safely from secure config.
 */
export function activeEndpointsForLane(secure: SecureConfig, lane: LanLane): SecureNode[] {
  const endpoints = secure.nodes.filter((node) => isCompatibleEndpoint(node, lane.region));
  if (endpoints.length === 0) {
    throw new Error(`LAN ${lane.id} lane has no enabled compatible endpoints`);
  }
  return endpoints;
}

/**
 * Produce explicit, queryable test dimensions for a LAN proxy target.
 *
 * Access describes the local proxy protocol; wire describes the host's LAN link.
 */
export function testMatrixMetadata(hostRole: LanProxyHost, lane: LanLane): {
  hostRole: LanProxyHost;
  client: "sing-box" | "xray";
  accessMethod: LanAccessMethod;
  wireMethod: VpnTestWireMethod;
  networkClass: "lan";
} {
  return {
    hostRole,
    client: hostRole === "worker-lan" ? "sing-box" : "xray",
    accessMethod: lane.accessMethod,
    wireMethod: "wire-internal",
    networkClass: "lan",
  };
}
