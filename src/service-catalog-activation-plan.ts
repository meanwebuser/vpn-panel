import type { ServiceCatalog } from "./service-catalog.js";
import {
  compileServiceCatalog,
  type ServiceCatalogCompileDiagnostic,
  type ServiceCatalogCompileEnvironment,
} from "./service-catalog-compiler.js";

export interface ServiceCatalogActivationPlanDiagnostic {
  serviceId: string;
  scope: "lan" | "external";
  domain: string;
  code: ServiceCatalogCompileDiagnostic["code"];
}

export interface ServiceCatalogActivationPlan {
  schemaVersion: 1;
  draftRevision: string;
  activePublicDnsEdgeId: string | null;
  status: "ready" | "blocked";
  routeCount: number;
  diagnostics: ServiceCatalogActivationPlanDiagnostic[];
}

/** Build a non-mutating activation preview for the current service catalog draft. */
export function buildServiceCatalogActivationPlan(
  catalog: ServiceCatalog,
  environment: ServiceCatalogCompileEnvironment,
): ServiceCatalogActivationPlan {
  const compiled = compileServiceCatalog(catalog, environment);
  const diagnostics = compiled.diagnostics.map(({ serviceId, scope, domain, code }) => ({
    serviceId,
    scope,
    domain,
    code,
  }));
  const routeCount = compiled.activationReady
    ? new Set(compiled.rules.map((rule) => `${rule.match}\u0000${rule.domain}`)).size
    : 0;

  return {
    schemaVersion: 1,
    draftRevision: compiled.sourceCatalogUpdatedAt,
    activePublicDnsEdgeId: compiled.activePublicDnsEdgeId,
    status: compiled.activationReady ? "ready" : "blocked",
    routeCount,
    diagnostics,
  };
}
