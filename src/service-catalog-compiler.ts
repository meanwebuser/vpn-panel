import {
  validateServiceCatalog,
  validateServiceTargetCapabilities,
  type ServiceCatalog,
  type ServiceDefinition,
  type ServiceDomainMatch,
  type ServiceRouteTo,
  type ServiceTargetCapability,
} from "./service-catalog.js";

export type CompiledScope = "lan" | "external";

export interface ServiceCatalogCompileEnvironment {
  targets: readonly ServiceTargetCapability[];
  /** The sole VPS that the current public DNS profile can synthesize. */
  activePublicDnsEdgeId: string | null;
}

export interface CompiledServiceCatalog {
  schemaVersion: 1;
  sourceCatalogUpdatedAt: string;
  activePublicDnsEdgeId: string | null;
  rules: CompiledServiceRule[];
  diagnostics: ServiceCatalogCompileDiagnostic[];
  activationReady: boolean;
}

export interface CompiledServiceRule {
  serviceId: string;
  scope: CompiledScope;
  match: ServiceDomainMatch;
  domain: string;
  route: CompiledServiceRoute;
  activation: CompiledActivation;
}

export type ServiceCatalogDeferralCode =
  | "multi-vps-selector-unavailable"
  | "public-target-not-active"
  | "external-only-pool-unavailable"
  | "direct-fallback-unavailable"
  | "lan-exact-proxy-unrepresentable";

export type CompiledServiceRoute =
  | { kind: "direct" }
  | {
      kind: "vps-pool";
      allowedVpsIds: string[];
      selection: "fastest-healthy";
      onNoHealthyTarget: "servfail" | "direct";
    };

export type CompiledActivation =
  | { state: "ready"; binding: { kind: "direct" } }
  | {
      state: "ready";
      binding:
        | { kind: "lan-balancer"; targetId: string; balancerTag: string }
        | { kind: "public-active-edge"; targetId: string }
        | { kind: "public-edge-profile"; targetId: string; profileId: "vusa" };
    }
  | {
      state: "deferred";
      code: ServiceCatalogDeferralCode;
    };

export interface ServiceCatalogCompileDiagnostic {
  severity: "deferred";
  code: ServiceCatalogDeferralCode;
  serviceId: string;
  scope: CompiledScope;
  domain: string;
  message: string;
}

interface PendingRule {
  service: ServiceDefinition;
  scope: CompiledScope;
  match: ServiceDomainMatch;
  domain: string;
}

/** Compile canonical catalog rules into an explicit, non-live activation plan. */
export function compileServiceCatalog(
  catalog: ServiceCatalog,
  environment: ServiceCatalogCompileEnvironment,
): CompiledServiceCatalog {
  validateServiceCatalog(catalog);
  const targets = [...environment.targets];
  validateServiceTargetCapabilities(catalog, targets);
  const targetById = new Map(targets.map((target) => [target.id, target]));

  const pendingRules: PendingRule[] = [];
  for (const service of catalog.services) {
    if (service.enabled === false) continue;
    const scopes: CompiledScope[] = service.workIn === "both"
      ? ["lan", "external"]
      : [service.workIn === "lan-only" ? "lan" : "external"];
    for (const scope of scopes) {
      for (const domain of service.domains) {
        pendingRules.push({ service, scope, match: domain.match, domain: domain.value });
      }
    }
  }

  pendingRules.sort(comparePendingRules);
  const diagnostics: ServiceCatalogCompileDiagnostic[] = [];
  const rules = pendingRules.map(({ service, scope, match, domain }) => {
    const route = compileRoute(service.routeTo);
    const activation = compileActivation(service, scope, match, route, targetById, environment.activePublicDnsEdgeId);
    if (activation.state === "deferred") {
      diagnostics.push({
        severity: "deferred",
        code: activation.code,
        serviceId: service.id,
        scope,
        domain,
        message: diagnosticMessage(service.id, scope, domain, activation.code),
      });
    }
    return { serviceId: service.id, scope, match, domain, route, activation };
  });

  return {
    schemaVersion: 1,
    sourceCatalogUpdatedAt: catalog.updatedAt,
    activePublicDnsEdgeId: environment.activePublicDnsEdgeId,
    rules,
    diagnostics,
    activationReady: diagnostics.length === 0,
  };
}

function compileRoute(routeTo: ServiceRouteTo): CompiledServiceRoute {
  if (routeTo.kind === "direct") return { kind: "direct" };
  return {
    kind: "vps-pool",
    allowedVpsIds: [...routeTo.allowedVpsIds].sort(),
    selection: "fastest-healthy",
    onNoHealthyTarget: routeTo.onNoHealthyTarget,
  };
}

function compileActivation(
  service: ServiceDefinition,
  scope: CompiledScope,
  match: ServiceDomainMatch,
  route: CompiledServiceRoute,
  targetById: ReadonlyMap<string, ServiceTargetCapability>,
  activePublicDnsEdgeId: string | null,
): CompiledActivation {
  if (route.kind === "direct") return { state: "ready", binding: { kind: "direct" } };
  if (service.workIn === "external") return { state: "deferred", code: "external-only-pool-unavailable" };
  if (route.onNoHealthyTarget === "direct") return { state: "deferred", code: "direct-fallback-unavailable" };
  if (route.allowedVpsIds.length > 1) return { state: "deferred", code: "multi-vps-selector-unavailable" };
  if (scope === "lan" && match === "exact") {
    return { state: "deferred", code: "lan-exact-proxy-unrepresentable" };
  }

  const targetId = route.allowedVpsIds[0];
  if (scope === "lan") {
    const balancerTag = targetById.get(targetId)?.lanBalancerTag;
    if (!balancerTag) {
      // Validation above guarantees this cannot happen for a valid LAN pool.
      throw new Error(`service ${service.id} VPS ${targetId} is missing a LAN balancer tag`);
    }
    return { state: "ready", binding: { kind: "lan-balancer", targetId, balancerTag } };
  }
  if (targetId === activePublicDnsEdgeId) {
    return { state: "ready", binding: { kind: "public-active-edge", targetId } };
  }
  if (service.workIn === "both" && targetById.get(targetId)?.dedicatedPublicDnsProfile === "vusa") {
    return { state: "ready", binding: { kind: "public-edge-profile", targetId, profileId: "vusa" } };
  }
  return { state: "deferred", code: "public-target-not-active" };
}

function comparePendingRules(left: PendingRule, right: PendingRule): number {
  const scopeOrder = left.scope === right.scope ? 0 : left.scope === "lan" ? -1 : 1;
  if (scopeOrder !== 0) return scopeOrder;
  const matchOrder = left.match === right.match ? 0 : left.match === "exact" ? -1 : 1;
  if (matchOrder !== 0) return matchOrder;
  if (left.match === "suffix" && left.domain.length !== right.domain.length) {
    return right.domain.length - left.domain.length;
  }
  const domainOrder = lexicalCompare(left.domain, right.domain);
  if (domainOrder !== 0) return domainOrder;
  return lexicalCompare(left.service.id, right.service.id);
}

function lexicalCompare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function diagnosticMessage(
  serviceId: string,
  scope: CompiledScope,
  domain: string,
  code: ServiceCatalogCompileDiagnostic["code"],
): string {
  switch (code) {
    case "multi-vps-selector-unavailable":
      return `${serviceId} ${scope} rule for ${domain} is deferred because multi-VPS selection is unavailable`;
    case "public-target-not-active":
      return `${serviceId} ${scope} rule for ${domain} is deferred because its public target is not the active DNS edge`;
    case "external-only-pool-unavailable":
      return `${serviceId} ${scope} rule for ${domain} is deferred because external-only pool activation is unavailable`;
    case "direct-fallback-unavailable":
      return `${serviceId} ${scope} rule for ${domain} is deferred because direct fallback activation is unavailable`;
    case "lan-exact-proxy-unrepresentable":
      return `${serviceId} lan exact proxy rule for ${domain} is deferred because OpenWrt dnsmasq local/address rules also match subdomains; exact LAN proxy matching is not representable`;
  }
}
