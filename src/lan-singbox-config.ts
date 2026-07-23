import { LAN_PROXY_LANES, activeEndpointsForLane, type LanLane } from "./lan-proxy-contract.js";
import type { SecureConfig } from "./secure-config.js";
import { singBoxOutboundFromEndpoint } from "./subscriptions.js";
import type { Endpoint } from "./types.js";

type SingBoxObject = Record<string, unknown>;

const URL_TEST_URL = "https://www.gstatic.com/generate_204";
const RESTRICTED_DOMAIN_SUFFIXES = [
  "telegram.org", "t.me", "tdesktop.com", "telesco.pe",
  "openai.com", "api.openai.com", "chatgpt.com", "oaistatic.com", "oaiusercontent.com",
  "googlevideo.com", "youtube.com", "youtu.be", "ytimg.com", "googleapis.com",
  "instagram.com", "cdninstagram.com", "fbcdn.net",
] as const;

function requireLane(id: LanLane["id"]): LanLane {
  const lane = LAN_PROXY_LANES.find((candidate) => candidate.id === id);
  if (!lane) throw new Error(`LAN proxy contract is missing the ${id} lane`);
  return lane;
}

function relayUuid(secure: SecureConfig): string {
  const config = secure.server_configs["regional-relays"];
  const relayClient = config?.relay_client as Record<string, unknown> | undefined;
  const uuid = config?.relay_uuid ?? relayClient?.id;
  if (typeof uuid !== "string" || !uuid) {
    throw new Error("regional-relays requires relay_uuid or relay_client.id for worker-lan sing-box");
  }
  return uuid;
}

function regionalOutbounds(
  region: "de" | "us",
  endpoints: Endpoint[],
  secure: SecureConfig,
  uuid: string,
): SingBoxObject[] {
  const lane = requireLane(`${region}-http`);
  const activeIds = new Set(activeEndpointsForLane(secure, lane).map((endpoint) => endpoint.id));
  const compatible = endpoints
    .filter((endpoint) => endpoint.enabled && activeIds.has(endpoint.id))
    // sing-box 1.12's VLESS converter intentionally accepts only the
    // transports it can express faithfully here (Reality/WS/HTTPUpgrade);
    // XHTTP/gRPC remain available to the Xray host and are not guessed.
    .map((endpoint) => singBoxOutboundFromEndpoint(endpoint, uuid, secure))
    .filter((outbound): outbound is SingBoxObject => outbound !== null);
  if (compatible.length === 0) {
    throw new Error(`worker-lan ${region} regional selector has no compatible enabled endpoint`);
  }
  return compatible;
}

/** Generate the database-backed, regional sing-box LAN configuration for worker-lan. */
export function server44SingBoxConfig(endpoints: Endpoint[], secure: SecureConfig): SingBoxObject {
  const uuid = relayUuid(secure);
  const deOutbounds = regionalOutbounds("de", endpoints, secure, uuid);
  const usOutbounds = regionalOutbounds("us", endpoints, secure, uuid);
  const deTags = deOutbounds.map((outbound) => String(outbound.tag));
  const usTags = usOutbounds.map((outbound) => String(outbound.tag));
  const usHttp = requireLane("us-http");
  const usSocks = requireLane("us-socks");
  const deHttp = requireLane("de-http");
  const deSocks = requireLane("de-socks");

  return {
    log: { level: "info" },
    inbounds: [
      { type: "http", tag: "in-http-us", listen: "0.0.0.0", listen_port: usHttp.port },
      { type: "socks", tag: "in-socks-us", listen: "0.0.0.0", listen_port: usSocks.port, udp_fragment: true, sniff: true },
      { type: "http", tag: "in-http-de", listen: "0.0.0.0", listen_port: deHttp.port },
      { type: "socks", tag: "in-socks-de", listen: "0.0.0.0", listen_port: deSocks.port, udp_fragment: true, sniff: true },
      { type: "http", tag: "in-http-smart", listen: "0.0.0.0", listen_port: 3129 },
    ],
    outbounds: [
      { type: "direct", tag: "direct" },
      { type: "block", tag: "block" },
      ...deOutbounds,
      ...usOutbounds,
      { type: "urltest", tag: "de-regional", outbounds: deTags, url: URL_TEST_URL, interval: "10s" },
      { type: "urltest", tag: "us-regional", outbounds: usTags, url: URL_TEST_URL, interval: "10s" },
    ],
    route: {
      rules: [
        { ip_is_private: true, outbound: "direct" },
        { inbound: ["in-http-us", "in-socks-us"], outbound: "us-regional" },
        { inbound: ["in-http-de", "in-socks-de"], outbound: "de-regional" },
        { domain_suffix: [...RESTRICTED_DOMAIN_SUFFIXES], outbound: "de-regional" },
        { inbound: ["in-http-smart"], outbound: "de-regional" },
      ],
      final: "direct",
      auto_detect_interface: true,
    },
  };
}
