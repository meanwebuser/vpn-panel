import { Buffer } from "node:buffer";
import { isIP } from "node:net";
import { URLSearchParams } from "node:url";
import type { DbPool } from "./db.js";
import type { Endpoint } from "./types.js";
import type { SecureConfig } from "./secure-config.js";
import type { SmartDnsPolicy } from "./smart-dns-policy.js";
import type { VpnTestEndpointScore } from "./vpn-test-telemetry.js";
import { getVpnTestEndpointScores } from "./vpn-test-telemetry.js";
import { endpointOrder, isSubscriptionEndpoint } from "./secure-config.js";

export type LinkSlot = {
  id: string;
  label: string;
  available: boolean;
  url: string | null;
  reason: string | null;
};

export type ClientBundle = {
  accountId: string;
  clientId: string;
  displayName: string;
  login: string;
  xrayUuid: string;
  token: string;
  endpoints: Endpoint[];
};

export type MacosXrayMode = "smart" | "all";

export const PUBLIC_ENDPOINT_MIN_SCORE = 50;
const PUBLIC_ENDPOINT_MIN_OBSERVATIONS = 20;

const MACOS_DIRECT_ENDPOINT_ORDER = [
  "de-direct",
  "de-httpupgrade",
  "de-direct-ws",
  "de-xhttp",
  "de-cdn",
  "de-cdn2",
  "us-reality",
  "us-httpupgrade",
  "us-direct-ws",
  "us-xhttp",
  "us-cdn",
  "us-cdn2",
] as const;

const MACOS_RELAY_FALLBACK_ORDER = [
  "smart-de-relay",
  "full-de-relay",
  "smart-us-relay",
  "full-us-relay",
] as const;

const MACOS_IP_BY_HOST: Record<string, string> = {
  "edge-de.example.com": "203.0.113.10",
  "cdn.example.com": "203.0.113.10",
  "cdn2.example.com": "203.0.113.10",
  "relay.example.com": "198.51.100.10",
  "smart-relay.example.com": "198.51.100.10",
  "full-relay.example.com": "198.51.100.10",
  "edge-us.example.com": "203.0.113.11",
  "us-cdn.example.com": "203.0.113.11",
  "us-cdn2.example.com": "203.0.113.11",
};

const MACOS_PRIVATE_CIDRS = [
  "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
  "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16",
  "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "::1/128", "fc00::/7", "fe80::/10",
];

function stringConfig(endpoint: Endpoint, key: string): string | undefined {
  const value = endpoint.config?.[key];
  return typeof value === "string" && value ? value : undefined;
}

function queryConfig(endpoint: Endpoint): Record<string, string> {
  const query = endpoint.config?.query;
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

/** Default fragment/noises values applied to all Reality endpoints unless overridden. */
const DEFAULT_FRAGMENT = "1-10,5-20,tlshello";
const DEFAULT_NOISES = "rand,50-150,10-50,ip";

export interface VlessLinkOptions {
  fingerprint?: string;
  nameSuffix?: string;
}

export function vlessLink(endpoint: Endpoint, uuid: string, secure: SecureConfig, opts?: VlessLinkOptions): string | null {
  if (!endpoint.enabled) {
    return null;
  }

  const defaults = secure.defaults;
  const params = new URLSearchParams(queryConfig(endpoint));
  const kind = endpoint.kind || "vless-reality";
  const isReality = kind === "vless-reality";

  if (isReality) {
    const publicKey = stringConfig(endpoint, "public_key");
    const shortId = stringConfig(endpoint, "short_id");
    if (!publicKey || !shortId) {
      return null;
    }
    params.set("flow", stringConfig(endpoint, "flow") || defaults.flow);
    params.set("security", "reality");
    params.set("encryption", "none");
    params.set("type", "tcp");
    params.set("sni", stringConfig(endpoint, "sni") || defaults.sni);
    params.set("sid", shortId);
    params.set("fp", opts?.fingerprint || stringConfig(endpoint, "fingerprint") || defaults.fingerprint);
    params.set("pbk", publicKey);
    params.set("headerType", "none");

    // Add fragment and noises for Reality (client-side DPI resistance)
    const fragment = stringConfig(endpoint, "fragment") || defaults.fragment || DEFAULT_FRAGMENT;
    const noises = stringConfig(endpoint, "noises") || defaults.noises || DEFAULT_NOISES;
    params.set("fragment", fragment);
    params.set("noises", noises);
  } else {
    params.set("encryption", params.get("encryption") || "none");
    if (!params.get("type")) {
      return null;
    }
    // Apply fingerprint override for non-Reality TLS endpoints
    if (opts?.fingerprint) {
      params.set("fp", opts.fingerprint);
    }
  }

  const rawName = endpoint.label || endpoint.id;
  const suffix = opts?.nameSuffix || "";
  const iconName = endpoint.id === "de-direct" || endpoint.id.startsWith("de-")
    ? `🇩🇪 ${rawName}${suffix}`
    : endpoint.id.startsWith("ru-")
      ? `🇷🇺 ${rawName}${suffix}`
      : endpoint.id.startsWith("us-")
        ? `🇺🇸 ${rawName}${suffix}`
        : `${rawName}${suffix}`;

  return `vless://${uuid}@${endpoint.address}:${endpoint.port}?${params.toString()}#${encodeURIComponent(iconName)}`;
}

export function linkSlots(bundle: ClientBundle, secure: SecureConfig): LinkSlot[] {
  const byId = new Map(bundle.endpoints.map((endpoint) => [endpoint.id, endpoint]));
  return endpointOrder.map((id) => {
    const endpoint = byId.get(id);
    if (!endpoint) {
      return { id, label: id, available: false, url: null, reason: "not assigned" };
    }
    const url = vlessLink(endpoint, bundle.xrayUuid, secure);
    if (!url) {
      return {
        id,
        label: endpoint.label,
        available: false,
        url: null,
        reason: endpoint.enabled ? "not configured" : "disabled",
      };
    }
    return { id, label: endpoint.label, available: true, url, reason: null };
  });
}


export function happRoutingLink(): string {
  const routing = {
    Name: "Relay-managed routing",
    GlobalProxy: "true",
    RemoteDNSType: "DoH",
    RemoteDNSDomain: "https://dns.google/dns-query",
    RemoteDNSIP: "8.8.8.8",
    DomesticDNSType: "DoU",
    DomesticDNSDomain: "77.88.8.8",
    DomesticDNSIP: "77.88.8.8",
    Geoipurl: "https://github.com/golukon/russia-only-geoip/releases/latest/download/geoip.dat",
    Geositeurl: "https://github.com/golukon/russia-only-geosite/releases/latest/download/geosite.dat",
    LastUpdated: "",
    DnsHosts: {
      "dns.google": "8.8.8.8",
      "cloudflare-dns.com": "1.1.1.1",
    },
    // Only the panel endpoint (panel.example.com) goes direct so users can
    // fetch the subscription while VPN is up. The bare "example.com"
    // would also match edge-de.example.com and edge-us.example.com
    // (the actual VPN endpoints) and break all VPN traffic.
    // Smart versus Full is enforced by the selected regional relay. Applying
    // geoip:ru here would silently turn every Full product into Smart.
    DirectSites: ["panel.example.com"],
    DirectIp: ["geoip:private"],
    ProxySites: [],
    ProxyIp: [],
    // The compact RU-only geosite intentionally omits category-ads-all. Ad
    // blocking belongs in a dedicated DNS/filtering layer, not this routing DB.
    BlockSites: [],
    BlockIp: [],
    DomainStrategy: "IPIfNonMatch",
    FakeDNS: "false"
  };
  const encoded = Buffer.from(JSON.stringify(routing), "utf8").toString("base64");
  return `happ://routing/onadd/${encoded}`;
}

/** Generate all VLESS links for an endpoint. */
function allEndpointLinks(endpoint: Endpoint, uuid: string, secure: SecureConfig): string[] {
  if (!endpoint.enabled) return [];
  const link = vlessLink(endpoint, uuid, secure);
  return link ? [link] : [];
}

/** Select products and restored fallbacks in their stable subscription order. */
export function orderPublicSubscriptionEndpoints(
  endpoints: Endpoint[],
  scores: readonly VpnTestEndpointScore[],
): Endpoint[] {
  const scoreById = new Map(scores.map((score) => [score.endpointId, score]));
  return endpoints
    .filter((endpoint) => endpoint.enabled && isSubscriptionEndpoint(endpoint.id))
    .filter((endpoint) => {
      const score = scoreById.get(endpoint.id);
      return !score
        || score.effectiveObservations < PUBLIC_ENDPOINT_MIN_OBSERVATIONS
        || score.score >= PUBLIC_ENDPOINT_MIN_SCORE;
    })
    .sort((left, right) => {
      const leftScore = scoreById.get(left.id);
      const rightScore = scoreById.get(right.id);
      if (leftScore && rightScore && leftScore.score !== rightScore.score) {
        return rightScore.score - leftScore.score;
      }
      if (leftScore && rightScore && leftScore.telegramMedianMs !== rightScore.telegramMedianMs) {
        return (leftScore.telegramMedianMs ?? Number.MAX_SAFE_INTEGER) - (rightScore.telegramMedianMs ?? Number.MAX_SAFE_INTEGER);
      }
      if (leftScore && !rightScore) return -1;
      if (!leftScore && rightScore) return 1;
      return left.sort_order - right.sort_order || left.id.localeCompare(right.id);
    });
}

/** Preserve the score-ordered bundle while excluding non-subscription catalog entries. */
function orderedSubscriptionEndpoints(endpoints: Endpoint[]): Endpoint[] {
  return endpoints.filter((endpoint) => endpoint.enabled && isSubscriptionEndpoint(endpoint.id));
}

export function plainSubscription(bundle: ClientBundle, secure: SecureConfig): string {
  const links: string[] = [];

  for (const endpoint of orderedSubscriptionEndpoints(bundle.endpoints)) {
    links.push(...allEndpointLinks(endpoint, bundle.xrayUuid, secure));
  }

  return links.join("\n").concat("\n");
}

export function v2raySubscription(bundle: ClientBundle, secure: SecureConfig): string {
  return Buffer.from(plainSubscription(bundle, secure), "utf8").toString("base64");
}

function realityOutbound(endpoint: Endpoint, uuid: string, secure: SecureConfig): Record<string, unknown> | null {
  if (endpoint.kind !== "vless-reality" || !endpoint.enabled) {
    return null;
  }
  const publicKey = stringConfig(endpoint, "public_key");
  const shortId = stringConfig(endpoint, "short_id");
  if (!publicKey || !shortId) {
    return null;
  }
  return {
    type: "vless",
    tag: endpoint.id,
    server: endpoint.address,
    server_port: endpoint.port,
    uuid,
    flow: stringConfig(endpoint, "flow") || secure.defaults.flow,
    tls: {
      enabled: true,
      server_name: stringConfig(endpoint, "sni") || secure.defaults.sni,
      reality: { enabled: true, public_key: publicKey, short_id: shortId },
      utls: { enabled: true, fingerprint: stringConfig(endpoint, "fingerprint") || secure.defaults.fingerprint },
    },
  };
}

function singBoxTransport(endpoint: Endpoint, query: Record<string, string>, secure: SecureConfig): Record<string, unknown> | null {
  const kind = endpoint.kind;
  if (kind === "vless-reality") return null; // handled by realityOutbound

  const transport = query.type;
  if (transport !== "ws" && transport !== "httpupgrade") return null;

  const tls: Record<string, unknown> = {
    enabled: true,
    server_name: query.sni || secure.defaults.sni,
    utls: { enabled: true, fingerprint: query.fp || secure.defaults.fingerprint },
  };

  if (transport === "ws") {
    return {
      type: "vless",
      tag: endpoint.id,
      server: endpoint.address,
      server_port: endpoint.port,
      uuid: "", // placeholder, caller fills
      tls,
      transport: {
        type: "ws",
        path: query.path || "/",
        headers: query.host ? { Host: query.host } : undefined,
      },
    };
  }

  if (transport === "httpupgrade") {
    return {
      type: "vless",
      tag: endpoint.id,
      server: endpoint.address,
      server_port: endpoint.port,
      uuid: "", // placeholder, caller fills
      tls,
      transport: {
        type: "httpupgrade",
        host: query.host || endpoint.address,
        path: query.path || "/",
      },
    };
  }

  return null;
}

/** Convert one enabled catalog endpoint into its sing-box VLESS outbound. */
export function singBoxOutboundFromEndpoint(endpoint: Endpoint, uuid: string, secure: SecureConfig): Record<string, unknown> | null {
  if (!endpoint.enabled) return null;

  // Reality endpoints (existing logic)
  if (endpoint.kind === "vless-reality") {
    return realityOutbound(endpoint, uuid, secure);
  }

  // WS and HTTPUpgrade endpoints
  const query = queryConfig(endpoint);
  const base = singBoxTransport(endpoint, query, secure);
  if (!base) return null;
  base.uuid = uuid;
  return base;
}

export function singBoxSubscription(bundle: ClientBundle, secure: SecureConfig): Record<string, unknown> {
  const outbounds = orderedSubscriptionEndpoints(bundle.endpoints)
    .map((endpoint) => singBoxOutboundFromEndpoint(endpoint, bundle.xrayUuid, secure))
    .filter((outbound): outbound is Record<string, unknown> => outbound !== null);
  const tags = outbounds.map((outbound) => String(outbound.tag));
  if (!tags.length) {
    throw new Error("client has no sing-box compatible endpoints");
  }

  return {
    log: { level: "info" },
    dns: {
      servers: [
        { tag: "local", address: "local" },
        { tag: "remote", address: "https://1.1.1.1/dns-query", detour: "proxy" },
      ],
      rules: [{ rule_set: ["geosite-ru"], server: "local" }],
      final: "remote",
    },
    inbounds: [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 }],
    outbounds: [
      { type: "selector", tag: "proxy", outbounds: tags, default: tags[0] },
      ...outbounds,
      { type: "direct", tag: "direct" },
      { type: "block", tag: "block" },
    ],
    route: {
      rule_set: [
        {
          type: "remote",
          tag: "geosite-ru",
          format: "binary",
          url: "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-ru.srs",
        },
        {
          type: "remote",
          tag: "geoip-ru",
          format: "binary",
          url: "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-ru.srs",
        },
      ],
      rules: [
        { ip_is_private: true, outbound: "direct" },
      ],
      final: "proxy",
      auto_detect_interface: true,
    },
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** Build the password-protected macOS profile: SmartDNS families use VPN, everything else is direct. */
export function macosSingBoxSubscription(
  bundle: ClientBundle,
  secure: SecureConfig,
  policy: SmartDnsPolicy,
): Record<string, unknown> {
  const config = singBoxSubscription(bundle, secure);
  const proxy = (config.outbounds as Array<Record<string, unknown>>).find((outbound) => outbound.tag === "proxy");
  if (!proxy) throw new Error("sing-box subscription has no proxy selector");

  const policyProxyDomains = uniqueSorted([
    ...policy.proxySuffixes,
    ...policy.proxyDomains,
    ...policy.localProxySuffixes,
    ...policy.localProxyDomains,
    ...policy.vusaProxySuffixes,
    ...policy.vusaProxyDomains,
  ]);
  const proxyTags = Array.isArray(proxy.outbounds) ? proxy.outbounds.map(String) : [];
  proxy.default = proxyTags.includes("de-httpupgrade") ? "de-httpupgrade" : proxyTags[0];

  config.dns = {
    // Bootstrap DNS must stay direct: resolving vpn2 through the not-yet-started
    // proxy creates a startup loop on a fresh client installation.
    servers: [
      { type: "local", tag: "local" },
      { type: "https", tag: "remote", server: "1.1.1.1", path: "/dns-query" },
    ],
    rules: [],
    final: "remote",
  };
  config.inbounds = [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 }];
  config.route = {
    rules: [
      { ip_is_private: true, outbound: "direct" },
      { domain_suffix: policyProxyDomains, outbound: "proxy" },
      { domain_suffix: uniqueSorted(policy.directSuffixes), outbound: "direct" },
      { domain: uniqueSorted(policy.directDomains), outbound: "direct" },
    ],
    final: "direct",
    default_domain_resolver: "local",
    auto_detect_interface: true,
  };
  return config;
}

function xrayOutbound(endpoint: Endpoint, uuid: string, secure: SecureConfig): Record<string, unknown> | null {
  if (!endpoint.enabled) {
    return null;
  }
  const query = queryConfig(endpoint);
  switch (endpoint.kind) {
    case "vless-reality": {
      const publicKey = stringConfig(endpoint, "public_key") || query.pbk;
      const shortId = stringConfig(endpoint, "short_id") || query.sid;
      if (!publicKey || !shortId) {
        return null;
      }
      return {
        tag: endpoint.id,
        protocol: "vless",
        settings: {
          vnext: [
            {
              address: endpoint.address,
              port: endpoint.port,
              users: [{ id: uuid, encryption: "none", flow: stringConfig(endpoint, "flow") || query.flow || secure.defaults.flow }],
            },
          ],
        },
        streamSettings: {
          network: "tcp",
          security: "reality",
          realitySettings: {
            serverName: stringConfig(endpoint, "sni") || query.sni || secure.defaults.sni,
            fingerprint: stringConfig(endpoint, "fingerprint") || query.fp || secure.defaults.fingerprint,
            publicKey,
            shortId,
          },
        },
      };
    }
    case "vless-ws":
    case "vless-xhttp":
    case "vless-httpupgrade":
    case "vless-grpc": {
      const transport = query.type || "tcp";
      return {
        tag: endpoint.id,
        protocol: "vless",
        settings: {
          vnext: [
            {
              address: endpoint.address,
              port: endpoint.port,
              users: [{ id: uuid, encryption: "none" }],
            },
          ],
        },
        streamSettings: xrayStreamSettings(transport, query),
      };
    }
    default:
      return null;
  }
}

function xrayStreamSettings(transport: string, query: Record<string, string>): Record<string, unknown> {
  const tlsSettings: Record<string, unknown> = {};
  if (query.sni) tlsSettings.serverName = query.sni;
  if (query.fp) tlsSettings.fingerprint = query.fp;
  if (query.alpn) tlsSettings.alpn = [query.alpn];

  const base: Record<string, unknown> = {
    network: transport,
    security: query.security || "tls",
  };
  if (query.security !== "none") {
    base.tlsSettings = tlsSettings;
  }

  switch (transport) {
    case "ws":
      // WS requires HTTP/1.1 ALPN; without it, TLS may negotiate HTTP/2
      // which breaks the WebSocket upgrade through nginx
      if (!tlsSettings.alpn) tlsSettings.alpn = ["http/1.1"];
      base.wsSettings = {
        path: query.path || "/",
        ...(query.host ? { host: query.host } : {}),
      };
      break;
    case "xhttp": {
      const xhttp: Record<string, unknown> = {
        path: query.path || "/",
        host: query.host || undefined,
        mode: query.mode || "auto",
      };
      if (query.h2 !== undefined) {
        xhttp.h2 = query.h2 === "true" || query.h2 === "1";
      } else {
        xhttp.h2 = false;
      }
      base.xhttpSettings = xhttp;
      break;
    }
    case "httpupgrade":
      base.httpupgradeSettings = {
        path: query.path || "/",
        host: query.host || undefined,
      };
      break;
    case "grpc":
      base.grpcSettings = {
        serviceName: query.serviceName || "",
      };
      break;
  }
  return base;
}

export function xrayClientSubscription(bundle: ClientBundle, secure: SecureConfig): Record<string, unknown> {
  const outbounds = orderedSubscriptionEndpoints(bundle.endpoints)
    .map((endpoint) => xrayOutbound(endpoint, bundle.xrayUuid, secure))
    .filter((outbound): outbound is Record<string, unknown> => outbound !== null);
  if (!outbounds.length) {
    throw new Error("client has no Xray compatible endpoints");
  }
  const defaultTag = String(outbounds[0].tag);
  const rules: Record<string, unknown>[] = [
    { type: "field", ip: ["geoip:private"], outboundTag: "direct" },
  ];
  rules.push({ type: "field", network: "tcp,udp", outboundTag: defaultTag });

  return {
    log: { loglevel: "warning" },
    inbounds: [
      { tag: "socks-in", port: 10808, listen: "127.0.0.1", protocol: "socks" },
      { tag: "http-in", port: 10809, listen: "127.0.0.1", protocol: "http" },
    ],
    outbounds: [...outbounds, { tag: "direct", protocol: "freedom" }, { tag: "block", protocol: "blackhole" }],
    routing: {
      domainStrategy: secure.defaults.domain_strategy,
      rules,
    },
  };
}

function macosDomainRules(policy: SmartDnsPolicy, route: "direct" | "proxy"): Record<string, unknown>[] {
  const suffixes = route === "proxy"
    ? [...policy.proxySuffixes, ...policy.localProxySuffixes]
    : policy.directSuffixes;
  const domains = route === "proxy"
    ? [...policy.proxyDomains, ...policy.localProxyDomains]
    : policy.directDomains;
  const rules: Record<string, unknown>[] = [];
  if (suffixes.length) {
    rules.push({
      type: "field",
      domain: [...new Set(suffixes)].map((suffix) => "domain:" + suffix),
      outboundTag: route,
    });
  }
  if (domains.length) {
    rules.push({
      type: "field",
      domain: [...new Set(domains)].map((domain) => "full:" + domain),
      outboundTag: route,
    });
  }
  return rules;
}

function macosEndpoints(bundle: ClientBundle, secure: SecureConfig): Record<string, unknown>[] {
  const byId = new Map(bundle.endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const orderedIds = [...MACOS_DIRECT_ENDPOINT_ORDER, ...MACOS_RELAY_FALLBACK_ORDER];
  return orderedIds
    .map((id) => byId.get(id))
    .filter((endpoint): endpoint is Endpoint => endpoint !== undefined)
    .map((endpoint) => {
      const address = isIP(endpoint.address) ? endpoint.address : MACOS_IP_BY_HOST[endpoint.address];
      if (!address) return null;
      return xrayOutbound({ ...endpoint, address }, bundle.xrayUuid, secure);
    })
    .filter((outbound): outbound is Record<string, unknown> => outbound !== null);
}

function macosRegionTags(outbounds: Record<string, unknown>[], region: "de" | "us"): string[] {
  const prefix = region + "-";
  const tags = outbounds
    .map((outbound) => String(outbound.tag))
    .filter((tag) => tag.startsWith(prefix) || tag.startsWith("smart-" + region + "-") || tag.startsWith("full-" + region + "-"));
  return tags.length ? tags : outbounds.map((outbound) => String(outbound.tag));
}

function macosFallbackTag(tags: string[], preferred: string): string {
  return tags.includes(preferred) ? preferred : tags[0];
}

/** Generate the macOS Xray profile for rootless system-proxy operation. */
export function macosXraySubscription(
  bundle: ClientBundle,
  secure: SecureConfig,
  policy: SmartDnsPolicy,
  mode: MacosXrayMode,
): Record<string, unknown> {
  const outbounds = macosEndpoints(bundle, secure);
  if (!outbounds.length) {
    throw new Error("client has no macOS Xray compatible endpoints");
  }

  const allTags = outbounds.map((outbound) => String(outbound.tag));
  const deTags = macosRegionTags(outbounds, "de");
  const usTags = macosRegionTags(outbounds, "us");
  const deFallback = macosFallbackTag(deTags, "de-httpupgrade");
  const usFallback = macosFallbackTag(usTags, "us-reality");
  const allFallback = macosFallbackTag(allTags, "de-httpupgrade");

  const localDirectRules = mode === "smart"
    ? macosDomainRules(policy, "direct")
    : [{ type: "field", domain: ["domain:local", "domain:lan", "full:localhost"], outboundTag: "direct" }];
  const rules: Record<string, unknown>[] = [
    { type: "field", ip: MACOS_PRIVATE_CIDRS, outboundTag: "direct" },
    ...localDirectRules,
  ];
  if (mode === "smart" && (policy.vusaProxySuffixes.length || policy.vusaProxyDomains.length)) {
    const vusaRules = macosDomainRules(
      { ...policy, proxySuffixes: policy.vusaProxySuffixes, proxyDomains: policy.vusaProxyDomains, localProxySuffixes: [], localProxyDomains: [] },
      "proxy",
    ).map((rule) => ({ ...rule, outboundTag: undefined, balancerTag: "bez-us" }));
    rules.push(...vusaRules);
  }
  if (mode === "smart") {
    const proxyRules = macosDomainRules(policy, "proxy").map((rule) => ({ ...rule, outboundTag: undefined, balancerTag: "bez-de" }));
    rules.push(...proxyRules);
  }

  if (mode === "all") {
    rules.push({ type: "field", network: "tcp,udp", balancerTag: "bez-all" });
  } else {
    rules.push({ type: "field", network: "tcp,udp", outboundTag: "direct" });
  }

  const balancers: Record<string, unknown>[] = [];
  if (mode === "smart") {
    balancers.push({ tag: "bez-de", selector: deTags, fallbackTag: deFallback, strategy: { type: "leastPing" } });
  }
  if (mode === "smart" && (policy.vusaProxySuffixes.length || policy.vusaProxyDomains.length)) {
    balancers.push({ tag: "bez-us", selector: usTags, fallbackTag: usFallback, strategy: { type: "leastPing" } });
  }
  if (mode === "all") {
    balancers.push({ tag: "bez-all", selector: allTags, fallbackTag: allFallback, strategy: { type: "leastPing" } });
  }

  const proxySniffing = {
    enabled: true,
    destOverride: ["http", "tls", "quic"],
    routeOnly: true,
  };
  return {
    log: { loglevel: "warning" },
    inbounds: [
      { tag: "socks-in", port: 10808, listen: "127.0.0.1", protocol: "socks", settings: { auth: "noauth", udp: true }, sniffing: proxySniffing },
      { tag: "http-in", port: 10809, listen: "127.0.0.1", protocol: "http", sniffing: proxySniffing },
    ],
    outbounds: [...outbounds, { tag: "direct", protocol: "freedom" }, { tag: "block", protocol: "blackhole" }],
    observatory: {
      subjectSelector: ["de-", "us-", "smart-de-", "full-de-", "smart-us-", "full-us-"],
      probeUrl: "https://www.gstatic.com/generate_204",
      probeInterval: "10s",
      enableConcurrency: true,
    },
    routing: {
      domainStrategy: secure.defaults.domain_strategy,
      rules,
      balancers,
    },
  };
}

export async function bundleByToken(pool: DbPool, token: string): Promise<ClientBundle | null> {
  const result = await pool.query(
    `select
       a.id::text as account_id,
       a.display_name,
       a.login,
       vc.id::text as client_id,
       vc.xray_uuid::text as xray_uuid,
       st.token
     from subscription_tokens st
     join vpn_clients vc on vc.id = st.client_id
     join accounts a on a.id = vc.account_id
     where st.token = $1 and st.enabled = true and vc.enabled = true and a.enabled = true`,
    [token],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  await pool.query("update subscription_tokens set last_used_at = now() where token = $1", [token]);
  const endpoints = await endpointsForClient(pool, row.client_id);
  return {
    accountId: row.account_id,
    clientId: row.client_id,
    displayName: row.display_name,
    login: row.login,
    xrayUuid: row.xray_uuid,
    token: row.token,
    endpoints,
  };
}

export async function bundleByAccount(pool: DbPool, accountId: string): Promise<ClientBundle | null> {
  const result = await pool.query(
    `select
       a.id::text as account_id,
       a.display_name,
       a.login,
       vc.id::text as client_id,
       vc.xray_uuid::text as xray_uuid,
       (
         select st.token from subscription_tokens st
         where st.client_id = vc.id and st.enabled = true
         order by st.created_at desc limit 1
       ) as token
     from accounts a
     join vpn_clients vc on vc.account_id = a.id
     where a.id = $1 and a.enabled = true and vc.enabled = true`,
    [accountId],
  );
  const row = result.rows[0];
  if (!row?.token) {
    return null;
  }
  return {
    accountId: row.account_id,
    clientId: row.client_id,
    displayName: row.display_name,
    login: row.login,
    xrayUuid: row.xray_uuid,
    token: row.token,
    endpoints: await endpointsForClient(pool, row.client_id),
  };
}

export async function endpointsForClient(pool: DbPool, clientId: string): Promise<Endpoint[]> {
  const result = await pool.query<Endpoint>(
    `select e.id, e.label, e.kind, e.address, e.port, e.profile_id, e.enabled, e.sort_order, e.config
     from client_profiles cp
     join endpoints e on e.id = cp.endpoint_id
     where cp.client_id = $1
     order by e.sort_order, e.id`,
    [clientId],
  );
  return orderPublicSubscriptionEndpoints(result.rows, await getVpnTestEndpointScores(pool));
}

export function subscriptionUrl(baseUrl: string, token: string, format = "plain"): string {
  return `${baseUrl}/sub/${encodeURIComponent(token)}/${format}`;
}

export function happDeeplink(subUrl: string): string {
  return `happ://subscription-url/add/${Buffer.from(subUrl, "utf8").toString("base64url")}`;
}

export function happInstallDeeplink(providerCode: string, installCode: string): string {
  return `happ://install/${providerCode}/${installCode}`;
}

export function announceHeader(message: string): string {
  return `base64:${Buffer.from(message, "utf8").toString("base64")}`;
}

const nameOverrides: Record<string, string> = {
  "vpn2-05": "Махмуд",
  "ovign": "мама Ольга",
};

const weekdayGenitive: Record<number, string> = {
  0: "воскресенья", 1: "понедельника", 2: "вторника", 3: "среды",
  4: "четверга", 5: "пятницы", 6: "субботы",
};

const weekdayNominative: Record<number, string> = {
  0: "воскресенье", 1: "понедельник", 2: "вторник", 3: "среду",
  4: "четверг", 5: "пятницу", 6: "субботу",
};

const morningGreetings = [
  "Доброе утро, {name}!",
  "С добрым утром, {name}!",
  "Утро начинается с кофе и BezVPN, {name}!",
  "Проснись и пой, {name}!",
  "Солнце уже встало, а BezVPN уже работает, {name}!",
];

const dayGreetings = [
  "Хорошего дня, {name}!",
  "Отличного настроения, {name}!",
  "Пусть этот день будет продуктивным, {name}!",
  "Сегодня отличный день, {name}!",
  "День удался, ведь у тебя есть BezVPN, {name}!",
];

const eveningGreetings = [
  "Хорошего вечера, {name}!",
  "Отдыхай, {name}, BezVPN всё разрулит!",
  "Вечер в радость, {name}!",
  "Спокойного вечера, {name}!",
  "Кино, чай и BezVPN, {name}!",
];

const nightGreetings = [
  "Спокойной ночи, {name}!",
  "Не сиди долго, {name}, отдохни!",
  "Сладких снов, {name}!",
  "Пусть тебе приснится быстрый интернет, {name}!",
];

const mondayGreetings: string[] = [
  "Удачного понедельника, {name}!",
  "Понедельник — день тяжёлый, но BezVPN облегчит, {name}!",
];

const fridayGreetings: string[] = [
  "С пятницей, {name}!",
  "Пятница — время расслабиться, {name}!",
  "Ура, пятница, {name}!",
];

const weekendGreetings: string[] = [
  "Отличных выходных, {name}!",
  "Выходные созданы для отдыха, {name}!",
  "Хорошего уикенда, {name}!",
];

const randomGreetings: string[] = [
  "BezVPN — твой надёжный друг, {name}!",
  "Да пребудет с тобой быстрый интернет, {name}!",
  "{name}, ты сегодня прекрасно выглядишь!",
  "BezVPN заботится о тебе, {name}!",
  "С днём {weekday}, {name}!",
  "Улыбнись, {name}, всё будет хорошо!",
  "Главное — не скорость, а стабильность, {name}!",
  "Ты лучший пользователь BezVPN, {name}!",
  "{name}, не забудь покормить кота!",
  "BezVPN: твой интернет без границ, {name}!",
  "Хорошего настроения, {name}!",
  "Не болей, {name}!",
  "{name}, ты на связи — и это главное!",
  "BezVPN работает, ты отдыхаешь, {name}!",
  "Пусть твой интернет летает, {name}!",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function personalizedAnnounce(displayName: string, login: string, now: Date = new Date()): string {
  const name = nameOverrides[login] || displayName;
  const hour = now.getHours();
  const day = now.getDay();

  let greeting: string;

  // Day-specific first
  if (day === 1 && Math.random() < 0.4) {
    greeting = pick(mondayGreetings);
  } else if (day === 5 && Math.random() < 0.4) {
    greeting = pick(fridayGreetings);
  } else if (day === 6 || day === 0) {
    if (Math.random() < 0.6) {
      greeting = pick(weekendGreetings);
    } else {
      greeting = pick(randomGreetings);
    }
  } else if (hour < 10) {
    greeting = pick(morningGreetings);
  } else if (hour < 17) {
    greeting = pick(dayGreetings);
  } else if (hour < 22) {
    greeting = pick(eveningGreetings);
  } else {
    greeting = pick(nightGreetings);
  }

  if (!greeting) {
    greeting = pick(randomGreetings);
  }

  return greeting.replace("{name}", name).replace("{weekday}", weekdayNominative[day]);
}
