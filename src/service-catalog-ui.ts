import type { ServiceCatalog, ServiceDefinition, ServiceTargetCapability } from "./service-catalog.js";
import { escapeHtml } from "./html.js";

export interface ServiceCatalogEditorInput {
  catalog: ServiceCatalog;
  targets: ServiceTargetCapability[];
  saveAction: string;
}

function checkbox(name: string, value: string | undefined, label: string, checked: boolean, disabled = false): string {
  const valueAttribute = value === undefined ? "" : ` value="${escapeHtml(value)}"`;
  return `<label><input type="checkbox" name="${escapeHtml(name)}"${valueAttribute}${checked ? " checked" : ""}${disabled ? " disabled" : ""}> ${escapeHtml(label)}</label>`;
}

function targetReason(service: ServiceDefinition, target: ServiceTargetCapability): string | null {
  if (service.routeTo.kind === "direct") return "Direct routing does not use a VPS edge";
  const reasons: string[] = [];
  if (service.workIn === "lan-only" || service.workIn === "both") {
    if (!target.lanEgress) reasons.push("requires LAN egress");
    if (!target.lanBalancerTag) reasons.push("requires a LAN balancer tag");
  }
  if (service.workIn === "external" || service.workIn === "both") {
    if (!target.publicDnsEdge) reasons.push("requires a public DNS edge");
  }
  return reasons.length > 0 ? reasons.join(" and ") : null;
}

function renderService(service: ServiceDefinition, catalog: ServiceCatalog, targets: ServiceTargetCapability[], saveAction: string): string {
  const route = service.routeTo;
  const poolSelected = route.kind === "vps-pool";
  const workInLan = service.workIn === "lan-only" || service.workIn === "both";
  const workInExternal = service.workIn === "external" || service.workIn === "both";
  const domains = service.domains.map((rule) => `<tr><td>${escapeHtml(rule.match)}</td><td>${escapeHtml(rule.value)}</td></tr>`).join("");
  const targetControls = targets.map((target) => {
    const reason = targetReason(service, target);
    const disabled = reason !== null;
    const checked = poolSelected && route.allowedVpsIds.includes(target.id);
    return `<div class="service-target">${checkbox("allowedVpsIds", target.id, target.id, checked, disabled)}${disabled ? ` <span class="service-target-reason">(${escapeHtml(reason)})</span>` : ""}</div>`;
  }).join("");
  const noHealthyText = poolSelected ? (route.onNoHealthyTarget === "servfail" ? "Fail closed" : "Fall back to direct") : "";
  return `<form method="post" action="${escapeHtml(saveAction)}" data-service-id="${escapeHtml(service.id)}" class="service-card">
    <input type="hidden" name="serviceId" value="${escapeHtml(service.id)}">
    <input type="hidden" name="revision" value="${escapeHtml(catalog.updatedAt)}">
    <h3>${escapeHtml(service.label)}</h3>
    <p class="service-id">${escapeHtml(service.id)}</p>
    <p>${checkbox("enabled", undefined, "Enabled", service.enabled !== false)}</p>
    <fieldset><legend>Work in</legend>
      ${checkbox("workInLan", undefined, "LAN", workInLan)}
      ${checkbox("workInExternal", undefined, "External", workInExternal)}
    </fieldset>
    <fieldset><legend>Route to</legend>
      <label><input type="radio" name="routeKind" value="direct"${!poolSelected ? " checked" : ""}> Direct</label>
      <label><input type="radio" name="routeKind" value="vps-pool"${poolSelected ? " checked" : ""}> VPS pool</label>
      ${noHealthyText ? `<p class="route-fallback">When no healthy target: ${escapeHtml(noHealthyText)}</p>` : ""}
    </fieldset>
    <fieldset><legend>VPS pool members</legend>${targetControls || "<p>No VPS targets available.</p>"}</fieldset>
    <table><caption>Domain rules</caption><thead><tr><th>Match</th><th>Value</th></tr></thead><tbody>${domains}</tbody></table>
    <button type="submit">Save service</button>
  </form>`;
}

/** Render the server-side editor for the complete v2 service catalog. */
export function serviceCatalogEditor(input: ServiceCatalogEditorInput): string {
  const body = input.catalog.services.length === 0
    ? '<p class="empty-state">No services configured.</p>'
    : input.catalog.services.map((service) => renderService(service, input.catalog, input.targets, input.saveAction)).join("\n");
  return `<section class="card" id="service-catalog"><h2>Service routes</h2><p>Direct routing does not use a SmartDNS edge or VPS.</p>${body}</section>`;
}
