import type {
  ProjectedScopeRoute,
  ProjectedServiceDomain,
  ServiceRoutingProjection,
} from "./service-catalog-activation.js";

export interface XrayOutbound {
  tag: string;
  [key: string]: unknown;
}

export interface XrayBalancer {
  tag: string;
  selector: string[];
  fallbackTag?: string;
  strategy?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface XrayRule {
  type?: string;
  inboundTag?: string[];
  domain?: string[];
  network?: string;
  outboundTag?: string;
  balancerTag?: string;
  [key: string]: unknown;
}

export interface XrayRouting {
  balancers: XrayBalancer[];
  rules: XrayRule[];
  [key: string]: unknown;
}

export interface XrayObservatory {
  subjectSelector: string[];
  probeUrl?: string;
  probeInterval?: string;
  [key: string]: unknown;
}

export interface XrayConfigWithRouting {
  outbounds: XrayOutbound[];
  routing: XrayRouting;
  observatory: XrayObservatory;
  [key: string]: unknown;
}

/**
 * Transport candidates selected from the current endpoint-health evidence.
 * Diagnostic outbounds remain in the config, but these are the only routes
 * allowed to receive normal LAN traffic.
 */
export const LAN_DE_TRANSPORT_TAGS = ["de-cdn", "de-cdn2", "de-direct-ws"];
export const LAN_US_TRANSPORT_TAGS = ["to-us-reality", "to-us-cdn", "to-us-cdn2", "to-us-xhttp-h2"];
export const LAN_OBSERVATORY_PROBE_INTERVAL = "10s";
/** LAN SNI destinations which require VUSA rather than the general DE pool. */
export const VUSA_SMART_EDGE_DOMAINS = [
  "domain:antigravity.google",
  "domain:gweb-jetski.appspot.com",
];
const RETIRED_CLOUDFLARE_CHALLENGE_DOMAIN = "domain:challenges.cloudflare.com";
const LAN_SMART_INBOUND_TAGS = ["in-lan-smart-http", "in-lan-smart-tls"];
/** JSON-safe marker used only on rules generated from the service catalog. */
export const SERVICE_CATALOG_LAN_RULE_MARKER = "vpn-panel:service-catalog-lan";

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

const US_TRANSPORT_ENDPOINT_IDS: Record<string, string> = {
  "to-us-reality": "us-reality",
  "to-us-xhttp": "us-xhttp",
  "to-us-xhttp-h2-443": "us-xhttp-h2-443",
  "to-us-httpupgrade": "us-httpupgrade",
  "to-us-ws": "us-direct-ws",
  "to-us-grpc": "us-grpc",
  "to-us-cdn": "us-cdn",
  "to-us-cdn2": "us-cdn2",
  "to-us-xhttp-h2": "us-xhttp-h2",
};

function requireBalancer(config: XrayConfigWithRouting, tag: string): XrayBalancer {
  const balancer = config.routing.balancers.find((candidate) => candidate.tag === tag);
  if (!balancer) throw new Error(`LAN config is missing the ${tag} balancer`);
  return balancer;
}

function requireOutbounds(config: XrayConfigWithRouting, tags: string[], region: string): void {
  const available = new Set(config.outbounds.map((outbound) => outbound.tag));
  if (tags.some((tag) => !available.has(tag))) throw new Error(`${region} LAN transport pool is missing an outbound`);
}

/**
 * Restrict the general LAN proxy to the DE transports that pass the endpoint
 * health contract, while retaining every other outbound for diagnostics.
 */
export function withStableDeLane(input: XrayConfigWithRouting, enabledEndpointIds?: ReadonlySet<string>): XrayConfigWithRouting {
  const base = structuredClone(input);
  requireBalancer(base, "proxy");
  const selectedTags = enabledEndpointIds
    ? LAN_DE_TRANSPORT_TAGS.filter((tag) => enabledEndpointIds.has(tag))
    : [...LAN_DE_TRANSPORT_TAGS];
  if (selectedTags.length === 0) throw new Error("DE LAN transport pool has no enabled endpoint");
  requireOutbounds(base, selectedTags, "DE");
  const fallbackTag = selectedTags.includes("de-cdn2") ? "de-cdn2" : selectedTags[0];

  base.routing.balancers = base.routing.balancers.map((candidate) => candidate.tag === "proxy"
    ? { ...candidate, selector: [...selectedTags], fallbackTag }
    : candidate);
  base.observatory = {
    ...base.observatory,
    subjectSelector: unique([
      ...base.observatory.subjectSelector.filter((tag) => !tag.startsWith("de-")),
      ...selectedTags,
    ]),
    probeInterval: LAN_OBSERVATORY_PROBE_INTERVAL,
  };
  return base;
}

/** Put VUSA-only LAN SNI traffic before the general DE Smart Edge rule. */
export function withVusaSmartEdgeLanes(input: XrayConfigWithRouting): XrayConfigWithRouting {
  const base = structuredClone(input);
  requireBalancer(base, "us-auto");
  const isGenericSmartEdgeRule = (rule: XrayRule): boolean =>
    rule.inboundTag?.length === LAN_SMART_INBOUND_TAGS.length
      && LAN_SMART_INBOUND_TAGS.every((tag) => rule.inboundTag?.includes(tag))
      && rule.balancerTag === "proxy"
      && !rule.domain?.length;
  if (!base.routing.rules.some(isGenericSmartEdgeRule)) {
    throw new Error("LAN Smart Edge DE routing rule is missing");
  }
  const isPreviousVusaRule = (rule: XrayRule): boolean =>
    rule.balancerTag === "us-auto"
      && rule.inboundTag?.length === LAN_SMART_INBOUND_TAGS.length
      && LAN_SMART_INBOUND_TAGS.every((tag) => rule.inboundTag?.includes(tag))
      && Boolean(rule.domain?.length)
      // Remove the prior generated rule during the one-time rollback. It had
      // the same managed VUSA domains plus a retired Cloudflare challenge
      // hostname; do not treat arbitrary future VUSA service rules as ours.
      && (rule.domain!.every((domain) => VUSA_SMART_EDGE_DOMAINS.includes(domain))
        || (rule.domain!.includes(RETIRED_CLOUDFLARE_CHALLENGE_DOMAIN)
          && rule.domain!.every((domain) => VUSA_SMART_EDGE_DOMAINS.includes(domain) || domain === RETIRED_CLOUDFLARE_CHALLENGE_DOMAIN)));
  const withoutPrevious = base.routing.rules.filter((rule) => !isPreviousVusaRule(rule));
  const insertionIndex = withoutPrevious.findIndex(isGenericSmartEdgeRule);
  withoutPrevious.splice(insertionIndex, 0, {
    type: "field",
    inboundTag: [...LAN_SMART_INBOUND_TAGS],
    domain: [...VUSA_SMART_EDGE_DOMAINS],
    balancerTag: "us-auto",
  });
  base.routing.rules = withoutPrevious;
  return base;
}

/**
 * Render LAN proxy entries from the service-routing projection into Xray
 * field rules. The input config is cloned and prior marked rules are removed
 * before inserting the deterministic projection output.
 */
export function withServiceCatalogLanRules(
  input: XrayConfigWithRouting,
  projection: ServiceRoutingProjection,
): XrayConfigWithRouting {
  const base = structuredClone(input);
  const generatedEntries = projection.domains
    .map((entry) => prepareServiceCatalogLanEntry(base, entry))
    .filter((entry): entry is ServiceCatalogLanEntry => entry !== null)
    .sort(compareServiceCatalogLanEntries);

  const withoutManaged = base.routing.rules.filter((rule) => rule.comment !== SERVICE_CATALOG_LAN_RULE_MARKER);
  if (generatedEntries.length === 0) {
    base.routing.rules = withoutManaged;
    return base;
  }

  const genericIndex = withoutManaged.findIndex(isGenericSmartEdgeRule);
  if (genericIndex < 0) throw new Error("LAN Smart Edge DE routing rule is missing");
  const generatedRules = generatedEntries.map((entry): XrayRule => ({
    type: "field",
    inboundTag: [...LAN_SMART_INBOUND_TAGS],
    domain: [entry.domainRule],
    balancerTag: entry.balancerTag,
    comment: SERVICE_CATALOG_LAN_RULE_MARKER,
  }));
  withoutManaged.splice(genericIndex, 0, ...generatedRules);
  base.routing.rules = withoutManaged;
  return base;
}

interface ServiceCatalogLanEntry {
  serviceId: string;
  match: "exact" | "suffix";
  domain: string;
  domainRule: string;
  balancerTag: string;
}

function prepareServiceCatalogLanEntry(
  config: XrayConfigWithRouting,
  entry: ProjectedServiceDomain,
): ServiceCatalogLanEntry | null {
  validateProjectedRoute(entry.lan, entry, "LAN");
  validateProjectedRoute(entry.external, entry, "external");
  if (!entry.lan || entry.lan.kind !== "proxy") return null;
  if (entry.match !== "exact" && entry.match !== "suffix") {
    throw new Error(`unsupported projected domain match for ${entry.serviceId}/${entry.domain}`);
  }
  if (entry.match === "exact") throw new Error(`unsupported exact LAN proxy rule: ${entry.serviceId}/${entry.domain}`);
  const balancerTag = entry.lan.balancerTag;
  if (typeof balancerTag !== "string" || balancerTag.trim().length === 0) {
    throw new Error(`LAN proxy requires a non-empty balancerTag: ${entry.serviceId}/${entry.domain}`);
  }
  requireBalancer(config, balancerTag);
  if (typeof entry.domain !== "string" || entry.domain.length === 0) {
    throw new Error(`LAN proxy domain must be non-empty: ${entry.serviceId}`);
  }
  return {
    serviceId: entry.serviceId,
    match: entry.match,
    domain: entry.domain,
    domainRule: `domain:${entry.domain}`,
    balancerTag,
  };
}

function validateProjectedRoute(route: ProjectedScopeRoute | null | undefined, entry: ProjectedServiceDomain, scope: string): void {
  if (route === undefined) return;
  if (route === null) throw new Error(`invalid null route: ${scope}/${entry.serviceId}/${entry.domain}`);
  if (typeof route !== "object" || (route.kind !== "direct" && route.kind !== "proxy")) {
    throw new Error(`malformed ${scope} route: ${entry.serviceId}/${entry.domain}`);
  }
}

function isGenericSmartEdgeRule(rule: XrayRule): boolean {
  return rule.inboundTag?.length === LAN_SMART_INBOUND_TAGS.length
    && LAN_SMART_INBOUND_TAGS.every((tag) => rule.inboundTag?.includes(tag))
    && rule.balancerTag === "proxy"
    && !rule.domain?.length;
}

function compareServiceCatalogLanEntries(left: ServiceCatalogLanEntry, right: ServiceCatalogLanEntry): number {
  if (left.match !== right.match) return left.match === "exact" ? -1 : 1;
  if (left.match === "suffix" && left.domain.length !== right.domain.length) {
    return right.domain.length - left.domain.length;
  }
  const domainOrder = left.domain === right.domain ? 0 : left.domain < right.domain ? -1 : 1;
  return domainOrder !== 0 ? domainOrder : left.serviceId === right.serviceId ? 0 : left.serviceId < right.serviceId ? -1 : 1;
}

/**
 * Copy the regional relay's complete US transport pool into the LAN Xray.
 *
 * The LAN host then performs its own least-ping selection while OpenWrt only
 * checks and forwards the ready HTTP proxy on :3127.
 */
export function withRegionalUsLane(
  baseInput: XrayConfigWithRouting,
  regionalInput: XrayConfigWithRouting,
  enabledEndpointIds?: ReadonlySet<string>,
): XrayConfigWithRouting {
  const base = structuredClone(baseInput);
  const regional = structuredClone(regionalInput);
  const usOutbounds = regional.outbounds.filter((outbound) => {
    if (!outbound.tag.startsWith("to-us-")) return false;
    const endpointId = US_TRANSPORT_ENDPOINT_IDS[outbound.tag];
    return !enabledEndpointIds || (endpointId !== undefined && enabledEndpointIds.has(endpointId));
  });
  const usBalancer = regional.routing.balancers.find((balancer) => balancer.tag === "us-auto");
  if (usOutbounds.length === 0 || !usBalancer) throw new Error("regional US transport pool is missing");

  const usTags = new Set(usOutbounds.map((outbound) => outbound.tag));
  const regionalSelector = new Set(usBalancer.selector);
  if ([...usTags].some((tag) => !regionalSelector.has(tag))) throw new Error("US balancer references an absent outbound");
  const selectedTags = enabledEndpointIds
    ? LAN_US_TRANSPORT_TAGS.filter((tag) => usTags.has(tag))
    : [...LAN_US_TRANSPORT_TAGS];
  if (selectedTags.length === 0) throw new Error("US LAN transport pool has no enabled endpoint");
  if (selectedTags.some((tag) => !usTags.has(tag))) throw new Error("US LAN transport pool is missing an outbound");
  const streamingTag = selectedTags.includes("to-us-xhttp-h2") ? "to-us-xhttp-h2" : selectedTags[0];
  // worker-dev is a relay in the restricted zone. Keep several independent
  // VUSA paths in leastPing so one broken transport cannot black-hole a
  // request, while retaining the proven stream-up H2 path for cold start.
  const pinnedUsBalancer: XrayBalancer = {
    ...usBalancer,
    selector: [...selectedTags],
    fallbackTag: streamingTag,
  };

  base.outbounds = [
    ...base.outbounds.filter((outbound) => outbound.tag !== "us-xhttp-h2" && !outbound.tag.startsWith("to-us-")),
    ...usOutbounds,
  ];
  base.routing.balancers = [
    ...base.routing.balancers.filter((balancer) => balancer.tag !== "us-auto"),
    pinnedUsBalancer,
  ];
  base.routing.rules = base.routing.rules.map((rule) => {
    if (!rule.inboundTag?.includes("in-http-us")) return rule;
    return { type: "field", inboundTag: ["in-http-us"], network: "tcp,udp", balancerTag: "us-auto" };
  });
  if (!base.routing.rules.some((rule) => rule.inboundTag?.includes("in-http-us"))) {
    throw new Error("LAN US inbound routing rule is missing");
  }

  base.observatory = {
    ...base.observatory,
    probeUrl: regional.observatory.probeUrl || base.observatory.probeUrl,
    probeInterval: LAN_OBSERVATORY_PROBE_INTERVAL,
    subjectSelector: unique([
      ...base.observatory.subjectSelector.filter((tag) => !tag.startsWith("to-us-")),
      ...pinnedUsBalancer.selector,
    ]),
  };
  return base;
}
